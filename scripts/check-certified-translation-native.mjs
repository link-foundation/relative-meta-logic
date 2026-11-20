#!/usr/bin/env node
// Native-validity oracles for the certified translation corpus. Each committed
// target is compiled or checked by its own toolchain and run; its printed lines
// must equal the RML observation recorded in the certificate. Each hand-written
// source is also run natively against its hand-written lines. Kernel or
// compiler acceptance is oracle evidence only: it never changes a certificate
// obligation, and this script is meant for CI (do not run toolchains locally
// when the repository policy forbids it).
//
// Usage: node scripts/check-certified-translation-native.mjs
//   [--languages=JavaScript,Rust,Lean,Rocq] [--require=...] [--output=FILE]
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CERTIFIED_EXTENSIONS, CERTIFIED_LANGUAGES, readLinksDocument } from '../js/src/rml-certified-translation.mjs';
import { CORPUS_DIRECTORY, GENERATED_DIRECTORY, readCertifiedCorpus } from './generate-certified-translations.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const languages = new Set((option('languages') ?? CERTIFIED_LANGUAGES.join(',')).split(',').filter(Boolean));
const required = new Set((option('require') ?? '').split(',').filter(Boolean));
const output = option('output');
const directory = mkdtempSync(join(tmpdir(), 'rml-certified-native-'));
const commands = { JavaScript: process.execPath, Rust: process.env.RUSTC ?? 'rustc', Lean: process.env.LEAN ?? 'lean', Rocq: process.env.ROCQ ?? process.env.COQC ?? 'rocq' };
let rocqPrefix = process.env.COQC && !process.env.ROCQ ? [] : ['compile'];
const versions = {}; const skipped = []; const checks = []; const sourceChecks = []; const failures = []; const negativeChecks = [];
const sha256 = text => createHash('sha256').update(text).digest('hex');

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${command} ${args.join(' ')}: ${result.error?.message ?? `${result.stderr}\n${result.stdout}`}`);
  return result;
}
const lines = text => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

/** Rocq prints `= ["a"%string; "b"%string]%list : list string`; read the string literals of the last value. */
function rocqLines(stdout) {
  const start = stdout.lastIndexOf('= ');
  const end = stdout.indexOf(': list string', start);
  if (start < 0 || end < 0) throw new Error(`Rocq printed no list of strings: ${stdout}`);
  return [...stdout.slice(start, end).matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
}

function observe(target, file) {
  if (target === 'JavaScript') return lines(run(commands.JavaScript, [file]).stdout);
  if (target === 'Rust') {
    const binary = file.replace(/\.rs$/, '');
    run(commands.Rust, ['--edition=2024', '-O', '--crate-name', 'rml_certified_check', file, '-o', binary]);
    return lines(run(binary, []).stdout);
  }
  if (target === 'Lean') return lines(run(commands.Lean, ['--run', file]).stdout);
  return rocqLines(run(commands.Rocq, [...rocqPrefix, file]).stdout);
}

/** The oracle must reject a false closed statement appended to a real target, for the right reason. */
function negative(target, sourceText, name) {
  const extension = CERTIFIED_EXTENSIONS[target];
  const file = join(directory, `${name}_false.${extension}`);
  const statements = {
    Lean: ['\ntheorem rml_false_observation : (2 : Nat) + 2 = 5 := by decide\n', /decide|failed|false/i],
    Rocq: ['\nExample rml_false_observation : 2 + 2 = 5. Proof. reflexivity. Qed.\n', /Unable to unify|not convertible|cannot be applied/i],
    Rust: ['\nconst _: () = assert!(2 + 2 == 5);\n', /evaluation of constant value failed|assertion failed/i],
  };
  if (!statements[target]) return;
  const [statement, expected] = statements[target];
  writeFileSync(file, sourceText + statement);
  const args = target === 'Rust' ? ['--edition=2024', '--crate-name', 'rml_certified_false', file, '-o', file.replace(/\.rs$/, '')]
    : target === 'Lean' ? [file] : [...rocqPrefix, file];
  const result = run(commands[target], args, { allowFailure: true });
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const rejected = !result.error && !result.signal && result.status !== null && result.status !== 0 && expected.test(diagnostic);
  negativeChecks.push({ target, statement: statement.trim(), status: rejected ? 'rejected-false-statement' : 'not-rejected', exitCode: result.status });
  if (!rejected) failures.push({ target, reason: `the ${target} oracle did not reject a false statement`, diagnostic: diagnostic.slice(0, 2000) });
}

try {
  for (const language of languages) {
    if (language === 'JavaScript') { versions.JavaScript = process.version; continue; }
    let probe = spawnSync(commands[language], ['--version'], { encoding: 'utf8', timeout: 20000 });
    if (language === 'Rocq' && probe.error?.code === 'ENOENT' && !process.env.ROCQ && !process.env.COQC) {
      commands.Rocq = 'coqc'; rocqPrefix = [];
      probe = spawnSync(commands.Rocq, ['--version'], { encoding: 'utf8', timeout: 20000 });
    }
    if (probe.error || probe.status !== 0) skipped.push({ language, reason: probe.error?.message ?? probe.stderr ?? 'version probe failed' });
    else versions[language] = (probe.stdout || probe.stderr).trim().split('\n')[0];
  }
  const corpus = readCertifiedCorpus();
  const negatives = new Set();
  for (const item of corpus.translations) for (const target of CERTIFIED_LANGUAGES) {
    if (target === item.language || !languages.has(target) || !versions[target]) continue;
    const stem = `${item.name}/${target.toLowerCase()}`;
    const code = readFileSync(join(GENERATED_DIRECTORY, `${stem}.${CERTIFIED_EXTENSIONS[target]}`), 'utf8');
    const [certificate] = readLinksDocument(readFileSync(join(GENERATED_DIRECTORY, `${stem}.certificate.lino`), 'utf8'));
    const observation = certificate.find(entry => Array.isArray(entry) && entry[0] === 'observation');
    const expected = observation.filter(entry => Array.isArray(entry) && entry[0] === 'line').map(entry => entry[1]);
    const name = `${item.name.replaceAll('-', '_')}_${target.toLowerCase()}`;
    const file = join(directory, `${name}.${CERTIFIED_EXTENSIONS[target]}`);
    writeFileSync(file, code);
    try {
      const observed = observe(target, file);
      const status = JSON.stringify(observed) === JSON.stringify(expected) && JSON.stringify(expected) === JSON.stringify(item.lines) ? 'passed' : 'mismatch';
      checks.push({ case: item.name, sourceLanguage: item.language, targetLanguage: target, targetSha256: sha256(code), status, expected, observed });
      if (status !== 'passed') failures.push({ case: item.name, target, reason: 'observation mismatch', expected, observed });
    } catch (error) {
      checks.push({ case: item.name, sourceLanguage: item.language, targetLanguage: target, targetSha256: sha256(code), status: 'failed', error: error.message.slice(0, 4000) });
      failures.push({ case: item.name, target, reason: error.message.slice(0, 4000) });
    }
    if (!negatives.has(target)) { negatives.add(target); negative(target, code, name); }
  }
  // Source oracle: each hand-written source runs under its own toolchain and must print the
  // hand-written lines. This independently checks RML surface lowering (records, structures,
  // monomorphized type parameters), since the certified observation is of the lowered program.
  for (const item of corpus.translations) {
    if (!languages.has(item.language) || !versions[item.language]) continue;
    const code = readFileSync(join(CORPUS_DIRECTORY, item.source), 'utf8');
    const file = join(directory, `${item.name.replaceAll('-', '_')}_source.${CERTIFIED_EXTENSIONS[item.language]}`);
    writeFileSync(file, code);
    try {
      const observed = observe(item.language, file);
      const status = JSON.stringify(observed) === JSON.stringify(item.lines) ? 'passed' : 'mismatch';
      sourceChecks.push({ case: item.name, language: item.language, sourceSha256: sha256(code), status, expected: item.lines, observed });
      if (status !== 'passed') failures.push({ case: item.name, source: item.language, reason: 'source observation mismatch', expected: item.lines, observed });
    } catch (error) {
      sourceChecks.push({ case: item.name, language: item.language, sourceSha256: sha256(code), status: 'failed', error: error.message.slice(0, 4000) });
      failures.push({ case: item.name, source: item.language, reason: error.message.slice(0, 4000) });
    }
  }
  const missingRequired = [...required].filter(language => !versions[language]);
  const report = { schema: 'rml:certified-translation-native-results:1',
    status: failures.length || missingRequired.length ? 'failed' : skipped.length ? 'passed-available-oracles' : 'passed-all-oracles',
    authority: 'native toolchains are validity oracles; their acceptance does not discharge any RML certificate obligation',
    corpus: CORPUS_DIRECTORY.split('/').slice(-2).join('/'), versions, checks, sourceChecks, negativeChecks, skipped, missingRequired, failures };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, text);
  console.log(text);
  if (failures.length || missingRequired.length) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
