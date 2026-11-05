import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initializeMetaLanguage, META_LANGUAGE_PATH, META_LANGUAGE_REVISION, META_LANGUAGE_URL } from './initialize-meta-language.mjs';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-meta-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'js'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "meta-language"]\n');
  fs.writeFileSync(path.join(root, 'js/package.json'), JSON.stringify({ imports: { '#meta-language': './vendor/meta-language/js/src/index.js' } }));
  const target = path.join(root, META_LANGUAGE_PATH);
  const populate = () => {
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.mkdirSync(path.join(target, 'js/src'), { recursive: true });
    fs.writeFileSync(path.join(target, 'js/src/index.js'), 'export {};\n');
  };
  if (options.populated) populate();
  const calls = [];
  const git = (cwd, args) => {
    calls.push({ cwd, args });
    if (args.join(' ') === 'rev-parse --show-toplevel') return cwd;
    if (args.includes('submodule.meta-language.path')) return META_LANGUAGE_PATH;
    if (args.includes('-f') && args.includes('submodule.meta-language.url')) return options.url ?? META_LANGUAGE_URL;
    if (args.join(' ') === 'config --get submodule.meta-language.url') return options.localUrl ?? META_LANGUAGE_URL;
    if (args[0] === 'ls-files') return `160000 ${options.index ?? META_LANGUAGE_REVISION} 0\t${META_LANGUAGE_PATH}`;
    if (args[0] === 'submodule') { populate(); return ''; }
    if (args.join(' ') === 'rev-parse HEAD') return options.revision ?? META_LANGUAGE_REVISION;
    if (args[0] === 'status') return options.dirty ?? '';
    throw new Error(`Unexpected test Git command: ${args.join(' ')}`);
  };
  return { root, target, calls, git, populate };
}

test('pinned meta-language initializer initializes only the absent exact registered source', t => {
  const f = fixture(t);
  assert.deepEqual(initializeMetaLanguage(f.root, f), { initialized: true, revision: META_LANGUAGE_REVISION });
  assert.deepEqual(f.calls.filter(call => call.args[0] === 'submodule').map(call => call.args), [['submodule', 'update', '--init', '--depth', '1', '--', META_LANGUAGE_PATH]]);
});

test('pinned meta-language initializer leaves a clean populated source unchanged', t => {
  const f = fixture(t, { populated: true });
  assert.deepEqual(initializeMetaLanguage(f.root, f), { initialized: false, revision: META_LANGUAGE_REVISION });
  assert.equal(f.calls.some(call => call.args[0] === 'submodule'), false);
});

for (const [name, options, expected] of [
  ['wrong revision', { populated: true, revision: '0'.repeat(40) }, /revision differs/u],
  ['dirty source', { populated: true, dirty: ' M js/src/index.js' }, /local changes/u],
  ['wrong indexed pointer', { index: '0'.repeat(40) }, /Git pointer differs/u],
  ['wrong registered URL', { url: 'https://example.test/other.git' }, /path or URL/u],
  ['wrong local URL', { localUrl: 'https://example.test/other.git' }, /local meta-language URL/u],
]) test(`pinned meta-language initializer refuses ${name} without resetting source`, t => {
  const f = fixture(t, options);
  assert.throws(() => initializeMetaLanguage(f.root, f), expected);
  assert.equal(f.calls.some(call => call.args[0] === 'submodule'), false);
});

test('pinned meta-language initializer refuses unowned populated directories and symlinks', t => {
  const f = fixture(t);
  fs.mkdirSync(f.target, { recursive: true });
  fs.writeFileSync(path.join(f.target, 'keep.txt'), 'keep');
  assert.throws(() => initializeMetaLanguage(f.root, f), /not an initialized/u);
  assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(f.calls.some(call => call.args[0] === 'submodule'), false);
  fs.rmSync(f.target, { recursive: true });
  fs.symlinkSync(path.join(f.root, 'js'), f.target, 'dir');
  assert.throws(() => initializeMetaLanguage(f.root, f), /symlink/u);
});

test('source archives and downstream directories never invoke Git', t => {
  const f = fixture(t, { populated: true });
  fs.rmSync(path.join(f.root, '.git'), { recursive: true });
  assert.equal(initializeMetaLanguage(f.root, { git: () => { throw new Error('Git must not run'); } }).reason, 'source archive');
  fs.rmSync(path.join(f.root, 'js/package.json'));
  assert.equal(initializeMetaLanguage(f.root, { git: () => { throw new Error('Git must not run'); } }).reason, 'no source-pinned dependency');
});
