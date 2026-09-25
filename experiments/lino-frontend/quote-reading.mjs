// Check how the shared LiNo front end reads references that start with a
// quote (issue #183). Run from the repository root:
//
//   node experiments/lino-frontend/quote-reading.mjs check <count> <seed>
//   node experiments/lino-frontend/quote-reading.mjs cost [module]
//
// `check` generates texts full of quote runs, parentheses, and whitespace, and
// compares every reference `prepareLinoSource` records in `quotes` with what
// the links-notation 0.20 grammar reads there: `parseQuotedStringAt`, which
// looks at one character after another, and an ordinary reference when it
// finds no quoted one. `cost` times `parseLinoDocument` on texts built to make
// quote reading slow, each in a child process with a time limit; `module` is
// the front end to load, `js/src/rml-lino-frontend.mjs` by default.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [command, ...args] = process.argv.slice(2);

// `parseQuotedStringAt` and `isSubstantiveBody` of the links-notation 0.20
// grammar, as `{ end, value }`.
function grammarQuoted(text, start) {
  const quote = text[start];
  let width = 0;
  while (text[start + width] === quote) width += 1;
  const even = width % 2 === 0;
  const empty = even ? { end: start + width, value: '' } : null;
  const close = quote.repeat(width);
  const escape = close.repeat(2);
  let content = '';
  let position = start + width;
  while (position < text.length) {
    if (text.substr(position, escape.length) === escape) {
      content += close;
      position += escape.length;
      continue;
    }
    if (text.substr(position, width) === close && text[position + width] !== quote) {
      let depth = 0;
      let visible = false;
      let balanced = true;
      for (const character of content) {
        if (character === '(') depth += 1;
        if (character === ')') {
          depth -= 1;
          if (depth < 0) balanced = false;
        }
        if (!/\s/.test(character)) visible = true;
      }
      if (even && !(visible && balanced && depth === 0)) return empty;
      return { end: position + width, value: content };
    }
    content += text[position];
    position += 1;
  }
  return empty;
}

// What the grammar reads at `start`: a quoted reference, or else the ordinary
// reference `simpleReference` reads, up to a space, a tab, a line break, `(`,
// `)`, or `:`.
function grammarReference(text, start) {
  const quoted = grammarQuoted(text, start);
  if (quoted !== null) return quoted;
  let end = start;
  while (end < text.length && !' \t\n():'.includes(text[end])) end += 1;
  return { end, value: text.slice(start, end) };
}

function randomTexts(count, seed) {
  const pick = n => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pieces = ["'", '"', '`', ' ', '(', ')', 'a', 'b', ':', '#', '\n', '\t', '\u0085', '\u00a0', '\ufeff', 'é'];
  const texts = [];
  for (let index = 0; index < count; index += 1) {
    let text = '';
    for (let length = 1 + pick(40); length > 0; length -= 1) {
      const piece = pieces[pick(pieces.length)];
      // Mostly quotes, in runs of every length up to nine.
      text += pick(2) === 0 ? "'\"`"[pick(3)].repeat(1 + pick(9)) : piece;
    }
    texts.push(text);
  }
  return texts;
}

async function check(count, seed) {
  const { prepareLinoSource } = await import('../../js/src/rml-lino-frontend.mjs');
  let references = 0;
  let refused = 0;
  let differing = 0;
  for (const text of randomTexts(count, seed)) {
    let prepared;
    try {
      prepared = prepareLinoSource(text);
    } catch {
      refused += 1;
      continue;
    }
    const { source, quotes } = prepared;
    for (const { start, end, value } of quotes) {
      references += 1;
      const expected = grammarReference(source, start);
      if (expected.end !== end || expected.value !== value) {
        differing += 1;
        if (differing <= 5) console.log(JSON.stringify({ source, start, read: { end, value }, expected }));
      }
    }
  }
  console.log(`${count} texts (${refused} refused), ${references} references: ${differing} read differently`);
  if (differing > 0) process.exitCode = 1;
}

// Texts of about `size` characters that make quote reading slow.
const SHAPES = {
  // A wide unclosed quote, then a run of almost as many quotes and a long word:
  // a reader that compares the opening quotes with the text at every character
  // compares most of the run again at every quote in it.
  'wide quote over a long run': size => {
    const width = size / 4;
    return `${"'".repeat(width + 1)} a ${"'".repeat(width - 4)} ${'x'.repeat(2 * width)}`;
  },
  // Unclosed quotes of ever smaller odd widths, then many words with a quote.
  'narrowing unclosed quotes': size => {
    const widths = [];
    for (let width = 2 * Math.floor(Math.sqrt(size / 2) / 2) + 1; width >= 1; width -= 2) widths.push(width);
    const head = widths.map(width => `${"'".repeat(width)}x`).join(' ');
    return `${head} ${"a' ".repeat(Math.max(0, (size - head.length) / 3))}`;
  },
  // Even quotes of ever smaller widths whose bodies leave a `(` open, so each
  // reads as the empty reference only once its body has been looked at.
  'narrowing empty references': size => {
    const widths = [];
    for (let width = 2 * Math.floor(Math.sqrt(size / 2) / 2); width >= 2; width -= 2) widths.push(width);
    const open = widths.map(width => "'".repeat(width)).join(' ');
    const close = [...widths].reverse().map(width => "'".repeat(width)).join(' ');
    return `${open} ( ${'x '.repeat(Math.max(0, (size - 2 * open.length) / 2))}${close}`;
  },
  // Many quoted references on one line.
  'quoted references on one line': size => "'a' ".repeat(size / 4),
};

async function time(modulePath, shape, size) {
  const { parseLinoDocument } = await import(pathToFileURL(resolve(modulePath)).href);
  const text = SHAPES[shape](size);
  const start = process.hrtime.bigint();
  let outcome;
  try {
    outcome = `${parseLinoDocument(text).length} forms`;
  } catch (error) {
    outcome = error.message;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(JSON.stringify({ shape, size, ms: Math.round(ms), outcome: outcome.slice(0, 60) }));
}

function cost(modulePath) {
  for (const shape of Object.keys(SHAPES)) {
    for (const size of [10_000, 100_000, 1_000_000]) {
      try {
        const out = execFileSync(process.execPath, [process.argv[1], 'time', modulePath, shape, String(size)], {
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 1 << 20,
        });
        process.stdout.write(out);
      } catch (error) {
        console.log(JSON.stringify({ shape, size, outcome: error.signal ? `stopped after 60 s (${error.signal})` : String(error.message).slice(0, 80) }));
      }
    }
  }
}

if (command === 'check') {
  await check(Number(args[0] || 20000), Number(args[1] || 1));
} else if (command === 'cost') {
  cost(args[0] || 'js/src/rml-lino-frontend.mjs');
} else if (command === 'time') {
  await time(args[0], args[1], Number(args[2]));
} else {
  console.error('Usage: quote-reading.mjs check <count> <seed> | cost [module]');
  process.exit(2);
}
