import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { checkCurrentLinkedImplementation } from './check-linked-implementation.mjs';
import { discoverExecutableInventory } from './linked-executable-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'rml-ci-source-context-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const read = path => readFileSync(join(root, path), 'utf8');
const policy = JSON.parse(read('scripts/external-checkouts.json'));
const manifests = ['manifest.json', 'rust-manifest.json', 'configuration-manifest.json'];
const archives = ['implementation.links.json.gz', 'rust-implementation.links.json.gz', 'configuration.links.json.gz'];
const pinnedFiles = [...new Set(manifests.flatMap(name => {
  const manifest = JSON.parse(read(`lib/linked-runtime/${name}`));
  return (manifest.modules ?? manifest.files).map(item => item.path);
}).concat([...manifests, ...archives].map(name => `lib/linked-runtime/${name}`)))].sort();
function write(directory, path, text) {
  const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text);
}
function git(directory, args, options = {}) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', timeout: 30000, ...options });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); return result.stdout;
}
function stage(directory) {
  mkdirSync(directory, { recursive: true });
  for (const path of pinnedFiles) {
    mkdirSync(dirname(join(directory, path)), { recursive: true }); copyFileSync(join(root, path), join(directory, path));
  }
}

test('declared pinned third-party checkouts do not become owned implementation, while adjacent code still does', () => {
  const directory = join(scratch, 'external');
  write(directory, 'scripts/external-checkouts.json', JSON.stringify(policy));
  write(directory, 'owned/start.mjs', 'export const value = 1;\n');
  const baseline = discoverExecutableInventory(directory);
  write(directory, `${policy.checkouts[0].path}/upstream/compiler.mjs`, 'export const external = true;\n');
  write(directory, `${policy.checkouts[0].path}/upstream/build.py`, 'print("third party")\n');
  const external = discoverExecutableInventory(directory);
  assert.deepEqual(external.javascript, baseline.javascript);
  assert.ok(external.boundaries.some(item => item.path === policy.checkouts[0].path && item.role === 'declared-external-checkout'));
  write(directory, `${policy.checkouts[0].path}-owned/parser.mjs`, 'export const owned = true;\n');
  assert.ok(discoverExecutableInventory(directory).javascript.includes(`${policy.checkouts[0].path}-owned/parser.mjs`));
  for (const patch of [{ path: '../outside' }, { revision: 'main' }, { repository: '' }]) {
    write(directory, 'scripts/external-checkouts.json', JSON.stringify({ ...policy, checkouts: [{ ...policy.checkouts[0], ...patch }] }));
    assert.throws(() => discoverExecutableInventory(directory), /unsafe or unpinned external checkout boundary/);
  }
});

test('formal workflow checks out exactly the declared repository, revision and path', () => {
  const source = read('.github/workflows/formal-corpus.yml');
  const checkout = policy.checkouts[0];
  assert.match(source, new RegExp(`META_THEORY_REVISION: ${checkout.revision}(?:\\n|$)`));
  assert.equal(source.split(`repository: ${checkout.repository}\n`).length - 1, 3);
  assert.equal(source.split(`path: ${checkout.path}\n`).length - 1, 3);
  assert.equal(source.split('ref: ${{ env.META_THEORY_REVISION }}\n').length - 1, 3);
});

test('core.autocrlf checkout preserves every pinned byte and the ordinary guard still rejects an edited byte', () => {
  const directory = join(scratch, 'git-source'), checkout = join(scratch, 'git-checkout');
  stage(directory); mkdirSync(checkout);
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'core.autocrlf', 'true']);
  git(directory, ['add', '--all', '--force']);
  git(directory, ['checkout-index', '--all', `--prefix=${checkout.replaceAll('\\', '/')}/`]);
  for (const path of pinnedFiles) assert.deepEqual(readFileSync(join(checkout, path)), readFileSync(join(root, path)), path);
  assert.equal(checkCurrentLinkedImplementation(checkout).currentTreeConsistent, true);
  write(checkout, `${policy.checkouts[0].path}/foreign/logic.mjs`, 'export const foreign = true;\n');
  assert.equal(checkCurrentLinkedImplementation(checkout).currentTreeConsistent, true);
  const provider = 'scripts/linked-runtime-rust/Cargo.toml';
  write(checkout, provider, `${read(provider)}\n`);
  assert.throws(() => checkCurrentLinkedImplementation(checkout), /linked Rust generic tool sources differ/);
});

test('Docker supplies every pinned input before the ordinary guarded install or build', () => {
  const directory = join(scratch, 'docker-context'); stage(directory);
  git(directory, ['init', '--quiet']);
  write(directory, '.gitignore', read('.dockerignore'));
  // This context uses the shared Git/Docker ignore subset: names, directory
  // prefixes, *, ** and ordered ! exceptions. No Docker-only syntax is used.
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: directory, input: pinnedFiles.join('\n') + '\n', encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(ignored.error); assert.equal(ignored.status, 1, ignored.stdout + ignored.stderr);
  rmSync(join(directory, '.gitignore'));
  assert.equal(checkCurrentLinkedImplementation(directory).currentTreeConsistent, true);
  for (const path of ['docker/Dockerfile.js', 'docker/Dockerfile.rust']) {
    const source = read(path), copy = source.indexOf('\nCOPY . .\n'), guarded = source.indexOf('RUN node ../scripts/run-with-cache.mjs');
    assert.ok(copy >= 0 && copy < guarded, path);
    assert.doesNotMatch(source.slice(0, guarded), /--source-migration/);
  }
});

test('linked-target workflow fetches its own locked closure before offline native verification', () => {
  const workflow = read('.github/workflows/linked-target.yml');
  const fetch = workflow.indexOf('cargo fetch --locked --manifest-path rust/linked-target/Cargo.toml');
  const verify = workflow.indexOf('node scripts/verify-linked-target.mjs');
  assert.ok(fetch >= 0 && fetch < verify);
  assert.match(workflow.slice(workflow.lastIndexOf('\n', fetch), fetch), /run-with-cache\.mjs -- /);
  assert.match(read('scripts/verify-linked-target.mjs'), /'build', '--offline', '--locked'/);
});

test('full JavaScript CI installs the editor runtime dependency closure before source-free integration tests', () => {
  const workflow = read('.github/workflows/tests.yml');
  const install = workflow.indexOf('node scripts/run-with-cache.mjs -- npm --prefix vscode ci --omit=dev');
  const tests = workflow.indexOf('- name: Run full JS test suite');
  assert.ok(install >= 0 && install < tests);
  const editor = JSON.parse(read('vscode/package.json'));
  const lock = JSON.parse(read('vscode/package-lock.json'));
  assert.equal(editor.dependencies['links-notation'], lock.packages['node_modules/links-notation'].version);
});
