import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundationPackages } from '../src/rml-foundation-packages.mjs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import {
  fixtureNames,
  foundationLiterals,
  hostSources,
  occurrences,
} from './foundation-source-guard.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => readFileSync(new URL(`../../test-corpus/foundation-packages/${file}`, import.meta.url), 'utf8');
const fixture = JSON.parse(read('unseen-modal-frames.json'));
const vocabulary = JSON.parse(read('host-vocabulary.json'));
const manifests = fixture.packages.map(item => ({
  name: item.name, version: item.version, source: read(item.source), imports: item.imports,
}));
const versions = fixture.packages.map(item => item.version);
const selection = version => ({ name: 'modal-frames', version, instance: fixture.instance });
const direct = () => FoundationPackages.fromPackages(manifests, { executionBasis: 'direct-structural' });
const loaded = direct();
const queryCase = name => fixture.queries.find(item => item.name === name);
const ask = (packages, version, name, options = {}) => {
  const item = queryCase(name);
  return packages.ask(selection(version), item.query, {
    assumptions: item.assumptions ?? [], ...(item.maxFacts ? { maxFacts: item.maxFacts } : {}), ...options,
  });
};
const clone = value => structuredClone(value);
const hasHypothesis = proof => proof.program === '<hypothesis>' || proof.premises.some(hasHypothesis);

describe('an unseen links-only logic through the public package API', () => {
  it('executes every fixture query in all three foundation versions with distinct outcomes', () => {
    const kinds = new Set();
    for (const item of fixture.queries) {
      versions.forEach((version, index) => {
        const answer = ask(loaded, version, item.name);
        const { result } = answer;
        assert.equal(result.status, item.statuses[index], `${item.name} v${version}`);
        assert.equal(result.outcome.kind, item.outcomes[index], `${item.name} v${version}`);
        assert.deepEqual(result.foundation, { name: 'modal-frames', version });
        assert.deepEqual(result.assumptions, item.assumptions ?? []);
        assert.deepEqual(result.outcome, FoundationWorkspace.classifyOutcome(result));
        if (item.used) assert.deepEqual(result.outcome.assumptions, item.used);
        kinds.add(result.outcome.kind);
      });
    }
    const executions = fixture.executions.map(item => {
      const { result } = loaded.execute(selection('1'), item.term, item.maxSteps ? { maxSteps: item.maxSteps } : {});
      assert.equal(result.status, item.status, item.name);
      assert.equal(result.outcome.kind, item.outcome, item.name);
      if (item.output) assert.deepEqual(result.output, item.output);
      if (item.reason) assert.equal(result.reason, item.reason);
      assert.equal(result.outcome.establishes, false);
      kinds.add(result.outcome.kind);
      return result;
    });
    assert.equal(executions[0].trace[0].role, 'reduction');
    assert.deepEqual([...kinds].sort(), [...fixture.outcomeKinds].sort());
    assert.deepEqual(FoundationWorkspace.outcomes().map(item => item.kind), fixture.outcomeKinds);
  });

  it('separates truth, falsity, contradiction, assumption dependence and non-results', () => {
    const lab = ask(loaded, '1', 'lab-reaches-dry').result.outcome;
    assert.deepEqual([lab.truth, lab.establishes, lab.assumptionDependent], ['true', true, false]);
    const field = ask(loaded, '1', 'field-dead-end').result.outcome;
    assert.deepEqual([field.kind, field.truth], ['refuted', 'false']);
    const both = ask(loaded, '1', 'field-contradiction-under-assumption').result;
    assert.equal(both.status, 'contradictory');
    assert.deepEqual([both.outcome.kind, both.outcome.truth], ['assumption-dependent', 'both']);
    const unused = loaded.ask(selection('1'), queryCase('lab-reaches-dry').query, { assumptions: [['dead-end', 'w-unused']] }).result;
    assert.equal(unused.outcome.kind, 'proved');
    assert.deepEqual(unused.outcome.assumptions, []);
    for (const name of ['home-reaches-dry', 'bounded-search', 'outside-signature']) {
      const { outcome } = ask(loaded, '1', name).result;
      assert.deepEqual([outcome.truth, outcome.establishes], ['undetermined', false], name);
    }
  });

  it('describes the user foundation, its rule content and its cycle policy as data', () => {
    const origin = address => loaded.programs().find(item => item.address === address);
    const third = loaded.describe('modal-frames', '3');
    assert.deepEqual(third.cyclePolicy.kind, 'guarded-coinductive');
    const [guard] = third.cyclePolicy.guards;
    assert.deepEqual([origin(guard.program).version, origin(guard.program).program, guard.rule], ['1', 'frame-rules', 'path-step']);
    assert.deepEqual(third.roles.map(role => [role.role, origin(role.program).program]), [
      ['inference', 'frame-rules'], ['reduction', 'modal-abbreviations'], ['proof', 'modal-negation'],
    ]);
    assert.equal(third.ruleForms.length, third.rules.length);
    const pathStep = third.ruleForms.find(form => form[0] === 'linked-inference' && form[2] === 'path-step');
    assert.deepEqual(pathStep.slice(3), [
      ['premise', ['forces-at', '?w', '?phi']],
      ['premise', ['acc-arrow', '?w', '?v']],
      ['premise', ['forces-at', '?v', ['along-path', '?phi']]],
      ['conclusion', ['forces-at', '?w', ['along-path', '?phi']]],
    ]);
    const second = loaded.describe('modal-frames', '2');
    assert.equal(second.cyclePolicy.kind, 'inductive');
    assert.ok(second.ruleForms.some(form => form[2] === 'acc-compose'));
    assert.ok(!loaded.describe('modal-frames', '1').ruleForms.some(form => form[2] === 'acc-compose'));
  });

  it('keeps host foundation code free of the unseen logic and of new dispatch keys', () => {
    const names = fixtureNames(manifests.map(item => item.source));
    assert.ok(names.length >= 40);
    assert.ok(names.includes('forces-at') && names.includes('path-step') && names.includes('modal-frames'));
    assert.deepEqual(occurrences(names, hostSources(root)), []);
    const literals = foundationLiterals(root);
    assert.deepEqual(literals.filter(value => !vocabulary.literals.includes(value)), [],
      'a new identifier-like literal in a foundation module needs review in host-vocabulary.json');
    assert.deepEqual(vocabulary.literals.filter(value => names.includes(value)), []);
    for (const path of ['js/src/rml-foundation-workspace.mjs', 'js/src/rml-foundation-packages.mjs']) {
      const text = readFileSync(`${root}${path}`, 'utf8');
      assert.doesNotMatch(text, /\bswitch\s*\(/, path);
      assert.doesNotMatch(text, /\bcase\s+['"]/, path);
    }
    // The detector itself must notice an added logic-specific branch.
    const planted = [{ path: 'js/src/planted.mjs', text: "if (head === 'forces-at') return proved;" }];
    assert.deepEqual(occurrences(['forces-at'], planted), ['forces-at in js/src/planted.mjs']);
  });
});

describe('foundation-defined cycle policies and independent replay', () => {
  it('changes only the outcome governed by the declared policy or frame condition', () => {
    const orbit = versions.map(version => ask(loaded, version, 'orbit-dry-path').result);
    assert.deepEqual(orbit.map(result => result.status), ['unknown', 'unknown', 'proved']);
    assert.equal(orbit[2].reason, 'guarded-coinduction');
    assert.ok(hasHypothesis(orbit[2].proof));
    assert.equal(orbit[2].outcome.coinductive, true);
    assert.equal(orbit[0].coinduction, null);
    const home = versions.map(version => ask(loaded, version, 'home-reaches-dry').result);
    assert.deepEqual(home.map(result => result.status), ['unknown', 'proved', 'unknown']);
    assert.equal(orbit[2].theory.name, 'lab-frame');
    assert.deepEqual(versions.map(version => loaded.ask(selection(version), queryCase('orbit-dry-path').query).result.theory.name), ['lab-frame', 'lab-frame', 'lab-frame']);
  });

  it('rejects undeclared and unknown cycle policies instead of defaulting to induction', () => {
    const first = manifests[0];
    const without = { ...first, source: first.source.replace('(cycle-policy inductive)', '') };
    assert.throws(() => FoundationPackages.fromPackages([without]), /requires \(cycle-policy/);
    const unknown = { ...first, source: first.source.replace('(cycle-policy inductive)', '(cycle-policy productive-only)') };
    assert.throws(() => FoundationPackages.fromPackages([unknown]), /unknown cycle policy productive-only/);
    const third = manifests[2];
    const theoryGuard = { ...third, source: third.source.replace('(guard k-frame path-step)', '(guard shared-frame orbit-sees-orbit)') };
    assert.throws(() => FoundationPackages.fromPackages([manifests[0], theoryGuard]), /must name a rule of an inference or typing program/);
  });

  it('replays every established answer and every non-result without searching', () => {
    for (const item of fixture.queries) {
      for (const version of versions) {
        const answer = ask(loaded, version, item.name);
        const replay = loaded.replay(answer);
        assert.equal(replay.accepted, true, `${item.name} v${version}: ${replay.reason}`);
        assert.deepEqual(replay.outcome, answer.result.outcome);
        assert.deepEqual(replay.foundation, { name: 'modal-frames', version });
      }
    }
    const pattern = loaded.ask(selection('2'), ['forces-at', '?w', ['pos-dia', 'sample-dry']]);
    assert.deepEqual(pattern.result.answers.map(answer => answer.judgement[1]), ['w-ghost', 'w-home', 'w-lab', 'w-orbit']);
    const replay = loaded.replay(pattern);
    assert.equal(replay.accepted, true);
    assert.deepEqual(replay.checks.map(check => check.side), ['answer-1', 'answer-2', 'answer-3', 'answer-4']);
  });

  it('rejects forged proof steps, relabelled statuses and policy-violating hypotheses', () => {
    const rejects = (answer, mutate, reason) => {
      const copy = { ...answer, result: clone(answer.result) };
      mutate(copy.result);
      // Untracked copies are refused outright; tracked answers are replayed.
      assert.throws(() => loaded.replay(copy), /returned by this package workspace/);
      mutate(answer.result);
      assert.equal(loaded.replay(answer).reason, reason);
    };
    const fresh = (version, name) => ask(loaded, version, name);
    rejects(fresh('2', 'home-reaches-dry'), result => { result.proof.premises[2].judgement[1] = 'w-lab'; }, 'step-does-not-instantiate-rule');
    rejects(fresh('2', 'home-reaches-dry'), result => { result.proof.rule = 'box-elim'; }, 'step-does-not-instantiate-rule');
    rejects(fresh('2', 'home-reaches-dry'), result => { result.proof.premises.pop(); }, 'step-does-not-instantiate-rule');
    rejects(fresh('2', 'home-reaches-dry'), result => { result.proof.judgement = ['forces-at', 'w-lab', ['pos-dia', 'sample-dry']]; }, 'goal-mismatch');
    rejects(fresh('1', 'lab-wet-by-box'), result => { result.proof.role = 'theory'; }, 'role-mismatch');
    rejects(fresh('1', 'wild-under-assumptions'), result => { result.assumptions[0] = ['valuation-holds', 'w-lab', 'sample-tame']; }, 'forged-assumption');
    rejects(fresh('1', 'home-reaches-dry'), result => { result.status = 'proved'; }, 'evidence-status-mismatch');
    rejects(fresh('1', 'field-dead-end'), result => { result.status = 'proved'; }, 'evidence-status-mismatch');
    rejects(fresh('3', 'orbit-dry-path'), result => { result.cyclePolicy = { kind: 'inductive', guards: [] }; }, 'cycle-policy-mismatch');
    rejects(fresh('3', 'orbit-dry-path'), result => { result.foundation.version = '1'; }, 'foundation-mismatch');
    rejects(fresh('3', 'orbit-dry-path'), result => { result.coinduction.hypothesis = ['forces-at', 'w-lab', ['along-path', 'sample-dry']]; }, 'forged-hypothesis');
    // A guarded proof copied into an inductive version's result cannot pass.
    const guarded = fresh('3', 'orbit-dry-path').result;
    rejects(fresh('1', 'orbit-dry-path'), result => {
      Object.assign(result, { status: 'proved', proof: clone(guarded.proof), coinduction: clone(guarded.coinduction) });
    }, 'hypothesis-under-inductive-policy');
    // The hypothesis must sit beneath a final guard step.
    rejects(fresh('3', 'orbit-dry-path'), result => {
      const hypothesis = result.proof.premises[2];
      result.proof = { ...hypothesis, judgement: hypothesis.judgement };
    }, 'hypothesis-without-final-guard');
    rejects(fresh('3', 'lab-reaches-dry'), result => {
      result.proof.premises[2] = { judgement: result.proof.premises[2].judgement, program: '<hypothesis>', rule: 'coinductive-hypothesis', role: 'hypothesis', premises: [] };
    }, 'forged-hypothesis');
    assert.throws(() => loaded.replay(direct().ask(selection('1'), queryCase('lab-reaches-dry').query)), /returned by this package workspace/);
  });
});

describe('assumption isolation across versions, aliases and revisions', () => {
  it('never lets one version see assumptions, hypotheses or revisions of another', () => {
    const packages = direct();
    const wild = queryCase('wild-under-assumptions');
    const assumed = packages.ask(selection('2'), wild.query, { assumptions: wild.assumptions });
    assert.equal(assumed.result.outcome.kind, 'assumption-dependent');
    for (const version of versions) {
      const plain = packages.ask(selection(version), wild.query);
      assert.equal(plain.result.status, 'unknown', version);
      assert.deepEqual(plain.result.assumptions, []);
    }
    packages.ask(selection('3'), queryCase('orbit-dry-path').query);
    assert.equal(packages.ask(selection('1'), queryCase('orbit-dry-path').query).result.status, 'unknown');

    const answers = versions.map(version => packages.ask(selection(version), wild.query, { assumptions: wild.assumptions }));
    const revised = packages.revise(answers, selection('2'), {
      replaceAssumption: [['valuation-holds', 'w-lab', 'sample-wild'], ['valuation-holds', 'w-lab', 'sample-tame']],
    });
    assert.deepEqual(revised.revisions.map(item => item.action), ['kept', 'rechecked', 'kept']);
    assert.deepEqual(revised.revisions.map(item => item.after.result.status), ['proved', 'unknown', 'proved']);
    assert.deepEqual(revised.revisions[0].after.result.assumptions, wild.assumptions);
    assert.deepEqual(revised.revisions[2].after.result.outcome.assumptions, wild.used);
    assert.equal(revised.revisions[1].after.result.outcome.kind, 'unknown');
  });

  it('propagates a rule change through the aliased shared theory but keeps assumptions local', () => {
    const packages = direct();
    const answers = versions.map(version => ask(packages, version, 'lab-reaches-dry'));
    const changed = packages.revise(answers, selection('1'), { removeRule: ['lab-frame', 'field-is-dry'] });
    assert.deepEqual(changed.revisions.map(item => item.after.result.status), ['unknown', 'unknown', 'unknown']);
    assert.ok(changed.revisions.every(item => item.changed));
    assert.deepEqual(changed.revisions.map(item => item.after.result.assumptions), [[], [], []]);
    const orbit = changed.workspace.ask(selection('3'), queryCase('orbit-dry-path').query);
    assert.equal(orbit.result.status, 'proved');
    assert.equal(changed.workspace.replay(orbit).accepted, true);
  });
});

describe('the unseen logic on the default closed S/K public runtime', () => {
  it('derives guarded and refuted results and replays them', () => {
    const closed = FoundationPackages.fromPackages(manifests);
    const orbit = ask(closed, '3', 'orbit-dry-path');
    assert.equal(orbit.result.status, 'proved');
    assert.equal(orbit.result.executionBasis, 's-k');
    assert.equal(closed.replay(orbit).accepted, true);
    const field = ask(closed, '1', 'field-dead-end');
    assert.equal(field.result.outcome.kind, 'refuted');
    assert.equal(closed.replay(field).accepted, true);
    assert.equal(ask(closed, '1', 'orbit-dry-path').result.status, 'unknown');
  });
});
