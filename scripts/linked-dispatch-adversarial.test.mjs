import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkedProgramRegistry as Baseline, directMatchTerm as baseMatch } from '../js/tests/fixtures/linked-program-before-dispatch.mjs';
import { LinkedProgramRegistry as Candidate, directMatchTerm as candidateMatch } from '../js/src/rml-linked-program.mjs';

const operations = [
  'resolve-and-rebind-program-imports', 'enforce-cycle-and-resource-bounds',
  'select-and-traverse-rewrite-rules', 'compare-link-structure',
  'bind-pattern-variables', 'substitute-bound-structures',
];
const forms = rules => [
  ['linked-program', 'p'],
  ...rules.map(([pattern, replacement], index) => ['linked-rewrite', 'p', `r${index}`, ['from', pattern], ['to', replacement]]),
];
function run(Registry, sourceForms, input, maxSteps = 8, disabledOperations = []) {
  let registry;
  try {
    registry = Registry.fromForms(structuredClone(sourceForms), { executionBasis: 'direct-structural', disabledOperations });
    const result = registry.reduce('p', structuredClone(input), { maxSteps });
    return { result, observation: registry.runtimeSemanticTrace() };
  } catch (error) {
    return { error: error.message, errorName: error.name, failure: error.reductionFailure, observation: registry?.runtimeSemanticTrace() };
  }
}
function compare(sourceForms, input, maxSteps = 8, disabledOperations = []) {
  const expected = run(Baseline, sourceForms, input, maxSteps, disabledOperations);
  const actual = run(Candidate, sourceForms, input, maxSteps, disabledOperations);
  assert.deepEqual(actual, expected);
  return actual;
}

const fixtures = [
  ['fixed miss before wildcard', [[['miss', '?x'], 'skipped'], ['?all', 'stop']], ['hit', 'arg']],
  ['wildcard before fixed miss', [['?all', 'stop'], [['miss', '?x'], 'skipped']], ['hit', 'arg']],
  ['fixed misses before repeated variable failure', [[['a', '?x'], 'unused'], [['pair', '?x', '?x'], 'equal'], [['z'], 'unused'], [['pair', '?x', '?y'], 'different']], ['pair', ['a'], ['b']]],
  ['fixed misses after fallback match are not observed', [[['?head', '?x'], 'done'], [['a'], 'unused']], ['hit', 'arg']],
  ['quoted variable-looking head is literal', [[['"?head"', '?arg'], ['out', '?arg']], [['other', '?x'], 'none']], ['"?head"', 'x']],
  ['bare question-mark head is literal', [[['?', '?arg'], ['out', '?arg']]], ['?', 'x']],
  ['variable head stays fallback', [[['?head', 'x'], ['out', '?head']]], ['unindexed', 'x']],
  ['leaf candidate cannot match a fixed array pattern', [[['head', 'arg'], 'done']], 'head,arg'],
  ['leaf candidate cannot match an array with a variable', [[['head', '?arg'], ['out', '?arg']]], 'head,?arg'],
  ['nested singleton candidate head stays distinct', [[['head', 'arg'], 'done']], [['head'], 'arg']],
  ['nested comma candidate head stays distinct', [[['a,b', 'arg'], 'done']], [['a', 'b'], 'arg']],
  ['nested pattern head stays fallback', [[[['head'], 'arg'], 'done']], ['head', 'arg']],
  ['empty pattern stays fallback', [[[], 'done']], []],
  ['empty head and nested empty candidate', [[['', 'arg'], 'done']], [[], 'arg']],
  ['empty candidate does not dispatch', [[['a'], 'other'], [[], 'done']], []],
  ['same leading symbol different arities', [[['head', '?x', '?y'], 'wrong'], [['head', '?x'], ['out', '?x']]], ['head', 'x']],
  ['matching child after incompatible parent', [[['unused', '?x'], 'no'], [['leaf', '?x'], ['done', '?x']]], ['root', ['leaf', 'x']]],
  ['matching head child is visited first', [[['a'], 'head-rewritten'], ['a', 'atom-rewritten']], ['a', 'tail']],
  ['root priority over child match', [[['root', '?x'], 'root-first'], [['leaf', '?x'], 'child']], ['root', ['leaf', 'x']]],
  ['no rules', [], ['unmatched', 'arg']],
  ['only fixed mismatches', [[['a'], 'x'], [['b'], 'y']], ['z']],
  ['cycle keeps exact classification', [[['a'], ['b']], [['b'], ['a']]], ['a']],
  ['stall keeps exact classification', [[['a', '?x'], ['a', '?x']]], ['a', ['x']]],
];

for (const [name, rules, input] of fixtures) {
  test(name, () => {
    const source = forms(rules);
    for (const limit of [0, 1, 2, 8, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) compare(source, input, limit);
    for (const first of operations) {
      for (const second of operations) compare(source, input, 8, [first, second]);
    }
  });
}

test('import rebinding can change a fixed head into a variable', () => {
  const source = [
    ['linked-program', 'base'],
    ['linked-rewrite', 'base', 'fixed', ['from', ['rename-me', 'x']], ['to', 'done']],
    ['linked-program', 'p', ['uses', 'base', ['rebind', 'rename-me', '?head']]],
  ];
  compare(source, ['arbitrary', 'x']);
});

test('dispatch is rebuilt after public program mutation between reductions', () => {
  for (const Registry of [Baseline, Candidate]) {
    const system = Registry.fromForms(forms([[['old-head', '?x'], ['out', '?x']]]), { executionBasis: 'direct-structural' });
    const before = system.reduce('p', ['old-head', ['data']]);
    const snapshot = structuredClone(before);
    system.programs.get('p').rewrites[0].pattern[0] = 'new-head';
    system.programs.get('p').rewrites[0].replacement[0] = 'new-out';
    assert.deepEqual(before, snapshot);
    assert.deepEqual(system.reduce('p', ['new-head', ['data']]).term, ['new-out', ['data']]);
    assert.deepEqual(system.reduce('p', ['old-head', ['data']]).term, ['old-head', ['data']]);
  }
});

test('substitution and all trace snapshots remain independently owned', () => {
  const source = forms([[['copy', '?x'], ['out', '?x', '?x']]]);
  for (const Registry of [Baseline, Candidate]) {
    const input = ['copy', ['original']];
    const system = Registry.fromForms(structuredClone(source), { executionBasis: 'direct-structural' });
    const result = system.reduce('p', input);
    const snapshot = structuredClone(result);
    input[1][0] = 'input-mutated';
    system.programs.get('p').rewrites[0].replacement[0] = 'rule-mutated';
    assert.deepEqual(result, snapshot);
    result.term[1][0] = 'term-mutated';
    assert.deepEqual(result.term[2], ['original']);
    assert.deepEqual(result.trace[0].after, ['out', ['original'], ['original']]);
    result.trace[0].after[1][0] = 'trace-mutated';
    assert.deepEqual(result.trace[0].after[2], ['original']);
    assert.deepEqual(result.trace[0].before, ['copy', ['original']]);
  }
});

test('public matcher still has exactly the same callback event sequence', () => {
  for (const [, rules, input] of fixtures) {
    for (const [pattern] of rules) {
      const eventsA = [], eventsB = [];
      assert.deepEqual(candidateMatch(pattern, input, new Map(), x => eventsB.push(x)), baseMatch(pattern, input, new Map(), x => eventsA.push(x)));
      assert.deepEqual(eventsB, eventsA);
    }
  }
});

test('shared input DAGs do not introduce shared result or trace ownership', () => {
  const source = forms([[['pair', '?x', '?x'], ['out', '?x', '?x']]]);
  const shared = ['same', ['nested']];
  compare(source, ['pair', shared, shared]);
  const system = Candidate.fromForms(source, { executionBasis: 'direct-structural' });
  const result = system.reduce('p', ['pair', shared, shared]);
  shared[1][0] = 'source-mutated';
  assert.deepEqual(result.term, ['out', ['same', ['nested']], ['same', ['nested']]]);
  result.term[1][1][0] = 'result-mutated';
  assert.deepEqual(result.term[2], ['same', ['nested']]);
  assert.deepEqual(result.trace[0].after[1], ['same', ['nested']]);
});

test('Horn execution remains on its original no-reduction path', () => {
  const source = forms([[['head', '?x'], ['out', '?x']]]);
  const before = Baseline.fromForms(source, { executionBasis: 'horn-relational' });
  const after = Candidate.fromForms(source, { executionBasis: 'horn-relational' });
  const input = ['head', ['x']];
  assert.deepEqual(after.reduce('p', input), before.reduce('p', input));
  assert.deepEqual(after.runtimeSemanticTrace(), before.runtimeSemanticTrace());
});

test('deterministic mixed-head fixtures preserve full traces and observer reports', () => {
  let state = 0x12345678;
  const random = maximum => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maximum; };
  const leaves = ['a', 'b', 'c', 'x', 'y', '?', '"?quoted"', '', 'a,b'];
  const term = depth => depth === 0 || random(3) === 0 ? leaves[random(leaves.length)] : Array.from({ length: random(4) }, () => term(depth - 1));
  for (let trial = 0; trial < 160; trial += 1) {
    const rules = Array.from({ length: 1 + random(12) }, (_, index) => {
      const kind = random(5);
      const pattern = kind === 0 ? '?all' : kind === 1 ? [term(1), '?x'] : kind === 2 ? [leaves[random(leaves.length)], '?x', '?x'] : term(2);
      return [pattern, `result-${index}`];
    });
    const input = term(3);
    compare(forms(rules), input, 5);
    compare(forms(rules), input, 1, [operations[random(operations.length)], operations[random(operations.length)]]);
  }
});
