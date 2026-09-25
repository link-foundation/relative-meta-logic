import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { keyOf } from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packages = readFileSync(
  resolve(here, '..', '..', 'lib', 'foundations', 'packages.lino'),
  'utf8',
);
const direct = FoundationWorkspace.fromRml(packages, { executionBasis: 'direct-structural' });

const unary = count => {
  let term = 'z';
  for (let index = 0; index < count; index += 1) term = ['s', term];
  return term;
};
const ratio = (part, whole) => ['ratio', unary(part), unary(whole)];
const contradiction = [['holds', 'rain'], ['holds', ['not', 'rain']]];
const weather = [
  ['value', 'rain', ['ratio', 'three', 'four']],
  ['value', 'sprinkler', ['ratio', 'two', 'four']],
  ['value', 'dark', ['ratio', 'two', 'four']],
];

// A logic none of the packages mentions, supplied only as links: necessity
// holds in every reachable world, and the second foundation adds
// reflexive access.
const unseenLogic = [
  '(linked-program necessity)',
  '(linked-inference necessity necessity-elimination',
  '  (premise (true-at ?world (box ?statement)))',
  '  (premise (reaches ?world ?other))',
  '  (conclusion (true-at ?other ?statement)))',
  '(linked-program reflexive-access)',
  '(linked-inference reflexive-access reflexivity',
  '  (premise (world ?world))',
  '  (conclusion (reaches ?world ?world)))',
  '(linked-foundation necessity-logic (version 1)',
  '  (inference necessity)',
  '  (signature (true-at ?world ?statement) (reaches ?world ?other) (world ?world))',
  '  (cycle-policy inductive))',
  '(linked-foundation reflexive-necessity-logic (version 1)',
  '  (depends-on necessity-logic (version 1))',
  '  (inference reflexive-access)',
  '  (cycle-policy inductive))',
  '(linked-program forecast)',
  '(linked-fact forecast now-is-a-world (judgement (world now)))',
  '(linked-fact forecast cold-is-necessary-now (judgement (true-at now (box cold))))',
  '(linked-instance forecast-with-necessity (theory forecast) (foundation necessity-logic))',
  '(linked-instance forecast-with-reflexive-necessity',
  '  (theory forecast)',
  '  (foundation reflexive-necessity-logic (version 1)))',
].join('\n');

function summary(result) {
  return {
    status: result.status,
    reason: result.reason,
    refutation: result.refutation?.status ?? null,
  };
}

function answers(result) {
  return result.answers.map(answer => keyOf(answer.judgement));
}

function proofRules(proof, output = new Set()) {
  output.add(`${proof.program}.${proof.rule}`);
  proof.premises.forEach(premise => proofRules(premise, output));
  return output;
}

function assertInsideK0(result) {
  const operations = new Set(LinkedProgramRegistry.bootstrapKernelReport().operations);
  for (const operation of result.hostOperations) {
    assert.ok(operations.has(operation), `${operation} is outside K0`);
  }
}

describe('linked foundation workspace', () => {
  it('reads versioned foundations, roles, and instances as inspectable data', () => {
    assert.deepEqual(
      direct.foundations().filter(item => item.name === 'resource-logic'),
      [{ name: 'resource-logic', version: '1' }, { name: 'resource-logic', version: '2' }],
    );
    assert.throws(() => direct.describe('resource-logic'), /ambiguous/);

    const classical = direct.describe('classical-logic');
    assert.equal(classical.schema, 'rml-foundation-package/v1');
    assert.deepEqual(classical.dependsOn, [{ name: 'intuitionistic-logic', version: '1' }]);
    assert.deepEqual(classical.closure.map(item => item.name), [
      'classical-logic',
      'intuitionistic-logic',
      'minimal-logic',
    ]);
    assert.deepEqual(
      classical.roles.map(({ role, program }) => `${role}:${program}`),
      [
        'inference:excluded-middle',
        'equality:double-negation',
        'inference:explosion',
        'inference:natural-deduction',
        'proof:refutation-by-negation',
      ],
    );
    assert.deepEqual(classical.signature, [['holds', '?p'], ['proposition', '?p']]);
    assert.deepEqual(classical.cyclePolicy, { kind: 'inductive', guards: [] });
    assert.ok(classical.rules.some(rule =>
      rule.program === 'double-negation' && rule.role === 'equality' && rule.kind === 'rewrite'));
    assert.equal(classical.bootstrap.kernel, 'K0');
    assert.deepEqual(
      classical.bootstrap.operations,
      LinkedProgramRegistry.bootstrapKernelReport().operations,
    );

    const resources = direct.describe('resource-logic', '2');
    assert.deepEqual(resources.dependsOn, [{ name: 'unary-arithmetic', version: '1' }]);
    assert.deepEqual(
      resources.roles.map(({ role, program }) => `${role}:${program}`),
      [
        'inference:budgeting',
        'truth:consumable-resources',
        'proof:unaffordability',
        'reduction:unary-calculation',
      ],
    );
    assert.deepEqual(
      direct.describe('productive-streams').cyclePolicy,
      {
        kind: 'guarded-coinductive',
        guards: [{ program: 'stream-typing', rule: 'productive-stream' }],
      },
    );

    const garden = direct.instances().find(item => item.name === 'garden-in-classical-logic');
    assert.deepEqual(garden, {
      name: 'garden-in-classical-logic',
      theory: {
        name: 'lawn',
        rebind: [{ from: 'wet-lawn', to: 'wet-garden' }, { from: 'rain', to: 'storm' }],
      },
      foundation: { name: 'classical-logic', version: '1' },
    });
    assert.deepEqual(
      FoundationWorkspace.roles().map(({ role, kind }) => `${role}:${kind}`),
      [
        'axioms:fact',
        'inference:inference',
        'typing:inference',
        'reduction:rewrite',
        'equality:rewrite',
        'truth:rewrite',
        'proof:rewrite',
      ],
    );
    assert.deepEqual(
      FoundationWorkspace.resultStatuses().map(item => item.status),
      ['proved', 'refuted', 'contradictory', 'unknown', 'exhausted', 'unsupported'],
    );
  });

  it('treats one unchanged theory classically, intuitionistically, and minimally', () => {
    const ask = (instance, query, assumptions = []) =>
      summary(direct.ask(instance, query, { assumptions }));
    const unknown = {
      status: 'unknown',
      reason: 'saturated-without-proof',
      refutation: 'not-derived',
    };

    const classical = direct.ask('lawn-in-classical-logic', ['holds', 'wet-lawn']);
    assert.deepEqual(summary(classical), {
      status: 'proved',
      reason: 'goal-derived',
      refutation: 'not-derived',
    });
    assert.ok(proofRules(classical.proof).has('excluded-middle.excluded-middle-for-proposition'));
    assert.equal(classical.foundation.version, '1');
    assert.equal(classical.theory.name, 'lawn');
    assert.deepEqual(classical.refutation.judgement, ['holds', ['not', 'wet-lawn']]);
    assert.deepEqual(ask('lawn-in-intuitionistic-logic', ['holds', 'wet-lawn']), unknown);
    assert.deepEqual(ask('lawn-in-minimal-logic', ['holds', 'wet-lawn']), unknown);

    // Double negation is an equality of the classical foundation only, so
    // only there does the refutation of "not wet" become "wet".
    const refuted = direct.ask('lawn-in-classical-logic', ['holds', ['not', 'wet-lawn']]);
    assert.deepEqual(summary(refuted), {
      status: 'refuted',
      reason: 'refutation-derived',
      refutation: 'derived',
    });
    assert.deepEqual(refuted.refutation.judgement, ['holds', 'wet-lawn']);
    assert.deepEqual(
      ask('lawn-in-intuitionistic-logic', ['holds', ['not', 'wet-lawn']]),
      unknown,
    );

    const garden = direct.ask('garden-in-classical-logic', ['holds', 'wet-garden']);
    assert.equal(garden.status, 'proved');
    assert.deepEqual(garden.theory.rebind, [
      { from: 'wet-lawn', to: 'wet-garden' },
      { from: 'rain', to: 'storm' },
    ]);
    assert.equal(direct.ask('garden-in-classical-logic', ['holds', 'wet-lawn']).status, 'unknown');
  });

  it('keeps contradictions local where the foundation has no explosion', () => {
    for (const instance of [
      'lawn-in-minimal-logic',
      'lawn-in-intuitionistic-logic',
      'lawn-in-classical-logic',
    ]) {
      const result = direct.ask(instance, ['holds', 'rain'], { assumptions: contradiction });
      assert.equal(result.status, 'contradictory', instance);
      assert.equal(result.proof.program, '<assumption>');
      assert.equal(result.refutation.proof.rule, 'assumption-2');
      assert.equal(result.dependencies.scope, 'evidence');
    }
    const frost = instance =>
      direct.ask(instance, ['holds', 'frost'], { assumptions: contradiction });
    assert.equal(frost('lawn-in-minimal-logic').status, 'unknown');
    const exploded = frost('lawn-in-intuitionistic-logic');
    assert.equal(exploded.status, 'proved');
    assert.equal(exploded.proof.rule, 'ex-falso');
    assert.equal(exploded.proof.role, 'inference');
    assert.deepEqual(exploded.assumptions, contradiction);
    assert.equal(frost('lawn-in-classical-logic').status, 'proved');

    // Assumptions belong to one question and never leak into the next.
    assert.equal(
      direct.ask('lawn-in-intuitionistic-logic', ['holds', 'frost']).status,
      'unknown',
    );
  });

  it('compares two versions of a resource-sensitive foundation', () => {
    const query = ['affordable', ['both', 'coffee', 'cake'], 'yes'];
    const ask = (instance, budget) =>
      direct.ask(instance, query, { assumptions: [['budget', budget]] });

    const reusable = ask('cafe-with-reusable-resources', 'one');
    assert.equal(reusable.status, 'proved');
    assert.deepEqual(reusable.foundation, { name: 'resource-logic', version: '1' });
    const consumable = ask('cafe-with-consumable-resources', 'one');
    assert.equal(consumable.status, 'refuted');
    assert.deepEqual(consumable.foundation, { name: 'resource-logic', version: '2' });
    assert.deepEqual(consumable.refutation.judgement, ['affordable', ['both', 'coffee', 'cake'], 'no']);
    assert.equal(ask('cafe-with-consumable-resources', 'two').status, 'proved');
    assert.deepEqual(
      consumable.dependencies.rules
        .filter(rule => rule.kind === 'rewrite')
        .map(rule => `${rule.role}:${rule.program}.${rule.rule}`),
      [
        'proof:unaffordability.refute-affordability',
        'reduction:unary-calculation.one-numeral',
      ],
    );

    const execution = direct.execute(
      'cafe-with-consumable-resources',
      ['at-most', ['combine', 'one', 'one'], 'two'],
    );
    assert.equal(execution.schema, 'rml-foundation-execution/v1');
    assert.equal(execution.status, 'normal');
    assert.equal(execution.output, 'yes');
    assert.deepEqual(execution.trace[0], {
      program: 'consumable-resources',
      rule: 'combine-consumable',
      role: 'truth',
      before: ['at-most', ['combine', 'one', 'one'], 'two'],
      after: ['at-most', ['plus', 'one', 'one'], 'two'],
    });
    assert.ok(execution.trace.slice(1).every(step => step.role === 'reduction'));
    const stopped = direct.execute(
      'cafe-with-consumable-resources',
      ['at-most', ['combine', 'one', 'one'], 'two'],
      { maxSteps: 2 },
    );
    assert.equal(stopped.status, 'exhausted');
    assert.equal(stopped.reason, 'rewrite-limit');
  });

  it('combines user-supplied degrees by the selected truth policy', () => {
    const degrees = (instance, statement, assumptions = weather) =>
      direct.ask(instance, ['value', statement, '?degree'], { assumptions });

    const minimum = degrees('weather-in-minimum-fuzzy-logic', 'wet-grass');
    assert.equal(minimum.status, 'proved');
    assert.equal(minimum.complete, true);
    assert.deepEqual(minimum.answers[0].bindings, { '?degree': ratio(3, 4) });
    assert.deepEqual(
      degrees('weather-in-minimum-fuzzy-logic', 'slippery').answers[0].bindings,
      { '?degree': ratio(2, 4) },
    );
    assert.deepEqual(
      degrees('weather-in-bounded-sum-fuzzy-logic', 'wet-grass').answers[0].bindings,
      { '?degree': ratio(4, 4) },
    );
    assert.deepEqual(
      degrees('weather-in-bounded-sum-fuzzy-logic', 'slippery').answers[0].bindings,
      { '?degree': ratio(2, 4) },
    );
    assert.deepEqual(
      degrees('weather-as-independent-probability', 'wet-grass').answers[0].bindings,
      { '?degree': ratio(14, 16) },
    );

    // Degrees are never built in: without supplied values nothing follows.
    const empty = degrees('weather-in-minimum-fuzzy-logic', 'wet-grass', []);
    assert.equal(empty.status, 'unknown');
    assert.equal(empty.complete, true);
    assert.deepEqual(empty.answers, []);

    const results = [
      degrees('weather-in-bounded-sum-fuzzy-logic', 'wet-grass'),
      degrees('weather-in-bounded-sum-fuzzy-logic', 'slippery'),
      direct.ask(
        'weather-in-bounded-sum-fuzzy-logic',
        ['value', 'dark', ['ratio', 'two', 'four']],
        { assumptions: weather },
      ),
    ];
    assert.equal(results[2].status, 'proved');
    assert.equal(results[2].dependencies.scope, 'evidence');
    assert.deepEqual(results[2].dependencies.assumptions, [weather[2]]);

    const drizzle = ['value', 'rain', ['ratio', 'one', 'four']];
    const { workspace, revisions } = direct.revise(results, {
      replaceAssumption: [weather[0], drizzle],
    });
    assert.equal(workspace, direct);
    assert.deepEqual(revisions.map(({ action, changed }) => `${action}:${changed}`), [
      'rechecked:true',
      'rechecked:true',
      'kept:false',
    ]);
    assert.deepEqual(revisions[0].after.answers[0].bindings, { '?degree': ratio(3, 4) });
    assert.deepEqual(revisions[1].after.answers[0].bindings, { '?degree': ratio(1, 4) });
    assert.deepEqual(revisions[2].after.assumptions, [drizzle, weather[1], weather[2]]);
  });

  it('types a self-unfolding stream only under guarded coinduction', () => {
    const ask = (instance, stream) => direct.ask(instance, ['stream', stream]);
    assert.equal(ask('finite-stream-examples', 'countdown').status, 'proved');
    assert.equal(ask('productive-stream-examples', 'countdown').status, 'proved');

    const finite = ask('finite-stream-examples', 'ones');
    assert.equal(finite.status, 'unknown');
    assert.equal(finite.coinduction, null);

    const productive = ask('productive-stream-examples', 'ones');
    assert.equal(productive.status, 'proved');
    assert.equal(productive.reason, 'guarded-coinduction');
    assert.deepEqual(productive.coinduction.guards, [
      { program: 'stream-typing', rule: 'productive-stream' },
    ]);
    assert.equal(productive.proof.program, 'stream-typing');
    assert.equal(productive.proof.rule, 'productive-stream');
    assert.deepEqual(productive.proof.judgement, ['stream', 'ones']);
    assert.deepEqual(
      productive.proof.premises.map(premise => premise.rule),
      ['ones-unfolds-into-itself', 'coinductive-hypothesis'],
    );
    assert.equal(productive.dependencies.scope, 'evidence');

    // A bare alias loop never passes the guard, so no foundation types it.
    for (const instance of ['finite-stream-examples', 'productive-stream-examples']) {
      assert.equal(ask(instance, 'loop').status, 'unknown', instance);
    }
    const loop = ask('productive-stream-examples', 'loop');
    assert.equal(loop.coinduction.status, 'not-derived');
    assert.equal(loop.coinduction.search.ended, 'saturated');

    const typed = direct.ask('productive-stream-examples', ['stream', '?stream']);
    assert.deepEqual(answers(typed), ['(stream countdown)', '(stream nil)']);
    assert.equal(typed.complete, false);
  });

  it('runs a logic supplied only as links through the same interface', () => {
    const workspace = FoundationWorkspace.fromRml(unseenLogic, {
      executionBasis: 'direct-structural',
    });
    const cold = ['true-at', 'now', 'cold'];
    assert.equal(workspace.ask('forecast-with-necessity', cold).status, 'unknown');
    const reflexive = workspace.ask('forecast-with-reflexive-necessity', cold);
    assert.equal(reflexive.status, 'proved');
    assert.deepEqual(reflexive.proof.premises.map(premise => premise.rule), [
      'cold-is-necessary-now',
      'reflexivity',
    ]);
    assert.equal(reflexive.refutation.status, 'undefined');
    assert.deepEqual(workspace.describe('reflexive-necessity-logic').closure, [
      { name: 'reflexive-necessity-logic', version: '1' },
      { name: 'necessity-logic', version: '1' },
    ]);

    const source = readFileSync(
      resolve(here, '..', 'src', 'rml-foundation-workspace.mjs'),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /classical|intuitionis|minimal|modal|necess|fuzzy|probab|resource|stream|paraconsist|excluded|explosion|negation|łukasiewicz|lukasiewicz|gödel|godel/i,
    );
  });

  it('reports unknown, exhaustion, and unsupported outcomes separately', () => {
    const outside = direct.ask('lawn-in-classical-logic', ['stream', 'ones']);
    assert.equal(outside.status, 'unsupported');
    assert.equal(outside.reason, 'outside-signature');
    assert.match(outside.detail, /^signature: \(stream ones\)/);
    const pattern = direct.ask('lawn-in-classical-logic', ['holds', '?statement']);
    assert.equal(pattern.status, 'proved');
    assert.ok(answers(pattern).includes('(holds wet-lawn)'));
    assert.equal(
      direct.ask('lawn-in-classical-logic', ['holds', 'wet-lawn'], {
        assumptions: [['weather', 'rain']],
      }).reason,
      'outside-signature',
    );

    const limited = direct.ask('lawn-in-classical-logic', ['holds', 'wet-lawn'], {
      maxFacts: 3,
    });
    assert.equal(limited.status, 'exhausted');
    assert.equal(limited.reason, 'fact-limit');
    assert.equal(limited.refutation.status, 'not-derived-within-bounds');

    const steps = direct.ask(
      'cafe-with-consumable-resources',
      ['costs', 'coffee', ['plus', 'two', 'two']],
      { maxSteps: 2 },
    );
    assert.equal(steps.status, 'exhausted');
    assert.equal(steps.reason, 'rewrite-limit');
    assert.match(steps.detail, /^goal: /);

    const cycle = FoundationWorkspace.fromRml([
      '(linked-program flip-flop)',
      '(linked-rewrite flip-flop flip (from flip) (to flop))',
      '(linked-rewrite flip-flop flop (from flop) (to flip))',
      '(linked-foundation flip-flop-logic (version 1)',
      '  (equality flip-flop)',
      '  (cycle-policy inductive))',
      '(linked-program switch)',
      '(linked-fact switch on (judgement (state on)))',
      '(linked-instance switch-in-flip-flop-logic',
      '  (theory switch)',
      '  (foundation flip-flop-logic))',
    ].join('\n'), { executionBasis: 'direct-structural' });
    const cyclic = cycle.ask('switch-in-flip-flop-logic', ['state', 'flip']);
    assert.equal(cyclic.status, 'unsupported');
    assert.equal(cyclic.reason, 'rewrite-cycle');
    assert.match(cyclic.detail, /^goal: rewrite cycle/);
    assert.equal(cycle.ask('switch-in-flip-flop-logic', ['state', 'on']).status, 'proved');

    assert.throws(
      () => direct.ask('lawn-in-classical-logic', ['holds', 'rain'], {
        assumptions: [['holds', '?anything']],
      }),
      /must be ground/,
    );
    assert.throws(
      () => direct.ask('lawn-in-classical-logic', ['holds', 'lawn-in-classical-logic--answer']),
      /reserves lawn-in-classical-logic--answer/,
    );
    assert.throws(() => direct.ask('missing-instance', ['holds', 'rain']), /unknown linked-instance/);
  });

  it('tells which results a change of a rule or an assumption affects', () => {
    const countdown = direct.ask('productive-stream-examples', ['stream', 'countdown']);
    const loop = direct.ask('productive-stream-examples', ['stream', 'loop']);
    const wet = direct.ask('lawn-in-classical-logic', ['holds', 'wet-lawn']);
    const outside = direct.ask('lawn-in-classical-logic', ['stream', 'ones']);

    assert.equal(countdown.dependencies.scope, 'evidence');
    assert.deepEqual(
      countdown.dependencies.rules.map(rule => `${rule.kind}:${rule.program}.${rule.rule}`),
      [
        'fact:stream-examples.countdown-unfolds-into-nil',
        'fact:stream-examples.nil-is-empty',
        'inference:stream-typing.empty-stream',
        'inference:stream-typing.productive-stream',
      ],
    );
    const removeAlias = { removeRule: ['stream-examples', 'loop-aliases-itself'] };
    assert.equal(direct.affectedBy(countdown, removeAlias), false);
    assert.equal(direct.affectedBy(loop, removeAlias), true);
    assert.equal(direct.affectedBy(countdown, { removeRule: ['stream-examples', 'nil-is-empty'] }), true);
    const addFact = {
      addRule: ['linked-fact', 'stream-examples', 'more', ['judgement', ['empty', 'more']]],
    };
    assert.equal(direct.affectedBy(countdown, addFact), false);
    assert.equal(direct.affectedBy(loop, addFact), true);
    assert.equal(direct.affectedBy(wet, addFact), false);
    const addRewrite = {
      addRule: ['linked-rewrite', 'stream-examples', 'rename', ['from', 'nil'], ['to', 'empty-list']],
    };
    assert.equal(direct.affectedBy(countdown, addRewrite), true);
    assert.equal(direct.affectedBy(outside, { removeRule: ['lawn', 'rain-wets-the-lawn'] }), false);
    assert.equal(
      direct.affectedBy(wet, { replaceAssumption: [['holds', 'rain'], ['holds', 'frost']] }),
      false,
    );

    const { workspace, revisions } = direct.revise([wet, countdown], {
      removeRule: ['excluded-middle', 'excluded-middle-for-proposition'],
    });
    assert.notEqual(workspace, direct);
    assert.deepEqual(revisions.map(({ action, changed }) => `${action}:${changed}`), [
      'rechecked:true',
      'kept:false',
    ]);
    assert.equal(revisions[0].after.status, 'unknown');
    assert.equal(direct.ask('lawn-in-classical-logic', ['holds', 'wet-lawn']).status, 'proved');
    assert.throws(
      () => direct.revise([wet], { removeRule: ['lawn', 'no-such-rule'] }),
      /no linked rule lawn.no-such-rule/,
    );
    assert.throws(
      () => direct.revise([wet], {
        addRule: ['linked-rewrite', 'natural-deduction', 'tidy', ['from', 'x'], ['to', 'y']],
      }),
      /admits only inference rules/,
    );
  });

  it('rejects malformed foundations and instances', () => {
    const load = lines => FoundationWorkspace.fromRml(lines.join('\n'), {
      executionBasis: 'direct-structural',
    });
    const base = [
      '(linked-program rules)',
      '(linked-inference rules step (premise (a ?x)) (conclusion (b ?x)))',
      '(linked-program facts)',
      '(linked-fact facts one (judgement (a one)))',
    ];
    assert.throws(
      () => load([...base, '(linked-foundation f (inference rules) (cycle-policy inductive))']),
      /requires \(version value\)/,
    );
    assert.throws(
      () => load([...base, '(linked-foundation f (version 1) (inference rules))']),
      /requires \(cycle-policy/,
    );
    assert.throws(
      () => load([...base, '(linked-foundation f (version 1) (magic rules) (cycle-policy inductive))']),
      /unsupported clause magic/,
    );
    assert.throws(
      () => load([...base, '(linked-foundation f (version 1) (inference missing) (cycle-policy inductive))']),
      /inference program missing is not a linked-program/,
    );
    assert.throws(
      () => load([...base, '(linked-foundation f (version 1) (reduction rules) (cycle-policy inductive))']),
      /admits only rewrite rules/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-foundation f (version 1) (inference rules) (cycle-policy guarded-coinductive (guard facts one)))',
      ]),
      /must name a rule of an inference or typing program/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-foundation f (version 1) (depends-on g (version 1)) (cycle-policy inductive))',
        '(linked-foundation g (version 1) (depends-on f (version 1)) (cycle-policy inductive))',
      ]),
      /dependency cycle/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-foundation f (version 1) (cycle-policy inductive))',
        '(linked-foundation f (version 2) (cycle-policy inductive))',
        '(linked-instance i (theory facts) (foundation f))',
      ]),
      /ambiguous among versions 1, 2/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))',
        '(linked-instance i (theory rules) (foundation f))',
      ]),
      /is the inference program of its foundation/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-program i--answer)',
        '(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))',
        '(linked-instance i (theory facts) (foundation f))',
      ]),
      /needs the program name i--answer/,
    );
    assert.throws(
      () => load([
        ...base,
        '(linked-fact facts two (judgement (a i--guarded)))',
        '(linked-foundation f (version 1) (inference rules) (cycle-policy inductive))',
        '(linked-instance i (theory facts) (foundation f))',
      ]),
      /reserves i--guarded/,
    );
    assert.throws(
      () => FoundationWorkspace.fromRml(packages, { executionBasis: 'horn-relational' }),
      /does not perform/,
    );
  });

  it('runs the same witnesses on the closed S/K basis inside K0', () => {
    const workspace = FoundationWorkspace.fromRml(packages);
    assert.equal(workspace.executionBasis, 's-k');

    const streams = ['countdown', 'ones', 'loop'].map(stream =>
      workspace.ask('productive-stream-examples', ['stream', stream]));
    assert.deepEqual(streams.map(result => result.reason), [
      'goal-derived',
      'guarded-coinduction',
      'saturated-without-proof',
    ]);
    assert.equal(
      workspace.ask('lawn-in-minimal-logic', ['holds', 'rain'], { assumptions: contradiction }).status,
      'contradictory',
    );
    assert.equal(
      workspace.ask('lawn-in-minimal-logic', ['holds', 'frost'], { assumptions: contradiction }).status,
      'unknown',
    );
    const outside = workspace.ask('productive-stream-examples', ['holds', 'rain']);
    assert.equal(outside.reason, 'outside-signature');
    // Pattern variables pass the signature check as opaque leaves.
    const typed = workspace.ask('productive-stream-examples', ['stream', '?stream']);
    assert.deepEqual(answers(typed), ['(stream countdown)', '(stream nil)']);

    const unseen = FoundationWorkspace.fromRml(unseenLogic);
    const cold = ['true-at', 'now', 'cold'];
    assert.equal(unseen.ask('forecast-with-necessity', cold).status, 'unknown');
    assert.equal(unseen.ask('forecast-with-reflexive-necessity', cold).status, 'proved');

    for (const result of [...streams, outside, typed]) {
      assertInsideK0(result);
      assert.equal(result.executionBasis, 's-k');
    }
    assert.ok(streams[1].hostOperations.includes('contract-s-link'));
  });
});
