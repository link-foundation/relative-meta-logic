#!/usr/bin/env node
// rml-meta — metatheorem checker over encoded systems (issue #47, C3).
//
// Composes the existing D12 totality, D14 coverage, D15 modes, and D13
// termination checkers into a single Twelf-style guarantee: a relation is
// total on its declared input domain iff every input pattern is covered
// and every recursive call structurally decreases on a `+input` slot.
//
// Used as a library from `checkMetatheorems(text, file)` and as a CLI via
// `rml-meta program.lino`. Each declared relation that has a `(mode ...)`
// declaration is treated as a metatheorem candidate; the checker runs
// coverage (D14) and totality (D12) and reports each as `pass` or `fail`
// with a counter-witness drawn from the underlying checkers.

import fs from 'node:fs';
import {
  evaluate,
  Env,
  isTotal,
  isCovered,
  isTerminating,
  formatDiagnostic,
} from './rml-links.mjs';

// Build a fresh `Env` and evaluate `text` so we can inspect declarations
// after the fact. We pass our own `Env` because `evaluate()` does not
// otherwise expose the post-run environment to library callers.
function evaluateProgram(text, file) {
  const env = new Env();
  const out = evaluate(text, { env, file: file || null });
  return { env, results: out.results, diagnostics: out.diagnostics };
}

// Run coverage (D14) and totality (D12) for a single relation. Returns a
// structured `MetatheoremResult` with each sub-check's outcome and the
// counter-witness messages collected from the underlying checkers.
function checkRelation(env, name) {
  const checks = [];
  const totality = isTotal(env, name);
  checks.push({
    kind: 'totality',
    ok: totality.ok,
    diagnostics: totality.diagnostics,
  });
  // Coverage is only meaningful when an inductive type can be inferred
  // for every `+input` slot. `isCovered` already handles the no-info case
  // by returning `ok: true` with empty diagnostics.
  const coverage = isCovered(env, name);
  checks.push({
    kind: 'coverage',
    ok: coverage.ok,
    diagnostics: coverage.diagnostics,
  });
  return {
    name,
    ok: checks.every(c => c.ok),
    checks,
  };
}

// Run termination (D13) for every definition that the program registered
// via `(define ...)`. Definitions are independent of relations — they use
// pattern arguments rather than mode flags — so they form a separate
// section of the metatheorem report.
function checkDefinition(env, name) {
  const result = isTerminating(env, name);
  return {
    name,
    ok: result.ok,
    checks: [{
      kind: 'termination',
      ok: result.ok,
      diagnostics: result.diagnostics,
    }],
  };
}

// Public API: evaluate the program, then enumerate every relation that has
// a `(mode ...)` declaration and every definition that has a `(define ...)`
// declaration. Each candidate becomes a metatheorem result.
//
// Returns `{ ok, evaluation, relations, definitions }`. `evaluation`
// preserves the diagnostics emitted while parsing/running the program so
// callers can surface them alongside the metatheorem outcomes.
function checkMetatheorems(text, options = {}) {
  const { env, results, diagnostics } = evaluateProgram(text, options.file);
  const relationNames = Array.from(env.modes.keys()).sort();
  const relations = [];
  for (const name of relationNames) {
    // A `(mode ...)` declaration without any matching `(relation ...)`
    // clause means the relation has no body to verify; surface that as a
    // failed metatheorem rather than silently treating it as total.
    const clauses = env.relations.get(name);
    if (!clauses || clauses.length === 0) continue;
    relations.push(checkRelation(env, name));
  }
  const definitionNames = Array.from(env.definitions.keys()).sort();
  const definitions = [];
  for (const name of definitionNames) {
    definitions.push(checkDefinition(env, name));
  }
  const ok =
    diagnostics.length === 0 &&
    relations.every(r => r.ok) &&
    definitions.every(d => d.ok);
  return { ok, evaluation: { results, diagnostics }, relations, definitions };
}

// Format a single check (totality / coverage / termination) for the CLI
// output. Each diagnostic line starts with two spaces so it nests under
// the relation/definition heading and remains greppable.
function formatCheck(check) {
  const status = check.ok ? 'pass' : 'fail';
  const lines = [`  - ${check.kind}: ${status}`];
  for (const diag of check.diagnostics) {
    lines.push(`      ${diag.code || ''} ${diag.message}`.trimEnd());
  }
  return lines;
}

// Format the full report. The CLI uses this; library callers can either
// consume the structured result directly or call this helper for parity.
function formatReport(report) {
  const lines = [];
  for (const diag of report.evaluation.diagnostics) {
    lines.push(formatDiagnostic(diag));
  }
  if (report.relations.length === 0 && report.definitions.length === 0) {
    lines.push('No metatheorem candidates found (no `(mode ...)` or `(define ...)` declarations).');
    return lines.join('\n');
  }
  if (report.relations.length > 0) {
    lines.push('Relations:');
    for (const rel of report.relations) {
      const status = rel.ok ? 'OK' : 'FAIL';
      lines.push(`  ${status}: ${rel.name}`);
      for (const check of rel.checks) {
        lines.push(...formatCheck(check));
      }
    }
  }
  if (report.definitions.length > 0) {
    lines.push('Definitions:');
    for (const def of report.definitions) {
      const status = def.ok ? 'OK' : 'FAIL';
      lines.push(`  ${status}: ${def.name}`);
      for (const check of def.checks) {
        lines.push(...formatCheck(check));
      }
    }
  }
  lines.push(report.ok
    ? 'All metatheorems hold.'
    : 'One or more metatheorems failed.');
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length !== 1 || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write('Usage: rml-meta <program.lino>\n');
    return args[0] === '-h' || args[0] === '--help' ? 0 : 2;
  }
  const file = args[0];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    process.stderr.write(`Error reading ${file}: ${e.message}\n`);
    return 1;
  }
  const report = checkMetatheorems(text, { file });
  const formatted = formatReport(report);
  if (report.ok) {
    process.stdout.write(formatted + '\n');
    return 0;
  }
  process.stderr.write(formatted + '\n');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}

export { checkMetatheorems, formatReport };
