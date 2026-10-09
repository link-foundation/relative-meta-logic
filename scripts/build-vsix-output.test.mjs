import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageManifest = JSON.parse(fs.readFileSync(path.join(repository, 'vscode/package.json'), 'utf8'));
const require = createRequire(path.join(repository, 'vscode/package.json'));
const filename = 'relative-meta-logic.vsix';
const fakeVsce = `const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.VSCE_CALLS, JSON.stringify({ args, cwd: process.cwd(), privateRoot: process.env.RML_CACHE_OUTPUT_DIR }) + '\\n');
if (args.length !== 3 || args[0] !== 'package' || args[1] !== '--out') process.exit(91);
fs.writeFileSync(args[2], process.env.VSCE_BYTES || 'produced VSIX bytes');
if (process.env.VSCE_COLLISION) fs.writeFileSync(path.join(process.cwd(), '${filename}'), process.env.VSCE_COLLISION, { flag: 'wx' });
process.exit(Number(process.env.VSCE_STATUS || 0));
`;

function fixture(t, realVsce) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml VSIX output '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extension = path.join(root, 'vscode');
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(extension, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'js/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js/src/server.mjs'), 'export const version = 1;\n');
  for (const name of ['build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'run-with-cache.mjs', 'bootstrap.mjs', 'initialize-meta-language.mjs', 'publish-cache-output.mjs']) {
    fs.copyFileSync(path.join(repository, 'scripts', name), path.join(root, 'scripts', name));
  }
  for (const name of ['copy-server.mjs', 'package-vsix.mjs']) {
    fs.copyFileSync(path.join(repository, 'vscode/scripts', name), path.join(extension, 'scripts', name));
  }
  // Exercise the actual npm script chain with a minimal extension payload.
  fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({
    ...packageManifest, dependencies: {}, contributes: {},
  }));
  fs.mkdirSync(path.join(extension, 'src'));
  fs.writeFileSync(path.join(extension, 'src/extension.js'), 'exports.activate = () => {};\n');
  fs.writeFileSync(path.join(extension, 'README.md'), '# VSIX publication fixture\n');
  fs.writeFileSync(path.join(extension, 'LICENSE'), 'This is free and unencumbered software released into the public domain.\n');
  fs.copyFileSync(path.join(repository, 'vscode/.vscodeignore'), path.join(extension, '.vscodeignore'));
  const moduleRoot = path.join(extension, 'node_modules/@vscode/vsce');
  fs.mkdirSync(path.dirname(moduleRoot), { recursive: true });
  if (realVsce) fs.symlinkSync(path.dirname(realVsce), moduleRoot, process.platform === 'win32' ? 'junction' : 'dir');
  else {
    fs.mkdirSync(moduleRoot);
    fs.writeFileSync(path.join(moduleRoot, 'package.json'), '{"name":"@vscode/vsce","version":"4.0.0","bin":{"vsce":"vsce"}}');
    fs.writeFileSync(path.join(moduleRoot, 'vsce'), fakeVsce);
  }
  const calls = path.join(root, 'vsce-calls.jsonl');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RML_CACHE_'))),
    RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_MIN_FREE_BYTES: '0',
    RML_CACHE_STALE_HOURS: '0', VSCE_CALLS: calls,
    npm_config_update_notifier: 'false',
  };
  const run = (command, args, cwd, extraEnv = {}, shell = false) => spawnSync(command, args, {
    cwd, env: { ...env, ...extraEnv }, shell, encoding: 'utf8', timeout: 60000,
  });
  return {
    root, extension, output: path.join(extension, filename),
    package: extraEnv => run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'package'], extension, extraEnv, process.platform === 'win32'),
    clean: full => run(process.execPath, ['scripts/build-cache.mjs', ...(full ? ['--full'] : [])], root),
    unwrapped: () => run(process.execPath, ['scripts/package-vsix.mjs'], extension),
    calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
  };
}

function ok(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('npm packaging routes VSCE into a fresh private path, retains its VSIX, and supports owned rebuild/full cleanup', t => {
  const f = fixture(t);
  ok(f.package());
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'produced VSIX bytes');
  ok(f.clean(false));
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'produced VSIX bytes', 'bounded cleanup must retain the installable package even when stale');
  ok(f.package({ VSCE_BYTES: 'updated VSIX bytes' }));
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'updated VSIX bytes');
  const calls = f.calls();
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 2), ['package', '--out']);
    assert.equal(call.args.length, 3);
    assert.equal(call.cwd, f.extension);
    assert.ok(path.isAbsolute(call.args[2]));
    assert.ok(call.args[2].startsWith(`${call.privateRoot}${path.sep}`));
    assert.notEqual(call.args[2], f.output);
    assert.equal(fs.existsSync(call.args[2]), false, 'temporary VSCE output must be reclaimed');
  }
  assert.notEqual(calls[0].args[2], calls[1].args[2]);
  ok(f.clean(false));
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'updated VSIX bytes');
  ok(f.clean(true));
  assert.equal(fs.existsSync(f.output), false);
});

for (const bytes of ['unowned package', 'produced VSIX bytes']) {
  test(`packaging preserves preexisting unowned VSIX (${bytes})`, t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, bytes);
    const before = fs.statSync(f.output);
    const result = f.package();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to replace/);
    assert.equal(f.calls().length, 1);
    ok(f.clean(true));
    assert.equal(fs.readFileSync(f.output, 'utf8'), bytes);
    assert.equal(fs.statSync(f.output).ino, before.ino);
  });
}

test('packaging preserves a VSIX created concurrently while VSCE writes privately', t => {
  const f = fixture(t);
  const result = f.package({ VSCE_COLLISION: 'concurrent user package' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to replace/);
  ok(f.clean(true));
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'concurrent user package');
  assert.equal(fs.existsSync(f.calls()[0].args[2]), false);
});

test('packaging and full cleanup preserve edits to a previously owned VSIX', t => {
  const f = fixture(t);
  ok(f.package());
  fs.writeFileSync(f.output, 'user edited package');
  const result = f.package();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to replace/);
  ok(f.clean(true));
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'user edited package');
});

test('VSCE failure preserves the prior installable VSIX and never publishes partial output', t => {
  const f = fixture(t);
  ok(f.package());
  const result = f.package({ VSCE_STATUS: '17', VSCE_BYTES: 'partial archive' });
  assert.equal(result.status, 17, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'produced VSIX bytes');
  assert.equal(fs.existsSync(f.calls()[1].args[2]), false);
  ok(f.clean(true));
  assert.equal(fs.existsSync(f.output), false);
});

test('the VSIX producer requires a verified wrapper before invoking VSCE', t => {
  const f = fixture(t);
  const result = f.unwrapped();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verified build-cache producer lease/);
  assert.deepEqual(f.calls(), []);
  assert.equal(fs.existsSync(f.output), false);
});

test('installed VSCE packages a real archive that survives bounded cleanup and is reclaimed by full cleanup', t => {
  let vsce;
  try {
    const resolver = process.env.RML_TEST_VSCE_MODULES
      ? createRequire(path.join(path.resolve(process.env.RML_TEST_VSCE_MODULES), '../package.json')) : require;
    vsce = resolver.resolve('@vscode/vsce/vsce');
  } catch { t.skip('VSCE development dependency is not installed'); return; }
  const f = fixture(t, vsce);
  ok(f.package());
  const archive = fs.readFileSync(f.output);
  assert.ok(archive.length > 1000);
  assert.equal(archive.subarray(0, 4).toString('hex'), '504b0304');
  ok(f.clean(false));
  assert.deepEqual(fs.readFileSync(f.output), archive);
  ok(f.clean(true));
  assert.equal(fs.existsSync(f.output), false);
});
