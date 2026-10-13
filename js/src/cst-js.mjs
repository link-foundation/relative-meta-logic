// JavaScript ↔ `.lino` CST converter (issue #138).
//
// Token-level lossless converter for JavaScript source. Produces a
// `lino-cst.js.*` flat CST. Round-trip is byte-faithful:
// `printJs(parseJs(src)) === src`.
//
// Scope: this converter operates at the token-stream level. It recognises:
//
//   - line comments (`// ...`)
//   - block comments (`/* ... */`)
//   - whitespace (spaces, tabs, CR, LF)
//   - hashbang on the first line (`#! ...`)
//   - string literals (`"..."`, `'...'`)
//   - template literals (``` `...${...}...` ```), with nested expressions
//   - numeric literals (decimal, hex, oct, bin, BigInt)
//   - regexp literals (best-effort, using a context heuristic)
//   - identifiers (Unicode XID-friendly)
//   - punctuation
//
// Regex disambiguation is the only non-trivial piece: a `/` is the start of a
// regex when it follows a token that cannot begin a binary-divide operand
// (e.g. `=`, `(`, `,`, `return`, etc.). We use the standard heuristic.

import { list, token, trivia, DIALECTS } from './cst.mjs';

const JS = DIALECTS.js;

/**
 * Parse JavaScript source into a `lino-cst.js.*` CST.
 *
 * @param {string} src JS source.
 * @returns {CstNode}
 */
export function parseJs(src) {
  return list(`${JS}.program`, tokeniseJs(String(src)));
}

/**
 * Print a JS CST back to source.
 * @param {CstNode} node
 * @returns {string}
 */
export function printJs(node) {
  const out = [];
  emit(node, out);
  return out.join('');
}

function emit(node, out) {
  if (!node) return;
  if (node.kind === 'token' || node.kind === 'trivia') {
    out.push(node.text);
    return;
  }
  if (node.kind === 'list') {
    if (node.open) out.push(node.open);
    for (const child of node.children) emit(child, out);
    if (node.close) out.push(node.close);
  }
}

const ID_START = /[A-Za-z_$]/;
const ID_CONT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'do', 'else', 'throw',
  'new', 'delete', 'void', 'await', 'yield', 'case',
]);

function tokeniseJs(src) {
  const out = [];
  let i = 0;
  let lastSignificant = null;

  if (src.startsWith('#!')) {
    let j = src.indexOf('\n');
    if (j === -1) j = src.length;
    out.push(trivia(src.substring(0, j), `${JS}.hashbang`));
    i = j;
  }

  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      let j = i;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r' || src[j] === '\n')) j++;
      out.push(trivia(src.substring(i, j), `${JS}.whitespace`));
      i = j;
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2;
      while (j < src.length && src[j] !== '\n') j++;
      out.push(trivia(src.substring(i, j), `${JS}.comment.line`));
      i = j;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      out.push(trivia(src.substring(i, j), `${JS}.comment.block`));
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      const j = scanString(src, i + 1, c);
      const tok = token(src.substring(i, j), `${JS}.string_literal`);
      out.push(tok);
      lastSignificant = tok;
      i = j;
      continue;
    }

    if (c === '`') {
      const j = scanTemplate(src, i);
      const tok = token(src.substring(i, j), `${JS}.template_literal`);
      out.push(tok);
      lastSignificant = tok;
      i = j;
      continue;
    }

    if (c === '/' && canBeRegex(lastSignificant)) {
      const j = scanRegex(src, i);
      if (j > i + 1) {
        const tok = token(src.substring(i, j), `${JS}.regexp_literal`);
        out.push(tok);
        lastSignificant = tok;
        i = j;
        continue;
      }
    }

    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1]))) {
      const j = scanNumber(src, i);
      const tok = token(src.substring(i, j), `${JS}.numeric_literal`);
      out.push(tok);
      lastSignificant = tok;
      i = j;
      continue;
    }

    const identifierStart = String.fromCodePoint(src.codePointAt(i));
    if (ID_START.test(identifierStart) || isUnicodeIdStart(identifierStart)) {
      let j = i + identifierStart.length;
      while (j < src.length) {
        const character = String.fromCodePoint(src.codePointAt(j));
        if (!(ID_CONT.test(character) || isUnicodeIdContinue(character))) break;
        j += character.length;
      }
      const tok = token(src.substring(i, j), `${JS}.ident`);
      out.push(tok);
      lastSignificant = tok;
      i = j;
      continue;
    }

    const tok = token(c, `${JS}.punct`);
    out.push(tok);
    lastSignificant = tok;
    i += 1;
  }

  return out;
}

function scanString(src, j, quote) {
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n' && (quote === '"' || quote === "'")) {
      // Unterminated; stop at end of line for safety.
      return j;
    }
    if (c === quote) return j + 1;
    j++;
  }
  return j;
}

function scanTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && src[j + 1] === '{') {
      // Skip nested ${ ... } expression with bracket counting.
      j += 2;
      let depth = 1;
      while (j < src.length && depth > 0) {
        const k = src[j];
        if (k === '{') depth++;
        else if (k === '}') depth--;
        else if (k === '"' || k === "'") j = scanString(src, j + 1, k) - 1;
        else if (k === '`') j = scanTemplate(src, j) - 1;
        else if (k === '/' && src[j + 1] === '/') {
          while (j < src.length && src[j] !== '\n') j++;
          continue;
        }
        else if (k === '/' && src[j + 1] === '*') {
          const e = src.indexOf('*/', j + 2);
          j = e === -1 ? src.length : e + 2;
          continue;
        }
        j++;
      }
      continue;
    }
    j++;
  }
  return j;
}

function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      // Flags
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      return j;
    } else if (c === '\n') {
      return i + 1;
    }
    j++;
  }
  return j;
}

function scanNumber(src, i) {
  let j = i;
  if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X')) {
    j += 2;
    while (j < src.length && (HEX.test(src[j]) || src[j] === '_')) j++;
  } else if (src[j] === '0' && (src[j + 1] === 'o' || src[j + 1] === 'O')) {
    j += 2;
    while (j < src.length && /[0-7_]/.test(src[j])) j++;
  } else if (src[j] === '0' && (src[j + 1] === 'b' || src[j + 1] === 'B')) {
    j += 2;
    while (j < src.length && /[01_]/.test(src[j])) j++;
  } else {
    while (j < src.length && (DIGIT.test(src[j]) || src[j] === '_')) j++;
    if (src[j] === '.') {
      j++;
      while (j < src.length && (DIGIT.test(src[j]) || src[j] === '_')) j++;
    }
    if (src[j] === 'e' || src[j] === 'E') {
      j++;
      if (src[j] === '+' || src[j] === '-') j++;
      while (j < src.length && (DIGIT.test(src[j]) || src[j] === '_')) j++;
    }
  }
  if (src[j] === 'n') j++; // BigInt suffix
  return j;
}

function canBeRegex(prev) {
  if (!prev) return true;
  if (prev.kind === 'trivia') return true;
  if (prev.tag === `${JS}.ident`) {
    return REGEX_PRECEDING_KEYWORDS.has(prev.text);
  }
  if (prev.tag === `${JS}.punct`) {
    // After most punctuation, `/` starts a regex.
    return !')]'.includes(prev.text);
  }
  return false;
}

function isUnicodeIdStart(c) {
  if (!c) return false;
  return c.codePointAt(0) > 0x7f;
}

function isUnicodeIdContinue(c) {
  return isUnicodeIdStart(c);
}
