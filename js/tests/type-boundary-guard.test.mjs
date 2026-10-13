import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Env, MAX_LINO_NESTING_DEPTH, MAX_LINO_SOURCE_UNITS, check, checkNode,
  emitLinoTerm, synth, synthNode } from '../src/rml-links.mjs';

function nested(depth) {
  let node = 'leaf';
  for (let i = 0; i < depth; i++) node = [node];
  return node;
}

test('exact type APIs reject cyclic/deep/oversized inputs before traversal or mutation', () => {
  const cyclic = ['cycle']; cyclic.push(cyclic);
  const bad = [[cyclic, /cyclic array/], [nested(MAX_LINO_NESTING_DEPTH + 1), /nesting limit/],
    ['x'.repeat(MAX_LINO_SOURCE_UNITS + 1), /source length limit/]];
  for (const [input, message] of bad) {
    const env = new Env(); env.setTypeNode('kept', 'Original');
    const types = [...env.types], terms = [...env.terms];
    for (const operation of [
      () => env.setTypeNode(input, 'Other'),
      () => env.setTypeNode('kept', input),
      () => env.getTypeNode(input),
      () => synthNode(input, env),
      () => checkNode(input, 'T', env),
      () => checkNode(['lambda', ['T', 'fresh'], 'fresh'], input, env),
      () => synth(input, env),
      () => check('kept', input, env),
    ]) {
      assert.throws(operation, message);
      assert.deepEqual([...env.types], types, 'failed operation changed stored types');
      assert.deepEqual([...env.terms], terms, 'failed checker introduced a binding');
    }
  }
  assert.equal(cyclic[1], cyclic);
});

test('shared frozen DAG inputs remain unchanged and stored/returned types are independent', () => {
  const shared = Object.freeze(['constructor', 'label']);
  const term = Object.freeze(['pair', shared, shared]);
  const typ = Object.freeze(['TypeOf', shared, shared]);
  const env = new Env(); env.setTypeNode(term, typ);
  const stored = env.getTypeNode(term);
  assert.equal(stored, emitLinoTerm(typ));
  assert.equal(checkNode(term, typ, env).ok, true);
  const result = synthNode(term, env);
  assert.deepEqual(result.type, typ);
  result.type[1][1] = 'changed';
  assert.equal(env.getTypeNode(term), stored);
  assert.equal(term[1], shared); assert.equal(term[2], shared);
  assert.equal(typ[1], shared); assert.equal(typ[2], shared);
  assert.deepEqual(shared, ['constructor', 'label']);
});

test('type decoding preserves the exact nesting and source-size limits', () => {
  const env = new Env(), deepest = nested(MAX_LINO_NESTING_DEPTH);
  env.setTypeNode(deepest, 'T');
  assert.equal(synthNode(deepest, env).type, 'T');
  env.setTypeNode('deep-type', deepest);
  assert.deepEqual(synthNode('deep-type', env).type, deepest);
  assert.equal(checkNode('deep-type', deepest, env).ok, true);
  const largest = 'x'.repeat(MAX_LINO_SOURCE_UNITS);
  env.setTypeNode('large-type', largest);
  assert.equal(synthNode('large-type', env).type, largest);
});
