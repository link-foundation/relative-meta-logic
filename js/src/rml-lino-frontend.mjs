// Shared LiNo front end: the one way RML reads a LiNo document.
//
// JavaScript and Rust read RML source through the same steps, so a document
// yields the same forms, spans, and parse diagnostics in both runtimes. The
// Rust mirror is `rust/src/lino_frontend.rs`, and both test suites check the
// cases in `test-corpus/lino-frontend/cases.json`.
//
// 1. Normalize: drop a leading U+FEFF and read CRLF and a lone CR as LF. Every
//    position reported afterwards refers to this normalized source, counted
//    in 1-based lines and Unicode code points.
// 2. Prepare, in one pass that knows where quoted references are:
//    - blank comments: a line whose first character other than a space or a
//      tab is `#`, and the rest of a line from a `#` that follows `)` plus
//      spaces or tabs, turn into spaces; a `#` inside a quoted reference is an
//      ordinary character;
//    - flatten layout: a line break inside parentheses reads as a space, which
//      keeps the flat-list meaning of RML's parenthesized forms;
//    - record the logical lines, the lines that start outside parentheses and
//      quoted references and hold more than spaces and tabs;
//    - reject nesting deeper than `MAX_LINO_NESTING_DEPTH` (parentheses plus
//      indentation levels) and sources longer than `MAX_LINO_SOURCE_UNITS`
//      UTF-16 code units, before the parser can exhaust the stack.
//    Every character of the prepared text stands where the character it
//    replaces stood, so parser positions are source positions.
// 3. Parse with links-notation and format every top-level link, with one
//    repair: a line under an indented id keeps its name, so `a:` over `b: c`
//    reads as `(a: (b: c))`, and a line indented under such a line is refused
//    where links-notation 0.20 would drop it.
// 4. Drop comment links such as `(# note)`, and give every other form the
//    position of the first character other than a space or a tab on the line
//    it starts on.
//
// Any failure is a `LinoParseError` (diagnostic code E006) that names the
// offending character and its position.
//
// A quoted reference opens only where the grammar starts a reference: at the
// start of a line or after a space, a tab, `(`, `)`, `:`, or another quoted
// reference. A quote inside a word, as in `it's`, is part of that word.
//
// The nesting limit protects the stack, not the time: links-notation 0.20
// backtracks without memoizing, so its parse time grows exponentially with the
// nesting depth of parentheses.

import { Link, Parser } from 'links-notation';

/** Deepest nesting of parentheses plus indentation levels a document may use. */
export const MAX_LINO_NESTING_DEPTH = 64;

/** Longest source, in UTF-16 code units, the links-notation parser accepts. */
export const MAX_LINO_SOURCE_UNITS = 10 * 1024 * 1024;

/**
 * A LiNo document that could not be read, located in the normalized source.
 */
export class LinoParseError extends Error {
  /**
   * @param {string} detail - What went wrong, without the `LiNo parse failure` prefix.
   * @param {Object} [position] - 1-based position of the offending character.
   * @param {number} [position.line] - Line, 1 when unknown.
   * @param {number} [position.col] - Column in Unicode code points, 1 when unknown.
   * @param {number} [position.length] - Length of the offending text, 0 when unknown.
   */
  constructor(detail, position = {}) {
    super(`LiNo parse failure: ${detail}`);
    this.name = 'LinoParseError';
    this.code = 'E006';
    this.detail = detail;
    this.line = position.line ?? 1;
    this.col = position.col ?? 1;
    this.length = position.length ?? 0;
  }
}

/**
 * Drop a leading byte order mark and read CRLF and a lone CR as LF.
 *
 * @param {string} text - LiNo source text.
 * @returns {string} The normalized source every reported position refers to.
 */
export function normalizeLinoSource(text) {
  const source = String(text);
  const withoutBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return withoutBom.replace(/\r\n?/g, '\n');
}

// Whether the body of an even run of quotes carries something visible; this
// mirrors `isSubstantiveBody` in the links-notation 0.20 grammar.
function hasSubstantiveQuotedBody(text) {
  let depth = 0;
  let visible = false;
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
    if (!/\s/.test(character)) visible = true;
  }
  return visible && depth === 0;
}

// The position after the quoted reference that starts at `start`, read with
// the links-notation 0.20 N-quote rules, or `null` when none starts there. The
// Rust runtime uses `links_notation::parser::quoted_reference_end`.
function quotedReferenceEnd(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let width = 1;
  while (text[start + width] === quote) width += 1;
  const delimiter = quote.repeat(width);
  const escape = delimiter.repeat(2);
  const emptyEnd = width % 2 === 0 ? start + width : null;
  let position = start + width;
  while (position < text.length) {
    if (text.startsWith(escape, position)) {
      position += escape.length;
      continue;
    }
    if (text.startsWith(delimiter, position) && text[position + width] !== quote) {
      const end = position + width;
      const body = text.slice(start + width, position);
      return width % 2 !== 0 || hasSubstantiveQuotedBody(body) ? end : emptyEnd;
    }
    position += 1;
  }
  return emptyEnd;
}

// The 1-based line and code-point column of a UTF-16 offset in `source`.
function positionAt(source, offset) {
  let line = 1;
  let lineStart = 0;
  for (let index = source.indexOf('\n'); index !== -1 && index < offset; index = source.indexOf('\n', index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, col: [...source.slice(lineStart, offset)].length + 1 };
}

// Move an offset inside a surrogate pair back to the start of its code point.
function codePointStart(source, offset) {
  if (offset > 0 && offset < source.length) {
    const unit = source.charCodeAt(offset);
    const previous = source.charCodeAt(offset - 1);
    if (unit >= 0xdc00 && unit <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) {
      return offset - 1;
    }
  }
  return offset;
}

function describeCharacter(character) {
  if (character === '"') return '\\"';
  if (character === '\\') return '\\\\';
  if (character === '\t') return '\\t';
  if (character === '\n') return '\\n';
  if (character === '\r') return '\\r';
  const code = character.codePointAt(0);
  if (code >= 0x20 && code <= 0x7e) return character;
  return `\\u{${code.toString(16)}}`;
}

function unexpectedAt(source, offset) {
  if (offset >= source.length) {
    return new LinoParseError('unexpected end of input', { ...positionAt(source, source.length), length: 1 });
  }
  const at = codePointStart(source, Math.max(0, offset));
  const character = String.fromCodePoint(source.codePointAt(at));
  return new LinoParseError(`unexpected "${describeCharacter(character)}"`, { ...positionAt(source, at), length: 1 });
}

function nestingError(source, offset) {
  return new LinoParseError(`nesting deeper than ${MAX_LINO_NESTING_DEPTH} levels`, {
    ...positionAt(source, offset),
    length: 1,
  });
}

/**
 * Prepare a LiNo source for the links-notation parser.
 *
 * The prepared text has the length of the normalized source, and every
 * character in it sits at the position of the character it stands for.
 * `lines` lists the logical lines, each with the offset, line, and column of
 * its first character other than a space or a tab.
 *
 * @param {string} text - LiNo source text.
 * @returns {{source: string, prepared: string, lines: Array.<{offset: number, line: number, col: number}>}}
 * @throws {LinoParseError} When the source breaks the size or nesting limit.
 */
export function prepareLinoSource(text) {
  const source = normalizeLinoSource(text);
  if (source.length > MAX_LINO_SOURCE_UNITS) {
    throw new LinoParseError(`source longer than ${MAX_LINO_SOURCE_UNITS} UTF-16 code units`);
  }
  const parts = [];
  const lines = [];
  // Indentation levels the way the links-notation grammar stacks them: the
  // first logical line sets the base, a deeper line opens a level, and a
  // shallower line closes every level deeper than itself.
  const levels = [0];
  let base = null;
  let lineDepth = 0;
  let depth = 0;
  let line = 1;
  let lineStart = 0;
  let copied = 0;
  // Whether the previous character continues an unquoted reference, where a
  // quote is an ordinary character instead of an opening delimiter.
  let inReference = false;
  // Replace the rest of the line from `start` with spaces; return its end.
  const blankRestOfLine = start => {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline;
    parts.push(source.slice(copied, start), ' '.repeat(end - start));
    copied = end;
    return end;
  };
  let index = 0;
  while (index < source.length) {
    if (index === lineStart) {
      let first = index;
      while (source[first] === ' ' || source[first] === '\t') first += 1;
      if (source[first] === '#') {
        index = blankRestOfLine(first);
        continue;
      }
      if (depth === 0 && first < source.length && source[first] !== '\n') {
        let spaces = 0;
        while (source[index + spaces] === ' ') spaces += 1;
        if (base === null) base = spaces;
        const width = Math.max(0, spaces - base);
        if (width > levels[levels.length - 1]) {
          levels.push(width);
        } else {
          while (width < levels[levels.length - 1]) levels.pop();
        }
        lineDepth = levels.length - 1;
        if (lineDepth > MAX_LINO_NESTING_DEPTH) throw nestingError(source, first);
        lines.push({ offset: first, line, col: first - index + 1 });
      }
    }
    const character = source[index];
    if (!inReference && (character === '"' || character === "'" || character === '`')) {
      const end = quotedReferenceEnd(source, index);
      if (end !== null) {
        for (let inner = source.indexOf('\n', index); inner !== -1 && inner < end; inner = source.indexOf('\n', inner + 1)) {
          line += 1;
        }
        index = end;
        continue;
      }
    }
    if (character === '\n') {
      line += 1;
      lineStart = index + 1;
      inReference = false;
      if (depth > 0) {
        parts.push(source.slice(copied, index), ' ');
        copied = index + 1;
      }
    } else if (character === '(') {
      depth += 1;
      inReference = false;
      if (lineDepth + depth > MAX_LINO_NESTING_DEPTH) throw nestingError(source, index);
    } else if (character === ')') {
      depth = Math.max(0, depth - 1);
      inReference = false;
      let hash = index + 1;
      while (source[hash] === ' ' || source[hash] === '\t') hash += 1;
      if (hash > index + 1 && source[hash] === '#') {
        index = blankRestOfLine(hash);
        continue;
      }
    } else {
      inReference = character !== ' ' && character !== '\t' && character !== ':';
    }
    index += 1;
  }
  parts.push(source.slice(copied));
  return { source, prepared: parts.join(''), lines };
}

function isIndentedIdItem(item) {
  return item.id !== undefined && item.id !== null && (!item.values || item.values.length === 0);
}

// A parser that keeps the items links-notation parsed before it turned them
// into links, so every link can be traced back to the line it starts on.
class RecordingParser extends Parser {
  transformResult(rawResult) {
    this.rawItems = Array.isArray(rawResult) ? rawResult : [rawResult];
    return super.transformResult(rawResult);
  }

  // links-notation 0.20 reads each line under an indented id through its
  // single value, which drops the name of a line such as `b: c`. Keep such a
  // line whole, `(a: (b: c))`, the way the line `(b: c)` reads.
  collectLinks(item, parentPath, result) {
    if (item && item.children && item.children.length > 0 && isIndentedIdItem(item)) {
      const values = item.children.map(child => (
        child.values && child.values.length === 1 && (child.id === undefined || child.id === null)
          ? this.transformLink(child.values[0])
          : this.transformLink(child)));
      const current = this.transformLink({ id: item.id, values });
      result.push(parentPath.length === 0 ? current : this.combinePathElements(parentPath, current));
      return;
    }
    super.collectLinks(item, parentPath, result);
  }
}

/** Why a line indented under a value of an indented id is refused. */
const DROPPED_LINE = 'unexpected indentation under a value of an indented id';

// The logical line each top-level link comes from, in the order
// `collectLinks` produces them: an item gives one link at its line; an
// indented-id item (`name:` over indented lines) takes in the lines under it,
// and any other item is followed by its children. `indexes` is `null` when the
// items do not account for every logical line. `dropped` is the index of the
// first line links-notation would leave out, a line indented under a value of
// an indented id, or `null`.
function traceLinkLines(rawItems, lineCount) {
  const indexes = [];
  let next = 0;
  let dropped = null;
  const skip = item => {
    next += 1;
    for (const child of item.children || []) skip(child);
  };
  const visit = item => {
    indexes.push(next);
    next += 1;
    const children = item.children || [];
    if (children.length > 0 && isIndentedIdItem(item)) {
      for (const value of children) {
        next += 1;
        const under = value.children || [];
        if (under.length > 0 && dropped === null) dropped = next;
        for (const line of under) skip(line);
      }
      return;
    }
    for (const child of children) visit(child);
  };
  for (const item of rawItems) {
    if (item !== null && item !== undefined) visit(item);
  }
  return { indexes: next === lineCount ? indexes : null, dropped };
}

/**
 * Format a parsed link the way links-notation's `Link.format(false)` does,
 * except that an empty group value keeps its `()` instead of vanishing.
 *
 * @param {Link} link - Parsed links-notation link.
 * @returns {string} The link as a parenthesized form.
 */
export function formatParsedLink(link) {
  const values = link.values || [];
  if (link.id === null && values.length === 0) return '()';
  if (values.length === 0) return `(${Link.escapeReference(link.id)})`;
  const compound = link._isFromPathCombination === true;
  const body = values
    .map(value => (!compound && (value.values || []).length === 0 && value.id !== null
      ? Link.escapeReference(value.id)
      : formatParsedLink(value)))
    .join(' ');
  return link.id === null ? `(${body})` : `(${Link.escapeReference(link.id)}: ${body})`;
}

/**
 * Whether a top-level link is a comment link such as `(# note)`: an anonymous
 * link written on one line whose first value is the reference `#`, followed by
 * at least one more value.
 *
 * @param {Link} link - Parsed top-level link.
 * @returns {boolean}
 */
export function isCommentLink(link) {
  const values = link.values || [];
  if (link.id !== null || link._isFromPathCombination === true || values.length < 2) return false;
  const head = values[0];
  return head.id === '#' && (head.values || []).length === 0;
}

/**
 * Parse RML source text into its top-level forms.
 *
 * Each form carries its text (a parenthesized LiNo link) and the 1-based line
 * and code-point column of the first character other than a space or a tab on
 * the line it starts on; `length` is 1, or 0 when the position could not be
 * traced.
 *
 * @param {string} text - LiNo source text.
 * @returns {Array.<{text: string, line: number, col: number, length: number}>}
 * @throws {LinoParseError} When the document is not valid LiNo.
 */
export function parseLinoDocument(text) {
  const { source, prepared, lines } = prepareLinoSource(text);
  if (/^\p{White_Space}*$/u.test(prepared)) return [];
  const parser = new RecordingParser({ comments: false });
  let links;
  try {
    links = parser.parse(prepared);
  } catch (error) {
    if (error && typeof error.offset === 'number') throw unexpectedAt(source, error.offset);
    throw new LinoParseError(error && error.message ? error.message : String(error));
  }
  const { indexes, dropped } = traceLinkLines(parser.rawItems || [], lines.length);
  if (dropped !== null) {
    const at = indexes !== null ? lines[dropped] : null;
    throw new LinoParseError(DROPPED_LINE, at ? { line: at.line, col: at.col, length: 1 } : {});
  }
  const traced = indexes !== null && indexes.length === links.length;
  const forms = [];
  links.forEach((link, position) => {
    if (isCommentLink(link)) return;
    const start = traced ? lines[indexes[position]] : null;
    forms.push({
      text: formatParsedLink(link),
      line: start ? start.line : 1,
      col: start ? start.col : 1,
      length: start ? 1 : 0,
    });
  });
  return forms;
}
