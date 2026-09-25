#!/usr/bin/env node
// English-readability lint for `.lino` files.
//
// Heuristically flags links that drift away from the design promise that
// every link should read as an English sentence. Two classes of violation
// are reported:
//
//   identifiers-without-hyphens  — multi-word identifiers that use `_` or
//                                  run-together camelCase / lower-case words
//                                  instead of `kebab-case`.
//   operator-only-link           — top-level links whose body contains no
//                                  word-form alternative (purely operator
//                                  characters, numbers and punctuation).
//
// Usage: node scripts/lint-english.mjs <files...>
//        node scripts/lint-english.mjs --allowlist scripts/lint-english.allowlist.json examples/*.lino
//
// Exits with a non-zero status when any violation is reported. An allow-list
// file (JSON) may contain `identifiers` (array of strings), `identifierFiles`
// (array of basenames whose identifiers must preserve external spelling), and
// `links` (array of `file:line` strings) to silence specific known cases.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------- Reserved vocabulary ----------
// Built-in operators and keywords are part of the RML/LiNo surface and must
// not be flagged when they appear as identifiers. They are the natural
// English-readable spelling on their own.
const RESERVED_KEYWORDS = new Set([
  // Operators (symbols)
  '=', '!=', '+', '-', '*', '/', '?', ':',
  // Logical connectives & prepositions
  'is', 'has', 'probability', 'of', 'not', 'and', 'or',
  'both', 'neither', 'nor',
  // Configuration
  'range', 'valence',
  // Truth constants
  'true', 'false', 'unknown', 'undefined',
  // Aggregator names
  'min', 'max', 'avg', 'product', 'prod', 'probabilistic_sum', 'ps',
  // Type system
  'Type', 'type', 'apply', 'lambda', 'Pi',
]);

// Word-form alternatives that count as making a link "read as English".
// A link that references at least one of these (or any plain alphabetic
// identifier) avoids the operator-only-link rule.
//
// Note: numeric literals do not count.
const ENGLISH_WORD_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

// ---------- Tokenizer ----------
// Each token is `{ value, line, col, length }` with 1-based positions.
// Comments (`#` to end of line) are stripped but their newlines preserved.
function tokenize(source) {
  const tokens = [];
  let line = 1;
  let col = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') { line++; col = 1; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (/\s/.test(ch)) { col++; i++; continue; }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') { i++; col++; }
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ value: ch, line, col, length: 1 });
      i++; col++; continue;
    }
    // Atom: collect until whitespace, parenthesis, or comment marker
    const startLine = line;
    const startCol = col;
    let j = i;
    while (j < source.length) {
      const cj = source[j];
      if (cj === '(' || cj === ')' || cj === '#' || /\s/.test(cj)) break;
      j++;
    }
    tokens.push({
      value: source.slice(i, j),
      line: startLine,
      col: startCol,
      length: j - i,
    });
    col += j - i;
    i = j;
  }
  return tokens;
}

// ---------- Parser: a tree of tokens preserving source positions ----------
function parseLinks(tokens) {
  const links = [];
  let i = 0;
  function readNode() {
    const tok = tokens[i];
    if (tok.value === '(') {
      const open = tok;
      i++;
      const children = [];
      while (i < tokens.length && tokens[i].value !== ')') {
        children.push(readNode());
      }
      if (i >= tokens.length) {
        throw new Error(`Unmatched "(" at line ${open.line}:${open.col}`);
      }
      i++; // consume ')'
      return { kind: 'list', children, line: open.line, col: open.col };
    }
    if (tok.value === ')') {
      throw new Error(`Unmatched ")" at line ${tok.line}:${tok.col}`);
    }
    i++;
    return { kind: 'atom', value: tok.value, line: tok.line, col: tok.col, length: tok.length };
  }
  while (i < tokens.length) {
    if (tokens[i].value !== '(') {
      throw new Error(`Expected "(" at line ${tokens[i].line}:${tokens[i].col}, got "${tokens[i].value}"`);
    }
    links.push(readNode());
  }
  return links;
}

// ---------- Identifier collection ----------
function* walkAtoms(node) {
  if (node.kind === 'atom') {
    yield node;
    return;
  }
  for (const child of node.children) yield* walkAtoms(child);
}

const NUMERIC_RE = /^-?(\d+(\.\d+)?|\.\d+)$/;

function isNumeric(value) {
  return NUMERIC_RE.test(value);
}

function isReserved(value) {
  return RESERVED_KEYWORDS.has(value);
}

// ---------- Rule 1: identifiers-without-hyphens ----------
// Flags identifiers that appear to combine multiple English words without a
// hyphen separator. The heuristic catches:
//   - underscores: foo_bar           → suggest foo-bar
//   - lowerCamelCase: fooBar         → suggest foo-bar
//   - PascalCase across >1 word with all-lower neighbours: e.g. fooBar (above)
//
// Single-word lowercase identifiers (`alice`, `cloudy`) are fine.
// Single-word PascalCase type names (`Natural`, `Boolean`, `Type`) are fine.
function suggestKebab(value) {
  // Replace underscores with hyphens, then split camelCase boundaries.
  const replaced = value
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  // Avoid leading capitals affecting the suggestion when the original was lower.
  return replaced.toLowerCase();
}

function checkIdentifierShape(value) {
  if (isReserved(value)) return null;
  if (isNumeric(value)) return null;
  // Allow pure-symbol operator-style atoms here — those are caught by rule 2.
  if (!/[A-Za-z]/.test(value)) return null;

  // Underscores are an explicit violation.
  if (value.includes('_')) {
    return {
      code: 'identifiers-without-hyphens',
      message: `identifier "${value}" uses "_"; prefer hyphen-case "${suggestKebab(value)}"`,
    };
  }

  // CamelCase that is NOT a single PascalCase word.
  // A pure PascalCase single word like `Natural` matches /^[A-Z][a-z0-9]*$/.
  // A pure lowercase single word like `alice` matches /^[a-z][a-z0-9]*$/.
  // Anything else with internal capital boundaries is flagged.
  const isPascalSingle = /^[A-Z][a-z0-9]*$/.test(value);
  const isLowerSingle = /^[a-z][a-z0-9]*$/.test(value);
  const isAlreadyKebab = /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)+$/.test(value);
  if (isPascalSingle || isLowerSingle || isAlreadyKebab) return null;

  // Detect a camelCase / mixed-case multi-word identifier: at least one
  // lower-then-upper transition (`fooBar`).
  if (/[a-z][A-Z]/.test(value)) {
    return {
      code: 'identifiers-without-hyphens',
      message: `identifier "${value}" uses camelCase; prefer hyphen-case "${suggestKebab(value)}"`,
    };
  }

  return null;
}

// ---------- Rule 2: operator-only-link ----------
// A top-level link is "operator-only" when its body contains no word-form
// alternative — every atom is either a symbol/operator from RESERVED_KEYWORDS
// or a numeric literal. Such a link does not read as an English sentence.
//
// Exceptions:
//   - The empty link `()` is not flagged (parser tolerance).
//   - A bare query of a numeric expression like `(? 0.5)` IS flagged because
//     it conveys nothing in English — though numeric calculations like
//     `(? (0.1 + 0.2))` are also flagged. To keep the lint useful without
//     over-firing on the bayesian / markov examples that legitimately probe
//     arithmetic, we only flag operator-only DEFINITIONS, not queries.
function isOperatorOnlyDefinition(node) {
  if (node.kind !== 'list') return false;
  // Look at the head token to spot definitions: `(head: ...)` form.
  // The tokenizer keeps `:` attached to the head when written as `head:`,
  // so we recognise both `(name:` and `(name :` shapes.
  const children = node.children;
  if (children.length < 1) return false;
  const head = children[0];
  // Find a definition shape: head atom ending in ':' OR second atom equal to ':'.
  let definedName = null;
  if (head.kind === 'atom' && head.value.endsWith(':') && head.value.length > 1) {
    definedName = head.value.slice(0, -1);
  } else if (head.kind === 'atom' && children[1] && children[1].kind === 'atom' && children[1].value === ':') {
    definedName = head.value;
  }
  if (definedName == null) return false;

  // Skip queries, anything that is not a definition.
  if (definedName === '?' || definedName === '') return false;
  // The defined name itself must be operator-only (no letters).
  if (/[A-Za-z]/.test(definedName)) return false;
  // Numeric "definitions" don't really happen in valid lino, but skip just in case.
  if (isNumeric(definedName)) return false;
  // Allowed operator-only definitions still need a word-form alternative; the
  // fact that they are defined with operator-only body is what we flag.
  // Any alphabetic atom in the body counts as an English word form, including
  // reserved connectives like `not`, `and`, `is` — those make a definition
  // such as `(!=: not =)` read as "!= is not equals", which is the desired
  // shape.
  for (const atom of walkAtoms(node)) {
    // Skip the head's defined name itself.
    if (atom === head) continue;
    if (atom.value === ':') continue;
    if (ENGLISH_WORD_RE.test(atom.value)) {
      // A word-form atom appears in the body — link is not operator-only.
      return false;
    }
  }
  return { name: definedName };
}

// ---------- Allow-list ----------
function loadAllowlist(allowlistPath) {
  const empty = { identifiers: new Set(), identifierFiles: new Set(), links: new Set() };
  if (!allowlistPath) return empty;
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(`Allow-list file not found: ${allowlistPath}`);
  }
  const raw = fs.readFileSync(allowlistPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Allow-list file is not valid JSON (${allowlistPath}): ${e.message}`);
  }
  return {
    identifiers: new Set(Array.isArray(parsed.identifiers) ? parsed.identifiers : []),
    identifierFiles: new Set(
      Array.isArray(parsed.identifierFiles) ? parsed.identifierFiles : [],
    ),
    links: new Set(Array.isArray(parsed.links) ? parsed.links : []),
  };
}

// ---------- Lint a single file ----------
function lintFile(filePath, source, allowlist) {
  const violations = [];
  let tokens;
  try {
    tokens = tokenize(source);
  } catch (e) {
    violations.push({
      file: filePath,
      line: 1,
      col: 1,
      code: 'parse-error',
      message: `tokenizer error: ${e.message}`,
    });
    return violations;
  }
  let links;
  try {
    links = parseLinks(tokens);
  } catch (e) {
    violations.push({
      file: filePath,
      line: 1,
      col: 1,
      code: 'parse-error',
      message: e.message,
    });
    return violations;
  }

  for (const link of links) {
    // Rule 2: operator-only definition.
    const opOnly = isOperatorOnlyDefinition(link);
    if (opOnly) {
      const linkKey = `${path.basename(filePath)}:${link.line}`;
      if (!allowlist.links.has(linkKey)) {
        violations.push({
          file: filePath,
          line: link.line,
          col: link.col,
          code: 'operator-only-link',
          message: `definition of operator "${opOnly.name}" has no English word-form alternative; consider adding e.g. (${suggestWordForm(opOnly.name)}: ${opOnly.name})`,
        });
      }
    }

    // Rule 1: identifier shape — applied to every atom in the link.
    for (const atom of walkAtoms(link)) {
      // Strip a trailing ':' that the tokenizer keeps attached to definition heads.
      let value = atom.value;
      if (value.endsWith(':') && value.length > 1) value = value.slice(0, -1);
      if (allowlist.identifiers.has(value) ||
          allowlist.identifierFiles?.has(path.basename(filePath))) continue;
      const finding = checkIdentifierShape(value);
      if (finding) {
        violations.push({
          file: filePath,
          line: atom.line,
          col: atom.col,
          code: finding.code,
          message: finding.message,
        });
      }
    }
  }

  return violations;
}

// Suggest a plausible English word form for a known operator.
const OPERATOR_WORD_FORMS = {
  '=': 'equals',
  '!=': 'differs-from',
  '+': 'plus',
  '-': 'minus',
  '*': 'times',
  '/': 'divided-by',
};
function suggestWordForm(op) {
  return OPERATOR_WORD_FORMS[op] || `${op}-word-form`;
}

// ---------- CLI ----------
function parseArgs(argv) {
  const out = { files: [], allowlist: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--allowlist') {
      out.allowlist = argv[++i];
      continue;
    }
    if (a.startsWith('--allowlist=')) {
      out.allowlist = a.slice('--allowlist='.length);
      continue;
    }
    out.files.push(a);
  }
  return out;
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/lint-english.mjs [--allowlist <path>] <files...>',
    '',
    'Flags links that violate the project\'s English-readability conventions:',
    '  identifiers-without-hyphens  identifiers with `_` or camelCase',
    '  operator-only-link           operator definitions with no word form',
    '',
    'The optional allow-list is a JSON file with `identifiers`,',
    '`identifierFiles`, and `links` ("<basename>:<line>") arrays.',
    'Listed entries are exempted from their respective rule.',
    '',
  ].join('\n'));
}

function formatViolation(v) {
  return `${v.file}:${v.line}:${v.col}: ${v.code}: ${v.message}`;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  if (args.files.length === 0) {
    process.stderr.write('No files supplied. See --help.\n');
    return 2;
  }
  let allowlist;
  try {
    allowlist = loadAllowlist(args.allowlist);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }

  let total = 0;
  for (const file of args.files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (e) {
      process.stderr.write(`${file}: cannot read (${e.message})\n`);
      total++;
      continue;
    }
    const violations = lintFile(file, source, allowlist);
    for (const v of violations) {
      process.stdout.write(`${formatViolation(v)}\n`);
    }
    total += violations.length;
  }

  if (total === 0) {
    process.stdout.write(`lint-english: ${args.files.length} file(s) clean.\n`);
    return 0;
  }
  process.stdout.write(`lint-english: ${total} violation(s) in ${args.files.length} file(s).\n`);
  return 1;
}

// Exports for tests.
export {
  tokenize,
  parseLinks,
  checkIdentifierShape,
  isOperatorOnlyDefinition,
  lintFile,
  loadAllowlist,
  suggestKebab,
  suggestWordForm,
};

// Run as CLI when invoked directly.
const invokedDirectly = (() => {
  try {
    const thisFile = path.resolve(new URL(import.meta.url).pathname);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return thisFile === argv1;
  } catch { return false; }
})();
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
