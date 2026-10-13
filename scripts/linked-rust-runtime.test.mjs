import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeLinkedValues, encodeLinkedValues } from './linked-runtime-graph.mjs';
import { readLinkedRustImplementation, rustImplementationModules } from './generate-linked-rust-runtime.mjs';

const archive = readLinkedRustImplementation();
const manifest = JSON.parse(readFileSync(new URL('../lib/linked-runtime/rust-manifest.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');

test('Rust implementation archive contains typed syntax for every pinned runtime and companion module', () => {
  const modules = rustImplementationModules(archive);
  assert.equal(Object.keys(modules).length, manifest.moduleCount);
  assert.ok(Object.keys(modules).length >= 31);
  for (const item of manifest.modules) {
    assert.equal(hash(JSON.stringify(modules[item.path])), item.astSha256, item.path);
    assert.ok(Array.isArray(modules[item.path].items), item.path);
    assert.equal(Object.hasOwn(modules[item.path], 'source'), false, item.path);
    assert.equal(item.verbatimNodes, 0, item.path);
  }
  assert.ok(modules['rust/src/lino_frontend.rs']);
  assert.ok(modules['rust/src/linked_proof.rs']);
  assert.ok(modules['rust/relational-kernel/src/horn_resolution.rs']);
  assert.ok(modules['scripts/linked-runtime-rust/src/main.rs']);
  assert.equal(hash(readFileSync(new URL('./linked-runtime-rust/Cargo.lock', import.meta.url))), manifest.toolLockSha256);
  assert.equal(manifest.fullImplementationClosure, false);
});

test('Rust authority can be edited structurally and restored with no source buffer', () => {
  const value = decodeLinkedValues(archive);
  const declaration = value.modules['rust/src/lino_frontend.rs'].items.find(item => item.const?.ident === 'MAX_LINO_NESTING_DEPTH');
  assert.deepEqual(declaration.const.expr, { lit: { int: '64' } });
  declaration.const.expr = { lit: { int: '2' } };
  const replacement = rustImplementationModules(encodeLinkedValues(value));
  assert.deepEqual(replacement['rust/src/lino_frontend.rs'].items.find(item => item.const?.ident === 'MAX_LINO_NESTING_DEPTH').const.expr, { lit: { int: '2' } });
  assert.deepEqual(rustImplementationModules(archive)['rust/src/lino_frontend.rs'].items.find(item => item.const?.ident === 'MAX_LINO_NESTING_DEPTH').const.expr, { lit: { int: '64' } });
});

test('Rust archive refuses a path escape instead of writing outside its generated tree', () => {
  const value = decodeLinkedValues(archive);
  value.modules['rust/src/../../escape.rs'] = { items: [] };
  assert.throws(() => rustImplementationModules(encodeLinkedValues(value)), /invalid Rust implementation module path/);
});
