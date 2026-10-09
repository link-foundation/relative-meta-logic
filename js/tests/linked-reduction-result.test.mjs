import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { encodeLinkedProofData } from '../src/rml-linked-proof.mjs';

const source = `
(linked-program imported)
(linked-rewrite imported rename (from (source ?x)) (to (imported ?x)))
(linked-program probe (uses imported (rebind source mapped)))
(linked-rewrite probe first (from (pick ?x)) (to (chosen ?x)))
(linked-rewrite probe shadowed (from (pick a)) (to wrong))
(linked-rewrite probe root (from (choose (pick ?x))) (to (root ?x)))
(linked-program loop)
(linked-rewrite loop left (from left) (to right))
(linked-rewrite loop right (from right) (to left))
(linked-program stalled)
(linked-rewrite stalled unchanged (from (same ?x)) (to (same ?x)))
`;
const load = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

for (const executionBasis of ['s-k', 'direct-structural']) {
  describe(`result-only ordered reduction (${executionBasis})`, () => {
    const programs = LinkedProgramRegistry.fromRml(source, { executionBasis });

    it('matches full traces, first-match priority, traversal, and import rebinding', () => {
      for (const [input, expected, steps] of [
        [['wrap', ['pick', 'a'], ['pick', 'b']], ['wrap', ['chosen', 'a'], ['chosen', 'b']], 2],
        [['choose', ['pick', 'a']], ['root', 'a'], 1],
        [['mapped', 'a'], ['imported', 'a'], 1],
      ]) {
        const before = structuredClone(input);
        const full = programs.reduce('probe', input, { maxSteps: 8 });
        const result = programs.reduceResult('probe', input, { maxSteps: 8 });
        assert.deepEqual(result, { term: expected, steps });
        assert.deepEqual(result.term, full.term);
        assert.equal(result.steps, full.trace.length);
        assert.equal(result.steps, full.steps);
        assert.deepEqual(input, before);
        assert.equal(Object.hasOwn(result, 'trace'), false);
      }
      const full = programs.reduce('probe', ['pick', 'a']);
      assert.equal(full.trace[0].rule, 'first');
      assert.deepEqual(full.trace[0].before, ['pick', 'a']);
      assert.deepEqual(full.trace[0].after, ['chosen', 'a']);
    });

    it('returns unmatched and quoted forms unchanged with zero steps', () => {
      for (const input of ['unknown', [], ['pick'], ['choose', 'x'],
        encodeLinkedProofData(['choose', ['pick', 'a']])]) {
        const result = programs.reduceResult('probe', input, { maxSteps: 1 });
        assert.deepEqual(result, { term: input, steps: 0 });
        assert.deepEqual(result.term, programs.reduce('probe', input).term);
        if (Array.isArray(input)) assert.notEqual(result.term, input);
      }
    });

    it('bounds cycles by fuel and preserves immediate stalled failures', () => {
      assert.throws(() => programs.reduce('loop', 'left'), /rewrite cycle after 2 steps/);
      assert.throws(() => programs.reduceResult('loop', 'left', { maxSteps: 7 }),
        error => error.reductionFailure === 'rewrite-limit' && /limit 7 exceeded/.test(error.message));
      assert.throws(() => programs.reduceResult('stalled', ['same', 'a'], { maxSteps: 7 }),
        error => error.reductionFailure === 'rewrite-stalled' && /made no progress/.test(error.message));
    });

    it('uses the full reducer fuel boundary without returning an unchecked result', () => {
      for (const method of ['reduce', 'reduceResult']) {
        assert.throws(() => programs[method]('probe', ['pick', 'a'], { maxSteps: 1 }), /step limit 1/);
        assert.equal(programs[method]('probe', ['pick', 'a'], { maxSteps: 2 }).steps, 1);
      }
    });

    it('requires an explicit positive safe bound and a known program', () => {
      assert.throws(() => programs.reduceResult('probe', 'normal'), /maxSteps/);
      for (const maxSteps of [undefined, null, 0, -1, 1.5, NaN, Infinity, '8', Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => programs.reduceResult('probe', 'normal', { maxSteps }), /maxSteps/);
      }
      assert.throws(() => programs.reduceResult('missing', 'normal', { maxSteps: 1 }), /unknown.*program/);
    });

    it('rejects malformed and cyclic input without coercing it to an atom', () => {
      const cyclic = []; cyclic.push(cyclic);
      for (const input of [null, undefined, 1, true, {}, ['x', {}], new Array(1)]) {
        assert.throws(() => programs.reduceResult('probe', input, { maxSteps: 2 }), /only strings and arrays/);
      }
      assert.throws(() => programs.reduceResult('probe', cyclic, { maxSteps: 2 }), /finite, acyclic/);
      const shared = ['unknown'];
      assert.deepEqual(programs.reduceResult('probe', [shared, shared], { maxSteps: 1 }),
        { term: [['unknown'], ['unknown']], steps: 0 });
    });
  });
}

it('preserves the Horn identity reduction while requiring a known program', () => {
  const programs = LinkedProgramRegistry.fromRml(source, { executionBasis: 'horn-relational' });
  const input = ['pick', 'a'];
  assert.deepEqual(programs.reduceResult('probe', input, { maxSteps: 1 }), { term: input, steps: 0 });
  assert.throws(() => programs.reduceResult('missing', input, { maxSteps: 1 }), /unknown.*program/);
});

it('preserves the selected kernel, host-operation guards, and contraction bound', () => {
  const closed = LinkedProgramRegistry.fromRml(source, {
    disabledOperations: ['select-and-traverse-rewrite-rules', 'bind-pattern-variables'],
  });
  assert.deepEqual(closed.reduceResult('probe', ['pick', 'a'], { maxSteps: 2 }),
    { term: ['chosen', 'a'], steps: 1 });
  const direct = LinkedProgramRegistry.fromRml(source, {
    executionBasis: 'direct-structural', disabledOperations: ['select-and-traverse-rewrite-rules'],
  });
  assert.throws(() => direct.reduceResult('probe', ['pick', 'a'], { maxSteps: 2 }),
    /disabled host semantic operation select-and-traverse-rewrite-rules/);
  const tiny = LinkedProgramRegistry.fromRml(source, { maxContractions: 1 });
  assert.throws(() => tiny.reduceResult('probe', ['pick', 'a'], { maxSteps: 2 }),
    error => error.reductionFailure === 'contraction-limit');
});

it('matches a real bounded proof certificate full trace and every counted step', () => {
  const programs = LinkedProgramRegistry.fromRml(
    `${load('lib/meta-theory/universal.lino')}\n${load('lib/meta-theory/proof-verifier.lino')}`,
    { executionBasis: 'direct-structural' },
  );
  const fixture = JSON.parse(load('test-corpus/linked-proof/cases.json'))[0];
  const request = ['verify-linked-proof',
    ...[fixture.context, fixture.goal, fixture.candidate].map(value => encodeLinkedProofData(value))];
  const full = programs.reduce('linked-proof-verifier', request, { maxSteps: 262 });
  const result = programs.reduceResult('linked-proof-verifier', request, { maxSteps: 262 });
  assert.equal(full.term[0], 'proof-accepted');
  assert.equal(full.trace.length, 261);
  assert.deepEqual(result, { term: full.term, steps: full.trace.length });
  assert.throws(() => programs.reduceResult('linked-proof-verifier', request, { maxSteps: 261 }), /step limit/);
});
