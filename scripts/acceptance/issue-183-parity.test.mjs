import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 1200000, maxBuffer: 32 * 1024 * 1024 });
const build = run('cargo', ['build', '--locked', '--jobs', '2', '--manifest-path', 'rust/Cargo.toml', '--target-dir', 'rust/target', '--bin', 'rml']);
assert.equal(build.status, 0, build.stderr);
const binary = path.join(root, 'rust', 'target', 'debug', process.platform === 'win32' ? 'rml.exe' : 'rml');
const script = path.join(root, 'scripts/check-corpus-parity.mjs');

test('the actual JavaScript and Rust command lines agree over every shared corpus source', () => {
  const result = run(process.execPath, [script, '--rust-bin', binary]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const files = fs.readdirSync(path.join(root, 'test-corpus')).filter(file => file.endsWith('.lino') && file !== 'expected.lino');
  assert.ok(files.length > 0);
  assert.equal(result.stdout.trim(), `Corpus parity passed for ${files.length} file(s).`);
});

test('the executed parity command rejects injected output drift from a real runtime', context => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-live-parity-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = path.join(temp, 'corpus');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'case.lino'), '(? (1 = 1))\n');
  const wrapper = path.join(temp, 'changed-runtime.mjs');
  const cli = path.join(root, 'js/src/rml-links.mjs');
  // Run the real CLI before introducing a detectable output regression.
  fs.writeFileSync(wrapper, `import { spawnSync } from 'node:child_process';\nconst result=spawnSync(process.execPath,[${JSON.stringify(cli)},...process.argv.slice(2)],{encoding:'utf8'});\nprocess.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.stdout.write('injected-parity-drift\\n');process.exitCode=result.status??1;\n`);
  const result = run(process.execPath, [script, '--corpus-dir', fixture, '--js-cli', wrapper, '--rust-bin', binary]);
  assert.equal(result.status, 1, result.stderr + result.stdout);
  assert.match(result.stderr + result.stdout, /stdout differs/);
  assert.match(result.stderr + result.stdout, /injected-parity-drift/);
});
