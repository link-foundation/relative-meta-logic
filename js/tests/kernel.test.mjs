// Typed kernel rules for issues #37 and #38.
//
// These tests keep the documented D1 surface honest: Pi formation, lambda
// formation, application by beta-reduction, capture-avoiding substitution,
// freshness, and type membership/query links.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate } from '../src/rml-links.mjs';

function evaluateClean(src) {
  const out = evaluate(src);
  assert.deepStrictEqual(out.diagnostics, []);
  return out.results;
}

describe('kernel typing rules', () => {
  it('forms a Pi type and records it as a Type 0 member', () => {
    const results = evaluateClean(`
(Natural: (Type 0) Natural)
(succ: (Pi (Natural n) Natural))
(? (Pi (Natural n) Natural))
(? ((Pi (Natural n) Natural) of (Type 0)))
(? (succ of (Pi (Natural n) Natural)))
(? (type of succ))
`);
    assert.deepStrictEqual(results, [1, 1, 1, '(Pi (Natural n) Natural)']);
  });

  it('types a named lambda under its bound parameter context', () => {
    const results = evaluateClean(`
(Natural: (Type 0) Natural)
(identity: lambda (Natural x) x)
(? (identity of (Pi (Natural x) Natural)))
(? (type of identity))
`);
    assert.deepStrictEqual(results, [1, '(Pi (Natural x) Natural)']);
  });

  it('keeps a named lambda parameter scoped to the lambda body', () => {
    const results = evaluateClean(`
(Natural: (Type 0) Natural)
(identity: lambda (Natural x) x)
(? (x of Natural))
`);
    assert.deepStrictEqual(results, [0]);
  });

  it('applies lambdas by beta-reducing the argument into the body', () => {
    const results = evaluateClean(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(identity: lambda (Natural x) x)
(? ((apply identity zero) = zero))
(? (apply (lambda (Natural x) (x + 0.1)) 0.2))
`);
    assert.deepStrictEqual(results, [1, 0.3]);
  });

  it('exposes substitution as a capture-avoiding kernel primitive', () => {
    const results = evaluateClean(`
(? (subst (lambda (Natural y) (x + y)) x y))
(? ((subst (lambda (Natural y) (x + y)) x y) = (lambda (Natural y_1) (y + y_1))))
(? ((subst (x + 0.1) x 0.2) = 0.3))
`);
    assert.deepStrictEqual(results, [
      '(lambda (Natural y_1) (y + y_1))',
      1,
      1,
    ]);
  });

  it('scopes fresh variables and rejects names already in context', () => {
    const ok = evaluate(`
(? (fresh y in ((lambda (Natural x) (x + y)) y)))
(? (y of Natural))
`);
    assert.deepStrictEqual(ok.diagnostics, []);
    assert.deepStrictEqual(ok.results, [1, 0]);

    const bad = evaluate(`
(Natural: (Type 0) Natural)
(y: Natural y)
(? (fresh y in y))
`);
    assert.deepStrictEqual(bad.results, []);
    assert.strictEqual(bad.diagnostics.length, 1);
    assert.strictEqual(bad.diagnostics[0].code, 'E010');
    assert.match(bad.diagnostics[0].message, /fresh variable "y"/);
  });

  it('checks type membership and returns stored types through of links', () => {
    const results = evaluateClean(`
(Type: Type Type)
(Natural: Type Natural)
(zero: Natural zero)
(Type 0)
(Type 1)
(? (zero of Natural))
(? (Natural of Type))
(? (type of zero))
(? ((Type 0) of (Type 1)))
`);
    assert.deepStrictEqual(results, [1, 1, 'Natural', 1]);
  });
});
