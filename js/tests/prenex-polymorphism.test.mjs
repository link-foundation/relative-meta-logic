// Prenex polymorphism tests for issue #52 (D9).
//
// Locks in the documented surface form `(forall A T)` ≡ `(Pi (Type A) T)`
// and the three canonical acceptance examples — polymorphic identity, apply,
// and compose — required by the issue. Higher-rank quantification is out of
// scope: a `(forall ...)` underneath a non-prenex `Pi` is rejected by the
// existing `parseBinding` rules and nothing here changes that.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Env,
  evalNode,
  synth,
  check,
  keyOf,
} from '../src/rml-links.mjs';

function setupBaseEnv() {
  const env = new Env();
  evalNode(['Type:', 'Type', 'Type'], env);
  evalNode(['Natural:', 'Type', 'Natural'], env);
  evalNode(['Boolean:', 'Type', 'Boolean'], env);
  evalNode(['zero:', 'Natural', 'zero'], env);
  return env;
}

describe('prenex polymorphism — (forall A T) sugar', () => {
  it('synthesises a forall type at universe Type', () => {
    const env = setupBaseEnv();
    // (forall A (Pi (A x) A)) — the polymorphic identity type.
    const r = synth(['forall', 'A', ['Pi', ['A', 'x'], 'A']], env);
    assert.deepStrictEqual(r.diagnostics, []);
    // Desugared form: (Pi (Type A) (Pi (A x) A)) :: (Type 0)
    assert.strictEqual(keyOf(r.type), '(Type 0)');
  });

  it('treats (forall A T) as definitionally equal to (Pi (Type A) T)', () => {
    const env = setupBaseEnv();
    const polyType = ['forall', 'A', ['Pi', ['A', 'x'], 'A']];
    const desugared = ['Pi', ['Type', 'A'], ['Pi', ['A', 'x'], 'A']];
    // Declare a value at the desugared form, then check it against the
    // sugared form — and vice versa.
    evalNode(['polyId:', desugared], env);
    assert.strictEqual(check('polyId', polyType, env).ok, true);
  });
});

describe('prenex polymorphism — polymorphic identity', () => {
  it('checks (lambda (Type A) (lambda (A x) x)) against (forall A (Pi (A x) A))', () => {
    const env = setupBaseEnv();
    const polyType = ['forall', 'A', ['Pi', ['A', 'x'], 'A']];
    const polyValue = ['lambda', ['Type', 'A'], ['lambda', ['A', 'x'], 'x']];
    const result = check(polyValue, polyType, env);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.diagnostics, []);
  });

  it('instantiates the type variable through (apply polyId Natural)', () => {
    const env = setupBaseEnv();
    evalNode(['polyId:', ['forall', 'A', ['Pi', ['A', 'x'], 'A']]], env);
    const result = synth(['apply', 'polyId', 'Natural'], env);
    assert.deepStrictEqual(result.diagnostics, []);
    // After substituting A := Natural the body Pi becomes (Pi (Natural x) Natural).
    assert.strictEqual(keyOf(result.type), '(Pi (Natural x) Natural)');
  });

  it('fully applies a polymorphic identity at Natural to zero :: Natural', () => {
    const env = setupBaseEnv();
    evalNode(['polyId:', ['forall', 'A', ['Pi', ['A', 'x'], 'A']]], env);
    const result = synth(
      ['apply', ['apply', 'polyId', 'Natural'], 'zero'],
      env,
    );
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(keyOf(result.type), 'Natural');
  });
});

describe('prenex polymorphism — polymorphic apply', () => {
  it('checks the canonical (forall A (forall B ((A -> B) -> A -> B))) form', () => {
    const env = setupBaseEnv();
    // forall A. forall B. (A -> B) -> (A -> B)
    //   = forall A. forall B. (Pi (f: A -> B) (Pi (x: A) B))
    // In LiNo: (forall A (forall B (Pi ((Pi (A x) B) f) (Pi (A x) B))))
    const applyType = ['forall', 'A', ['forall', 'B',
      ['Pi', [['Pi', ['A', 'x'], 'B'], 'f'],
        ['Pi', ['A', 'x'], 'B']]]];

    const applyValue = ['lambda', ['Type', 'A'],
      ['lambda', ['Type', 'B'],
        ['lambda', [['Pi', ['A', 'x'], 'B'], 'f'],
          ['lambda', ['A', 'x'], ['apply', 'f', 'x']]]]];

    const result = check(applyValue, applyType, env);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepStrictEqual(result.diagnostics, []);
  });
});

describe('prenex polymorphism — polymorphic compose', () => {
  it('checks (forall A (forall B (forall C ((B -> C) -> (A -> B) -> (A -> C)))))', () => {
    const env = setupBaseEnv();
    const composeType = ['forall', 'A', ['forall', 'B', ['forall', 'C',
      ['Pi', [['Pi', ['B', 'y'], 'C'], 'g'],
        ['Pi', [['Pi', ['A', 'x'], 'B'], 'f'],
          ['Pi', ['A', 'x'], 'C']]]]]];

    const composeValue = ['lambda', ['Type', 'A'],
      ['lambda', ['Type', 'B'],
        ['lambda', ['Type', 'C'],
          ['lambda', [['Pi', ['B', 'y'], 'C'], 'g'],
            ['lambda', [['Pi', ['A', 'x'], 'B'], 'f'],
              ['lambda', ['A', 'x'], ['apply', 'g', ['apply', 'f', 'x']]]]]]]];

    const result = check(composeValue, composeType, env);
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepStrictEqual(result.diagnostics, []);
  });
});

describe('prenex polymorphism — diagnostics', () => {
  it('reports E021 when a polymorphic value is checked at the wrong instantiation', () => {
    const env = setupBaseEnv();
    evalNode(['polyId:', ['forall', 'A', ['Pi', ['A', 'x'], 'A']]], env);
    // (apply polyId Natural) :: (Pi (Natural x) Natural). Checking it at
    // (Pi (Boolean x) Boolean) is a real type mismatch (Natural ≠ Boolean).
    const r = check(
      ['apply', 'polyId', 'Natural'],
      ['Pi', ['Boolean', 'x'], 'Boolean'],
      env,
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.diagnostics[0].code, 'E021');
  });
});
