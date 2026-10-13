import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cargoReferenceCommand, referencedUnits, sweepSupersededUnits, sweepAfterCargo } from './cargo-unit-sweep.mjs';

const NEW = '1111111111111111', OLD = '2222222222222222', TEST = '3333333333333333', REL = '4444444444444444', BUILD_NEW = '5555555555555555', BUILD_OLD = '6666666666666666', RUN_NEW = '7777777777777777';

function target(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rml cargo sweep ')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, bytes = 'x') => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.writeFileSync(path.join(root, relative), bytes); };
  for (const hash of [NEW, OLD]) {
    write(`debug/deps/librml-${hash}.rlib`, 'rlib-bytes');
    write(`debug/deps/librml-${hash}.rmeta`, 'meta');
    write(`debug/deps/rml-${hash}.d`, 'dep');
    write(`debug/.fingerprint/rml-${hash}/lib-rml`, 'fp');
  }
  // A test binary kind the library-only build did not reference is retained.
  write(`debug/deps/rml-${TEST}`, 'test-binary');
  write(`debug/.fingerprint/rml-${TEST}/test-bin-rml`, 'fp');
  write(`debug/build/links-notation-${BUILD_NEW}/build-script-build`, 'script');
  write(`debug/build/links-notation-${BUILD_OLD}/build-script-build`, 'old-script');
  write(`debug/build/links-notation-${RUN_NEW}/out/generated.rs`, 'generated');
  write(`debug/.fingerprint/links-notation-${BUILD_OLD}/build`, 'fp');
  // Another profile and uplifted artifacts are never in scope of a debug build.
  write(`release/deps/librml-${REL}.rlib`, 'release');
  write('debug/librml.rlib', 'uplifted');
  return { root, write };
}
const messages = root => [
  { reason: 'compiler-artifact', filenames: [path.join(root, `debug/deps/librml-${NEW}.rlib`), path.join(root, `debug/deps/librml-${NEW}.rmeta`)], fresh: true },
  { reason: 'compiler-artifact', filenames: [path.join(root, `debug/build/links-notation-${BUILD_NEW}/build-script-build`)], fresh: true },
  { reason: 'build-script-executed', out_dir: path.join(root, `debug/build/links-notation-${RUN_NEW}/out`) },
  { reason: 'build-finished', success: true },
].map(message => JSON.stringify(message)).join('\n');

test('only Cargo build, check, test and bench commands receive a non-running reference query', () => {
  assert.deepEqual(cargoReferenceCommand(['cargo', 'test', '--locked', '--all-targets']).query, ['cargo', 'test', '--locked', '--all-targets', '--message-format=json', '--no-run']);
  assert.deepEqual(cargoReferenceCommand(['/opt/bin/cargo', '+stable', 'build', '--manifest-path', 'rust/Cargo.toml']).query, ['/opt/bin/cargo', '+stable', 'build', '--manifest-path', 'rust/Cargo.toml', '--message-format=json']);
  assert.deepEqual(cargoReferenceCommand(['cargo', 'test', 'filter', '--', '--nocapture']).query, ['cargo', 'test', 'filter', '--message-format=json', '--no-run']);
  for (const command of [['cargo', 'run'], ['cargo', 'llvm-cov'], ['cargo', 'test', '--doc'], ['cargo', 'build', '--message-format=short'], ['node', 'build'], ['cargo']]) {
    assert.equal(cargoReferenceCommand(command).query, undefined, command.join(' '));
    assert.ok(cargoReferenceCommand(command).reason);
  }
});

test('superseded units of referenced kinds are removed while fresh, untouched and uplifted outputs stay', t => {
  const { root } = target(t);
  const referenced = referencedUnits(`warning: noise\n${messages(root)}\n`, root);
  assert.deepEqual([...referenced.profiles.keys()], ['debug']);
  const result = sweepSupersededUnits(root, referenced);
  assert.deepEqual(result.removed.sort(), [
    `debug/.fingerprint/links-notation-${BUILD_OLD}`, `debug/.fingerprint/rml-${OLD}`, `debug/build/links-notation-${BUILD_OLD}`,
    `debug/deps/librml-${OLD}.rlib`, `debug/deps/librml-${OLD}.rmeta`, `debug/deps/rml-${OLD}.d`,
  ]);
  assert.equal(result.reclaimedBytes, 'rlib-bytes'.length + 'meta'.length + 'dep'.length + 'fp'.length + 'old-script'.length + 'fp'.length);
  for (const kept of [`debug/deps/librml-${NEW}.rlib`, `debug/deps/rml-${NEW}.d`, `debug/.fingerprint/rml-${NEW}/lib-rml`, `debug/deps/rml-${TEST}`, `debug/build/links-notation-${BUILD_NEW}/build-script-build`, `debug/build/links-notation-${RUN_NEW}/out/generated.rs`, `release/deps/librml-${REL}.rlib`, 'debug/librml.rlib']) {
    assert.ok(fs.existsSync(path.join(root, kept)), kept);
  }
  // Repeating the sweep is idempotent.
  assert.deepEqual(sweepSupersededUnits(root, referencedUnits(messages(root), root)).removed, []);
});

test('a symlinked profile or deps directory is never followed', { skip: process.platform === 'win32' }, t => {
  const { root } = target(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-cargo-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, `librml-${OLD}.rlib`), 'outside');
  fs.rmSync(path.join(root, 'debug/deps'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'debug/deps'), 'dir');
  const result = sweepSupersededUnits(root, referencedUnits(messages(root), root));
  assert.ok(result.removed.every(item => !item.startsWith('debug/deps/')));
  assert.equal(fs.readFileSync(path.join(outside, `librml-${OLD}.rlib`), 'utf8'), 'outside');
});

test('no reported units, a failed query, or a disabled sweep deletes nothing', t => {
  const { root } = target(t);
  const before = fs.readdirSync(root, { recursive: true }).sort();
  assert.match(sweepSupersededUnits(root, referencedUnits('not json\n{"reason":"build-finished"}', root)).skipped, /no build units/);
  const failed = sweepAfterCargo(['cargo', 'build'], {}, root, { run: () => ({ status: 101, stdout: messages(root) }) });
  assert.match(failed.skipped, /reference query failed: exit 101/);
  const missing = sweepAfterCargo(['cargo', 'build'], {}, root, { run: () => ({ error: Object.assign(new Error('spawn cargo ENOENT'), { code: 'ENOENT' }) }) });
  assert.match(missing.skipped, /ENOENT/);
  let called = false;
  assert.match(sweepAfterCargo(['cargo', 'build'], { RML_CACHE_CARGO_SWEEP: '0' }, root, { run: () => { called = true; } }).skipped, /disabled/);
  assert.equal(called, false);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
  const swept = sweepAfterCargo(['cargo', 'build', '--locked'], {}, root, { run: (program, args) => { assert.deepEqual([program, ...args], ['cargo', 'build', '--locked', '--message-format=json']); return { status: 0, stdout: messages(root) }; } });
  assert.equal(swept.removed.length, 6);
  assert.equal(swept.referencedUnits, 3);
});
