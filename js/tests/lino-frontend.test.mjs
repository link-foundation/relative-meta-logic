// Tests for the shared LiNo front end (issue #183).
//
// Both runtimes read RML source through the same front end, and both test
// suites check the cases in `test-corpus/lino-frontend/cases.json`, so a
// document yields the same forms, positions, and parse errors in each. The
// Rust mirror of this file is `rust/tests/lino_frontend_tests.rs`.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

// The [line, column, text, value] of every reference that starts with a quote:
// where it starts in the source, what it spans there, and what it reads as.
function quotesOf({ source, quotes }) {
  return quotes.map(({ start, end, value }) => {
    const before = source.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    return [before.split('\n').length, [...before.slice(lineStart)].length + 1, source.slice(start, end), value];
  });
}

// `count` lines of `a`, each one space deeper than the line before it.
function indentedLines(count) {
  return Array.from({ length: count }, (_, level) => `${' '.repeat(level)}a`);
}

// `count` indented ids `a:`, each one space deeper than the one before it,
// over the value `b` one space deeper than the last of them.
function nestedIndentedIds(count) {
  const lines = Array.from({ length: count }, (_, level) => `${' '.repeat(level)}a:`);
  return [...lines, `${' '.repeat(count)}b`].join('\n');
}

// How long reading any of the sources built to be slow to read may take.
const READ_LIMIT_MS = 5000;

const frontEndUrl = pathToFileURL(join(here, '..', 'src', 'rml-lino-frontend.mjs')).href;

// What `parseLinoDocument` reads from `source`, as `{ forms }` or `{ error }`,
// read in a child process that is stopped after `READ_LIMIT_MS`, so a reader
// that takes too long fails the test instead of holding it up.
function readWithinLimit(source) {
  const program = `
    import { readFileSync } from 'node:fs';
    import { parseLinoDocument } from ${JSON.stringify(frontEndUrl)};
    let result;
    try {
      result = { forms: parseLinoDocument(readFileSync(0, 'utf8')) };
    } catch (error) {
      result = { error: { message: error.message, line: error.line, col: error.col, length: error.length } };
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    input: source,
    encoding: 'utf8',
    timeout: READ_LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.strictEqual(child.signal, null, `reading took longer than ${READ_LIMIT_MS} ms`);
  assert.strictEqual(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
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
        const result = prepareLinoSource(source);
        assert.strictEqual(result.prepared, testCase.prepared);
        assert.deepStrictEqual(result.lines.map(line => [line.line, line.col]), testCase.lines);
        assert.deepStrictEqual(quotesOf(result), testCase.quotes);
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

  it('reads indented ids nested as deep as the nesting limit allows', () => {
    const depth = MAX_LINO_NESTING_DEPTH;
    assert.deepStrictEqual(parseLinoDocument(nestedIndentedIds(depth)), [
      { text: `${'(a: '.repeat(depth)}b${')'.repeat(depth)}`, line: 1, col: 1, length: 1 },
    ]);
  });

  it('refuses indented ids nested one level more than the limit', () => {
    const depth = MAX_LINO_NESTING_DEPTH + 1;
    assert.throws(() => parseLinoDocument(nestedIndentedIds(depth)), matchesError({
      message: `LiNo parse failure: nesting deeper than ${MAX_LINO_NESTING_DEPTH} levels`,
      line: depth + 1,
      col: depth + 1,
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

describe('shared LiNo front end time', () => {
  const depth = MAX_LINO_NESTING_DEPTH;
  const quotes = count => "'".repeat(count);
  // Odd widths from 315 down to 1, and even widths from 316 down to 2.
  const oddWidths = Array.from({ length: 158 }, (_, index) => 315 - 2 * index);
  const evenWidths = oddWidths.map(width => width + 1);
  const wide = 300_000;
  const words = 100_000;
  const references = 50_000;
  const failure = (detail, col) => ({ error: { message: `LiNo parse failure: ${detail}`, line: 1, col, length: 1 } });
  const form = text => ({ forms: [{ text, line: 1, col: 1, length: 1 }] });
  // Each source, and what it reads as. links-notation 0.20 alone takes time
  // that grows exponentially with how deeply the groups nest, with the square
  // of the length on the wide quote, and with the length to the power 1.5 on
  // the quotes of ever smaller widths. The last source has fifty thousand
  // quoted references for the front end to stand tokens in for.
  const sources = [
    ['groups nested to the limit', `${'('.repeat(depth)}a${')'.repeat(depth)}`, source => form(source)],
    ['a value in each group nested to the limit', `${'(a '.repeat(depth)}b${')'.repeat(depth)}`, source => form(source)],
    ['a name on each group nested to the limit', `${'(a: '.repeat(depth)}b${')'.repeat(depth)}`, source => form(source)],
    ['a quoted reference in each group nested to the limit', `${'("a b" '.repeat(depth)}"c d"${')'.repeat(depth)}`,
      source => form(source.replaceAll('"', "'"))],
    ['a value after each group nested to the limit', `${'('.repeat(depth)}${'a) b'.repeat(depth)}`,
      () => form(`(${'('.repeat(depth)}a)${' ba)'.repeat(depth - 1)} b)`)],
    ['groups nested to the limit left unclosed', `${'('.repeat(depth)}a`,
      () => failure('unexpected end of input', depth + 2)],
    ['a second name inside groups nested to the limit', `${'('.repeat(depth)}a: b: c${')'.repeat(depth)}`,
      () => failure('unexpected ":"', depth + 5)],
    ['a colon without a name inside groups nested to the limit', `${'('.repeat(depth)}:${')'.repeat(depth)}`,
      () => failure('unexpected ":"', depth + 1)],
    ['a wide unclosed quote before a long run of quotes', `${quotes(wide + 1)} a ${quotes(wide - 4)} ${'x'.repeat(2 * wide)}`,
      () => form(`("${quotes(wide + 1)}" a "" ${'x'.repeat(2 * wide)})`)],
    ['unclosed quotes of ever smaller widths', `${oddWidths.map(width => `${quotes(width)}x`).join(' ')} ${"a' ".repeat(words)}`,
      () => form(`(${oddWidths.slice(0, -1).map(width => `"${quotes(width)}x"`).join(' ')} 'x a' ${Array(words - 1).fill(`"a'"`).join(' ')})`)],
    ['even quotes of ever smaller widths around an unclosed parenthesis',
      `${evenWidths.map(quotes).join(' ')} ( ${'x '.repeat(words)}${[...evenWidths].reverse().map(quotes).join(' ')}`,
      source => failure('unexpected end of input', source.length + 1)],
    ['many quoted references on one line', "'a' ".repeat(references), () => form(`(${Array(references).fill('a').join(' ')})`)],
  ];

  for (const [name, source, expected] of sources) {
    it(`reads ${name} within ${READ_LIMIT_MS} ms`, () => {
      assert.deepStrictEqual(readWithinLimit(source), expected(source));
    });
  }
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

  it('keeps references of private-use characters apart from the names it makes', () => {
    // The front end names quoted references and groups with two private-use
    // characters that never stand side by side in the source: the first one
    // the source holds fewer than 6400 times, then the first one that never
    // follows it. Here U+E000 stands more than 6400 times, and U+E001 6399
    // times, before every private-use character but U+F8FF, so the names start
    // with U+E001 U+F8FF, and the references that start with U+E000 U+E000 or
    // with U+E001 U+E000 are read as they are.
    const privateUse = Array.from({ length: 6400 }, (_, index) => String.fromCharCode(0xe000 + index));
    const lines = [
      `(${privateUse.filter(character => character !== '\ue001').map(character => `\ue000${character}`).join(' ')} \ue000\ue000q0 \ue000\ue000g0)`,
      `(${privateUse.slice(3, -1).map(character => `\ue001${character}`).join(' ')} \ue001\ue001\ue002 \ue001\ue000q0)`,
      "('a b' (c (d 'e f')))",
    ];
    assert.deepStrictEqual(
      parseLinoDocument(lines.join('\n')),
      lines.map((text, index) => ({ text, line: index + 1, col: 1, length: 1 })),
    );
  });
});
