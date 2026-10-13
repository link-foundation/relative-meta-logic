import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkedProgramRegistry as Baseline, directMatchTerm as baseMatch } from '../js/tests/fixtures/linked-program-before-dispatch.mjs';
import { LinkedProgramRegistry as Candidate, directMatchTerm as candidateMatch } from '../js/src/rml-linked-program.mjs';
const source = `
 (linked-program roots)
 (linked-rewrite roots repeated (from (choose ?large fixed ?large)) (to (selected ?large)))
 (linked-rewrite roots fallback (from (choose ?left ?guard ?right)) (to (fallback ?left ?right)))
 (linked-rewrite roots nested (from (inside ?x)) (to (done ?x)))
 (linked-rewrite roots same (from (stalled ?x)) (to (stalled ?x)))
 (linked-rewrite roots cycle-a (from left) (to right))
 (linked-rewrite roots cycle-b (from right) (to left))
 (linked-program derived (uses roots (rebind choose renamed)))
 (linked-rewrite derived priority (from (renamed local ?guard ?right)) (to local-first))
 (linked-program wildcard)
 (linked-rewrite wildcard first (from ?anything) (to stopped))
`;
const operations = ['bind-pattern-variables', 'compare-link-structure', 'substitute-bound-structures', 'select-and-traverse-rewrite-rules'];
function compare(name, input, options = {}, disabledOperations = []) {
 const before = Baseline.fromRml(source, { executionBasis: 'direct-structural', disabledOperations });
 const after = Candidate.fromRml(source, { executionBasis: 'direct-structural', disabledOperations });
 const run = system => {
   try { return { result: system.reduce(name, input, options), observation: system.runtimeSemanticTrace() }; }
   catch (error) { return { error: error.message, failure: error.reductionFailure, observation: system.runtimeSemanticTrace() }; }
 };
 const expected = run(before), actual = run(after); assert.deepEqual(actual, expected); return actual;
}
for (const [label, program, term] of [
 ['repeated variable succeeds', 'roots', ['choose', ['a', ['b']], 'fixed', ['a', ['b']]]],
 ['repeated variable fails', 'roots', ['choose', ['a'], 'fixed', ['b']]],
 ['late fixed guard fails after a large binding', 'roots', ['choose', Array.from({length:64},()=>['large','term']), 'wrong', 'last']],
 ['nested traversal', 'roots', ['outside', ['inside', ['a']]]],
 ['local rules precede imported rebound rules', 'derived', ['renamed', 'local', 'x', 'y']],
 ['rebinding retains source order', 'derived', ['renamed', ['a'], 'fixed', ['a']]],
 ['leaf and singleton array remain distinct', 'roots', ['choose', 'a', 'fixed', ['a']]],
 ['empty array and empty atom remain distinct', 'roots', ['choose', '', 'fixed', []]],
 ['wildcard first rule', 'wildcard', ['a']],
 ['stall failure', 'roots', ['stalled', 'a']],
 ['cycle failure', 'roots', 'left'],
]) {
 test(label, () => compare(program, term));
}
test('exact limit and invalid-bound failure contracts', () => {
 for (const maxSteps of [0, 1, 2]) compare('roots', ['outside', ['inside','x']], { maxSteps });
});
for (const first of operations) {
 test(`disabled first-error and complete observer contract: ${first}`, () => {
  for (const second of operations) compare('roots', ['choose', ['a'], 'wrong', ['b']], {}, [first, second]);
 });
}
test('public matching still returns detached substitutions and identical ordered observer events', () => {
 const input = ['choose', ['original'], 'fixed', ['original']];
 const pattern = ['choose', '?value', 'fixed', '?value'];
 const eventsA = [], eventsB = [];
 const a = baseMatch(pattern, input, new Map(), operation => eventsA.push(operation));
 const b = candidateMatch(pattern, input, new Map(), operation => eventsB.push(operation));
 assert.deepEqual(a,b); assert.deepEqual(eventsA, eventsB);
 input[1][0] = 'mutated'; assert.deepEqual(b.get('?value'), ['original']);
 b.get('?value')[0] = 'changed-result'; assert.equal(input[3][0], 'original');
});
test('private borrowed substitutions cannot alias returned normal forms or full traces', () => {
 const input = ['choose', ['original'], 'fixed', ['original']];
 const system = Candidate.fromRml(source, { executionBasis:'direct-structural' });
 const result = system.reduce('roots', input); const snapshot = structuredClone(result);
 input[1][0] = 'mutated'; assert.deepEqual(result, snapshot);
 result.term[1][0] = 'changed-result'; assert.equal(result.trace[0].after[1][0], 'original');
 assert.equal(input[3][0], 'original');
});
