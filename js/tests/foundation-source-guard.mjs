// Shared source scan for the unseen-logic guard. The Rust guard in
// rust/tests/foundation_unseen_logic_tests.rs applies the same rules.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseLino, parseOne, tokenizeOne } from '../src/rml-links.mjs';

// Words of the linked foundation schema itself. Every other leaf of the
// unseen fixture belongs to the user's logic and must stay out of host code.
const SCHEMA_WORDS = new Set([
  'linked-program', 'linked-fact', 'linked-inference', 'linked-rewrite',
  'linked-foundation', 'linked-instance', 'uses', 'rebind', 'premise',
  'conclusion', 'judgement', 'from', 'to', 'version', 'depends-on',
  'signature', 'cycle-policy', 'guard', 'theory', 'foundation', 'axioms',
  'inference', 'typing', 'reduction', 'equality', 'truth', 'proof',
  'inductive', 'guarded-coinductive', 'refutation-of',
]);
const FOUNDATION_MODULES = [
  'js/src/rml-foundation-workspace.mjs',
  'js/src/rml-foundation-packages.mjs',
  'rust/src/foundation_workspace.rs',
  'rust/src/foundation_packages.rs',
];
const IDENTIFIER_LITERAL = /^[a-z][a-z0-9-]*$/;

function leaves(term, output) {
  if (Array.isArray(term)) term.forEach(child => leaves(child, output));
  else output.add(term);
  return output;
}

function fixtureNames(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const link of parseLino(source.replace(/^[ \t]+/gm, ''))) {
      leaves(parseOne(tokenizeOne(link)), names);
    }
  }
  return [...names]
    .filter(name => !name.startsWith('?') && !/^\d+$/.test(name) && !SCHEMA_WORDS.has(name))
    .sort();
}

function sourceFiles(root, directory, extension, output = []) {
  for (const entry of readdirSync(join(root, directory)).sort()) {
    const relative = `${directory}/${entry}`;
    if (statSync(join(root, relative)).isDirectory()) sourceFiles(root, relative, extension, output);
    else if (entry.endsWith(extension)) output.push(relative);
  }
  return output;
}

function hostSources(root) {
  return [
    ...sourceFiles(root, 'js/src', '.mjs'),
    ...sourceFiles(root, 'rust/src', '.rs'),
  ].map(path => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}

// A name occurs when no identifier character continues it on either side.
function occurrences(names, files) {
  const found = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`);
    for (const file of files) if (pattern.test(file.text)) found.push(`${name} in ${file.path}`);
  }
  return found;
}

// Identifier-like string literals after comments and template literals are
// removed. JavaScript accepts either quote; Rust uses double quotes.
function identifierLiterals(path, text) {
  const javascript = path.endsWith('.mjs');
  let code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
  if (javascript) code = code.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const pattern = javascript ? /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g : /"((?:[^"\\\n]|\\.)*)"/g;
  const literals = new Set();
  for (const match of code.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (IDENTIFIER_LITERAL.test(value)) literals.add(value);
  }
  return literals;
}

function foundationLiterals(root) {
  const literals = new Set();
  for (const path of FOUNDATION_MODULES) {
    for (const value of identifierLiterals(path, readFileSync(join(root, path), 'utf8'))) literals.add(value);
  }
  return [...literals].sort();
}

export { FOUNDATION_MODULES, SCHEMA_WORDS, fixtureNames, foundationLiterals, hostSources, identifierLiterals, occurrences };
