import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml cache spaces '));
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const name of ['build-cache.mjs', 'build-cache-windows.ps1', 'cache-policy.json', 'run-with-cache.mjs', 'bootstrap.mjs', 'initialize-meta-language.mjs']) fs.copyFileSync(path.join(source, name), path.join(root, 'scripts', name));
  fs.mkdirSync(path.join(root, 'js'));
  fs.mkdirSync(path.join(root, 'rust'));
  fs.writeFileSync(path.join(root, 'js/package.json'), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(root, 'rust/Cargo.toml'), '[package]\nname="fixture"\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'source\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.rml-cache/\ntarget/\n');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Cache fixture'); git('config', 'user.email', 'cache@example.invalid'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (args, extra = {}) => spawnSync(node, args, { cwd: root, env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0', RML_CACHE_LOCK_TIMEOUT_MS: '1000', ...extra }, encoding: 'utf8' });
  const wrap = (program, flags = [], extra = {}) => run(['scripts/run-with-cache.mjs', ...flags, '--', node, '-e', program], extra);
  const clean = (...args) => run(['scripts/build-cache.mjs', ...args]);
  return { root, git, run, wrap, clean };
}
const writeProgram = (relative, content = 'cache') => `var fs=require('node:fs'),p=require('node:path');fs.mkdirSync(p.dirname(${JSON.stringify(relative)}),{recursive:true});fs.writeFileSync(${JSON.stringify(relative)},${JSON.stringify(content)});`;
function ok(result) { assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`); }
const exists = (f, p) => fs.existsSync(path.join(f.root, p));
const read = (f, p) => fs.readFileSync(path.join(f.root, p), 'utf8');

test('cleanup report hard links never overwrite another file', t => {
  const f = fixture(t);
  ok(f.clean('--full'));
  const report = path.join(f.root, '.rml-cache/reports/last-cleanup.json');
  const protectedFile = path.join(f.root, 'preserved-report-copy.json');
  fs.linkSync(report, protectedFile);
  const before = fs.readFileSync(protectedFile);
  const result = f.clean('--full');
  assert.deepEqual(fs.readFileSync(protectedFile), before);
  assert.ok(result.status === 0 || /hard link/i.test(result.stderr), result.stderr);
});

test('managed hook hard links never overwrite another file', t => {
  const f = fixture(t);
  ok(f.run(['scripts/bootstrap.mjs']));
  const hook = path.join(f.git('config', '--get', 'core.hooksPath').trim(), 'pre-commit');
  const protectedFile = path.join(f.root, 'preserved-hook-copy');
  fs.linkSync(hook, protectedFile);
  fs.appendFileSync(protectedFile, '\n# User-maintained content must survive\n');
  const before = fs.readFileSync(protectedFile);
  const result = f.run(['scripts/bootstrap.mjs']);
  assert.deepEqual(fs.readFileSync(protectedFile), before);
  assert.ok(result.status === 0 || /hard link/i.test(result.stderr), result.stderr);
});

test('hook composition hard links never overwrite another file', t => {
  const f = fixture(t);
  ok(f.run(['scripts/bootstrap.mjs']));
  const hooks = f.git('config', '--get', 'core.hooksPath').trim();
  const record = path.join(hooks, 'previous-hooks.json');
  const protectedFile = path.join(f.root, 'preserved-composition.json');
  fs.linkSync(record, protectedFile);
  const before = fs.readFileSync(protectedFile);
  const alternate = path.join(f.root, 'alternate hooks');
  fs.mkdirSync(alternate);
  f.git('config', '--worktree', 'core.hooksPath', alternate);
  const result = f.run(['scripts/bootstrap.mjs']);
  assert.deepEqual(fs.readFileSync(protectedFile), before);
  assert.ok(result.status === 0 || /hard link/i.test(result.stderr), result.stderr);
});

test('all declared cache classes are reclaimed; full is idempotent; evidence/source survive', t => {
  const f = fixture(t);
  const caches = [
    ['rust/target/debug/deps/a.rlib', 'rust'], ['rust/target/release/examples/a', 'rust'], ['target/coverage/x', 'rust'],
    ['js/.cache/a', 'javascript'], ['js/coverage/a', 'javascript'], ['vscode/server/a.mjs', 'package'],
    ['.rml-cache/consumers/nested-clone/rust/target/a', 'package'], ['.rml-cache/parser/a', 'parser'],
    ['.rml-cache/compiler/a', 'compiler'], ['.rml-cache/lean/a.olean', 'lean'], ['.rml-cache/rocq/a.vo', 'rocq'],
    ['.rml-cache/acceptance/a', 'acceptance'], ['.rml-cache/benchmark/a', 'benchmark'], ['.rml-cache/containers/a', 'container'],
  ];
  ok(f.wrap(caches.map(([p]) => writeProgram(p)).join('\n').replaceAll('const fs=', 'var fs=')));
  ok(f.clean('--full'));
  for (const [p] of caches) assert.equal(exists(f, p), false, p);
  assert.equal(read(f, 'README.md'), 'source\n');
  assert.ok(fs.readdirSync(path.join(f.root, '.rml-cache/evidence')).some(p => p.endsWith('.log')));
  ok(f.clean('--full'));
  const report = JSON.parse(read(f, '.rml-cache/reports/last-cleanup.json'));
  assert.equal(report.reclaimedBytes, 0);
  assert.equal(report.classes.length, 10);
});

test('full cleanup preserves tracked, preexisting and subsequently edited files', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'target'));
  fs.writeFileSync(path.join(f.root, 'target/preexisting.txt'), 'private work');
  fs.writeFileSync(path.join(f.root, 'target/tracked.txt'), 'vendored fixture');
  f.git('add', '-f', 'target/tracked.txt');
  ok(f.wrap(writeProgram('target/generated', 'generated')));
  fs.writeFileSync(path.join(f.root, 'target/generated'), 'user edited this');
  ok(f.clean('--full'));
  assert.equal(read(f, 'target/preexisting.txt'), 'private work');
  assert.equal(read(f, 'target/tracked.txt'), 'vendored fixture');
  assert.equal(read(f, 'target/generated'), 'user edited this');
  const report = JSON.parse(read(f, '.rml-cache/reports/last-cleanup.json'));
  assert.ok(report.protected.some(p => p.reason.includes('uncommitted')));
});

test('custom target paths with spaces are owned; external/traversal/source paths rejected', t => {
  const f = fixture(t);
  ok(f.wrap(writeProgram('custom target/debug/a'), ['--cache', 'custom target', '--class', 'rust']));
  ok(f.clean('--full'));
  assert.equal(exists(f, 'custom target/debug/a'), false);
  for (const p of ['../escape', '/tmp/outside', 'js/src', 'docs/proof', '.git', 'test-corpus']) {
    const result = f.wrap('process.exit(0)', ['--cache', p, '--class', 'rust']);
    assert.notEqual(result.status, 0, p);
  }
  ok(f.wrap(writeProgram('cargo custom/debug/a'), [], { CARGO_TARGET_DIR: path.join(f.root, 'cargo custom') }));
  ok(f.clean('--full'));
  assert.equal(exists(f, 'cargo custom/debug/a'), false);
  assert.notEqual(f.wrap('process.exit(0)', [], { CARGO_TARGET_DIR: os.tmpdir() }).status, 0);
});

test('aggregate byte budget enforced without optional cargo-sweep/du/docker tools', t => {
  const f = fixture(t);
  ok(f.wrap(writeProgram('target/a', 'a'.repeat(100)) + writeProgram('js/.cache/b', 'b'.repeat(100)).replace('const fs=', 'var fs='), [], { RML_CACHE_BUDGET_BYTES: '50' }));
  const report = JSON.parse(read(f, '.rml-cache/reports/last-cleanup.json'));
  assert.equal(report.beforeBytes, 200);
  assert.ok(report.afterBytes <= 50);
  assert.equal(report.reclaimedBytes, 200);
  assert.equal(report.budgetSatisfied, true);
});

test('success, failure and missing commands preserve status and archive output before cleanup', t => {
  const f = fixture(t);
  ok(f.wrap(writeProgram('.rml-cache/scratch/success') + 'console.log("success log")'));
  const failed = f.wrap(writeProgram('.rml-cache/scratch/failure') + 'console.error("real failed test");process.exit(42)');
  assert.equal(failed.status, 42, failed.stderr);
  assert.equal(exists(f, '.rml-cache/scratch/failure'), false);
  const missing = f.run(['scripts/run-with-cache.mjs', '--', 'no-such-rml-fixture-command']);
  assert.equal(missing.status, 127);
  const logs = fs.readdirSync(path.join(f.root, '.rml-cache/evidence')).filter(p => p.endsWith('.log')).map(p => read(f, `.rml-cache/evidence/${p}`)).join('');
  assert.match(logs, /real failed test/);
});

test('retained publish outputs survive budget cleanup until final full cleanup', t => {
  const f = fixture(t);
  assert.equal(f.wrap(writeProgram('_site/index.html'), ['--retain', '_site'], { RML_CACHE_BUDGET_BYTES: '0' }).status, 2);
  assert.equal(exists(f, '_site/index.html'), true);
  ok(f.clean('--full'));
  assert.equal(exists(f, '_site/index.html'), false);
});

test('fresh clone bootstrap composes existing hooks; documentation-only commit cleans', t => {
  const f = fixture(t);
  const existing = path.join(f.root, 'old hooks');
  fs.mkdirSync(existing);
  fs.writeFileSync(path.join(existing, 'pre-commit'), '#!/bin/sh\necho original >> "$(git rev-parse --show-toplevel)/hook-calls"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(existing, 'post-commit'), '#!/bin/sh\necho post >> "$(git rev-parse --show-toplevel)/hook-calls"\n', { mode: 0o755 });
  f.git('config', 'core.hooksPath', existing);
  ok(f.run(['scripts/bootstrap.mjs']));
  ok(f.run(['scripts/bootstrap.mjs']));
  ok(f.wrap(writeProgram('target/to-clean')));
  fs.appendFileSync(path.join(f.root, 'README.md'), 'documentation-only edit\n');
  f.git('add', 'README.md');
  execFileSync('git', ['-C', f.root, 'commit', '-qm', 'docs only'], { env: { ...process.env, RML_CACHE_BUDGET_BYTES: '0' } });
  assert.equal(exists(f, 'target/to-clean'), false);
  assert.equal(read(f, 'hook-calls'), 'original\npost\n');
  assert.match(fs.readFileSync(path.join(existing, 'pre-commit'), 'utf8'), /echo original/);
});

test('dependency install skips hooks and cannot change consuming Git configuration', t => {
  const f = fixture(t);
  const before = f.git('config', '--local', '--list');
  ok(f.run(['scripts/bootstrap.mjs'], { npm_lifecycle_event: 'prepare', INIT_CWD: path.dirname(f.root) }));
  assert.equal(f.git('config', '--local', '--list'), before);
});

test('symlink escapes and other worktree artifacts cannot be registered or removed', t => {
  const f = fixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'secret'), 'external');
  fs.symlinkSync(external, path.join(f.root, 'target'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.notEqual(f.wrap('process.exit(0)', ['--cache', 'target', '--class', 'rust']).status, 0);
  ok(f.clean('--full'));
  assert.equal(fs.readFileSync(path.join(external, 'secret'), 'utf8'), 'external');
  f.git('worktree', 'add', '--detach', path.join(f.root, 'other-worktree'));
  assert.notEqual(f.wrap('process.exit(0)', ['--cache', 'other-worktree', '--class', 'rust']).status, 0);
});

async function waitFor(predicate, timeout = 10000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for fixture'); await new Promise(r => setTimeout(r, 25)); }
}
function finished(child) { return new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))); }

test('active parallel wrapper holds lease; interruption stops child then cleans and keeps logs', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const program = writeProgram('.rml-cache/scratch/active') + 'console.log("started");setInterval(()=>{},1000)';
  const child = spawn(node, ['scripts/run-with-cache.mjs', '--', node, '-e', program], { cwd: f.root, env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0' }, stdio: 'pipe' });
  const done = finished(child);
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await waitFor(() => exists(f, '.rml-cache/scratch/active'));
  const concurrent = f.clean('--full');
  assert.notEqual(concurrent.status, 0);
  assert.match(concurrent.stderr, /lease/);
  assert.equal(exists(f, '.rml-cache/scratch/active'), true);
  child.kill('SIGTERM');
  const result = await done;
  assert.equal(result.code, 143);
  assert.equal(exists(f, '.rml-cache/scratch/active'), false);
  ok(f.clean('--full'));
});

test('pre-run low disk prevents the command and reports why', t => {
  const f = fixture(t);
  const result = f.wrap(writeProgram('target/not-run'), [], { RML_CACHE_MIN_FREE_BYTES: '99999999999999999' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Low disk/);
  assert.equal(exists(f, 'target/not-run'), false);
});

test('a fresh actual git clone installs executable hooks during bootstrap', t => {
  const original = fixture(t);
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'rml clone spaces '));
  t.after(() => fs.rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '--local', original.root, clone]);
  const result = spawnSync(node, ['scripts/bootstrap.mjs'], { cwd: clone, encoding: 'utf8' });
  ok(result);
  const hookPath = execFileSync('git', ['-C', clone, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
  assert.match(fs.readFileSync(path.join(hookPath, 'pre-commit'), 'utf8'), /node .*build-cache\.mjs/);
  // Windows does not expose POSIX execute bits through stat; Git must actually
  // invoke the installed hook on every supported platform.
  const commit = spawnSync('git', ['-C', clone, '-c', 'user.name=Cache fixture', '-c', 'user.email=cache@example.invalid', 'commit', '--allow-empty', '-m', 'exercise installed hooks'], { encoding: 'utf8', env: { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0' } });
  ok(commit);
  assert.ok(fs.existsSync(path.join(clone, '.rml-cache/reports/last-cleanup.json')));
});

test('an existing failing hook still runs cleanup and keeps its nonzero result', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 23\n', { mode: 0o755 });
  ok(f.wrap(writeProgram('target/old')));
  const hookPath = f.git('config', '--get', 'core.hooksPath').trim();
  const result = spawnSync('sh', [path.join(hookPath, 'pre-commit')], { cwd: f.root, encoding: 'utf8', env: { ...process.env, RML_CACHE_BUDGET_BYTES: '0' } });
  assert.equal(result.status, 23);
  assert.equal(exists(f, 'target/old'), false);
});

test('unleased active Node build is preserved; cleanup succeeds after it exits', async t => {
  const f = fixture(t);
  ok(f.wrap(writeProgram('target/live')));
  const child = spawn(node, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.root, stdio: 'ignore' });
  const done = finished(child);
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise(r => setTimeout(r, 100));
  const result = f.clean('--full');
  assert.notEqual(result.status, 0);
  assert.equal(exists(f, 'target/live'), true);
  child.kill();
  await done;
  ok(f.clean('--full'));
  assert.equal(exists(f, 'target/live'), false);
});

test('an active Node process in another directory does not block this worktree cleanup', async t => {
  const f = fixture(t);
  ok(f.wrap(writeProgram('target/owned')));
  const child = spawn(node, ['-e', 'setInterval(()=>{},1000)'], { cwd: os.tmpdir(), stdio: 'ignore' });
  const done = finished(child);
  t.after(async () => { if (child.exitCode === null) child.kill(); await done; });
  await new Promise(r => setTimeout(r, 100));
  ok(f.clean('--full'));
  assert.equal(exists(f, 'target/owned'), false);
  assert.equal(child.exitCode, null);
});

test('macOS process inspection distinguishes exited and zombie builders from inaccessible live builders', async t => {
  const { assertNoUnleasedBuilders } = await import('./build-cache.mjs');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rml-macos-inspection-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const builder = 2147483000;
  const inspect = ({ alive = true, initialState = 'S', currentState = 'S', cwd, missingField = false } = {}) => assertNoUnleasedBuilders({ root }, {
    platform: 'darwin', isAlive: () => alive,
    run(command, args) {
      if (command === 'ps' && args[0] === '-axo') return `${builder} 1 ${initialState} /usr/local/bin/node\n${builder + 1} 1 S /usr/bin/python3\n`;
      if (command === 'ps') return `${currentState}\n`;
      if (cwd) return `p${builder}\nn${cwd}\n`;
      if (missingField) return `p${builder}\n`;
      throw Object.assign(new Error('lsof: no matching process or permission denied'), { status: 1 });
    },
  });
  assert.doesNotThrow(() => inspect({ alive: false }));
  assert.doesNotThrow(() => inspect({ initialState: 'Z' }));
  assert.doesNotThrow(() => inspect({ currentState: 'Z' }));
  assert.throws(() => inspect(), /Cannot establish active builder/);
  assert.throws(() => inspect({ missingField: true }), /Cannot establish active builder/);
  assert.throws(() => inspect({ cwd: root }), /Active unleased build process/);
  assert.doesNotThrow(() => inspect({ cwd: os.tmpdir() }));
});

test('Windows process inspection uses executable identity and real cwd, preserving unknown live builders', async () => {
  const { assertNoUnleasedBuilders } = await import('./build-cache.mjs');
  const root = 'C:\\cache worktree';
  const inspect = records => assertNoUnleasedBuilders({ root }, {
    platform: 'win32', realPath: value => value,
    run(command, args) {
      assert.equal(command, 'powershell.exe');
      assert.ok(args.includes('-File'));
      assert.match(args.at(-1), /build-cache-windows\.ps1$/);
      return JSON.stringify(records);
    },
  });
  const builder = { pid: 2147483000, parent: 1, executable: 'C:\\Program Files\\nodejs\\node.exe', state: 'live' };
  assert.throws(() => inspect([{ ...builder, cwd: 'c:/CACHE WORKTREE/target' }]), /Active unleased build process/);
  assert.throws(() => inspect([builder]), /unknown working directory/);
  assert.doesNotThrow(() => inspect([{ ...builder, cwd: 'C:\\cache worktree-other' }]));
  assert.doesNotThrow(() => inspect([{ ...builder, state: 'gone' }]));
  assert.doesNotThrow(() => inspect([{ ...builder, executable: 'powershell.exe', command: 'node cargo rustc' }]));
  assert.throws(() => inspect([]), /Cannot inspect active builders/);
});

test('source archives require explicit opt-in and still preserve baseline source', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, '.git'), { recursive: true });
  assert.notEqual(f.wrap('process.exit(0)').status, 0);
  ok(f.wrap(writeProgram('.rml-cache/scratch/output'), [], { RML_CACHE_SOURCE_ARCHIVE: '1' }));
  assert.equal(exists(f, '.rml-cache/scratch/output'), false);
  assert.equal(read(f, 'README.md'), 'source\n');
});

test('hook and report state symlinks are rejected without modifying their target', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  ok(f.run(['scripts/bootstrap.mjs']));
  const hook = path.join(f.git('config', '--get', 'core.hooksPath').trim(), 'pre-commit');
  const outside = path.join(f.root, 'important');
  fs.writeFileSync(outside, '# RML composed cache hook v1\nprivate\n');
  fs.unlinkSync(hook); fs.symlinkSync(outside, hook);
  assert.notEqual(f.run(['scripts/bootstrap.mjs']).status, 0);
  assert.equal(fs.readFileSync(outside, 'utf8'), '# RML composed cache hook v1\nprivate\n');
  fs.mkdirSync(path.join(f.root, '.rml-cache'));
  fs.symlinkSync(path.join(f.root, 'scripts'), path.join(f.root, '.rml-cache/evidence'));
  assert.notEqual(f.clean('--full').status, 0);
});

test('over-budget protected data blocks execution and never becomes a passing test', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'target'));
  fs.writeFileSync(path.join(f.root, 'target/user-data'), 'protected');
  const result = f.wrap(writeProgram('target/should-not-run'), [], { RML_CACHE_BUDGET_BYTES: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /budget exceeded/);
  assert.equal(exists(f, 'target/should-not-run'), false);
  assert.equal(read(f, 'target/user-data'), 'protected');
});

test('hook configuration is per-worktree and never replaces another worktree hook path', t => {
  const f = fixture(t);
  const other = path.join(f.root, 'peer worktree');
  f.git('worktree', 'add', '--detach', other);
  ok(f.run(['scripts/bootstrap.mjs']));
  const ownHooks = f.git('config', '--get', 'core.hooksPath').trim();
  assert.equal(spawnSync('git', ['-C', other, 'config', '--get', 'core.hooksPath']).status, 1);
  ok(spawnSync(node, ['scripts/bootstrap.mjs'], { cwd: other, encoding: 'utf8' }));
  const otherHooks = execFileSync('git', ['-C', other, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
  assert.notEqual(otherHooks, ownHooks);
  assert.equal(f.git('config', '--get', 'core.hooksPath').trim(), ownHooks);
});

test('missing Node is an explicit hook failure instead of silently disabling cleanup', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  ok(f.run(['scripts/bootstrap.mjs']));
  const bin = path.join(f.root, 'minimal tools');
  fs.mkdirSync(bin);
  const gitBinary = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.symlinkSync(gitBinary, path.join(bin, 'git'));
  const hook = path.join(f.git('config', '--get', 'core.hooksPath').trim(), 'pre-commit');
  const result = spawnSync('/bin/sh', [hook], { cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /requires Node/);
});

test('new nested clones retain their own sources and uncommitted work while owned targets clean', t => {
  const f = fixture(t);
  const program = `
    const fs=require('node:fs'), cp=require('node:child_process');
    const root='.rml-cache/consumers/nested-clone';
    fs.mkdirSync(root,{recursive:true});
    cp.execFileSync('git',['init','-q',root]);
    fs.writeFileSync(root+'/tracked.rs','tracked source');
    cp.execFileSync('git',['-C',root,'add','tracked.rs']);
    fs.writeFileSync(root+'/tracked.rs','uncommitted tracked edit');
    fs.writeFileSync(root+'/new-source.rs','uncommitted untracked source');
    fs.mkdirSync(root+'/rust/target/debug',{recursive:true});
    fs.writeFileSync(root+'/rust/target/debug/generated','cache');
  `;
  ok(f.wrap(program));
  ok(f.clean('--full'));
  assert.equal(read(f, '.rml-cache/consumers/nested-clone/tracked.rs'), 'uncommitted tracked edit');
  assert.equal(read(f, '.rml-cache/consumers/nested-clone/new-source.rs'), 'uncommitted untracked source');
  assert.equal(exists(f, '.rml-cache/consumers/nested-clone/.git'), true);
  assert.equal(exists(f, '.rml-cache/consumers/nested-clone/rust/target/debug/generated'), false);
});

test('unresolved external resource lease preserves active output and fails the wrapper', t => {
  const f = fixture(t);
  const result = f.wrap(writeProgram('.rml-cache/scratch/active') + writeProgram('.rml-cache/evidence/external-lease-fixture.json', '{"kind":"fixture"}'));
  assert.equal(result.status, 2);
  assert.equal(exists(f, '.rml-cache/scratch/active'), true);
  assert.notEqual(f.clean('--full').status, 0);
  assert.match(f.clean('--full').stderr, /external-resource lease/);
});

test('source-archive symlink state is rejected before creating anything outside the repository', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, '.git'), { recursive: true });
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-state-outside-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, path.join(f.root, '.rml-cache'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = f.wrap('process.exit(0)', [], { RML_CACHE_SOURCE_ARCHIVE: '1' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(external), []);
});

for (const scope of ['foreign-namespace', 'foreign-boot', 'unknown-identity', 'legacy-owner']) {
  test(`shared-filesystem ${scope} lease is deferred, never classified dead or removed`, t => {
    const f = fixture(t);
    ok(f.wrap(writeProgram('target/active-elsewhere')));
    const identity = process.platform === 'linux'
      ? { platform: process.platform, host: os.hostname(), bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), pidNamespace: fs.readlinkSync('/proc/self/ns/pid') }
      : { platform: process.platform, host: os.hostname(), bootId: 'test-boot', pidNamespace: 'test-realm' };
    const owner = { pid: 2147483647, child: 2147483646, host: os.hostname(), token: 'foreign-owner-token', processIdentity: { ...identity } };
    if (scope === 'foreign-namespace') owner.processIdentity.pidNamespace += ':foreign';
    if (scope === 'foreign-boot') owner.processIdentity.bootId += ':foreign';
    if (scope === 'unknown-identity') owner.processIdentity = { ...identity, pidNamespace: null };
    if (scope === 'legacy-owner') delete owner.processIdentity;
    const dir = path.join(f.root, '.git/rml-cache/lock');
    fs.mkdirSync(dir);
    const ownerFile = path.join(dir, 'owner.json');
    const serialized = JSON.stringify(owner);
    fs.writeFileSync(ownerFile, serialized);
    const result = f.run(['scripts/build-cache.mjs', '--full'], { RML_CACHE_LOCK_TIMEOUT_MS: '0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deferred.*foreign or unknown process namespace\/boot/);
    assert.doesNotMatch(result.stderr, /Abandoned/);
    assert.equal(fs.readFileSync(ownerFile, 'utf8'), serialized);
    assert.equal(read(f, 'target/active-elsewhere'), 'cache');
  });
}

test('matching token and colliding live PID never borrow a foreign namespace lease', { skip: process.platform !== 'linux' }, t => {
  const f = fixture(t);
  const dir = path.join(f.root, '.git/rml-cache/lock');
  fs.mkdirSync(dir, { recursive: true });
  const owner = { pid: process.pid, host: os.hostname(), token: 'colliding-token', processIdentity: {
    platform: 'linux', host: os.hostname(), bootId: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), pidNamespace: `${fs.readlinkSync('/proc/self/ns/pid')}:foreign`,
  } };
  fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner));
  const result = f.wrap(writeProgram('target/must-not-start'), [], { RML_CACHE_LEASE: owner.token, RML_CACHE_LOCK_TIMEOUT_MS: '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deferred/);
  assert.equal(exists(f, 'target/must-not-start'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')), owner);
});

test('new lease records its process identity before starting the owned command', t => {
  const f = fixture(t);
  ok(f.wrap("const fs=require('node:fs');const owner=JSON.parse(fs.readFileSync('.git/rml-cache/lock/owner.json','utf8'));if(!Object.hasOwn(owner,'processIdentity'))process.exit(19);if(process.platform==='linux'&&(!owner.processIdentity.bootId||!owner.processIdentity.pidNamespace))process.exit(20);"));
});

for (const platform of ['darwin', 'win32']) {
  test(`mocked ${platform} nested wrapper inherits a verified realm and rejects foreign boot/root`, async t => {
    const f = fixture(t);
    const { processIdentity, inheritedLease } = await import('./build-cache.mjs');
    const windowsRecord = { machineUuid: '11111111-2222-3333-4444-555555555555', bootId: '2026-10-07T01:00:00.0000000Z', rootPid: 40, rootStarted: '2026-10-07T01:00:01.0000000Z' };
    const calls = [];
    const mockRun = (command, args) => {
      calls.push([command, args]);
      if (platform === 'win32') return JSON.stringify(windowsRecord);
      assert.equal(args[1], 'kern.bootsessionuuid');
      return '11111111-2222-3333-4444-555555555555\n';
    };
    const identity = processIdentity({ platform, host: 'fixture-host', pid: 700, run: mockRun });
    assert.ok(identity.bootId && identity.pidNamespace);
    if (platform === 'win32') {
      assert.equal(calls[0][0], 'powershell.exe');
      for (const query of ['Win32_OperatingSystem', 'Win32_ComputerSystemProduct', 'Win32_Process', 'ParentProcessId', 'CreationDate']) assert.ok(calls[0][1].at(-1).includes(query));
    }
    const state = path.join(f.root, '.git/rml-cache');
    const dir = path.join(state, 'lock');
    fs.mkdirSync(dir, { recursive: true });
    const owner = { pid: process.pid, host: identity.host, token: `mock-${platform}`, processIdentity: identity };
    fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner));
    const previous = process.env.RML_CACHE_LEASE;
    process.env.RML_CACHE_LEASE = owner.token;
    try {
      // This is the same nested-wrapper entry point; only OS queries are mocked.
      assert.equal(inheritedLease({ state }, { identity }), true);
      assert.equal(inheritedLease({ state }, { identity: { ...identity, bootId: 'foreign-boot' } }), false);
      assert.equal(inheritedLease({ state }, { identity: { ...identity, pidNamespace: 'foreign-process-root' } }), false);
      assert.equal(inheritedLease({ state }, { identity: { ...identity, pidNamespace: null } }), false);
      const unavailable = processIdentity({ platform, host: 'fixture-host', run: () => { throw new Error('identity provider unavailable'); } });
      assert.equal(inheritedLease({ state }, { identity: unavailable }), false);
    } finally {
      if (previous === undefined) delete process.env.RML_CACHE_LEASE;
      else process.env.RML_CACHE_LEASE = previous;
    }
  });
}
