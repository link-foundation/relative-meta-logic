// Tests for the C3 metatheorem checker (issue #47).
// The checker composes D12 totality, D14 coverage, D15 modes, and D13
// termination into a single Twelf-style guarantee that a relation is
// total on its declared input domain. The Rust suite mirrors these cases
// in rust/tests/metatheorems_tests.rs so both runtimes report identical
// pass/fail diagnostics.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkMetatheorems, formatReport } from '../src/rml-meta.mjs';

const NATURAL_DECL =
  '(inductive Natural\n' +
  '  (constructor zero)\n' +
  '  (constructor (succ (Pi (Natural n) Natural))))\n';

const LIST_DECL =
  '(A: (Type 0) A)\n' +
  '(inductive List\n' +
  '  (constructor nil)\n' +
  '  (constructor (cons (Pi (A x) (Pi (List xs) List)))))\n';

const BOOLEAN_DECL =
  '(inductive Boolean\n' +
  '  (constructor true)\n' +
  '  (constructor false))\n';

describe('checkMetatheorems passes Twelf-style sample relations', () => {
  it('certifies `plus` on Natural as total and covered', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))\n',
    );
    assert.strictEqual(report.ok, true, formatReport(report));
    assert.strictEqual(report.relations.length, 1);
    const plus = report.relations[0];
    assert.strictEqual(plus.name, 'plus');
    assert.strictEqual(plus.ok, true);
    const kinds = plus.checks.map(c => c.kind).sort();
    assert.deepStrictEqual(kinds, ['coverage', 'totality']);
  });

  it('certifies `le` (less-than-or-equal) on Natural', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      BOOLEAN_DECL +
      '(mode le +input +input -output)\n' +
      '(relation le\n' +
      '  (le zero n true)\n' +
      '  (le (succ m) zero false)\n' +
      '  (le (succ m) (succ n) (le m n)))\n',
    );
    assert.strictEqual(report.ok, true, formatReport(report));
    const le = report.relations.find(r => r.name === 'le');
    assert.ok(le, 'expected `le` to be reported');
    assert.strictEqual(le.ok, true);
  });

  it('certifies `append` on List', () => {
    const report = checkMetatheorems(
      LIST_DECL +
      '(mode append +input +input -output)\n' +
      '(relation append\n' +
      '  (append nil ys ys)\n' +
      '  (append (cons x xs) ys (cons x (append xs ys))))\n',
    );
    assert.strictEqual(report.ok, true, formatReport(report));
    const append = report.relations.find(r => r.name === 'append');
    assert.ok(append, 'expected `append` to be reported');
    assert.strictEqual(append.ok, true);
  });
});

describe('checkMetatheorems reports counter-witnesses on failure', () => {
  it('flags a relation that omits a constructor case (coverage failure)', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode f +input -output)\n' +
      '(relation f\n' +
      '  (f zero zero))\n',
    );
    assert.strictEqual(report.ok, false);
    const f = report.relations.find(r => r.name === 'f');
    assert.ok(f);
    assert.strictEqual(f.ok, false);
    const coverage = f.checks.find(c => c.kind === 'coverage');
    assert.ok(coverage);
    assert.strictEqual(coverage.ok, false);
    assert.match(coverage.diagnostics[0].message, /missing case/);
    assert.match(coverage.diagnostics[0].message, /\(succ/);
  });

  it('flags a relation that recurses without structural decrease', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode loop +input -output)\n' +
      '(relation loop\n' +
      '  (loop zero zero)\n' +
      '  (loop (succ n) (loop (succ n))))\n',
    );
    assert.strictEqual(report.ok, false);
    const loop = report.relations.find(r => r.name === 'loop');
    assert.ok(loop);
    const totality = loop.checks.find(c => c.kind === 'totality');
    assert.ok(totality);
    assert.strictEqual(totality.ok, false);
    assert.match(totality.diagnostics[0].message, /does not structurally decrease/);
  });

  it('reports both checks independently when a single relation fails both', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode bad +input -output)\n' +
      '(relation bad\n' +
      '  (bad (succ n) (bad (succ n))))\n',
    );
    assert.strictEqual(report.ok, false);
    const bad = report.relations.find(r => r.name === 'bad');
    assert.ok(bad);
    const totality = bad.checks.find(c => c.kind === 'totality');
    const coverage = bad.checks.find(c => c.kind === 'coverage');
    assert.strictEqual(totality.ok, false);
    assert.strictEqual(coverage.ok, false);
  });
});

describe('checkMetatheorems also reports D13 termination for definitions', () => {
  it('certifies `plus` declared via `(define ...)`', () => {
    const report = checkMetatheorems(
      '(define plus\n' +
      '  (case (zero n) n)\n' +
      '  (case ((succ m) n) (succ (plus m n))))\n',
    );
    assert.strictEqual(report.ok, true, formatReport(report));
    const plus = report.definitions.find(d => d.name === 'plus');
    assert.ok(plus);
    assert.strictEqual(plus.ok, true);
    assert.strictEqual(plus.checks[0].kind, 'termination');
  });

  it('reports a counter-witness for a non-terminating definition', () => {
    const report = checkMetatheorems(
      '(define loop\n' +
      '  (case (zero) zero)\n' +
      '  (case ((succ n)) (loop (succ n))))\n',
    );
    assert.strictEqual(report.ok, false);
    const loop = report.definitions.find(d => d.name === 'loop');
    assert.ok(loop);
    assert.strictEqual(loop.ok, false);
    assert.match(loop.checks[0].diagnostics[0].message, /does not structurally decrease/);
  });
});

describe('formatReport summarizes structured results for the CLI', () => {
  it('marks an all-passing run as `All metatheorems hold.`', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))\n',
    );
    const text = formatReport(report);
    assert.match(text, /OK: plus/);
    assert.match(text, /All metatheorems hold\./);
  });

  it('marks a failing run as `One or more metatheorems failed.`', () => {
    const report = checkMetatheorems(
      NATURAL_DECL +
      '(mode f +input -output)\n' +
      '(relation f\n' +
      '  (f zero zero))\n',
    );
    const text = formatReport(report);
    assert.match(text, /FAIL: f/);
    assert.match(text, /One or more metatheorems failed\./);
  });

  it('reports an empty program with a clear placeholder line', () => {
    const report = checkMetatheorems('');
    const text = formatReport(report);
    assert.match(text, /No metatheorem candidates/);
  });
});
