// Tests for `(template ...)` expansion (issue #59).
// Mirrors rust/tests/templates_tests.rs so the two implementations keep the
// same macro/template surface.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, run } from '../src/rml-links.mjs';

describe('(template ...) declarations', () => {
  it('expands a reusable assignment shape before evaluation', () => {
    const out = evaluate(`
(template (known expr value)
  (expr has probability value))
(known (a = b) 1)
(? (a = b))
`);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [1]);
  });

  it('is available through the legacy run() helper', () => {
    const out = run(`
(template (known expr value)
  (expr has probability value))
(known (a = b) 1)
(? (a = b))
`);
    assert.deepStrictEqual(out, [1]);
  });

  it('expands nested template uses until ordinary forms remain', () => {
    const out = evaluate(`
(template (known expr value)
  (expr has probability value))
(template (known-true expr)
  (known expr 1))
(known-true (a = b))
(? (a = b))
`);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [1]);
  });

  it('renames introduced binders so placeholder arguments are not captured', () => {
    const out = evaluate(`
(Term: (Type 0) Term)
(zero: Term zero)
(x: Term x)
(template (const body)
  (lambda (Term x) body))
(? (nf (apply (const x) zero)))
`);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, ['x']);
  });
});
