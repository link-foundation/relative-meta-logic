import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluate, isStructurallySame, keyOf } from '../src/rml-links.mjs';
import { LinkedProgramRegistry, directMatchTerm } from '../src/rml-linked-program.mjs';
import { verifyLinkedProof } from '../src/rml-linked-proof.mjs';

const cases = JSON.parse(readFileSync(new URL('../../test-corpus/structural-equality/cases.json', import.meta.url)));
const source = `(linked-program p)
(linked-rewrite p same (from (pair ?x ?x)) (to same))
(linked-program infer)
(linked-inference infer same (premise (pair ?x ?x)) (conclusion same))`;
const universal = readFileSync(new URL('../../lib/meta-theory/universal.lino', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('../../lib/meta-theory/proof-verifier.lino', import.meta.url), 'utf8');

test('public evaluator cannot report structural-equality proofs for different shapes', () => {
  for (const source of ['(? (a = (a)) with proof)', '(? ((a b) = a,b) with proof)']) {
    const result = evaluate(source);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.results, [0]);
    assert.notEqual(result.proofs[0][1], 'structural-equality');
  }
  const same = evaluate('(? (a = a) with proof)');
  assert.deepEqual(same.results, [1]);
  assert.equal(same.proofs[0][1], 'structural-equality');
});

test('public structural equality preserves shape and scalar coercion', () => {
  for (const { name, left, right, same } of cases.equalities) {
    assert.equal(isStructurallySame(left, right), same, name);
    assert.equal(isStructurallySame(right, left), same, `${name} reversed`);
    assert.equal(directMatchTerm(['pair', '?x', '?x'], ['pair', left, right]) !== null, same, name);
  }
  assert.equal(isStructurallySame(1, '1'), true);
  assert.equal(isStructurallySame([1], ['1']), true);
  assert.equal(isStructurallySame(1, ['1']), false);
  assert.equal(isStructurallySame('01', 1), false);
});

for (const executionBasis of ['direct-structural', 's-k']) {
  test(`${executionBasis}: repeated variables respect leaf/list identity in both reducers`, () => {
    const registry = LinkedProgramRegistry.fromRml(source, { executionBasis });
    for (const { name, left, right, same } of cases.equalities) {
      for (const [a, b] of [[left, right], [right, left]]) {
        const input = ['pair', a, b];
        const expected = same ? 'same' : input;
        assert.deepEqual(registry.reduce('p', input).term, expected, name);
        assert.deepEqual(registry.reduceResult('p', input, { maxSteps: 3 }).term, expected, name);
      }
    }
  });

  test(`${executionBasis}: display collisions cannot manufacture proofs or cycles`, () => {
    for (const { name, left, right } of cases.displayCollisions) {
      assert.equal(keyOf(left), keyOf(right), `${name}: public formatting remains unchanged`);
      for (const [goal, fact] of [[left, right], [right, left]]) {
        const registry = LinkedProgramRegistry.fromRml('(linked-program p)', { executionBasis });
        assert.equal(registry.prove('p', goal, { facts: [fact] }).ok, false, name);
        const search = registry.search('p', [goal, fact], { facts: [goal, fact] });
        assert.equal(search.ended, 'found', name);
        assert.equal(search.facts, 2, name);
        assert.deepEqual(search.goals.map(item => item.proof.judgement), [goal, fact], name);
        const rewrite = LinkedProgramRegistry.fromForms([
          ['linked-program', 'p'],
          ['linked-rewrite', 'p', 'distinct-shape', ['from', goal], ['to', fact]],
        ], { executionBasis });
        assert.deepEqual(rewrite.reduce('p', goal).term, fact, name);
        assert.deepEqual(rewrite.reduceResult('p', goal, { maxSteps: 3 }).term, fact, name);
      }
    }
  });

  test(`${executionBasis}: foundation matching distinguishes raw shapes`, () => {
    const registry = LinkedProgramRegistry.fromRml(universal, { executionBasis });
    for (const [left, right, same] of [['a', ['a'], false], [['a'], ['a'], true], ['', [], false]]) {
      const result = registry.reduce('links-meta-foundation', [
        'meta-match', ['atom', left], ['atom', right], ['no-bindings'],
      ]);
      assert.deepEqual(result.term, same ? ['match-ok', ['no-bindings']] : 'match-failed');
    }
  });

  test(`${executionBasis}: quoted proof contexts retain exact shape identity`, () => {
    const registry = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}`, { executionBasis });
    const context = ['proof-context', 'a', [['rule', 'axiom', [], 'holds']]];
    const candidate = ['proof', context, 'holds', 'root', [
      ['node', 'root', 'axiom', 'holds', [], [], ['axiom']],
    ], ['axiom']];
    assert.equal(verifyLinkedProof(registry, context, 'holds', candidate).accepted, true);
    const changed = structuredClone(context);
    changed[1] = ['a'];
    assert.equal(verifyLinkedProof(registry, changed, 'holds', candidate).accepted, false);
    assert.equal(verifyLinkedProof(registry, context, ['holds'], candidate).accepted, false);
  });
}

for (const executionBasis of ['direct-structural', 's-k', 'horn-relational']) {
  test(`${executionBasis}: inference cannot satisfy a repeated variable with different shapes`, () => {
    const registry = LinkedProgramRegistry.fromRml(source, { executionBasis });
    assert.equal(registry.prove('infer', 'same', { facts: [['pair', 'a', ['a']]] }).ok, false);
    assert.equal(registry.prove('infer', 'same', { facts: [['pair', ['a'], ['a']]] }).ok, true);
  });
}

test('horn-relational fact identity separates display collisions', () => {
  const registry = LinkedProgramRegistry.fromRml('(linked-program p)', { executionBasis: 'horn-relational' });
  for (const { name, left, right } of cases.displayCollisions) {
    assert.equal(registry.prove('p', left, { facts: [right] }).ok, false, name);
    assert.equal(registry.search('p', [left, right], { facts: [left, right] }).facts, 2, name);
  }
});
