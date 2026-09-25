// Tests for the shared LiNo front end (issue #183).
//
// Both runtimes read RML source through the same front end, and both test
// suites check the cases in `test-corpus/lino-frontend/cases.json`, so a
// document yields the same forms, positions, and parse errors in each. The
// Rust mirror of this file is `rust/tests/lino_frontend_tests.rs`.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  LinoParseError,
  MAX_LINO_NESTING_DEPTH,
  MAX_LINO_SOURCE_UNITS,
  normalizeLinoSource,
  parseLinoDocument,
  prepareLinoSource,
} from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const casesPath = join(resolve(here, '..', '..'), 'test-corpus', 'lino-frontend', 'cases.json');
const { cases } = JSON.parse(readFileSync(casesPath, 'utf8'));

// A source is a string, or a list of strings and `{repeat, times}` parts.
function expandSource(source) {
  if (typeof source === 'string') return source;
  return source.map(part => (typeof part === 'string' ? part : part.repeat.repeat(part.times))).join('');
}

function matchesError(expected) {
  return error => {
    assert.ok(error instanceof LinoParseError, `expected a LinoParseError, got ${error}`);
    assert.strictEqual(error.code, 'E006');
    assert.deepStrictEqual(
      { message: error.message, line: error.line, col: error.col, length: error.length },
      expected,
    );
    return true;
  };
}

// `count` lines of `a`, each one space deeper than the line before it.
function indentedLines(count) {
  return Array.from({ length: count }, (_, level) => `${' '.repeat(level)}a`);
}

describe('shared LiNo front end cases', () => {
  it('has cases to check', () => {
    assert.ok(cases.length > 0);
  });

  for (const testCase of cases) {
    it(testCase.name, () => {
      const source = expandSource(testCase.source);
      if (testCase.error) {
        assert.throws(() => parseLinoDocument(source), matchesError(testCase.error));
      } else {
        assert.deepStrictEqual(parseLinoDocument(source), testCase.forms);
      }
      if ('prepared' in testCase) {
        const { prepared, lines } = prepareLinoSource(source);
        assert.strictEqual(prepared, testCase.prepared);
        assert.deepStrictEqual(lines.map(line => [line.line, line.col]), testCase.lines);
      } else {
        assert.throws(() => prepareLinoSource(source), matchesError(testCase.error));
      }
    });
  }
});

describe('shared LiNo front end limits', () => {
  it('reads the deepest indentation the nesting limit allows', () => {
    const lines = indentedLines(MAX_LINO_NESTING_DEPTH + 1);
    const forms = parseLinoDocument(lines.join('\n'));
    assert.strictEqual(forms.length, lines.length);
    const last = forms[forms.length - 1];
    assert.deepStrictEqual(
      [last.line, last.col, last.length],
      [MAX_LINO_NESTING_DEPTH + 1, MAX_LINO_NESTING_DEPTH + 1, 1],
    );
    assert.strictEqual(last.text.match(/a/g).length, lines.length);
  });

  it('refuses one indentation level more than the limit', () => {
    const lines = indentedLines(MAX_LINO_NESTING_DEPTH + 2);
    assert.throws(() => parseLinoDocument(lines.join('\n')), matchesError({
      message: `LiNo parse failure: nesting deeper than ${MAX_LINO_NESTING_DEPTH} levels`,
      line: MAX_LINO_NESTING_DEPTH + 2,
      col: MAX_LINO_NESTING_DEPTH + 2,
      length: 1,
    }));
  });

  it('counts parentheses and indentation levels together', () => {
    const levels = MAX_LINO_NESTING_DEPTH - 2;
    const within = [...indentedLines(levels), `${' '.repeat(levels)}((a))`];
    assert.strictEqual(parseLinoDocument(within.join('\n')).length, within.length);
    const beyond = [...indentedLines(levels + 1), `${' '.repeat(levels + 1)}((a))`];
    assert.throws(() => parseLinoDocument(beyond.join('\n')), matchesError({
      message: `LiNo parse failure: nesting deeper than ${MAX_LINO_NESTING_DEPTH} levels`,
      line: levels + 2,
      col: levels + 3,
      length: 1,
    }));
  });

  it('measures the source length in UTF-16 code units', () => {
    // `é` is one UTF-16 code unit and two UTF-8 bytes.
    assert.strictEqual(prepareLinoSource('é'.repeat(MAX_LINO_SOURCE_UNITS)).lines.length, 1);
    assert.throws(() => prepareLinoSource('é'.repeat(MAX_LINO_SOURCE_UNITS + 1)), matchesError({
      message: `LiNo parse failure: source longer than ${MAX_LINO_SOURCE_UNITS} UTF-16 code units`,
      line: 1,
      col: 1,
      length: 0,
    }));
  });

});

describe('shared LiNo front end text', () => {
  it('normalizes a leading byte order mark and every line ending', () => {
    assert.strictEqual(normalizeLinoSource('\ufeffa\r\nb\rc\nd'), 'a\nb\nc\nd');
    assert.strictEqual(normalizeLinoSource('a\ufeffb'), 'a\ufeffb');
  });

  it('blanks a comment one UTF-16 code unit at a time', () => {
    // `é` takes one code unit and `😀` two, so the comment `# é😀` takes five.
    const source = '(a) # é😀\n(b)';
    const { prepared } = prepareLinoSource(source);
    assert.strictEqual(prepared, `(a) ${' '.repeat(5)}\n(b)`);
    assert.strictEqual(prepared.length, source.length);
    assert.deepStrictEqual(parseLinoDocument(source), [
      { text: '(a)', line: 1, col: 1, length: 1 },
      { text: '(b)', line: 2, col: 1, length: 1 },
    ]);
  });
});
