// Generate LiNo documents with deeper parentheses than `differential.mjs`
// uses, record what the JavaScript front end reads from them, and compare
// what two front ends read (issue #183). Run from the repository root:
//
//   node experiments/lino-frontend/deep-documents.mjs generate <count> <seed> <depth> <sources.json> [cap]
//   node experiments/lino-frontend/deep-documents.mjs read <sources.json> <results.jsonl> [module]
//   node experiments/lino-frontend/deep-documents.mjs compare <results.jsonl> <results.jsonl>
//
// `depth` bounds how deep groups nest on purpose; `cap`, two more by default,
// bounds the nesting a document may reach once missing parentheses count.
// `read` prints one JSON line per source, the forms or the error. `module` is
// the front end to load, `js/src/rml-lino-frontend.mjs` by default, so two
// versions of a front end can read the same sources. `compare` prints every
// source two result files read differently, and looks only at the forms and
// the error, so it also compares what `read` printed with what the Rust front
// end prints:
//
//   cargo run --release --example lino_forms --manifest-path rust/Cargo.toml -- <sources.json> > <results.jsonl>
//
// The documents stress what reading deep groups one at a time has to keep:
// groups at the start of a line and after values, groups alone on a line,
// groups glued to references, quotes, `#`, and other groups, a colon after a
// group, names inside groups, empty groups, quoted parentheses, line breaks
// and comments inside groups, indentation, missing and extra parentheses, and
// errors at every depth.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [command, ...args] = process.argv.slice(2);

function generate(count, seed, maxDepth, cap) {
  // mulberry32, whose low bits do not repeat the way a small LCG's do.
  const pick = n => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const choose = items => items[pick(items.length)];
  const atoms = [
    'a', 'b', 'c', 'x:', '?', '#', '"q r"', "'s'", '`t`', "it's", '"a""b"', '"("', "')'",
    '"#"', 'é', '😀', 'a\u0085b', '"multi\nline"', '""', "''",
  ];
  const glue = ['', '', ' ', ' ', ' ', '  ', '\t', '\n', ' \n  '];
  function group(depth) {
    if (pick(40) === 0) return choose(['()', '( )', '(\n)']);
    const items = [];
    for (let i = pick(4); i > 0; i -= 1) {
      items.push(depth < maxDepth && pick(3) === 0 ? group(depth + 1) : choose(atoms));
    }
    // Keep one chain of groups going down to the deepest level most of the time.
    if (depth < maxDepth && pick(5) > 0) items.splice(pick(items.length + 1), 0, group(depth + 1));
    if (items.length > 0 && pick(6) === 0) items[0] = `${choose(['a', 'b', '"n m"'])}:${choose([' ', ''])}${items[0]}`;
    let body = '';
    items.forEach((item, index) => {
      const previous = index > 0 ? items[index - 1] : '';
      // Glue a group to its neighbours now and then; references need a space.
      const separator = previous.endsWith(')') || item.startsWith('(') ? choose(glue) : choose(glue.slice(2));
      body += index > 0 ? separator + item : item;
    });
    const comment = pick(12) === 0 ? ' # inner (\n' : '';
    const close = pick(60) === 0 ? '' : ')';
    const after = pick(20) === 0 ? choose([':', ' :', "'q'", '#x', 'b', '(c)', '(c)(d)', '"r"', '\u0085']) : '';
    return `(${comment}${body}${close}${after}`;
  }
  function line() {
    const items = [];
    for (let i = 1 + pick(3); i > 0; i -= 1) items.push(pick(3) ? group(1) : choose(atoms));
    const tail = pick(10) === 0 ? choose([' # note (', ' #', '# glued', ' # é😀']) : '';
    return items.join(choose([' ', ' ', '  ', '\t', ''])) + tail;
  }
  function document() {
    const lines = [];
    for (let i = 1 + pick(4); i > 0; i -= 1) {
      const kind = pick(12);
      if (kind === 0) lines.push(choose(['# comment', '  # indented comment', "# it's (", '']));
      else if (kind === 1) lines.push(choose(['name:', 'x:', 'a b:', '(a):', '(a b) c:']));
      else {
        const indent = lines.length > 0 && pick(4) === 0 ? choose(['  ', '    ', '\t', ' \t']) : '';
        lines.push(indent + line());
      }
    }
    if (pick(15) === 0) lines.push(choose(['(', ')', '(a "b', '(: a)', '((a)', '(a))']));
    const text = lines.join(choose(['\n', '\n', '\r\n']));
    return text + (pick(3) === 0 ? '\n' : '');
  }
  // The deepest nesting of parentheses, counting quoted ones too, so a missing
  // `)` that nests the rest of a document deeper still counts.
  const nesting = text => {
    let depth = 0;
    let deepest = 0;
    for (const character of text) {
      if (character === '(') deepest = Math.max(deepest, ++depth);
      if (character === ')') depth = Math.max(0, depth - 1);
    }
    return deepest;
  };
  const documents = [];
  while (documents.length < count) {
    const text = document();
    if (nesting(text) <= cap) documents.push(text);
  }
  return documents;
}

async function read(sourcesPath, resultsPath, modulePath) {
  const url = pathToFileURL(resolve(modulePath || 'js/src/rml-lino-frontend.mjs')).href;
  const { parseLinoDocument } = await import(url);
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const lines = sources.map(source => {
    try {
      return JSON.stringify({ forms: parseLinoDocument(source) });
    } catch (error) {
      const { message, line, col, length } = error;
      return JSON.stringify({ error: { message, line, col, length } });
    }
  });
  writeFileSync(resultsPath, `${lines.join('\n')}\n`);
}

// The forms or the error of every line of a result file, with their keys in
// one order, whatever else the line holds.
function results(path) {
  const keys = ['forms', 'error', 'text', 'message', 'line', 'col', 'length'];
  return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.stringify(JSON.parse(line), keys));
}

function compare(leftPath, rightPath) {
  const left = results(leftPath);
  const right = results(rightPath);
  let differing = 0;
  left.forEach((result, index) => {
    if (result === right[index]) return;
    differing += 1;
    if (differing <= 10) console.log(`${index}\n  ${result}\n  ${right[index]}`);
  });
  console.log(`${left.length} and ${right.length} results: ${differing} read differently`);
  process.exit(differing === 0 && left.length === right.length ? 0 : 1);
}

if (command === 'generate') {
  const [count, seed, depth, out, cap] = args;
  const deepest = cap === undefined ? Number(depth) + 2 : Number(cap);
  writeFileSync(out, JSON.stringify(generate(Number(count), Number(seed), Number(depth), deepest)));
} else if (command === 'read') {
  await read(...args);
} else if (command === 'compare') {
  compare(...args);
} else {
  console.error('Usage: deep-documents.mjs generate <count> <seed> <depth> <sources.json> [cap]');
  console.error('       deep-documents.mjs read <sources.json> <results.jsonl> [module]');
  console.error('       deep-documents.mjs compare <results.jsonl> <results.jsonl>');
  process.exit(2);
}
