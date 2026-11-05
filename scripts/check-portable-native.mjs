#!/usr/bin/env node
// External oracles for the portable fragment. Compiler success is not RML proof authority.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { translatePortableNatural } from '../js/src/rml-portable-natural.mjs';
const corpus = JSON.parse(readFileSync(new URL('../test-corpus/portable-natural/cases.json', import.meta.url), 'utf8'));
const required = new Set(process.argv.filter(arg => arg.startsWith('--require=')).flatMap(arg => arg.slice(10).split(',')));
const directory = mkdtempSync(join(tmpdir(), 'rml-portable-native-'));
const versions = { JavaScript: process.version };
const commands = { Rust: process.env.RUSTC ?? 'rustc', Lean: process.env.LEAN ?? 'lean', Rocq: process.env.ROCQ ?? process.env.COQC ?? 'rocq' };
let rocqPrefix = process.env.COQC && !process.env.ROCQ ? [] : ['compile'];
const checks = []; const negativeChecks = []; const skipped = [];
const sourceHashes = Object.fromEntries([
  'js/src/rml-portable-natural.mjs', 'rust/src/portable_natural.rs',
  'js/src/rml-meta-language.mjs', 'js/src/rml-meta-structure.mjs',
  'rust/src/meta_language_support.rs', 'rust/src/meta_language_structure.rs',
  'test-corpus/portable-natural/cases.json', 'scripts/check-portable-native.mjs',
].map(path => [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
try {
  for (const [language, command] of Object.entries(commands)) {
    let probe = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 20000 });
    if (language === 'Rocq' && probe.error?.code === 'ENOENT' && !process.env.ROCQ && !process.env.COQC) {
      commands.Rocq = 'coqc'; rocqPrefix = [];
      probe = spawnSync(commands.Rocq, ['--version'], { encoding: 'utf8', timeout: 20000 });
    }
    if (probe.error || probe.status !== 0) skipped.push({ language, reason: probe.error?.message ?? probe.stderr ?? 'version probe failed' });
    else versions[language] = (probe.stdout || probe.stderr).trim().split('\n')[0];
  }
  for (const [from, source] of Object.entries(corpus.sources)) for (const to of Object.keys(corpus.sources)) {
    if (from === to || !versions[to]) continue;
    const translated = translatePortableNatural(source, from, to);
    if (translated.status !== 'translated-fragment') throw new Error(`Unexpected unsupported ${from} to ${to}`);
    const prefix = `${from.toLowerCase()}-${to.toLowerCase()}`;
    if (to === 'JavaScript') {
      for (const vector of corpus.vectors) {
        const result = vm.runInNewContext(translated.targetSource + `\n${vector.function}(${vector.arguments.join(',')})`, Object.create(null), { timeout: 1000 });
        if (String(result) !== vector.expected) throw new Error(`JavaScript result mismatch ${from}`);
      }
    } else if (to === 'Rust') {
      const path = join(directory, `${prefix}.rs`); const binary = join(directory, prefix);
      writeFileSync(path, translated.targetSource + '\nfn main() {\n' + corpus.vectors.map(vector => `assert_eq!(${vector.function}(${vector.arguments.join(', ')}), ${vector.expected}u64);`).join('\n') + '\n}\n');
      run(commands.Rust, ['--edition=2021', '--crate-name', 'rml_portable_check', path, '-o', binary]); run(binary, []);
    } else if (to === 'Lean') {
      const path = join(directory, `${prefix}.lean`);
      writeFileSync(path, translated.targetSource + corpus.vectors.map(vector => `#eval ${vector.function} ${vector.arguments.join(' ')}`).join('\n') + '\n');
      const numbers = run(commands.Lean, [path]).split(/\r?\n/).filter(line => /^\d+$/.test(line.trim()));
      if (JSON.stringify(numbers) !== JSON.stringify(corpus.vectors.map(vector => vector.expected))) throw new Error(`Lean result mismatch ${from}: ${numbers}`);
    } else {
      const path = join(directory, `${prefix.replaceAll('-', '_')}.v`);
      // Reflect Nat equality into a boolean before reduction: this proves the
      // identical observation without a huge unary-normal-form equality goal.
      writeFileSync(path, translated.targetSource + corpus.vectors.map((vector, index) =>
        `Example rml_portable_check_${index} : ${vector.function} ${vector.arguments.join(' ')} = ${vector.expected}. Proof. apply Nat.eqb_eq. vm_compute. reflexivity. Qed.`).join('\n') + '\n');
      run(commands.Rocq, [...rocqPrefix, path]);
      // A compiler invocation is an oracle only if it rejects a false observation
      // of the same translated, multi-function program. Do not accept a timeout,
      // signal, missing library, or unrelated compiler failure as proof rejection.
      const falsePath = join(directory, `${prefix.replaceAll('-', '_')}_false.v`);
      writeFileSync(falsePath, translated.targetSource +
        'Example rml_portable_false_observation : rml_guard 3 5 = 16. Proof. apply Nat.eqb_eq. vm_compute. reflexivity. Qed.\n');
      const rejected = spawnSync(commands.Rocq, [...rocqPrefix, falsePath], { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      const diagnostic = `${rejected.stdout ?? ''}\n${rejected.stderr ?? ''}`;
      if (rejected.error || rejected.signal || rejected.status === null || rejected.status === 0 || !/Unable to unify/.test(diagnostic)) {
        throw new Error(`Rocq failed to reject a false observation for ${from}: ${rejected.error?.message ?? diagnostic}`);
      }
      negativeChecks.push({ sourceLanguage: from, targetLanguage: to, status: 'rejected-false-observation',
        expression: 'rml_guard 3 5', correctResult: '15', rejectedResult: '16', exitCode: rejected.status });
    }
    checks.push({ sourceLanguage: from, targetLanguage: to, status: 'passed', observations: corpus.vectors.length });
  }
  const missingRequired = [...required].filter(language => !versions[language]);
  console.log(JSON.stringify({ schema: 'rml:portable-native-results:1', status: missingRequired.length ? 'failed-required-oracle' : skipped.length ? 'passed-available-oracles' : 'passed-all-oracles', versions, sourceHashes, checks, negativeChecks, skipped, missingRequired }, null, 2));
  if (missingRequired.length) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
