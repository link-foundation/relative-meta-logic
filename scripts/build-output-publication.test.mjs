import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const source = path.dirname(fileURLToPath(import.meta.url));
const repository = path.dirname(source);
const require = createRequire(path.join(repository, 'js/package.json'));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml output publication '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['build-cache.mjs', 'docker-cache-budget.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'run-with-cache.mjs', 'bootstrap.mjs', 'initialize-meta-language.mjs', 'publish-cache-output.mjs', 'build-docs.mjs']) fs.copyFileSync(path.join(source, file), path.join(root, 'scripts', file));
  // Each fixture is its own production session, even when this test runs under an outer wrapper.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !name.startsWith('RML_CACHE_') && !['CARGO_TARGET_DIR', 'NODE_TEST_CONTEXT', 'NODE_UNIQUE_ID'].includes(name)));
  const run = (args, cwd = root) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...inherited, RML_CACHE_SOURCE_ARCHIVE: '1', RML_CACHE_MIN_FREE_BYTES: '0' } });
  return { root, run };
}
function ok(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); }

test('publishing isolated output preserves concurrent user files and refuses colliding names', t => {
  const f = fixture(t);
  const program = `const fs=require('node:fs'),path=require('node:path');
    const output=process.env.RML_CACHE_OUTPUT_DIR;
    fs.writeFileSync(path.join(output,'generated'),'compiled bytes');
    fs.mkdirSync('target',{recursive:true});fs.writeFileSync('target/user','user bytes');
    require('./scripts/publish-cache-output.mjs').publishOutput(output,'target');`;
  ok(f.run(['scripts/run-with-cache.mjs', '--', process.execPath, '-e', program]));
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.readFileSync(path.join(f.root, 'target/user'), 'utf8'), 'user bytes');
  assert.equal(fs.existsSync(path.join(f.root, 'target/generated')), false);
  const collision = program.replace("'target/user','user bytes'", "'target/generated','concurrent work'");
  const result = f.run(['scripts/run-with-cache.mjs', '--', process.execPath, '-e', collision]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to replace/);
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.readFileSync(path.join(f.root, 'target/generated'), 'utf8'), 'concurrent work');
});

test('real JSDoc builds, repeats, and fully cleans only registered generated output', t => {
  let jsdoc;
  try { jsdoc = require.resolve('jsdoc/jsdoc.js'); } catch { t.skip('JSDoc development dependency is not installed'); return; }
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'js/src'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'docs/api'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'js/package.json'), '{"name":"docs-fixture"}');
  fs.writeFileSync(path.join(f.root, 'js/src/example.mjs'), '/** Add two numbers. @param {number} a First. @param {number} b Second. @returns {number} Sum. */\nexport const add = (a,b) => a+b;\n');
  fs.writeFileSync(path.join(f.root, 'js/README.md'), '# Fixture');
  fs.copyFileSync(path.join(repository, 'docs/api/jsdoc.json'), path.join(f.root, 'docs/api/jsdoc.json'));
  fs.symlinkSync(path.dirname(path.dirname(jsdoc)), path.join(f.root, 'js/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const command = ['../scripts/run-with-cache.mjs', '--', process.execPath, '../scripts/build-docs.mjs', '--destination', '../_site'];
  ok(f.run(command, path.join(f.root, 'js')));
  assert.equal(fs.existsSync(path.join(f.root, '_site/index.html')), true);
  fs.writeFileSync(path.join(f.root, '_site/private.txt'), 'keep my notes');
  ok(f.run(command, path.join(f.root, 'js')));
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  // Safe deletion leaves empty directory shells instead of racing public names.
  const remaining = fs.readdirSync(path.join(f.root, '_site'), { recursive: true }).filter(relative => !fs.lstatSync(path.join(f.root, '_site', relative)).isDirectory());
  assert.deepEqual(remaining, ['private.txt']);
  assert.equal(fs.readFileSync(path.join(f.root, '_site/private.txt'), 'utf8'), 'keep my notes');
  const report = JSON.parse(fs.readFileSync(path.join(f.root, '.rml-cache/reports/last-cleanup.json'), 'utf8'));
  assert.ok(report.reclaimedBytes > 1000);
});


test('a generated runtime copy inside the leased scratch stages its server; a forged lease naming it fails closed', t => {
  const f = fixture(t);
  // The outer lease is bound to RML_CACHE_ROOT. The emitted runtime below is a
  // different tree (CI: .rml-cache/scratch/.../runtime-1), so it must stage
  // with exclusive creation instead of resolving the outer worktree lease.
  const program = `const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
    const runtime=path.join(process.env.TMPDIR,'runtime-1');
    fs.mkdirSync(path.join(runtime,'vscode/scripts'),{recursive:true});fs.mkdirSync(path.join(runtime,'js/src'),{recursive:true});
    fs.copyFileSync('vscode/scripts/copy-server.mjs',path.join(runtime,'vscode/scripts/copy-server.mjs'));
    fs.cpSync('scripts',path.join(runtime,'scripts'),{recursive:true});
    fs.writeFileSync(path.join(runtime,'js/src/rml-lsp.mjs'),'export const generated = true;');
    const staged=spawnSync(process.execPath,['vscode/scripts/copy-server.mjs'],{cwd:runtime,encoding:'utf8'});
    if(staged.status!==0){console.error(staged.stderr);process.exit(3);}
    if(fs.readFileSync(path.join(runtime,'vscode/server/rml-lsp.mjs'),'utf8')!=='export const generated = true;')process.exit(4);
    const forged=spawnSync(process.execPath,['vscode/scripts/copy-server.mjs'],{cwd:runtime,encoding:'utf8',env:{...process.env,RML_CACHE_ROOT:runtime,RML_CACHE_LEASE:'00000000-0000-4000-8000-000000000000',RML_CACHE_PRODUCTION:'00000000-0000-4000-8000-000000000000'}});
    if(forged.status===0)process.exit(5);`;
  fs.mkdirSync(path.join(f.root, 'vscode/scripts'), { recursive: true });
  fs.copyFileSync(path.join(repository, 'vscode/scripts/copy-server.mjs'), path.join(f.root, 'vscode/scripts/copy-server.mjs'));
  ok(f.run(['scripts/run-with-cache.mjs', '--', process.execPath, '-e', program]));
  ok(f.run(['scripts/build-cache.mjs', '--full']));
});

test('VS Code staging never deletes an unowned server module', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'vscode/scripts'), { recursive: true });
  fs.mkdirSync(path.join(f.root, 'vscode/server'));
  fs.mkdirSync(path.join(f.root, 'js/src'), { recursive: true });
  fs.copyFileSync(path.join(repository, 'vscode/scripts/copy-server.mjs'), path.join(f.root, 'vscode/scripts/copy-server.mjs'));
  fs.writeFileSync(path.join(f.root, 'js/src/server.mjs'), 'export const version = 1;');
  fs.writeFileSync(path.join(f.root, 'vscode/server/private.mjs'), 'my uncommitted module');
  const command = ['scripts/run-with-cache.mjs', '--', process.execPath, 'vscode/scripts/copy-server.mjs'];
  ok(f.run(command));
  fs.writeFileSync(path.join(f.root, 'js/src/server.mjs'), 'export const version = 2;');
  ok(f.run(command));
  assert.equal(fs.readFileSync(path.join(f.root, 'vscode/server/server.mjs'), 'utf8'), 'export const version = 2;');
  ok(f.run(['scripts/build-cache.mjs', '--full']));
  assert.equal(fs.readFileSync(path.join(f.root, 'vscode/server/private.mjs'), 'utf8'), 'my uncommitted module');
  assert.equal(fs.existsSync(path.join(f.root, 'vscode/server/server.mjs')), false);
});
