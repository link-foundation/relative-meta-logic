// Tests for totality checking (issue #44, D12).
// Covers parsing of `(relation <name> <clause>...)`, the `(total <name>)`
// driver form, and the `isTotal(env, name)` API used by external tools.
// The Rust suite mirrors these cases in rust/tests/totality_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, Env, isTotal } from '../src/rml-links.mjs';

describe('(relation ...) declarations are parsed and stored', () => {
  it('records the clause list on the Env', () => {
    const env = new Env();
    const out = evaluate(
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))',
      { env },
    );
    assert.strictEqual(out.diagnostics.length, 0);
    const clauses = env.relations.get('plus');
    assert.strictEqual(clauses.length, 2);
    assert.deepStrictEqual(clauses[0], ['plus', 'zero', 'n', 'n']);
    assert.deepStrictEqual(clauses[1], [
      'plus', ['succ', 'm'], 'n', ['succ', ['plus', 'm', 'n']],
    ]);
  });

  it('rejects a relation declaration with no clauses', () => {
    const out = evaluate('(relation plus)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E032');
    assert.match(out.diagnostics[0].message, /at least one clause/);
  });

  it('rejects a clause whose head differs from the relation name', () => {
    const out = evaluate('(relation plus (minus zero n n))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E032');
    assert.match(out.diagnostics[0].message, /head is "plus"/);
  });
});

describe('(total ...) verifies structural decrease', () => {
  it('accepts `plus` (recursion on the first +input)', () => {
    const out = evaluate(
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))\n' +
      '(total plus)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('accepts `le` (recursion shrinks both inputs)', () => {
    const out = evaluate(
      '(mode le +input +input -output)\n' +
      '(relation le\n' +
      '  (le zero n true)\n' +
      '  (le (succ m) zero false)\n' +
      '  (le (succ m) (succ n) (le m n)))\n' +
      '(total le)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('accepts `append` on lists', () => {
    const out = evaluate(
      '(mode append +input +input -output)\n' +
      '(relation append\n' +
      '  (append nil ys ys)\n' +
      '  (append (cons x xs) ys (cons x (append xs ys))))\n' +
      '(total append)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('rejects a relation that recurses without structural decrease', () => {
    const out = evaluate(
      '(mode loop +input -output)\n' +
      '(relation loop\n' +
      '  (loop zero zero)\n' +
      '  (loop (succ n) (loop (succ n))))\n' +
      '(total loop)',
    );
    const e032 = out.diagnostics.filter(d => d.code === 'E032');
    assert.strictEqual(e032.length, 1);
    assert.match(e032[0].message, /does not structurally decrease/);
    assert.match(e032[0].message, /\(loop \(succ n\)\)/);
  });

  it('reports a counter-witness when only one clause fails', () => {
    const out = evaluate(
      '(mode bad +input -output)\n' +
      '(relation bad\n' +
      '  (bad zero zero)\n' +
      '  (bad (succ n) (bad n))\n' +    // ok: n < (succ n)
      '  (bad (succ n) (bad (succ n))))\n' + // bad: same input
      '(total bad)',
    );
    const e032 = out.diagnostics.filter(d => d.code === 'E032');
    assert.strictEqual(e032.length, 1);
    assert.match(e032[0].message, /clause 3/);
  });

  it('rejects a `(total ...)` for an undeclared relation', () => {
    const out = evaluate('(total mystery)');
    const e032 = out.diagnostics.filter(d => d.code === 'E032');
    assert.strictEqual(e032.length, 1);
    assert.match(e032[0].message, /no `\(mode mystery \.\.\.\)` declaration/);
  });

  it('rejects a `(total ...)` when modes are present but no clauses are', () => {
    const out = evaluate(
      '(mode plus +input +input -output)\n(total plus)',
    );
    const e032 = out.diagnostics.filter(d => d.code === 'E032');
    assert.strictEqual(e032.length, 1);
    assert.match(e032[0].message, /no `\(relation plus \.\.\.\)` clauses/);
  });

  it('rejects a malformed `(total ...)`', () => {
    const out = evaluate('(total plus extra)');
    const e032 = out.diagnostics.filter(d => d.code === 'E032');
    assert.strictEqual(e032.length, 1);
    assert.match(e032[0].message, /must be `\(total <relation-name>\)`/);
  });
});

describe('isTotal API surface', () => {
  it('returns ok=true with empty diagnostics on a total relation', () => {
    const env = new Env();
    evaluate(
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))',
      { env },
    );
    const result = isTotal(env, 'plus');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.diagnostics, []);
  });

  it('returns ok=false with diagnostics when a clause fails to decrease', () => {
    const env = new Env();
    evaluate(
      '(mode loop +input -output)\n' +
      '(relation loop\n' +
      '  (loop zero zero)\n' +
      '  (loop (succ n) (loop (succ n))))',
      { env },
    );
    const result = isTotal(env, 'loop');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].code, 'E032');
  });
});
