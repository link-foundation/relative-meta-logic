// Show, with links-notation alone and no front end in between, what the
// shared LiNo front end works around (issue #183), in both runtimes. Run from
// the repository root:
//
//   node experiments/lino-frontend/upstream.mjs read
//   node experiments/lino-frontend/upstream.mjs time [js|rust] [seconds] [-- flags]
//
// `read` prints what the JavaScript and the Rust links-notation read from
// small documents, and what each writes the links it read back as: documents
// the two read differently, and documents both read with lines left out. `time` reads each shape below at growing sizes,
// each read in a child process, and stops a shape at the first read that
// takes longer than `seconds`, 10 by default, or that crashes; without `js`
// or `rust` it times both. The Rust reads go through
// `rust/examples/links_notation_alone.rs`, built in release mode, and the
// flags after `--` go to it: `-- --parse-only` times the Rust parser without
// the flattening after it, and `-- --stack-kib 2048` reads on a thread with the
// stack Rust gives a thread it starts.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const linksNotation = createRequire(join(root, 'js', 'package.json')).resolve('links-notation');
const { Parser, formatLinks } = await import(pathToFileURL(linksNotation).href);
const RUST_EXAMPLE = join(root, 'rust', 'target', 'release', 'examples', 'links_notation_alone');

// Each small document, and what it shows.
const DOCUMENTS = [
  ['a lone carriage return between two references', 'a\rb'],
  ['a lone carriage return inside a group', '(a\rb)'],
  ['a document of one no-break space', '\u00a0'],
  ['a document of one next-line character', '\u0085'],
  ['a byte order mark between two pairs of quotes', "''\ufeff''"],
  ['a next-line character between two pairs of quotes', "''\u0085''"],
  ['a group of one reference', '(1)'],
  ['one reference', '1'],
  ['a group of a group of one reference', '((1))'],
  ['a last line of only spaces', 'a\n  '],
  ['a line with an id under an indented id', 'a:\n  b: c'],
  ['the same line in parentheses', 'a:\n  (b: c)'],
  ["the document of links-notation's test 'Indented ID with deeper nesting'", 'root:\n  child1\n  child2\n    grandchild'],
  ['an indented id under an indented id', 'a:\n  b:\n    c\n  d'],
  ['a line indented under the line under a line without an id', 'a\n  b\n    c'],
];

// What a link reads as, in the form `links_notation_alone` prints: a reference
// as its name, and a link as its id and values.
function tree(link) {
  return link.values.length === 0 && link.id !== null
    ? link.id
    : { id: link.id, values: link.values.map(tree) };
}

// What the JavaScript links-notation reads from `source`, and with `format`
// also what `formatLinks` writes the links back as.
function readWithJs(source, format = false) {
  try {
    const links = new Parser().parse(source);
    return format ? { links: links.map(tree), formatted: formatLinks(links) } : { links: links.map(tree) };
  } catch (error) {
    return { error: error.message.split('\n')[0] };
  }
}

// Every character outside printable ASCII as a `\u` escape.
const ascii = value => JSON.stringify(value).replace(/[^\x20-\x7e]/g, character =>
  `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

// A file of `sources` as a JSON list, for `links_notation_alone` to read.
const scratch = join(mkdtempSync(join(tmpdir(), 'links-notation-')), 'sources.json');
function sourcesFile(sources) {
  writeFileSync(scratch, JSON.stringify(sources));
  return scratch;
}

function buildRust() {
  const build = spawnSync('cargo', [
    'build', '--quiet', '--release', '--example', 'links_notation_alone', '--manifest-path', join(root, 'rust', 'Cargo.toml'),
  ], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('cannot build rust/examples/links_notation_alone.rs');
}

function read() {
  buildRust();
  const sources = sourcesFile(DOCUMENTS.map(([, source]) => source));
  const rust = spawnSync(RUST_EXAMPLE, ['--format', sources], { encoding: 'utf8' });
  if (rust.status !== 0) throw new Error(rust.stderr);
  const rustResults = rust.stdout.trim().split('\n').map(line => JSON.parse(line));
  let differing = 0;
  DOCUMENTS.forEach(([name, source], index) => {
    const { error, links, formatted } = rustResults[index];
    const fromRust = error === undefined ? { links, formatted } : { error };
    const fromJs = readWithJs(source, true);
    // The two word their errors differently, so two errors count as the same.
    const bothFail = 'error' in fromJs && 'error' in fromRust;
    const same = bothFail || JSON.stringify(fromJs) === JSON.stringify(fromRust);
    if (!same) differing += 1;
    console.log(`${name}: ${ascii(source)}${bothFail ? ', both fail' : same ? ', read the same way' : ''}`);
    console.log(`  js:   ${ascii(fromJs)}`);
    console.log(`  rust: ${ascii(fromRust)}`);
  });
  console.log(`${DOCUMENTS.length} documents: ${differing} read differently`);
  // The JavaScript parser takes a `maxDepth` option and never looks at it.
  console.log(`js with maxDepth 1 reads "((a))" as ${ascii(new Parser({ maxDepth: 1 }).parse('((a))').map(tree))}`);
}

// Documents that take links-notation long to read, each by the size it grows
// with: how deeply its groups nest, or how many characters it holds. The
// nesting shapes are those of `depth-cost.mjs`, and the quote shapes those of
// `quote-reading.mjs`.
const NESTING = {
  'nested groups': depth => `${'('.repeat(depth)}a${')'.repeat(depth)}`,
  'a value in each nested group': depth => `${'(a '.repeat(depth)}b${')'.repeat(depth)}`,
  'a value after each nested group': depth => `${'('.repeat(depth)}${'a) b'.repeat(depth)}`,
  'nested groups left unclosed': depth => `${'('.repeat(depth)}a`,
  'a second name inside nested groups': depth => `${'('.repeat(depth)}a: b: c${')'.repeat(depth)}`,
  'a lone colon inside nested groups': depth => `${'('.repeat(depth)}:${')'.repeat(depth)}`,
};
const QUOTES = {
  'wide quote over a long run': size => {
    const width = size / 4;
    return `${"'".repeat(width + 1)} a ${"'".repeat(width - 4)} ${'x'.repeat(2 * width)}`;
  },
  'narrowing unclosed quotes': size => {
    const widths = [];
    for (let width = 2 * Math.floor(Math.sqrt(size / 2) / 2) + 1; width >= 1; width -= 2) widths.push(width);
    const head = widths.map(width => `${"'".repeat(width)}x`).join(' ');
    return `${head} ${"a' ".repeat(Math.max(0, (size - head.length) / 3))}`;
  },
  'narrowing empty references': size => {
    const widths = [];
    for (let width = 2 * Math.floor(Math.sqrt(size / 2) / 2); width >= 2; width -= 2) widths.push(width);
    const open = widths.map(width => "'".repeat(width)).join(' ');
    const close = [...widths].reverse().map(width => "'".repeat(width)).join(' ');
    return `${open} ( ${'x '.repeat(Math.max(0, (size - 2 * open.length) / 2))}${close}`;
  },
  'quoted references on one line': size => "'a' ".repeat(size / 4),
};
const SHAPES = { ...NESTING, ...QUOTES };
const DEPTHS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
const SIZES = [1000, 10_000, 100_000, 1_000_000, 10_000_000];

// How long one read takes in a child process, in a few words, and whether to
// stop growing the shape.
function timeOnce(runtime, shape, size, seconds, rustFlags) {
  const options = { encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 1 << 30 };
  const child = runtime === 'js'
    ? spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'time-one', shape, String(size)], options)
    : spawnSync(RUST_EXAMPLE, [...rustFlags, sourcesFile([SHAPES[shape](size)])], options);
  if (child.error?.code === 'ETIMEDOUT') return { stop: true, text: `over ${seconds} s` };
  if (child.status !== 0) {
    const reason = /overflowed its stack/.test(child.stderr) ? 'stack overflow' : child.stderr.trim().split('\n').pop();
    return { stop: true, text: `${reason} (${child.signal || `exit ${child.status}`})` };
  }
  const result = JSON.parse(child.stdout.trim().split('\n').pop());
  const ms = result.micros / 1000;
  const text = ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
  return { stop: false, text: 'error' in result ? `${text}, error: ${result.error.slice(0, 60)}` : text };
}

function time(runtimes, seconds, rustFlags) {
  if (runtimes.includes('rust')) buildRust();
  for (const shape of Object.keys(SHAPES)) {
    const sizes = shape in NESTING ? DEPTHS : SIZES;
    for (const runtime of runtimes) {
      const row = [];
      for (const size of sizes) {
        const { stop, text } = timeOnce(runtime, shape, size, seconds, rustFlags);
        row.push(`${size}: ${text}`);
        if (stop) break;
      }
      console.log(`${shape}, ${runtime}\n  ${row.join(', ')}`);
    }
  }
}

// One read in this process, printed the way `links_notation_alone` prints it.
function timeOne(shape, size) {
  const source = SHAPES[shape](Number(size));
  const started = process.hrtime.bigint();
  const result = readWithJs(source);
  const micros = Number(process.hrtime.bigint() - started) / 1000;
  console.log(JSON.stringify({ ...('error' in result ? { error: result.error } : {}), micros }));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'read') {
  read();
} else if (command === 'time') {
  const rustFlags = args.includes('--') ? args.splice(args.indexOf('--')).slice(1) : [];
  const runtimes = ['js', 'rust'].includes(args[0]) ? [args.shift()] : ['js', 'rust'];
  time(runtimes, Number(args[0] || 10), rustFlags);
} else if (command === 'time-one') {
  timeOne(...args);
} else {
  console.error('Usage: upstream.mjs read | time [js|rust] [seconds] [-- flags]');
  process.exit(2);
}
