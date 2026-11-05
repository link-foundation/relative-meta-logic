// Read generated LiNo documents with both front ends and print every document
// they read differently (issue #183). Run from the repository root:
//
//   node experiments/lino-frontend/differential.mjs [count] [seed]
//
// The documents mix references, quoted references, words with quotes, names,
// shallow parentheses, indentation by spaces and tabs, comments, byte order
// marks, all three line endings, and broken forms. Groups nest at most four
// deep; `deep-documents.mjs` generates deeper ones. Every short run of spaces,
// tabs, and line breaks also follows a few fixed documents: the Rust
// links-notation 0.20 parser refuses spaces at the end of a document that the
// JavaScript parser accepts, and the Rust front end has to repair that. The
// Rust side is `rust/examples/lino_forms.rs`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLinoDocument, prepareLinoSource } from '../../js/src/rml-lino-frontend.mjs';

const count = Number(process.argv[2] || 3000);
let seed = Number(process.argv[3] || 1);
function pick(n) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
}
const choose = items => items[pick(items.length)];

const atoms = [
  'a', 'b', 'c', 'x:', 'y:', '?', '#', '"q r"', "'s'", '`t`', "it's", '"a""b"',
  '"(" ', '")"', '"#"', 'é', '😀', '\u00a0', 'a\u0085b', '"multi\nline"',
];
function group(depth) {
  const items = [];
  for (let i = pick(4); i > 0; i -= 1) {
    items.push(depth < 3 && pick(3) === 0 ? group(depth + 1) : choose(atoms));
  }
  const separator = choose([' ', ' ', ' ', '  ', '\t', '\n  ']);
  const comment = pick(8) === 0 ? ' # inner (\n' : '';
  return `(${comment}${items.join(separator)})`;
}
function line() {
  const items = [];
  for (let i = 1 + pick(3); i > 0; i -= 1) items.push(pick(2) ? group(0) : choose(atoms));
  const tail = pick(10) === 0 ? choose([' # note (', ' #', '# glued', ' # é😀']) : '';
  return items.join(' ') + tail;
}
function document() {
  const lines = [];
  for (let i = 1 + pick(4); i > 0; i -= 1) {
    const kind = pick(12);
    if (kind === 0) lines.push(choose(['# comment', '  # indented comment', "# it's (", '']));
    else if (kind === 1) lines.push(choose(['name:', 'x:', 'a b:']));
    else {
      const indent = lines.length > 0 && pick(4) === 0 ? choose(['  ', '    ', '\t', ' \t']) : '';
      lines.push(indent + line());
    }
  }
  if (pick(15) === 0) lines.push(choose(['(', ')', '(a "b', '(: a)']));
  const text = lines.join(choose(['\n', '\n', '\r\n', '\r']));
  return (pick(20) === 0 ? '\ufeff' : '') + text + (pick(3) === 0 ? '\n' : '');
}

function errorOf(error) {
  return { message: error.message, line: error.line, col: error.col, length: error.length };
}
// The [line, column, text, value] of every reference that starts with a quote.
function quotesOf({ source, quotes }) {
  return quotes.map(({ start, end, value }) => {
    const before = source.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    return [before.split('\n').length, [...before.slice(lineStart)].length + 1, source.slice(start, end), value];
  });
}

function readJs(source) {
  const result = {};
  try {
    result.forms = parseLinoDocument(source);
  } catch (error) {
    result.error = errorOf(error);
  }
  try {
    const prepared = prepareLinoSource(source);
    result.prepared = prepared.prepared;
    result.lines = prepared.lines.map(logical => [logical.line, logical.col]);
    result.quotes = quotesOf(prepared);
  } catch (error) {
    result.prepareError = errorOf(error);
  }
  return result;
}

// JavaScript blanks one UTF-16 code unit per space and Rust one UTF-8 byte, so
// the prepared texts are compared only for ASCII sources.
const KEYS = ['forms', 'error', 'prepared', 'lines', 'quotes', 'prepareError', 'text', 'message', 'line', 'col', 'length'];
function comparable(result, source) {
  const copy = { ...result };
  if (/[^\x00-\x7f]/.test(source)) delete copy.prepared;
  return JSON.stringify(copy, KEYS);
}

function trailingSpaceDocuments() {
  const endings = [''];
  for (let length = 1; length <= 4; length += 1) {
    for (const ending of endings.filter(ending => ending.length === length - 1)) {
      endings.push(...[' ', '\t', '\n'].map(character => ending + character));
    }
  }
  const documents = ['a', "'s' a", '(a)', 'a:', 'a:\n  b', '(a)\n  (b)', '(b', 'a b:', '(a)\n  (b)\n    (c)', '(a)\n# end'];
  return documents.flatMap(document => endings.map(ending => document + ending));
}

const sources = [...trailingSpaceDocuments(), ...Array.from({ length: count }, document)];
const directory = mkdtempSync(join(tmpdir(), 'lino-differential-'));
const sourcesPath = join(directory, 'sources.json');
writeFileSync(sourcesPath, JSON.stringify(sources));
const rust = spawnSync('cargo', [
  'run', '--quiet', '--example', 'lino_forms', '--manifest-path', 'rust/Cargo.toml', '--', sourcesPath,
], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (rust.status !== 0) {
  console.error(rust.stderr);
  process.exit(1);
}
const rustResults = rust.stdout.trim().split('\n').map(text => JSON.parse(text));

let differing = 0;
const reasons = new Map();
const outcomes = { forms: 0, error: 0 };
sources.forEach((source, index) => {
  const js = readJs(source);
  outcomes[js.error ? 'error' : 'forms'] += 1;
  if (js.error) reasons.set(js.error.message, (reasons.get(js.error.message) || 0) + 1);
  if (comparable(js, source) !== comparable(rustResults[index], source)) {
    differing += 1;
    if (differing <= 10) {
      console.log(JSON.stringify(source));
      console.log('  js  ', JSON.stringify(js));
      console.log('  rust', JSON.stringify(rustResults[index]));
    }
  }
});
for (const [reason, times] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${times} refused: ${reason}`);
console.log(`${sources.length} documents (${outcomes.forms} read, ${outcomes.error} refused): ${differing} read differently`);
process.exit(differing === 0 ? 0 : 1);
