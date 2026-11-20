import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { copyMeasurementSources } from './measurement-source.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rml measurement sources '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  fs.mkdirSync(source);
  git(source, 'init', '-q');
  git(source, 'config', 'user.name', 'Measurement fixture');
  git(source, 'config', 'user.email', 'measurement@example.invalid');
  fs.writeFileSync(path.join(source, 'source.txt'), 'tracked source\n');
  git(source, 'add', '.');
  git(source, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'source');
  const module = path.join(source, 'vendor', 'grammar');
  fs.mkdirSync(module, { recursive: true });
  git(module, 'init', '-q');
  git(module, 'config', 'user.name', 'Measurement fixture');
  git(module, 'config', 'user.email', 'measurement@example.invalid');
  fs.writeFileSync(path.join(module, 'runtime.mjs'), 'export const value = 1;\n');
  git(module, 'add', '.');
  git(module, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'pinned runtime');
  const revision = git(module, 'rev-parse', 'HEAD');
  git(source, 'update-index', '--add', '--cacheinfo', `160000,${revision},vendor/grammar`);
  const destination = path.join(dir, 'independent copy');
  fs.mkdirSync(destination);
  return { source, module, revision, destination };
}

test('measurement snapshots preserve indexed dependency source and independent Git identity', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'source.txt'), 'working source\n');
  fs.writeFileSync(path.join(f.source, 'new-source.txt'), 'new source\n');
  copyMeasurementSources(f.source, f.destination);
  const module = path.join(f.destination, 'vendor', 'grammar');
  assert.equal(fs.readFileSync(path.join(f.destination, 'source.txt'), 'utf8'), 'working source\n');
  assert.equal(fs.readFileSync(path.join(f.destination, 'new-source.txt'), 'utf8'), 'new source\n');
  assert.equal(git(module, 'rev-parse', 'HEAD'), f.revision);
  assert.equal(fs.realpathSync(git(module, 'rev-parse', '--show-toplevel')), fs.realpathSync(module));
  assert.equal(git(module, 'status', '--porcelain'), '');
  fs.writeFileSync(path.join(module, 'runtime.mjs'), 'changed only in isolated measurement\n');
  assert.equal(fs.readFileSync(path.join(f.module, 'runtime.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('measurement refuses dirty dependency source without resetting it', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.module, 'runtime.mjs'), 'uncommitted upstream work\n');
  assert.throws(() => copyMeasurementSources(f.source, f.destination), /clean initialized submodule/);
  assert.equal(fs.readFileSync(path.join(f.module, 'runtime.mjs'), 'utf8'), 'uncommitted upstream work\n');
  assert.deepEqual(fs.readdirSync(f.destination), []);
});

test('measurement refuses a different dependency revision even when its worktree is clean', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.module, 'runtime.mjs'), 'export const value = 2;\n');
  git(f.module, 'add', '.');
  git(f.module, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'different revision');
  const changed = git(f.module, 'rev-parse', 'HEAD');
  assert.throws(() => copyMeasurementSources(f.source, f.destination), /indexed revision/);
  assert.equal(git(f.module, 'rev-parse', 'HEAD'), changed);
  assert.deepEqual(fs.readdirSync(f.destination), []);
});
