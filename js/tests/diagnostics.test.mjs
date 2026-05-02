// Tests for structured diagnostics (issue #28).
// Covers the evaluate() API, error codes, source spans, and CLI-style
// formatting. The Rust suite mirrors these cases in
// rust/tests/diagnostics_tests.rs to keep the two implementations in lock-step.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluate,
  formatDiagnostic,
  Diagnostic,
  RmlError,
  computeFormSpans,
} from '../src/rml-links.mjs';

describe('evaluate() returns a structured result', () => {
  it('produces results and an empty diagnostics array on a clean input', () => {
    const out = evaluate('(valence: 2)\n(p has probability 1)\n(? p)');
    assert.ok(Array.isArray(out.results));
    assert.ok(Array.isArray(out.diagnostics));
    assert.strictEqual(out.diagnostics.length, 0);
    assert.strictEqual(out.results.length, 1);
    assert.strictEqual(out.results[0], 1);
  });

  it('does not throw on bad input — returns a Diagnostic instead', () => {
    let threw = false;
    let out;
    try {
      out = evaluate('(=: missing_op identity)');
    } catch (_) {
      threw = true;
    }
    assert.strictEqual(threw, false, 'evaluate() must not throw');
    assert.ok(out.diagnostics.length >= 1);
  });
});

describe('Diagnostic shape and error codes', () => {
  it('E001 — unknown op surfaces with file/line/col span', () => {
    const out = evaluate('(=: missing_op identity)', { file: 'inline.lino' });
    assert.strictEqual(out.diagnostics.length, 1);
    const d = out.diagnostics[0];
    assert.ok(d instanceof Diagnostic);
    assert.strictEqual(d.code, 'E001');
    assert.match(d.message, /Unknown op/);
    assert.strictEqual(d.span.file, 'inline.lino');
    assert.strictEqual(d.span.line, 1);
    assert.strictEqual(d.span.col, 1);
  });

  it('E006 — LiNo parse error is reported as a diagnostic, not thrown', () => {
    const out = evaluate('(=: foo bar', { file: 'inline.lino' });
    assert.strictEqual(out.diagnostics.length, 1);
    const d = out.diagnostics[0];
    assert.strictEqual(d.code, 'E006');
    assert.strictEqual(d.span.file, 'inline.lino');
    assert.strictEqual(d.span.line, 1);
  });

  it('E004 — unknown aggregator surfaces', () => {
    const out = evaluate('(and: bogus_agg)', { file: 'agg.lino' });
    assert.strictEqual(out.diagnostics.length, 1);
    const d = out.diagnostics[0];
    assert.strictEqual(d.code, 'E004');
    assert.match(d.message, /aggregator/i);
    assert.strictEqual(d.span.line, 1);
  });

  it('E010 — fresh variables must not already appear in context', () => {
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n(x: Natural x)\n(? (fresh x in x))',
      { file: 'fresh.lino' },
    );
    assert.strictEqual(out.diagnostics.length, 1);
    const d = out.diagnostics[0];
    assert.strictEqual(d.code, 'E010');
    assert.match(d.message, /fresh variable "x" already appears in context/);
    assert.strictEqual(d.span.file, 'fresh.lino');
    assert.strictEqual(d.span.line, 3);
  });

  it('restores fresh variables when the scoped body reports a diagnostic', () => {
    const out = evaluate(
      '(? (fresh z in (=: missing identity)))\n(? (fresh z in z))',
      { file: 'fresh-error.lino' },
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E001');
    assert.strictEqual(out.diagnostics[0].span.line, 1);
    assert.strictEqual(out.results.length, 1);
  });

  it('E001 — span tracks line for forms that follow blank lines', () => {
    const src = '(valence: 2)\n\n(=: missing identity)';
    const out = evaluate(src, { file: 'multi.lino' });
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E001');
    assert.strictEqual(out.diagnostics[0].span.line, 3);
    assert.strictEqual(out.diagnostics[0].span.col, 1);
  });

  it('keeps good results even when a later form errors', () => {
    const src = '(valence: 2)\n(p has probability 1)\n(? p)\n(=: missing identity)';
    const out = evaluate(src, { file: 'mix.lino' });
    assert.strictEqual(out.results.length, 1);
    assert.strictEqual(out.results[0], 1);
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E001');
    assert.strictEqual(out.diagnostics[0].span.line, 4);
  });
});

describe('formatDiagnostic()', () => {
  it('prints "<file>:<line>:<col>: <CODE>: <message>" plus a caret line', () => {
    const src = '(=: missing_op identity)';
    const out = evaluate(src, { file: 'demo.lino' });
    const text = formatDiagnostic(out.diagnostics[0], src);
    const lines = text.split('\n');
    assert.match(lines[0], /^demo\.lino:1:1: E001: Unknown op/);
    assert.strictEqual(lines[1], '(=: missing_op identity)');
    assert.strictEqual(lines[2], '^');
  });

  it('points the caret at the second form on a later line', () => {
    const src = '(valence: 2)\n(=: missing_op identity)';
    const out = evaluate(src, { file: 'caret.lino' });
    assert.strictEqual(out.diagnostics.length, 1);
    const text = formatDiagnostic(out.diagnostics[0], src);
    const lines = text.split('\n');
    assert.match(lines[0], /^caret\.lino:2:1:/);
    assert.strictEqual(lines[1], '(=: missing_op identity)');
    assert.strictEqual(lines[2], '^');
  });
});

describe('RmlError', () => {
  it('carries code and span attributes', () => {
    const err = new RmlError('E001', 'Unknown op: foo', { line: 1, col: 1 });
    assert.ok(err instanceof Error);
    assert.strictEqual(err.code, 'E001');
    assert.deepStrictEqual(err.span, { line: 1, col: 1 });
  });
});

describe('computeFormSpans()', () => {
  it('returns one span per top-level form with 1-based line/col', () => {
    const text = '(a)\n  (b)\n\n(c)';
    const spans = computeFormSpans(text, 'spans.lino');
    assert.strictEqual(spans.length, 3);
    assert.deepStrictEqual(
      spans.map((s) => [s.line, s.col]),
      [
        [1, 1],
        [2, 3],
        [4, 1],
      ],
    );
    for (const s of spans) assert.strictEqual(s.file, 'spans.lino');
  });
});
