#!/usr/bin/env node
/** Emit and validate supported-reference fixtures using external compilers as oracles. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { referenceExportFixtures } from './reference-export-fixtures.mjs';
import { assertNativeKernelVersion } from './check-orientation-independence.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const language = option('language');
const runtime = option('runtime') || 'js';
const prepareOnly = args.includes('--prepare-only');
const validatePrepared = args.includes('--validate-prepared');
if (!['js', 'rust'].includes(runtime)) throw new Error('Runtime must be js or rust');
if (runtime === 'rust' && !['Lean', 'Rocq'].includes(language)) throw new Error('Rust public exporters support Lean and Rocq only; Isabelle remains JavaScript-only');
if (prepareOnly && validatePrepared) throw new Error('Preparation and prepared validation are separate operations');
const cacheRoot = path.resolve(root, '.rml-cache/compiler');
const requestedOutput = option('output') || process.env.RML_REFERENCE_OUTPUT;
if (validatePrepared && !requestedOutput) throw new Error('Prepared validation requires the exact --output directory or RML_REFERENCE_OUTPUT');
// The normal lifecycle supplies a fresh private compiler directory. Raw emission
// also receives a fresh directory; it never reuses a shared default pathname.
const producerOutput = process.env.RML_CACHE_OUTPUT_DIR;
if (!requestedOutput && producerOutput && !path.resolve(producerOutput).startsWith(cacheRoot + path.sep)) throw new Error('Reference oracles require --isolate-output .rml-cache/compiler or an explicit --output inside that private compiler directory');
ensureOutputDirectory(cacheRoot);
const directory = path.resolve(requestedOutput || (producerOutput
  ? path.join(producerOutput, 'reference-exports', language || 'emitted')
  : fs.mkdtempSync(path.join(cacheRoot, 'reference-exports-'))));
if (directory !== cacheRoot && !directory.startsWith(cacheRoot + path.sep)) throw new Error('Reference compiler artifacts must stay under the registered .rml-cache/compiler root');
// Check every component before creating children; recursive mkdir alone can follow
// an existing link before a later realpath check gets a chance to reject it.
function ensureOutputDirectory(target) {
  target = path.resolve(target);
  if (target !== cacheRoot && !target.startsWith(cacheRoot + path.sep)) throw new Error('Reference compiler artifacts must stay inside their registered cache');
  let current = path.resolve(root);
  for (const component of path.relative(current, target).split(path.sep)) {
    current = path.join(current, component);
    let stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat) { fs.mkdirSync(current); stat = fs.lstatSync(current); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Reference compiler output directory cannot be a symlink or non-directory: ${current}`);
  }
}
function writeOutput(filename, contents) {
  ensureOutputDirectory(path.dirname(filename));
  const previous = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (previous && (previous.isSymbolicLink() || !previous.isFile() || previous.nlink !== 1)) throw new Error(`Reference compiler output file must be a regular single-link file: ${filename}`);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1) throw new Error(`Reference compiler output file must be a regular single-link file: ${filename}`);
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, contents);
  } finally { fs.closeSync(fd); }
}
ensureOutputDirectory(directory);
const reportDirectory = path.join(directory, 'report', ...(runtime === 'rust' ? ['Rust'] : []));
ensureOutputDirectory(reportDirectory);
function readOutput(filename) {
  ensureOutputDirectory(path.dirname(filename));
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error(`Reference compiler input must be a regular single-link file: ${filename}`);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
}
const hash = data => createHash('sha256').update(data).digest('hex');
const sourcePins = Object.fromEntries(['manifest.json', 'rust-manifest.json', 'configuration-manifest.json'].map(name => [name, hash(fs.readFileSync(path.join(root, 'lib/linked-runtime', name)))]));
const receiptFilename = path.join(directory, runtime === 'rust' ? 'receipt-rust.json' : 'receipt.json');
const selected = language ? [language] : ['Lean', 'Rocq', 'Isabelle'];
const kinds = ['positive', 'false_capture', 'false_rebind'];
const relativeCase = (name, kind) => path.join(...(runtime === 'rust' ? ['Rust'] : []), name, kind);
const filenameFor = name => name === 'Isabelle' ? 'Reference_Exports.thy' : `Reference_Exports.${name === 'Lean' ? 'lean' : 'v'}`;
let fixtures = referenceExportFixtures();
let producer = { runtime: runtime === 'rust' ? 'Rust' : 'JavaScript' };
function rustBinary() {
  const binary = path.resolve(option('rust-binary') || path.join(process.env.CARGO_TARGET_DIR || path.join(root, 'rust/target'), 'debug/rml'));
  if (!binary.startsWith(path.resolve(root) + path.sep) || fs.realpathSync(binary) !== binary || !fs.statSync(binary).isFile()) throw new Error('Rust exporter must be a regular executable built inside this repository');
  return binary;
}
if (runtime === 'rust' && !validatePrepared) {
  const binary = rustBinary();
  writeOutput(path.join(directory, 'input.lino'), fixtures.source);
  const output = path.join(directory, 'Rust', language, `export-base.${language === 'Lean' ? 'lean' : 'v'}`);
  writeOutput(output, '');
  const argv = ['export', language.toLowerCase(), path.join(directory, 'input.lino'), '-o', output];
  const run = spawnSync(binary, argv, { cwd: root, env: process.env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  writeOutput(path.join(reportDirectory, 'rust-exporter.log'), `${run.stdout || ''}${run.stderr || ''}`);
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Rust ${language} public exporter failed with status ${run.status}`);
  const rendered = readOutput(output);
  fixtures = referenceExportFixtures({ [language]: rendered });
  producer = { runtime: 'Rust', binary: path.relative(root, binary), ...(binary.startsWith(directory + path.sep) ? { outputBinary: path.relative(directory, binary).split(path.sep).join('/') } : {}), binarySha256: hash(fs.readFileSync(binary)), emittedSourceSha256: hash(rendered), command: ['rml', 'export', language.toLowerCase(), 'input.lino', '-o', path.relative(directory, output)] };
  writeOutput(path.join(reportDirectory, `export-base.${language === 'Lean' ? 'lean' : 'v'}`), rendered);
}
let receipt;
if (validatePrepared) {
  receipt = JSON.parse(readOutput(receiptFilename));
  if (receipt.schema !== 'rml-reference-compiler/v2' || receipt.producer.runtime !== producer.runtime || receipt.inputSha256 !== hash(fixtures.source) || JSON.stringify(receipt.sourcePins) !== JSON.stringify(sourcePins) || JSON.stringify(Object.keys(receipt.languages)) !== JSON.stringify(selected)) throw new Error('Prepared compiler fixture does not match the selected runtime and current source authority');
  if (hash(readOutput(path.join(directory, 'input.lino'))) !== receipt.inputSha256) throw new Error('Prepared RML input hash mismatch');
  if (runtime === 'rust') {
    const binary = rustBinary();
    // A bundled executable keeps its exact path within the prepared output even
    // when a container mounts that directory at a different repository alias.
    const bundled = receipt.producer.outputBinary;
    const samePath = bundled === undefined
      ? receipt.producer.binary === path.relative(root, binary)
      : typeof bundled === 'string' && !path.isAbsolute(bundled) && !bundled.includes('\\') && !bundled.split('/').some(part => !part || part === '.' || part === '..') &&
        binary.startsWith(directory + path.sep) && bundled === path.relative(directory, binary).split(path.sep).join('/');
    if (!samePath || receipt.producer.binarySha256 !== hash(fs.readFileSync(binary))) throw new Error('Prepared Rust producer binary hash mismatch');
  }
  for (const name of selected) {
    const cases = receipt.languages[name].cases;
    if (JSON.stringify(Object.keys(cases)) !== JSON.stringify(kinds)) throw new Error('Prepared compiler cases are incomplete');
    for (const kind of kinds) {
      const entry = cases[kind], relative = relativeCase(name, kind);
      if (entry.directory !== relative || hash(readOutput(path.join(directory, relative, filenameFor(name)))) !== entry.sha256) throw new Error(`Prepared compiler source hash mismatch: ${name} ${kind}`);
      delete entry.passed; delete entry.observed; delete entry.exitCode;
    }
    receipt.languages[name].status = 'emitted-only-not-native-validated';
  }
  receipt.status = 'emitted-only-not-native-validated';
} else {
  writeOutput(path.join(directory, 'input.lino'), fixtures.source);
  writeOutput(path.join(directory, 'reference-mappings.json'), JSON.stringify(fixtures.mappings, null, 2) + '\n');
  writeOutput(path.join(reportDirectory, 'input.lino'), fixtures.source);
  writeOutput(path.join(reportDirectory, 'reference-mappings.json'), JSON.stringify(fixtures.mappings, null, 2) + '\n');
  receipt = { schema: 'rml-reference-compiler/v2', status: 'emitted-only-not-native-validated', producer, sourcePins, references: fixtures.mappings.length, inputSha256: hash(fixtures.source), languages: {} };
  for (const name of selected) {
    if (!fixtures[name]) throw new Error(`Unknown language ${name}`);
    const fixture = fixtures[name];
    const cases = { positive: fixture.positive, false_capture: fixture.negative, false_rebind: fixture.reboundNegative };
    const result = receipt.languages[name] = { status: 'emitted-only-not-native-validated', cases: {} };
    for (const [kind, source] of Object.entries(cases)) {
      const relative = relativeCase(name, kind), caseDirectory = path.join(directory, relative);
      ensureOutputDirectory(caseDirectory);
      const filename = filenameFor(name);
      writeOutput(path.join(caseDirectory, filename), source);
      writeOutput(path.join(reportDirectory, name, kind, filename), source);
      if (name === 'Isabelle') writeOutput(path.join(caseDirectory, 'ROOT'), 'session Reference_Exports = HOL +\n  options [document = false]\n  theories Reference_Exports\n');
      result.cases[kind] = { sha256: hash(source), directory: relative, expected: kind === 'positive' ? 'accepted' : 'proof-rejected' };
    }
  }
}
function writeReceipt() {
  const text = JSON.stringify(receipt, null, 2) + '\n';
  writeOutput(receiptFilename, text);
  writeOutput(path.join(reportDirectory, 'receipt.json'), text);
}
writeReceipt();
if (!language || prepareOnly) { console.log(JSON.stringify({ ...receipt, directory })); process.exit(0); }
const compiler = option('compiler') || ({ Lean: 'lean', Rocq: 'rocq', Isabelle: 'isabelle' })[language];
const env = { ...process.env };
if (language === 'Isabelle') {
  env.USER_HOME = path.join(directory, 'isabelle-user'); env.TMPDIR = path.join(directory, 'isabelle-tmp');
  ensureOutputDirectory(env.USER_HOME); ensureOutputDirectory(env.TMPDIR);
}
function execute(argv, cwd, tag) {
  if (runtime === 'rust') tag = `Rust-${tag}`;
  const run = spawnSync(compiler, argv, { cwd, env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
  writeOutput(path.join(directory, `${tag}.log`), `${run.stdout || ''}${run.stderr || ''}`);
  writeOutput(path.join(reportDirectory, `${tag}.log`), `${run.stdout || ''}${run.stderr || ''}`);
  if (run.error) throw run.error;
  return { status: run.status, text: `${run.stdout || ''}${run.stderr || ''}` };
}
try {
  const version = execute([language === 'Isabelle' ? 'version' : '--version'], directory, 'compiler-version');
  if (version.status !== 0) throw new Error(`${language} version probe failed`);
  if (language === 'Isabelle') {
    if (!/^Isabelle2025-2\s*$/m.test(version.text)) throw new Error('Expected exact Isabelle2025-2 compiler');
  } else assertNativeKernelVersion(language, version.text);
  receipt.languages[language].version = version.text.trim();
  if (language === 'Isabelle') {
    const settings = execute(['getenv', '-b', 'USER_HOME', 'ISABELLE_HOME_USER', 'ISABELLE_HEAPS', 'ISABELLE_BROWSER_INFO', 'ISABELLE_TMP_PREFIX'], directory, 'isabelle-cache-locations');
    const locations = settings.text.trim().split('\n');
    if (settings.status !== 0 || locations.length !== 5 || locations.some(location => !path.resolve(location).startsWith(directory + path.sep))) throw new Error('Isabelle generated directories must all remain inside its registered repository cache');
  }
  for (const [kind, entry] of Object.entries(receipt.languages[language].cases)) {
    const cwd = path.join(directory, entry.directory);
    const argv = language === 'Lean' ? ['Reference_Exports.lean'] : language === 'Rocq' ? ['compile', 'Reference_Exports.v'] : ['build', '-D', cwd, '-j', '1', '-o', 'threads=1'];
    const run = execute(argv, cwd, `${language}-${kind}`);
    const proofError = { Lean: /rfl|reflexiv|unsolved goals|type mismatch/i, Rocq: /unable to unify|not convertible|reflexiv/i, Isabelle: /failed to finish proof|failed to apply|unfinished.*proof|unsolved goal/i }[language];
    const passed = kind === 'positive' ? run.status === 0 : run.status !== 0 && proofError.test(run.text);
    Object.assign(entry, { exitCode: run.status, observed: run.status === 0 ? 'accepted' : 'rejected', passed });
    writeReceipt();
    if (!passed) throw new Error(`${language} ${kind} did not meet its compiler control`);
  }
  receipt.languages[language].status = 'native-validated'; receipt.status = 'native-validated'; writeReceipt();
  console.log(JSON.stringify({ ...receipt, directory }));
} catch (error) {
  receipt.status = 'failed'; receipt.error = error.message; writeReceipt(); throw error;
}
