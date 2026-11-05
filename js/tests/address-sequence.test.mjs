import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AddressSequence } from '../src/rml-address-sequence.mjs';

const corpus = JSON.parse(fs.readFileSync(new URL('../../test-corpus/address-sequences/cases.json', import.meta.url)));
function network() {
  const store = new AddressSequence();
  for (const { address, source, target } of corpus.links) store.defineLink(address, source, target);
  return store;
}
function changed(store, modify) {
  const snapshot = store.snapshot();
  modify(snapshot);
  return AddressSequence.fromSnapshot(snapshot);
}

test('preserves opaque link-valued elements and direct or indirect cycles in every finite sequence layout', () => {
  for (const layout of corpus.layouts) {
    const store = network();
    const head = store.encode(corpus.values, 'example', layout);
    assert.deepEqual(store.decode(head), corpus.values);
    assert.deepEqual(AddressSequence.fromSnapshot(store.snapshot()).decode(head), corpus.values);
    assert.deepEqual(store.decode(store.encode([], 'empty', layout)), []);
    assert.deepEqual(store.decode(store.encode(['opaque.link'], 'singleton', layout)), ['opaque.link']);
  }
});

test('distinguishes nested singleton sets while preserving duplicate elimination and Unicode address order', () => {
  const store = network();
  const inner = store.encodeSet(['a', 'a'], 'inner');
  const outer = store.encodeSet([inner, inner], 'outer');
  assert.notEqual(inner, outer);
  assert.deepEqual(store.decodeSet(inner), ['a']);
  assert.deepEqual(store.decodeSet(outer), [inner]);
  const first = store.encodeSet(corpus.setInput, 'first');
  const second = store.encodeSet([...corpus.setInput].reverse(), 'second', 'right');
  assert.deepEqual(store.decodeSet(first), corpus.setExpected);
  assert.deepEqual(store.decodeSet(second), corpus.setExpected);
  assert.deepEqual(AddressSequence.fromSnapshot(store.snapshot()).decodeSet(outer), [inner]);
});

test('constructor boundaries survive snapshot reconstruction and later definition of element addresses', () => {
  const store = new AddressSequence();
  const head = store.encode(['late.link'], 'stable');
  store.defineLink('late.link', 'nested.a', 'nested.b');
  assert.deepEqual(store.decode(head), ['late.link']);
  const snapshot = store.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(), ['links', 'namespace', 'schema']);
  assert.ok(snapshot.links.every(link => Object.keys(link).sort().join(',') === 'address,source,target'));
  assert.deepEqual(AddressSequence.fromSnapshot(JSON.parse(JSON.stringify(snapshot))).decode(head), ['late.link']);
  assert.deepEqual(AddressSequence.fromSnapshot(snapshot).snapshot(), snapshot);
});

test('rejects missing or corrupt constructors unknown tags dangling branches and duplicate identities', () => {
  const store = network();
  const head = store.encode(['a', 'b'], 'guard');
  assert.throws(() => changed(store, snapshot => { snapshot.links = snapshot.links.filter(link => link.address !== 'rml:address-sequence:1:element'); }), /constructor/);
  assert.throws(() => changed(store, snapshot => { snapshot.links.find(link => link.address === 'rml:address-sequence:1:element').target = 'other'; }), /constructor/);
  assert.throws(() => changed(store, snapshot => { snapshot.links.push(snapshot.links[0]); }), /duplicate/);
  assert.throws(() => changed(store, snapshot => { snapshot.links.find(link => link.address === head).source = 'unknown-tag'; }).decode(head), /unknown sequence constructor/);
  assert.throws(() => changed(store, snapshot => { snapshot.links = snapshot.links.filter(link => link.address !== 'guard.pair.0'); }).decode(head), /missing branch payload/);
  assert.throws(() => changed(store, snapshot => { snapshot.links = snapshot.links.filter(link => link.address !== 'guard.element.0'); }).decode(head), /missing sequence link/);
});

test('rejects structural cycles and bounds repeated shared syntax without traversing element cycles', () => {
  const store = network();
  const head = store.encode(['cycle.direct', 'cycle.first'], 'guard');
  assert.deepEqual(store.decode(head), ['cycle.direct', 'cycle.first']);
  assert.throws(() => changed(store, snapshot => { snapshot.links.find(link => link.address === 'guard.pair.0').source = head; }).decode(head), /cyclic sequence structure/);
  const shared = new AddressSequence();
  let current = shared.encode(['a'], 'leaf');
  for (let index = 0; index < 24; index++) {
    shared.defineLink(`payload.${index}`, current, current);
    current = shared.defineLink(`tree.${index}`, 'rml:address-sequence:1:branch', `payload.${index}`);
  }
  assert.throws(() => shared.decode(current, { maxNodes: 100 }), /node bound/);
  assert.throws(() => shared.decode(current, { maxElements: 10 }), /element bound/);
});

test('rejects colliding generated references atomically and rejects malformed or duplicate set views', () => {
  const store = network();
  const before = store.snapshot();
  assert.throws(() => store.encode(['collision.element.0'], 'collision'), /collision/);
  assert.deepEqual(store.snapshot(), before);
  const head = store.encode(['b', 'a'], 'unordered');
  assert.throws(() => store.decodeSet(head), /strict address order/);
  const duplicates = store.encode(['a', 'a'], 'duplicates');
  assert.throws(() => store.decodeSet(duplicates), /strict address order/);
  assert.throws(() => store.decodeOrderedSet(duplicates), /duplicate/);
  assert.throws(() => store.encodeOrderedSet(['a', 'a'], 'ordered'), /duplicate/);
  assert.deepEqual(store.decodeOrderedSet(store.encodeOrderedSet(['b', 'a'], 'valid')), ['b', 'a']);
  assert.throws(() => store.decode(head, { maxNodes: 0 }), /bounds/);
  assert.throws(() => store.encode(['a'], 'invalid', 'unknown'), /layout/);
  assert.throws(() => store.encode(['\ud800'], 'invalid'), /address/);
});

test('bounds input sequences and decodes deep finite doublet layouts without host recursion', () => {
  const store = new AddressSequence();
  assert.throws(() => store.encode(Array(10001).fill('a'), 'too-many'), /input bound/);
  assert.throws(() => store.encodeSet(Array(10001).fill('a'), 'too-many'), /input bound/);
  const values = Array.from({ length: 2000 }, (_, i) => `value.${i}`);
  const head = store.encode(values, 'deep', 'left');
  assert.deepEqual(store.decode(head), values);
});

test('matches the shared cross-runtime doublet snapshot for nested singleton sets', () => {
  const expected = JSON.parse(fs.readFileSync(new URL('../../test-corpus/address-sequences/snapshot.json', import.meta.url)));
  const store = new AddressSequence();
  const inner = store.encodeSet(['a'], 'single');
  const outer = store.encodeSet([inner], 'nested');
  assert.deepEqual(store.snapshot(), expected);
  assert.deepEqual(AddressSequence.fromSnapshot(expected).decodeSet(outer), [inner]);
});
