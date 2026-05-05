// Tests for termination checking (issue #49, D13).
// Covers parsing of `(define <name> [(measure ...)] (case ...) ...)`,
// the `(terminating <name>)` driver form, and the `isTerminating(env, name)`
// API used by external tools. The Rust suite mirrors these cases in
// rust/tests/termination_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, Env, isTerminating } from '../src/rml-links.mjs';

describe('(define ...) declarations are parsed and stored', () => {
  it('records the case clauses on the Env', () => {
    const env = new Env();
    const out = evaluate(
      '(define plus\n' +
      '  (case (zero n) n)\n' +
      '  (case ((succ m) n) (succ (plus m n))))',
      { env },
    );
    assert.strictEqual(out.diagnostics.length, 0);
    const decl = env.definitions.get('plus');
    assert.ok(decl);
    assert.strictEqual(decl.name, 'plus');
    assert.strictEqual(decl.measure, null);
    assert.strictEqual(decl.clauses.length, 2);
    assert.deepStrictEqual(decl.clauses[0].pattern, ['zero', 'n']);
    assert.deepStrictEqual(decl.clauses[0].body, 'n');
    assert.deepStrictEqual(decl.clauses[1].pattern, [['succ', 'm'], 'n']);
    assert.deepStrictEqual(decl.clauses[1].body, ['succ', ['plus', 'm', 'n']]);
  });

  it('records an explicit lexicographic measure when provided', () => {
    const env = new Env();
    const out = evaluate(
      '(define ackermann\n' +
      '  (measure (lex 1 2))\n' +
      '  (case (zero n) (succ n))\n' +
      '  (case ((succ m) zero) (ackermann m (succ zero)))\n' +
      '  (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))',
      { env },
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
    const decl = env.definitions.get('ackermann');
    assert.ok(decl);
    assert.deepStrictEqual(decl.measure, { kind: 'lex', slots: [0, 1] });
    assert.strictEqual(decl.clauses.length, 3);
  });

  it('rejects a definition with no clauses', () => {
    const out = evaluate('(define plus)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /at least one .*case/);
  });

  it('rejects a malformed case clause', () => {
    const out = evaluate('(define plus (case zero n))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /pattern must be a parenthesised argument list/);
  });

  it('rejects an unknown clause shape', () => {
    const out = evaluate('(define plus (foo bar))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /unexpected clause/);
  });

  it('rejects a malformed measure body', () => {
    const out = evaluate(
      '(define ackermann (measure 1) (case ((succ m) n) (ackermann m n)))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /must be `\(lex/);
  });
});

describe('(terminating ...) verifies structural decrease', () => {
  it('accepts `plus` (decrease on first argument)', () => {
    const out = evaluate(
      '(define plus\n' +
      '  (case (zero n) n)\n' +
      '  (case ((succ m) n) (succ (plus m n))))\n' +
      '(terminating plus)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('accepts `append` on lists', () => {
    const out = evaluate(
      '(define append\n' +
      '  (case (nil ys) ys)\n' +
      '  (case ((cons x xs) ys) (cons x (append xs ys))))\n' +
      '(terminating append)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('rejects Ackermann without an explicit measure', () => {
    const out = evaluate(
      '(define ackermann\n' +
      '  (case (zero n) (succ n))\n' +
      '  (case ((succ m) zero) (ackermann m (succ zero)))\n' +
      '  (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))\n' +
      '(terminating ackermann)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.ok(e035.length >= 1, `expected E035 diagnostic, got: ${JSON.stringify(out.diagnostics)}`);
    assert.match(e035[0].message, /does not structurally decrease the first argument/);
  });

  it('accepts Ackermann with a lexicographic measure on (m, n)', () => {
    const out = evaluate(
      '(define ackermann\n' +
      '  (measure (lex 1 2))\n' +
      '  (case (zero n) (succ n))\n' +
      '  (case ((succ m) zero) (ackermann m (succ zero)))\n' +
      '  (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))\n' +
      '(terminating ackermann)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });

  it('rejects a definition that recurses on the same head', () => {
    const out = evaluate(
      '(define loop\n' +
      '  (case (zero) zero)\n' +
      '  (case ((succ n)) (loop (succ n))))\n' +
      '(terminating loop)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /does not structurally decrease/);
    assert.match(e035[0].message, /\(loop \(succ n\)\)/);
  });

  it('reports a counter-witness when only one clause fails', () => {
    const out = evaluate(
      '(define bad\n' +
      '  (case (zero) zero)\n' +
      '  (case ((succ n)) (bad n))\n' +
      '  (case ((succ n)) (bad (succ n))))\n' +
      '(terminating bad)',
    );
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /clause 3/);
  });

  it('rejects a `(terminating ...)` for an undeclared definition', () => {
    const out = evaluate('(terminating mystery)');
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /no `\(define mystery \.\.\.\)` declaration/);
  });

  it('rejects a malformed `(terminating ...)`', () => {
    const out = evaluate('(terminating plus extra)');
    const e035 = out.diagnostics.filter(d => d.code === 'E035');
    assert.strictEqual(e035.length, 1);
    assert.match(e035[0].message, /must be `\(terminating <definition-name>\)`/);
  });
});

describe('isTerminating API surface', () => {
  it('returns ok=true with empty diagnostics on a terminating definition', () => {
    const env = new Env();
    evaluate(
      '(define plus\n' +
      '  (case (zero n) n)\n' +
      '  (case ((succ m) n) (succ (plus m n))))',
      { env },
    );
    const result = isTerminating(env, 'plus');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.diagnostics, []);
  });

  it('returns ok=false with diagnostics when a clause fails to decrease', () => {
    const env = new Env();
    evaluate(
      '(define ackermann\n' +
      '  (case (zero n) (succ n))\n' +
      '  (case ((succ m) zero) (ackermann m (succ zero)))\n' +
      '  (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))',
      { env },
    );
    const result = isTerminating(env, 'ackermann');
    assert.strictEqual(result.ok, false);
    assert.ok(result.diagnostics.length >= 1);
    assert.strictEqual(result.diagnostics[0].code, 'E035');
  });

  it('returns ok=true for Ackermann with a lex measure', () => {
    const env = new Env();
    evaluate(
      '(define ackermann\n' +
      '  (measure (lex 1 2))\n' +
      '  (case (zero n) (succ n))\n' +
      '  (case ((succ m) zero) (ackermann m (succ zero)))\n' +
      '  (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))',
      { env },
    );
    const result = isTerminating(env, 'ackermann');
    assert.strictEqual(
      result.ok,
      true,
      `expected ok=true, got diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  });
});
