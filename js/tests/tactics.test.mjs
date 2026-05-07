// Tests for the link-based tactic engine (issue #55).
// Tactics are ordinary LiNo links that transform an explicit proof state.
// Mirrored by `rust/tests/tactics_tests.rs` so JS and Rust stay aligned.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  keyOf,
  parseOne,
  runTactics,
  search,
  tokenizeOne,
} from '../src/rml-links.mjs';

function link(src) {
  return parseOne(tokenizeOne(src));
}

function state(...goals) {
  return { goals: goals.map(goal => link(goal)) };
}

function stateWithContext(goal, ...context) {
  return {
    goals: [{
      goal: link(goal),
      context: context.map(link),
    }],
  };
}

function goalKeys(proofState) {
  return proofState.goals.map(goal => keyOf(goal.goal));
}

describe('runTactics applies link tactics to proof states', () => {
  it('closes an equality goal with (by reflexivity)', () => {
    const out = runTactics(state('(a = a)'), [link('(by reflexivity)')]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), ['(by reflexivity)']);
  });

  it('parses tactic text before applying links', () => {
    const out = runTactics(state('(a = a)'), '(reflexivity)');

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), ['(reflexivity)']);
  });

  it('transforms equality goals with symmetry and transitivity', () => {
    const out = runTactics(state('(a = c)'), [
      link('(symmetry)'),
      link('(transitivity b)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(goalKeys(out.state), ['(c = b)', '(b = a)']);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      '(symmetry)',
      '(transitivity b)',
    ]);
  });

  it('introduces Pi binders into the current proof context', () => {
    const introduced = runTactics(state('(Pi (Natural n) (n = n))'), [
      link('(introduce k)'),
    ]);

    assert.deepStrictEqual(introduced.diagnostics, []);
    assert.deepStrictEqual(goalKeys(introduced.state), ['(k = k)']);
    assert.deepStrictEqual(
      introduced.state.goals[0].context.map(keyOf),
      ['(k of Natural)'],
    );

    const closed = runTactics(introduced.state, [link('(by reflexivity)')]);
    assert.deepStrictEqual(closed.diagnostics, []);
    assert.deepStrictEqual(closed.state.goals, []);
  });

  it('adds assumptions with suppose and closes them with exact', () => {
    const supposed = runTactics(state('(p = q)'), [
      link('(suppose (p = q))'),
    ]);

    assert.deepStrictEqual(supposed.diagnostics, []);
    assert.deepStrictEqual(goalKeys(supposed.state), ['(p = q)']);
    assert.deepStrictEqual(
      supposed.state.goals[0].context.map(keyOf),
      ['(p = q)'],
    );

    const closed = runTactics(supposed.state, [link('(exact (p = q))')]);
    assert.deepStrictEqual(closed.diagnostics, []);
    assert.deepStrictEqual(closed.state.goals, []);
  });

  it('rewrites the current goal using an equality link', () => {
    const out = runTactics(state('((f a) = (f a))'), [
      link('(rewrite (a = b) in goal)'),
      link('(by reflexivity)'),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      '(rewrite (a = b) in goal)',
      '(by reflexivity)',
    ]);
  });

  it('runs per-case tactic links during induction', () => {
    const out = runTactics(state('(n = n)'), [
      link(
        '(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))',
      ),
    ]);

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.strictEqual(
      keyOf(out.state.proof[0]),
      '(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))',
    );
  });

  it('reports a structured diagnostic with the current goal when a tactic fails', () => {
    const out = runTactics(state('(a = b)'), [link('(by reflexivity)')]);

    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E039');
    assert.match(out.diagnostics[0].message, /current goal: \(a = b\)/);
    assert.deepStrictEqual(goalKeys(out.state), ['(a = b)']);
  });

  it('search returns a bounded derivation tree from available lemmas', () => {
    const lemmas = [
      link('(ab of (a = b))'),
      link('(bc of (b = c))'),
      link('(trans of (Pi ((a = b) ab) (Pi ((b = c) bc) (a = c))))'),
    ];

    assert.strictEqual(search(link('(a = c)'), 0, lemmas), null);

    const proof = search(link('(a = c)'), 1, lemmas);
    assert.strictEqual(
      keyOf(proof),
      '(by apply trans (by exact ab) (by exact bc))',
    );
  });

  it('closes a goal with (by search depth N)', () => {
    const out = runTactics(
      stateWithContext(
        '(a = c)',
        '(ab of (a = b))',
        '(bc of (b = c))',
        '(trans of (Pi ((a = b) ab) (Pi ((b = c) bc) (a = c))))',
      ),
      [link('(by search depth 1)')],
    );

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.state.goals, []);
    assert.deepStrictEqual(out.state.proof.map(keyOf), [
      '(by search depth 1 (by apply trans (by exact ab) (by exact bc)))',
    ]);
  });
});
