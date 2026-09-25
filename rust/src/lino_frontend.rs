//! Shared LiNo front end: the one way RML reads a LiNo document.
//!
//! JavaScript and Rust read RML source through the same steps, so a document
//! yields the same forms, spans, and parse diagnostics in both runtimes. The
//! JavaScript mirror is `js/src/rml-lino-frontend.mjs`, and both test suites
//! check the cases in `test-corpus/lino-frontend/cases.json`.
//!
//! 1. Normalize: drop a leading U+FEFF and read CRLF and a lone CR as LF. Every
//!    position reported afterwards refers to this normalized source, counted
//!    in 1-based lines and Unicode code points.
//! 2. Prepare, in one pass that knows where quoted references are:
//!    - blank comments: a line whose first character other than a space or a
//!      tab is `#`, and the rest of a line from a `#` that follows `)` plus
//!      spaces or tabs, turn into spaces; a `#` inside a quoted reference is an
//!      ordinary character;
//!    - flatten layout: a line break inside parentheses reads as a space, which
//!      keeps the flat-list meaning of RML's parenthesized forms;
//!    - record every reference that starts with a quote and what it reads as:
//!      a quoted reference, the empty reference, or, where the quote opens no
//!      quoted reference, the ordinary reference it starts;
//!    - record the logical lines, the lines that start outside parentheses and
//!      quoted references and hold more than spaces and tabs;
//!    - reject nesting deeper than [`MAX_LINO_NESTING_DEPTH`] (parentheses plus
//!      indentation levels) and sources longer than [`MAX_LINO_SOURCE_UNITS`]
//!      UTF-16 code units, before the parser can exhaust the stack.
//!
//!    Every byte of the prepared text stands where the byte it replaces stood,
//!    so parser positions are source positions.
//! 3. Parse with links-notation, one piece at a time as described below, and
//!    format every top-level link the way the JavaScript links-notation parser
//!    builds it, with one repair: a line under an indented id keeps its name,
//!    so `a:` over `b: c` reads as `(a: (b: c))`, an indented id among those
//!    lines takes in the lines under it, so `a:` over `b:` over `c` reads the
//!    same, and any other line indented under such a line is refused.
//!    links-notation 0.20 drops the names and the lines. The parser does not
//!    see a last line that holds only spaces and tabs: the Rust links-notation
//!    0.20 parser reads its spaces as the indentation of a line that never
//!    comes and fails, where the JavaScript parser reads them as trailing
//!    space.
//! 4. Drop comment links such as `(# note)`, and give every other form the
//!    position of the first character other than a space or a tab on the line
//!    it starts on.
//!
//! Any failure is a [`LinoParseError`] (diagnostic code E006) that names the
//! offending character and its position.
//!
//! A quoted reference opens only where the grammar starts a reference: at the
//! start of a line or after a space, a tab, `(`, `)`, `:`, or another quoted
//! reference. A quote inside a word, as in `it's`, is part of that word.
//!
//! links-notation 0.20 backtracks without memoizing, so where a group is left
//! unclosed, fails, or has a value after it, the time it takes grows
//! exponentially with how deeply parentheses nest. It also looks for the end
//! of a quoted reference one character at a time, comparing as many characters
//! as the opening quotes are wide, and again each time it backtracks. So the
//! parser reads neither directly:
//! - step 2 reads every reference that starts with a quote in time that grows
//!   with the length of the text times its logarithm, and each reaches the
//!   parser as a token, a plain reference the front end turns back into what
//!   step 2 read, so every step reads the same references, even where
//!   links-notation alone would end one inside a comment step 2 blanked;
//! - a group whose parentheses nest `LINO_PIECE_DEPTH` deep is parsed on its
//!   own, and the text around it holds, in its place, a group of one name
//!   the front end turns back into what the group read as.
//!
//! Tokens and names start with two private-use characters that never stand
//! side by side in the source, so no reference of the source reads as one.
//! A group reads the same wherever it stands, since it starts afresh at
//! indentation level zero, and a group that fails fails the whole document. So
//! the pieces put together read as the whole document does, and a document
//! fails where the earliest failure of a piece is.

use crate::{Diagnostic, Span};
use links_notation::parser::{parse_document_with_diagnostics, Link};
use std::collections::HashMap;
use std::fmt;

/// Deepest nesting of parentheses plus indentation levels a document may use.
pub const MAX_LINO_NESTING_DEPTH: usize = 64;

/// Longest source, in UTF-16 code units, the links-notation parser accepts.
pub const MAX_LINO_SOURCE_UNITS: usize = 10 * 1024 * 1024;

// A group whose parentheses nest this deep, itself included, is parsed on its
// own; a group in it that is parsed on its own counts as one level.
const LINO_PIECE_DEPTH: usize = 2;

/// A LiNo document that could not be read, located in the normalized source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinoParseError {
    /// What went wrong, without the `LiNo parse failure` prefix.
    pub detail: String,
    /// 1-based line of the offending character.
    pub line: usize,
    /// 1-based column of the offending character, in Unicode code points.
    pub col: usize,
    /// 1 when the error points at a character, 0 when it has no position.
    pub length: usize,
}

impl LinoParseError {
    /// The diagnostic code every LiNo parse failure is reported under.
    pub const CODE: &'static str = "E006";

    fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
            line: 1,
            col: 1,
            length: 0,
        }
    }

    fn at(detail: impl Into<String>, (line, col): (usize, usize), length: usize) -> Self {
        Self {
            detail: detail.into(),
            line,
            col,
            length,
        }
    }

    /// The full message, `LiNo parse failure: <detail>`.
    pub fn message(&self) -> String {
        self.to_string()
    }

    /// The span of the error in `file`.
    pub fn span(&self, file: Option<&str>) -> Span {
        Span::new(file.map(str::to_string), self.line, self.col, self.length)
    }

    /// The error as an E006 diagnostic in `file`.
    pub fn to_diagnostic(&self, file: Option<&str>) -> Diagnostic {
        Diagnostic::new(Self::CODE, self.message(), self.span(file))
    }
}

impl fmt::Display for LinoParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "LiNo parse failure: {}", self.detail)
    }
}

impl std::error::Error for LinoParseError {}

/// Drop a leading byte order mark and read CRLF and a lone CR as LF.
///
/// The result is the source every reported position refers to.
pub fn normalize_lino_source(text: &str) -> String {
    let without_bom = text.strip_prefix('\u{feff}').unwrap_or(text);
    without_bom.replace("\r\n", "\n").replace('\r', "\n")
}

// Characters a reference can be followed by with nothing between: the
// characters the links-notation grammar leaves out of an unquoted reference.
fn is_reference_boundary(byte: u8) -> bool {
    matches!(byte, b'\n' | b' ' | b'\t' | b'(' | b')' | b':')
}

// The characters the JavaScript pattern `\s` matches, which the JavaScript
// links-notation grammar reads as blank in a quoted reference. The Rust grammar
// asks `char::is_whitespace`, which also takes U+0085 and leaves out U+FEFF.
fn is_js_whitespace(character: char) -> bool {
    matches!(character, '\u{2000}'..='\u{200a}')
        || "\t\n\u{b}\u{c}\r \u{a0}\u{1680}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}"
            .contains(character)
}

// The runs of one quote in a text, in order, each with the byte offset it
// starts at and how many quotes long it is, and `levels`, where level b lists
// the indexes of the runs at least 2^b quotes long.
struct QuoteRuns {
    starts: Vec<usize>,
    lengths: Vec<usize>,
    levels: Vec<Vec<usize>>,
}

impl QuoteRuns {
    fn of(bytes: &[u8], quote: u8) -> Self {
        let mut starts = Vec::new();
        let mut lengths = Vec::new();
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] != quote {
                index += 1;
                continue;
            }
            let start = index;
            while index < bytes.len() && bytes[index] == quote {
                index += 1;
            }
            starts.push(start);
            lengths.push(index - start);
        }
        let mut levels: Vec<Vec<usize>> = vec![(0..lengths.len()).collect()];
        for bits in 1.. {
            let level: Vec<usize> = levels[bits - 1]
                .iter()
                .copied()
                .filter(|&run| lengths[run] >= 1 << bits)
                .collect();
            if level.is_empty() {
                break;
            }
            levels.push(level);
        }
        Self {
            starts,
            lengths,
            levels,
        }
    }
}

// Where the parentheses of a text stand, `depths`, the depth before each, with
// `(` one level deeper and `)` one level shallower, and `drops`, for each the
// first parenthesis at or after it that leaves the depth below the depth before
// it, or the number of parentheses when none does. Both lists end with an entry
// for the end of the text.
struct Parentheses {
    at: Vec<usize>,
    depths: Vec<isize>,
    drops: Vec<usize>,
}

impl Parentheses {
    fn of(bytes: &[u8]) -> Self {
        let mut at = Vec::new();
        let mut depths: Vec<isize> = vec![0];
        for (index, &byte) in bytes.iter().enumerate() {
            let step = match byte {
                b'(' => 1,
                b')' => -1,
                _ => continue,
            };
            at.push(index);
            depths.push(depths[depths.len() - 1] + step);
        }
        let mut drops = vec![at.len(); depths.len()];
        let mut pending: Vec<usize> = Vec::new();
        for (index, &position) in at.iter().enumerate() {
            pending.push(index);
            if bytes[position] != b')' {
                continue;
            }
            while let Some(&last) = pending.last() {
                if depths[last] < depths[index] {
                    break;
                }
                drops[last] = index;
                pending.pop();
            }
        }
        Self { at, depths, drops }
    }

    // Whether the parentheses of the text from byte offset `start` to byte
    // offset `end` balance: every `)` closes a `(` between the two, and every
    // `(` is closed.
    fn balanced_between(&self, start: usize, end: usize) -> bool {
        let first = self.at.partition_point(|&position| position < start);
        let last = self.at.partition_point(|&position| position < end);
        self.depths[first] == self.depths[last] && self.drops[first] >= last
    }
}

// Reads the reference starting with a quote at a byte offset of `text` where
// the grammar starts a reference, as the offset after it and what it reads as,
// with the links-notation 0.20 N-quote rules: a run of N quotes opens a quoted
// reference that the next run of exactly N closes and in which 2N quotes read
// as N. When N is even, a body that holds nothing visible, or whose
// parentheses do not balance, leaves the N quotes alone, the empty reference.
// When N is odd and no run closes it, the quotes start an ordinary reference,
// which runs to the next character `is_reference_boundary` accepts. A body
// holds something visible when it holds a character that `is_js_whitespace`
// refuses, the way the JavaScript grammar reads it.
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
struct QuoteReader<'a> {
    text: &'a str,
    // The runs of `"`, `'`, and `` ` ``, found when first needed.
    runs: [Option<QuoteRuns>; 3],
    parentheses: Option<Parentheses>,
}

impl<'a> QuoteReader<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            runs: [None, None, None],
            parentheses: None,
        }
    }

    fn read(&mut self, start: usize) -> QuoteReference {
        let text = self.text;
        let bytes = text.as_bytes();
        let quote = bytes[start];
        let slot = match quote {
            b'"' => 0,
            b'\'' => 1,
            _ => 2,
        };
        let runs = self.runs[slot].get_or_insert_with(|| QuoteRuns::of(bytes, quote));
        let run = runs.starts.partition_point(|&at| at < start);
        let width = runs.lengths[run];
        let level = &runs.levels[width.ilog2() as usize];
        let mut close = level.partition_point(|&index| index <= run);
        while close < level.len() && (runs.lengths[level[close]] / width).is_multiple_of(2) {
            close += 1;
        }
        let empty = QuoteReference {
            start,
            end: start + width,
            value: String::new(),
        };
        if close == level.len() {
            if width.is_multiple_of(2) {
                return empty;
            }
            let end = bytes[start + width..]
                .iter()
                .position(|&byte| is_reference_boundary(byte))
                .map_or(bytes.len(), |offset| start + width + offset);
            return QuoteReference {
                start,
                end,
                value: text[start..end].to_string(),
            };
        }
        let body_start = start + width;
        let body_end = runs.starts[level[close]] + runs.lengths[level[close]] - width;
        if width.is_multiple_of(2) {
            // Every body scanned here starts after a quote and stops at the
            // first visible character, which no other such body can reach past.
            let visible = text[body_start..body_end]
                .chars()
                .any(|character| !is_js_whitespace(character));
            let parentheses = self
                .parentheses
                .get_or_insert_with(|| Parentheses::of(bytes));
            if !visible || !parentheses.balanced_between(body_start, body_end) {
                return empty;
            }
        }
        let delimiter = &text[start..body_start];
        QuoteReference {
            start,
            end: body_end + width,
            value: text[body_start..body_end].replace(&delimiter.repeat(2), delimiter),
        }
    }
}

// The 1-based line and code-point column of a byte offset in `source`.
fn position_at(source: &str, offset: usize) -> (usize, usize) {
    let before = &source[..offset];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    (line, source[line_start..offset].chars().count() + 1)
}

fn describe_character(character: char) -> String {
    match character {
        '"' => "\\\"".to_string(),
        '\\' => "\\\\".to_string(),
        '\t' => "\\t".to_string(),
        '\n' => "\\n".to_string(),
        '\r' => "\\r".to_string(),
        ' '..='~' => character.to_string(),
        _ => format!("\\u{{{:x}}}", character as u32),
    }
}

fn unexpected_at(source: &str, offset: usize) -> LinoParseError {
    if offset >= source.len() {
        return LinoParseError::at(
            "unexpected end of input",
            position_at(source, source.len()),
            1,
        );
    }
    let mut at = offset;
    while !source.is_char_boundary(at) {
        at -= 1;
    }
    let character = source[at..]
        .chars()
        .next()
        .expect("an offset inside the source starts a character");
    LinoParseError::at(
        format!("unexpected \"{}\"", describe_character(character)),
        position_at(source, at),
        1,
    )
}

fn nesting_error(source: &str, offset: usize) -> LinoParseError {
    LinoParseError::at(
        format!("nesting deeper than {} levels", MAX_LINO_NESTING_DEPTH),
        position_at(source, offset),
        1,
    )
}

/// A logical line: one that starts outside parentheses and quoted references
/// and holds more than spaces and tabs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogicalLine {
    /// Byte offset of the first character other than a space or a tab.
    pub offset: usize,
    /// 1-based line number.
    pub line: usize,
    /// 1-based column of that first character.
    pub col: usize,
}

/// A reference that starts with a quote: a quoted reference, the empty
/// reference, or the ordinary reference an unclosed quote starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuoteReference {
    /// Byte offset of its first character.
    pub start: usize,
    /// Byte offset of the character after it.
    pub end: usize,
    /// The reference it reads as.
    pub value: String,
}

/// A LiNo source ready for the links-notation parser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedLino {
    /// The normalized source every position refers to.
    pub source: String,
    /// The text the parser reads: the source with comments blanked and line
    /// breaks inside parentheses turned into spaces, byte for byte in place.
    pub prepared: String,
    /// The logical lines, in source order.
    pub lines: Vec<LogicalLine>,
    /// The references that start with a quote, in source order.
    pub quotes: Vec<QuoteReference>,
}

/// Prepare a LiNo source for the links-notation parser.
///
/// The prepared text has the length of the normalized source, and every byte
/// in it sits at the position of the byte it stands for. `lines` lists the
/// logical lines, each with the offset, line, and column of its first
/// character other than a space or a tab. `quotes` lists the references that
/// start with a quote, in source order: the quoted references, the empty
/// references, and the ordinary references that an unclosed quote starts.
/// Each has the offsets of its first character and of the character after it,
/// and the reference it reads as.
///
/// # Errors
///
/// A [`LinoParseError`] when the source breaks the size or nesting limit.
pub fn prepare_lino_source(text: &str) -> Result<PreparedLino, LinoParseError> {
    let source = normalize_lino_source(text);
    // UTF-8 never takes fewer bytes than UTF-16 takes code units, so only a
    // source longer than the limit in bytes needs counting.
    if source.len() > MAX_LINO_SOURCE_UNITS && source.encode_utf16().count() > MAX_LINO_SOURCE_UNITS
    {
        return Err(LinoParseError::new(format!(
            "source longer than {} UTF-16 code units",
            MAX_LINO_SOURCE_UNITS
        )));
    }
    let bytes = source.as_bytes();
    let length = bytes.len();
    let mut prepared = bytes.to_vec();
    let mut lines = Vec::new();
    let mut quotes = Vec::new();
    let mut quote_reader = QuoteReader::new(&source);
    // Indentation levels the way the links-notation grammar stacks them: the
    // first logical line sets the base, a deeper line opens a level, and a
    // shallower line closes every level deeper than itself.
    let mut levels: Vec<usize> = vec![0];
    let mut base: Option<usize> = None;
    let mut line_depth = 0usize;
    let mut depth = 0usize;
    let mut line = 1usize;
    let mut line_start = 0usize;
    // Whether the previous character continues an unquoted reference, where a
    // quote is an ordinary character instead of an opening delimiter.
    let mut in_reference = false;
    // Replace the rest of the line from `start` with spaces; return its end.
    let blank_rest_of_line = |prepared: &mut [u8], start: usize| -> usize {
        let end = bytes[start..]
            .iter()
            .position(|&byte| byte == b'\n')
            .map_or(length, |newline| start + newline);
        prepared[start..end].fill(b' ');
        end
    };
    let mut index = 0usize;
    while index < length {
        if index == line_start {
            let mut first = index;
            while first < length && matches!(bytes[first], b' ' | b'\t') {
                first += 1;
            }
            if first < length && bytes[first] == b'#' {
                index = blank_rest_of_line(&mut prepared, first);
                continue;
            }
            if depth == 0 && first < length && bytes[first] != b'\n' {
                let spaces = bytes[index..]
                    .iter()
                    .take_while(|&&byte| byte == b' ')
                    .count();
                let base = *base.get_or_insert(spaces);
                let width = spaces.saturating_sub(base);
                if width > *levels.last().expect("the base level stays") {
                    levels.push(width);
                } else {
                    while width < *levels.last().expect("the base level stays") {
                        levels.pop();
                    }
                }
                line_depth = levels.len() - 1;
                if line_depth > MAX_LINO_NESTING_DEPTH {
                    return Err(nesting_error(&source, first));
                }
                lines.push(LogicalLine {
                    offset: first,
                    line,
                    col: first - index + 1,
                });
            }
        }
        let byte = bytes[index];
        if !in_reference && matches!(byte, b'"' | b'\'' | b'`') {
            let quote = quote_reader.read(index);
            line += bytes[index..quote.end]
                .iter()
                .filter(|&&byte| byte == b'\n')
                .count();
            index = quote.end;
            quotes.push(quote);
            continue;
        }
        match byte {
            b'\n' => {
                line += 1;
                line_start = index + 1;
                in_reference = false;
                if depth > 0 {
                    prepared[index] = b' ';
                }
            }
            b'(' => {
                depth += 1;
                in_reference = false;
                if line_depth + depth > MAX_LINO_NESTING_DEPTH {
                    return Err(nesting_error(&source, index));
                }
            }
            b')' => {
                depth = depth.saturating_sub(1);
                in_reference = false;
                let mut hash = index + 1;
                while hash < length && matches!(bytes[hash], b' ' | b'\t') {
                    hash += 1;
                }
                if hash > index + 1 && hash < length && bytes[hash] == b'#' {
                    index = blank_rest_of_line(&mut prepared, hash);
                    continue;
                }
            }
            _ => in_reference = !matches!(byte, b' ' | b'\t' | b':'),
        }
        index += 1;
    }
    // Only ASCII bytes and whole characters were replaced, with ASCII spaces.
    let prepared = String::from_utf8(prepared).expect("the prepared text stays UTF-8");
    Ok(PreparedLino {
        source,
        prepared,
        lines,
        quotes,
    })
}

// An item the way the JavaScript links-notation grammar hands it to the link
// builder. `values` is `None` where the grammar gives no values at all, as for
// a bare reference, and `children` holds the indented lines under an item.
#[derive(Debug, Clone, Default)]
struct RawItem {
    id: Option<String>,
    values: Option<Vec<RawItem>>,
    children: Vec<RawItem>,
    nested: Option<Vec<RawItem>>,
}

impl RawItem {
    fn reference(id: Option<String>) -> Self {
        Self {
            id,
            ..Self::default()
        }
    }
}

// A line of the Rust parse as the JavaScript grammar builds it. The Rust
// parser collapses a line holding a single reference into that reference,
// which its JavaScript counterpart keeps as a line with one value.
fn line_item(link: &Link) -> RawItem {
    let children = link.children.iter().map(line_item).collect();
    if let Some(body) = &link.nested {
        return RawItem {
            nested: Some(body.iter().map(line_item).collect()),
            children,
            ..RawItem::default()
        };
    }
    if link.is_indented_id {
        return RawItem {
            id: link.id.clone(),
            values: Some(Vec::new()),
            children,
            nested: None,
        };
    }
    if link.id.is_some() && link.values.is_empty() {
        return RawItem {
            id: None,
            values: Some(vec![RawItem::reference(link.id.clone())]),
            children,
            nested: None,
        };
    }
    RawItem {
        id: link.id.clone(),
        values: Some(link.values.iter().map(value_item).collect()),
        children,
        nested: None,
    }
}

// A value of the Rust parse as the JavaScript grammar builds it.
fn value_item(link: &Link) -> RawItem {
    match &link.nested {
        Some(body) => RawItem {
            nested: Some(body.iter().map(line_item).collect()),
            ..RawItem::default()
        },
        None => RawItem::reference(link.id.clone()),
    }
}

/// A top-level link as the JavaScript links-notation parser builds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLink {
    /// The reference naming the link, `None` for an anonymous link.
    pub id: Option<String>,
    /// The links the link holds.
    pub values: Vec<ParsedLink>,
    /// Whether the link joins an indented line to the lines it sits under.
    pub compound: bool,
}

impl ParsedLink {
    fn new(id: Option<String>, values: Vec<ParsedLink>) -> Self {
        Self {
            id,
            values,
            compound: false,
        }
    }
}

// The links below mirror `Parser.collectLinks`, `combinePathElements`,
// `transformNested`, and `transformLink` in links-notation 0.20's JavaScript
// parser, so both runtimes build the same links from the same items.

fn is_indented_id_item(item: &RawItem) -> bool {
    item.id.is_some() && item.values.as_ref().is_none_or(Vec::is_empty)
}

// Whether an item is an indented id with lines under it, `name:` over
// indented lines.
fn is_indented_id_block(item: &RawItem) -> bool {
    !item.children.is_empty() && is_indented_id_item(item)
}

// The link of an indented id and the lines under it, one value per line.
//
// links-notation 0.20 reads each line under an indented id through its single
// value, which drops the name of a line such as `b: c`, and it drops the lines
// under an indented id among those lines. Keep such a line whole,
// `(a: (b: c))`, the way the line `(b: c)` reads, and read such an indented id
// the way it reads on its own, so `b:` over `c` also gives `(b: c)`: the
// GRAMMAR.md of links-notation reads `outer:` over `inner:` over `value1` and
// `value2`, then `value3` under `outer:`, as
// `(outer: (inner: value1 value2) value3)`.
fn indented_id_link(item: &RawItem) -> ParsedLink {
    let values = item
        .children
        .iter()
        .map(|child| match &child.values {
            _ if is_indented_id_block(child) => indented_id_link(child),
            Some(values) if values.len() == 1 && child.id.is_none() => transform_link(&values[0]),
            _ => transform_link(child),
        })
        .collect();
    ParsedLink::new(item.id.clone(), values)
}

fn collect_links(item: &RawItem, parent_path: &[ParsedLink], result: &mut Vec<ParsedLink>) {
    if item.children.is_empty() {
        result.push(combine_path_elements(parent_path, transform_link(item)));
        return;
    }
    if is_indented_id_item(item) {
        result.push(combine_path_elements(parent_path, indented_id_link(item)));
        return;
    }
    let current = transform_link(item);
    result.push(combine_path_elements(parent_path, current.clone()));
    let mut path = parent_path.to_vec();
    path.push(current);
    for child in &item.children {
        collect_links(child, &path, result);
    }
}

fn combine_path_elements(path: &[ParsedLink], current: ParsedLink) -> ParsedLink {
    let parent = match path {
        [] => return current,
        [only] => only.clone(),
        [outer @ .., last] => combine_path_elements(outer, last.clone()),
    };
    ParsedLink {
        id: None,
        values: vec![parent, current],
        compound: true,
    }
}

fn transform_nested(nested: &[RawItem]) -> ParsedLink {
    let mut links = Vec::new();
    for item in nested {
        collect_links(item, &[], &mut links);
    }
    let wraps_single_group = nested.len() == 1 && nested[0].nested.is_some();
    if links.len() == 1 && !wraps_single_group {
        return links.pop().expect("one link");
    }
    ParsedLink::new(None, links)
}

fn transform_link(item: &RawItem) -> ParsedLink {
    if let Some(nested) = &item.nested {
        return transform_nested(nested);
    }
    match &item.values {
        Some(values) => {
            ParsedLink::new(item.id.clone(), values.iter().map(transform_link).collect())
        }
        None => ParsedLink::new(item.id.clone(), Vec::new()),
    }
}

// `Link.escapeReference` of links-notation 0.20, which both runtimes share.
fn escape_reference(reference: &str) -> String {
    if reference.is_empty() {
        return "\"\"".to_string();
    }
    let has_single_quote = reference.contains('\'');
    let has_double_quote = reference.contains('"');
    let needs_quoting = reference.starts_with('#')
        || reference.contains([':', '(', ')', ' ', '\t', '\n', '\r'])
        || has_double_quote
        || has_single_quote;
    if has_single_quote && has_double_quote {
        format!("'{}'", reference.replace('\'', "\\'"))
    } else if has_double_quote {
        format!("'{}'", reference)
    } else if has_single_quote {
        format!("\"{}\"", reference)
    } else if needs_quoting {
        format!("'{}'", reference)
    } else {
        reference.to_string()
    }
}

/// Format a parsed link the way links-notation's `Link.format(false)` does,
/// except that an empty group value keeps its `()` instead of vanishing.
pub fn format_parsed_link(link: &ParsedLink) -> String {
    if link.values.is_empty() {
        return match &link.id {
            None => "()".to_string(),
            Some(id) => format!("({})", escape_reference(id)),
        };
    }
    let body = link
        .values
        .iter()
        .map(|value| match &value.id {
            Some(id) if !link.compound && value.values.is_empty() => escape_reference(id),
            _ => format_parsed_link(value),
        })
        .collect::<Vec<_>>()
        .join(" ");
    match &link.id {
        None => format!("({})", body),
        Some(id) => format!("({}: {})", escape_reference(id), body),
    }
}

/// Whether a top-level link is a comment link such as `(# note)`: an anonymous
/// link written on one line whose first value is the reference `#`, followed by
/// at least one more value.
pub fn is_comment_link(link: &ParsedLink) -> bool {
    if link.id.is_some() || link.compound || link.values.len() < 2 {
        return false;
    }
    let head = &link.values[0];
    head.id.as_deref() == Some("#") && head.values.is_empty()
}

/// Why a line indented under a value of an indented id is refused.
const DROPPED_LINE: &str = "unexpected indentation under a value of an indented id";

/// Where the top-level links come from.
struct LinkLines {
    /// The logical line of each link, or `None` when the items do not account
    /// for every logical line.
    indexes: Option<Vec<usize>>,
    /// The first line that has no place in a link, a line indented under a
    /// value of an indented id that is not itself an indented id.
    dropped: Option<usize>,
}

// The logical line each top-level link comes from, in the order
// `collect_links` produces them: an item gives one link at its line; an
// indented-id item (`name:` over indented lines) takes in the lines under it,
// and so does an indented-id item among those lines, and any other item is
// followed by its children.
fn trace_link_lines(items: &[RawItem], line_count: usize) -> LinkLines {
    struct Trace {
        indexes: Vec<usize>,
        next: usize,
        dropped: Option<usize>,
    }
    fn skip(item: &RawItem, trace: &mut Trace) {
        trace.next += 1;
        for child in &item.children {
            skip(child, trace);
        }
    }
    fn take_values(item: &RawItem, trace: &mut Trace) {
        for value in &item.children {
            trace.next += 1;
            if is_indented_id_block(value) {
                take_values(value, trace);
                continue;
            }
            if !value.children.is_empty() && trace.dropped.is_none() {
                trace.dropped = Some(trace.next);
            }
            for line in &value.children {
                skip(line, trace);
            }
        }
    }
    fn visit(item: &RawItem, trace: &mut Trace) {
        trace.indexes.push(trace.next);
        trace.next += 1;
        if is_indented_id_block(item) {
            take_values(item, trace);
            return;
        }
        for child in &item.children {
            visit(child, trace);
        }
    }
    let mut trace = Trace {
        indexes: Vec::new(),
        next: 0,
        dropped: None,
    };
    for item in items {
        visit(item, &mut trace);
    }
    LinkLines {
        indexes: (trace.next == line_count).then_some(trace.indexes),
        dropped: trace.dropped,
    }
}

/// A top-level form of a LiNo document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinoForm {
    /// The form as a parenthesized LiNo link.
    pub text: String,
    /// 1-based line of the first character other than a space or a tab on the
    /// line the form starts on.
    pub line: usize,
    /// 1-based column of that character, in Unicode code points.
    pub col: usize,
    /// 1, or 0 when the position could not be traced.
    pub length: usize,
}

impl LinoForm {
    /// The span of the form in `file`.
    pub fn span(&self, file: Option<&str>) -> Span {
        Span::new(file.map(str::to_string), self.line, self.col, self.length)
    }
}

/// The prepared text without a last line that holds only spaces and tabs.
///
/// The Rust links-notation 0.20 parser reads spaces at the very end of a
/// document, after a line break, as the indentation of a child line and fails
/// when none comes, so `a` over a line of spaces does not parse. The
/// JavaScript parser reads such spaces as trailing space.
fn parser_input(prepared: &str) -> &str {
    match prepared.rfind('\n') {
        Some(newline)
            if prepared[newline + 1..]
                .bytes()
                .all(|byte| matches!(byte, b' ' | b'\t')) =>
        {
            &prepared[..=newline]
        }
        _ => prepared,
    }
}

// The first code point of the private use area, U+E000 to U+F8FF, and how many
// code points it holds.
const PRIVATE_USE_START: u32 = 0xe000;
const PRIVATE_USE_COUNT: usize = 6400;

// The index of a character in the private use area.
fn private_use_index(character: char) -> Option<usize> {
    let index = (character as u32).checked_sub(PRIVATE_USE_START)? as usize;
    (index < PRIVATE_USE_COUNT).then_some(index)
}

fn private_use_character(index: usize) -> char {
    char::from_u32(PRIVATE_USE_START + index as u32).expect("the private use area holds characters")
}

// Two characters of the private use area that never stand side by side in
// `text`, so a name that starts with them is no reference of the text. The
// first is one the text holds fewer than 6400 times, which there is since the
// text is shorter than 6400 × 6400 UTF-16 code units, and the second is one of
// the 6400 that never follows the first.
fn unused_pair(text: &str) -> String {
    let mut counts = vec![0usize; PRIVATE_USE_COUNT];
    for index in text.chars().filter_map(private_use_index) {
        counts[index] += 1;
    }
    let first = counts
        .iter()
        .position(|&count| count < PRIVATE_USE_COUNT)
        .expect("a text within the source limit leaves a character out");
    let first = private_use_character(first);
    let mut followers = vec![false; PRIVATE_USE_COUNT];
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character != first {
            continue;
        }
        if let Some(index) = characters.peek().copied().and_then(private_use_index) {
            followers[index] = true;
        }
    }
    let second = followers
        .iter()
        .position(|&follows| !follows)
        .expect("fewer than 6400 characters follow the first");
    [first, private_use_character(second)].iter().collect()
}

// A text made of slices of another text and of inserted text. `segments` maps
// a byte offset in `text` back: each `(from, to, verbatim)` covers `text` from
// `from` on, and maps a verbatim slice to `to` onwards, an inserted one to `to`
// itself.
#[derive(Default)]
struct MappedText {
    text: String,
    segments: Vec<(usize, usize, bool)>,
}

impl MappedText {
    fn append(&mut self, slice: &str, to: usize, verbatim: bool) {
        if slice.is_empty() {
            return;
        }
        self.segments.push((self.text.len(), to, verbatim));
        self.text.push_str(slice);
    }

    // Append the last slice, which also maps the offset after it.
    fn append_last(&mut self, slice: &str, to: usize) {
        self.segments.push((self.text.len(), to, true));
        self.text.push_str(slice);
    }

    // The offset in the other text of `offset` in this one.
    fn unmap(&self, offset: usize) -> usize {
        let segment = self
            .segments
            .partition_point(|&(from, _, _)| from <= offset)
            - 1;
        let (from, to, verbatim) = self.segments[segment];
        if verbatim {
            to + (offset - from)
        } else {
            to
        }
    }
}

// The prepared text with every reference that starts with a quote replaced by
// a token, a plain reference the returned map turns into the reference it
// stands for.
fn tokenize(
    prepared: &str,
    quotes: &[QuoteReference],
    marker: &str,
) -> (MappedText, HashMap<String, String>) {
    let mut out = MappedText::default();
    let mut tokens = HashMap::new();
    let mut at = 0;
    for (index, quote) in quotes.iter().enumerate() {
        out.append(&prepared[at..quote.start], at, true);
        let token = format!("{marker}q{index}");
        out.append(&token, quote.start, false);
        // Keep a reference right after the quoted one apart from the token.
        if prepared
            .as_bytes()
            .get(quote.end)
            .is_some_and(|&byte| !is_reference_boundary(byte))
        {
            out.append(" ", quote.end, false);
        }
        tokens.insert(token, quote.value.clone());
        at = quote.end;
    }
    out.append_last(&prepared[at..], at);
    (out, tokens)
}

// A parenthesized group: the byte offsets of its `(` and `)`, and the group
// around it.
struct Group {
    open: usize,
    close: usize,
    parent: Option<usize>,
}

// The groups of `text` in the order they open, and how many `)` are missing. A
// group left open closes where its `)` would stand if the missing ones
// followed the text, innermost first.
fn find_groups(text: &str) -> (Vec<Group>, usize) {
    let mut groups: Vec<Group> = Vec::new();
    let mut open: Vec<usize> = Vec::new();
    for (index, byte) in text.bytes().enumerate() {
        if byte == b'(' {
            groups.push(Group {
                open: index,
                close: 0,
                parent: open.last().copied(),
            });
            open.push(groups.len() - 1);
        } else if byte == b')' {
            if let Some(group) = open.pop() {
                groups[group].close = index;
            }
        }
    }
    let missing = open.len();
    for (extra, &group) in open.iter().rev().enumerate() {
        groups[group].close = text.len() + extra;
    }
    (groups, missing)
}

// Parse the piece of `text` from `start` to `end` with every group of `inner`
// replaced by a placeholder, a group that holds the reference `name(group)`.
// A failure is an offset in `text`.
fn read_piece(
    text: &str,
    groups: &[Group],
    inner: &[usize],
    (start, end): (usize, usize),
    name: impl Fn(usize) -> String,
) -> Result<Vec<Link>, usize> {
    let mut piece = MappedText::default();
    let mut at = start;
    for &group in inner {
        let Group { open, close, .. } = groups[group];
        piece.append(&text[at..open], at, true);
        piece.append(&format!("({})", name(group)), open, false);
        at = close + 1;
    }
    piece.append_last(&text[at..end], at);
    let input = parser_input(&piece.text);
    parse_document_with_diagnostics(input).map_err(|failure| {
        // A failure at the end of what the parser reads is one at the end of
        // the piece: all the parser does not see is trailing space.
        let offset = if failure.offset >= input.len() {
            piece.text.len()
        } else {
            failure.offset
        };
        piece.unmap(offset)
    })
}

// The body of the group a placeholder stands for, read as a group whose one
// line holds one reference. Every placeholder stands in one piece once, so its
// body is taken out.
fn placeheld(
    nested: &[RawItem],
    bodies: &mut HashMap<String, Vec<RawItem>>,
) -> Option<Vec<RawItem>> {
    let [line] = nested else {
        return None;
    };
    let [value] = line.values.as_deref()? else {
        return None;
    };
    bodies.remove(value.id.as_ref()?)
}

// The item with every token turned into the reference it stands for and every
// placeholder into the body of the group it stands for.
fn splice(
    item: RawItem,
    tokens: &HashMap<String, String>,
    bodies: &mut HashMap<String, Vec<RawItem>>,
) -> RawItem {
    let mut splice_all = |items: Vec<RawItem>| -> Vec<RawItem> {
        items
            .into_iter()
            .map(|item| splice(item, tokens, bodies))
            .collect()
    };
    let RawItem {
        id,
        values,
        children,
        nested,
    } = item;
    RawItem {
        id: id.map(|id| tokens.get(&id).cloned().unwrap_or(id)),
        values: values.map(&mut splice_all),
        children: splice_all(children),
        nested: nested.map(|nested| {
            let body = placeheld(&nested, bodies).unwrap_or(nested);
            body.into_iter()
                .map(|item| splice(item, tokens, bodies))
                .collect()
        }),
    }
}

// The items links-notation reads from the prepared text, read one piece at a
// time as the header of this file describes, or the failure it reports.
fn read_items(
    source: &str,
    prepared: &str,
    quotes: &[QuoteReference],
) -> Result<Vec<RawItem>, LinoParseError> {
    let marker = unused_pair(source);
    let (tokenized, tokens) = tokenize(prepared, quotes, &marker);
    let (groups, missing) = find_groups(&tokenized.text);
    let text = format!("{}{}", tokenized.text, ")".repeat(missing));
    // A group's height counts the levels of parentheses it nests, itself
    // included, where a group parsed on its own counts as one level.
    let mut height = vec![1usize; groups.len()];
    let mut alone = vec![false; groups.len()];
    for index in (0..groups.len()).rev() {
        alone[index] = height[index] >= LINO_PIECE_DEPTH;
        if let Some(parent) = groups[index].parent {
            let counted = if alone[index] { 1 } else { height[index] };
            height[parent] = height[parent].max(counted + 1);
        }
    }
    // The groups parsed on their own that each piece holds in its text: piece 0
    // is the whole text, and piece `index + 1` the group `index` when it is
    // parsed on its own.
    let mut inner: Vec<Vec<usize>> = vec![Vec::new(); groups.len() + 1];
    let mut owner = vec![0usize; groups.len()];
    for (index, group) in groups.iter().enumerate() {
        owner[index] = match group.parent {
            None => 0,
            Some(parent) if alone[parent] => parent + 1,
            Some(parent) => owner[parent],
        };
        if alone[index] {
            inner[owner[index]].push(index);
        }
    }
    let name = |group: usize| format!("{marker}g{group}");
    // The earliest failure, as an offset in `text`.
    let mut failure = usize::MAX;
    let top = read_piece(&text, &groups, &inner[0], (0, text.len()), name);
    if let Err(offset) = top {
        failure = offset;
    }
    // A group can only fail after its `(`, so one that opens at or after the
    // earliest failure so far cannot move it.
    let mut bodies = HashMap::new();
    for (index, group) in groups.iter().enumerate() {
        if !alone[index] || group.open >= failure {
            continue;
        }
        let span = (group.open, group.close + 1);
        match read_piece(&text, &groups, &inner[index + 1], span, name) {
            Ok(links) => {
                let body = line_item(&links[0]).nested.unwrap_or_default();
                bodies.insert(name(index), body);
            }
            Err(offset) => failure = failure.min(offset),
        }
    }
    if failure != usize::MAX {
        return Err(unexpected_at(source, tokenized.unmap(failure)));
    }
    if missing > 0 {
        return Err(unexpected_at(source, source.len()));
    }
    let top = top.expect("a piece that failed is reported");
    let items = top.iter().map(line_item);
    if tokens.is_empty() && bodies.is_empty() {
        return Ok(items.collect());
    }
    Ok(items
        .map(|item| splice(item, &tokens, &mut bodies))
        .collect())
}

/// Parse RML source text into its top-level forms.
///
/// Each form carries its text (a parenthesized LiNo link) and the 1-based line
/// and code-point column of the first character other than a space or a tab on
/// the line it starts on; `length` is 1, or 0 when the position could not be
/// traced.
///
/// # Errors
///
/// A [`LinoParseError`] when the document is not valid LiNo.
pub fn parse_lino_document(text: &str) -> Result<Vec<LinoForm>, LinoParseError> {
    let PreparedLino {
        source,
        prepared,
        lines,
        quotes,
    } = prepare_lino_source(text)?;
    if prepared.trim().is_empty() {
        return Ok(Vec::new());
    }
    let items = read_items(&source, &prepared, &quotes)?;
    let mut links = Vec::new();
    for item in &items {
        collect_links(item, &[], &mut links);
    }
    let LinkLines { indexes, dropped } = trace_link_lines(&items, lines.len());
    if let Some(dropped) = dropped {
        return Err(match indexes {
            Some(_) => {
                let at = &lines[dropped];
                LinoParseError::at(DROPPED_LINE, (at.line, at.col), 1)
            }
            None => LinoParseError::new(DROPPED_LINE),
        });
    }
    let indexes = indexes.filter(|indexes| indexes.len() == links.len());
    Ok(links
        .iter()
        .enumerate()
        .filter(|(_, link)| !is_comment_link(link))
        .map(|(position, link)| {
            let start = indexes.as_ref().map(|indexes| &lines[indexes[position]]);
            LinoForm {
                text: format_parsed_link(link),
                line: start.map_or(1, |start| start.line),
                col: start.map_or(1, |start| start.col),
                length: usize::from(start.is_some()),
            }
        })
        .collect())
}
