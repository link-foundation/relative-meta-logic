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
//!    - record the logical lines, the lines that start outside parentheses and
//!      quoted references and hold more than spaces and tabs;
//!    - reject nesting deeper than [`MAX_LINO_NESTING_DEPTH`] (parentheses plus
//!      indentation levels) and sources longer than [`MAX_LINO_SOURCE_UNITS`]
//!      UTF-16 code units, before the parser can exhaust the stack.
//!
//!    Every byte of the prepared text stands where the byte it replaces stood,
//!    so parser positions are source positions.
//! 3. Parse with links-notation and format every top-level link the way the
//!    JavaScript links-notation parser builds it, with one repair: a line under
//!    an indented id keeps its name, so `a:` over `b: c` reads as
//!    `(a: (b: c))`, and a line indented under such a line is refused where
//!    links-notation 0.20 would drop it. The parser does not see a last line
//!    that holds only spaces and tabs: the Rust links-notation 0.20 parser
//!    reads its spaces as the indentation of a line that never comes and
//!    fails, where the JavaScript parser reads them as trailing space.
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
//! The nesting limit protects the stack, not the time: links-notation 0.20
//! backtracks without memoizing, so its parse time grows exponentially with the
//! nesting depth of parentheses.

use crate::{Diagnostic, Span};
use links_notation::parser::{parse_document_with_diagnostics, quoted_reference_end, Link};
use std::fmt;

/// Deepest nesting of parentheses plus indentation levels a document may use.
pub const MAX_LINO_NESTING_DEPTH: usize = 64;

/// Longest source, in UTF-16 code units, the links-notation parser accepts.
pub const MAX_LINO_SOURCE_UNITS: usize = 10 * 1024 * 1024;

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
}

/// Prepare a LiNo source for the links-notation parser.
///
/// The prepared text has the length of the normalized source, and every byte
/// in it sits at the position of the byte it stands for. `lines` lists the
/// logical lines, each with the offset, line, and column of its first
/// character other than a space or a tab.
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
            if let Some(end) = quoted_reference_end(&source, index) {
                line += bytes[index..end].iter().filter(|&&b| b == b'\n').count();
                index = end;
                continue;
            }
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

fn collect_links(item: &RawItem, parent_path: &[ParsedLink], result: &mut Vec<ParsedLink>) {
    if item.children.is_empty() {
        result.push(combine_path_elements(parent_path, transform_link(item)));
        return;
    }
    if is_indented_id_item(item) {
        // links-notation reads each line under an indented id through its
        // single value, which drops the name of a line such as `b: c`. Keep
        // such a line whole, `(a: (b: c))`, the way the line `(b: c)` reads.
        let child_values = item
            .children
            .iter()
            .map(|child| match &child.values {
                Some(values) if values.len() == 1 && child.id.is_none() => {
                    transform_link(&values[0])
                }
                _ => transform_link(child),
            })
            .collect();
        let current = ParsedLink::new(item.id.clone(), child_values);
        result.push(combine_path_elements(parent_path, current));
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
    /// The first line links-notation would leave out, a line indented under a
    /// value of an indented id.
    dropped: Option<usize>,
}

// The logical line each top-level link comes from, in the order
// `collect_links` produces them: an item gives one link at its line; an
// indented-id item (`name:` over indented lines) takes in the lines under it,
// and any other item is followed by its children.
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
    fn visit(item: &RawItem, trace: &mut Trace) {
        trace.indexes.push(trace.next);
        trace.next += 1;
        if !item.children.is_empty() && is_indented_id_item(item) {
            for value in &item.children {
                trace.next += 1;
                if !value.children.is_empty() && trace.dropped.is_none() {
                    trace.dropped = Some(trace.next);
                }
                for line in &value.children {
                    skip(line, trace);
                }
            }
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
    } = prepare_lino_source(text)?;
    if prepared.trim().is_empty() {
        return Ok(Vec::new());
    }
    let input = parser_input(&prepared);
    let parsed = parse_document_with_diagnostics(input).map_err(|failure| {
        // A failure at the end of what the parser reads is one at the end of
        // the source: all the parser does not see is trailing space.
        let offset = if failure.offset >= input.len() {
            source.len()
        } else {
            failure.offset
        };
        unexpected_at(&source, offset)
    })?;
    let items: Vec<RawItem> = parsed.iter().map(line_item).collect();
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
