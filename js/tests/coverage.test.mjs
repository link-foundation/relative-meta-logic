// Tests for coverage checking (issue #46, D14).
// Covers the `(coverage <name>)` driver form and the `isCovered(env, name)`
// API. The Rust suite mirrors these cases in rust/tests/coverage_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, Env, isCovered } from '../src/rml-links.mjs';

describe('(coverage ...) detects missing constructor cases', () => {
  it('accepts a relation that covers every Natural constructor', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode double +input -output)\n' +
      '(relation double\n' +
      '  (double zero zero)\n' +
      '  (double (succ n) (succ (succ (double n)))))\n' +
      '(coverage double)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('accepts a relation whose +input slot uses a wildcard variable', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode id +input -output)\n' +
      '(relation id\n' +
      '  (id n n))\n' +
      '(coverage id)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('rejects a relation that omits the `succ` case', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode f +input -output)\n' +
      '(relation f\n' +
      '  (f zero zero))\n' +
      '(coverage f)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /missing case/);
    assert.match(e035[0].message, /\(succ/);
  });

  it('rejects a relation that omits the `zero` case', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode g +input -output)\n' +
      '(relation g\n' +
      '  (g (succ n) zero))\n' +
      '(coverage g)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /missing case/);
    assert.match(e035[0].message, /zero/);
  });

  it('rejects a relation that omits a List constructor', () => {
    const out = evaluate(
      '(A: (Type 0) A)\n' +
      '(inductive List\n' +
      '  (constructor nil)\n' +
      '  (constructor (cons (Pi (A x) (Pi (List xs) List)))))\n' +
      '(mode head +input -output)\n' +
      '(relation head\n' +
      '  (head (cons x xs) x))\n' +
      '(coverage head)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /missing case/);
    assert.match(e035[0].message, /nil/);
  });

  it('reports each missing +input slot independently', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode add +input +input -output)\n' +
      '(relation add\n' +
      '  (add zero zero zero))\n' +
      '(coverage add)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 2);
  });

  it('rejects a `(coverage ...)` for a relation without a mode', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(relation f (f zero zero))\n' +
      '(coverage f)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /no `\(mode f \.\.\.\)` declaration/);
  });

  it('rejects a `(coverage ...)` for a relation without clauses', () => {
    const out = evaluate(
      '(mode f +input -output)\n(coverage f)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /no `\(relation f \.\.\.\)` clauses/);
  });

  it('rejects a malformed `(coverage ...)`', () => {
    const out = evaluate('(coverage f extra)');
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /must be `\(coverage <relation-name>\)`/);
  });
});

describe('isCovered API surface', () => {
  it('returns ok=true with empty diagnostics on a covered relation', () => {
    const env = new Env();
    evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))',
      { env },
    );
    const result = isCovered(env, 'plus');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.diagnostics, []);
  });

  it('returns ok=false with diagnostics when a case is missing', () => {
    const env = new Env();
    evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(mode f +input -output)\n' +
      '(relation f\n' +
      '  (f zero zero))',
      { env },
    );
    const result = isCovered(env, 'f');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].code, 'E035');
    assert.match(result.diagnostics[0].message, /\(succ/);
  });

  it('skips coverage when no inductive type can be inferred', () => {
    const env = new Env();
    evaluate(
      '(mode opaque +input -output)\n' +
      '(relation opaque\n' +
      '  (opaque x x))',
      { env },
    );
    const result = isCovered(env, 'opaque');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.diagnostics, []);
  });
});
