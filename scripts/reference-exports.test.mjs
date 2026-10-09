import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { referenceExportFixtures } from './reference-export-fixtures.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
test('native reference smoke fixtures record an injective mapping and independent negative controls', () => {
  const fixtures = referenceExportFixtures();
  for (const language of ['lean','rocq','isabelle','localIsabelle']) assert.equal(new Set(fixtures.mappings.map(row => row[language])).size, fixtures.mappings.length);
  for (const language of ['Lean','Rocq','Isabelle']) {
    assert.notEqual(fixtures[language].positive, fixtures[language].negative);
    assert.notEqual(fixtures[language].negative, fixtures[language].reboundNegative);
    assert.match(fixtures[language].positive, /left right/);
  }
});
test('artifact emission is explicitly recorded as not native-validated', () => {
  const output = path.join(root, '.rml-cache/compiler/reference-export-test');
  try {
    const child = spawnSync(process.execPath, ['scripts/check-reference-exports.mjs', `--output=${output}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(output, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, 'emitted-only-not-native-validated');
    assert.equal(receipt.references, 39);
    for (const language of ['Lean','Rocq','Isabelle']) {
      assert.deepEqual(Object.keys(receipt.languages[language].cases), ['positive','false_capture','false_rebind']);
      assert.equal(receipt.languages[language].status, 'emitted-only-not-native-validated');
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
test('CI runs all proof oracles with owned caches and archives before teardown', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/formal-corpus.yml'), 'utf8');
  for (const language of ['Lean','Rocq','Isabelle']) {
    assert.ok(workflow.includes(`--language=${language}`));
    assert.ok(workflow.includes(`--archive "{output}/reference-exports/${language}/report"`));
  }
  assert.match(workflow, /makarius\/isabelle:Isabelle2025-2@sha256:9bd33b183c399327c5d554fc8cde27c29b5d2b20cdc6fe7a604caa3f951018fc/);
  assert.match(workflow, /bash docker\/run-owned\.sh --init/);
  assert.match(workflow, /leanprover\/lean4:v4\.34\.1/);
  assert.match(workflow, /rocq\/rocq-prover:9\.3@sha256:c357e8864f80359db21725ea8371347a75a1cb439545b47219d7ad5683ba1782/);
  assert.doesNotMatch(workflow, /chown[^\n]*RML_CACHE_OUTPUT_DIR|chmod|--archive \.rml-cache\/compiler/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
  const driver = fs.readFileSync(path.join(root, 'scripts/check-reference-exports.mjs'), 'utf8');
  assert.match(driver, /env\.USER_HOME/);
  assert.doesNotMatch(driver, /env\.HOME\s*=/);
  assert.match(driver, /ISABELLE_HEAPS/);
  assert.match(driver, /ISABELLE_BROWSER_INFO/);
  assert.match(driver, /assertNativeKernelVersion/);
});

test('oracle outputs reject existing report and case-file symlinks without touching their targets', { skip: process.platform === 'win32' }, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(root, '.rml-cache/compiler/reference-symlink-test-'));
  try {
    for (const [index, relative, directoryLink] of [
      [0, 'report', true],
      [1, 'report/receipt.json', false],
      [2, 'Lean/positive/Reference_Exports.lean', false],
    ]) {
      const output = path.join(fixtureRoot, `output-${index}`);
      const target = path.join(fixtureRoot, `untouched-${index}`);
      const linked = path.join(output, relative);
      fs.mkdirSync(path.dirname(linked), { recursive: true });
      if (directoryLink) fs.mkdirSync(target);
      else fs.writeFileSync(target, 'untouched fixture');
      fs.symlinkSync(target, linked, directoryLink ? 'dir' : 'file');
      const child = spawnSync(process.execPath, ['scripts/check-reference-exports.mjs', `--output=${output}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
      assert.notEqual(child.status, 0);
      assert.match(child.stderr, /symlink|regular single-link file/);
      if (directoryLink) assert.deepEqual(fs.readdirSync(target), []);
      else assert.equal(fs.readFileSync(target, 'utf8'), 'untouched fixture');
      assert.ok(fs.lstatSync(linked).isSymbolicLink());
    }
  } finally { fs.rmSync(fixtureRoot, { recursive: true, force: true }); }
});

test('compiler obligations compose with the selected native exporter output', () => {
  const fixtures = referenceExportFixtures({ Lean: '-- Native Lean body\n', Rocq: '(* Native Rocq body *)\n' });
  for (const [language, prefix] of [['Lean', '-- Native Lean body'], ['Rocq', '(* Native Rocq body *)']]) {
    for (const field of ['positive', 'negative', 'reboundNegative']) assert.ok(fixtures[language][field].startsWith(prefix));
    assert.notEqual(fixtures[language].positive, fixtures[language].negative);
    assert.notEqual(fixtures[language].negative, fixtures[language].reboundNegative);
  }
});

test('prepared compiler artifacts reject source tampering before invoking a compiler', () => {
  fs.mkdirSync(path.join(root, '.rml-cache/compiler'), { recursive: true });
  const output = fs.mkdtempSync(path.join(root, '.rml-cache/compiler/reference-prepared-test-'));
  try {
    const prepared = spawnSync(process.execPath, ['scripts/check-reference-exports.mjs', '--language=Lean', '--prepare-only', `--output=${output}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(prepared.status, 0, prepared.stderr);
    fs.appendFileSync(path.join(output, 'Lean/positive/Reference_Exports.lean'), '\n-- changed after preparation\n');
    const checked = spawnSync(process.execPath, ['scripts/check-reference-exports.mjs', '--language=Lean', '--validate-prepared', '--compiler=/definitely-missing-compiler', `--output=${output}`], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Prepared compiler source hash mismatch/);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('Rust preparation records the public CLI contract and rejects a changed producer', () => {
  fs.mkdirSync(path.join(root, '.rml-cache/compiler'), { recursive: true });
  const output = fs.mkdtempSync(path.join(root, '.rml-cache/compiler/reference-rust-driver-test-'));
  const binary = path.join(output, 'mock-rml');
  try {
    // This is an orchestration unit mock, not native Rust or Lean validation.
    fs.writeFileSync(binary, '#!/usr/bin/env node\n' +
      "const fs = require('node:fs'); const a = process.argv.slice(2);\n" +
      "if (a[0] !== 'export' || a[1] !== 'lean' || a[3] !== '-o') process.exit(9);\n" +
      "if (!fs.readFileSync(a[2], 'utf8').includes('choose-collision')) process.exit(10);\n" +
      "fs.writeFileSync(a[4], '-- Mock public Rust CLI body for orchestration test only\\n');\n", { mode: 0o700 });
    const common = ['scripts/check-reference-exports.mjs', '--language=Lean', '--runtime=rust', `--rust-binary=${binary}`, `--output=${output}`];
    const prepared = spawnSync(process.execPath, [...common, '--prepare-only'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(prepared.status, 0, prepared.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(output, 'receipt-rust.json'), 'utf8'));
    assert.equal(receipt.status, 'emitted-only-not-native-validated');
    assert.equal(receipt.producer.runtime, 'Rust');
    assert.match(receipt.producer.binarySha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(receipt.producer.command.slice(0, 3), ['rml', 'export', 'lean']);
    for (const kind of ['positive', 'false_capture', 'false_rebind']) {
      const source = fs.readFileSync(path.join(output, 'Rust/Lean', kind, 'Reference_Exports.lean'), 'utf8');
      assert.ok(source.startsWith('-- Mock public Rust CLI body'));
      assert.ok(fs.existsSync(path.join(output, 'report/Rust/Lean', kind, 'Reference_Exports.lean')));
    }
    fs.appendFileSync(binary, '\n// changed producer\n');
    const checked = spawnSync(process.execPath, [...common, '--validate-prepared', '--compiler=/definitely-missing-compiler'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Prepared Rust producer binary hash mismatch/);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('CI validates both existing exporter runtimes and leaves Isabelle explicitly JavaScript-only', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/formal-corpus.yml'), 'utf8');
  assert.match(workflow, /cargo build --locked --manifest-path rust\/Cargo.toml --bin rml/);
  assert.match(workflow, /--language=Lean --runtime=rust/);
  assert.match(workflow, /--language=Rocq --runtime=rust .*--prepare-only/);
  assert.match(workflow, /--language=Rocq --runtime=rust --rust-binary=\/rml\/\.rml-cache\/compiler\/producer-rml --validate-prepared/);
  assert.doesNotMatch(workflow, /--language=Isabelle --runtime=rust/);
  const child = spawnSync(process.execPath, ['scripts/check-reference-exports.mjs', '--language=Isabelle', '--runtime=rust', '--prepare-only'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Isabelle remains JavaScript-only/);
});

function oracleLifecycleFixture(t) {
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rml oracle lifecycle ')));
  fs.mkdirSync(path.join(fixture, 'scripts'));
  for (const name of ['build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'run-with-cache.mjs', 'bootstrap.mjs', 'initialize-meta-language.mjs', 'check-reference-exports.mjs', 'check-orientation-independence.mjs', 'reference-export-fixtures.mjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(fixture, 'scripts', name));
  fs.mkdirSync(path.join(fixture, 'js'));
  fs.cpSync(path.join(root, 'js/src'), path.join(fixture, 'js/src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'js/package.json'), '{"name":"oracle-fixture","type":"module"}\n');
  fs.symlinkSync(fs.realpathSync(path.join(root, 'js/node_modules')), path.join(fixture, 'js/node_modules'), 'junction');
  fs.mkdirSync(path.join(fixture, 'rust'));
  fs.writeFileSync(path.join(fixture, 'rust/Cargo.toml'), '[package]\nname="fixture"\n');
  fs.mkdirSync(path.join(fixture, 'lib/linked-runtime'), { recursive: true });
  for (const name of ['manifest.json', 'rust-manifest.json', 'configuration-manifest.json']) fs.copyFileSync(path.join(root, 'lib/linked-runtime', name), path.join(fixture, 'lib/linked-runtime', name));
  fs.mkdirSync(path.join(fixture, 'test-corpus/lino-frontend'), { recursive: true });
  fs.copyFileSync(path.join(root, 'test-corpus/lino-frontend/reference-literals.json'), path.join(fixture, 'test-corpus/lino-frontend/reference-literals.json'));
  fs.writeFileSync(path.join(fixture, '.gitignore'), '.rml-cache/\njs/node_modules\n');
  const git = (...args) => execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' });
  git('init', '-q'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Oracle fixture', '-c', 'user.email=oracle@example.invalid', 'commit', '-qm', 'fixture');
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const run = (command, env = {}) => spawnSync(process.execPath, command, { cwd: fixture, env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0', ...env }, encoding: 'utf8', timeout: 60000 });
  return { fixture, run };
}

for (const mode of ['controls', 'false-acceptance', 'compiler-error']) {
  test(`private oracle lifecycle archives exact controls and rejects ${mode}`, { skip: process.platform === 'win32' }, t => {
    const { fixture, run } = oracleLifecycleFixture(t);
    // This mock checks orchestration and exact negative-control classification;
    // native compiler correctness is checked separately by the pinned CI jobs.
    const compiler = path.join(fixture, 'mock-lean.cjs');
    fs.writeFileSync(compiler, `#!/usr/bin/env node\nconst fs=require('node:fs');
      if(process.argv[2]==='--version'){console.log('Lean (version 4.34.1)');process.exit(0)}
      const kind=require('node:path').basename(process.cwd());
      fs.appendFileSync('compiler-output.tmp','compiler temporary data');
      if(kind==='positive'||process.env.ORACLE_MODE==='false-acceptance')process.exit(0);
      console.error(process.env.ORACLE_MODE==='compiler-error'?'unrelated compiler crash':'unsolved goals: reflexivity failed');process.exit(1);`, { mode: 0o700 });
    fs.mkdirSync(path.join(fixture, '.rml-cache/compiler'), { recursive: true });
    fs.writeFileSync(path.join(fixture, '.rml-cache/compiler/user-note.txt'), 'concurrent user source');
    const result = run(['scripts/run-with-cache.mjs', '--isolate-output', '.rml-cache/compiler', '--archive', '{output}/reference-exports/Lean/report', '--', process.execPath, 'scripts/check-reference-exports.mjs', '--language=Lean', `--compiler=${compiler}`], { ORACLE_MODE: mode });
    assert.equal(result.status, mode === 'controls' ? 0 : 1, `${result.stdout}\n${result.stderr}`);
    const evidence = path.join(fixture, '.rml-cache/evidence');
    const receiptFile = fs.readdirSync(evidence).find(name => name.endsWith('.json'));
    const operation = JSON.parse(fs.readFileSync(path.join(evidence, receiptFile), 'utf8'));
    const archived = path.join(evidence, receiptFile.slice(0, -5), operation.isolatedOutput, 'reference-exports/Lean/report');
    const receipt = JSON.parse(fs.readFileSync(path.join(archived, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, mode === 'controls' ? 'native-validated' : 'failed');
    assert.equal(receipt.languages.Lean.cases.positive.passed, true);
    assert.equal(receipt.languages.Lean.cases.false_capture.passed, mode === 'controls');
    if (mode === 'controls') assert.equal(receipt.languages.Lean.cases.false_rebind.passed, true);
    assert.ok(fs.existsSync(path.join(archived, 'Lean/false_rebind/Reference_Exports.lean')));
    assert.equal(fs.existsSync(path.join(fixture, operation.isolatedOutput, 'reference-exports/Lean/receipt.json')), false);
    assert.equal(fs.existsSync(path.join(archived, 'Lean/positive/compiler-output.tmp')), false);
    assert.equal(fs.readFileSync(path.join(fixture, '.rml-cache/compiler/user-note.txt'), 'utf8'), 'concurrent user source');
  });
}

test('prepared Rust bundle validates after a mount alias while rejecting changed bytes, paths, symlinks and escape', { skip: process.platform === 'win32' }, t => {
  const { fixture, run } = oracleLifecycleFixture(t);
  const compilerRoot = path.join(fixture, '.rml-cache/compiler');
  fs.mkdirSync(compilerRoot, { recursive: true });
  const output = fs.mkdtempSync(path.join(compilerRoot, 'prepared-'));
  const binary = path.join(output, 'producer-rml');
  fs.writeFileSync(binary, '#!/usr/bin/env node\n' +
    "const fs=require('node:fs'),a=process.argv.slice(2);if(a[0]!=='export'||a[1]!=='lean'||a[3]!=='-o')process.exit(9);fs.writeFileSync(a[4],'-- Mock public Rust CLI source\\n');\n", { mode: 0o700 });
  const prepared = run(['scripts/check-reference-exports.mjs', '--language=Lean', '--runtime=rust', '--prepare-only', `--output=${output}`, `--rust-binary=${binary}`]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const original = JSON.parse(fs.readFileSync(path.join(output, 'receipt-rust.json'), 'utf8'));
  assert.equal(original.producer.outputBinary, 'producer-rml');
  const compiler = path.join(fixture, 'mock-lean.cjs');
  fs.writeFileSync(compiler, `#!/usr/bin/env node
    if(process.argv[2]==='--version'){console.log('Lean (version 4.34.1)');process.exit(0)}
    if(require('node:path').basename(process.cwd())==='positive')process.exit(0);
    console.error('unsolved goals: reflexivity failed');process.exit(1);`, { mode: 0o700 });
  for (const variant of ['valid', 'changed-bytes', 'wrong-path', 'symlink', 'escape']) {
    const mounted = fs.mkdtempSync(path.join(compilerRoot, `${variant}-`));
    fs.cpSync(output, mounted, { recursive: true });
    let selectedBinary = path.join(mounted, 'producer-rml');
    if (variant === 'changed-bytes') fs.appendFileSync(selectedBinary, '// changed producer\n');
    if (variant === 'wrong-path') {
      fs.copyFileSync(selectedBinary, path.join(mounted, 'another-rml'));
      selectedBinary = path.join(mounted, 'another-rml');
    }
    if (variant === 'symlink') {
      fs.unlinkSync(selectedBinary);
      fs.symlinkSync(binary, selectedBinary);
    }
    if (variant === 'escape') {
      const receipt = structuredClone(original);
      receipt.producer.outputBinary = '../producer-rml';
      fs.writeFileSync(path.join(mounted, 'receipt-rust.json'), JSON.stringify(receipt));
    }
    const checked = run(['scripts/check-reference-exports.mjs', '--language=Lean', '--runtime=rust', '--validate-prepared', `--output=${mounted}`, `--rust-binary=${selectedBinary}`, `--compiler=${variant === 'valid' ? compiler : '/definitely-missing-compiler'}`]);
    if (variant === 'valid') {
      assert.equal(checked.status, 0, checked.stderr);
      const receipt = JSON.parse(fs.readFileSync(path.join(mounted, 'report/Rust/receipt.json'), 'utf8'));
      assert.equal(receipt.status, 'native-validated');
      assert.equal(receipt.producer.binarySha256, original.producer.binarySha256);
      assert.ok(Object.values(receipt.languages.Lean.cases).every(entry => entry.passed));
    } else {
      assert.notEqual(checked.status, 0, variant);
      assert.match(checked.stderr, /Prepared Rust producer binary hash mismatch|regular executable built inside this repository/, variant);
    }
  }
});
