import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';
import { encodeLinkedProofData } from '../js/src/rml-linked-proof.mjs';

const options = { executionBasis: 'direct-structural' };
const forms = rules => [
  ['linked-program', 'p'],
  ...rules.map(([pattern, replacement], index) => [
    'linked-rewrite', 'p', `r${index}`, ['from', pattern], ['to', replacement],
  ]),
];
const operations = [
  'resolve-and-rebind-program-imports', 'enforce-cycle-and-resource-bounds',
  'select-and-traverse-rewrite-rules', 'compare-link-structure',
  'bind-pattern-variables', 'substitute-bound-structures',
];
function run(method, source, input, maxSteps = 8, disabledOperations = []) {
  let registry;
  try {
    registry = LinkedProgramRegistry.fromForms(structuredClone(source), {
      ...options, disabledOperations,
    });
    const { term, steps } = registry[method]('p', input, { maxSteps });
    return { result: { term, steps }, observation: registry.runtimeSemanticTrace() };
  } catch (error) {
    return {
      error: error.message, errorName: error.name, failure: error.reductionFailure,
      observation: registry?.runtimeSemanticTrace(),
    };
  }
}
function compare(source, input, maxSteps = 8, disabledOperations = []) {
  const full = run('reduce', source, input, maxSteps, disabledOperations);
  const result = run('reduceResult', source, input, maxSteps, disabledOperations);
  if (full.failure === 'rewrite-cycle') {
    // Result-only mode deliberately spends fuel instead of retaining history.
    assert.equal(result.failure, 'rewrite-limit');
    assert.equal(result.error, `rewrite step limit ${maxSteps} exceeded`);
    assert.deepEqual(result.observation, full.observation);
  } else assert.deepEqual(result, full);
  return result;
}

const adversarial = [
  ['fixed miss before wildcard', [[['miss', '?x'], 'skipped'], ['?all', 'stop']], ['hit', 'arg']],
  ['wildcard before fixed miss', [['?all', 'stop'], [['miss', '?x'], 'skipped']], ['hit', 'arg']],
  ['repeated variable failure', [[['a', '?x'], 'unused'], [['pair', '?x', '?x'], 'equal'], [['z'], 'unused'], [['pair', '?x', '?y'], 'different']], ['pair', ['a'], ['b']]],
  ['fallback before fixed mismatch', [[['?head', '?x'], 'done'], [['a'], 'unused']], ['hit', 'arg']],
  ['quoted variable-looking head', [[['"?head"', '?arg'], ['out', '?arg']]], ['"?head"', 'x']],
  ['bare question-mark head', [[['?', '?arg'], ['out', '?arg']]], ['?', 'x']],
  ['variable head', [[['?head', 'x'], ['out', '?head']]], ['unindexed', 'x']],
  ['leaf candidate versus array pattern', [[['head', 'arg'], 'done']], 'head,arg'],
  ['leaf candidate cannot bind an array pattern', [[['head', '?arg'], ['out', '?arg']]], 'head,?arg'],
  ['nested singleton head', [[['head', 'arg'], 'done']], [['head'], 'arg']],
  ['nested comma head', [[['a,b', 'arg'], 'done']], [['a', 'b'], 'arg']],
  ['nested pattern head', [[[['head'], 'arg'], 'done']], ['head', 'arg']],
  ['empty pattern', [[[], 'done']], []],
  ['empty atom and nested empty candidate', [[['', 'arg'], 'done']], [[], 'arg']],
  ['empty candidate', [[['a'], 'other'], [[], 'done']], []],
  ['same head and different arities', [[['head', '?x', '?y'], 'wrong'], [['head', '?x'], ['out', '?x']]], ['head', 'x']],
  ['child after incompatible parent', [[['unused', '?x'], 'no'], [['leaf', '?x'], ['done', '?x']]], ['root', ['leaf', 'x']]],
  ['head child before tail', [[['a'], 'head-rewritten'], ['a', 'atom-rewritten']], ['a', 'tail']],
  ['root before child', [[['root', '?x'], 'root-first'], [['leaf', '?x'], 'child']], ['root', ['leaf', 'x']]],
  ['no rules', [], ['unmatched', 'arg']],
  ['only fixed mismatches', [[['a'], 'x'], [['b'], 'y']], ['z']],
  ['cyclic rewrite', [[['a'], ['b']], [['b'], ['a']]], ['a']],
  ['stalled child after normal sibling', [[['same', '?x'], ['same', '?x']]], ['wrap', ['normal', ['data']], ['same', ['x']]]],
  ['array-to-leaf rewrite makes structural progress', [[['a'], 'a']], ['wrap', ['normal'], ['a']]],
];
for (const [name, rules, input] of adversarial) {
  test(`result sharing preserves ${name}`, () => {
    const source = forms(rules);
    for (const bound of [0, 1, 2, 8, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      compare(source, input, bound);
    }
    for (const first of operations) {
      for (const second of operations) compare(source, input, 8, [first, second]);
    }
  });
}

test('result sharing preserves every generic recursion normal form, step, and observer set', () => {
  const data = JSON.parse(readFileSync(new URL('../test-corpus/linked-dispatch/typed-recursion-cases.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../test-corpus/linked-dispatch/typed-recursion-source.lino', import.meta.url), 'utf8');
  let totalSteps = 0;
  for (const example of data.cases) {
    const full = LinkedProgramRegistry.fromRml(source, options);
    const result = LinkedProgramRegistry.fromRml(source, options);
    const expected = full.reduce(data.program, example.request, { maxSteps: data.maxSteps });
    const actual = result.reduceResult(data.program, example.request, { maxSteps: data.maxSteps });
    assert.deepEqual(actual, { term: expected.term, steps: expected.steps }, example.name);
    assert.equal(actual.steps, expected.trace.length, example.name);
    assert.deepEqual(result.runtimeSemanticTrace(), full.runtimeSemanticTrace(), example.name);
    totalSteps += actual.steps;
  }
  assert.equal(data.cases.length, 37);
  assert.equal(totalSteps, 9392);
});

test('shared substitutions still reduce each occurrence and return independent owned copies', () => {
  const rules = [[['copy', '?x'], ['out', '?x', '?x']], [['red', '?x'], ['done', '?x']]];
  const registry = LinkedProgramRegistry.fromForms(forms(rules), options);
  const shared = ['payload', ['nested']];
  const input = ['copy', ['pair', shared, shared, ['red', shared]]];
  const result = registry.reduceResult('p', input, { maxSteps: 4 });
  const expected = registry.reduce('p', input, { maxSteps: 4 });
  assert.deepEqual(result, { term: expected.term, steps: 3 });
  const snapshot = structuredClone(result);
  shared[1][0] = 'input-mutated';
  registry.programs.get('p').rewrites[0].replacement[0] = 'rule-mutated';
  assert.deepEqual(result, snapshot);
  result.term[1][1][1][0] = 'result-mutated';
  assert.deepEqual(result.term[1][2], ['payload', ['nested']]);
  assert.deepEqual(result.term[2], snapshot.term[2]);
  assert.deepEqual(expected.trace[0].after[1][1], ['payload', ['nested']]);
});

test('normal-subtree caches cannot survive rule, import, or program changes between calls', () => {
  const registry = LinkedProgramRegistry.fromForms([
    ['linked-program', 'base'],
    ['linked-rewrite', 'base', 'rename', ['from', ['old', '?x']], ['to', ['done', '?x']]],
    ['linked-program', 'p', ['uses', 'base', ['rebind', 'old', 'mapped']]],
    ['linked-program', 'q'],
  ], options);
  const input = ['mapped', ['data']];
  assert.equal(registry.reduceResult('q', input, { maxSteps: 2 }).steps, 0);
  assert.deepEqual(registry.reduceResult('p', input, { maxSteps: 2 }), { term: ['done', ['data']], steps: 1 });
  registry.programs.get('p').uses[0].rebindings.set('old', 'later');
  assert.equal(registry.reduceResult('p', input, { maxSteps: 2 }).steps, 0);
  input[0] = 'later';
  assert.equal(registry.reduceResult('p', input, { maxSteps: 2 }).steps, 1);
  registry.programs.get('base').rewrites[0].replacement[0] = 'changed';
  assert.deepEqual(registry.reduceResult('p', input, { maxSteps: 2 }).term, ['changed', ['data']]);
  registry.programs.get('base').rewrites[0].pattern[0] = 'fresh';
  assert.equal(registry.reduceResult('p', input, { maxSteps: 2 }).steps, 0);
  assert.deepEqual(registry.reduceResult('p', ['fresh', ['data']], { maxSteps: 2 }).term, ['changed', ['data']]);
});

test('rebinding a fixed rule head into a variable retains its ordered fallback semantics', () => {
  compare([
    ['linked-program', 'base'],
    ['linked-rewrite', 'base', 'fixed', ['from', ['renamed', 'x']], ['to', 'done']],
    ['linked-program', 'p', ['uses', 'base', ['rebind', 'renamed', '?head']]],
  ], ['arbitrary', 'x']);
});

test('quotes, malformed inputs, and externally shared normal DAGs retain their contracts', () => {
  const registry = LinkedProgramRegistry.fromForms(forms([[['red', '?x'], ['done', '?x']]]), options);
  const quoted = encodeLinkedProofData(['red', ['red', 'x']]);
  assert.deepEqual(registry.reduceResult('p', quoted, { maxSteps: 1 }), { term: quoted, steps: 0 });
  const shared = ['normal', ['data']];
  const result = registry.reduceResult('p', [shared, shared], { maxSteps: 1 });
  result.term[0][1][0] = 'changed';
  assert.deepEqual(result.term[1], shared);
  const cyclic = []; cyclic.push(cyclic);
  assert.throws(() => registry.reduceResult('p', cyclic, { maxSteps: 1 }), /finite, acyclic/);
  for (const input of [undefined, null, 1, true, {}, ['x', {}], new Array(1)]) {
    assert.throws(() => registry.reduceResult('p', input, { maxSteps: 1 }), /only strings and arrays/);
  }
});

test('result sharing retains both foundation observer path segments', () => {
  const source = '(linked-program links-meta-foundation)\n(linked-rewrite links-meta-foundation copy (from (copy ?x)) (to (pair ?x ?x)))';
  const full = LinkedProgramRegistry.fromRml(source, options);
  const result = LinkedProgramRegistry.fromRml(source, options);
  const input = ['wrap', ['normal', ['data']], ['copy', ['normal', ['data']]]];
  const expected = full.reduce('links-meta-foundation', input);
  assert.deepEqual(result.reduceResult('links-meta-foundation', input, { maxSteps: 2 }), { term: expected.term, steps: expected.steps });
  assert.deepEqual(result.runtimeSemanticTrace(), full.runtimeSemanticTrace());
});

test('mixed deterministic terms preserve result-only outcomes and first disabled errors', () => {
  let state = 0x12345678;
  const random = maximum => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  const leaves = ['a', 'b', 'c', 'x', 'y', '?', '"?quoted"', '', 'a,b'];
  const term = depth => depth === 0 || random(3) === 0
    ? leaves[random(leaves.length)]
    : Array.from({ length: random(4) }, () => term(depth - 1));
  for (let trial = 0; trial < 160; trial += 1) {
    const rules = Array.from({ length: 1 + random(12) }, (_, index) => {
      const kind = random(5);
      const pattern = kind === 0 ? '?all'
        : kind === 1 ? [term(1), '?x']
        : kind === 2 ? [leaves[random(leaves.length)], '?x', '?x'] : term(2);
      return [pattern, `result-${index}`];
    });
    const source = forms(rules), input = term(3);
    compare(source, input, 5);
    compare(source, input, 1, [operations[random(operations.length)], operations[random(operations.length)]]);
  }
});
