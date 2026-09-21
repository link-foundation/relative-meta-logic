import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, '..', '..', 'lib', 'meta-theory', 'universal.lino'),
  'utf8',
);

function registry(extra = '') {
  return LinkedProgramRegistry.fromRml(`${source}\n${extra}`);
}

describe('links-defined universal program evaluator', () => {
  it('performs binding, substitution, and beta reduction without a host adapter', () => {
    const programs = registry();
    const identity = [
      'beta',
      ['lambda', ['bound', 'zero']],
      ['free', 'a'],
    ];

    assert.deepEqual(programs.reduce('lambda-calculus', identity).term, ['free', 'a']);

    const captureSafe = [
      'evaluate',
      [
        'apply',
        [
          'apply',
          ['lambda', ['lambda', ['bound', ['successor', 'zero']]]],
          ['free', 'a'],
        ],
        ['free', 'b'],
      ],
      'empty-environment',
    ];
    assert.deepEqual(programs.reduce('lambda-calculus', captureSafe).term, ['free', 'a']);
  });

  it('loads a completely new logic from links without a JavaScript callback', () => {
    const programs = registry(`
      (linked-program user-logic)
      (linked-rewrite user-logic eliminate-double-negation
        (from (negate (negate ?proposition)))
        (to ?proposition))
    `);

    const result = programs.reduce('user-logic', ['negate', ['negate', 'p']]);
    assert.equal(result.term, 'p');
    assert.deepEqual(result.trace.map(step => step.rule), ['eliminate-double-negation']);
  });

  it('derives judgements using user-defined facts and inference rules', () => {
    const programs = registry(`
      (linked-program user-proof-system)
      (linked-fact user-proof-system premise-p
        (judgement (holds p)))
      (linked-fact user-proof-system premise-p-implies-q
        (judgement (implies p q)))
      (linked-inference user-proof-system modus-ponens
        (premise (holds ?antecedent))
        (premise (implies ?antecedent ?consequent))
        (conclusion (holds ?consequent)))
    `);

    const proof = programs.prove('user-proof-system', ['holds', 'q']);
    assert.equal(proof.ok, true);
    assert.equal(proof.proof.rule, 'modus-ponens');
    assert.deepEqual(proof.proof.premises.map(item => item.rule), [
      'premise-p',
      'premise-p-implies-q',
    ]);
  });

  it('defines finite sets, graphs, relations, and dependent typing as programs', () => {
    const programs = registry();
    const set = ['cons', 'a', ['cons', 'b', ['empty']]];
    assert.equal(programs.reduce('set-theory', ['member', 'b', set]).term, 'true');
    assert.equal(
      programs.reduce('set-theory', ['set-equal', set, ['cons', 'b', ['cons', 'a', ['empty']]]]).term,
      'true',
    );

    const graphProof = programs.prove('graph-theory', ['reachable', 'a', 'c'], {
      facts: [['edge', 'a', 'b'], ['edge', 'b', 'c']],
    });
    assert.equal(graphProof.ok, true);

    const relationProof = programs.prove(
      'relational-algebra',
      ['relates', ['compose', 'left', 'right'], 'a', 'c'],
      { facts: [['relates', 'left', 'a', 'b'], ['relates', 'right', 'b', 'c']] },
    );
    assert.equal(relationProof.ok, true);

    const typeProof = programs.prove(
      'dependent-type-theory',
      ['has-type', ['apply', ['lambda', 'Nat', ['bound', 'zero']], 'zero'], 'Nat'],
    );
    assert.equal(typeProof.ok, true);
  });

  it('rejects malformed programs and bounds non-terminating definitions', () => {
    assert.throws(
      () => registry(`
        (linked-program invalid)
        (linked-rewrite invalid unbound
          (from (f ?x))
          (to (g ?missing)))
      `),
      /unbound variable \?missing/,
    );

    const programs = registry(`
      (linked-program looping)
      (linked-rewrite looping left (from left) (to right))
      (linked-rewrite looping right (from right) (to left))
    `);
    assert.throws(() => programs.reduce('looping', 'left'), /rewrite cycle/);
  });

  it('applies the proof fact bound to declared and input facts', () => {
    const programs = registry(`
      (linked-program bounded-proof)
      (linked-fact bounded-proof first (judgement (holds a)))
      (linked-fact bounded-proof second (judgement (holds b)))
    `);

    assert.throws(
      () => programs.prove('bounded-proof', ['holds', 'b'], { maxFacts: 1 }),
      /proof fact limit 1 exceeded/,
    );

    const inputOnly = registry('(linked-program bounded-input)');
    assert.throws(
      () => inputOnly.prove('bounded-input', ['holds', 'b'], {
        facts: [['holds', 'a'], ['holds', 'b']],
        maxFacts: 1,
      }),
      /proof fact limit 1 exceeded/,
    );
  });
});
