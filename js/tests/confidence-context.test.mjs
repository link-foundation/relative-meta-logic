import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';

const source = ['lib/foundations/packages.lino', 'lib/foundations/confidence.lino', 'test-corpus/foundations/confidence-context.lino']
  .map(path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')).join('\n');
const expected = JSON.parse(readFileSync(new URL('../../test-corpus/foundations/expected.json', import.meta.url), 'utf8')).confidenceCombination;
const workspace = FoundationWorkspace.fromRml(source, { executionBasis: 'direct-structural' });
const unary = n => n === 0 ? 'z' : ['s', unary(n - 1)];
const ratio = (a, b) => ['ratio', unary(a), unary(b)];
const observations = [
  ['observation', 'meter-a', 'left', ratio(1, 2), ratio(3, 4)],
  ['observation', 'meter-b', 'right', ratio(1, 2), ratio(1, 2)],
];
const eventIndependence = ['independent-events', 'left', 'right'];
const confidenceIndependence = ['independent-confidence', 'left', 'right'];
const assumptions = [...observations, eventIndependence, confidenceIndependence];
const query = statement => ['estimate', statement, ['probability', '?p'], ['confidence', '?c'], ['depends', '?sources']];
const ask = (instance, statement = 'combined', facts = assumptions) => workspace.ask(instance, query(statement), { assumptions: facts });
const minimum = 'minimum-confidence-study';
const independent = 'independent-confidence-study';

function binding(result) {
  assert.equal(result.status, 'proved');
  assert.equal(result.answers.length, 1);
  return result.answers[0].bindings;
}

describe('linked probability and confidence dependency policies', () => {
  it('carries separate probability confidence and linked source dependencies under selected policies', () => {
    const min = binding(ask(minimum));
    const product = binding(ask(independent));
    assert.deepEqual(min['?p'], ratio(...expected.probability));
    assert.deepEqual(product['?p'], ratio(...expected.probability));
    assert.deepEqual(min['?c'], ratio(...expected.minimumConfidence));
    assert.deepEqual(product['?c'], ratio(...expected.independentConfidence));
    assert.deepEqual(product['?sources'], expected.sources);
    const description = workspace.describe('confidence-estimation', '2');
    assert.ok(description.rules.some(rule => rule.program === 'independent-confidence' && rule.rule === 'combine-confidence'));
    const reduction = workspace.execute(independent, ['confidence-combine', ratio(3, 4), ratio(1, 2)]);
    assert.deepEqual(reduction.output, ratio(3, 8));
    assert.ok(reduction.trace.some(step => step.program === 'independent-confidence'));
  });

  it('requires explicit event independence and separately requires confidence independence for multiplication', () => {
    assert.equal(ask(minimum, 'combined', observations).status, 'unknown');
    assert.equal(ask(independent, 'combined', observations).status, 'unknown');
    assert.equal(ask(minimum, 'combined', [...observations, eventIndependence]).status, 'proved');
    assert.equal(ask(independent, 'combined', [...observations, eventIndependence]).status, 'unknown');
    assert.equal(ask(independent, 'combined', [...observations, confidenceIndependence]).status, 'unknown');
    assert.equal(ask(independent).status, 'proved');
    assert.equal(ask(independent, 'combined', observations).status, 'unknown');
  });

  it('does not turn probability one or confidence zero into object-level truth or falsity', () => {
    const certain = ['observation', 'single', 'assertion', ratio(1, 1), ratio(0, 1)];
    const estimate = ask(independent, 'assertion', [certain]);
    assert.deepEqual(binding(estimate)['?p'], ratio(1, 1));
    assert.deepEqual(binding(estimate)['?c'], ratio(0, 1));
    const truth = workspace.ask(independent, ['holds', 'assertion'], { assumptions: [certain] });
    assert.equal(truth.status, 'unknown');
    assert.equal(truth.refutation.status, 'undefined');
    const zero = ['observation', 'single', 'assertion', ratio(0, 1), ratio(1, 1)];
    assert.equal(ask(independent, 'assertion', [zero]).status, 'proved');
    assert.equal(workspace.ask(independent, ['holds', 'assertion'], { assumptions: [zero] }).status, 'unknown');
  });

  it('rejects out-of-range and zero-denominator estimates without inventing a probability or proof', () => {
    for (const [p, c] of [[ratio(2, 1), ratio(1, 1)], [ratio(1, 0), ratio(1, 1)], [ratio(1, 1), ratio(3, 2)], [ratio(1, 1), ratio(0, 0)]]) {
      const facts = [['observation', 'invalid', 'assertion', p, c]];
      assert.equal(ask(independent, 'assertion', facts).status, 'unknown');
      const checked = workspace.ask(independent, ['checked-observation', 'invalid', 'assertion', '?p', '?c', '?validP', '?validC'], { assumptions: facts });
      const values = binding(checked);
      assert.ok(values['?validP'] === 'no' || values['?validC'] === 'no');
    }
    const cyclic = [...assumptions, ['independent-events', 'circular', 'left'], ['independent-confidence', 'circular', 'left']];
    assert.equal(ask(independent, 'circular', cyclic).status, 'unknown');
  });

  it('rechecks changed observation confidence and dependencies while preserving unrelated statements', () => {
    const combined = ask(independent);
    const right = ask(independent, 'right');
    const untouched = workspace.ask(independent, right.answers[0].judgement, { assumptions });
    const revisedObservation = ['observation', 'meter-a', 'left', ratio(1, 2), ratio(1, 4)];
    const { revisions } = workspace.revise([combined, untouched], { replaceAssumption: [observations[0], revisedObservation] });
    assert.equal(revisions[0].changed, true);
    assert.deepEqual(binding(revisions[0].after)['?p'], ratio(1, 4));
    assert.deepEqual(binding(revisions[0].after)['?c'], ratio(1, 8));
    assert.equal(revisions[1].action, 'kept');
    assert.equal(revisions[1].changed, false);
    assert.deepEqual(revisions[1].after.proof, untouched.proof);
    assert.deepEqual(untouched.dependencies.assumptions, [observations[1]]);
    const alteredDependency = { replaceRule: ['linked-fact', 'instrument-study', 'both-measurements', ['judgement', ['joint', 'combined', 'left', 'unobserved']]] };
    const dependencyRevision = workspace.revise([combined], alteredDependency).revisions[0];
    assert.equal(dependencyRevision.changed, true);
    assert.equal(dependencyRevision.after.status, 'unknown');
    const removedIndependence = workspace.revise([combined], { replaceAssumption: [confidenceIndependence, ['independent-confidence', 'other', 'right']] }).revisions[0];
    assert.equal(removedIndependence.after.status, 'unknown');
  });

  it('replaces a linked combination policy and invalidates only the selected foundation closure', () => {
    const product = ask(independent);
    const min = ask(minimum);
    const rule = ['linked-rewrite', 'independent-confidence', 'combine-confidence',
      ['from', ['confidence-combine', '?left', '?right']], ['to', '?left']];
    const changed = workspace.revise([product, min], { replaceRule: rule });
    assert.equal(changed.revisions[0].action, 'rechecked');
    assert.equal(changed.revisions[0].changed, true);
    assert.deepEqual(binding(changed.revisions[0].after)['?c'], ratio(3, 4));
    assert.deepEqual(binding(changed.revisions[0].after)['?p'], ratio(1, 4));
    assert.equal(changed.revisions[1].action, 'kept');
    assert.equal(changed.revisions[1].changed, false);
  });
  it('changes probability independently and exposes closed S/K evidence and bounded exhaustion', () => {
    const before = ask(independent);
    const revised = ['observation', 'meter-a', 'left', ratio(1, 1), ratio(3, 4)];
    const after = workspace.revise([before], { replaceAssumption: [observations[0], revised] }).revisions[0].after;
    assert.deepEqual(binding(after)['?p'], ratio(1, 2));
    assert.deepEqual(binding(after)['?c'], ratio(3, 8));
    const closed = FoundationWorkspace.fromRml(source);
    const reduction = closed.execute(independent, ['confidence-combine', ratio(3, 4), ratio(1, 2)]);
    assert.equal(reduction.executionBasis, 's-k');
    assert.deepEqual(reduction.output, ratio(3, 8));
    const leaf = ['estimate', 'left', ['probability', ratio(1, 2)], ['confidence', ratio(3, 4)], ['depends', ['source', 'meter-a']]];
    const result = closed.ask(independent, leaf, { assumptions: [observations[0]] });
    assert.equal(result.executionBasis, 's-k');
    assert.equal(result.status, 'proved');
    assert.deepEqual(result.proof.judgement, leaf);
    const bounded = FoundationWorkspace.fromRml(source, { maxContractions: 3000 });
    const exhausted = bounded.ask(independent, query('combined'), { assumptions });
    assert.equal(exhausted.status, 'exhausted');
    assert.equal(exhausted.reason, 'contraction-limit');
  });

});
