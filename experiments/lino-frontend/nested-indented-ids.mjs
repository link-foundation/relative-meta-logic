// Read indented ids nested under indented ids, and the lines around them, with
// both front ends, and print what each reads (issue #183). Run from the
// repository root:
//
//   node experiments/lino-frontend/nested-indented-ids.mjs
//
// The documents come from links-notation's GRAMMAR.md ("Hierarchical Nesting
// (Indentation)", which "produce[s] equivalent structures" to the inline
// `(outer: (inner: value1 value2) value3)`, and the "Indented Nesting" and
// "Mixed Syntax" examples), from the comments of
// link-foundation/links-notation#21, and from the refusals the front end keeps.
// The Rust side is `rust/examples/lino_forms.rs`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLinoDocument } from '../../js/src/rml-lino-frontend.mjs';

const DOCUMENTS = [
  ['a named line under an indented id', 'a:\n  b: c'],
  ['an indented id under an indented id', 'a:\n  b:\n    c'],
  ['an indented id under an indented id, then a value', 'a:\n  b:\n    c\n  d'],
  ['GRAMMAR.md, hierarchical nesting', 'outer:\n  inner:\n    value1\n    value2\n  value3'],
  ['GRAMMAR.md, inline nesting', '(outer: (inner: value1 value2) value3)'],
  ['GRAMMAR.md, parentheses across lines', '(outer:\n  (inner:\n    value1\n    value2)\n  value3)'],
  ['GRAMMAR.md, indented nesting', 'statement:\n  subject:\n    I\n  verb:\n    love\n  object:\n    you:\n      very\n      much'],
  ['GRAMMAR.md, inline nesting of the same statement', '(statement: (subject: I) (verb: love) (object: (you: very much)))'],
  ['GRAMMAR.md, mixed syntax', 'document:\n  (metadata: title author date)\n  content:\n    paragraph1\n    (paragraph2: text (with: nested structure))\n    paragraph3'],
  ['links-notation#21, atom', 'атом:\n    ядро:\n        нейтроны\n        протоны\n    электроны'],
  ['links-notation#21, sequence notation', 'image:\n    file: .gitpod.Dockerfile\n    context: ./docker-content'],
  ['links-notation#21, an indented id in a set', 'header\n  section\n    array:\n      1\n      2\n      3\n  section\n    item\n    item'],
  ['three indented ids', 'a:\n  b:\n    c:\n      d'],
  ['an empty indented id under an indented id', 'a:\n  b:\n  c'],
  ['a form after nested indented ids', 'a:\n  b:\n    c\n(d)'],
  ['nested indented ids under an indented line', '(x)\n  a:\n    b:\n      c'],
  ['a line under a value of a nested indented id', 'a:\n  b:\n    c\n      d'],
  ['a line under a named line of an indented id', 'a:\n  b: c\n    d'],
  ["links-notation's test 'Indented ID with deeper nesting'", 'root:\n  child1\n  child2\n    grandchild'],
];

function readJs(source) {
  try {
    return { forms: parseLinoDocument(source) };
  } catch (error) {
    return { error: { message: error.message, line: error.line, col: error.col, length: error.length } };
  }
}

function show(result) {
  if (result.error) {
    const { message, line, col } = result.error;
    return `${message} at ${line}:${col}`;
  }
  return result.forms.map(form => `${form.text} at ${form.line}:${form.col}`).join(', ');
}

const directory = mkdtempSync(join(tmpdir(), 'lino-nested-ids-'));
const sourcesPath = join(directory, 'sources.json');
writeFileSync(sourcesPath, JSON.stringify(DOCUMENTS.map(([, source]) => source)));
const rust = spawnSync('cargo', [
  'run', '--quiet', '--example', 'lino_forms', '--manifest-path', 'rust/Cargo.toml', '--', sourcesPath,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (rust.status !== 0) {
  console.error(rust.stderr);
  process.exit(1);
}
const rustResults = rust.stdout.trim().split('\n').map(text => JSON.parse(text));

let differing = 0;
DOCUMENTS.forEach(([name, source], index) => {
  const js = show(readJs(source));
  const rs = show(rustResults[index]);
  console.log(`${name}: ${JSON.stringify(source)}`);
  if (js === rs) {
    console.log(`  both: ${js}`);
  } else {
    differing += 1;
    console.log(`  js:   ${js}`);
    console.log(`  rust: ${rs}`);
  }
});
console.log(`${DOCUMENTS.length} documents: ${differing} read differently`);
process.exit(differing === 0 ? 0 : 1);
