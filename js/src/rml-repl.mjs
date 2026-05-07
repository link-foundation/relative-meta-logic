// RML — Interactive REPL (issue #29)
//
// Maintains a persistent `Env` between user inputs and prints diagnostics
// inline. Meta-commands start with `:` and control session state:
//
//   :help           show this help message
//   :reset          discard all state and start a fresh Env
//   :env            print declared terms / assignments / types / lambdas
//   :load <file>    evaluate a `.lino` file in the current Env
//   :save <file>    write the session transcript (as `.lino`) to <file>
//   :quit           exit the REPL (also: :exit, Ctrl-D)
//
// Tab-completion is best-effort: it offers known meta-commands, declared
// terms, operator names, lambda names, and a handful of built-in keywords.

import fs from 'node:fs';
import readline from 'node:readline';
import { evaluate, Env, formatDiagnostic } from './rml-links.mjs';

const META_COMMANDS = [
  ':help', ':reset', ':env', ':load', ':save', ':quit', ':exit',
];

const BUILTIN_KEYWORDS = [
  'and', 'or', 'not', 'both', 'neither', 'is', 'has', 'probability',
  'range', 'valence', 'counter-model', 'true', 'false', 'unknown', 'undefined',
  'lambda', 'apply', 'subst', 'fresh', 'in', 'Pi', 'Type', 'Prop', 'of', 'type',
];

function formatNumber(v) {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return String(v);
  return String(+v.toFixed(6)).replace(/\.0+$/, '');
}

// Collect candidate identifiers from the env for tab-completion.
function envCompletionCandidates(env) {
  const out = new Set(BUILTIN_KEYWORDS);
  if (!env) return [...out];
  for (const t of env.terms) out.add(t);
  for (const op of env.ops.keys()) out.add(op);
  for (const sym of env.symbolProb.keys()) out.add(sym);
  for (const name of env.lambdas.keys()) out.add(name);
  return [...out];
}

// Best-effort completer.  Splits the current line on the last word boundary
// and offers identifiers/meta-commands that share a prefix with the suffix.
function makeCompleter(getEnv) {
  return function completer(line) {
    if (line.trimStart().startsWith(':')) {
      const trimmed = line.trimStart();
      const hits = META_COMMANDS.filter(c => c.startsWith(trimmed));
      return [hits.length ? hits : META_COMMANDS, trimmed];
    }
    // Split on the last whitespace or `(` to find the identifier prefix.
    const m = line.match(/[^\s()]*$/);
    const prefix = m ? m[0] : '';
    const candidates = envCompletionCandidates(getEnv());
    const hits = prefix
      ? candidates.filter(c => c.startsWith(prefix)).sort()
      : candidates.sort();
    return [hits, prefix];
  };
}

// Render a snapshot of the env's user-visible state.
function formatEnv(env) {
  const lines = [];
  lines.push(`range:    [${env.lo}, ${env.hi}]`);
  lines.push(`valence:  ${env.valence === 0 ? 'continuous' : env.valence}`);
  if (env.terms.size) {
    lines.push(`terms:    ${[...env.terms].sort().join(', ')}`);
  }
  if (env.lambdas.size) {
    lines.push(`lambdas:  ${[...env.lambdas.keys()].sort().join(', ')}`);
  }
  if (env.types.size) {
    lines.push('types:');
    for (const [k, v] of [...env.types.entries()].sort()) {
      lines.push(`  ${k} : ${v}`);
    }
  }
  if (env.assign.size) {
    lines.push('assignments:');
    for (const [k, v] of [...env.assign.entries()].sort()) {
      lines.push(`  ${k} = ${formatNumber(v)}`);
    }
  }
  // Only show user-set symbol priors (skip the four predefined truth constants
  // unless the user explicitly redefined them).
  const defaults = new Map([
    ['true', env.hi], ['false', env.lo],
    ['unknown', env.mid], ['undefined', env.mid],
  ]);
  const userPriors = [...env.symbolProb.entries()]
    .filter(([k, v]) => !(defaults.has(k) && defaults.get(k) === v));
  if (userPriors.length) {
    lines.push('symbol priors:');
    for (const [k, v] of userPriors.sort()) {
      lines.push(`  ${k} = ${formatNumber(v)}`);
    }
  }
  return lines.join('\n');
}

const HELP_TEXT = [
  'RML REPL — meta-commands:',
  '  :help           show this help message',
  '  :reset          discard all state and start a fresh Env',
  '  :env            print declared terms / assignments / types / lambdas',
  '  :load <file>    evaluate a .lino file in the current Env',
  '  :save <file>    write the session transcript (as .lino) to <file>',
  '  :quit           exit the REPL (also :exit, Ctrl-D)',
  '',
  'LiNo input is evaluated form-by-form.  Query results are printed; errors',
  'are reported as diagnostics with source spans.',
].join('\n');

// REPL state machine.  Owns the current Env, the transcript, and the I/O
// streams.  The `feed(line)` method processes a single line (LiNo form or
// meta-command) and returns `{ output, error, exit }` so callers — including
// the integration tests — can drive it without touching `readline`.
class Repl {
  constructor(options = {}) {
    this.envOptions = options.envOptions || {};
    this.env = new Env(this.envOptions);
    this.transcript = [];
    this.cwd = options.cwd || process.cwd();
    this.errStream = options.errStream || null;
    this.outStream = options.outStream || null;
  }

  reset() {
    this.env = new Env(this.envOptions);
    this.transcript = [];
  }

  // Evaluate a chunk of LiNo source against the persistent env.
  // Returns `{ output, errors }` — output is the string of query results,
  // errors is the formatted diagnostic block (empty string if none).
  evaluateSource(source, file) {
    const { results, diagnostics } = evaluate(source, { env: this.env, file });
    const out = results.map(formatNumber).join('\n');
    const errs = diagnostics
      .map(d => formatDiagnostic(d, source))
      .join('\n');
    return { output: out, errors: errs };
  }

  // Process a single REPL line.  Returns:
  //   { output, error, exit }  where output/error are strings (possibly empty)
  //   and exit is true if the user requested termination.
  feed(line) {
    const trimmed = line.trim();
    if (!trimmed) return { output: '', error: '', exit: false };
    if (trimmed.startsWith(':')) return this._handleMeta(trimmed);
    this.transcript.push(line);
    const { output, errors } = this.evaluateSource(line, '<repl>');
    return { output, error: errors, exit: false };
  }

  _handleMeta(line) {
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case ':help':
      case ':?':
        return { output: HELP_TEXT, error: '', exit: false };
      case ':quit':
      case ':exit':
        return { output: '', error: '', exit: true };
      case ':reset':
        this.reset();
        return { output: 'Env reset.', error: '', exit: false };
      case ':env':
        return { output: formatEnv(this.env), error: '', exit: false };
      case ':load': {
        if (!arg) return { output: '', error: ':load requires a file path', exit: false };
        let text;
        try {
          text = fs.readFileSync(this._resolve(arg), 'utf8');
        } catch (err) {
          return { output: '', error: `:load failed: ${err.message}`, exit: false };
        }
        this.transcript.push(`# :load ${arg}`);
        this.transcript.push(text);
        const { output, errors } = this.evaluateSource(text, arg);
        return { output, error: errors, exit: false };
      }
      case ':save': {
        if (!arg) return { output: '', error: ':save requires a file path', exit: false };
        const body = this.transcript.join('\n');
        try {
          fs.writeFileSync(this._resolve(arg), body.endsWith('\n') ? body : body + '\n');
        } catch (err) {
          return { output: '', error: `:save failed: ${err.message}`, exit: false };
        }
        return { output: `Saved ${this.transcript.length} entries to ${arg}.`, error: '', exit: false };
      }
      default:
        return {
          output: '',
          error: `Unknown meta-command: ${cmd}.  Try :help.`,
          exit: false,
        };
    }
  }

  _resolve(p) {
    if (p.startsWith('/') || p.startsWith('~')) return p;
    return `${this.cwd}/${p}`;
  }
}

// Run the REPL on the given streams (defaults: stdin/stdout).  Returns a
// promise that resolves when the user exits.  Exposed for both the CLI and
// the integration tests.
function runRepl(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const errOutput = options.errOutput || process.stderr;
  const repl = new Repl({
    envOptions: options.envOptions,
    cwd: options.cwd,
  });
  const showPrompt = options.showPrompt !== false;
  const banner = options.banner !== false;

  if (banner && showPrompt) {
    output.write('RML REPL.  Type :help for commands, :quit to exit.\n');
  }

  const rl = readline.createInterface({
    input,
    output,
    terminal: options.terminal,
    completer: makeCompleter(() => repl.env),
    prompt: showPrompt ? 'rml> ' : '',
  });

  return new Promise(resolve => {
    if (showPrompt) rl.prompt();
    rl.on('line', line => {
      const { output: out, error, exit } = repl.feed(line);
      if (out) output.write(out + '\n');
      if (error) errOutput.write(error + '\n');
      if (exit) {
        rl.close();
        return;
      }
      if (showPrompt) rl.prompt();
    });
    rl.on('close', () => {
      if (showPrompt) output.write('\n');
      resolve(repl);
    });
  });
}

export { Repl, runRepl, formatEnv, makeCompleter, envCompletionCandidates, HELP_TEXT };
