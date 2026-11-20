import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';

const source = readFileSync(new URL('../../test-corpus/foundations/foundation-context.lino', import.meta.url), 'utf8');
const expected = JSON.parse(readFileSync(new URL('../../test-corpus/foundations/expected.json', import.meta.url), 'utf8'));
const workspace = FoundationWorkspace.fromRml(source, { executionBasis: 'direct-structural' });
const signed = (polarity, item) => ['signed', polarity, item];
const ask = (instance, item, options) => workspace.ask(instance, signed('positive', item), options);
const hasHypothesis = proof => proof.program === '<hypothesis>' || proof.premises.some(hasHypothesis);

function checkContext(result, version, assumptions = []) {
  assert.deepEqual(result.foundation, { name: 'signed-network', version });
  assert.deepEqual(result.theory, { name: 'feedback-circuit', rebind: [] });
  assert.deepEqual(result.assumptions, assumptions);
  assert.equal(result.cyclePolicy.kind, version === '1' ? 'inductive' : 'guarded-coinductive');
  assert.equal(typeof result.bounds.maxSteps, 'number');
}

describe('foundation result context and two-sided guarded evidence', () => {
  it('checks guarded query and refutation independently even when the other side is already proved', () => {
    for (const item of ['gamma', 'delta', 'epsilon']) {
      const result = ask('guarded-circuit', item);
      assert.equal(result.status, 'contradictory', item);
      assert.deepEqual(result.proof.judgement, signed('positive', item));
      assert.deepEqual(result.refutation.proof.judgement, signed('negative', item));
      assert.equal(hasHypothesis(result.proof), item !== 'epsilon');
      assert.equal(hasHypothesis(result.refutation.proof), item !== 'delta');
      checkContext(result, '2');
    }
    assert.equal(ask('finite-circuit', 'gamma').status, 'unknown');
    assert.equal(ask('finite-circuit', 'delta').status, 'refuted');
    assert.equal(ask('finite-circuit', 'epsilon').status, 'proved');
  });

  it('keeps hypothetical evidence local and distinguishes guarded refutation from unknown', () => {
    const positive = ask('guarded-circuit', 'alpha');
    assert.equal(positive.status, 'proved');
    assert.equal(positive.coinduction.status, 'derived');
    assert.equal(positive.refutation.coinduction.status, 'not-derived');
    const negative = ask('guarded-circuit', 'beta');
    assert.equal(negative.status, 'refuted');
    assert.equal(negative.reason, 'guarded-coinductive-refutation');
    assert.equal(negative.coinduction.status, 'not-derived');
    assert.equal(negative.refutation.coinduction.status, 'derived');
    assert.deepEqual(negative.refutation.coinduction.hypothesis, signed('negative', 'beta'));
    for (const item of ['absent', 'loop']) {
      assert.equal(ask('guarded-circuit', item).status, 'unknown');
      assert.equal(ask('finite-circuit', item).status, 'unknown');
    }
  });

  it('keeps assumptions isolated across concurrent versions and repeated public queries', () => {
    const assumptions = [signed('positive', 'absent')];
    const proved = ask('finite-circuit', 'absent', { assumptions });
    assert.equal(proved.status, 'proved');
    checkContext(proved, '1', assumptions);
    for (const instance of ['guarded-circuit', 'finite-circuit', 'guarded-circuit']) {
      const result = ask(instance, 'absent');
      assert.equal(result.status, 'unknown');
      assert.deepEqual(result.assumptions, []);
      assert.deepEqual(result.dependencies.assumptions, []);
    }
    assumptions[0][2] = 'mutated-outside';
    assert.deepEqual(proved.assumptions, [signed('positive', 'absent')]);
    assert.deepEqual(workspace.foundations(), [
      { name: 'signed-network', version: '1' }, { name: 'signed-network', version: '2' },
    ]);
  });

  it('carries context on success unknown exhaustion unsupported and rewrite execution', () => {
    const outcomes = [
      ask('guarded-circuit', 'alpha'),
      ask('guarded-circuit', 'beta'),
      ask('guarded-circuit', 'gamma'),
      ask('guarded-circuit', 'absent'),
      ask('guarded-circuit', 'alpha', { maxFacts: 1 }),
      workspace.ask('guarded-circuit', ['outside', 'signature']),
    ];
    assert.deepEqual(outcomes.map(result => result.status), [
      'proved', 'refuted', 'contradictory', 'unknown', 'exhausted', 'unsupported',
    ]);
    for (const result of outcomes) checkContext(result, '2');
    const execution = workspace.execute('guarded-circuit', ['refutation-of', signed('positive', 'alpha')]);
    assert.equal(execution.status, 'normal');
    assert.deepEqual(execution.output, signed('negative', 'alpha'));
    checkContext(execution, '2');
    const stopped = workspace.execute('guarded-circuit', ['refutation-of', ['refutation-of', signed('positive', 'alpha')]], { maxSteps: 1 });
    assert.equal(stopped.status, 'exhausted');
    checkContext(stopped, '2');
    assert.equal(stopped.bounds.maxSteps, 1);
  });

  it('invalidates coinductive refutation dependencies without leaking across foundation versions', () => {
    const guarded = ask('guarded-circuit', 'beta');
    const finite = ask('finite-circuit', 'beta');
    const change = { removeRule: ['feedback-circuit', 'beta-negative'] };
    assert.ok(guarded.dependencies.rules.some(rule => rule.rule === 'negative-step'));
    assert.ok(guarded.dependencies.rules.some(rule => rule.rule === 'beta-negative'));
    const { revisions } = workspace.revise([guarded, finite], change);
    assert.equal(revisions[0].after.status, 'unknown');
    assert.equal(revisions[0].changed, true);
    assert.equal(revisions[1].after.status, 'unknown');
    assert.equal(revisions[1].changed, false);
    checkContext(revisions[0].after, '2');
    checkContext(revisions[1].after, '1');
  });
  it('does not conflate package names and versions containing the version delimiter', () => {
    const source = `
(linked-program empty)
(linked-foundation signed@network (version 1) (cycle-policy inductive))
(linked-foundation signed (version network@1) (cycle-policy inductive))
(linked-instance first (theory empty) (foundation signed@network (version 1)))
(linked-instance second (theory empty) (foundation signed (version network@1)))`;
    const loaded = FoundationWorkspace.fromRml(source, { executionBasis: 'direct-structural' });
    assert.equal(loaded.foundations().length, 2);
    assert.deepEqual(loaded.ask('first', 'x').foundation, { name: 'signed@network', version: '1' });
    assert.deepEqual(loaded.ask('second', 'x').foundation, { name: 'signed', version: 'network@1' });
  });

  it('reports exhaustion of either guarded search and preserves independently established evidence', () => {
    for (const item of ['alpha', 'beta']) {
      const result = ask('guarded-circuit', item, { maxFacts: 10 });
      assert.equal(result.status, 'exhausted');
      assert.equal(result.reason, 'guarded-fact-limit');
      assert.equal(result.search.ended, 'saturated');
      assert.equal(item === 'alpha' ? result.coinduction.status : result.refutation.status, 'not-derived-within-bounds');
    }
    const result = ask('guarded-circuit', 'epsilon', { maxFacts: 10 });
    assert.equal(result.status, 'proved');
    assert.equal(result.refutation.status, 'not-derived-within-bounds');
    assert.equal(result.refutation.coinduction.search.ended, 'fact-limit');
    assert.deepEqual(result.proof.judgement, signed('positive', 'epsilon'));
  });

  it('executes both guarded polarities through the default closed S/K public runtime', () => {
    const closed = FoundationWorkspace.fromRml(source);
    assert.equal(closed.executionBasis, 's-k');
    for (const { item, guarded: status, inductive } of expected.signedFeedback) {
      assert.equal(ask('finite-circuit', item).status, inductive, item);
      const result = closed.ask('guarded-circuit', signed('positive', item));
      assert.equal(result.status, status, item);
      checkContext(result, '2');
    }
  });

});
