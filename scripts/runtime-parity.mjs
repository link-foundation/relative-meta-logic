#!/usr/bin/env node
// Repository-wide JavaScript/Rust runtime parity.
//
// Every RML source in the repository (examples/, lib/, experiments/ and
// test-corpus/, except the generated certified-translation corpus) runs
// through the JavaScript command line in five modes: plain evaluation,
// `--trace`, `extract js`, `extract rust` and `export rocq`. The exit status,
// stdout and stderr of each run are recorded in
// test-corpus/runtime-parity/observations.json. The JavaScript test checks
// that the record is what the JavaScript CLI prints today, and
// rust/tests/runtime_parity_tests.rs runs the Rust `rml` binary over the same
// sources and modes and compares it with the same record, so the two
// runtimes are held to one observable behaviour. `--rust-bin <path>` compares
// a built Rust binary directly.
//
// Usage:
//   node scripts/runtime-parity.mjs --write      regenerate the record
//   node scripts/runtime-parity.mjs              check the record is fresh
//   node scripts/runtime-parity.mjs --rust-bin rust/target/debug/rml
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PARITY_SCHEMA = 'rml-runtime-parity/v1';
export const OBSERVATIONS_PATH = 'test-corpus/runtime-parity/observations.json';
export const JS_CLI = 'js/src/rml-links.mjs';
/** Streams up to this many bytes are stored verbatim; longer ones by digest. */
export const INLINE_LIMIT = 4096;
/** Absolute paths of the checkout print as this token in every recorded stream. */
export const ROOT_TOKEN = '<root>';
export const PARITY_ROOTS = ['examples', 'experiments', 'lib', 'test-corpus'];
/** Directories whose `.lino` files are generated certificates, checked by their own mirrored suites. */
export const EXCLUDED_DIRECTORIES = ['test-corpus/certified-translation'];
export const MODES = [
  { id: 'run', args: [] },
  { id: 'trace', args: ['--trace'] },
  { id: 'extract-js', args: ['extract', 'js'] },
  { id: 'extract-rust', args: ['extract', 'rust'] },
  { id: 'export-rocq', args: ['export', 'rocq'] },
];

export const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Every repository RML source the parity record covers, sorted. */
export function parityInputs(root = ROOT) {
  const inputs = [];
  const walk = directory => {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.includes(path)) walk(path);
      } else if (entry.isFile() && entry.name.endsWith('.lino') && entry.name !== 'expected.lino') {
        inputs.push(path);
      }
    }
  };
  for (const directory of PARITY_ROOTS) walk(directory);
  return inputs.sort();
}

/** Replace the checkout's absolute path so a record is portable between machines. */
export function normalizeStream(text, root = ROOT) {
  return String(text ?? '').replace(/\r\n/g, '\n').split(root).join(ROOT_TOKEN);
}

/** A recorded stream: verbatim when short, otherwise its digest and length. */
export function recordStream(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  const record = { sha256: sha256(text), bytes };
  if (bytes <= INLINE_LIMIT) record.text = text;
  return record;
}

/** Run one command and resolve with its normalized observation. */
export function observe(command, args, { root = ROOT, timeoutMs = 120000 } = {}) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    const finish = (status, signal, error) => {
      clearTimeout(timer);
      resolvePromise({
        status: error ? `spawn error: ${error.message}` : signal ? `signal ${signal}` : status,
        stdout: normalizeStream(Buffer.concat(stdout).toString('utf8'), root),
        stderr: normalizeStream(Buffer.concat(stderr).toString('utf8'), root),
      });
    };
    child.on('error', error => finish(null, null, error));
    child.on('close', (status, signal) => finish(status, signal, null));
  });
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** Observe one runtime (a command prefix) over every input and mode. */
export async function observeRuntime(prefix, { root = ROOT, inputs = parityInputs(root), modes = MODES, concurrency = availableParallelism() } = {}) {
  const jobs = inputs.flatMap(input => modes.map(mode => ({ input, mode })));
  return mapLimit(jobs, concurrency, async ({ input, mode }) => {
    const [command, ...base] = prefix;
    const result = await observe(command, [...base, ...mode.args, input], { root });
    return { input, mode: mode.id, ...result };
  });
}

/** The committed record built from JavaScript observations. */
export function buildRecord(observations, { root = ROOT } = {}) {
  const inputs = [...new Set(observations.map(item => item.input))].sort();
  return {
    schema: PARITY_SCHEMA,
    cli: JS_CLI,
    modes: MODES.map(mode => ({ id: mode.id, args: mode.args })),
    inlineLimit: INLINE_LIMIT,
    rootToken: ROOT_TOKEN,
    inputs: inputs.map(input => ({ path: input, sha256: sha256(readFileSync(join(root, input), 'utf8')) })),
    observations: observations.map(item => ({
      input: item.input,
      mode: item.mode,
      status: item.status,
      stdout: recordStream(item.stdout),
      stderr: recordStream(item.stderr),
    })),
  };
}

export const recordJson = record => `${JSON.stringify(record, null, 2)}\n`;

export function readRecord(root = ROOT) {
  return JSON.parse(readFileSync(join(root, OBSERVATIONS_PATH), 'utf8'));
}

/** The first character at which two strings differ. */
export function firstDifference(expected, actual) {
  let index = 0;
  while (index < expected.length && index < actual.length && expected[index] === actual[index]) index++;
  return index;
}

function describeStream(name, expected, actual) {
  if (expected.text === undefined) {
    return `${name} differs: expected ${expected.bytes} bytes with sha256 ${expected.sha256}, got ${Buffer.byteLength(actual, 'utf8')} bytes with sha256 ${sha256(actual)}`;
  }
  const at = firstDifference(expected.text, actual);
  const window = text => JSON.stringify(text.slice(at, at + 160));
  return `${name} differs at character ${at}: expected ${window(expected.text)}, got ${window(actual)}`;
}

/** Problems between one recorded observation and one live observation. */
export function compareObservation(expected, actual) {
  const problems = [];
  if (expected.status !== actual.status) problems.push(`exit status differs: expected ${expected.status}, got ${actual.status}`);
  for (const stream of ['stdout', 'stderr']) {
    const recorded = expected[stream];
    if (recorded.sha256 !== sha256(actual[stream])) problems.push(describeStream(stream, recorded, actual[stream]));
  }
  return problems;
}

/** Problems between a record and live observations of one runtime. */
export function compareRecord(record, observations, { root = ROOT, inputs = parityInputs(root) } = {}) {
  const problems = [];
  if (record.schema !== PARITY_SCHEMA) problems.push(`schema: expected ${PARITY_SCHEMA}, got ${record.schema}`);
  const recordedInputs = record.inputs.map(item => item.path);
  const missing = inputs.filter(input => !recordedInputs.includes(input));
  const extra = recordedInputs.filter(input => !inputs.includes(input));
  for (const input of missing) problems.push(`${input}: not in the parity record`);
  for (const input of extra) problems.push(`${input}: recorded but no longer present`);
  for (const item of record.inputs) {
    const path = join(root, item.path);
    if (existsSync(path) && sha256(readFileSync(path, 'utf8')) !== item.sha256) problems.push(`${item.path}: source changed since it was recorded`);
  }
  const live = new Map(observations.map(item => [`${item.input}\u0000${item.mode}`, item]));
  const expectedModes = MODES.map(mode => mode.id);
  const recordedModes = (record.modes ?? []).map(mode => mode.id);
  if (JSON.stringify(recordedModes) !== JSON.stringify(expectedModes)) problems.push(`modes: expected ${expectedModes.join(', ')}, got ${recordedModes.join(', ')}`);
  const seen = new Set();
  for (const expected of record.observations) {
    const key = `${expected.input}\u0000${expected.mode}`;
    if (seen.has(key)) problems.push(`${expected.input} [${expected.mode}]: recorded twice`);
    seen.add(key);
    const actual = live.get(key);
    if (!actual) continue;
    for (const problem of compareObservation(expected, actual)) problems.push(`${expected.input} [${expected.mode}]: ${problem}`);
  }
  for (const input of recordedInputs) {
    for (const mode of expectedModes) {
      if (!seen.has(`${input}\u0000${mode}`)) problems.push(`${input} [${mode}]: no recorded observation`);
    }
  }
  return problems;
}

function parseArgs(argv) {
  const options = { write: false, rustBin: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') options.write = true;
    else if (argv[i] === '--rust-bin' && argv[i + 1]) options.rustBin = resolve(ROOT, argv[++i]);
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const javascript = await observeRuntime([process.execPath, JS_CLI]);
  if (options.write) {
    const record = buildRecord(javascript);
    writeFileSync(join(ROOT, OBSERVATIONS_PATH), recordJson(record));
    console.log(`Recorded ${record.observations.length} observations over ${record.inputs.length} sources.`);
    return 0;
  }
  const record = readRecord();
  const problems = compareRecord(record, javascript).map(problem => `JavaScript: ${problem}`);
  if (options.rustBin) {
    const rust = await observeRuntime([options.rustBin]);
    problems.push(...compareRecord(record, rust).map(problem => `Rust: ${problem}`));
  }
  if (problems.length > 0) {
    console.error(`Runtime parity failed (${problems.length}):\n${problems.join('\n')}\nRegenerate after an intended change: node scripts/runtime-parity.mjs --write`);
    return 1;
  }
  console.log(`Runtime parity holds for ${record.observations.length} observations over ${record.inputs.length} sources${options.rustBin ? ' in both runtimes' : ''}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, error => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}

