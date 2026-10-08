import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = path.dirname(fileURLToPath(import.meta.url));
function fixture(t, withGuard = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-source-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts', 'js', 'rust']) fs.mkdirSync(path.join(root, directory));
  for (const file of ['run-with-cache.mjs', 'build-cache.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'bootstrap.mjs', 'initialize-meta-language.mjs']) fs.copyFileSync(path.join(source, file), path.join(root, 'scripts', file));
  fs.writeFileSync(path.join(root, 'js/package.json'), '{"name":"migration-fixture"}');
  fs.writeFileSync(path.join(root, 'rust/Cargo.toml'), '[package]\nname="migration-fixture"\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.rml-cache/\ntarget/\n');
  fs.writeFileSync(path.join(root, 'current.json'), 'false');
  if (withGuard) fs.writeFileSync(path.join(root, 'scripts/check-linked-implementation.mjs'), `import fs from 'node:fs';import path from 'node:path';export function checkCurrentLinkedImplementation(root){if(JSON.parse(fs.readFileSync(path.join(root,'current.json'),'utf8'))!==true)throw new Error('stale linked implementation');}`);
  for (const args of [['init', '-q'], ['config', 'user.name', 'Migration fixture'], ['config', 'user.email', 'migration@example.invalid'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture']]) execFileSync('git', ['-C', root, ...args]);
  return {
    root,
    run(program, migration = false) {
      return spawnSync(process.execPath, ['scripts/run-with-cache.mjs', ...(migration ? ['--source-migration'] : []), '--', process.execPath, '-e', program], { cwd: root, env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0' }, encoding: 'utf8' });
    },
    receipts() { return fs.readdirSync(path.join(root, '.rml-cache/evidence')).filter(p => p.endsWith('.json')).map(p => JSON.parse(fs.readFileSync(path.join(root, '.rml-cache/evidence', p)))); },
  };
}

test('ordinary operations refuse stale implementation before executing their command', t => {
  const f = fixture(t);
  const result = f.run("require('node:fs').writeFileSync('ran','yes')");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stale linked implementation/);
  assert.equal(fs.existsSync(path.join(f.root, 'ran')), false);
});

test('explicit migration succeeds only after its command establishes a current implementation', t => {
  const f = fixture(t);
  const result = f.run("require('node:fs').writeFileSync('current.json','true')", true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = f.receipts().at(-1);
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.commandExitCode, 0);
  assert.equal(receipt.sourceValidationPassed, true);
  assert.equal(f.run('process.exit(0)').status, 0);
});

test('a successful migration command cannot hide a failed final authority check', t => {
  const f = fixture(t);
  const result = f.run('process.exit(0)', true);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /did not produce a consistent linked implementation/);
  const receipt = f.receipts().at(-1);
  assert.equal(receipt.exitCode, 2);
  assert.equal(receipt.commandExitCode, 0);
  assert.equal(receipt.sourceValidationPassed, false);
});

test('migration preserves a failed command status and never labels its sources verified', t => {
  const f = fixture(t);
  const result = f.run('process.exit(23)', true);
  assert.equal(result.status, 23);
  const receipt = f.receipts().at(-1);
  assert.equal(receipt.exitCode, 23);
  assert.equal(receipt.sourceValidationPassed, false);
});

test('migration cannot omit its authority checker', t => {
  const f = fixture(t, false);
  const result = f.run("require('node:fs').writeFileSync('ran','yes')", true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the linked implementation guard/);
  assert.equal(fs.existsSync(path.join(f.root, 'ran')), false);
});
