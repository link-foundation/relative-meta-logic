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
//    - record every reference that starts with a quote and what it reads as:
//      a quoted reference, the empty reference, or, where the quote opens no
//      quoted reference, the ordinary reference it starts;
//    - record the logical lines, the lines that start outside parentheses and
//      quoted references and hold more than spaces and tabs;
//    - reject nesting deeper than `MAX_LINO_NESTING_DEPTH` (parentheses plus
//      indentation levels) and sources longer than `MAX_LINO_SOURCE_UNITS`
//      UTF-16 code units, before the parser can exhaust the stack.
//    Every character of the prepared text stands where the character it
//    replaces stood, so parser positions are source positions.
// 3. Parse with links-notation, one piece at a time as described below, and
//    format every top-level link, with one repair: a line under an indented id
//    keeps its name, so `a:` over `b: c` reads as `(a: (b: c))`, an indented
//    id among those lines takes in the lines under it, so `a:` over `b:` over
//    `c` reads the same, and any other line indented under such a line is
//    refused. links-notation 0.20 drops the names and the lines.
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
// links-notation 0.20 backtracks without memoizing, so the time it takes grows
// exponentially with how deeply parentheses nest, and it looks for the end of
// a quoted reference one character at a time, comparing as many characters as
// the opening quotes are wide, and again each time it backtracks. So the
// parser reads neither directly:
// - step 2 reads every reference that starts with a quote in time that grows
//   with the length of the text times its logarithm, and each reaches the
//   parser as a token, a plain reference the front end turns back into what
//   step 2 read, so every step reads the same references, even where
//   links-notation alone would end one inside a comment step 2 blanked;
// - a group whose parentheses nest `LINO_PIECE_DEPTH` deep is parsed on its
//   own, and the text around it holds, in its place, a group of one name
//   the front end turns back into what the group read as.
// Tokens and names start with two private-use characters that never stand
// side by side in the source, so no reference of the source reads as one.
// A group reads the same wherever it stands, since it starts afresh at
// indentation level zero, and a group that fails fails the whole document. So
// the pieces put together read as the whole document does, and a document
// fails where the earliest failure of a piece is.

import { Link, Parser } from 'links-notation';

/** Deepest nesting of parentheses plus indentation levels a document may use. */
export const MAX_LINO_NESTING_DEPTH = 64;

/** Longest source, in UTF-16 code units, the links-notation parser accepts. */
export const MAX_LINO_SOURCE_UNITS = 10 * 1024 * 1024;

// A group whose parentheses nest this deep, itself included, is parsed on its
// own; a group in it that is parsed on its own counts as one level.
const LINO_PIECE_DEPTH = 2;

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

// Characters a reference can be followed by with nothing between: the
// characters the links-notation grammar leaves out of an unquoted reference.
const REFERENCE_BOUNDARY = new Set(['\n', ' ', '\t', '(', ')', ':']);

// The first index of the ascending `list` whose entry is at least `value`, or
// the length of the list when there is none.
function firstAtLeast(list, value) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (list[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The runs of `quote` in `text`, in order, each with where it starts and how
// many quotes long it is, and `levels`, where level b lists the indexes of the
// runs at least 2^b quotes long.
function quoteRuns(text, quote) {
  const starts = [];
  const lengths = [];
  let start = text.indexOf(quote);
  while (start !== -1) {
    let end = start + 1;
    while (text[end] === quote) end += 1;
    starts.push(start);
    lengths.push(end - start);
    start = text.indexOf(quote, end);
  }
  const levels = [lengths.map((length, index) => index)];
  for (let bits = 1; ; bits += 1) {
    const level = levels[bits - 1].filter(index => lengths[index] >= 2 ** bits);
    if (level.length === 0) break;
    levels.push(level);
  }
  return { starts, lengths, levels };
}

// Where the parentheses of `text` stand, `depths`, the depth before each, with
// `(` one level deeper and `)` one level shallower, and `drops`, for each the
// first parenthesis at or after it that leaves the depth below the depth before
// it, or the number of parentheses when none does. Both lists end with an entry
// for the end of the text.
function parenthesesOf(text) {
  const at = [];
  const depths = [0];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === ')') {
      at.push(index);
      depths.push(depths[depths.length - 1] + (character === '(' ? 1 : -1));
    }
  }
  const drops = depths.map(() => at.length);
  const pending = [];
  at.forEach((position, index) => {
    pending.push(index);
    if (text[position] !== ')') return;
    while (pending.length > 0 && depths[pending[pending.length - 1]] >= depths[index]) {
      drops[pending.pop()] = index;
    }
  });
  return { at, depths, drops };
}

// Whether the parentheses of the text from offset `start` to offset `end`
// balance: every `)` closes a `(` between the two, and every `(` is closed.
function balancedBetween({ at, depths, drops }, start, end) {
  const first = firstAtLeast(at, start);
  const last = firstAtLeast(at, end);
  return depths[first] === depths[last] && drops[first] >= last;
}

// A function that reads the reference starting with a quote at an offset of
// `text` where the grammar starts a reference, as the offset after it and what
// it reads as, with the links-notation 0.20 N-quote rules: a run of N quotes
// opens a quoted reference that the next run of exactly N closes and in which
// 2N quotes read as N. When N is even, a body that holds nothing visible, or
// whose parentheses do not balance, leaves the N quotes alone, the empty
// reference. When N is odd and no run closes it, the quotes start an ordinary
// reference, which runs to the next character in `REFERENCE_BOUNDARY`.
//
// A reference only opens at the start of a run, since the character before it
// never is the same quote. Every other run of the quote reads as escapes, one
// for each 2N quotes, and closes the reference with its last N quotes when at
// least N are left over, which a run shorter than N never does. So instead of
// looking at every character, the search looks at the runs, and skips all but
// the runs at least 2^floor(log2 N) quotes long. The references whose searches
// pass over the same run have different N, so each run of length L is looked
// at fewer than 2L times, and reading all the references of a text takes time
// that grows with its length times the logarithm of its length.
function quoteReader(text) {
  const runs = new Map();
  let parentheses = null;
  return start => {
    const quote = text[start];
    if (!runs.has(quote)) runs.set(quote, quoteRuns(text, quote));
    const { starts, lengths, levels } = runs.get(quote);
    const run = firstAtLeast(starts, start);
    const width = lengths[run];
    const level = levels[31 - Math.clz32(width)];
    let close = firstAtLeast(level, run + 1);
    while (close < level.length && Math.floor(lengths[level[close]] / width) % 2 === 0) close += 1;
    if (close === level.length) {
      if (width % 2 === 0) return { end: start + width, value: '' };
      let end = start + width;
      while (end < text.length && !REFERENCE_BOUNDARY.has(text[end])) end += 1;
      return { end, value: text.slice(start, end) };
    }
    const bodyStart = start + width;
    const bodyEnd = starts[level[close]] + lengths[level[close]] - width;
    if (width % 2 === 0) {
      // Every body scanned here starts after a quote and stops at the first
      // visible character, which no other such body can reach past.
      let visible = bodyStart;
      while (visible < bodyEnd && /\s/.test(text[visible])) visible += 1;
      if (parentheses === null) parentheses = parenthesesOf(text);
      if (visible === bodyEnd || !balancedBetween(parentheses, bodyStart, bodyEnd)) {
        return { end: start + width, value: '' };
      }
    }
    const delimiter = quote.repeat(width);
    return { end: bodyEnd + width, value: text.slice(bodyStart, bodyEnd).replaceAll(delimiter + delimiter, delimiter) };
  };
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
 * its first character other than a space or a tab. `quotes` lists the
 * references that start with a quote, in source order: the quoted references,
 * the empty references, and the ordinary references that an unclosed quote
 * starts. Each has the offsets of its first character and of the character
 * after it, and the reference it reads as.
 *
 * @param {string} text - LiNo source text.
 * @returns {{source: string, prepared: string, lines: Array.<{offset: number, line: number, col: number}>, quotes: Array.<{start: number, end: number, value: string}>}}
 * @throws {LinoParseError} When the source breaks the size or nesting limit.
 */
export function prepareLinoSource(text) {
  const source = normalizeLinoSource(text);
  if (source.length > MAX_LINO_SOURCE_UNITS) {
    throw new LinoParseError(`source longer than ${MAX_LINO_SOURCE_UNITS} UTF-16 code units`);
  }
  const parts = [];
  const lines = [];
  const quotes = [];
  const readQuote = quoteReader(source);
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
      const { end, value } = readQuote(index);
      quotes.push({ start: index, end, value });
      for (let inner = index; inner < end; inner += 1) {
        if (source[inner] === '\n') line += 1;
      }
      index = end;
      continue;
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
  return { source, prepared: parts.join(''), lines, quotes };
}

function isIndentedIdItem(item) {
  return item.id !== undefined && item.id !== null && (!item.values || item.values.length === 0);
}

// Whether an item is an indented id with lines under it, `name:` over
// indented lines.
function isIndentedIdBlock(item) {
  return Boolean(item && item.children && item.children.length > 0 && isIndentedIdItem(item));
}

// A parser that hands back the items links-notation parsed instead of the
// links it builds from them. The source limit is checked before parsing, and
// a piece with placeholders can be a little longer than its source.
class ItemParser extends Parser {
  constructor() {
    super({ comments: false, maxInputSize: Infinity });
  }

  transformResult(rawResult) {
    return Array.isArray(rawResult) ? rawResult : [rawResult];
  }
}

// links-notation's link builder, with one repair.
class LinkBuilder extends Parser {
  // links-notation 0.20 reads each line under an indented id through its
  // single value, which drops the name of a line such as `b: c`, and it drops
  // the lines under an indented id among those lines. Keep such a line whole,
  // `(a: (b: c))`, the way the line `(b: c)` reads, and read such an indented
  // id the way it reads on its own, so `b:` over `c` also gives `(b: c)`: the
  // GRAMMAR.md of links-notation reads `outer:` over `inner:` over `value1`
  // and `value2`, then `value3` under `outer:`, as
  // `(outer: (inner: value1 value2) value3)`.
  collectLinks(item, parentPath, result) {
    if (isIndentedIdBlock(item)) {
      const current = this.indentedIdLink(item);
      result.push(parentPath.length === 0 ? current : this.combinePathElements(parentPath, current));
      return;
    }
    super.collectLinks(item, parentPath, result);
  }

  // The link of an indented id and the lines under it, one value per line.
  indentedIdLink(item) {
    const values = item.children.map(child => {
      if (isIndentedIdBlock(child)) return this.indentedIdLink(child);
      return child.values && child.values.length === 1 && (child.id === undefined || child.id === null)
        ? this.transformLink(child.values[0])
        : this.transformLink(child);
    });
    return this.transformLink({ id: item.id, values });
  }
}

// Two code points of the private use area U+E000 to U+F8FF that never stand
// side by side in `text`, so a name that starts with them is no reference of
// the text. The first is one the text holds fewer than 6400 times, which there
// is since the text is shorter than 6400 × 6400 code units, and the second is
// one of the 6400 that never follows the first.
function unusedPair(text) {
  const counts = new Map();
  for (const [character] of text.matchAll(/[\ue000-\uf8ff]/g)) counts.set(character, (counts.get(character) || 0) + 1);
  let first = 0xe000;
  while ((counts.get(String.fromCharCode(first)) || 0) >= 6400) first += 1;
  const followers = new Set();
  const character = String.fromCharCode(first);
  for (let index = text.indexOf(character); index !== -1; index = text.indexOf(character, index + 1)) {
    followers.add(text[index + 1]);
  }
  let second = 0xe000;
  while (followers.has(String.fromCharCode(second))) second += 1;
  return String.fromCharCode(first, second);
}

// Append `slice` to `out`, a text made of slices of another text and of
// inserted text. `out.segments` maps an offset in `out.text` back: each
// `[from, to, verbatim]` covers `out.text` from `from` on, and maps a verbatim
// slice to `to` onwards, an inserted one to `to` itself.
function append(out, slice, to, verbatim) {
  if (slice.length === 0) return;
  out.segments.push([out.text.length, to, verbatim]);
  out.text += slice;
}

// Append the last slice of `out`, which also maps the offset after it.
function appendLast(out, slice, to) {
  out.segments.push([out.text.length, to, true]);
  out.text += slice;
}

// The offset in the other text of `offset` in a text built by `append`.
function unmapOffset(segments, offset) {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (segments[middle][0] <= offset) low = middle;
    else high = middle - 1;
  }
  const [from, to, verbatim] = segments[low];
  return verbatim ? to + (offset - from) : to;
}

// The prepared text with every reference that starts with a quote replaced by
// a token, a plain reference `tokens` maps to the reference it stands for.
function tokenize(prepared, quotes, marker) {
  const out = { text: '', segments: [] };
  const tokens = new Map();
  let at = 0;
  quotes.forEach(({ start, end, value }, index) => {
    append(out, prepared.slice(at, start), at, true);
    const token = `${marker}q${index}`;
    tokens.set(token, value);
    append(out, token, start, false);
    // Keep a reference right after the quoted one apart from the token.
    if (end < prepared.length && !REFERENCE_BOUNDARY.has(prepared[end])) append(out, ' ', end, false);
    at = end;
  });
  appendLast(out, prepared.slice(at), at);
  return { ...out, tokens };
}

// The parenthesized groups of `text` in the order they open, each with the
// offsets of its `(` and `)` and the index of the group around it, -1 for
// none, and how many `)` are missing. A group left open closes where its `)`
// would stand if the missing ones followed the text, innermost first.
function findGroups(text) {
  const groups = [];
  const open = [];
  const parentheses = /[()]/g;
  for (let match = parentheses.exec(text); match !== null; match = parentheses.exec(text)) {
    if (match[0] === '(') {
      groups.push({ open: match.index, close: -1, parent: open.length > 0 ? open[open.length - 1] : -1 });
      open.push(groups.length - 1);
    } else if (open.length > 0) {
      groups[open.pop()].close = match.index;
    }
  }
  const missing = open.length;
  for (let extra = 0; open.length > 0; extra += 1) groups[open.pop()].close = text.length + extra;
  return { groups, missing };
}

// The items links-notation reads from the prepared text, read one piece at a
// time as the header of this file describes, or the failure it reports.
function readItems(source, prepared, quotes) {
  const marker = unusedPair(source);
  const tokenized = tokenize(prepared, quotes, marker);
  const { groups, missing } = findGroups(tokenized.text);
  const text = tokenized.text + ')'.repeat(missing);
  // A group's height counts the levels of parentheses it nests, itself
  // included, where a group parsed on its own counts as one level.
  const height = groups.map(() => 1);
  const alone = groups.map(() => false);
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    alone[index] = height[index] >= LINO_PIECE_DEPTH;
    const { parent } = groups[index];
    if (parent >= 0) height[parent] = Math.max(height[parent], (alone[index] ? 1 : height[index]) + 1);
  }
  // The groups parsed on their own that each piece holds in its text: the
  // pieces are the whole text, under -1, and every group parsed on its own.
  const inner = new Map([[-1, []]]);
  const owner = groups.map(() => -1);
  groups.forEach(({ parent }, index) => {
    owner[index] = parent < 0 || alone[parent] ? parent : owner[parent];
    if (alone[index]) {
      inner.set(index, []);
      inner.get(owner[index]).push(index);
    }
  });
  const nameOf = index => `${marker}g${index}`;
  const parser = new ItemParser();
  // The earliest failure, as an offset in `text`.
  let failure = Infinity;
  const read = (start, end, index) => {
    const piece = { text: '', segments: [] };
    let at = start;
    for (const group of inner.get(index)) {
      const { open, close } = groups[group];
      append(piece, text.slice(at, open), at, true);
      append(piece, `(${nameOf(group)})`, open, false);
      at = close + 1;
    }
    appendLast(piece, text.slice(at, end), at);
    try {
      return parser.parse(piece.text);
    } catch (error) {
      if (error && typeof error.offset === 'number') {
        failure = Math.min(failure, unmapOffset(piece.segments, error.offset));
        return null;
      }
      throw new LinoParseError(error && error.message ? error.message : String(error));
    }
  };
  const top = read(0, text.length, -1);
  // A group can only fail after its `(`, so one that opens at or after the
  // earliest failure so far cannot move it.
  const bodies = new Map();
  for (const index of inner.keys()) {
    if (index < 0 || groups[index].open >= failure) continue;
    const items = read(groups[index].open, groups[index].close + 1, index);
    if (items !== null) bodies.set(nameOf(index), items[0].nested);
  }
  if (failure !== Infinity) throw unexpectedAt(source, unmapOffset(tokenized.segments, failure));
  if (missing > 0) throw unexpectedAt(source, source.length);
  const { tokens } = tokenized;
  if (tokens.size === 0 && bodies.size === 0) return top;
  // The body of the group a placeholder stands for, read as a group whose
  // one line holds one reference.
  const placeheld = nested => {
    const values = nested.length === 1 && nested[0] ? nested[0].values : null;
    return values && values.length === 1 && values[0] ? bodies.get(values[0].id) : undefined;
  };
  const splice = item => {
    if (item === null || typeof item !== 'object') return item;
    const copy = { ...item };
    if (tokens.has(item.id)) copy.id = tokens.get(item.id);
    if (item.values) copy.values = item.values.map(splice);
    if (item.children) copy.children = item.children.map(splice);
    if (item.nested) copy.nested = (placeheld(item.nested) || item.nested).map(splice);
    return copy;
  };
  return top.map(splice);
}

/** Why a line indented under a value of an indented id is refused. */
const DROPPED_LINE = 'unexpected indentation under a value of an indented id';

// The logical line each top-level link comes from, in the order
// `collectLinks` produces them: an item gives one link at its line; an
// indented-id item (`name:` over indented lines) takes in the lines under it,
// and so does an indented-id item among those lines, and any other item is
// followed by its children. `indexes` is `null` when the items do not account
// for every logical line. `dropped` is the index of the first line that has no
// place in a link, a line indented under a value of an indented id that is not
// itself an indented id, or `null`.
function traceLinkLines(rawItems, lineCount) {
  const indexes = [];
  let next = 0;
  let dropped = null;
  const skip = item => {
    next += 1;
    for (const child of item.children || []) skip(child);
  };
  const takeValues = item => {
    for (const value of item.children) {
      next += 1;
      if (isIndentedIdBlock(value)) {
        takeValues(value);
        continue;
      }
      const under = value.children || [];
      if (under.length > 0 && dropped === null) dropped = next;
      for (const line of under) skip(line);
    }
  };
  const visit = item => {
    indexes.push(next);
    next += 1;
    if (isIndentedIdBlock(item)) {
      takeValues(item);
      return;
    }
    for (const child of item.children || []) visit(child);
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
  const { source, prepared, lines, quotes } = prepareLinoSource(text);
  if (/^\p{White_Space}*$/u.test(prepared)) return [];
  const items = readItems(source, prepared, quotes);
  const links = new LinkBuilder().transformResult(items);
  const { indexes, dropped } = traceLinkLines(items, lines.length);
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
