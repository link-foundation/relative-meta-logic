// RML — minimal relative meta-logic over LiNo (Links Notation)
// Supports many-valued logics from unary (1-valued) through continuous probabilistic (∞-valued).
// See: https://en.wikipedia.org/wiki/Many-valued_logic
//
// - Uses official links-notation crate to parse LiNo text into links
// - Terms are defined via (x: x is x)
// - Probabilities are assigned ONLY via: ((<expr>) has probability <p>)
// - Redefinable ops: (=: ...), (!=: not =), (and: avg|min|max|product|probabilistic_sum), (or: ...), (not: ...), (both: ...), (neither: ...)
// - Range: (range: 0 1) for [0,1] or (range: -1 1) for [-1,1] (balanced/symmetric)
// - Valence: (valence: N) to restrict truth values to N discrete levels (N=2 → Boolean, N=3 → ternary, etc.)
// - Query: (? <expr>)

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::{self, sleep, JoinHandle};
use std::time::{Duration, Instant};

pub mod lean_export;
pub use lean_export::{export_lean, lean_ident, LeanExportResult};

pub mod lino_frontend;
pub use lino_frontend::{
    normalize_lino_source, parse_lino_document, prepare_lino_source, LinoForm, LinoParseError,
    MAX_LINO_NESTING_DEPTH, MAX_LINO_SOURCE_UNITS,
};

// ========== Structured Diagnostics ==========
// Every parser/evaluator error is reported as a `Diagnostic` with an error
// code, human-readable message, and source span (file/line/col, 1-based).
// See `docs/DIAGNOSTICS.md` for the full code list.

/// A source span: 1-based `line`/`col`, optional file path, and a `length`
/// of the offending region (used to render carets in the CLI).
#[derive(Debug, Clone, PartialEq)]
pub struct Span {
    pub file: Option<String>,
    pub line: usize,
    pub col: usize,
    pub length: usize,
}

impl Span {
    pub fn new(file: Option<String>, line: usize, col: usize, length: usize) -> Self {
        Self {
            file,
            line,
            col,
            length,
        }
    }

    pub fn unknown() -> Self {
        Self {
            file: None,
            line: 1,
            col: 1,
            length: 0,
        }
    }
}

/// A single diagnostic emitted by parser, evaluator, or type checker.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub span: Span,
}

impl Diagnostic {
    pub fn new(code: &str, message: impl Into<String>, span: Span) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            span,
        }
    }
}

/// Result of `evaluate(src)`: a list of query results (numeric or type) plus
/// any diagnostics emitted while parsing/evaluating. When tracing is enabled
/// via `evaluate_with_options`, `trace` carries the deterministic sequence of
/// `TraceEvent` values recorded during evaluation; otherwise it is empty.
/// When proof production is enabled (via `EvaluateOptions::with_proofs` or
/// any per-query `(? expr with proof)` keyword), `proofs[i]` carries a
/// derivation tree for `results[i]`; bare queries that did not request a
/// witness get `None` so the vec stays index-aligned with `results`.
/// Mirrors the JavaScript `{results, diagnostics, trace, proofs}` shape.
#[derive(Debug, Clone, Default)]
pub struct EvaluateResult {
    pub results: Vec<RunResult>,
    pub diagnostics: Vec<Diagnostic>,
    pub trace: Vec<TraceEvent>,
    pub proofs: Vec<Option<Node>>,
    /// Equality-layer provenance (issue #97). For every query that is a
    /// direct equality (`(? (L = R))`), records which of the four equality
    /// layers fired: `assigned-equality`, `structural-equality`,
    /// `definitional-equality`, or `numeric-equality`. Non-equality queries
    /// get `None`. The vec is empty when no equality query was observed,
    /// matching JavaScript's lazy `out.provenance` shape.
    pub provenance: Vec<Option<String>>,
}

/// Options for `evaluate_with_options` — bundles environment settings with
/// runtime flags like `trace` and `with_proofs`. Keeps `evaluate()`
/// backwards compatible.
#[derive(Debug, Clone, Default)]
pub struct EvaluateOptions {
    pub env: Option<EnvOptions>,
    pub trace: bool,
    /// When true, every query result is accompanied by a derivation tree at
    /// the same index in `EvaluateResult.proofs`. The inline
    /// `(? expr with proof)` keyword pair opts in per-query without flipping
    /// this global flag.
    pub with_proofs: bool,
}

// ========== Trace events ==========
// When `evaluate` is called with `EvaluateOptions { trace: true }` the
// evaluator records a deterministic sequence of `TraceEvent` values describing
// operator resolutions, assignment lookups, and reduction steps. The CLI's
// `--trace` flag prints each one as `[span <file>:<line>:<col>] <kind> <details>`.
// Mirrors `TraceEvent` / `formatTraceEvent` in `js/src/rml-links.mjs`.

/// A single trace event emitted by the evaluator.
#[derive(Debug, Clone, PartialEq)]
pub struct TraceEvent {
    pub kind: String,
    pub detail: String,
    pub span: Span,
}

impl TraceEvent {
    pub fn new(kind: &str, detail: impl Into<String>, span: Span) -> Self {
        Self {
            kind: kind.to_string(),
            detail: detail.into(),
            span,
        }
    }
}

/// Format a trace event as `[span <file>:<line>:<col>] <kind> <details>`.
pub fn format_trace_event(event: &TraceEvent) -> String {
    let file = event.span.file.as_deref().unwrap_or("<input>");
    format!(
        "[span {}:{}:{}] {} {}",
        file, event.span.line, event.span.col, event.kind, event.detail
    )
}

/// Format a numeric value for trace output — strips trailing zeros so
/// `1.000000` reads as `1` and `0.5` stays `0.5`. Mirrors `formatTraceValue`
/// in the JavaScript implementation so cross-runtime traces match exactly.
pub fn format_trace_value(v: f64) -> String {
    if !v.is_finite() {
        return v.to_string();
    }
    let rounded = format!("{:.6}", v);
    // Trim trailing zeros and possibly the decimal point.
    let trimmed = rounded.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Format a diagnostic for human-readable CLI output:
///     `<file>:<line>:<col>: <CODE>: <message>`
///         `<source line>`
///         `^`
pub fn format_diagnostic(diag: &Diagnostic, source: Option<&str>) -> String {
    let file = diag.span.file.as_deref().unwrap_or("<input>");
    let mut out = format!(
        "{}:{}:{}: {}: {}",
        file, diag.span.line, diag.span.col, diag.code, diag.message
    );
    if let Some(src) = source {
        let lines: Vec<&str> = src.split('\n').collect();
        if diag.span.line >= 1 && diag.span.line <= lines.len() {
            let line_text = lines[diag.span.line - 1];
            out.push('\n');
            out.push_str(line_text);
            out.push('\n');
            let pad = diag.span.col.saturating_sub(1);
            let caret_count = diag.span.length.max(1);
            out.push_str(&" ".repeat(pad));
            out.push_str(&"^".repeat(caret_count));
        }
    }
    out
}

/// Compute 1-based source spans for every top-level LiNo form in `text`.
/// Mirrors `computeFormSpans` in the JavaScript implementation.
///
/// A span points at the first character other than a space or a tab on the
/// line the form starts on, with the column counted in Unicode code points.
/// Text that is not valid LiNo has no forms and so no spans.
pub fn compute_form_spans(text: &str, file: Option<&str>) -> Vec<Span> {
    match parse_lino_document(text) {
        Ok(forms) => forms.iter().map(|form| form.span(file)).collect(),
        Err(_) => Vec::new(),
    }
}

// ========== LiNo Parser ==========
// The shared front end in `lino_frontend.rs` reads LiNo text with the official
// links-notation crate. See: https://github.com/link-foundation/links-notation

/// Parse LiNo source text into the texts of its top-level forms.
///
/// The shared front end in [`lino_frontend`] reads the text with the
/// links-notation parser; comment links such as `(# note)` are left out.
///
/// # Errors
///
/// A [`LinoParseError`] when the text is not valid LiNo.
pub fn parse_lino(text: &str) -> Result<Vec<String>, LinoParseError> {
    Ok(parse_lino_document(text)?
        .into_iter()
        .map(|form| form.text)
        .collect())
}

/// Read the text of one top-level form into its AST.
///
/// # Errors
///
/// The E002 message of [`parse_one`] when the form does not read.
pub fn read_lino_form(text: &str) -> Result<Node, String> {
    parse_one(&tokenize_one(text)).map(desugar_hoas)
}

/// Parse LiNo source text into the ASTs of its top-level forms.
///
/// # Errors
///
/// The message of the first failure: a [`LinoParseError`] message when the
/// text is not valid LiNo, or the E002 message of a form that does not read.
pub fn parse_lino_forms(text: &str) -> Result<Vec<Node>, String> {
    parse_lino_document(text)
        .map_err(|err| err.message())?
        .iter()
        .map(|form| read_lino_form(&form.text))
        .collect()
}

/// Read LiNo source text into the ASTs of its top-level forms, each with the
/// span of the line it starts on.
///
/// # Errors
///
/// The diagnostic of the first failure: E006 at the position the front end
/// names when the text is not valid LiNo, or E002 at the form's span when a
/// form does not read.
pub fn read_lino_forms(text: &str, file: Option<&str>) -> Result<Vec<(Node, Span)>, Diagnostic> {
    parse_lino_document(text)
        .map_err(|err| err.to_diagnostic(file))?
        .iter()
        .map(|form| {
            let span = form.span(file);
            match read_lino_form(&form.text) {
                Ok(node) => Ok((node, span)),
                Err(message) => Err(Diagnostic::new("E002", message, span)),
            }
        })
        .collect()
}

fn is_literate_lino_path(file: Option<&str>) -> bool {
    file.map(|path| path.to_ascii_lowercase().ends_with(".lino.md"))
        .unwrap_or(false)
}

fn parse_markdown_fence(line: &str) -> Option<(char, usize, &str)> {
    let trimmed = line.trim_start_matches(|c| c == ' ' || c == '\t');
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let count = trimmed.chars().take_while(|c| *c == marker).count();
    if count < 3 {
        return None;
    }
    Some((marker, count, &trimmed[count..]))
}

fn is_closing_markdown_fence(line: &str, marker: char, min_len: usize) -> bool {
    let Some((found_marker, found_len, rest)) = parse_markdown_fence(line) else {
        return false;
    };
    found_marker == marker
        && found_len >= min_len
        && rest.chars().all(|c| c == ' ' || c == '\t')
}

fn is_lino_fence_info(info: &str) -> bool {
    info.trim()
        .split_whitespace()
        .next()
        .map(|tag| tag.eq_ignore_ascii_case("lino"))
        .unwrap_or(false)
}

/// Extract LiNo code from fenced `lino` blocks in a literate `.lino.md` file.
///
/// Non-LiNo prose and other code fences become blank lines so diagnostics keep
/// the original Markdown line numbers.
pub fn extract_literate_lino(text: &str) -> String {
    let mut out = Vec::new();
    let mut active_fence: Option<(char, usize, bool)> = None;
    for line in text.split('\n') {
        if let Some((marker, min_len, include)) = active_fence {
            if is_closing_markdown_fence(line, marker, min_len) {
                active_fence = None;
                out.push(String::new());
            } else if include {
                out.push(line.to_string());
            } else {
                out.push(String::new());
            }
            continue;
        }

        if let Some((marker, len, info)) = parse_markdown_fence(line) {
            active_fence = Some((marker, len, is_lino_fence_info(info)));
            out.push(String::new());
        } else {
            out.push(String::new());
        }
    }
    out.join("\n")
}

// ========== AST ==========

/// AST node: either a leaf string or a list of child nodes.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Leaf(String),
    List(Vec<Node>),
}

impl fmt::Display for Node {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Node::Leaf(s) => write!(f, "{}", s),
            Node::List(children) => {
                write!(f, "(")?;
                for (i, child) in children.iter().enumerate() {
                    if i > 0 {
                        write!(f, " ")?;
                    }
                    write!(f, "{}", child)?;
                }
                write!(f, ")")
            }
        }
    }
}

// ========== Helpers ==========

/// Tokenize a single link string into tokens (parens and words).
pub fn tokenize_one(s: &str) -> Vec<String> {
    let mut s = s.to_string();

    // Strip inline comments (everything after #) but balance parens
    if let Some(comment_idx) = s.find('#') {
        s = s[..comment_idx].to_string();
        // Count unmatched opening parens and add closing parens to balance
        let mut depth: i32 = 0;
        for c in s.chars() {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
            }
        }
        while depth > 0 {
            s.push(')');
            depth -= 1;
        }
    }

    let mut out = Vec::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '(' || c == ')' {
            out.push(c.to_string());
            i += 1;
            continue;
        }
        let j_start = i;
        while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '(' && chars[i] != ')' {
            i += 1;
        }
        out.push(chars[j_start..i].iter().collect());
    }
    out
}

/// Parse tokens into an AST node.
pub fn parse_one(tokens: &[String]) -> Result<Node, String> {
    let mut i = 0;

    fn read(tokens: &[String], i: &mut usize) -> Result<Node, String> {
        if *i >= tokens.len() || tokens[*i] != "(" {
            return Err("expected \"(\"".to_string());
        }
        *i += 1;
        let mut arr = Vec::new();
        while *i < tokens.len() && tokens[*i] != ")" {
            if tokens[*i] == "(" {
                arr.push(read(tokens, i)?);
            } else {
                arr.push(Node::Leaf(tokens[*i].clone()));
                *i += 1;
            }
        }
        if *i >= tokens.len() || tokens[*i] != ")" {
            return Err("expected \")\"".to_string());
        }
        *i += 1;
        Ok(Node::List(arr))
    }

    let ast = read(tokens, &mut i)?;
    if i != tokens.len() {
        return Err("extra tokens after link".to_string());
    }
    Ok(ast)
}

/// Higher-order abstract syntax (issue #51, D7): rewrite the surface keyword
/// `forall` to the kernel binder `Pi`. Both forms share identical structure
/// `(<binder> (Type x) body)`, so the desugarer walks the AST and rewrites
/// the head leaf in place. Object-language binders are encoded as
/// host-language `lambda` and `Pi`/`forall`, letting substitution and
/// capture-avoidance reuse the kernel primitives without a separate
/// object-level binder representation.
pub fn desugar_hoas(node: Node) -> Node {
    match node {
        Node::Leaf(_) => node,
        Node::List(children) => {
            let mapped: Vec<Node> = children.into_iter().map(desugar_hoas).collect();
            // Rewrite `(forall (T x) body)` → `(Pi (T x) body)` only when the
            // binder is a list (HOAS synonym). A bare leaf, e.g. `(forall A body)`,
            // is prenex-polymorphism sugar and must reach `synth`/`is_forall_node` intact.
            if mapped.len() == 3 {
                if let Node::Leaf(ref head) = mapped[0] {
                    if head == "forall" {
                        if let Node::List(_) = mapped[1] {
                            let mut rewritten = Vec::with_capacity(3);
                            rewritten.push(Node::Leaf("Pi".to_string()));
                            let mut iter = mapped.into_iter();
                            iter.next();
                            rewritten.extend(iter);
                            return Node::List(rewritten);
                        }
                    }
                }
            }
            Node::List(mapped)
        }
    }
}

/// Check if a string is numeric (including negative).
pub fn is_num(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    let s = if let Some(stripped) = s.strip_prefix('-') {
        stripped
    } else {
        s
    };
    if s.is_empty() {
        return false;
    }
    if let Some(rest) = s.strip_prefix('.') {
        // .digits
        !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
    } else {
        // digits or digits.digits
        let parts: Vec<&str> = s.splitn(2, '.').collect();
        if parts.is_empty() || !parts[0].chars().all(|c| c.is_ascii_digit()) || parts[0].is_empty()
        {
            return false;
        }
        if parts.len() == 2 {
            parts[1].chars().all(|c| c.is_ascii_digit())
        } else {
            true
        }
    }
}

/// Create a canonical key representation of a node.
pub fn key_of(node: &Node) -> String {
    match node {
        Node::Leaf(s) => s.clone(),
        Node::List(children) => {
            let inner: Vec<String> = children.iter().map(key_of).collect();
            format!("({})", inner.join(" "))
        }
    }
}

fn parse_universe_level_token(token: &str) -> Option<u64> {
    if token.is_empty() || !token.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if token.len() > 1 && token.starts_with('0') {
        return None;
    }
    token.parse::<u64>().ok()
}

fn universe_type_key(node: &Node) -> Option<String> {
    let Node::List(children) = node else {
        return None;
    };
    if children.len() != 2 {
        return None;
    }
    let (Node::Leaf(head), Node::Leaf(level_s)) = (&children[0], &children[1]) else {
        return None;
    };
    if head != "Type" {
        return None;
    }
    let level = parse_universe_level_token(level_s)?;
    Some(format!("(Type {})", level.checked_add(1)?))
}

fn infer_type_key(node: &Node, env: &mut Env) -> Option<String> {
    let key = match node {
        Node::Leaf(s) => s.clone(),
        other => key_of(other),
    };
    if let Some(recorded) = env.get_type(&key) {
        return Some(recorded.clone());
    }
    if let Some(type_key) = universe_type_key(node) {
        env.set_type(&key, &type_key);
        return Some(type_key);
    }
    None
}

/// Check structural equality of two nodes.
pub fn is_structurally_same(a: &Node, b: &Node) -> bool {
    match (a, b) {
        (Node::Leaf(sa), Node::Leaf(sb)) => sa == sb,
        (Node::List(la), Node::List(lb)) => {
            la.len() == lb.len()
                && la
                    .iter()
                    .zip(lb.iter())
                    .all(|(x, y)| is_structurally_same(x, y))
        }
        _ => false,
    }
}

// ========== Decimal-precision arithmetic ==========
// Round to at most DECIMAL_PRECISION significant decimal places to eliminate
// IEEE-754 floating-point artefacts (e.g. 0.1+0.2 → 0.3, not 0.30000000000000004).
const DECIMAL_PRECISION: i32 = 12;

pub fn dec_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let factor = 10f64.powi(DECIMAL_PRECISION);
    (x * factor).round() / factor
}

// ========== Quantization ==========

/// Quantize a value to N discrete levels in range [lo, hi].
/// For N=2 (Boolean): levels are {lo, hi}
/// For N=3 (ternary): levels are {lo, mid, hi}
/// For N<2 (continuous/unary): no quantization
/// See: <https://en.wikipedia.org/wiki/Many-valued_logic>
pub fn quantize(x: f64, valence: u32, lo: f64, hi: f64) -> f64 {
    if valence < 2 {
        return x; // unary or continuous — no quantization
    }
    let step = (hi - lo) / (valence as f64 - 1.0);
    let level = ((x - lo) / step).round();
    let level = level.max(0.0).min(valence as f64 - 1.0);
    lo + level * step
}

// ========== Aggregator Types ==========

/// Supported aggregator types for AND/OR operators.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Aggregator {
    Avg,
    Min,
    Max,
    Prod,
    Ps, // Probabilistic sum: 1 - ∏(1-xi)
}

impl Aggregator {
    pub fn apply(&self, xs: &[f64], lo: f64) -> f64 {
        if xs.is_empty() {
            return lo;
        }
        match self {
            Aggregator::Avg => xs.iter().sum::<f64>() / xs.len() as f64,
            Aggregator::Min => xs.iter().copied().fold(f64::INFINITY, f64::min),
            Aggregator::Max => xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            Aggregator::Prod => xs.iter().copied().fold(1.0, |a, b| a * b),
            Aggregator::Ps => 1.0 - xs.iter().copied().fold(1.0, |a, b| a * (1.0 - b)),
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "avg" => Some(Aggregator::Avg),
            "min" => Some(Aggregator::Min),
            "max" => Some(Aggregator::Max),
            "product" | "prod" => Some(Aggregator::Prod),
            "probabilistic_sum" | "ps" => Some(Aggregator::Ps),
            _ => None,
        }
    }
}

/// Resolve a truth-table token (input or output) to its numeric value.
/// Numeric literals stay numeric; symbolic constants flow through
/// `env.symbol_prob` so user-declared truth constants like `(true: 1)` or
/// `(unknown: 0.5)` are honoured. Returns `None` when the token cannot
/// be resolved so the caller can skip the row.
fn resolve_truth_table_value(env: &Env, tok: &str) -> Option<f64> {
    if let Ok(num) = tok.parse::<f64>() {
        if num.is_finite() {
            return Some(num);
        }
    }
    env.symbol_prob.get(tok).copied()
}

fn truth_table_key(values: &[f64]) -> String {
    values
        .iter()
        .map(|v| format!("{:.15}", v))
        .collect::<Vec<_>>()
        .join("\u{1}")
}

fn resolved_carrier_values(env: &Env, foundation: &FoundationDescriptor) -> Option<Vec<f64>> {
    if !foundation.strict_carrier || foundation.carrier.is_empty() {
        return None;
    }
    let mut values = Vec::new();
    let mut seen = HashSet::new();
    for tok in &foundation.carrier {
        let value = resolve_truth_table_value(env, tok)?;
        let key = truth_table_key(&[value]);
        if seen.insert(key) {
            values.push(value);
        }
    }
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn truth_table_rows_complete_for_carrier(
    env: &Env,
    rows: &[TruthTableRow],
    foundation: &FoundationDescriptor,
) -> bool {
    let carrier = match resolved_carrier_values(env, foundation) {
        Some(values) => values,
        None => return false,
    };
    let mut arity: Option<usize> = None;
    let mut seen_rows: HashSet<String> = HashSet::new();
    for row in rows {
        if arity.is_none() {
            arity = Some(row.inputs.len());
        }
        if Some(row.inputs.len()) != arity {
            return false;
        }
        let mut inputs = Vec::with_capacity(row.inputs.len());
        for tok in &row.inputs {
            match resolve_truth_table_value(env, tok) {
                Some(v) => inputs.push(v),
                None => return false,
            }
        }
        if resolve_truth_table_value(env, &row.output).is_none() {
            return false;
        }
        seen_rows.insert(truth_table_key(&inputs));
    }
    let arity = match arity {
        Some(a) => a,
        None => return false,
    };
    let required = carrier.len().pow(arity as u32);
    if seen_rows.len() < required {
        return false;
    }
    fn visit(
        carrier: &[f64],
        seen_rows: &HashSet<String>,
        arity: usize,
        prefix: &mut Vec<f64>,
    ) -> bool {
        if prefix.len() == arity {
            return seen_rows.contains(&truth_table_key(prefix));
        }
        for value in carrier {
            prefix.push(*value);
            if !visit(carrier, seen_rows, arity, prefix) {
                prefix.pop();
                return false;
            }
            prefix.pop();
        }
        true
    }
    visit(&carrier, &seen_rows, arity, &mut Vec::new())
}

fn truth_table_fallback_dependencies(
    env: &Env,
    op_name: &str,
    previous_impl: Option<&ActiveImplementationDescriptor>,
) -> Vec<String> {
    let mut deps = Vec::new();
    if let Some(implementation) = previous_impl {
        deps.extend(implementation.depends_on.iter().cloned());
    } else if let Some(rc) = env.root_constructs.get(op_name) {
        deps.extend(rc.depends_on.iter().cloned());
    }
    deps.push("truth-table-fallback".to_string());
    let mut seen = HashSet::new();
    deps.into_iter()
        .filter(|dep| seen.insert(dep.clone()))
        .collect()
}

// ========== Operator ==========

/// Operator types supported by the environment.
#[derive(Debug, Clone)]
pub enum Op {
    /// Negation: mirrors around midpoint. not(x) = hi - (x - lo)
    Not,
    /// Aggregator-based operator (for and/or).
    Agg(Aggregator),
    /// Equality operator: checks assigned probability or structural equality.
    Eq,
    /// Inequality: not(eq(...))
    Neq,
    /// Composition: outer(inner(...))
    Compose {
        outer: String,
        inner: String,
    },
    /// Arithmetic: +, -, *, / (decimal-precision)
    Add,
    Sub,
    Mul,
    Div,
    /// Numeric comparisons: <, <=
    Less,
    LessOrEqual,
    /// Links-defined finite truth table (issue #97, Section 3 of
    /// netkeep80's punch-list). When invoked the evaluator looks up the
    /// first row whose inputs match `xs` (±1e-12 tolerance) and returns
    /// the row's output. If no row matches, the call delegates to
    /// `fallback` so partial tables overlay cleanly onto the host
    /// default. `rows` carries values pre-resolved against
    /// `env.symbol_prob` at activation time.
    TruthTable {
        rows: Vec<TruthTableEntry>,
        fallback: Option<Box<Op>>,
    },
}

/// One resolved row inside an `Op::TruthTable`. Inputs and output are
/// stored as `f64` after symbolic constants have been looked up.
#[derive(Debug, Clone, PartialEq)]
pub struct TruthTableEntry {
    pub inputs: Vec<f64>,
    pub output: f64,
}

// ========== Environment ==========

/// Options for creating an Env.
#[derive(Debug, Clone)]
pub struct EnvOptions {
    pub lo: f64,
    pub hi: f64,
    pub valence: u32,
}

impl Default for EnvOptions {
    fn default() -> Self {
        Self {
            lo: 0.0,
            hi: 1.0,
            valence: 0,
        }
    }
}

/// Options for definitional equality / convertibility checks.
#[derive(Debug, Clone, Copy, Default)]
pub struct ConvertOptions {
    /// Enable eta-contraction, e.g. `(lambda (A x) (apply f x)) == f`
    /// when `x` is not free in `f`.
    pub eta: bool,
}

/// A stored lambda definition (param name, param type, body).
#[derive(Debug, Clone)]
pub struct Lambda {
    pub param: String,
    pub param_type: String,
    pub body: Node,
}

/// A pre-evaluation template declaration (issue #59).
/// `(template (<name> <param>...) <body>)` records a reusable link shape;
/// later `(<name> arg...)` uses are expanded before they reach `eval_node`.
#[derive(Debug, Clone)]
pub struct TemplateDecl {
    pub name: String,
    pub params: Vec<String>,
    pub body: Node,
}

/// A domain plugin receives the body of `(domain <name> ...)` and mutates the
/// evaluator environment with any decisions it can certify.
pub type DomainPluginFn = fn(&[Node], &mut Env) -> Result<(), String>;

/// Decision record produced by the built-in automatic-sequences plugin.
#[derive(Debug, Clone, PartialEq)]
pub struct AutomaticSequenceDecision {
    pub theorem: String,
    pub value: bool,
    pub method: String,
    pub certificate: Node,
}

/// The evaluation environment: holds terms, assignments, operators, and range/valence config.
pub struct Env {
    pub terms: HashSet<String>,
    pub assign: HashMap<String, f64>,
    pub symbol_prob: HashMap<String, f64>,
    pub lo: f64,
    pub hi: f64,
    pub valence: u32,
    pub ops: HashMap<String, Op>,
    pub types: HashMap<String, String>,
    pub lambdas: HashMap<String, Lambda>,
    pub templates: HashMap<String, TemplateDecl>,
    /// Tracing state. When `trace_enabled` is true, key evaluation events
    /// (operator resolutions, assignment lookups, top-level reductions) are
    /// appended to `trace_events`. The current top-level form span is stashed
    /// on the Env so leaf hooks can attach a location without threading spans
    /// through every helper. Mirrors the `_tracer`/`_currentSpan` design in
    /// `js/src/rml-links.mjs`.
    pub trace_enabled: bool,
    pub trace_events: Vec<TraceEvent>,
    pub current_span: Option<Span>,
    pub default_span: Span,
    /// Namespace state (issue #34): a file can declare `(namespace foo)`, which
    /// prefixes every name it subsequently introduces with `foo.`. Imports can
    /// be aliased via `(import "x.lino" as a)`, which records `a` -> the
    /// imported file's declared namespace so `a.name` resolves to that name.
    /// `imported` tracks names that came from an import (not declared in the
    /// importing file) so we can emit a shadowing warning (E008) when a later
    /// top-level definition rebinds them.
    pub namespace: Option<String>,
    pub aliases: HashMap<String, String>,
    pub imported: HashSet<String>,
    pub shadow_diagnostics: Vec<Diagnostic>,
    pub file_namespaces: HashMap<PathBuf, String>,
    /// Mode declarations (issue #43, D15): each relation may declare an
    /// argument mode pattern via `(mode <name> +input -output ...)`. The
    /// map records the per-argument flag list used by the call-site checker
    /// to reject mode mismatches.
    pub modes: HashMap<String, Vec<ModeFlag>>,
    /// Relation declarations (issue #44, D12): the clause list for each
    /// declared relation, keyed by relation name. Each clause is the
    /// original AST list `(name arg1 arg2 ... result)`. The totality
    /// checker reads these clauses to verify structural decrease on
    /// recursive calls.
    pub relations: HashMap<String, Vec<Node>>,
    /// World declarations (issue #54, D16): each relation may declare a
    /// list of constants permitted to appear free in its arguments via
    /// `(world <name> (<const1> <const2> ...))`. The world checker
    /// rejects relation calls and clauses whose arguments contain any
    /// other free constant. Relations without a recorded world are
    /// unconstrained (the feature is opt-in per relation).
    pub worlds: HashMap<String, Vec<String>>,
    /// Inductive declarations (issue #45, D10): a first-class inductive
    /// datatype encoded as link signatures plus a generated eliminator.
    /// Stored by type name; see [`InductiveDecl`] for the full layout.
    pub inductives: HashMap<String, InductiveDecl>,
    /// Recursive definition declarations (issue #49, D13): each
    /// `(define <name> [(measure ...)] (case ...) ...)` form is recorded
    /// here so the termination checker (`is_terminating`) can verify
    /// structural decrease across recursive calls. Stored by definition
    /// name; see [`DefineDecl`] for the full layout.
    pub definitions: HashMap<String, DefineDecl>,
    /// Coinductive declarations (issue #53, D11): a first-class coinductive
    /// datatype dual to the inductive form, encoded as link signatures plus
    /// a generated corecursor `Name-corec`. Each entry stores the type name,
    /// the ordered constructors, and the name and Pi-type of the
    /// corecursor. The kernel additionally enforces a syntactic productivity
    /// check at declaration time: at least one constructor must take a
    /// recursive argument so non-productive types (which cannot generate
    /// any infinite values) are rejected up front.
    pub coinductives: HashMap<String, CoinductiveDecl>,
    /// Domain plugins (issue #63): domain-specific decision procedures keyed
    /// by `(domain <name> ...)`. The default registry ships the
    /// automatic-sequences plugin below; callers may register additional
    /// function-pointer plugins on their Env instance.
    pub domain_plugins: HashMap<String, DomainPluginFn>,
    /// Decisions recorded by the built-in automatic-sequences plugin.
    pub automatic_sequence_decisions: HashMap<String, AutomaticSequenceDecision>,
    /// Root-construct registry (issue #97). Records what every kernel
    /// construct depends on and whether the user has overridden it.
    /// Data-only: descriptors never alter evaluator behaviour. Consumed by
    /// the foundation report (`(foundation-report)`) and the CLI trust audit.
    pub root_constructs: HashMap<String, RootConstructDescriptor>,
    /// Foundation registry (issue #97). A foundation bundles a coherent
    /// set of root-construct interpretations. `default-rml` is preregistered
    /// with the host-implemented semantics; user files can register
    /// alternative foundations and select them with `(with-foundation …)`.
    /// Backward compatibility is preserved by defaulting to `default-rml`.
    pub foundations: HashMap<String, FoundationDescriptor>,
    pub active_foundation: String,
    pub foundation_stack: Vec<FoundationFrame>,
    pub active_implementations: HashMap<String, ActiveImplementationDescriptor>,
    /// Carrier enforcement state (issue #97, Section 2). Off by default so
    /// legacy programs are not constrained; flipped on by an enclosing
    /// `(with-foundation <name>)` whose descriptor includes both
    /// `(carrier ...)` and `(strict-carrier)` clauses.
    pub strict_carrier: bool,
    pub carrier: Option<Vec<f64>>,
    pub carrier_label: Option<String>,
    /// Proof-object substrate (issue #97, Phase 3 of netkeep80's punch-list).
    /// `proof_rules` maps a declared rule name to its premise patterns and
    /// conclusion pattern (with `?meta` leaves as metavariables). The map
    /// `proof_objects` records concrete derivations consumed by
    /// `(check-proof <name>)`. Both are data-only: declaring a rule never
    /// alters evaluator behaviour. The CLI's foundation report surfaces them.
    pub proof_rules: HashMap<String, ProofRule>,
    pub proof_assumptions: HashMap<String, ProofAssumption>,
    pub proof_objects: HashMap<String, ProofObject>,
    /// Pure-links strict mode (issue #97, Phase 6 of netkeep80's punch-list).
    /// When `strict_pure_links` is true, every queried form is audited
    /// against the root-construct registry; any operator whose status is
    /// `host-primitive` or `host-derived` triggers an E065 diagnostic unless
    /// the construct is in `allowed_host_primitives`. Off by default so
    /// legacy programs run unchanged.
    pub strict_pure_links: bool,
    pub allowed_host_primitives: HashSet<String>,
}

/// Stack frame pushed when entering a foundation scope. Stores the previous
/// active foundation name plus a snapshot of any operators the foundation
/// rebinds, so `exit_foundation` can restore the prior semantics exactly.
/// `snapshot` maps operator name -> previous Op (None if the op did not
/// exist before). Carrier snapshot fields (issue #97 Section 2) preserve the
/// strict-carrier state of the enclosing scope so nested `(with-foundation
/// ...)` bodies roll back cleanly when their inner scope exits.
#[derive(Debug, Clone)]
pub struct FoundationFrame {
    pub previous_active: String,
    pub snapshot: Vec<(String, Option<Op>)>,
    pub previous_active_implementations: Vec<(String, Option<ActiveImplementationDescriptor>)>,
    pub previous_strict_carrier: bool,
    pub previous_carrier: Option<Vec<f64>>,
    pub previous_carrier_label: Option<String>,
}

/// A root-construct descriptor. Stored on the `Env` for the foundation
/// registry (issue #97). Every field is purely informational: declaring a
/// descriptor never changes evaluator behaviour. The CLI's foundation
/// report and tests inspect these records to verify the trust contract.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RootConstructDescriptor {
    pub name: String,
    pub status: Option<String>,
    pub semantic_status: Option<String>,
    pub kind: Option<String>,
    pub depends_on: Vec<String>,
    pub encoded_as: Option<String>,
    pub pure_links_ready: Option<bool>,
    pub override_with: Option<String>,
    pub planned_as: Option<String>,
    pub foundation: Option<String>,
}

/// A foundation descriptor. Bundles a coherent set of root-construct
/// interpretations. Selecting a foundation never silently rewires
/// behaviour; the host operators always run, but the active-foundation
/// tag is exposed via the foundation report so users can audit which
/// foundation they are trusting.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FoundationDescriptor {
    pub name: String,
    pub description: Option<String>,
    pub uses: Vec<String>,
    pub defines: Vec<(String, String)>, // construct -> implementation
    pub extends: Option<String>,
    pub numeric_domain: Option<String>,
    pub truth_domain: Option<String>,
    /// Carrier (issue #97, Section 2): the explicit set of values the
    /// foundation considers legal for queries and probability assignments.
    /// Each entry is stored as a string so `enter_foundation` can resolve
    /// symbolic constants (`true`, `false`, `unknown`) through
    /// `env.symbol_prob` at activation time. Numeric literals stay literal.
    pub carrier: Vec<String>,
    /// When true, the active `with-foundation` scope enforces the carrier
    /// at runtime: out-of-carrier query results and probability
    /// assignments raise an `E063` diagnostic instead of being silently
    /// clamped. Defaults to `false` for backward compatibility — declaring
    /// `(carrier ...)` alone is informational.
    pub strict_carrier: bool,
    /// Links-defined finite truth tables (issue #97, Section 3 of
    /// netkeep80's punch-list). Each entry rebinds the named operator to
    /// the listed row set for the duration of `(with-foundation ...)`.
    /// Inputs and outputs are stored as strings so `enter_foundation` can
    /// resolve symbolic truth constants (`true`, `false`, `unknown`)
    /// through `env.symbol_prob` at activation time. Numeric literals stay
    /// literal. A row whose inputs don't match falls through to the
    /// previously installed op so partial tables remain backward-
    /// compatible.
    pub truth_tables: Vec<(String, Vec<TruthTableRow>)>,
    /// Experimental MTC/anum foundation profile metadata (issue #97,
    /// Phase 9). When `experimental` is true the trust audit prints an
    /// `[experimental]` tag next to the foundation name so consumers can
    /// see it carries no stability guarantees. `root` is the foundation's
    /// root symbol (e.g. `∞` for mtc-anum) and `abits` lists its
    /// foundational alphabet pairs (symbol → meaning).
    pub experimental: bool,
    pub root: Option<String>,
    pub abits: Vec<(String, String)>,
}

/// Active implementation selected by the current foundation scope for a
/// construct such as `and` or `not`. This is the behaviour-facing counterpart
/// to the global root-construct descriptor: strict pure-links mode consults
/// it before falling back to the global registry.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActiveImplementationDescriptor {
    pub construct: String,
    pub foundation: Option<String>,
    pub implementation: Option<String>,
    pub status: Option<String>,
    pub semantic_status: Option<String>,
    pub depends_on: Vec<String>,
}

/// One row of a `(truth-table <op> ...)` declaration: a sequence of input
/// tokens and the output token. See `FoundationDescriptor::truth_tables`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TruthTableRow {
    pub inputs: Vec<String>,
    pub output: String,
}

/// Snapshot of the foundation/root-construct state for the trust report.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FoundationReport {
    pub active_foundation: String,
    pub description: Option<String>,
    pub numeric_domain: Option<String>,
    pub truth_domain: Option<String>,
    pub root_constructs: Vec<RootConstructDescriptor>,
    pub by_status: Vec<(String, Vec<String>)>,
    pub by_semantic_status: Vec<(String, Vec<String>)>,
    pub foundations: Vec<FoundationDescriptor>,
    pub active_implementations: Vec<ActiveImplementationDescriptor>,
    /// Proof-object substrate (issue #97, Phase 3). Surfaced on the report so
    /// the trust audit can list every declared rule and concrete derivation.
    /// Names are kept sorted for stable output across runs.
    pub proof_rules: Vec<ProofRuleSnapshot>,
    pub proof_assumptions: Vec<ProofAssumptionSnapshot>,
    pub proof_objects: Vec<ProofObjectSnapshot>,
    /// Pure-links strict mode state (issue #97, Phase 6). Surfaced so the
    /// trust audit can prove the engine is running in strict mode and list
    /// every host primitive that was explicitly allow-listed.
    pub strict_pure_links: bool,
    pub allowed_host_primitives: Vec<String>,
    /// Dependency-graph traversal (issue #97, Phase 7). For every registered
    /// root-construct, the transitive closure of its `depends_on` chain,
    /// sorted deterministically. Leaf constructs map to an empty vector.
    /// Pairs are kept sorted by name so the report is reproducible.
    pub dependency_graph: Vec<(String, Vec<String>)>,
}

/// A declared rule of inference. Premises and the conclusion are stored as
/// AST nodes; leaves whose token starts with `?` are metavariables that
/// bind during `check_proof_object`. Repeated metavariables must
/// structurally match.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofRule {
    pub name: String,
    pub premises: Vec<Node>,
    pub conclusion: Node,
}

/// An explicit proof leaf. Proof objects cite these with `(premise-by name)`
/// or `(uses name)` so assumptions and axioms are visible in the proof graph.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofAssumption {
    pub name: String,
    pub kind: String,
    pub judgement: Node,
}

/// A concrete derivation that claims to be an instance of a rule. Stored
/// alongside the rule so `(check-proof <name>)` can re-validate it on
/// demand without re-parsing the source.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofObject {
    pub name: String,
    pub rule: String,
    pub premises: Vec<Node>,
    pub premise_refs: Vec<String>,
    pub conclusion: Node,
}

/// Printed view of a `ProofRule` for `foundation_report()`. Patterns are
/// stringified via `key_of` so consumers can pretty-print without owning
/// the AST representation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProofRuleSnapshot {
    pub name: String,
    pub premises: Vec<String>,
    pub conclusion: String,
}

/// Printed view of a proof assumption/axiom for `foundation_report()`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProofAssumptionSnapshot {
    pub name: String,
    pub kind: String,
    pub judgement: String,
}

/// Printed view of a `ProofObject` for `foundation_report()`. Mirrors
/// `ProofRuleSnapshot` and additionally records the referenced rule.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProofObjectSnapshot {
    pub name: String,
    pub rule: String,
    pub premises: Vec<String>,
    pub premise_refs: Vec<String>,
    pub conclusion: String,
}

/// Verdict for `(proof-report <name>)`. Mirrors `CheckProofVerdict` shape
/// without the substitution table.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofReportVerdict {
    pub ok: bool,
    pub error: Option<String>,
}

/// One entry of the transitive dependency walk inside a `ProofReport`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofReportDependency {
    pub name: String,
    pub kind: String,
    /// Rule referenced by a proof-object dependency (empty for axioms/assumptions).
    pub rule: Option<String>,
    /// Stringified judgement, when known.
    pub judgement: Option<String>,
}

/// Per-proof dependency/trust report (issue #97, Phase 13). Built by
/// `Env::proof_report` and surfaced as `RunResult::Proof` so the
/// trust audit can be performed for an individual proof object instead
/// of only globally via `foundation-report`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofReport {
    pub name: String,
    pub rule: Option<String>,
    pub conclusion: Option<String>,
    pub premises: Vec<String>,
    pub premise_refs: Vec<String>,
    pub verdict: ProofReportVerdict,
    pub dependencies: Vec<ProofReportDependency>,
    pub rules: Vec<String>,
    pub root_constructs_used: Vec<String>,
    pub by_semantic_status: Vec<(String, Vec<String>)>,
    pub by_trust_status: Vec<(String, Vec<String>)>,
    pub active_foundation: String,
    pub strict_pure_links: bool,
}

/// One constructor of an inductive datatype.
#[derive(Debug, Clone)]
pub struct ConstructorDecl {
    /// Constructor name (e.g. `zero`, `succ`).
    pub name: String,
    /// Ordered binder list of the constructor's Pi-type, each `(name, type)`.
    /// A constant constructor (`(constructor zero)`) has an empty list.
    pub params: Vec<(String, Node)>,
    /// The constructor's recorded type — either a bare leaf naming the
    /// inductive type (constant constructor) or the original `(Pi …)` chain.
    pub typ: Node,
}

/// A parsed `(inductive Name (constructor …) …)` declaration.
#[derive(Debug, Clone)]
pub struct InductiveDecl {
    /// Inductive type name (must start with an uppercase letter).
    pub name: String,
    /// Ordered list of declared constructors.
    pub constructors: Vec<ConstructorDecl>,
    /// Generated eliminator name (`Name-rec`).
    pub elim_name: String,
    /// Generated eliminator's dependent Pi-type.
    pub elim_type: Node,
}

/// One `(case <pattern-args> <body>)` clause of a `(define …)` declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct DefineClause {
    /// The clause's pattern arguments — the children of the parenthesised
    /// pattern list, in left-to-right order.
    pub pattern: Vec<Node>,
    /// The clause body, which may contain recursive references to the
    /// declared name.
    pub body: Node,
}

/// Optional measure attached to a `(define …)` declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefineMeasure {
    /// Lexicographic measure: the listed argument indices (0-based) must
    /// strictly decrease in the standard left-to-right lexicographic order
    /// on every recursive call.
    Lex(Vec<usize>),
}

/// A parsed `(define <name> [(measure …)] (case …) …)` declaration.
#[derive(Debug, Clone, PartialEq)]
pub struct DefineDecl {
    /// Definition name.
    pub name: String,
    /// Optional explicit measure. When `None`, the termination checker
    /// uses the default rule: structural decrease on the first argument.
    pub measure: Option<DefineMeasure>,
    /// Ordered list of `(case …)` clauses.
    pub clauses: Vec<DefineClause>,
}

/// A parsed `(coinductive Name (constructor …) …)` declaration. Mirrors
/// [`InductiveDecl`] but additionally guarantees the productivity check
/// (at least one recursive constructor) has succeeded.
#[derive(Debug, Clone)]
pub struct CoinductiveDecl {
    /// Coinductive type name (must start with an uppercase letter).
    pub name: String,
    /// Ordered list of declared constructors.
    pub constructors: Vec<ConstructorDecl>,
    /// Generated corecursor name (`Name-corec`).
    pub corec_name: String,
    /// Generated corecursor's dependent Pi-type.
    pub corec_type: Node,
}

/// Per-argument mode flag for a relation declared via `(mode …)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModeFlag {
    /// `+input`: caller must supply a ground argument here.
    In,
    /// `-output`: the relation is expected to produce a value here.
    Out,
    /// `*either`: no directionality constraint.
    Either,
}

impl ModeFlag {
    pub fn from_token(token: &str) -> Option<Self> {
        match token {
            "+input" => Some(ModeFlag::In),
            "-output" => Some(ModeFlag::Out),
            "*either" => Some(ModeFlag::Either),
            _ => None,
        }
    }
}

impl Env {
    pub fn new(options: Option<EnvOptions>) -> Self {
        let opts = options.unwrap_or_default();
        let mut ops = HashMap::new();
        ops.insert("not".to_string(), Op::Not);
        ops.insert("and".to_string(), Op::Agg(Aggregator::Avg));
        ops.insert("or".to_string(), Op::Agg(Aggregator::Max));
        // Belnap operators: AND-altering operators for four-valued logic
        // "both" (gullibility): avg — contradiction resolves to midpoint
        // "neither" (consensus): product — gap resolves to zero (no info propagates)
        // See: https://en.wikipedia.org/wiki/Four-valued_logic#Belnap
        ops.insert("both".to_string(), Op::Agg(Aggregator::Avg));
        ops.insert("neither".to_string(), Op::Agg(Aggregator::Prod));
        ops.insert("=".to_string(), Op::Eq);
        ops.insert("!=".to_string(), Op::Neq);
        ops.insert("+".to_string(), Op::Add);
        ops.insert("-".to_string(), Op::Sub);
        ops.insert("*".to_string(), Op::Mul);
        ops.insert("/".to_string(), Op::Div);
        ops.insert("<".to_string(), Op::Less);
        ops.insert("<=".to_string(), Op::LessOrEqual);

        let mut env = Self {
            terms: HashSet::new(),
            assign: HashMap::new(),
            symbol_prob: HashMap::new(),
            lo: opts.lo,
            hi: opts.hi,
            valence: opts.valence,
            ops,
            types: HashMap::new(),
            lambdas: HashMap::new(),
            templates: HashMap::new(),
            trace_enabled: false,
            trace_events: Vec::new(),
            current_span: None,
            default_span: Span::unknown(),
            namespace: None,
            aliases: HashMap::new(),
            imported: HashSet::new(),
            shadow_diagnostics: Vec::new(),
            file_namespaces: HashMap::new(),
            modes: HashMap::new(),
            relations: HashMap::new(),
            worlds: HashMap::new(),
            inductives: HashMap::new(),
            definitions: HashMap::new(),
            coinductives: HashMap::new(),
            domain_plugins: HashMap::new(),
            automatic_sequence_decisions: HashMap::new(),
            root_constructs: HashMap::new(),
            foundations: HashMap::new(),
            active_foundation: "default-rml".to_string(),
            foundation_stack: Vec::new(),
            active_implementations: HashMap::new(),
            strict_carrier: false,
            carrier: None,
            carrier_label: None,
            proof_rules: HashMap::new(),
            proof_assumptions: HashMap::new(),
            proof_objects: HashMap::new(),
            strict_pure_links: false,
            allowed_host_primitives: HashSet::new(),
        };

        // Initialize truth constants: true, false, unknown, undefined
        // These are predefined symbol probabilities based on the current range.
        // By default: (false: min(range)), (true: max(range)),
        //             (unknown: mid(range)), (undefined: mid(range))
        // They can be redefined by the user via (true: <value>), (false: <value>), etc.
        env.init_truth_constants();
        env.register_domain_plugin("automatic-sequences", automatic_sequences_domain_plugin);
        env.register_default_foundation();
        env
    }

    /// Midpoint of the range.
    pub fn mid(&self) -> f64 {
        (self.lo + self.hi) / 2.0
    }

    /// Initialize truth constants based on current range.
    /// (false: min(range)), (true: max(range)),
    /// (unknown: mid(range)), (undefined: mid(range))
    pub fn init_truth_constants(&mut self) {
        self.symbol_prob.insert("true".to_string(), self.hi);
        self.symbol_prob.insert("false".to_string(), self.lo);
        let mid = self.mid();
        self.symbol_prob.insert("unknown".to_string(), mid);
        self.symbol_prob.insert("undefined".to_string(), mid);
        // Note: "both" and "neither" are operators (not constants) — see Env::new()
        // See: https://en.wikipedia.org/wiki/Four-valued_logic#Belnap
    }

    /// Clamp and optionally quantize a value to the valid range.
    pub fn clamp(&self, x: f64) -> f64 {
        let clamped = x.max(self.lo).min(self.hi);
        if self.valence >= 2 {
            quantize(clamped, self.valence, self.lo, self.hi)
        } else {
            clamped
        }
    }

    /// Parse a numeric string respecting current range.
    pub fn to_num(&self, s: &str) -> f64 {
        self.clamp(s.parse::<f64>().unwrap_or(0.0))
    }

    pub fn define_op(&mut self, name: &str, op: Op) {
        self.ops.insert(name.to_string(), op);
    }

    pub fn register_domain_plugin(&mut self, name: &str, plugin: DomainPluginFn) {
        self.domain_plugins.insert(name.to_string(), plugin);
    }

    pub fn get_domain_plugin(&self, name: &str) -> Option<DomainPluginFn> {
        self.domain_plugins.get(name).copied()
    }

    // ---------- Foundation / root-construct registry (issue #97) ----------
    /// Preregister the `default-rml` foundation and seed the built-in
    /// root-construct descriptors that describe the current host
    /// implementation. These are data-only and never change behaviour.
    pub fn register_default_foundation(&mut self) {
        let default = FoundationDescriptor {
            name: "default-rml".to_string(),
            description: Some(
                "Default RML foundation: host-implemented configurable kernel".to_string(),
            ),
            uses: Vec::new(),
            defines: Vec::new(),
            extends: None,
            numeric_domain: Some("decimal-12".to_string()),
            truth_domain: Some("default-truth".to_string()),
            carrier: Vec::new(),
            strict_carrier: false,
            truth_tables: Vec::new(),
            experimental: false,
            root: None,
            abits: Vec::new(),
        };
        self.foundations.insert(default.name.clone(), default);
        // Pre-seed the experimental MTC/anum foundation (issue #97, Phase
        // 9). Opt-in only — never activated implicitly. Selecting it via
        // `(with-foundation mtc-anum ...)` does NOT rewire host arithmetic;
        // it is descriptive metadata plus a serialization alphabet.
        let mtc_anum = FoundationDescriptor {
            name: "mtc-anum".to_string(),
            description: Some(
                "experimental metatheory-of-links foundation (anum serialization)".to_string(),
            ),
            uses: Vec::new(),
            defines: Vec::new(),
            extends: None,
            numeric_domain: None,
            truth_domain: Some("mtc-abits".to_string()),
            carrier: Vec::new(),
            strict_carrier: false,
            truth_tables: Vec::new(),
            experimental: true,
            root: Some("∞".to_string()),
            abits: vec![
                ("[".to_string(), "start-of-meaning".to_string()),
                ("]".to_string(), "end-of-meaning".to_string()),
                ("1".to_string(), "unit-of-meaning".to_string()),
                ("0".to_string(), "zero-of-meaning".to_string()),
            ],
        };
        self.foundations.insert(mtc_anum.name.clone(), mtc_anum);
        let boolean_links = FoundationDescriptor {
            name: "boolean-links".to_string(),
            description: Some(
                "links-defined two-valued Boolean logic via finite truth tables".to_string(),
            ),
            uses: Vec::new(),
            defines: Vec::new(),
            extends: None,
            numeric_domain: Some("boolean-zero-one".to_string()),
            truth_domain: Some("boolean-two-valued".to_string()),
            carrier: vec!["0".to_string(), "1".to_string()],
            strict_carrier: true,
            truth_tables: vec![
                (
                    "and".to_string(),
                    vec![
                        TruthTableRow {
                            inputs: vec!["1".to_string(), "1".to_string()],
                            output: "1".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["1".to_string(), "0".to_string()],
                            output: "0".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["0".to_string(), "1".to_string()],
                            output: "0".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["0".to_string(), "0".to_string()],
                            output: "0".to_string(),
                        },
                    ],
                ),
                (
                    "or".to_string(),
                    vec![
                        TruthTableRow {
                            inputs: vec!["1".to_string(), "1".to_string()],
                            output: "1".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["1".to_string(), "0".to_string()],
                            output: "1".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["0".to_string(), "1".to_string()],
                            output: "1".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["0".to_string(), "0".to_string()],
                            output: "0".to_string(),
                        },
                    ],
                ),
                (
                    "not".to_string(),
                    vec![
                        TruthTableRow {
                            inputs: vec!["1".to_string()],
                            output: "0".to_string(),
                        },
                        TruthTableRow {
                            inputs: vec!["0".to_string()],
                            output: "1".to_string(),
                        },
                    ],
                ),
            ],
            experimental: false,
            root: None,
            abits: Vec::new(),
        };
        self.foundations
            .insert(boolean_links.name.clone(), boolean_links);
        // Pre-seed the links-defined typed-kernel foundation (issue #97,
        // Phase 5). Selecting it via
        // `(with-foundation typed-kernel-links ...)` records the proof
        // substrate rules `pi-formation`, `lambda-introduction`,
        // `application-elimination`, and `beta-conversion` as the
        // canonical links-defined replacements for the host kernel's
        // typing judgements. Evaluation still runs through the host kernel;
        // the foundation is selected so the trust audit can list the four
        // rules as the active derivations.
        let typed_kernel_links = FoundationDescriptor {
            name: "typed-kernel-links".to_string(),
            description: Some(
                "links-defined typed-kernel fragment (Pi/lambda/apply/beta as proof rules)"
                    .to_string(),
            ),
            uses: vec![
                "pi-formation".to_string(),
                "lambda-introduction".to_string(),
                "application-elimination".to_string(),
                "beta-conversion".to_string(),
            ],
            defines: Vec::new(),
            extends: Some("default-rml".to_string()),
            numeric_domain: Some("decimal-12".to_string()),
            truth_domain: Some("default-truth".to_string()),
            carrier: Vec::new(),
            strict_carrier: false,
            truth_tables: Vec::new(),
            experimental: false,
            root: None,
            abits: Vec::new(),
        };
        self.foundations
            .insert(typed_kernel_links.name.clone(), typed_kernel_links);
        // Pre-seed the links-defined Peano naturals foundation (issue #97,
        // Phase 12). Selecting it via `(with-foundation nat-links ...)`
        // records the Nat proof-substrate rules, the dedicated `nat-equality`
        // layer, and the rule-driven `eval-nat` normalizer as active
        // foundation dependencies. The host's decimal numeric domain and
        // default equality layers are unaffected.
        let nat_links = FoundationDescriptor {
            name: "nat-links".to_string(),
            description: Some(
                "links-defined Peano naturals (zero/succ formation, add by recursion, induction with explicit forall/implication/predicate-application, nat-equality with reflexivity and successor congruence, nat-recursion/nat-eliminator, multiplication, rule-driven eval-nat normalizer)"
                    .to_string(),
            ),
            uses: vec![
                "nat-zero-formation".to_string(),
                "nat-succ-formation".to_string(),
                "nat-add-zero".to_string(),
                "nat-add-succ".to_string(),
                "nat-induction".to_string(),
                "nat-equality".to_string(),
                "nat-refl".to_string(),
                "nat-cong-succ".to_string(),
                "forall".to_string(),
                "implication".to_string(),
                "predicate-application".to_string(),
                "nat-recursion".to_string(),
                "nat-eliminator".to_string(),
                "nat-rec-zero".to_string(),
                "nat-rec-succ".to_string(),
                "mul".to_string(),
                "nat-mul-zero".to_string(),
                "nat-mul-succ".to_string(),
                "eval-nat-normalize".to_string(),
                "eval-nat".to_string(),
                "nat-normal-form-to-host-number".to_string(),
            ],
            defines: Vec::new(),
            extends: Some("default-rml".to_string()),
            numeric_domain: Some("decimal-12".to_string()),
            truth_domain: Some("default-truth".to_string()),
            carrier: Vec::new(),
            strict_carrier: false,
            truth_tables: Vec::new(),
            experimental: false,
            root: None,
            abits: Vec::new(),
        };
        self.foundations
            .insert(nat_links.name.clone(), nat_links);
        seed_builtin_root_constructs(self);
    }

    pub fn register_root_construct(
        &mut self,
        descriptor: RootConstructDescriptor,
    ) -> Result<RootConstructDescriptor, String> {
        if descriptor.name.is_empty() {
            return Err("root-construct descriptor requires a name".to_string());
        }
        let prev = self.root_constructs.get(&descriptor.name).cloned();
        let merged = merge_root_construct_descriptors(prev, descriptor);
        self.root_constructs
            .insert(merged.name.clone(), merged.clone());
        Ok(merged)
    }

    pub fn get_root_construct(&self, name: &str) -> Option<&RootConstructDescriptor> {
        self.root_constructs.get(name)
    }

    pub fn list_root_constructs(&self) -> Vec<RootConstructDescriptor> {
        let mut v: Vec<RootConstructDescriptor> = self.root_constructs.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    pub fn register_foundation(
        &mut self,
        foundation: FoundationDescriptor,
    ) -> Result<FoundationDescriptor, String> {
        if foundation.name.is_empty() {
            return Err("foundation declaration requires a name".to_string());
        }
        let prev = self.foundations.get(&foundation.name).cloned();
        let merged = merge_foundation_descriptors(prev, foundation);
        self.foundations.insert(merged.name.clone(), merged.clone());
        Ok(merged)
    }

    pub fn get_foundation(&self, name: &str) -> Option<&FoundationDescriptor> {
        self.foundations.get(name)
    }

    pub fn enter_foundation(&mut self, name: &str) -> Result<(), String> {
        let foundation = match self.foundations.get(name) {
            Some(f) => f.clone(),
            None => return Err(format!("Unknown foundation: {}", name)),
        };
        // Snapshot the operators that this foundation rebinds so
        // `exit_foundation` can restore them. Only `(defines <op> <agg>)`
        // entries that name a known truth aggregator are applied (avg, min,
        // max, product, probabilistic_sum); other entries are data-only.
        let mut snapshot: Vec<(String, Option<Op>)> = Vec::new();
        let mut previous_active_implementations: Vec<(
            String,
            Option<ActiveImplementationDescriptor>,
        )> = Vec::new();
        let snapshot_impl = |env: &Env,
                             store: &mut Vec<(String, Option<ActiveImplementationDescriptor>)>,
                             op_name: &str| {
            if store.iter().any(|(n, _)| n == op_name) {
                return;
            }
            store.push((
                op_name.to_string(),
                env.active_implementations.get(op_name).cloned(),
            ));
        };
        for (op_name, impl_name) in &foundation.defines {
            if let Some(agg) = Aggregator::from_name(impl_name) {
                snapshot_impl(self, &mut previous_active_implementations, op_name);
                let prev = self.ops.get(op_name).cloned();
                snapshot.push((op_name.clone(), prev));
                self.ops.insert(op_name.clone(), Op::Agg(agg));
                self.active_implementations.insert(
                    op_name.clone(),
                    ActiveImplementationDescriptor {
                        construct: op_name.clone(),
                        foundation: Some(name.to_string()),
                        implementation: Some(impl_name.clone()),
                        status: Some("host-primitive".to_string()),
                        semantic_status: Some("host-trusted".to_string()),
                        depends_on: vec![impl_name.clone()],
                    },
                );
            }
        }
        // Truth tables (issue #97, Section 3 of netkeep80's punch-list).
        // Layered on top of `(defines ...)` so a foundation can pin a
        // finite slice of an operator and let the aggregator-based default
        // handle the rest.
        for (op_name, rows) in &foundation.truth_tables {
            let mut resolved: Vec<TruthTableEntry> = Vec::new();
            for row in rows {
                let mut inputs: Vec<f64> = Vec::with_capacity(row.inputs.len());
                let mut row_ok = true;
                for tok in &row.inputs {
                    match resolve_truth_table_value(self, tok) {
                        Some(v) => inputs.push(v),
                        None => {
                            row_ok = false;
                            break;
                        }
                    }
                }
                if !row_ok {
                    continue;
                }
                let output = match resolve_truth_table_value(self, &row.output) {
                    Some(v) => v,
                    None => continue,
                };
                resolved.push(TruthTableEntry { inputs, output });
            }
            if resolved.is_empty() {
                continue;
            }
            if !snapshot.iter().any(|(n, _)| n == op_name) {
                let prev = self.ops.get(op_name).cloned();
                snapshot.push((op_name.clone(), prev));
            }
            snapshot_impl(self, &mut previous_active_implementations, op_name);
            let previous_impl = self.active_implementations.get(op_name).cloned();
            let is_total = truth_table_rows_complete_for_carrier(self, rows, &foundation);
            let depends_on = if is_total {
                Vec::new()
            } else {
                truth_table_fallback_dependencies(self, op_name, previous_impl.as_ref())
            };
            let fallback = self.ops.get(op_name).cloned().map(Box::new);
            self.ops.insert(
                op_name.clone(),
                Op::TruthTable {
                    rows: resolved,
                    fallback,
                },
            );
            self.active_implementations.insert(
                op_name.clone(),
                ActiveImplementationDescriptor {
                    construct: op_name.clone(),
                    foundation: Some(name.to_string()),
                    implementation: Some(format!("truth-table:{}/{}", name, op_name)),
                    status: Some("links-defined".to_string()),
                    semantic_status: Some("links-checked".to_string()),
                    depends_on,
                },
            );
        }
        // Carrier snapshot for opt-in enforcement (issue #97, Section 2).
        // `strict_carrier` is what the evaluator hot path checks; `carrier`
        // is the resolved numeric set. Symbolic carrier values (`true`,
        // `false`, `unknown`, ...) resolve through `symbol_prob` so
        // user-defined truth constants flow in.
        let previous_strict_carrier = self.strict_carrier;
        let previous_carrier = self.carrier.clone();
        let previous_carrier_label = self.carrier_label.clone();
        if foundation.strict_carrier && !foundation.carrier.is_empty() {
            let mut resolved: Vec<f64> = Vec::new();
            for tok in &foundation.carrier {
                if let Ok(num) = tok.parse::<f64>() {
                    if num.is_finite() {
                        resolved.push(num);
                        continue;
                    }
                }
                if let Some(p) = self.symbol_prob.get(tok) {
                    resolved.push(*p);
                }
            }
            self.strict_carrier = true;
            self.carrier = Some(resolved);
            self.carrier_label = Some(foundation.carrier.join(" "));
        }
        let frame = FoundationFrame {
            previous_active: std::mem::take(&mut self.active_foundation),
            snapshot,
            previous_active_implementations,
            previous_strict_carrier,
            previous_carrier,
            previous_carrier_label,
        };
        self.foundation_stack.push(frame);
        self.active_foundation = name.to_string();
        Ok(())
    }

    pub fn exit_foundation(&mut self) {
        if let Some(frame) = self.foundation_stack.pop() {
            for (op_name, prev) in frame.snapshot.into_iter().rev() {
                match prev {
                    Some(op) => {
                        self.ops.insert(op_name, op);
                    }
                    None => {
                        self.ops.remove(&op_name);
                    }
                }
            }
            for (op_name, prev) in frame.previous_active_implementations.into_iter().rev() {
                match prev {
                    Some(implementation) => {
                        self.active_implementations.insert(op_name, implementation);
                    }
                    None => {
                        self.active_implementations.remove(&op_name);
                    }
                }
            }
            self.active_foundation = frame.previous_active;
            self.strict_carrier = frame.previous_strict_carrier;
            self.carrier = frame.previous_carrier;
            self.carrier_label = frame.previous_carrier_label;
        } else {
            self.active_foundation = "default-rml".to_string();
            self.active_implementations.clear();
            self.strict_carrier = false;
            self.carrier = None;
            self.carrier_label = None;
        }
    }

    /// Check `value` against the active foundation's carrier. Returns `None`
    /// when the carrier is inactive or the value is legal, or a
    /// human-readable message otherwise (consumed by the caller to build an
    /// `E063` diagnostic). Mirrors the JS `Env.checkCarrierValue` helper.
    pub fn check_carrier_value(&self, value: f64) -> Option<String> {
        if !self.strict_carrier {
            return None;
        }
        let carrier = self.carrier.as_ref()?;
        if carrier.is_empty() {
            return None;
        }
        if !value.is_finite() {
            return None;
        }
        if carrier.iter().any(|c| (*c - value).abs() < 1e-12) {
            return None;
        }
        let mut sorted = carrier.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let allowed: Vec<String> = sorted.iter().map(|v| format_trace_value(*v)).collect();
        Some(format!(
            "value {} is not in active carrier {{{}}}",
            format_trace_value(value),
            allowed.join(", ")
        ))
    }

    pub fn foundation_report(&self) -> FoundationReport {
        let active = if self.active_foundation.is_empty() {
            "default-rml".to_string()
        } else {
            self.active_foundation.clone()
        };
        let foundation = self.foundations.get(&active).cloned();
        let mut constructs = self.list_root_constructs();
        for rc in &mut constructs {
            if rc.semantic_status.is_none() {
                rc.semantic_status = semantic_status_for_trust_status(rc.status.as_deref());
            }
        }
        let mut by_status_map: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        let mut by_semantic_status_map: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        for rc in &constructs {
            let key = rc.status.clone().unwrap_or_else(|| "unknown".to_string());
            by_status_map.entry(key).or_default().push(rc.name.clone());
            let semantic_key =
                semantic_status_for_descriptor(rc).unwrap_or_else(|| "unknown".to_string());
            by_semantic_status_map
                .entry(semantic_key)
                .or_default()
                .push(rc.name.clone());
        }
        for v in by_status_map.values_mut() {
            v.sort();
        }
        for v in by_semantic_status_map.values_mut() {
            v.sort();
        }
        let by_status: Vec<(String, Vec<String>)> = by_status_map.into_iter().collect();
        let by_semantic_status: Vec<(String, Vec<String>)> =
            by_semantic_status_map.into_iter().collect();
        let mut foundations: Vec<FoundationDescriptor> =
            self.foundations.values().cloned().collect();
        foundations.sort_by(|a, b| a.name.cmp(&b.name));
        let mut active_implementations: Vec<ActiveImplementationDescriptor> =
            self.active_implementations.values().cloned().collect();
        for implementation in &mut active_implementations {
            if implementation.semantic_status.is_none() {
                implementation.semantic_status =
                    semantic_status_for_trust_status(implementation.status.as_deref());
            }
        }
        active_implementations.sort_by(|a, b| a.construct.cmp(&b.construct));
        let mut proof_rules: Vec<ProofRuleSnapshot> = self
            .proof_rules
            .values()
            .map(|r| ProofRuleSnapshot {
                name: r.name.clone(),
                premises: r.premises.iter().map(key_of).collect(),
                conclusion: key_of(&r.conclusion),
            })
            .collect();
        proof_rules.sort_by(|a, b| a.name.cmp(&b.name));
        let mut proof_assumptions: Vec<ProofAssumptionSnapshot> = self
            .proof_assumptions
            .values()
            .map(|a| ProofAssumptionSnapshot {
                name: a.name.clone(),
                kind: a.kind.clone(),
                judgement: key_of(&a.judgement),
            })
            .collect();
        proof_assumptions.sort_by(|a, b| a.name.cmp(&b.name));
        let mut proof_objects: Vec<ProofObjectSnapshot> = self
            .proof_objects
            .values()
            .map(|po| ProofObjectSnapshot {
                name: po.name.clone(),
                rule: po.rule.clone(),
                premises: po.premises.iter().map(key_of).collect(),
                premise_refs: po.premise_refs.clone(),
                conclusion: key_of(&po.conclusion),
            })
            .collect();
        proof_objects.sort_by(|a, b| a.name.cmp(&b.name));
        let mut allowed: Vec<String> = self.allowed_host_primitives.iter().cloned().collect();
        allowed.sort();
        let dependency_graph = build_dependency_graph(self);
        FoundationReport {
            active_foundation: active,
            description: foundation.as_ref().and_then(|f| f.description.clone()),
            numeric_domain: foundation.as_ref().and_then(|f| f.numeric_domain.clone()),
            truth_domain: foundation.as_ref().and_then(|f| f.truth_domain.clone()),
            root_constructs: constructs,
            by_status,
            by_semantic_status,
            foundations,
            active_implementations,
            proof_rules,
            proof_assumptions,
            proof_objects,
            strict_pure_links: self.strict_pure_links,
            allowed_host_primitives: allowed,
            dependency_graph,
        }
    }

    /// Build a per-proof report (issue #97, Phase 13). Walks the proof
    /// object tree starting at `name`, collects the transitive
    /// dependencies (proof-objects, axioms, assumptions) and the
    /// registered root constructs that appear as leaf operators in the
    /// proof's premises/conclusion and in the rule patterns it
    /// transitively applies. Returns the report in all cases — when the
    /// proof object is missing, `verdict.ok` is `false`.
    pub fn proof_report(&self, name: &str) -> ProofReport {
        let active = if self.active_foundation.is_empty() {
            "default-rml".to_string()
        } else {
            self.active_foundation.clone()
        };
        if name.is_empty() {
            return ProofReport {
                name: String::new(),
                rule: None,
                conclusion: None,
                premises: Vec::new(),
                premise_refs: Vec::new(),
                verdict: ProofReportVerdict {
                    ok: false,
                    error: Some("proof name required".to_string()),
                },
                dependencies: Vec::new(),
                rules: Vec::new(),
                root_constructs_used: Vec::new(),
                by_semantic_status: Vec::new(),
                by_trust_status: Vec::new(),
                active_foundation: active,
                strict_pure_links: self.strict_pure_links,
            };
        }
        let po = match self.get_proof_object(name) {
            Some(po) => po.clone(),
            None => {
                return ProofReport {
                    name: name.to_string(),
                    rule: None,
                    conclusion: None,
                    premises: Vec::new(),
                    premise_refs: Vec::new(),
                    verdict: ProofReportVerdict {
                        ok: false,
                        error: Some(format!("unknown proof-object {}", name)),
                    },
                    dependencies: Vec::new(),
                    rules: Vec::new(),
                    root_constructs_used: Vec::new(),
                    by_semantic_status: Vec::new(),
                    by_trust_status: Vec::new(),
                    active_foundation: active,
                    strict_pure_links: self.strict_pure_links,
                };
            }
        };
        let verdict = check_proof_object(self, name);
        let verdict = match verdict {
            CheckProofVerdict::Ok(_) => ProofReportVerdict {
                ok: true,
                error: None,
            },
            CheckProofVerdict::Err(msg) => ProofReportVerdict {
                ok: false,
                error: Some(msg),
            },
        };
        let mut dependencies: Vec<ProofReportDependency> = Vec::new();
        let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut rules: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut stack: Vec<String> = po.premise_refs.iter().cloned().rev().collect();
        while let Some(refname) = stack.pop() {
            if seen.contains(&refname) {
                continue;
            }
            seen.insert(refname.clone());
            if let Some(ax) = self.get_proof_assumption(&refname) {
                dependencies.push(ProofReportDependency {
                    name: ax.name.clone(),
                    kind: ax.kind.clone(),
                    rule: None,
                    judgement: Some(key_of(&ax.judgement)),
                });
                continue;
            }
            if let Some(dep) = self.get_proof_object(&refname) {
                for sub in dep.premise_refs.iter().rev() {
                    stack.push(sub.clone());
                }
                if !dep.rule.is_empty() {
                    rules.insert(dep.rule.clone());
                }
                dependencies.push(ProofReportDependency {
                    name: dep.name.clone(),
                    kind: "proof-object".to_string(),
                    rule: Some(dep.rule.clone()),
                    judgement: Some(key_of(&dep.conclusion)),
                });
                continue;
            }
            dependencies.push(ProofReportDependency {
                name: refname.clone(),
                kind: "unknown".to_string(),
                rule: None,
                judgement: None,
            });
        }
        if !po.rule.is_empty() {
            rules.insert(po.rule.clone());
        }
        let mut root_names: std::collections::BTreeSet<String> = [
            "proof-replay",
            "structural-equality",
            "structural-matcher",
            "substitution",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        fn collect_terms(
            node: &Node,
            registry: &std::collections::HashMap<String, RootConstructDescriptor>,
            into: &mut std::collections::BTreeSet<String>,
        ) {
            match node {
                Node::Leaf(s) => {
                    if registry.contains_key(s) {
                        into.insert(s.clone());
                    }
                }
                Node::List(children) => {
                    for child in children {
                        collect_terms(child, registry, into);
                    }
                }
            }
        }
        collect_terms(&po.conclusion, &self.root_constructs, &mut root_names);
        for prem in &po.premises {
            collect_terms(prem, &self.root_constructs, &mut root_names);
        }
        for rule_name in &rules {
            if let Some(rule) = self.get_proof_rule(rule_name) {
                collect_terms(&rule.conclusion, &self.root_constructs, &mut root_names);
                for prem in &rule.premises {
                    collect_terms(prem, &self.root_constructs, &mut root_names);
                }
            }
        }
        let root_constructs_used: Vec<String> = root_names.into_iter().collect();
        let mut by_semantic_status_map: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        let mut by_trust_status_map: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        for rc_name in &root_constructs_used {
            if let Some(rc) = self.root_constructs.get(rc_name) {
                let semantic =
                    semantic_status_for_descriptor(rc).unwrap_or_else(|| "unknown".to_string());
                let trust = rc.status.clone().unwrap_or_else(|| "unknown".to_string());
                by_semantic_status_map
                    .entry(semantic)
                    .or_default()
                    .push(rc_name.clone());
                by_trust_status_map
                    .entry(trust)
                    .or_default()
                    .push(rc_name.clone());
            }
        }
        for v in by_semantic_status_map.values_mut() {
            v.sort();
        }
        for v in by_trust_status_map.values_mut() {
            v.sort();
        }
        ProofReport {
            name: name.to_string(),
            rule: Some(po.rule.clone()),
            conclusion: Some(key_of(&po.conclusion)),
            premises: po.premises.iter().map(key_of).collect(),
            premise_refs: po.premise_refs.clone(),
            verdict,
            dependencies,
            rules: rules.into_iter().collect(),
            root_constructs_used,
            by_semantic_status: by_semantic_status_map.into_iter().collect(),
            by_trust_status: by_trust_status_map.into_iter().collect(),
            active_foundation: active,
            strict_pure_links: self.strict_pure_links,
        }
    }

    /// Return the transitive closure of a construct's dependencies,
    /// breadth-first and deterministically sorted at every level.
    /// Missing intermediate deps are silently retained (so a downstream
    /// caller can detect dangling names by intersecting against
    /// `root_constructs.keys()`). Returns `None` if the root itself is
    /// unknown.
    pub fn dependency_closure(&self, name: &str) -> Option<Vec<String>> {
        if name.is_empty() {
            return None;
        }
        if !self.root_constructs.contains_key(name) {
            return None;
        }
        Some(closure_for(self, name))
    }

    /// Register a declared rule of inference. Data-only.
    pub fn register_proof_rule(&mut self, rule: ProofRule) {
        self.proof_rules.insert(rule.name.clone(), rule);
    }

    /// Register an explicit proof assumption/axiom. Data-only; proof objects
    /// cite these leaves via `(premise-by <name>)` or `(uses <name>...)`.
    pub fn register_proof_assumption(&mut self, assumption: ProofAssumption) {
        self.proof_assumptions
            .insert(assumption.name.clone(), assumption);
    }

    /// Register a concrete derivation. Data-only; verification runs lazily
    /// when `(check-proof <name>)` evaluates.
    pub fn register_proof_object(&mut self, po: ProofObject) {
        self.proof_objects.insert(po.name.clone(), po);
    }

    pub fn get_proof_rule(&self, name: &str) -> Option<&ProofRule> {
        self.proof_rules.get(name)
    }

    pub fn get_proof_assumption(&self, name: &str) -> Option<&ProofAssumption> {
        self.proof_assumptions.get(name)
    }

    pub fn get_proof_object(&self, name: &str) -> Option<&ProofObject> {
        self.proof_objects.get(name)
    }

    pub fn get_op(&self, name: &str) -> Option<&Op> {
        if let Some(op) = self.ops.get(name) {
            return Some(op);
        }
        let resolved = self.resolve_qualified(name);
        if resolved != name {
            return self.ops.get(&resolved);
        }
        None
    }

    pub fn has_op(&self, name: &str) -> bool {
        if self.ops.contains_key(name) {
            return true;
        }
        let resolved = self.resolve_qualified(name);
        resolved != name && self.ops.contains_key(&resolved)
    }

    /// Apply the active namespace to a freshly declared name, e.g. inside
    /// `(namespace classical)` the form `(and: min)` registers `classical.and`,
    /// not `and`. Names that already contain a `.` are passed through.
    /// Mirrors `Env.qualifyName` in `js/src/rml-links.mjs`.
    pub fn qualify_name(&self, name: &str) -> String {
        if let Some(ns) = &self.namespace {
            if !name.contains('.') {
                return format!("{}.{}", ns, name);
            }
        }
        name.to_string()
    }

    /// Resolve a possibly-qualified name to its canonical storage key. Order:
    ///   1. Alias prefix: `cl.foo` with alias `cl -> classical` becomes
    ///      `classical.foo`.
    ///   2. Active namespace: an unqualified name lives in `<ns>.<name>`.
    ///   3. Bare name: returned unchanged.
    /// Used by lookup helpers (operators, symbol probabilities) to find
    /// namespaced bindings without forcing every call site to spell them out.
    /// Mirrors `Env._resolveQualified` in `js/src/rml-links.mjs`.
    pub fn resolve_qualified(&self, name: &str) -> String {
        if let Some(dot_idx) = name.find('.') {
            if dot_idx > 0 {
                let prefix = &name[..dot_idx];
                let rest = &name[dot_idx + 1..];
                if let Some(target_ns) = self.aliases.get(prefix) {
                    return format!("{}.{}", target_ns, rest);
                }
            }
            return name.to_string();
        }
        if let Some(ns) = &self.namespace {
            let qualified = format!("{}.{}", ns, name);
            if self.ops.contains_key(&qualified)
                || self.symbol_prob.contains_key(&qualified)
                || self.terms.contains(&qualified)
                || self.types.contains_key(&qualified)
                || self.lambdas.contains_key(&qualified)
                || self.templates.contains_key(&qualified)
            {
                return qualified;
            }
        }
        name.to_string()
    }

    pub fn set_expr_prob(&mut self, expr_node: &Node, p: f64) {
        self.assign.insert(key_of(expr_node), self.clamp(p));
    }

    pub fn set_symbol_prob(&mut self, sym: &str, p: f64) {
        self.symbol_prob.insert(sym.to_string(), self.clamp(p));
    }

    pub fn get_symbol_prob(&self, sym: &str) -> f64 {
        if let Some(&v) = self.symbol_prob.get(sym) {
            return v;
        }
        let resolved = self.resolve_qualified(sym);
        if resolved != sym {
            if let Some(&v) = self.symbol_prob.get(&resolved) {
                return v;
            }
        }
        self.mid()
    }

    /// Push a trace event when tracing is enabled. The event's span is taken
    /// from `current_span` if set, else `default_span`. Mirrors `Env.trace`
    /// in the JavaScript implementation.
    pub fn trace(&mut self, kind: &str, detail: impl Into<String>) {
        if !self.trace_enabled {
            return;
        }
        let span = self
            .current_span
            .clone()
            .unwrap_or_else(|| self.default_span.clone());
        self.trace_events.push(TraceEvent::new(kind, detail, span));
    }

    pub fn set_type(&mut self, expr: &str, type_expr: &str) {
        self.types.insert(expr.to_string(), type_expr.to_string());
    }

    pub fn get_type(&self, expr: &str) -> Option<&String> {
        if let Some(recorded) = self.types.get(expr) {
            return Some(recorded);
        }
        let resolved = self.resolve_qualified(expr);
        if resolved != expr {
            return self.types.get(&resolved);
        }
        None
    }

    pub fn set_lambda(&mut self, name: &str, lambda: Lambda) {
        self.lambdas.insert(name.to_string(), lambda);
    }

    pub fn get_lambda(&self, name: &str) -> Option<&Lambda> {
        if let Some(l) = self.lambdas.get(name) {
            return Some(l);
        }
        let resolved = self.resolve_qualified(name);
        if resolved != name {
            return self.lambdas.get(&resolved);
        }
        None
    }

    /// Apply an operator by name to the given values.
    pub fn apply_op(&self, name: &str, vals: &[f64]) -> f64 {
        let op = match self.ops.get(name) {
            Some(op) => op.clone(),
            None => {
                let resolved = self.resolve_qualified(name);
                if resolved != name {
                    match self.ops.get(&resolved) {
                        Some(op) => op.clone(),
                        None => panic!("Unknown op: {}", name),
                    }
                } else {
                    panic!("Unknown op: {}", name)
                }
            }
        };
        match op {
            Op::Not => {
                if vals.is_empty() {
                    self.lo
                } else {
                    self.hi - (vals[0] - self.lo)
                }
            }
            Op::Agg(agg) => dec_round(agg.apply(vals, self.lo)),
            Op::Eq | Op::Neq => self.lo,
            Op::Compose {
                ref outer,
                ref inner,
            } => {
                let inner_result = self.apply_op(inner, vals);
                self.apply_op(outer, &[inner_result])
            }
            Op::Add => {
                if vals.len() >= 2 {
                    dec_round(vals[0] + vals[1])
                } else {
                    0.0
                }
            }
            Op::Sub => {
                if vals.len() >= 2 {
                    dec_round(vals[0] - vals[1])
                } else {
                    0.0
                }
            }
            Op::Mul => {
                if vals.len() >= 2 {
                    dec_round(vals[0] * vals[1])
                } else {
                    0.0
                }
            }
            Op::Div => {
                if vals.len() >= 2 && vals[1] != 0.0 {
                    dec_round(vals[0] / vals[1])
                } else {
                    0.0
                }
            }
            Op::Less => {
                if vals.len() >= 2 && vals[0] < vals[1] {
                    self.hi
                } else {
                    self.lo
                }
            }
            Op::LessOrEqual => {
                if vals.len() >= 2 && vals[0] <= vals[1] {
                    self.hi
                } else {
                    self.lo
                }
            }
            Op::TruthTable {
                ref rows,
                ref fallback,
            } => {
                for row in rows {
                    if row.inputs.len() != vals.len() {
                        continue;
                    }
                    if row
                        .inputs
                        .iter()
                        .zip(vals.iter())
                        .all(|(a, b)| (*a - *b).abs() < 1e-12)
                    {
                        return row.output;
                    }
                }
                match fallback {
                    Some(prev) => self.apply_op_inner(prev, vals),
                    None => self.lo,
                }
            }
        }
    }

    /// Internal helper used by `Op::TruthTable` fallback dispatch so a
    /// table can delegate to a previously installed op without going
    /// through the name lookup path again.
    fn apply_op_inner(&self, op: &Op, vals: &[f64]) -> f64 {
        let owned = op.clone();
        match owned {
            Op::Not => {
                if vals.is_empty() {
                    self.lo
                } else {
                    self.hi - (vals[0] - self.lo)
                }
            }
            Op::Agg(agg) => dec_round(agg.apply(vals, self.lo)),
            Op::Eq | Op::Neq => self.lo,
            Op::Compose { outer, inner } => {
                let inner_result = self.apply_op(&inner, vals);
                self.apply_op(&outer, &[inner_result])
            }
            Op::Add => {
                if vals.len() >= 2 {
                    dec_round(vals[0] + vals[1])
                } else {
                    0.0
                }
            }
            Op::Sub => {
                if vals.len() >= 2 {
                    dec_round(vals[0] - vals[1])
                } else {
                    0.0
                }
            }
            Op::Mul => {
                if vals.len() >= 2 {
                    dec_round(vals[0] * vals[1])
                } else {
                    0.0
                }
            }
            Op::Div => {
                if vals.len() >= 2 && vals[1] != 0.0 {
                    dec_round(vals[0] / vals[1])
                } else {
                    0.0
                }
            }
            Op::Less => {
                if vals.len() >= 2 && vals[0] < vals[1] {
                    self.hi
                } else {
                    self.lo
                }
            }
            Op::LessOrEqual => {
                if vals.len() >= 2 && vals[0] <= vals[1] {
                    self.hi
                } else {
                    self.lo
                }
            }
            Op::TruthTable { rows, fallback } => {
                for row in &rows {
                    if row.inputs.len() != vals.len() {
                        continue;
                    }
                    if row
                        .inputs
                        .iter()
                        .zip(vals.iter())
                        .all(|(a, b)| (*a - *b).abs() < 1e-12)
                    {
                        return row.output;
                    }
                }
                match fallback {
                    Some(prev) => self.apply_op_inner(&prev, vals),
                    None => self.lo,
                }
            }
        }
    }

    /// Apply equality operator, checking assigned probabilities first.
    /// Takes `&mut self` so it can emit `lookup` trace events.
    pub fn apply_eq(&mut self, left: &Node, right: &Node) -> f64 {
        if let Some(value) = lookup_assigned_infix(self, "=", left, right) {
            return self.clamp(value);
        }
        let options = ConvertOptions::default();
        let left_term = normalize_term(left, self, options);
        let right_term = normalize_term(right, self, options);
        equality_truth_value(left, right, &left_term, &right_term, self, options)
    }

    /// Apply inequality operator: not(eq(L, R))
    pub fn apply_neq(&mut self, left: &Node, right: &Node) -> f64 {
        let eq_val = self.apply_eq(left, right);
        self.apply_op("not", &[eq_val])
    }

    /// Reinitialize ops when range changes (resets to defaults for current range).
    pub fn reinit_ops(&mut self) {
        self.ops.insert("not".to_string(), Op::Not);
        self.ops.insert("and".to_string(), Op::Agg(Aggregator::Avg));
        self.ops.insert("or".to_string(), Op::Agg(Aggregator::Max));
        self.ops
            .insert("both".to_string(), Op::Agg(Aggregator::Avg));
        self.ops
            .insert("neither".to_string(), Op::Agg(Aggregator::Prod));
        self.ops.insert("=".to_string(), Op::Eq);
        self.ops.insert("!=".to_string(), Op::Neq);
        self.ops.insert("+".to_string(), Op::Add);
        self.ops.insert("-".to_string(), Op::Sub);
        self.ops.insert("*".to_string(), Op::Mul);
        self.ops.insert("/".to_string(), Op::Div);
        self.ops.insert("<".to_string(), Op::Less);
        self.ops.insert("<=".to_string(), Op::LessOrEqual);
        // Re-initialize truth constants for new range
        self.init_truth_constants();
    }
}

// ========== Query Result ==========

/// Result of evaluating an expression: either a plain value or a query result.
#[derive(Debug, Clone)]
pub enum EvalResult {
    Value(f64),
    Query(f64),
    TypeQuery(String),
    Term(Node),
}

impl EvalResult {
    pub fn as_f64(&self) -> f64 {
        match self {
            EvalResult::Value(v) | EvalResult::Query(v) => *v,
            EvalResult::TypeQuery(_) | EvalResult::Term(_) => 0.0,
        }
    }

    pub fn is_query(&self) -> bool {
        matches!(self, EvalResult::Query(_) | EvalResult::TypeQuery(_))
    }

    pub fn is_type_query(&self) -> bool {
        matches!(self, EvalResult::TypeQuery(_))
    }

    pub fn type_string(&self) -> Option<&str> {
        match self {
            EvalResult::TypeQuery(s) => Some(s),
            _ => None,
        }
    }
}

// ========== Binding Parser ==========

/// Parse a binding form in two supported syntaxes:
/// 1. Colon form: (x: A) as ["x:", A] — standard LiNo link definition syntax
/// 2. Prefix type form: (A x) as ["A", "x"] — type-first notation for lambda/Pi bindings
///    e.g. (Natural x), used in (lambda (Natural x) body)
/// Returns (param_name, param_type_key) or None.
pub fn parse_binding(binding: &Node) -> Option<(String, String)> {
    if let Node::List(children) = binding {
        if children.len() == 2 {
            // Colon form: ["x:", A]
            if let Node::Leaf(ref s) = children[0] {
                if s.ends_with(':') {
                    let param_name = s[..s.len() - 1].to_string();
                    let param_type = match &children[1] {
                        Node::Leaf(s) => s.clone(),
                        other => key_of(other),
                    };
                    return Some((param_name, param_type));
                }
            }
            // Prefix type form: ["A", "x"] — type name first (must start with uppercase)
            if let (Node::Leaf(ref type_name), Node::Leaf(ref var_name)) =
                (&children[0], &children[1])
            {
                if type_name.starts_with(|c: char| c.is_uppercase()) && !var_name.ends_with(':') {
                    return Some((var_name.clone(), type_name.clone()));
                }
            }
            // Prefix complex-type form: [<list-type>, "x"] — type is a list expression
            // such as (Pi (A x) B) or (Type 0). Needed for higher-order parameters
            // (e.g. polymorphic apply / compose) where a parameter is itself function-typed.
            if let (Node::List(_), Node::Leaf(ref var_name)) = (&children[0], &children[1]) {
                if !var_name.ends_with(':') {
                    return Some((var_name.clone(), key_of(&children[0])));
                }
            }
        }
    }
    None
}

/// Parse comma-separated bindings: (Natural x, Natural y) → vec of (name, type) pairs.
/// Tokens arrive as ["Natural", "x,", "Natural", "y"] or ["Natural", "x"] (single binding).
pub fn parse_bindings(binding: &Node) -> Option<Vec<(String, String)>> {
    // Try single binding first
    if let Some(single) = parse_binding(binding) {
        return Some(vec![single]);
    }
    // Try comma-separated
    if let Node::List(children) = binding {
        let mut tokens: Vec<String> = Vec::new();
        for child in children {
            if let Node::Leaf(ref s) = child {
                if s.ends_with(',') {
                    tokens.push(s[..s.len() - 1].to_string());
                    tokens.push(",".to_string());
                } else {
                    tokens.push(s.clone());
                }
            } else {
                return None;
            }
        }
        let mut bindings = Vec::new();
        let mut i = 0;
        while i < tokens.len() {
            if tokens[i] == "," {
                i += 1;
                continue;
            }
            if i + 1 < tokens.len() && tokens[i + 1] != "," {
                let type_name = &tokens[i];
                let var_name = &tokens[i + 1];
                if type_name.starts_with(|c: char| c.is_uppercase()) {
                    bindings.push((var_name.clone(), type_name.clone()));
                    i += 2;
                    continue;
                }
            }
            return None;
        }
        if !bindings.is_empty() {
            return Some(bindings);
        }
    }
    None
}

// ========== Substitution ==========

/// Capture-avoiding substitution for kernel terms. `subst` is the public
/// primitive name; `substitute` remains as the backwards-compatible helper.
#[derive(Debug, Clone, PartialEq)]
enum BinderKind {
    Lambda,
    Pi,
    Fresh,
}

#[derive(Debug, Clone)]
struct BinderInfo {
    kind: BinderKind,
    params: Vec<String>,
    body_index: usize,
    binding_index: usize,
}

fn non_variable_token(s: &str) -> bool {
    matches!(
        s,
        "lambda"
            | "Pi"
            | "fresh"
            | "in"
            | "subst"
            | "apply"
            | "type"
            | "of"
            | "has"
            | "probability"
            | "with"
            | "proof"
            | "range"
            | "valence"
            | "namespace"
            | "import"
            | "as"
            | "is"
            | "?"
            | "mode"
            | "relation"
            | "total"
            | "coverage"
            | "world"
            | "inductive"
            | "coinductive"
            | "constructor"
            | "define"
            | "case"
            | "measure"
            | "lex"
            | "terminating"
            | "whnf"
            | "nf"
            | "normal-form"
            | "template"
            | "+"
            | "-"
            | "*"
            | "/"
            | "<"
            | "<="
            | "="
            | "!="
            | "and"
            | "or"
            | "not"
            | "both"
            | "neither"
            | "nor"
    )
}

fn token_base_name(token: &str) -> String {
    token.trim_end_matches(|c| c == ':' || c == ',').to_string()
}

fn is_variable_token(token: &str) -> bool {
    let base = token_base_name(token);
    !base.is_empty() && base == token && !is_num(&base) && !non_variable_token(&base)
}

fn binding_param_names(binding: &Node) -> Vec<String> {
    parse_bindings(binding)
        .map(|bindings| bindings.into_iter().map(|(name, _)| name).collect())
        .unwrap_or_default()
}

fn binder_info(expr: &Node) -> Option<BinderInfo> {
    if let Node::List(children) = expr {
        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "lambda" || head == "Pi" {
                    let params = binding_param_names(&children[1]);
                    if !params.is_empty() {
                        return Some(BinderInfo {
                            kind: if head == "lambda" {
                                BinderKind::Lambda
                            } else {
                                BinderKind::Pi
                            },
                            params,
                            body_index: 2,
                            binding_index: 1,
                        });
                    }
                }
            }
        }
        if children.len() == 4 {
            if let (Node::Leaf(head), Node::Leaf(var_name), Node::Leaf(in_kw)) =
                (&children[0], &children[1], &children[2])
            {
                if head == "fresh" && in_kw == "in" {
                    return Some(BinderInfo {
                        kind: BinderKind::Fresh,
                        params: vec![var_name.clone()],
                        body_index: 3,
                        binding_index: 1,
                    });
                }
            }
        }
    }
    None
}

fn free_variables(expr: &Node) -> HashSet<String> {
    fn walk(expr: &Node, bound: &HashSet<String>, out: &mut HashSet<String>) {
        match expr {
            Node::Leaf(s) => {
                if is_variable_token(s) && !bound.contains(s) {
                    out.insert(s.clone());
                }
            }
            Node::List(children) => {
                if let Some(binder) = binder_info(expr) {
                    if binder.kind != BinderKind::Fresh {
                        let params: HashSet<String> = binder.params.iter().cloned().collect();
                        if let Node::List(binding_children) = &children[binder.binding_index] {
                            for child in binding_children {
                                if let Node::Leaf(s) = child {
                                    if params.contains(&token_base_name(s)) {
                                        continue;
                                    }
                                }
                                walk(child, bound, out);
                            }
                        }
                    }
                    let mut nested = bound.clone();
                    for param in binder.params {
                        nested.insert(param);
                    }
                    walk(&children[binder.body_index], &nested, out);
                    return;
                }
                for child in children {
                    walk(child, bound, out);
                }
            }
        }
    }

    let mut out = HashSet::new();
    walk(expr, &HashSet::new(), &mut out);
    out
}

fn contains_free(expr: &Node, name: &str) -> bool {
    free_variables(expr).contains(name)
}

fn env_can_evaluate_name(env: &Env, name: &str) -> bool {
    if env.symbol_prob.contains_key(name)
        || env.terms.contains(name)
        || env.types.contains_key(name)
        || env.lambdas.contains_key(name)
        || env.ops.contains_key(name)
        || env.templates.contains_key(name)
    {
        return true;
    }
    let resolved = env.resolve_qualified(name);
    resolved != name
        && (env.symbol_prob.contains_key(&resolved)
            || env.terms.contains(&resolved)
            || env.types.contains_key(&resolved)
            || env.lambdas.contains_key(&resolved)
            || env.ops.contains_key(&resolved)
            || env.templates.contains_key(&resolved))
}

fn has_unresolved_free_variables(expr: &Node, env: &Env) -> bool {
    free_variables(expr)
        .iter()
        .any(|name| !env_can_evaluate_name(env, name))
}

fn collect_names(expr: &Node, out: &mut HashSet<String>) {
    match expr {
        Node::Leaf(s) => {
            let base = token_base_name(s);
            if !base.is_empty() && !is_num(&base) && !non_variable_token(&base) {
                out.insert(base);
            }
        }
        Node::List(children) => {
            for child in children {
                collect_names(child, out);
            }
        }
    }
}

fn fresh_name(base: &str, avoid: &HashSet<String>) -> String {
    let mut i = 1;
    loop {
        let candidate = format!("{}_{}", base, i);
        if !avoid.contains(&candidate) {
            return candidate;
        }
        i += 1;
    }
}

fn rename_binding_param(binding: &Node, old_name: &str, new_name: &str) -> Node {
    if let Node::List(children) = binding {
        return Node::List(
            children
                .iter()
                .map(|child| match child {
                    Node::Leaf(s) if s == old_name => Node::Leaf(new_name.to_string()),
                    Node::Leaf(s) if s == &format!("{},", old_name) => {
                        Node::Leaf(format!("{},", new_name))
                    }
                    Node::Leaf(s) if s == &format!("{}:", old_name) => {
                        Node::Leaf(format!("{}:", new_name))
                    }
                    _ => child.clone(),
                })
                .collect(),
        );
    }
    binding.clone()
}

fn rename_bound_occurrences(expr: &Node, old_name: &str, new_name: &str) -> Node {
    match expr {
        Node::Leaf(s) => {
            if s == old_name {
                Node::Leaf(new_name.to_string())
            } else {
                expr.clone()
            }
        }
        Node::List(children) => {
            if let Some(binder) = binder_info(expr) {
                if binder.params.iter().any(|param| param == old_name) {
                    return expr.clone();
                }
            }
            Node::List(
                children
                    .iter()
                    .map(|child| rename_bound_occurrences(child, old_name, new_name))
                    .collect(),
            )
        }
    }
}

fn rename_binder(expr: &Node, binder: &BinderInfo, old_name: &str, new_name: &str) -> Node {
    if let Node::List(children) = expr {
        let mut out = children.clone();
        if binder.kind == BinderKind::Fresh {
            out[binder.binding_index] = Node::Leaf(new_name.to_string());
        } else {
            out[binder.binding_index] =
                rename_binding_param(&out[binder.binding_index], old_name, new_name);
        }
        out[binder.body_index] =
            rename_bound_occurrences(&out[binder.body_index], old_name, new_name);
        Node::List(out)
    } else {
        expr.clone()
    }
}

/// Substitute all free occurrences of variable `name` with `replacement` in `expr`.
pub fn subst(expr: &Node, name: &str, replacement: &Node) -> Node {
    match expr {
        Node::Leaf(s) => {
            if s == name {
                replacement.clone()
            } else {
                expr.clone()
            }
        }
        Node::List(children) => {
            if let Some(binder) = binder_info(expr) {
                if binder.params.iter().any(|param| param == name) {
                    return expr.clone(); // shadowed
                }
                let mut current = expr.clone();
                let replacement_free = free_variables(replacement);
                if contains_free(&children[binder.body_index], name) {
                    let mut avoid = HashSet::new();
                    collect_names(&current, &mut avoid);
                    collect_names(replacement, &mut avoid);
                    avoid.insert(name.to_string());
                    for param in &binder.params {
                        if replacement_free.contains(param) {
                            let next = fresh_name(param, &avoid);
                            avoid.insert(next.clone());
                            let current_binder = binder_info(&current).expect("renamed binder");
                            current = rename_binder(&current, &current_binder, param, &next);
                        }
                    }
                }
                if let Node::List(current_children) = current {
                    return Node::List(
                        current_children
                            .iter()
                            .map(|child| subst(child, name, replacement))
                            .collect(),
                    );
                }
            }
            Node::List(
                children
                    .iter()
                    .map(|child| subst(child, name, replacement))
                    .collect(),
            )
        }
    }
}

/// Backwards-compatible alias for [`subst`].
pub fn substitute(expr: &Node, name: &str, replacement: &Node) -> Node {
    subst(expr, name, replacement)
}

// ========== Template expansion (issue #59) ==========

fn template_key_for(env: &Env, name: &str) -> Option<String> {
    if env.templates.contains_key(name) {
        return Some(name.to_string());
    }
    let resolved = env.resolve_qualified(name);
    if resolved != name && env.templates.contains_key(&resolved) {
        return Some(resolved);
    }
    None
}

fn validate_template_pattern(pattern: &Node) -> Result<(String, Vec<String>), String> {
    let children = match pattern {
        Node::List(items) if !items.is_empty() => items,
        _ => {
            return Err(
                "Template declaration must be `(template (<name> <param>...) <body>)`".to_string(),
            );
        }
    };
    let name = match &children[0] {
        Node::Leaf(s) if is_variable_token(s) => s.clone(),
        Node::Leaf(s) => {
            return Err(format!(
                "Template name must be a bare identifier (got \"{}\")",
                s
            ));
        }
        other => {
            return Err(format!(
                "Template name must be a bare identifier (got \"{}\")",
                key_of(other)
            ));
        }
    };

    let mut params = Vec::new();
    let mut seen = HashSet::new();
    for param in &children[1..] {
        let p = match param {
            Node::Leaf(s) if is_variable_token(s) => s.clone(),
            Node::Leaf(s) => {
                return Err(format!(
                    "Template parameter must be a bare identifier (got \"{}\")",
                    s
                ));
            }
            other => {
                return Err(format!(
                    "Template parameter must be a bare identifier (got \"{}\")",
                    key_of(other)
                ));
            }
        };
        if !seen.insert(p.clone()) {
            return Err(format!(
                "Template parameter \"{}\" is declared more than once",
                p
            ));
        }
        params.push(p);
    }
    Ok((name, params))
}

/// Merge an incoming root-construct descriptor with the previously stored
/// one. The merge prefers explicitly set fields from the new descriptor
/// but preserves information the new descriptor leaves unspecified, so
/// multiple `(root-construct …)` forms can build the record incrementally
/// without clobbering already-known fields.
fn merge_root_construct_descriptors(
    previous: Option<RootConstructDescriptor>,
    next: RootConstructDescriptor,
) -> RootConstructDescriptor {
    let mut base = previous.unwrap_or_else(|| RootConstructDescriptor {
        name: next.name.clone(),
        ..Default::default()
    });
    base.name = next.name;
    if next.status.is_some() {
        base.status = next.status;
    }
    if next.semantic_status.is_some() {
        base.semantic_status = next.semantic_status;
    }
    if next.kind.is_some() {
        base.kind = next.kind;
    }
    if !next.depends_on.is_empty() {
        let mut seen: std::collections::HashSet<String> =
            base.depends_on.iter().cloned().collect();
        for d in next.depends_on {
            if !seen.contains(&d) {
                seen.insert(d.clone());
                base.depends_on.push(d);
            }
        }
    }
    if next.encoded_as.is_some() {
        base.encoded_as = next.encoded_as;
    }
    if next.pure_links_ready.is_some() {
        base.pure_links_ready = next.pure_links_ready;
    }
    if next.override_with.is_some() {
        base.override_with = next.override_with;
    }
    if next.planned_as.is_some() {
        base.planned_as = next.planned_as;
    }
    if next.foundation.is_some() {
        base.foundation = next.foundation;
    }
    base
}

const SEMANTIC_STATUS_ORDER: [&str; 5] = [
    "host-trusted",
    "links-described",
    "links-checked",
    "links-evaluated",
    "self-hosted",
];

fn semantic_status_for_trust_status(status: Option<&str>) -> Option<String> {
    match status {
        Some("host-primitive")
        | Some("host-derived")
        | Some("external-trusted")
        | Some("user-configurable")
        | Some("user-overridden") => Some("host-trusted".to_string()),
        Some("links-encoded") | Some("planned") => Some("links-described".to_string()),
        Some("links-defined") => Some("links-checked".to_string()),
        _ => None,
    }
}

fn semantic_status_for_descriptor(descriptor: &RootConstructDescriptor) -> Option<String> {
    descriptor
        .semantic_status
        .clone()
        .or_else(|| semantic_status_for_trust_status(descriptor.status.as_deref()))
}

fn merge_foundation_descriptors(
    previous: Option<FoundationDescriptor>,
    next: FoundationDescriptor,
) -> FoundationDescriptor {
    let mut base = previous.unwrap_or_else(|| FoundationDescriptor {
        name: next.name.clone(),
        ..Default::default()
    });
    base.name = next.name;
    if next.description.is_some() {
        base.description = next.description;
    }
    if !next.uses.is_empty() {
        let mut seen: std::collections::HashSet<String> = base.uses.iter().cloned().collect();
        for u in next.uses {
            if !seen.contains(&u) {
                seen.insert(u.clone());
                base.uses.push(u);
            }
        }
    }
    if !next.defines.is_empty() {
        for (k, v) in next.defines {
            if let Some(existing) = base.defines.iter_mut().find(|(name, _)| name == &k) {
                existing.1 = v;
            } else {
                base.defines.push((k, v));
            }
        }
    }
    if next.extends.is_some() {
        base.extends = next.extends;
    }
    if next.numeric_domain.is_some() {
        base.numeric_domain = next.numeric_domain;
    }
    if next.truth_domain.is_some() {
        base.truth_domain = next.truth_domain;
    }
    // Carrier (issue #97 Section 2): a later registration with the same name
    // replaces the carrier list but only flips `strict_carrier` to true
    // (never silently back off).
    if !next.carrier.is_empty() {
        base.carrier = next.carrier;
    }
    if next.strict_carrier {
        base.strict_carrier = true;
    }
    // Truth tables (issue #97, Section 3 of netkeep80's punch-list). A later
    // registration adds/overwrites table entries operator-by-operator so the
    // user can extend a previously declared foundation with more tables.
    for (op_name, rows) in next.truth_tables {
        if let Some(existing) = base
            .truth_tables
            .iter_mut()
            .find(|(name, _)| name == &op_name)
        {
            existing.1 = rows;
        } else {
            base.truth_tables.push((op_name, rows));
        }
    }
    // Experimental foundation profile metadata (issue #97, Phase 9). A later
    // registration can flip `experimental` to true (never silently back to
    // false), set or replace the root symbol, and append additional abits.
    if next.experimental {
        base.experimental = true;
    }
    if next.root.is_some() {
        base.root = next.root;
    }
    if !next.abits.is_empty() {
        let mut seen: std::collections::HashSet<String> =
            base.abits.iter().map(|(s, _)| s.clone()).collect();
        for (symbol, meaning) in next.abits {
            if !seen.contains(&symbol) {
                seen.insert(symbol.clone());
                base.abits.push((symbol, meaning));
            }
        }
    }
    base
}

// ---------- Dependency graph traversal (issue #97, Phase 7) ----------
//
// Compute the transitive closure of a single root-construct's dependencies,
// breadth-first. Missing intermediate deps are silently retained (so the
// final closure can surface dangling names for downstream tools to detect
// against the registry). The traversal uses a seen-set so the helper does
// not loop forever in the presence of cycles. The result is sorted so two
// invocations against the same registry yield byte-identical output.
fn closure_for(env: &Env, name: &str) -> Vec<String> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut order: Vec<String> = Vec::new();
    let mut queue: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    queue.push_back(name.to_string());
    while let Some(next) = queue.pop_front() {
        if seen.contains(&next) {
            continue;
        }
        seen.insert(next.clone());
        if next != name {
            order.push(next.clone());
        }
        if let Some(rc) = env.root_constructs.get(&next) {
            let mut deps = rc.depends_on.clone();
            deps.sort();
            for dep in deps {
                if !seen.contains(&dep) {
                    queue.push_back(dep);
                }
            }
        }
    }
    order.sort();
    order
}

/// Build a `[(name, [dep, ...]), ...]` listing covering every registered
/// root-construct in deterministic, sorted order at every level.
/// Constructs with no dependencies map to an empty vector so the trust
/// audit can still see them. Complement of `Env::dependency_closure(name)`
/// which gives a per-construct slice.
pub fn build_dependency_graph(env: &Env) -> Vec<(String, Vec<String>)> {
    let mut names: Vec<String> = env.root_constructs.keys().cloned().collect();
    names.sort();
    let mut out: Vec<(String, Vec<String>)> = Vec::with_capacity(names.len());
    for name in names {
        let closure = closure_for(env, &name);
        out.push((name, closure));
    }
    out
}

// ---------- MTC/anum serialization (issue #97, Phase 9) ----------
//
// Encode a link expression into a string using only the four abits of the
// experimental `mtc-anum` foundation: `[`, `]`, `0`, `1`. Each Node is
// wrapped in `[ ... ]`; the first character after `[` is a tag — `0` for a
// leaf, `1` for a list. A leaf's payload is its UTF-8 bytes encoded
// most-significant-bit-first, 8 bits per byte. A list's payload is the
// concatenated encoding of its children. Round-trippable via `decode_anum`.
pub fn encode_anum(node: &Node) -> String {
    let mut out = String::new();
    encode_anum_into(node, &mut out);
    out
}

fn encode_anum_into(node: &Node, out: &mut String) {
    match node {
        Node::Leaf(s) => {
            out.push('[');
            out.push('0');
            for byte in s.as_bytes() {
                for shift in (0..8).rev() {
                    out.push(if (byte >> shift) & 1 == 1 { '1' } else { '0' });
                }
            }
            out.push(']');
        }
        Node::List(children) => {
            out.push('[');
            out.push('1');
            for child in children {
                encode_anum_into(child, out);
            }
            out.push(']');
        }
    }
}

/// Decode an anum-encoded string into a Node. Strictly enforces the
/// `[tag payload]` shape; any character outside the four-abit alphabet
/// raises an error. Returns the decoded Node; errors if trailing content
/// remains after the top-level frame.
pub fn decode_anum(s: &str) -> Result<Node, String> {
    let bytes = s.as_bytes();
    let (node, pos) = decode_anum_at(bytes, 0)?;
    if pos != bytes.len() {
        return Err(format!("anum-decode: trailing data at position {}", pos));
    }
    Ok(node)
}

fn decode_anum_at(bytes: &[u8], mut pos: usize) -> Result<(Node, usize), String> {
    if pos >= bytes.len() || bytes[pos] != b'[' {
        return Err(format!("anum-decode: expected '[' at position {}", pos));
    }
    pos += 1;
    if pos >= bytes.len() {
        return Err("anum-decode: truncated input after '['".to_string());
    }
    let tag = bytes[pos];
    if tag == b'0' {
        pos += 1;
        let mut bits = String::new();
        while pos < bytes.len() && bytes[pos] != b']' {
            let b = bytes[pos];
            if b != b'0' && b != b'1' {
                return Err(format!(
                    "anum-decode: leaf payload may only contain '0' or '1' (got '{}' at {})",
                    b as char, pos
                ));
            }
            bits.push(b as char);
            pos += 1;
        }
        if pos >= bytes.len() || bytes[pos] != b']' {
            return Err(format!(
                "anum-decode: unterminated leaf starting before position {}",
                pos
            ));
        }
        pos += 1;
        if bits.len() % 8 != 0 {
            return Err(format!(
                "anum-decode: leaf bit-count {} is not byte-aligned",
                bits.len()
            ));
        }
        let mut payload: Vec<u8> = Vec::with_capacity(bits.len() / 8);
        for chunk in bits.as_bytes().chunks(8) {
            let mut byte: u8 = 0;
            for &c in chunk {
                byte = (byte << 1) | (if c == b'1' { 1 } else { 0 });
            }
            payload.push(byte);
        }
        let s = String::from_utf8(payload)
            .map_err(|e| format!("anum-decode: invalid UTF-8 in leaf ({})", e))?;
        Ok((Node::Leaf(s), pos))
    } else if tag == b'1' {
        pos += 1;
        let mut items: Vec<Node> = Vec::new();
        while pos < bytes.len() && bytes[pos] != b']' {
            if bytes[pos] != b'[' {
                return Err(format!(
                    "anum-decode: list child must start with '[' (got '{}' at {})",
                    bytes[pos] as char, pos
                ));
            }
            let (child, next) = decode_anum_at(bytes, pos)?;
            items.push(child);
            pos = next;
        }
        if pos >= bytes.len() || bytes[pos] != b']' {
            return Err(format!(
                "anum-decode: unterminated list starting before position {}",
                pos
            ));
        }
        pos += 1;
        Ok((Node::List(items), pos))
    } else {
        Err(format!(
            "anum-decode: expected tag '0' or '1' after '[' at position {}",
            pos
        ))
    }
}

/// Seed the registry with the built-in descriptors that describe what the
/// current host implementation actually trusts. Mirrors the JS
/// `seedBuiltinRootConstructs` list verbatim so the trust report is
/// identical across JS and Rust.
fn seed_builtin_root_constructs(env: &mut Env) {
    let seeds: Vec<(&str, &str, &str, Vec<&str>, Option<&str>, Option<bool>)> = vec![
        // (name, kind, status, depends_on, encoded_as, pure_links_ready)
        ("lino-parser", "parser", "external-trusted", vec![], Some("links-notation"), Some(false)),
        ("canonical-printer", "printer", "host-primitive", vec![], Some("keyOf"), None),
        ("structural-equality", "equality-layer", "host-primitive", vec![], Some("isStructurallySame"), None),
        ("structural-matcher", "matcher", "external-trusted", vec![], Some("match_proof_pattern"), None),
        ("decimal-12-arithmetic", "numeric-domain", "host-primitive", vec![], Some("decRound"), Some(false)),
        ("+", "arithmetic-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("-", "arithmetic-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("*", "arithmetic-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("/", "arithmetic-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("<", "comparison-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("<=", "comparison-operator", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("truth-range", "truth-domain", "user-configurable", vec![], Some("Env.lo/Env.hi"), None),
        ("valence", "truth-domain", "user-configurable", vec![], Some("Env.valence"), None),
        ("clamp", "truth-normalization", "host-primitive", vec![], Some("Env.clamp"), None),
        ("quantize", "truth-normalization", "host-primitive", vec![], Some("quantize"), None),
        ("true", "truth-constant", "user-configurable", vec![], None, None),
        ("false", "truth-constant", "user-configurable", vec![], None, None),
        ("unknown", "truth-constant", "user-configurable", vec![], None, None),
        ("undefined", "truth-constant", "user-configurable", vec![], None, None),
        ("avg", "aggregator", "host-primitive", vec![], None, None),
        ("min", "aggregator", "host-primitive", vec![], None, None),
        ("max", "aggregator", "host-primitive", vec![], None, None),
        ("product", "aggregator", "host-primitive", vec![], None, None),
        ("probabilistic_sum", "aggregator", "host-primitive", vec![], None, None),
        ("truth-table-fallback", "truth-table-fallback", "host-derived", vec![], None, None),
        ("not", "truth-operator", "user-configurable", vec!["truth-range", "decimal-12-arithmetic"], None, None),
        ("and", "truth-operator", "user-configurable", vec!["avg"], None, None),
        ("or", "truth-operator", "user-configurable", vec!["max"], None, None),
        ("both", "truth-operator", "user-configurable", vec!["avg"], None, None),
        ("neither", "truth-operator", "user-configurable", vec!["product"], None, None),
        ("=", "equality-layer", "host-primitive", vec!["structural-equality", "decimal-12-arithmetic"], None, None),
        ("!=", "equality-layer", "host-derived", vec!["=", "not"], None, None),
        ("assigned-equality", "equality-layer", "host-primitive", vec![], None, None),
        ("numeric-equality", "equality-layer", "host-primitive", vec!["decimal-12-arithmetic"], None, None),
        ("definitional-equality", "equality-layer", "host-primitive", vec!["beta-reduction", "structural-equality"], None, None),
        ("Type", "universe-form", "host-primitive", vec![], None, Some(false)),
        ("Prop", "universe-form", "host-primitive", vec!["Type"], None, None),
        ("Pi", "binder", "host-primitive", vec!["Type", "substitution", "freshness"], None, None),
        ("lambda", "binder", "host-primitive", vec!["Pi", "substitution"], None, None),
        ("apply", "eliminator", "host-primitive", vec!["lambda", "beta-reduction"], None, None),
        ("beta-reduction", "reduction-rule", "host-primitive", vec!["substitution", "freshness", "alpha-renaming"], None, None),
        ("substitution", "meta-operation", "host-primitive", vec![], Some("substitute"), None),
        ("freshness", "meta-operation", "host-primitive", vec![], Some("evalFresh"), None),
        ("alpha-renaming", "meta-operation", "host-primitive", vec![], None, None),
        ("normalization", "reduction-rule", "host-primitive", vec!["beta-reduction"], Some("normalizeTerm"), None),
        ("whnf", "reduction-rule", "host-primitive", vec!["beta-reduction"], Some("whnfTerm"), None),
        ("conversion", "equality-layer", "host-primitive", vec!["beta-reduction", "normalization", "structural-equality"], None, None),
        ("pi-formation", "typing-rule", "links-defined", vec!["Pi"], None, None),
        ("lambda-introduction", "typing-rule", "links-defined", vec!["lambda"], None, None),
        ("application-elimination", "typing-rule", "links-defined", vec!["apply"], None, None),
        ("beta-conversion", "reduction-rule", "links-defined", vec!["beta-reduction"], None, None),
        ("inductive", "declaration", "host-primitive", vec!["Type", "Pi"], None, None),
        ("coinductive", "declaration", "host-primitive", vec!["Type", "Pi"], None, None),
        ("proof-replay", "replay-checker", "host-primitive", vec![], Some("check.mjs"), None),
        ("proof-object", "proof-data", "links-encoded", vec![], Some("proof-object"), None),
        ("proof-rule-declaration", "proof-data", "links-encoded", vec![], Some("rule"), None),
        ("proof-checking-relation", "checking-relation", "links-defined", vec!["proof-replay", "structural-equality", "proof-object"], None, None),
        ("rule-application-check", "checking-relation", "links-defined", vec!["proof-replay", "structural-equality", "proof-rule-declaration"], None, None),
        ("by", "proof-rule", "host-primitive", vec![], None, None),
        ("Nat", "inductive-type", "links-defined", vec![], None, None),
        ("zero", "constructor", "links-defined", vec!["Nat"], None, None),
        ("succ", "constructor", "links-defined", vec!["Nat"], None, None),
        ("nat-equality", "equality-layer", "links-defined", vec!["Nat", "structural-equality"], Some("nat-equals"), None),
        ("nat-recursion", "recursor", "links-defined", vec!["Nat", "zero", "succ", "nat-equality", "proof-replay", "structural-equality"], None, None),
        ("add", "derived-operation", "links-defined", vec!["Nat", "zero", "succ", "nat-recursion", "nat-equality"], None, None),
        ("nat-add-zero", "computation-rule", "links-defined", vec!["add", "zero", "nat-recursion", "nat-equality"], None, None),
        ("nat-add-succ", "computation-rule", "links-defined", vec!["add", "succ", "nat-recursion", "nat-equality"], None, None),
        ("nat-zero-formation", "typing-rule", "links-defined", vec!["Nat", "zero"], None, None),
        ("nat-succ-formation", "typing-rule", "links-defined", vec!["Nat", "succ"], None, None),
        ("forall", "universal-quantifier", "links-defined", vec!["Nat"], None, None),
        ("implication", "logical-connective", "links-defined", vec![], Some("implies"), None),
        ("predicate-application", "logical-form", "links-defined", vec![], Some("at"), None),
        ("nat-induction", "proof-principle", "links-defined", vec!["Nat", "forall", "implication", "predicate-application", "substitution", "freshness", "proof-replay", "structural-equality"], None, None),
        ("nat-refl", "equality-rule", "links-defined", vec!["Nat", "nat-equality"], None, None),
        ("nat-cong-succ", "equality-rule", "links-defined", vec!["Nat", "succ", "nat-equality"], None, None),
        ("nat-eliminator", "eliminator", "links-defined", vec!["Nat", "nat-recursion", "nat-induction"], None, None),
        ("nat-rec-zero", "computation-rule", "links-defined", vec!["nat-recursion", "zero", "nat-equality"], None, None),
        ("nat-rec-succ", "computation-rule", "links-defined", vec!["nat-recursion", "succ", "nat-equality"], None, None),
        ("mul", "derived-operation", "links-defined", vec!["Nat", "zero", "succ", "add", "nat-recursion", "nat-equality"], None, None),
        ("nat-mul-zero", "computation-rule", "links-defined", vec!["mul", "zero", "nat-recursion", "nat-equality"], None, None),
        ("nat-mul-succ", "computation-rule", "links-defined", vec!["mul", "succ", "add", "nat-recursion", "nat-equality"], None, None),
        ("eval-nat-normalize", "evaluator-fragment", "links-defined", vec!["Nat", "zero", "succ", "add", "mul", "nat-add-zero", "nat-add-succ", "nat-mul-zero", "nat-mul-succ", "structural-matcher"], None, None),
        ("eval-nat", "evaluator", "links-defined", vec!["eval-nat-normalize", "nat-normal-form-to-host-number"], None, None),
        ("nat-normal-form-to-host-number", "renderer", "host-derived", vec!["eval-nat-normalize"], None, None),
        ("smt-trusted", "external-decision", "external-trusted", vec![], None, None),
        ("atp-trusted", "external-decision", "external-trusted", vec![], None, None),
        ("mode", "mode-declaration", "host-primitive", vec![], None, None),
        ("totality-check", "metatheorem", "host-primitive", vec![], None, None),
        ("coverage-check", "metatheorem", "host-primitive", vec![], None, None),
        ("termination-check", "metatheorem", "host-primitive", vec![], None, None),
        ("self.evaluator", "self-bootstrap", "links-encoded", vec![], Some("lib/self/evaluator.lino"), None),
        ("self.grammar", "self-bootstrap", "links-encoded", vec![], Some("lib/self/grammar.lino"), None),
        ("self.types", "self-bootstrap", "links-encoded", vec![], Some("lib/self/types.lino"), None),
        ("self.operators", "self-bootstrap", "links-encoded", vec![], Some("lib/self/operators.lino"), None),
        ("self.metatheorem", "self-bootstrap", "links-encoded", vec![], Some("lib/self/metatheorem.lino"), None),
    ];
    // Special-case the universe form's planned-as field (Type is planned as links-defined).
    for (name, kind, status, depends_on, encoded_as, pure_links_ready) in seeds {
        let descriptor = RootConstructDescriptor {
            name: name.to_string(),
            status: Some(status.to_string()),
            semantic_status: None,
            kind: Some(kind.to_string()),
            depends_on: depends_on.into_iter().map(String::from).collect(),
            encoded_as: encoded_as.map(String::from),
            pure_links_ready,
            override_with: None,
            planned_as: if name == "Type" { Some("links-defined".to_string()) } else { None },
            foundation: None,
        };
        env.root_constructs.insert(descriptor.name.clone(), descriptor);
    }
    for name in ["eval-nat-normalize", "eval-nat"] {
        if let Some(descriptor) = env.root_constructs.get_mut(name) {
            descriptor.semantic_status = Some("links-evaluated".to_string());
        }
    }
    if let Some(descriptor) = env.root_constructs.get_mut("structural-matcher") {
        descriptor.semantic_status = Some("host-trusted".to_string());
    }
    if let Some(descriptor) = env.root_constructs.get_mut("nat-normal-form-to-host-number") {
        descriptor.semantic_status = Some("host-trusted".to_string());
    }
}

/// Parse a `(root-construct <name> (status …) (kind …) …)` form into a
/// descriptor record. Mirrors the JS `parseRootConstructForm` helper.
fn parse_root_construct_form(node: &Node) -> Result<RootConstructDescriptor, String> {
    let children = match node {
        Node::List(items) => items,
        _ => return Err("root-construct form must be `(root-construct <name> …)`".to_string()),
    };
    if children.len() < 2 {
        return Err("root-construct form must be `(root-construct <name> …)`".to_string());
    }
    let head = match &children[0] {
        Node::Leaf(s) if s == "root-construct" => s,
        _ => return Err("root-construct form must be `(root-construct <name> …)`".to_string()),
    };
    let _ = head;
    let name = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err("root-construct name must be a non-empty identifier".to_string()),
    };
    let mut descriptor = RootConstructDescriptor {
        name,
        ..Default::default()
    };
    for child in &children[2..] {
        let clause = match child {
            Node::List(items) => items,
            _ => {
                return Err(
                    "root-construct child clauses must be lists led by a keyword".to_string(),
                );
            }
        };
        if clause.is_empty() {
            return Err(
                "root-construct child clauses must be lists led by a keyword".to_string(),
            );
        }
        let key = match &clause[0] {
            Node::Leaf(s) => s.as_str(),
            _ => {
                return Err(
                    "root-construct child clauses must be lists led by a keyword".to_string(),
                );
            }
        };
        let rest: Vec<&Node> = clause.iter().skip(1).collect();
        match key {
            "status" => {
                if rest.len() != 1 {
                    return Err("(status …) requires one symbol".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    descriptor.status = Some(v.clone());
                } else {
                    return Err("(status …) requires one symbol".to_string());
                }
            }
            "semantic-status" => {
                if rest.len() != 1 {
                    return Err("(semantic-status …) requires one symbol".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    descriptor.semantic_status = Some(v.clone());
                } else {
                    return Err("(semantic-status …) requires one symbol".to_string());
                }
            }
            "kind" => {
                if rest.len() != 1 {
                    return Err("(kind …) requires one symbol".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    descriptor.kind = Some(v.clone());
                } else {
                    return Err("(kind …) requires one symbol".to_string());
                }
            }
            "depends-on" => {
                for r in &rest {
                    descriptor.depends_on.push(key_of(r));
                }
            }
            "encoded-as" | "implemented-by" => {
                let joined = rest
                    .iter()
                    .map(|n| key_of(n))
                    .collect::<Vec<_>>()
                    .join(" ");
                descriptor.encoded_as = Some(joined);
            }
            "pure-links-ready" => {
                if rest.len() != 1 {
                    return Err("(pure-links-ready …) must be `yes` or `no`".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    descriptor.pure_links_ready = Some(match v.as_str() {
                        "yes" => true,
                        "no" => false,
                        _ => {
                            return Err(
                                "(pure-links-ready …) must be `yes` or `no`".to_string()
                            );
                        }
                    });
                } else {
                    return Err("(pure-links-ready …) must be `yes` or `no`".to_string());
                }
            }
            "override" => {
                let joined = rest
                    .iter()
                    .map(|n| key_of(n))
                    .collect::<Vec<_>>()
                    .join(" ");
                descriptor.override_with = Some(joined);
            }
            "planned-as" => {
                let joined = rest
                    .iter()
                    .map(|n| key_of(n))
                    .collect::<Vec<_>>()
                    .join(" ");
                descriptor.planned_as = Some(joined);
            }
            "foundation" => {
                if rest.len() != 1 {
                    return Err("(foundation …) must be a single name".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    descriptor.foundation = Some(v.clone());
                } else {
                    return Err("(foundation …) must be a single name".to_string());
                }
            }
            "surface" | "description" | "used-by" => {
                // free-form annotations; accepted syntactically.
            }
            _ => {
                // Unknown clauses are accepted for forward compatibility.
            }
        }
    }
    Ok(descriptor)
}

/// Parse a `(foundation <name> (description …) (uses …) …)` form into a
/// descriptor record. Mirrors the JS `parseFoundationForm` helper.
fn parse_foundation_form(node: &Node) -> Result<FoundationDescriptor, String> {
    let children = match node {
        Node::List(items) => items,
        _ => return Err("foundation form must be `(foundation <name> …)`".to_string()),
    };
    if children.len() < 2 {
        return Err("foundation form must be `(foundation <name> …)`".to_string());
    }
    let head = match &children[0] {
        Node::Leaf(s) if s == "foundation" => s,
        _ => return Err("foundation form must be `(foundation <name> …)`".to_string()),
    };
    let _ = head;
    let name = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err("foundation name must be a non-empty identifier".to_string()),
    };
    let mut foundation = FoundationDescriptor {
        name,
        ..Default::default()
    };
    for child in &children[2..] {
        // LiNo collapses single-element parenthesized clauses such as
        // `(strict-carrier)` into a bare `Leaf("strict-carrier")` because
        // `Link::to_string()` strips the parens around a single token.
        // Treat a bare leaf as a zero-argument clause.
        let (key, rest): (&str, Vec<&Node>) = match child {
            Node::Leaf(s) if !s.is_empty() => (s.as_str(), Vec::new()),
            Node::List(items) if !items.is_empty() => match &items[0] {
                Node::Leaf(s) => (s.as_str(), items.iter().skip(1).collect()),
                _ => {
                    return Err(
                        "foundation child clauses must be lists led by a keyword".to_string(),
                    );
                }
            },
            _ => {
                return Err(
                    "foundation child clauses must be lists led by a keyword".to_string(),
                );
            }
        };
        match key {
            "uses" => {
                for r in &rest {
                    foundation.uses.push(key_of(r));
                }
            }
            "defines" => {
                if rest.is_empty() {
                    return Err(
                        "(defines <construct> <implementation>) requires a construct name"
                            .to_string(),
                    );
                }
                let construct = match rest[0] {
                    Node::Leaf(s) => s.clone(),
                    _ => {
                        return Err(
                            "(defines <construct> <implementation>) requires a construct name"
                                .to_string(),
                        );
                    }
                };
                let impl_str = if rest.len() > 1 {
                    rest.iter()
                        .skip(1)
                        .map(|n| key_of(n))
                        .collect::<Vec<_>>()
                        .join(" ")
                } else {
                    "links-defined".to_string()
                };
                foundation.defines.push((construct, impl_str));
            }
            "extends" => {
                if rest.len() != 1 {
                    return Err("(extends …) requires one foundation name".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    foundation.extends = Some(v.clone());
                } else {
                    return Err("(extends …) requires one foundation name".to_string());
                }
            }
            "numeric-domain" => {
                if rest.len() != 1 {
                    return Err("(numeric-domain …) requires one name".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    foundation.numeric_domain = Some(v.clone());
                } else {
                    return Err("(numeric-domain …) requires one name".to_string());
                }
            }
            "truth-domain" => {
                if rest.len() != 1 {
                    return Err("(truth-domain …) requires one name".to_string());
                }
                if let Node::Leaf(v) = rest[0] {
                    foundation.truth_domain = Some(v.clone());
                } else {
                    return Err("(truth-domain …) requires one name".to_string());
                }
            }
            "carrier" => {
                // `(carrier <val1> <val2> ...)` — list the values the active
                // foundation considers legal. Each value is kept as a string
                // so `enter_foundation` can resolve symbolic constants
                // (`true`, `false`, `unknown`) through `env.symbol_prob` at
                // activation time. Numeric literals stay literal.
                if rest.is_empty() {
                    return Err("(carrier ...) requires at least one value".to_string());
                }
                foundation.carrier = rest.iter().map(|n| key_of(n)).collect();
            }
            "strict-carrier" => {
                // `(strict-carrier)` opts the foundation into runtime
                // enforcement. Without this clause, `(carrier ...)` is
                // informational only and the evaluator stays
                // backward-compatible.
                foundation.strict_carrier = true;
            }
            "truth-table" => {
                // `(truth-table <op> (in1 in2 ... -> out) ...)` — links-defined
                // finite truth table that rebinds `<op>` for the duration of
                // the foundation. Inputs and outputs are kept as strings so
                // `enter_foundation` can resolve symbolic constants through
                // `env.symbol_prob` at activation time.
                if rest.is_empty() {
                    return Err(
                        "(truth-table <op> ...) requires an operator name".to_string(),
                    );
                }
                let op_name = match rest[0] {
                    Node::Leaf(ref s) if !s.is_empty() => s.clone(),
                    _ => {
                        return Err(
                            "(truth-table <op> ...) requires an operator name".to_string(),
                        );
                    }
                };
                let mut table_rows: Vec<TruthTableRow> = Vec::new();
                for raw in rest.iter().skip(1) {
                    let row_items = match raw {
                        Node::List(items) => items,
                        _ => {
                            return Err(format!(
                                "(truth-table {} ...) rows must be lists like (in1 in2 -> out)",
                                op_name
                            ));
                        }
                    };
                    let arrow_at = row_items
                        .iter()
                        .position(|n| matches!(n, Node::Leaf(s) if s == "->"));
                    let arrow_at = match arrow_at {
                        Some(idx) if idx >= 1 && idx == row_items.len() - 2 => idx,
                        _ => {
                            return Err(format!(
                                "(truth-table {} ...) row must be (input ... -> output)",
                                op_name
                            ));
                        }
                    };
                    let inputs: Vec<String> = row_items[..arrow_at]
                        .iter()
                        .map(|n| key_of(n))
                        .collect();
                    let output = key_of(&row_items[arrow_at + 1]);
                    table_rows.push(TruthTableRow { inputs, output });
                }
                if table_rows.is_empty() {
                    return Err(format!(
                        "(truth-table {} ...) requires at least one row",
                        op_name
                    ));
                }
                foundation
                    .truth_tables
                    .push((op_name, table_rows));
            }
            "description" => {
                foundation.description = Some(
                    rest.iter()
                        .map(|n| key_of(n))
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
            "experimental" => {
                // `(experimental)` flags the foundation as experimental so
                // the trust audit can call it out (issue #97, Phase 9).
                // Data-only.
                foundation.experimental = true;
            }
            "root" => {
                // `(root <symbol>)` records the foundation's root concept
                // (e.g. `∞` for mtc-anum). Informational; surfaced on the
                // report.
                if rest.len() != 1 {
                    return Err("(root <symbol>) requires exactly one value".to_string());
                }
                foundation.root = Some(key_of(rest[0]));
            }
            "abit" => {
                // `(abit <symbol> <meaning...>)` records one atomic bit of
                // the foundation's alphabet. The mtc-anum profile lists
                // four abits: `[`, `]`, `1`, `0`. Informational; surfaced
                // on the report.
                if rest.is_empty() {
                    return Err("(abit <symbol> <meaning>) requires a symbol".to_string());
                }
                let symbol = key_of(rest[0]);
                let meaning = rest
                    .iter()
                    .skip(1)
                    .map(|n| key_of(n))
                    .collect::<Vec<_>>()
                    .join(" ");
                foundation.abits.push((symbol, meaning));
            }
            _ => {
                // Unknown clauses are accepted for forward compatibility.
            }
        }
    }
    Ok(foundation)
}

// ---------- Proof-object substrate (issue #97, Phase 3) ----------

/// Returns true when the `(rule ...)` form looks like a proof-substrate
/// rule (every non-name child is `(premise ...)` or `(conclusion ...)`, and
/// at least one `conclusion` is present). Data-only `(rule <name>
/// (sequence ...) ...)` forms used by self-bootstrap grammar files fall
/// through to the legacy data path because they do not pass this guard.
fn is_proof_rule_shape(children: &[Node]) -> bool {
    if children.len() < 3 {
        return false;
    }
    if !matches!(&children[1], Node::Leaf(s) if !s.is_empty()) {
        return false;
    }
    let mut saw_conclusion = false;
    for c in &children[2..] {
        let clause = match c {
            Node::List(items) => items,
            _ => return false,
        };
        let key = match clause.first() {
            Some(Node::Leaf(k)) => k.as_str(),
            _ => return false,
        };
        match key {
            "premise" => {}
            "conclusion" => {
                saw_conclusion = true;
            }
            _ => return false,
        }
    }
    saw_conclusion
}

//
// Parse `(rule <name> (premise <pat>)... (conclusion <pat>))`. Patterns are
// plain `Node`s; leaves beginning with `?` are metavariables and bind during
// `check_proof_object` matching. The form's clauses must be lists led by
// `premise`/`conclusion`; this distinguishes the proof-substrate shape from
// the data-only `(rule <name> (sequence ...) ...)` forms used by the
// self-bootstrap grammar files, which fall through to the legacy data path.
pub fn parse_rule_form(node: &Node) -> Result<ProofRule, String> {
    let children = match node {
        Node::List(items) => items,
        _ => {
            return Err(
                "rule form must be `(rule <name> (premise <pat>)... (conclusion <pat>))`".to_string(),
            );
        }
    };
    if children.len() < 3 || !matches!(children.first(), Some(Node::Leaf(h)) if h == "rule") {
        return Err(
            "rule form must be `(rule <name> (premise <pat>)... (conclusion <pat>))`".to_string(),
        );
    }
    let name = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err("rule name must be a non-empty identifier".to_string()),
    };
    let mut premises: Vec<Node> = Vec::new();
    let mut conclusion: Option<Node> = None;
    for child in &children[2..] {
        let clause = match child {
            Node::List(c) => c,
            _ => {
                return Err(format!(
                    "rule {}: clauses must be lists led by a keyword",
                    name
                ));
            }
        };
        let key = match clause.first() {
            Some(Node::Leaf(k)) => k.as_str(),
            _ => {
                return Err(format!(
                    "rule {}: clauses must be lists led by a keyword",
                    name
                ));
            }
        };
        match key {
            "premise" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "rule {}: (premise <pat>) requires exactly one pattern",
                        name
                    ));
                }
                premises.push(clause[1].clone());
            }
            "conclusion" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "rule {}: (conclusion <pat>) requires exactly one pattern",
                        name
                    ));
                }
                if conclusion.is_some() {
                    return Err(format!(
                        "rule {}: only one (conclusion ...) clause is allowed",
                        name
                    ));
                }
                conclusion = Some(clause[1].clone());
            }
            other => {
                return Err(format!(
                    "rule {}: unknown clause keyword {}",
                    name, other
                ));
            }
        }
    }
    let conclusion = conclusion.ok_or_else(|| {
        format!(
            "rule {}: at least one (conclusion <pat>) clause is required",
            name
        )
    })?;
    Ok(ProofRule {
        name,
        premises,
        conclusion,
    })
}

// Parse `(proof-object <name> (applies <rule>) (premise <judgement>)...
// (conclusion <judgement>))` into a descriptor stored on the env.
pub fn parse_proof_assumption_form(node: &Node) -> Result<ProofAssumption, String> {
    let children = match node {
        Node::List(items) => items,
        _ => {
            return Err(
                "proof assumption form must be `(assumption <name> (judgement <j>))` or `(axiom <name> (judgement <j>))`".to_string(),
            );
        }
    };
    if children.len() < 2 {
        return Err(
            "proof assumption form must be `(assumption <name> (judgement <j>))` or `(axiom <name> (judgement <j>))`".to_string(),
        );
    }
    let kind = match &children[0] {
        Node::Leaf(s) if s == "assumption" || s == "axiom" => s.clone(),
        _ => {
            return Err(
                "proof assumption form must be `(assumption <name> (judgement <j>))` or `(axiom <name> (judgement <j>))`".to_string(),
            );
        }
    };
    let name = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err(format!("{} name must be a non-empty identifier", kind)),
    };
    let mut judgement: Option<Node> = None;
    for child in &children[2..] {
        let clause = match child {
            Node::List(c) => c,
            _ => {
                return Err(format!(
                    "{} {}: clauses must be lists led by a keyword",
                    kind, name
                ));
            }
        };
        let key = match clause.first() {
            Some(Node::Leaf(k)) => k.as_str(),
            _ => {
                return Err(format!(
                    "{} {}: clauses must be lists led by a keyword",
                    kind, name
                ));
            }
        };
        match key {
            "judgement" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "{} {}: (judgement <j>) requires one argument",
                        kind, name
                    ));
                }
                if judgement.is_some() {
                    return Err(format!(
                        "{} {}: only one (judgement ...) clause is allowed",
                        kind, name
                    ));
                }
                judgement = Some(clause[1].clone());
            }
            other => {
                return Err(format!(
                    "{} {}: unknown clause keyword {}",
                    kind, name, other
                ));
            }
        }
    }
    let judgement = judgement
        .ok_or_else(|| format!("{} {}: (judgement <j>) clause is required", kind, name))?;
    Ok(ProofAssumption {
        name,
        kind,
        judgement,
    })
}

// Parse `(proof-object <name> (applies <rule>) (premise <judgement>)...
// (premise-by <dependency>)... (uses <dependency>...) (conclusion <judgement>))`
// into a descriptor stored on the env.
pub fn parse_proof_object_form(node: &Node) -> Result<ProofObject, String> {
    let children = match node {
        Node::List(items) => items,
        _ => {
            return Err(
                "proof-object form must be `(proof-object <name> (applies <rule>) ...)`"
                    .to_string(),
            );
        }
    };
    if children.len() < 2 || !matches!(children.first(), Some(Node::Leaf(h)) if h == "proof-object")
    {
        return Err(
            "proof-object form must be `(proof-object <name> (applies <rule>) ...)`".to_string(),
        );
    }
    let name = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err("proof-object name must be a non-empty identifier".to_string()),
    };
    let mut rule: Option<String> = None;
    let mut premises: Vec<Node> = Vec::new();
    let mut premise_refs: Vec<String> = Vec::new();
    let mut conclusion: Option<Node> = None;
    for child in &children[2..] {
        let clause = match child {
            Node::List(c) => c,
            _ => {
                return Err(format!(
                    "proof-object {}: clauses must be lists led by a keyword",
                    name
                ));
            }
        };
        let key = match clause.first() {
            Some(Node::Leaf(k)) => k.as_str(),
            _ => {
                return Err(format!(
                    "proof-object {}: clauses must be lists led by a keyword",
                    name
                ));
            }
        };
        match key {
            "applies" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "proof-object {}: (applies <rule>) requires a rule name",
                        name
                    ));
                }
                rule = match &clause[1] {
                    Node::Leaf(s) if !s.is_empty() => Some(s.clone()),
                    _ => {
                        return Err(format!(
                            "proof-object {}: (applies <rule>) requires a rule name",
                            name
                        ));
                    }
                };
            }
            "premise" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "proof-object {}: (premise <judgement>) requires one argument",
                        name
                    ));
                }
                premises.push(clause[1].clone());
            }
            "premise-by" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "proof-object {}: (premise-by <name>) requires a dependency name",
                        name
                    ));
                }
                match &clause[1] {
                    Node::Leaf(s) if !s.is_empty() => premise_refs.push(s.clone()),
                    _ => {
                        return Err(format!(
                            "proof-object {}: (premise-by <name>) requires a dependency name",
                            name
                        ));
                    }
                }
            }
            "uses" => {
                if clause.len() < 2 {
                    return Err(format!(
                        "proof-object {}: (uses <name>...) requires at least one dependency name",
                        name
                    ));
                }
                for dep in &clause[1..] {
                    match dep {
                        Node::Leaf(s) if !s.is_empty() => premise_refs.push(s.clone()),
                        _ => {
                            return Err(format!(
                                "proof-object {}: (uses ...) dependencies must be names",
                                name
                            ));
                        }
                    }
                }
            }
            "conclusion" => {
                if clause.len() != 2 {
                    return Err(format!(
                        "proof-object {}: (conclusion <judgement>) requires one argument",
                        name
                    ));
                }
                if conclusion.is_some() {
                    return Err(format!(
                        "proof-object {}: only one (conclusion ...) clause is allowed",
                        name
                    ));
                }
                conclusion = Some(clause[1].clone());
            }
            other => {
                return Err(format!(
                    "proof-object {}: unknown clause keyword {}",
                    name, other
                ));
            }
        }
    }
    let rule =
        rule.ok_or_else(|| format!("proof-object {}: (applies <rule>) clause is required", name))?;
    let conclusion = conclusion.ok_or_else(|| {
        format!(
            "proof-object {}: (conclusion <judgement>) clause is required",
            name
        )
    })?;
    Ok(ProofObject {
        name,
        rule,
        premises,
        premise_refs,
        conclusion,
    })
}

// Structural matcher mirroring the JS `matchProofPattern`. `?meta` leaves
// bind into `subs`; repeated metavariables must structurally match via
// `key_of`. Lists must have equal length and match pair-wise. Returns true
// on success and mutates `subs` in place.
pub fn match_proof_pattern(
    pattern: &Node,
    candidate: &Node,
    subs: &mut HashMap<String, Node>,
) -> bool {
    match pattern {
        Node::Leaf(token) if token.starts_with('?') => {
            if let Some(prev) = subs.get(token) {
                key_of(prev) == key_of(candidate)
            } else {
                subs.insert(token.clone(), candidate.clone());
                true
            }
        }
        Node::Leaf(token) => matches!(candidate, Node::Leaf(c) if c == token),
        Node::List(pat_children) => match candidate {
            Node::List(cand_children) => {
                if pat_children.len() != cand_children.len() {
                    return false;
                }
                for (p, c) in pat_children.iter().zip(cand_children.iter()) {
                    if !match_proof_pattern(p, c, subs) {
                        return false;
                    }
                }
                true
            }
            _ => false,
        },
    }
}

/// Result of validating a proof-object against its declared rule. On success
/// the substitution map records each metavariable's witness; on failure the
/// error string is suitable for surfacing as an E064 diagnostic.
pub enum CheckProofVerdict {
    Ok(HashMap<String, Node>),
    Err(String),
}

pub fn check_proof_object(env: &Env, name: &str) -> CheckProofVerdict {
    match check_proof_object_inner(env, name, &[]) {
        Ok(subs) => CheckProofVerdict::Ok(subs),
        Err(message) => CheckProofVerdict::Err(message),
    }
}

fn resolve_proof_dependency(env: &Env, name: &str, stack: &[String]) -> Result<Node, String> {
    if let Some(assumption) = env.get_proof_assumption(name) {
        return Ok(assumption.judgement.clone());
    }
    let po = env
        .get_proof_object(name)
        .ok_or_else(|| format!("unknown proof dependency {}", name))?;
    check_proof_object_inner(env, name, stack)?;
    Ok(po.conclusion.clone())
}

fn check_proof_object_inner(
    env: &Env,
    name: &str,
    stack: &[String],
) -> Result<HashMap<String, Node>, String> {
    if stack.iter().any(|n| n == name) {
        let mut cycle = stack.to_vec();
        cycle.push(name.to_string());
        return Err(format!("cyclic proof dependency: {}", cycle.join(" -> ")));
    }
    let po = match env.get_proof_object(name) {
        Some(po) => po,
        None => return Err(format!("unknown proof-object {}", name)),
    };
    let rule = match env.get_proof_rule(&po.rule) {
        Some(r) => r,
        None => {
            return Err(format!(
                "proof-object {} references unknown rule {}",
                name, po.rule
            ));
        }
    };

    let mut effective_premises = po.premises.clone();
    if !po.premise_refs.is_empty() {
        effective_premises.clear();
        let mut dependency_stack = stack.to_vec();
        dependency_stack.push(name.to_string());
        for (idx, dep) in po.premise_refs.iter().enumerate() {
            let judgement = resolve_proof_dependency(env, dep, &dependency_stack)?;
            if let Some(explicit) = po.premises.get(idx) {
                if key_of(explicit) != key_of(&judgement) {
                    return Err(format!(
                        "proof-object {}: premise {} does not match referenced judgement {}",
                        name,
                        idx + 1,
                        dep
                    ));
                }
            }
            effective_premises.push(judgement);
        }
        if !po.premises.is_empty() && po.premises.len() != po.premise_refs.len() {
            return Err(format!(
                "proof-object {}: has {} explicit premise(s) but {} proof dependency reference(s)",
                name,
                po.premises.len(),
                po.premise_refs.len()
            ));
        }
    } else if !po.premises.is_empty() {
        return Err(format!(
            "proof-object {}: premise 1 is unjustified; use (premise-by <name>) or declare an assumption/axiom",
            name
        ));
    }

    if effective_premises.len() != rule.premises.len() {
        return Err(format!(
            "proof-object {}: expected {} premise(s) for rule {}, got {}",
            name,
            rule.premises.len(),
            po.rule,
            effective_premises.len()
        ));
    }
    let mut subs: HashMap<String, Node> = HashMap::new();
    for (i, (pat, cand)) in rule
        .premises
        .iter()
        .zip(effective_premises.iter())
        .enumerate()
    {
        if !match_proof_pattern(pat, cand, &mut subs) {
            return Err(format!(
                "proof-object {}: premise {} does not match rule {}",
                name,
                i + 1,
                po.rule
            ));
        }
    }
    if !match_proof_pattern(&rule.conclusion, &po.conclusion, &mut subs) {
        return Err(format!(
            "proof-object {}: conclusion does not match rule {}",
            name, po.rule
        ));
    }
    Ok(subs)
}

// ---------- Pure-links strict mode (issue #97, Phase 6) ----------
//
// Mirrors the JS implementation in `js/src/rml-links.mjs`. The forms
// `(strict-foundation pure-links)` and `(allow-host-primitive <name>...)`
// flip the audit on and whitelist specific constructs respectively. Every
// query is then scanned: any operator leaf whose registered root-construct
// status is `host-primitive` or `host-derived` raises an E065 diagnostic
// unless the construct name is in `env.allowed_host_primitives`.

/// Parsed `(strict-foundation <profile>)` directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrictFoundationDecl {
    pub profile: String,
}

/// Parsed `(allow-host-primitive <name>...)` directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowHostPrimitiveDecl {
    pub names: Vec<String>,
}

pub fn parse_strict_foundation_form(node: &Node) -> Result<StrictFoundationDecl, String> {
    let children = match node {
        Node::List(items) => items,
        _ => return Err("(strict-foundation <profile>) is required".to_string()),
    };
    if children.is_empty() || !matches!(children.first(), Some(Node::Leaf(h)) if h == "strict-foundation") {
        return Err("(strict-foundation <profile>) is required".to_string());
    }
    if children.len() != 2 {
        return Err("(strict-foundation <profile>) requires a single profile name".to_string());
    }
    let profile = match &children[1] {
        Node::Leaf(s) if !s.is_empty() => s.clone(),
        _ => return Err("(strict-foundation <profile>) requires a single profile name".to_string()),
    };
    if profile != "pure-links" {
        return Err(format!(
            "unknown strict-foundation profile: {} (expected pure-links)",
            profile
        ));
    }
    Ok(StrictFoundationDecl { profile })
}

pub fn parse_allow_host_primitive_form(node: &Node) -> Result<AllowHostPrimitiveDecl, String> {
    let children = match node {
        Node::List(items) => items,
        _ => return Err("(allow-host-primitive <name>...) is required".to_string()),
    };
    if children.is_empty() || !matches!(children.first(), Some(Node::Leaf(h)) if h == "allow-host-primitive") {
        return Err("(allow-host-primitive <name>...) is required".to_string());
    }
    if children.len() < 2 {
        return Err(
            "(allow-host-primitive <name>...) requires at least one construct name".to_string(),
        );
    }
    let mut names = Vec::new();
    for child in &children[1..] {
        match child {
            Node::Leaf(s) if !s.is_empty() => names.push(s.clone()),
            _ => {
                return Err(
                    "(allow-host-primitive ...) names must be non-empty identifiers".to_string()
                );
            }
        }
    }
    Ok(AllowHostPrimitiveDecl { names })
}

/// Operator leaves the strict scanner explicitly ignores — surface keywords
/// (`with`, `proof`, `?`) and registry meta-forms that have nothing to do
/// with the host-primitive substrate.
fn pure_links_scanner_ignored(name: &str) -> bool {
    matches!(
        name,
        "?" | "with"
            | "proof"
            | "by"
            | "because"
            | "let"
            | "in"
            | "where"
            | ":"
            | "::"
            | "has"
            | "probability"
            | "is"
            | "a"
            | "an"
            | "sequence"
            | "normalizes-to"
            | "applies"
            | "premise"
            | "premise-by"
            | "conclusion"
            | "uses"
            | "judgement"
            | "assumption"
            | "axiom"
            | "rule"
            | "proof-object"
            | "check-proof"
            | "proof-report"
            | "foundation"
            | "with-foundation"
            | "foundation-report"
            | "foundation-report?"
            | "root-construct"
            | "strict-carrier"
            | "truth-table"
            | "strict-foundation"
            | "allow-host-primitive"
    )
}

fn is_strictly_offending_status(status: Option<&String>) -> bool {
    match status {
        Some(s) => s == "host-primitive" || s == "host-derived",
        None => false,
    }
}

fn strict_dependency_offenders(env: &Env, name: &str, path: &[String]) -> Vec<String> {
    if env.allowed_host_primitives.contains(name) {
        return Vec::new();
    }
    if path.iter().any(|n| n == name) {
        return Vec::new();
    }
    let mut current_path = path.to_vec();
    current_path.push(name.to_string());
    let active = env.active_implementations.get(name);
    let rc = env.root_constructs.get(name);
    let status = active
        .and_then(|i| i.status.as_ref())
        .or_else(|| rc.and_then(|r| r.status.as_ref()));
    let deps: Vec<String> = active
        .map(|i| i.depends_on.clone())
        .or_else(|| rc.map(|r| r.depends_on.clone()))
        .unwrap_or_default();

    if matches!(
        active.and_then(|i| i.status.as_deref()),
        Some("links-defined")
    ) && deps.is_empty()
    {
        return Vec::new();
    }
    if is_strictly_offending_status(status) && deps.is_empty() {
        return vec![format!(
            "{} -> {}",
            current_path.join(" -> "),
            status.cloned().unwrap_or_default()
        )];
    }

    let mut offenders: Vec<String> = Vec::new();
    for dep in deps {
        if env.allowed_host_primitives.contains(&dep) {
            continue;
        }
        offenders.extend(strict_dependency_offenders(env, &dep, &current_path));
    }
    if is_strictly_offending_status(status) && offenders.is_empty() {
        offenders.push(format!(
            "{} -> {}",
            current_path.join(" -> "),
            status.cloned().unwrap_or_default()
        ));
    }
    offenders
}

/// Walk a queried node and return sorted, deduplicated dependency paths that
/// end at a `host-primitive` or `host-derived` construct and are not covered
/// by `(allow-host-primitive ...)`.
pub fn scan_pure_links_offenders(node: &Node, env: &Env) -> Vec<String> {
    if !env.strict_pure_links {
        return Vec::new();
    }
    let mut offenders: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    fn check(name: &str, env: &Env, offenders: &mut std::collections::BTreeSet<String>) {
        if pure_links_scanner_ignored(name) || env.allowed_host_primitives.contains(name) {
            return;
        }
        for offender in strict_dependency_offenders(env, name, &[]) {
            offenders.insert(offender);
        }
    }
    fn visit(node: &Node, env: &Env, offenders: &mut std::collections::BTreeSet<String>) {
        match node {
            Node::List(children) => {
                if let Some(Node::Leaf(head)) = children.first() {
                    check(head, env, offenders);
                }
                // Infix (L op R) — operator is the middle element.
                if children.len() == 3 {
                    if let Node::Leaf(op) = &children[1] {
                        check(op, env, offenders);
                    }
                }
                for c in children {
                    visit(c, env, offenders);
                }
            }
            Node::Leaf(s) => {
                check(s, env, offenders);
            }
        }
    }
    visit(node, env, &mut offenders);
    offenders.into_iter().collect()
}

/// Render the foundation report as a human-readable text block. Mirrors
/// the JS `formatFoundationReport` helper.
pub fn format_foundation_report(report: &FoundationReport) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push("Foundation report:".to_string());
    lines.push(format!("  active foundation: {}", report.active_foundation));
    if let Some(d) = &report.description {
        lines.push(format!("  description: {}", d));
    }
    if let Some(n) = &report.numeric_domain {
        lines.push(format!("  numeric domain: {}", n));
    }
    if let Some(t) = &report.truth_domain {
        lines.push(format!("  truth domain: {}", t));
    }
    let ordered_statuses = [
        "host-primitive",
        "host-derived",
        "external-trusted",
        "user-configurable",
        "links-encoded",
        "links-defined",
        "user-overridden",
        "planned",
    ];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for status in ordered_statuses.iter() {
        if let Some((_, names)) = report.by_status.iter().find(|(s, _)| s == status) {
            if !names.is_empty() {
                lines.push(String::new());
                lines.push(format!("{}:", status));
                for n in names {
                    lines.push(format!("  - {}", n));
                }
                seen.insert((*status).to_string());
            }
        }
    }
    for (status, names) in &report.by_status {
        if seen.contains(status) || names.is_empty() {
            continue;
        }
        lines.push(String::new());
        lines.push(format!("{}:", status));
        for n in names {
            lines.push(format!("  - {}", n));
        }
    }
    if !report.by_semantic_status.is_empty() {
        lines.push(String::new());
        lines.push("semantic statuses:".to_string());
        let mut seen_semantic: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for status in SEMANTIC_STATUS_ORDER.iter() {
            if let Some((_, names)) = report
                .by_semantic_status
                .iter()
                .find(|(s, _)| s == status)
            {
                if !names.is_empty() {
                    lines.push(format!("  {}: {}", status, names.join(", ")));
                    seen_semantic.insert((*status).to_string());
                }
            }
        }
        for (status, names) in &report.by_semantic_status {
            if seen_semantic.contains(status) || names.is_empty() {
                continue;
            }
            lines.push(format!("  {}: {}", status, names.join(", ")));
        }
    }
    if !report.active_implementations.is_empty() {
        lines.push(String::new());
        lines.push("active implementations:".to_string());
        for implementation in &report.active_implementations {
            let mut parts: Vec<String> = Vec::new();
            if let Some(status) = &implementation.status {
                parts.push(status.clone());
            }
            if let Some(semantic_status) = &implementation.semantic_status {
                parts.push(format!("semantic {}", semantic_status));
            }
            if let Some(implementation_name) = &implementation.implementation {
                parts.push(format!("via {}", implementation_name));
            }
            if let Some(foundation) = &implementation.foundation {
                parts.push(format!("foundation {}", foundation));
            }
            if !implementation.depends_on.is_empty() {
                parts.push(format!(
                    "depends on {}",
                    implementation.depends_on.join(", ")
                ));
            }
            lines.push(format!(
                "  - {}: {}",
                implementation.construct,
                parts.join("; ")
            ));
        }
    }
    if !report.proof_rules.is_empty() {
        lines.push(String::new());
        lines.push("proof rules:".to_string());
        for r in &report.proof_rules {
            lines.push(format!(
                "  - {} ({} premises → {})",
                r.name,
                r.premises.len(),
                r.conclusion
            ));
        }
    }
    if !report.proof_assumptions.is_empty() {
        lines.push(String::new());
        lines.push("proof assumptions:".to_string());
        for a in &report.proof_assumptions {
            lines.push(format!("  - {} [{}] : {}", a.name, a.kind, a.judgement));
        }
    }
    if !report.proof_objects.is_empty() {
        lines.push(String::new());
        lines.push("proof objects:".to_string());
        for po in &report.proof_objects {
            let refs = if po.premise_refs.is_empty() {
                String::new()
            } else {
                format!(" using {}", po.premise_refs.join(", "))
            };
            lines.push(format!(
                "  - {} : applies {} ({} premises{} → {})",
                po.name,
                po.rule,
                po.premises.len(),
                refs,
                po.conclusion
            ));
        }
    }
    if !report.foundations.is_empty() {
        lines.push(String::new());
        lines.push("foundations:".to_string());
        for f in &report.foundations {
            let suffix = f
                .description
                .as_ref()
                .map(|d| format!(" — {}", d))
                .unwrap_or_default();
            let tag = if f.experimental {
                " [experimental]"
            } else {
                ""
            };
            lines.push(format!("  - {}{}{}", f.name, tag, suffix));
            if let Some(n) = &f.numeric_domain {
                lines.push(format!("      numeric domain: {}", n));
            }
            if let Some(t) = &f.truth_domain {
                lines.push(format!("      truth domain: {}", t));
            }
            if let Some(r) = &f.root {
                lines.push(format!("      root: {}", r));
            }
            if !f.abits.is_empty() {
                let parts: Vec<String> = f
                    .abits
                    .iter()
                    .map(|(s, m)| format!("{}={}", s, m))
                    .collect();
                lines.push(format!("      abits: {}", parts.join(", ")));
            }
            if !f.uses.is_empty() {
                lines.push(format!("      uses: {}", f.uses.join(", ")));
            }
            if !f.defines.is_empty() {
                let parts: Vec<String> = f
                    .defines
                    .iter()
                    .map(|(k, v)| format!("{}={}", k, v))
                    .collect();
                lines.push(format!("      defines: {}", parts.join(", ")));
            }
            if !f.truth_tables.is_empty() {
                let mut sorted: Vec<&(String, Vec<TruthTableRow>)> =
                    f.truth_tables.iter().collect();
                sorted.sort_by(|a, b| a.0.cmp(&b.0));
                let parts: Vec<String> = sorted
                    .iter()
                    .map(|(op, rows)| format!("{}({} rows)", op, rows.len()))
                    .collect();
                lines.push(format!("      truth tables: {}", parts.join(", ")));
            }
        }
    }
    if report.strict_pure_links {
        lines.push(String::new());
        lines.push("pure-links strict mode: on".to_string());
        if !report.allowed_host_primitives.is_empty() {
            lines.push(format!(
                "  allowed host primitives: {}",
                report.allowed_host_primitives.join(", ")
            ));
        }
    }
    if !report.dependency_graph.is_empty() {
        let non_empty: Vec<&(String, Vec<String>)> = report
            .dependency_graph
            .iter()
            .filter(|(_, deps)| !deps.is_empty())
            .collect();
        if !non_empty.is_empty() {
            lines.push(String::new());
            lines.push("dependency graph (transitive):".to_string());
            for (name, deps) in non_empty {
                lines.push(format!("  - {} → {}", name, deps.join(", ")));
            }
        }
    }
    lines.join("\n")
}

/// Pretty-print a [`ProofReport`] for the REPL / CLI. Mirrors the JS
/// `formatProofReport` shape so transcripts agree across runtimes.
pub fn format_proof_report(report: &ProofReport) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("Proof report for {}:", report.name));
    lines.push(format!(
        "  verdict: {}",
        if report.verdict.ok { "ok" } else { "error" }
    ));
    if let Some(err) = &report.verdict.error {
        lines.push(format!("  error: {}", err));
    }
    if let Some(rule) = &report.rule {
        lines.push(format!("  rule: {}", rule));
    }
    if let Some(conc) = &report.conclusion {
        lines.push(format!("  conclusion: {}", conc));
    }
    if !report.premises.is_empty() {
        lines.push(format!("  premises: {}", report.premises.join(", ")));
    }
    if !report.premise_refs.is_empty() {
        lines.push(format!(
            "  premise refs: {}",
            report.premise_refs.join(", ")
        ));
    }
    if !report.dependencies.is_empty() {
        lines.push(String::new());
        lines.push("dependencies (transitive):".to_string());
        for d in &report.dependencies {
            let extra = match (&d.rule, &d.judgement) {
                (Some(r), Some(j)) => format!(" — applies {} → {}", r, j),
                (Some(r), None) => format!(" — applies {}", r),
                (None, Some(j)) => format!(" — {}", j),
                (None, None) => String::new(),
            };
            lines.push(format!("  - {} [{}]{}", d.name, d.kind, extra));
        }
    }
    if !report.rules.is_empty() {
        lines.push(String::new());
        lines.push(format!("rules applied: {}", report.rules.join(", ")));
    }
    if !report.root_constructs_used.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "root constructs used: {}",
            report.root_constructs_used.join(", ")
        ));
    }
    if !report.by_semantic_status.is_empty() {
        lines.push(String::new());
        lines.push("semantic statuses:".to_string());
        let mut seen: std::collections::HashSet<String> =
            std::collections::HashSet::new();
        for status in SEMANTIC_STATUS_ORDER.iter() {
            if let Some((_, names)) = report
                .by_semantic_status
                .iter()
                .find(|(s, _)| s == status)
            {
                if !names.is_empty() {
                    lines.push(format!("  {}: {}", status, names.join(", ")));
                    seen.insert((*status).to_string());
                }
            }
        }
        for (status, names) in &report.by_semantic_status {
            if seen.contains(status) || names.is_empty() {
                continue;
            }
            lines.push(format!("  {}: {}", status, names.join(", ")));
        }
    }
    if !report.by_trust_status.is_empty() {
        lines.push(String::new());
        lines.push("trust statuses:".to_string());
        for (status, names) in &report.by_trust_status {
            if names.is_empty() {
                continue;
            }
            lines.push(format!("  {}: {}", status, names.join(", ")));
        }
    }
    lines.push(String::new());
    lines.push(format!("  active foundation: {}", report.active_foundation));
    if report.strict_pure_links {
        lines.push("  pure-links strict mode: on".to_string());
    }
    lines.join("\n")
}

/// Result of `(eval-nat <term>)`. `normal_form` is the semantic result; the
/// numeric `value` is only the legacy renderer for that Peano normal form.
#[derive(Debug, Clone, PartialEq)]
pub struct EvalNatResult {
    pub value: f64,
    pub normal_form: Node,
    pub steps: Vec<String>,
}

fn leaf_node(s: &str) -> Node {
    Node::Leaf(s.to_string())
}

fn list_node(items: Vec<Node>) -> Node {
    Node::List(items)
}

fn default_eval_nat_rule(name: &str) -> Option<ProofRule> {
    match name {
        "nat-add-zero" => Some(ProofRule {
            name: name.to_string(),
            premises: vec![list_node(vec![
                leaf_node("?n"),
                leaf_node("has-type"),
                leaf_node("Nat"),
            ])],
            conclusion: list_node(vec![
                list_node(vec![leaf_node("add"), leaf_node("zero"), leaf_node("?n")]),
                leaf_node("nat-equals"),
                leaf_node("?n"),
            ]),
        }),
        "nat-add-succ" => Some(ProofRule {
            name: name.to_string(),
            premises: vec![list_node(vec![
                list_node(vec![leaf_node("add"), leaf_node("?m"), leaf_node("?n")]),
                leaf_node("nat-equals"),
                leaf_node("?k"),
            ])],
            conclusion: list_node(vec![
                list_node(vec![
                    leaf_node("add"),
                    list_node(vec![leaf_node("succ"), leaf_node("?m")]),
                    leaf_node("?n"),
                ]),
                leaf_node("nat-equals"),
                list_node(vec![leaf_node("succ"), leaf_node("?k")]),
            ]),
        }),
        "nat-mul-zero" => Some(ProofRule {
            name: name.to_string(),
            premises: vec![list_node(vec![
                leaf_node("?n"),
                leaf_node("has-type"),
                leaf_node("Nat"),
            ])],
            conclusion: list_node(vec![
                list_node(vec![leaf_node("mul"), leaf_node("zero"), leaf_node("?n")]),
                leaf_node("nat-equals"),
                leaf_node("zero"),
            ]),
        }),
        "nat-mul-succ" => Some(ProofRule {
            name: name.to_string(),
            premises: vec![
                list_node(vec![
                    list_node(vec![leaf_node("mul"), leaf_node("?m"), leaf_node("?n")]),
                    leaf_node("nat-equals"),
                    leaf_node("?k"),
                ]),
                list_node(vec![
                    list_node(vec![leaf_node("add"), leaf_node("?n"), leaf_node("?k")]),
                    leaf_node("nat-equals"),
                    leaf_node("?s"),
                ]),
            ],
            conclusion: list_node(vec![
                list_node(vec![
                    leaf_node("mul"),
                    list_node(vec![leaf_node("succ"), leaf_node("?m")]),
                    leaf_node("?n"),
                ]),
                leaf_node("nat-equals"),
                leaf_node("?s"),
            ]),
        }),
        _ => None,
    }
}

fn instantiate_proof_pattern(pattern: &Node, subs: &HashMap<String, Node>) -> Node {
    match pattern {
        Node::Leaf(token) if token.starts_with('?') => {
            subs.get(token).cloned().unwrap_or_else(|| pattern.clone())
        }
        Node::Leaf(_) => pattern.clone(),
        Node::List(children) => Node::List(
            children
                .iter()
                .map(|child| instantiate_proof_pattern(child, subs))
                .collect(),
        ),
    }
}

fn eval_nat_foundation_uses(
    env: &Env,
    foundation_name: &str,
    rule_name: &str,
    seen: &mut HashSet<String>,
) -> bool {
    if !seen.insert(foundation_name.to_string()) {
        return false;
    }
    let Some(foundation) = env.get_foundation(foundation_name) else {
        return false;
    };
    if foundation.uses.iter().any(|u| u == rule_name) {
        return true;
    }
    foundation
        .extends
        .as_deref()
        .map(|parent| eval_nat_foundation_uses(env, parent, rule_name, seen))
        .unwrap_or(false)
}

fn eval_nat_active_foundation_uses(env: &Env, name: &str) -> bool {
    let active = if env.active_foundation.is_empty() {
        "default-rml"
    } else {
        env.active_foundation.as_str()
    };
    if active == "default-rml" {
        return true;
    }
    eval_nat_foundation_uses(env, active, name, &mut HashSet::new())
}

fn eval_nat_rule(env: &Env, name: &str) -> Result<ProofRule, String> {
    if !eval_nat_active_foundation_uses(env, name) {
        return Err(format!(
            "eval-nat requires {}, but it is not available in active foundation {}",
            name,
            if env.active_foundation.is_empty() {
                "default-rml"
            } else {
                env.active_foundation.as_str()
            }
        ));
    }
    env.get_proof_rule(name)
        .cloned()
        .or_else(|| default_eval_nat_rule(name))
        .ok_or_else(|| {
            format!(
                "eval-nat requires {}, but no links-level rule is registered",
                name
            )
        })
}

fn eval_nat_equality_conclusion<'a>(
    rule: &'a ProofRule,
    rule_name: &str,
) -> Result<(&'a Node, &'a Node), String> {
    let Node::List(children) = &rule.conclusion else {
        return Err(format!(
            "eval-nat rule {} must conclude (<term> nat-equals <term>)",
            rule_name
        ));
    };
    if children.len() != 3 || !matches!(&children[1], Node::Leaf(mid) if mid == "nat-equals") {
        return Err(format!(
            "eval-nat rule {} must conclude (<term> nat-equals <term>)",
            rule_name
        ));
    }
    Ok((&children[0], &children[2]))
}

fn process_eval_nat_premises(
    env: &Env,
    rule: &ProofRule,
    subs: &mut HashMap<String, Node>,
    steps: &mut Vec<String>,
    depth: usize,
) -> Result<(), String> {
    for premise in &rule.premises {
        if let Node::List(children) = premise {
            if children.len() == 3 && matches!(&children[1], Node::Leaf(mid) if mid == "nat-equals")
            {
                let premise_input = instantiate_proof_pattern(&children[0], subs);
                let premise_normal =
                    normalize_eval_nat_term(env, &premise_input, steps, depth + 1)?;
                if !match_proof_pattern(&children[2], &premise_normal, subs) {
                    return Err(format!(
                        "eval-nat rule {} premise {} did not match normal form {}",
                        rule.name,
                        key_of(premise),
                        key_of(&premise_normal)
                    ));
                }
                continue;
            }
            if children.len() == 3
                && matches!(&children[1], Node::Leaf(mid) if mid == "has-type")
                && matches!(&children[2], Node::Leaf(ty) if ty == "Nat")
            {
                continue;
            }
        }
        return Err(format!(
            "eval-nat rule {} has unsupported premise {}",
            rule.name,
            key_of(premise)
        ));
    }
    Ok(())
}

fn apply_eval_nat_rule(
    env: &Env,
    rule_name: &str,
    term: &Node,
    steps: &mut Vec<String>,
    depth: usize,
) -> Result<Node, String> {
    let rule = eval_nat_rule(env, rule_name)?;
    let (left, right) = eval_nat_equality_conclusion(&rule, rule_name)?;
    let mut subs: HashMap<String, Node> = HashMap::new();
    if !match_proof_pattern(left, term, &mut subs) {
        return Err(format!(
            "eval-nat rule {} does not apply to {}",
            rule_name,
            key_of(term)
        ));
    }
    steps.push(rule.name.clone());
    process_eval_nat_premises(env, &rule, &mut subs, steps, depth)?;
    let next = instantiate_proof_pattern(right, &subs);
    normalize_eval_nat_term(env, &next, steps, depth + 1)
}

fn normalize_eval_nat_term(
    env: &Env,
    node: &Node,
    steps: &mut Vec<String>,
    depth: usize,
) -> Result<Node, String> {
    if depth > 10_000 {
        return Err("eval-nat exceeded its structural rewrite limit".to_string());
    }
    if let Node::Leaf(s) = node {
        if s == "zero" {
            return Ok(leaf_node("zero"));
        }
    }
    if let Node::List(children) = node {
        if children.len() == 2 {
            if let Node::Leaf(head) = &children[0] {
                if head == "succ" {
                    let inner = normalize_eval_nat_term(env, &children[1], steps, depth + 1)?;
                    return Ok(list_node(vec![leaf_node("succ"), inner]));
                }
            }
        }
        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "add" {
                    let left = normalize_eval_nat_term(env, &children[1], steps, depth + 1)?;
                    let current =
                        list_node(vec![leaf_node("add"), left.clone(), children[2].clone()]);
                    if matches!(&left, Node::Leaf(s) if s == "zero") {
                        return apply_eval_nat_rule(
                            env,
                            "nat-add-zero",
                            &current,
                            steps,
                            depth + 1,
                        );
                    }
                    if matches!(&left, Node::List(items) if items.len() == 2 && matches!(&items[0], Node::Leaf(h) if h == "succ"))
                    {
                        return apply_eval_nat_rule(
                            env,
                            "nat-add-succ",
                            &current,
                            steps,
                            depth + 1,
                        );
                    }
                }
                if head == "mul" {
                    let left = normalize_eval_nat_term(env, &children[1], steps, depth + 1)?;
                    let current =
                        list_node(vec![leaf_node("mul"), left.clone(), children[2].clone()]);
                    if matches!(&left, Node::Leaf(s) if s == "zero") {
                        return apply_eval_nat_rule(
                            env,
                            "nat-mul-zero",
                            &current,
                            steps,
                            depth + 1,
                        );
                    }
                    if matches!(&left, Node::List(items) if items.len() == 2 && matches!(&items[0], Node::Leaf(h) if h == "succ"))
                    {
                        return apply_eval_nat_rule(
                            env,
                            "nat-mul-succ",
                            &current,
                            steps,
                            depth + 1,
                        );
                    }
                }
            }
        }
    }
    Err(format!(
        "eval-nat: not a closed Peano term: {}",
        key_of(node)
    ))
}

fn peano_normal_form_to_host_number(node: &Node) -> Result<f64, String> {
    if let Node::Leaf(s) = node {
        if s == "zero" {
            return Ok(0.0);
        }
    }
    if let Node::List(children) = node {
        if children.len() == 2 && matches!(&children[0], Node::Leaf(head) if head == "succ") {
            return Ok(1.0 + peano_normal_form_to_host_number(&children[1])?);
        }
    }
    Err(format!(
        "eval-nat produced a non-Peano normal form: {}",
        key_of(node)
    ))
}

/// Normalize a closed Peano term by dispatching through active links-level
/// computation rules. Host arithmetic is only used by the final renderer.
pub fn eval_nat_term(env: &Env, node: &Node) -> Result<EvalNatResult, String> {
    let mut steps: Vec<String> = Vec::new();
    let normal_form = normalize_eval_nat_term(env, node, &mut steps, 0)?;
    let value = peano_normal_form_to_host_number(&normal_form)?;
    Ok(EvalNatResult {
        value,
        normal_form,
        steps,
    })
}

fn register_template_form(form: &Node, env: &mut Env) -> Result<String, String> {
    let children = match form {
        Node::List(items) => items,
        _ => {
            return Err(
                "Template declaration must be `(template (<name> <param>...) <body>)`".to_string(),
            );
        }
    };
    if children.len() != 3 || !matches!(children.first(), Some(Node::Leaf(h)) if h == "template") {
        return Err(
            "Template declaration must be `(template (<name> <param>...) <body>)`".to_string(),
        );
    }
    let (name, params) = validate_template_pattern(&children[1])?;
    let store_name = env.qualify_name(&name);
    maybe_warn_shadow(env, &store_name);
    env.templates.insert(
        store_name.clone(),
        TemplateDecl {
            name: store_name.clone(),
            params,
            body: children[2].clone(),
        },
    );
    Ok(store_name)
}

fn substitute_template_placeholders(body: &Node, params: &[String], args: &[Node]) -> Node {
    let mut current = body.clone();
    let mut avoid = HashSet::new();
    collect_names(&current, &mut avoid);
    for arg in args {
        collect_names(arg, &mut avoid);
    }
    let mut sentinels = Vec::new();
    for param in params {
        let sentinel = fresh_name(&format!("__template_{}", param), &avoid);
        avoid.insert(sentinel.clone());
        sentinels.push(sentinel);
    }
    for (param, sentinel) in params.iter().zip(sentinels.iter()) {
        current = subst(&current, param, &Node::Leaf(sentinel.clone()));
    }
    for (sentinel, arg) in sentinels.iter().zip(args.iter()) {
        current = subst(&current, sentinel, arg);
    }
    current
}

fn expand_templates(node: &Node, env: &Env, stack: &mut Vec<String>) -> Node {
    match node {
        Node::Leaf(_) => node.clone(),
        Node::List(children) => {
            if children.is_empty() {
                return node.clone();
            }
            if let Some(Node::Leaf(head)) = children.first() {
                if let Some(key) = template_key_for(env, head) {
                    let decl = env
                        .templates
                        .get(&key)
                        .cloned()
                        .expect("template key resolved to declaration");
                    let arg_count = children.len().saturating_sub(1);
                    if arg_count != decl.params.len() {
                        panic!(
                            "Template expansion error: Template \"{}\" expects {} argument{}, got {}",
                            head,
                            decl.params.len(),
                            if decl.params.len() == 1 { "" } else { "s" },
                            arg_count
                        );
                    }
                    if let Some(pos) = stack.iter().position(|item| item == &key) {
                        let mut cycle = stack[pos..].to_vec();
                        cycle.push(key.clone());
                        panic!(
                            "Template expansion error: Template expansion cycle detected: {}",
                            cycle.join(" -> ")
                        );
                    }

                    let expanded_args: Vec<Node> = children[1..]
                        .iter()
                        .map(|arg| expand_templates(arg, env, stack))
                        .collect();
                    stack.push(key.clone());
                    let instantiated =
                        substitute_template_placeholders(&decl.body, &decl.params, &expanded_args);
                    let expanded = expand_templates(&instantiated, env, stack);
                    stack.pop();
                    return expanded;
                }
            }
            Node::List(
                children
                    .iter()
                    .map(|child| expand_templates(child, env, stack))
                    .collect(),
            )
        }
    }
}

// ========== Evaluator ==========

/// Evaluate a node in arithmetic context — numeric literals are NOT clamped to the logic range.
fn eval_arith(node: &Node, env: &mut Env) -> f64 {
    if let Node::Leaf(ref s) = node {
        if is_num(s) {
            return s.parse::<f64>().unwrap_or(0.0);
        }
    }
    match eval_node(node, env) {
        EvalResult::Term(term) => eval_arith(&term, env),
        other => other.as_f64(),
    }
}

fn eval_term_node(node: &Node, env: &mut Env) -> Node {
    if let Node::List(children) = node {
        if children.len() == 4 {
            if let (Node::Leaf(head), Node::Leaf(var_name)) = (&children[0], &children[2]) {
                if head == "subst" {
                    let term = eval_term_node(&children[1], env);
                    let replacement = eval_term_node(&children[3], env);
                    let reduced = subst(&term, var_name, &replacement);
                    return eval_term_node(&reduced, env);
                }
            }
        }

        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "apply" {
                    let fn_node = &children[1];
                    let arg = eval_term_node(&children[2], env);
                    if let Node::List(fn_children) = fn_node {
                        if fn_children.len() == 3 {
                            if let Node::Leaf(fn_head) = &fn_children[0] {
                                if fn_head == "lambda" {
                                    if let Some((param_name, _)) = parse_binding(&fn_children[1]) {
                                        let reduced = subst(&fn_children[2], &param_name, &arg);
                                        return eval_term_node(&reduced, env);
                                    }
                                }
                            }
                        }
                    }
                    if let Node::Leaf(fn_name) = fn_node {
                        if let Some(lambda) = env.get_lambda(fn_name).cloned() {
                            let reduced = subst(&lambda.body, &lambda.param, &arg);
                            return eval_term_node(&reduced, env);
                        }
                    }
                }
            }
        }

        if children.len() >= 2 {
            if let Node::List(head_children) = &children[0] {
                if head_children.len() == 3 {
                    if let Node::Leaf(fn_head) = &head_children[0] {
                        if fn_head == "lambda" {
                            if let Some((param_name, _)) = parse_binding(&head_children[1]) {
                                let arg = eval_term_node(&children[1], env);
                                let reduced = subst(&head_children[2], &param_name, &arg);
                                if children.len() == 2 {
                                    return eval_term_node(&reduced, env);
                                }
                                let mut next = vec![reduced];
                                next.extend_from_slice(&children[2..]);
                                return eval_term_node(&Node::List(next), env);
                            }
                        }
                    }
                }
            }
        }
    }
    node.clone()
}

fn normalize_term(node: &Node, env: &mut Env, options: ConvertOptions) -> Node {
    if let Node::List(children) = node {
        if children.is_empty() {
            return Node::List(vec![]);
        }

        if children.len() == 4 {
            if let (Node::Leaf(head), Node::Leaf(var_name)) = (&children[0], &children[2]) {
                if head == "subst" {
                    let term = normalize_term(&children[1], env, options);
                    let replacement = normalize_term(&children[3], env, options);
                    let reduced = subst(&term, var_name, &replacement);
                    return normalize_term(&reduced, env, options);
                }
            }
        }

        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "apply" {
                    // Normalize the head (fn) position first so beta-redexes
                    // exposed by inner reductions are caught here. Without
                    // this, terms like `(apply (apply (apply compose succ)
                    // succ) zero)` would print as nested `apply` calls.
                    let fn_node = normalize_term(&children[1], env, options);
                    let arg = normalize_term(&children[2], env, options);
                    if let Node::List(fn_children) = &fn_node {
                        if fn_children.len() == 3 {
                            if let Node::Leaf(fn_head) = &fn_children[0] {
                                if fn_head == "lambda" {
                                    if let Some((param_name, _)) = parse_binding(&fn_children[1]) {
                                        let reduced = subst(&fn_children[2], &param_name, &arg);
                                        return normalize_term(&reduced, env, options);
                                    }
                                }
                            }
                        }
                    }
                    if let Node::Leaf(fn_name) = &fn_node {
                        let resolved = env.resolve_qualified(fn_name);
                        let lambda = env
                            .get_lambda(fn_name)
                            .cloned()
                            .or_else(|| env.get_lambda(&resolved).cloned());
                        if let Some(lambda) = lambda {
                            let reduced = subst(&lambda.body, &lambda.param, &arg);
                            return normalize_term(&reduced, env, options);
                        }
                    }
                    return Node::List(vec![Node::Leaf("apply".into()), fn_node, arg]);
                }

                if head == "lambda" {
                    let candidate = Node::List(vec![
                        Node::Leaf("lambda".into()),
                        normalize_term(&children[1], env, options),
                        normalize_term(&children[2], env, options),
                    ]);
                    return eta_contract(&candidate, env, options);
                }
            }
        }

        if children.len() >= 2 {
            if let Node::List(head_children) = &children[0] {
                if head_children.len() == 3 {
                    if let Node::Leaf(fn_head) = &head_children[0] {
                        if fn_head == "lambda" {
                            if let Some((param_name, _)) = parse_binding(&head_children[1]) {
                                let arg = normalize_term(&children[1], env, options);
                                let reduced = subst(&head_children[2], &param_name, &arg);
                                if children.len() == 2 {
                                    return normalize_term(&reduced, env, options);
                                }
                                let mut next = vec![reduced];
                                next.extend_from_slice(&children[2..]);
                                return normalize_term(&Node::List(next), env, options);
                            }
                        }
                    }
                }
            }
        }

        if children.len() >= 2 {
            if let Node::Leaf(head) = &children[0] {
                let resolved = env.resolve_qualified(head);
                let lambda = env
                    .get_lambda(head)
                    .cloned()
                    .or_else(|| env.get_lambda(&resolved).cloned());
                if let Some(lambda) = lambda {
                    let arg = normalize_term(&children[1], env, options);
                    let reduced = subst(&lambda.body, &lambda.param, &arg);
                    if children.len() == 2 {
                        return normalize_term(&reduced, env, options);
                    }
                    let mut next = vec![reduced];
                    next.extend_from_slice(&children[2..]);
                    return normalize_term(&Node::List(next), env, options);
                }
            }
        }

        return Node::List(
            children
                .iter()
                .map(|child| normalize_term(child, env, options))
                .collect(),
        );
    }
    node.clone()
}

/// Weak-head normal form (D4): reduce the spine of `node` — i.e. unfold the
/// head as long as there are arguments to apply to it — without descending
/// into binders or argument positions. Mirrors `whnfTerm` in the JS runtime
/// and `nf`/`is_convertible` already use `normalize_term` for the full
/// version. Substitution may expose a redex inside the residual body, but
/// that is no longer on the original spine, so this routine returns it
/// unevaluated; full normalization is the place that descends into those
/// positions.
pub fn whnf_term(node: &Node, env: &mut Env, options: ConvertOptions) -> Node {
    if let Node::List(children) = node {
        if children.is_empty() {
            return Node::List(vec![]);
        }
        if children.len() == 4 {
            if let (Node::Leaf(head), Node::Leaf(var_name)) = (&children[0], &children[2]) {
                if head == "subst" {
                    let term = whnf_term(&children[1], env, options);
                    let replacement = children[3].clone();
                    let reduced = subst(&term, var_name, &replacement);
                    return whnf_term(&reduced, env, options);
                }
            }
        }
    }

    // Collect the leftmost-outermost `apply` spine into [head, arg1, arg2, ...]
    // so the loop below can β-reduce against any number of arguments without
    // re-entering whnf_term (which would descend into the substituted body's
    // spine and over-reduce — see the test "leaves arguments unevaluated").
    let mut spine_args: Vec<Node> = Vec::new();
    let mut head_node = node.clone();
    loop {
        if let Node::List(children) = &head_node {
            if children.len() == 3 {
                if let Node::Leaf(h) = &children[0] {
                    if h == "apply" {
                        spine_args.insert(0, children[2].clone());
                        head_node = children[1].clone();
                        continue;
                    }
                }
            }
        }
        break;
    }

    // Prefix-call shape: `(f arg1 arg2 ...)` where `f` is a lambda value or a
    // bound name. Drain that into the spine before reducing.
    if spine_args.is_empty() {
        if let Node::List(children) = head_node.clone() {
            if children.len() > 1 {
                let head_is_lambda = matches!(
                    &children[0],
                    Node::List(lc)
                        if lc.len() == 3
                            && matches!(&lc[0], Node::Leaf(h) if h == "lambda")
                );
                let head_is_name = matches!(
                    &children[0],
                    Node::Leaf(name)
                        if name != "apply"
                            && name != "lambda"
                            && name != "Pi"
                            && name != "fresh"
                            && name != "subst"
                );
                if head_is_lambda || head_is_name {
                    head_node = children[0].clone();
                    spine_args.extend(children[1..].iter().cloned());
                }
            }
        }
    }

    // Drain the spine by β-reducing against the head. Stop as soon as the
    // head can no longer reduce (not a lambda, not a bound name) or there
    // are no remaining args.
    while !spine_args.is_empty() {
        let lambda_match = if let Node::List(hc) = &head_node {
            if hc.len() == 3 {
                if let Node::Leaf(h) = &hc[0] {
                    if h == "lambda" {
                        parse_binding(&hc[1]).map(|(p, _)| (p, hc[2].clone()))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        if let Some((param, body)) = lambda_match {
            let arg = spine_args.remove(0);
            head_node = subst(&body, &param, &arg);
            continue;
        }
        if let Node::Leaf(name) = &head_node {
            let resolved = env.resolve_qualified(name);
            let lambda = env
                .get_lambda(name)
                .cloned()
                .or_else(|| env.get_lambda(&resolved).cloned());
            if let Some(lambda) = lambda {
                let arg = spine_args.remove(0);
                head_node = subst(&lambda.body, &lambda.param, &arg);
                continue;
            }
        }
        break;
    }

    if spine_args.is_empty() {
        return head_node;
    }
    // Stuck spine: rebuild the unreduced applies around the residual head.
    let mut stuck = head_node;
    for arg in spine_args {
        stuck = Node::List(vec![Node::Leaf("apply".into()), stuck, arg]);
    }
    stuck
}

/// True for an `(apply head arg)` whose head is a free symbol the env
/// cannot reduce further — i.e. an applied constructor or other neutral.
/// The printed normal form drops the explicit `apply` keyword for these
/// neutrals so `(apply succ zero)` shows as `(succ zero)`, matching the
/// surface example in issue #50.
fn is_neutral_apply(node: &Node, env: &Env) -> bool {
    if let Node::List(children) = node {
        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "apply" {
                    if let Node::Leaf(name) = &children[1] {
                        if env.lambdas.contains_key(name) {
                            return false;
                        }
                        return is_variable_token(name);
                    }
                }
            }
        }
    }
    false
}

/// Drop the explicit `apply` keyword on neutral applications, recursively.
/// `(apply f a)` whose head is a free constructor-like symbol becomes
/// `(f a)` so the printed normal form matches the LiNo surface example
/// from issue #50: `(succ (succ zero))` rather than the explicit
/// `(apply succ (apply succ zero))`.
pub fn flatten_neutral_applies(node: &Node, env: &Env) -> Node {
    if let Node::List(children) = node {
        if children.is_empty() {
            return node.clone();
        }
        if let Some(binder) = binder_info(node) {
            let mut out = children.clone();
            out[binder.body_index] =
                flatten_neutral_applies(&children[binder.body_index], env);
            return Node::List(out);
        }
        let flattened: Vec<Node> = children
            .iter()
            .map(|child| flatten_neutral_applies(child, env))
            .collect();
        let candidate = Node::List(flattened.clone());
        if is_neutral_apply(&candidate, env) {
            return Node::List(vec![flattened[1].clone(), flattened[2].clone()]);
        }
        return candidate;
    }
    node.clone()
}

/// Public weak-head normal form API (issue #50, D4).
/// Reduces only the spine of `term` — leaves binders and arguments untouched.
pub fn whnf(term: &Node, env: &mut Env) -> Node {
    whnf_with_options(term, env, ConvertOptions::default())
}

/// Variant of [`whnf`] that takes an explicit [`ConvertOptions`].
pub fn whnf_with_options(term: &Node, env: &mut Env, options: ConvertOptions) -> Node {
    whnf_term(term, env, options)
}

/// Public full normal form API (issue #50, D4).
/// Reduces every redex in `term`, including those nested under binders and
/// in argument positions, until the term is in beta-(eta-)normal form. The
/// result is post-processed by [`flatten_neutral_applies`] so it prints in
/// the surface shape `(succ (succ zero))` from the issue.
pub fn nf(term: &Node, env: &mut Env) -> Node {
    nf_with_options(term, env, ConvertOptions::default())
}

/// Variant of [`nf`] that takes an explicit [`ConvertOptions`].
pub fn nf_with_options(term: &Node, env: &mut Env, options: ConvertOptions) -> Node {
    let normalized = normalize_term(term, env, options);
    flatten_neutral_applies(&normalized, env)
}

fn eta_contract(term: &Node, env: &mut Env, options: ConvertOptions) -> Node {
    if !options.eta {
        return term.clone();
    }
    let children = match term {
        Node::List(children) if children.len() == 3 => children,
        _ => return term.clone(),
    };
    if !matches!(&children[0], Node::Leaf(head) if head == "lambda") {
        return term.clone();
    }
    let bindings = parse_bindings(&children[1]).unwrap_or_default();
    if bindings.len() != 1 {
        return term.clone();
    }
    let param = &bindings[0].0;
    let body = &children[2];
    let fn_node = match body {
        Node::List(body_children) if body_children.len() == 3 => {
            if matches!(&body_children[0], Node::Leaf(head) if head == "apply")
                && is_structurally_same(&body_children[2], &Node::Leaf(param.clone()))
            {
                Some(body_children[1].clone())
            } else {
                None
            }
        }
        Node::List(body_children) if body_children.len() == 2 => {
            if is_structurally_same(&body_children[1], &Node::Leaf(param.clone())) {
                Some(body_children[0].clone())
            } else {
                None
            }
        }
        _ => None,
    };
    if let Some(fn_node) = fn_node {
        if !free_variables(&fn_node).contains(param) {
            return normalize_term(&fn_node, env, options);
        }
    }
    term.clone()
}

fn lookup_assigned_infix(env: &mut Env, op: &str, left: &Node, right: &Node) -> Option<f64> {
    let candidates = [
        Node::List(vec![
            Node::Leaf(op.to_string()),
            left.clone(),
            right.clone(),
        ]),
        Node::List(vec![
            left.clone(),
            Node::Leaf(op.to_string()),
            right.clone(),
        ]),
    ];
    for candidate in candidates {
        let key = key_of(&candidate);
        if let Some(&value) = env.assign.get(&key) {
            env.trace("lookup", format!("{} → {}", key, format_trace_value(value)));
            return Some(value);
        }
    }
    None
}

fn same_normalized_input(left: &Node, right: &Node, left_term: &Node, right_term: &Node) -> bool {
    is_structurally_same(left, left_term) && is_structurally_same(right, right_term)
}

fn explicit_symbol_number(node: &Node, env: &Env) -> Option<f64> {
    if let Node::Leaf(name) = node {
        if let Some(value) = env.symbol_prob.get(name) {
            return Some(*value);
        }
        let resolved = env.resolve_qualified(name);
        if resolved != *name {
            return env.symbol_prob.get(&resolved).copied();
        }
    }
    None
}

fn try_eval_numeric(node: &Node, env: &mut Env, options: ConvertOptions) -> Option<f64> {
    let term = normalize_term(node, env, options);
    match &term {
        Node::Leaf(s) if is_num(s) => s.parse::<f64>().ok(),
        Node::Leaf(_) => explicit_symbol_number(&term, env),
        Node::List(children) if children.is_empty() => None,
        Node::List(children) => {
            if children.len() == 3 {
                if let Node::Leaf(op) = &children[1] {
                    if matches!(op.as_str(), "+" | "-" | "*" | "/") {
                        let left = try_eval_numeric(&children[0], env, options)?;
                        let right = try_eval_numeric(&children[2], env, options)?;
                        return Some(env.apply_op(op, &[left, right]));
                    }
                    if matches!(op.as_str(), "and" | "or" | "both" | "neither") {
                        let left = try_eval_numeric(&children[0], env, options)?;
                        let right = try_eval_numeric(&children[2], env, options)?;
                        let value = env.apply_op(op, &[left, right]);
                        return Some(env.clamp(value));
                    }
                }
            }
            if let Node::Leaf(head) = &children[0] {
                if head != "=" && head != "!=" && env.has_op(head) {
                    let mut values = Vec::new();
                    for arg in &children[1..] {
                        values.push(try_eval_numeric(arg, env, options)?);
                    }
                    let value = env.apply_op(head, &values);
                    return Some(env.clamp(value));
                }
            }
            None
        }
    }
}

fn equality_truth_value(
    left: &Node,
    right: &Node,
    left_term: &Node,
    right_term: &Node,
    env: &mut Env,
    options: ConvertOptions,
) -> f64 {
    if let Some(value) = lookup_assigned_infix(env, "=", left, right) {
        return env.clamp(value);
    }
    if !same_normalized_input(left, right, left_term, right_term) {
        if let Some(value) = lookup_assigned_infix(env, "=", left_term, right_term) {
            return env.clamp(value);
        }
    }
    if is_structurally_same(left_term, right_term) {
        return env.hi;
    }
    let left_num = try_eval_numeric(left_term, env, options);
    let right_num = try_eval_numeric(right_term, env, options);
    if let (Some(left_num), Some(right_num)) = (left_num, right_num) {
        if dec_round(left_num) == dec_round(right_num) {
            env.hi
        } else {
            env.lo
        }
    } else {
        env.lo
    }
}

fn eval_equality_node(left: &Node, op: &str, right: &Node, env: &mut Env) -> EvalResult {
    let options = ConvertOptions::default();
    if let Some(value) = lookup_assigned_infix(env, op, left, right) {
        return EvalResult::Value(env.clamp(value));
    }
    let left_term = normalize_term(left, env, options);
    let right_term = normalize_term(right, env, options);
    if !same_normalized_input(left, right, &left_term, &right_term) {
        if let Some(value) = lookup_assigned_infix(env, op, &left_term, &right_term) {
            return EvalResult::Value(env.clamp(value));
        }
    }
    if op == "=" {
        let value = equality_truth_value(left, right, &left_term, &right_term, env, options);
        EvalResult::Value(env.clamp(value))
    } else {
        let eq = equality_truth_value(left, right, &left_term, &right_term, env, options);
        let value = env.apply_op("not", &[eq]);
        EvalResult::Value(env.clamp(value))
    }
}

/// Decide whether two terms are definitionally equal under the current
/// environment using beta-normalization and explicit equality assignments.
pub fn is_convertible(left: &Node, right: &Node, env: &mut Env) -> bool {
    is_convertible_with_options(left, right, env, ConvertOptions::default())
}

/// Variant of [`is_convertible`] with opt-in conversion features.
pub fn is_convertible_with_options(
    left: &Node,
    right: &Node,
    env: &mut Env,
    options: ConvertOptions,
) -> bool {
    if let Some(value) = lookup_assigned_infix(env, "=", left, right) {
        return env.clamp(value) == env.hi;
    }
    let left_term = normalize_term(left, env, options);
    let right_term = normalize_term(right, env, options);
    if !same_normalized_input(left, right, &left_term, &right_term) {
        if let Some(value) = lookup_assigned_infix(env, "=", &left_term, &right_term) {
            return env.clamp(value) == env.hi;
        }
    }
    is_structurally_same(&left_term, &right_term)
}

fn eval_reduced_term(reduced: &Node, env: &mut Env) -> EvalResult {
    let term = normalize_term(reduced, env, ConvertOptions::default());
    if has_unresolved_free_variables(&term, env) {
        EvalResult::Term(term)
    } else {
        eval_node(&term, env)
    }
}

fn context_has_name(env: &Env, name: &str) -> bool {
    if env.terms.contains(name)
        || env.types.contains_key(name)
        || env.lambdas.contains_key(name)
        || env.symbol_prob.contains_key(name)
        || env.ops.contains_key(name)
        || env.templates.contains_key(name)
    {
        return true;
    }
    let resolved = env.resolve_qualified(name);
    resolved != name
        && (env.terms.contains(&resolved)
            || env.types.contains_key(&resolved)
            || env.lambdas.contains_key(&resolved)
            || env.symbol_prob.contains_key(&resolved)
            || env.ops.contains_key(&resolved)
            || env.templates.contains_key(&resolved))
}

fn eval_fresh(var_name: &str, body: &Node, env: &mut Env) -> EvalResult {
    if context_has_name(env, var_name) {
        panic!(
            "Freshness error: fresh variable \"{}\" already appears in context",
            var_name
        );
    }
    let had_term = env.terms.contains(var_name);
    let previous_type = env.types.get(var_name).cloned();
    let previous_lambda = env.lambdas.get(var_name).cloned();
    let previous_symbol = env.symbol_prob.get(var_name).copied();
    env.terms.insert(var_name.to_string());
    let result = catch_unwind(AssertUnwindSafe(|| eval_node(body, env)));
    if !had_term {
        env.terms.remove(var_name);
    }
    if let Some(value) = previous_type {
        env.types.insert(var_name.to_string(), value);
    } else {
        env.types.remove(var_name);
    }
    if let Some(value) = previous_lambda {
        env.lambdas.insert(var_name.to_string(), value);
    } else {
        env.lambdas.remove(var_name);
    }
    if let Some(value) = previous_symbol {
        env.symbol_prob.insert(var_name.to_string(), value);
    } else {
        env.symbol_prob.remove(var_name);
    }
    match result {
        Ok(value) => value,
        Err(payload) => std::panic::resume_unwind(payload),
    }
}

// ========== Bidirectional Type Checker (issue #42) ==========
// Public API:
//     synth(term, env)                 -> SynthResult { typ, diagnostics }
//     check(term, expected_type, env)  -> CheckResult { ok, diagnostics }
//
// Mirrors the JavaScript `synth` / `check` helpers in `js/src/rml-links.mjs`.
//
// Synthesise mode walks the term and applies kernel rules for `(Type N)`,
// `(Pi ...)`, `(lambda ...)`, `(apply ...)`, `(subst ...)`, `(type of ...)`,
// and `(expr of T)`. Otherwise it falls back to the type recorded by
// `eval_node` in `env.types`.
//
// Check mode prefers a direct lambda-vs-Pi rule that opens the binder and
// recurses on the body; otherwise it switches modes by synthesising and
// comparing with definitional convertibility (`is_convertible`). Numeric
// literals accept any annotation — the kernel does not record number sorts
// directly, and equality with the expected type collapses through
// definitional convertibility downstream.
//
// Diagnostics use stable codes E020..E024 (see `docs/DIAGNOSTICS.md`).

/// Result of a `synth` call: the synthesised type as an AST node (or `None`
/// when synthesis fails) plus any diagnostics emitted along the way.
#[derive(Debug, Clone, Default)]
pub struct SynthResult {
    pub typ: Option<Node>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Result of a `check` call: a boolean indicating whether the term checks
/// against the expected type, plus any diagnostics emitted along the way.
#[derive(Debug, Clone, Default)]
pub struct CheckResult {
    pub ok: bool,
    pub diagnostics: Vec<Diagnostic>,
}

fn synth_span(env: &Env) -> Span {
    env.current_span.clone().unwrap_or_else(|| env.default_span.clone())
}

fn type_key_to_node(type_key: &str) -> Node {
    let trimmed = type_key.trim();
    if trimmed.starts_with('(') {
        let toks = tokenize_one(trimmed);
        if let Ok(parsed) = parse_one(&toks) {
            return parsed;
        }
    }
    Node::Leaf(type_key.to_string())
}

fn parse_term_input_str(s: &str) -> Node {
    let trimmed = s.trim();
    if trimmed.starts_with('(') {
        let toks = tokenize_one(trimmed);
        if let Ok(parsed) = parse_one(&toks) {
            return desugar_hoas(parsed);
        }
    }
    Node::Leaf(s.to_string())
}

struct TypeBindingSnapshot {
    name: String,
    had_term: bool,
    previous_type: Option<String>,
}

fn snapshot_type_binding(env: &Env, name: &str) -> TypeBindingSnapshot {
    TypeBindingSnapshot {
        name: name.to_string(),
        had_term: env.terms.contains(name),
        previous_type: env.types.get(name).cloned(),
    }
}

fn extend_type_binding(env: &mut Env, name: &str, type_key: &str) {
    env.terms.insert(name.to_string());
    env.types.insert(name.to_string(), type_key.to_string());
}

fn restore_type_binding(env: &mut Env, snap: TypeBindingSnapshot) {
    if !snap.had_term {
        env.terms.remove(&snap.name);
    }
    if let Some(value) = snap.previous_type {
        env.types.insert(snap.name, value);
    } else {
        env.types.remove(&snap.name);
    }
}

// Prenex polymorphism (D9): `(forall A T)` is sugar for `(Pi (Type A) T)`.
// `A` is a bound type variable ranging over the universe `Type`. Expansion
// happens at the outermost layer only — nested quantifiers desugar lazily as
// the type checker recurses into the body.
fn is_forall_node(node: &Node) -> bool {
    if let Node::List(children) = node {
        if children.len() == 3 {
            if let (Node::Leaf(head), Node::Leaf(_)) = (&children[0], &children[1]) {
                return head == "forall";
            }
        }
    }
    false
}

fn expand_forall(node: &Node) -> Node {
    if !is_forall_node(node) {
        return node.clone();
    }
    if let Node::List(children) = node {
        let var_name = match &children[1] {
            Node::Leaf(s) => s.clone(),
            _ => return node.clone(),
        };
        return Node::List(vec![
            Node::Leaf("Pi".to_string()),
            Node::List(vec![
                Node::Leaf("Type".to_string()),
                Node::Leaf(var_name),
            ]),
            children[2].clone(),
        ]);
    }
    node.clone()
}

fn types_agree(a: &Node, b: &Node, env: &mut Env) -> bool {
    let a_n = expand_forall(a);
    let b_n = expand_forall(b);
    if is_structurally_same(&a_n, &b_n) {
        return true;
    }
    let result = catch_unwind(AssertUnwindSafe(|| is_convertible(&a_n, &b_n, env)));
    matches!(result, Ok(true))
}

fn synth_leaf(name: &str, env: &mut Env) -> Option<Node> {
    if is_num(name) {
        return None;
    }
    let leaf = Node::Leaf(name.to_string());
    if let Some(recorded) = infer_type_key(&leaf, env) {
        return Some(type_key_to_node(&recorded));
    }
    let resolved = env.resolve_qualified(name);
    if resolved != name {
        if let Some(recorded) = env.types.get(&resolved).cloned() {
            return Some(type_key_to_node(&recorded));
        }
    }
    None
}

fn synth_apply(children: &[Node], env: &mut Env, span: &Span, diagnostics: &mut Vec<Diagnostic>) -> Option<Node> {
    let head = &children[1];
    let arg = &children[2];
    let inner = synth(head, env);
    diagnostics.extend(inner.diagnostics);
    let fn_type = match inner.typ {
        Some(t) => t,
        None => {
            diagnostics.push(Diagnostic::new(
                "E020",
                format!(
                    "Cannot synthesize type of `{}` in `{}`",
                    key_of(head),
                    key_of(&Node::List(children.to_vec()))
                ),
                span.clone(),
            ));
            return None;
        }
    };
    // Prenex polymorphism (D9): `(forall A T)` desugars to `(Pi (Type A) T)`,
    // so type-application `(apply f Natural)` reduces by substituting `A := Natural`
    // in the body just like a regular Pi-type does.
    let fn_type = expand_forall(&fn_type);
    let pi_children = match &fn_type {
        Node::List(c) if c.len() == 3 && matches!(&c[0], Node::Leaf(s) if s == "Pi") => c.clone(),
        _ => {
            diagnostics.push(Diagnostic::new(
                "E022",
                format!(
                    "Application head `{}` has type `{}`, expected a Pi-type",
                    key_of(head),
                    key_of(&fn_type)
                ),
                span.clone(),
            ));
            return None;
        }
    };
    let (param_name, param_type_key) = match parse_binding(&pi_children[1]) {
        Some(b) => b,
        None => {
            diagnostics.push(Diagnostic::new(
                "E022",
                format!(
                    "Application head has malformed Pi binder `{}`",
                    key_of(&pi_children[1])
                ),
                span.clone(),
            ));
            return None;
        }
    };
    let domain_node = type_key_to_node(&param_type_key);
    let arg_check = check(arg, &domain_node, env);
    diagnostics.extend(arg_check.diagnostics);
    if !arg_check.ok {
        return None;
    }
    Some(subst(&pi_children[2], &param_name, arg))
}

fn synth_lambda(children: &[Node], env: &mut Env, span: &Span, diagnostics: &mut Vec<Diagnostic>) -> Option<Node> {
    let (param_name, param_type_key) = match parse_binding(&children[1]) {
        Some(b) => b,
        None => {
            diagnostics.push(Diagnostic::new(
                "E024",
                format!("Lambda has malformed binder `{}`", key_of(&children[1])),
                span.clone(),
            ));
            return None;
        }
    };
    let snap = snapshot_type_binding(env, &param_name);
    extend_type_binding(env, &param_name, &param_type_key);
    let body_synth = synth(&children[2], env);
    restore_type_binding(env, snap);
    diagnostics.extend(body_synth.diagnostics);
    let body_type = body_synth.typ?;
    Some(Node::List(vec![
        Node::Leaf("Pi".to_string()),
        Node::List(vec![
            Node::Leaf(param_type_key),
            Node::Leaf(param_name),
        ]),
        body_type,
    ]))
}

fn synth_of_membership(children: &[Node], env: &mut Env, _span: &Span, diagnostics: &mut Vec<Diagnostic>) -> Option<Node> {
    let result = check(&children[0], &children[2], env);
    diagnostics.extend(result.diagnostics);
    if !result.ok {
        return None;
    }
    Some(Node::List(vec![
        Node::Leaf("Type".to_string()),
        Node::Leaf("0".to_string()),
    ]))
}

/// Synthesise the type of `term` under `env`.
///
/// On success, `SynthResult.typ` carries the inferred type as a `Node` AST.
/// On failure, `typ` is `None` and `diagnostics` carries one or more
/// `E020..E024` diagnostics describing the obstruction.
pub fn synth(term: &Node, env: &mut Env) -> SynthResult {
    let span = synth_span(env);
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    match term {
        Node::Leaf(name) => {
            if let Some(t) = synth_leaf(name, env) {
                return SynthResult { typ: Some(t), diagnostics };
            }
            if !is_num(name) {
                diagnostics.push(Diagnostic::new(
                    "E020",
                    format!("Cannot synthesize type of symbol `{}`", name),
                    span,
                ));
            }
            SynthResult { typ: None, diagnostics }
        }
        Node::List(children) => {
            // (Type N) : (Type N+1)
            if children.len() == 2 {
                if let Node::Leaf(head) = &children[0] {
                    if head == "Type" {
                        if let Some(univ) = universe_type_key(term) {
                            return SynthResult {
                                typ: Some(type_key_to_node(&univ)),
                                diagnostics,
                            };
                        }
                        diagnostics.push(Diagnostic::new(
                            "E020",
                            format!(
                                "Universe `{}` has invalid level token `{}`",
                                key_of(term),
                                key_of(&children[1])
                            ),
                            span,
                        ));
                        return SynthResult { typ: None, diagnostics };
                    }
                }
            }

            // (Prop) : (Type 1)
            if children.len() == 1 {
                if let Node::Leaf(head) = &children[0] {
                    if head == "Prop" {
                        return SynthResult {
                            typ: Some(Node::List(vec![
                                Node::Leaf("Type".to_string()),
                                Node::Leaf("1".to_string()),
                            ])),
                            diagnostics,
                        };
                    }
                }
            }

            if children.len() == 3 {
                if let Node::Leaf(head) = &children[0] {
                    match head.as_str() {
                        "forall" => {
                            // (forall A T) : (Type 0) — prenex polymorphism (D9). `A` is bound
                            // as a type variable ranging over `Type`; the body `T` is the
                            // polymorphic type. Synthesise by recursing on the desugared form.
                            let expanded = expand_forall(term);
                            let inner = synth(&expanded, env);
                            diagnostics.extend(inner.diagnostics);
                            return SynthResult { typ: inner.typ, diagnostics };
                        }
                        "Pi" => {
                            if parse_binding(&children[1]).is_none() {
                                diagnostics.push(Diagnostic::new(
                                    "E024",
                                    format!("Pi has malformed binder `{}`", key_of(&children[1])),
                                    span,
                                ));
                                return SynthResult { typ: None, diagnostics };
                            }
                            return SynthResult {
                                typ: Some(Node::List(vec![
                                    Node::Leaf("Type".to_string()),
                                    Node::Leaf("0".to_string()),
                                ])),
                                diagnostics,
                            };
                        }
                        "lambda" => {
                            let t = synth_lambda(children, env, &span, &mut diagnostics);
                            return SynthResult { typ: t, diagnostics };
                        }
                        "apply" => {
                            let t = synth_apply(children, env, &span, &mut diagnostics);
                            return SynthResult { typ: t, diagnostics };
                        }
                        "type" => {
                            if let Node::Leaf(of_kw) = &children[1] {
                                if of_kw == "of" {
                                    let inner = synth(&children[2], env);
                                    diagnostics.extend(inner.diagnostics);
                                    if inner.typ.is_some() {
                                        return SynthResult {
                                            typ: Some(Node::List(vec![
                                                Node::Leaf("Type".to_string()),
                                                Node::Leaf("0".to_string()),
                                            ])),
                                            diagnostics,
                                        };
                                    }
                                    diagnostics.push(Diagnostic::new(
                                        "E020",
                                        format!(
                                            "Cannot synthesize type referenced by `{}`",
                                            key_of(term)
                                        ),
                                        span,
                                    ));
                                    return SynthResult { typ: None, diagnostics };
                                }
                            }
                        }
                        _ => {}
                    }
                }
                // (expr of T)
                if let Node::Leaf(of_kw) = &children[1] {
                    if of_kw == "of" {
                        let t = synth_of_membership(children, env, &span, &mut diagnostics);
                        return SynthResult { typ: t, diagnostics };
                    }
                }
            }

            // (subst term x replacement)
            if children.len() == 4 {
                if let (Node::Leaf(head), Node::Leaf(name)) = (&children[0], &children[2]) {
                    if head == "subst" {
                        let reduced = subst(&children[1], name, &children[3]);
                        let inner = synth(&reduced, env);
                        diagnostics.extend(inner.diagnostics);
                        return SynthResult { typ: inner.typ, diagnostics };
                    }
                }
            }

            // Fallback: types recorded by eval_node.
            if let Some(recorded) = infer_type_key(term, env) {
                return SynthResult {
                    typ: Some(type_key_to_node(&recorded)),
                    diagnostics,
                };
            }

            diagnostics.push(Diagnostic::new(
                "E020",
                format!("Cannot synthesize type of `{}`", key_of(term)),
                span,
            ));
            SynthResult { typ: None, diagnostics }
        }
    }
}

/// Check `term` against `expected_type` under `env`.
///
/// Returns `CheckResult { ok: true, diagnostics: [] }` on success.
/// On failure, `ok` is `false` and `diagnostics` carries one or more
/// `E020..E024` diagnostics describing the obstruction.
pub fn check(term: &Node, expected_type: &Node, env: &mut Env) -> CheckResult {
    let span = synth_span(env);
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    // Prenex polymorphism (D9): `(forall A T)` is sugar for `(Pi (Type A) T)`.
    // Expand once here so the lambda-vs-Pi rule below applies uniformly.
    let expanded;
    let expected_type = if is_forall_node(expected_type) {
        expanded = expand_forall(expected_type);
        &expanded
    } else {
        expected_type
    };

    // Direct rule: (lambda (A x) body) checked against (Pi (A' y) B).
    if let (Node::List(lc), Node::List(ec)) = (term, expected_type) {
        if lc.len() == 3 && ec.len() == 3 {
            let lambda_head = matches!(&lc[0], Node::Leaf(s) if s == "lambda");
            let pi_head = matches!(&ec[0], Node::Leaf(s) if s == "Pi");
            if lambda_head && pi_head {
                let lambda_binding = parse_binding(&lc[1]);
                let pi_binding = parse_binding(&ec[1]);
                if let (Some((lname, ltype)), Some((pname, ptype))) = (lambda_binding, pi_binding) {
                    let lparam_node = parse_term_input_str(&ltype);
                    let pparam_node = parse_term_input_str(&ptype);
                    if !types_agree(&lparam_node, &pparam_node, env) {
                        diagnostics.push(Diagnostic::new(
                            "E021",
                            format!(
                                "Lambda parameter type `{}` does not match Pi domain `{}`",
                                ltype, ptype
                            ),
                            span,
                        ));
                        return CheckResult { ok: false, diagnostics };
                    }
                    let codomain = subst(&ec[2], &pname, &Node::Leaf(lname.clone()));
                    let snap = snapshot_type_binding(env, &lname);
                    extend_type_binding(env, &lname, &ltype);
                    let body_result = check(&lc[2], &codomain, env);
                    restore_type_binding(env, snap);
                    diagnostics.extend(body_result.diagnostics);
                    return CheckResult {
                        ok: body_result.ok,
                        diagnostics,
                    };
                }
            }
        }
    }

    // Lambda checked against non-Pi expected type.
    if let Node::List(lc) = term {
        if lc.len() == 3 && matches!(&lc[0], Node::Leaf(s) if s == "lambda") {
            let expected_is_pi = matches!(
                expected_type,
                Node::List(ec) if ec.len() == 3 && matches!(&ec[0], Node::Leaf(s) if s == "Pi")
            );
            if !expected_is_pi {
                diagnostics.push(Diagnostic::new(
                    "E023",
                    format!(
                        "Lambda `{}` cannot check against non-Pi type `{}`",
                        key_of(term),
                        key_of(expected_type)
                    ),
                    span,
                ));
                return CheckResult { ok: false, diagnostics };
            }
        }
    }

    // Numeric literal: accept any non-empty annotation.
    if let Node::Leaf(name) = term {
        if is_num(name) {
            return CheckResult { ok: true, diagnostics };
        }
    }

    // Default mode-switch: synthesise and compare with definitional equality.
    let synth_result = synth(term, env);
    diagnostics.extend(synth_result.diagnostics);
    let actual = match synth_result.typ {
        Some(t) => t,
        None => return CheckResult { ok: false, diagnostics },
    };
    let ok = types_agree(&actual, expected_type, env);
    if !ok {
        diagnostics.push(Diagnostic::new(
            "E021",
            format!(
                "Type mismatch: `{}` has type `{}`, expected `{}`",
                key_of(term),
                key_of(&actual),
                key_of(expected_type)
            ),
            span,
        ));
    }
    CheckResult { ok, diagnostics }
}

// ========== Proof derivations (issue #35) ==========
// A derivation is a Node tree of the form `(by <rule> <subderivation>...)`.
// Building it on the same `Node` type as the AST means the existing
// `key_of` (print) and `parse_one(tokenize_one(...))` (parse) helpers give
// the round-trip property `parse(print(proof)) == proof` for free, without
// needing a separate proof format. Mirrors `buildProof` in
// `js/src/rml-links.mjs` so cross-runtime proofs match exactly.
//
// The walker is intentionally read-only — it never mutates the env beyond
// the lookups that `eval_node` would have performed during evaluation, so
// enabling proofs cannot change query results. Sub-derivations recurse
// through `build_proof` so every sub-expression carries its own witness
// rather than collapsing into the literal value.
fn wrap_proof(rule: &str, subs: Vec<Node>) -> Node {
    let mut out = Vec::with_capacity(subs.len() + 2);
    out.push(Node::Leaf("by".to_string()));
    out.push(Node::Leaf(rule.to_string()));
    out.extend(subs);
    Node::List(out)
}

fn leaf(s: &str) -> Node {
    Node::Leaf(s.to_string())
}

/// Strip an optional trailing `with proof` from a query body. Both
/// `(? expr with proof)` and `(? (expr) with proof)` are accepted. Mirrors
/// `_stripWithProof` in the JavaScript implementation.
fn strip_with_proof(parts: &[Node]) -> &[Node] {
    if parts.len() >= 3 {
        if let (Node::Leaf(w), Node::Leaf(p)) =
            (&parts[parts.len() - 2], &parts[parts.len() - 1])
        {
            if w == "with" && p == "proof" {
                return &parts[..parts.len() - 2];
            }
        }
    }
    parts
}

/// Detect whether a top-level `(? ...)` form explicitly requested a proof
/// via the inline `with proof` keyword pair. Used to populate the per-query
/// proof slot even when the global `with_proofs` option is off. Mirrors
/// `_queryRequestsProof` in the JavaScript implementation.
fn query_requests_proof(node: &Node) -> bool {
    if let Node::List(children) = node {
        if let Some(Node::Leaf(head)) = children.first() {
            if head == "?" {
                let parts = &children[1..];
                if parts.len() >= 3 {
                    if let (Node::Leaf(w), Node::Leaf(p)) =
                        (&parts[parts.len() - 2], &parts[parts.len() - 1])
                    {
                        return w == "with" && p == "proof";
                    }
                }
            }
        }
    }
    false
}

/// Read-only beta-normalization used by equality-layer classification.
/// Unlike `normalize_term`, this helper only handles the on-the-fly
/// `(apply (lambda (T x) body) arg)` redex shape and recurses into other
/// nodes structurally. That keeps it free of `&mut Env` so it can run from
/// the immutable `build_proof` walker without cloning the environment.
fn pure_beta_normalize(node: &Node) -> Node {
    if let Node::List(children) = node {
        if children.len() == 3 {
            if let Node::Leaf(head) = &children[0] {
                if head == "apply" {
                    let fn_n = pure_beta_normalize(&children[1]);
                    let arg = pure_beta_normalize(&children[2]);
                    if let Node::List(fn_children) = &fn_n {
                        if fn_children.len() == 3 {
                            if let Node::Leaf(fn_head) = &fn_children[0] {
                                if fn_head == "lambda" {
                                    if let Some((param, _)) =
                                        parse_binding(&fn_children[1])
                                    {
                                        let reduced =
                                            subst(&fn_children[2], &param, &arg);
                                        return pure_beta_normalize(&reduced);
                                    }
                                }
                            }
                        }
                    }
                    return Node::List(vec![Node::Leaf("apply".into()), fn_n, arg]);
                }
            }
        }
        let normalized: Vec<Node> = children.iter().map(pure_beta_normalize).collect();
        return Node::List(normalized);
    }
    node.clone()
}

fn contains_lambda_or_apply(node: &Node) -> bool {
    if let Node::List(children) = node {
        if let Some(Node::Leaf(head)) = children.first() {
            if head == "lambda" || head == "apply" {
                return true;
            }
        }
        return children.iter().any(contains_lambda_or_apply);
    }
    false
}

/// Equality-layer classification used by both `build_proof` and the
/// per-query provenance walker. Precedence (issue #97): assigned >
/// structural > definitional > numeric. Returns the rule string verbatim
/// so JS and Rust emit identical labels.
pub fn classify_equality_rule(l: &Node, r: &Node, op: &str, env: &Env) -> &'static str {
    let is_inequality = op == "!=";
    let k_prefix = key_of(&Node::List(vec![leaf("="), l.clone(), r.clone()]));
    let k_infix = key_of(&Node::List(vec![l.clone(), leaf("="), r.clone()]));
    if env.assign.contains_key(&k_prefix) || env.assign.contains_key(&k_infix) {
        return if is_inequality {
            "assigned-inequality"
        } else {
            "assigned-equality"
        };
    }
    if is_structurally_same(l, r) {
        return if is_inequality {
            "structural-inequality"
        } else {
            "structural-equality"
        };
    }
    // Definitional equality: if one side contains a lambda/apply and both
    // sides beta-normalize to structurally-identical terms, the equality
    // holds by reduction rather than by raw arithmetic.
    if contains_lambda_or_apply(l) || contains_lambda_or_apply(r) {
        let ln = pure_beta_normalize(l);
        let rn = pure_beta_normalize(r);
        if is_structurally_same(&ln, &rn) && !is_structurally_same(l, r) {
            return if is_inequality {
                "definitional-inequality"
            } else {
                "definitional-equality"
            };
        }
    }
    if is_inequality {
        "numeric-inequality"
    } else {
        "numeric-equality"
    }
}

/// Strip an optional `with proof` suffix and then unwrap a singleton
/// container so `(? (a = b))` and `(? ((a = b)))` both yield `(a = b)`.
fn query_body_for_provenance(form: &Node) -> Option<Node> {
    if let Node::List(children) = form {
        if let Some(Node::Leaf(head)) = children.first() {
            if head == "?" {
                let stripped = strip_with_proof(&children[1..]);
                let mut body: Node = if stripped.len() == 1 {
                    stripped[0].clone()
                } else {
                    Node::List(stripped.to_vec())
                };
                loop {
                    match body {
                        Node::List(ref inner) if inner.len() == 1 => {
                            if matches!(&inner[0], Node::List(_)) {
                                body = inner[0].clone();
                            } else {
                                break;
                            }
                        }
                        _ => break,
                    }
                }
                return Some(body);
            }
        }
    }
    None
}

/// Return the equality-layer rule for a query whose body is a direct
/// equality, or `None` for any other query shape. Composite queries like
/// `((a = true) and (b = true))` are intentionally returned as `None`: the
/// per-equality rules still appear in the proof witness, but the surface
/// provenance describes the query itself.
pub fn equality_provenance_for_query(form: &Node, env: &Env) -> Option<String> {
    let body = query_body_for_provenance(form)?;
    if let Node::List(children) = &body {
        if children.len() == 3 {
            if let Node::Leaf(op) = &children[1] {
                if op == "=" || op == "!=" {
                    return Some(
                        classify_equality_rule(&children[0], &children[2], op, env)
                            .to_string(),
                    );
                }
            }
        }
    }
    None
}

/// Build a derivation tree witnessing how `node` reduces under `env`.
/// Returns a `Node::List` of the form `(by <rule> <subderivation>...)`.
///
/// The walker mirrors the structural cases of `eval_node`: definitions and
/// configuration directives become leaf witnesses, infix and prefix
/// operators become rule applications whose subderivations recurse through
/// `build_proof`, and equality picks `assigned-equality` /
/// `structural-equality` / `definitional-equality` / `numeric-equality`
/// (and the negated counterparts) based on the same lookups `eval_node`
/// performs — delegating to `classify_equality_rule` so both the proof
/// witness and the per-query provenance agree on which layer fired.
pub fn build_proof(node: &Node, env: &Env) -> Node {
    match node {
        // Numeric and bare-symbol leaves are axiomatic at this level.
        Node::Leaf(s) => {
            if is_num(s) {
                wrap_proof("literal", vec![leaf(s)])
            } else {
                wrap_proof("symbol", vec![leaf(s)])
            }
        }
        Node::List(children) => {
            // Definitions and operator redefs: (head: ...)
            if let Some(Node::Leaf(s)) = children.first() {
                if s.ends_with(':') {
                    return wrap_proof("definition", vec![node.clone()]);
                }
            }

            // Assignment: ((expr) has probability p)
            if children.len() == 4 {
                if let (Node::Leaf(w1), Node::Leaf(w2), Node::Leaf(w3)) =
                    (&children[1], &children[2], &children[3])
                {
                    if w1 == "has" && w2 == "probability" && is_num(w3) {
                        return wrap_proof(
                            "assigned-probability",
                            vec![children[0].clone(), leaf(w3)],
                        );
                    }
                }
            }

            // Range / valence configuration directives.
            if children.len() == 3 {
                if let (Node::Leaf(h), Node::Leaf(lo_s), Node::Leaf(hi_s)) =
                    (&children[0], &children[1], &children[2])
                {
                    if h == "range" && is_num(lo_s) && is_num(hi_s) {
                        return wrap_proof(
                            "configuration",
                            vec![leaf("range"), leaf(lo_s), leaf(hi_s)],
                        );
                    }
                }
            }
            if children.len() == 2 {
                if let (Node::Leaf(h), Node::Leaf(v)) = (&children[0], &children[1]) {
                    if h == "valence" && is_num(v) {
                        return wrap_proof(
                            "configuration",
                            vec![leaf("valence"), leaf(v)],
                        );
                    }
                }
            }

            // Query: (? expr) and the per-query proof form (? expr with proof)
            if let Some(Node::Leaf(head)) = children.first() {
                if head == "?" {
                    let parts = &children[1..];
                    let inner = strip_with_proof(parts);
                    let target = if inner.len() == 1 {
                        inner[0].clone()
                    } else {
                        Node::List(inner.to_vec())
                    };
                    return wrap_proof("query", vec![build_proof(&target, env)]);
                }
            }

            // Infix arithmetic: (A + B), (A - B), (A * B), (A / B)
            if children.len() == 3 {
                if let Node::Leaf(op_name) = &children[1] {
                    if matches!(op_name.as_str(), "+" | "-" | "*" | "/") {
                        let rule = match op_name.as_str() {
                            "+" => "sum",
                            "-" => "difference",
                            "*" => "product",
                            "/" => "quotient",
                            _ => unreachable!(),
                        };
                        return wrap_proof(
                            rule,
                            vec![build_proof(&children[0], env), build_proof(&children[2], env)],
                        );
                    }
                }
            }

            // Infix AND/OR/BOTH/NEITHER
            if children.len() == 3 {
                if let Node::Leaf(op_name) = &children[1] {
                    if matches!(op_name.as_str(), "and" | "or" | "both" | "neither") {
                        return wrap_proof(
                            op_name,
                            vec![build_proof(&children[0], env), build_proof(&children[2], env)],
                        );
                    }
                }
            }

            // Composite both/neither chains: (both A and B [and C ...]),
            // (neither A nor B [nor C ...]).
            if children.len() >= 4 && children.len() % 2 == 0 {
                if let Node::Leaf(head) = &children[0] {
                    if head == "both" || head == "neither" {
                        let sep = if head == "both" { "and" } else { "nor" };
                        let mut valid = true;
                        for i in (2..children.len()).step_by(2) {
                            if let Node::Leaf(s) = &children[i] {
                                if s != sep {
                                    valid = false;
                                    break;
                                }
                            } else {
                                valid = false;
                                break;
                            }
                        }
                        if valid {
                            let subs: Vec<Node> = (1..children.len())
                                .step_by(2)
                                .map(|i| build_proof(&children[i], env))
                                .collect();
                            return wrap_proof(head, subs);
                        }
                    }
                }
            }

            // Infix equality / inequality: (L = R), (L != R)
            if children.len() == 3 {
                if let Node::Leaf(op_name) = &children[1] {
                    if op_name == "=" || op_name == "!=" {
                        let l = &children[0];
                        let r = &children[2];
                        let rule = classify_equality_rule(l, r, op_name, env);
                        // Sub-derivation of equality preserves the original
                        // operands as a link so the witness reads
                        // `(by structural-equality (a a))` per the issue.
                        let pair = Node::List(vec![l.clone(), r.clone()]);
                        return wrap_proof(rule, vec![pair]);
                    }
                }
            }

            // ---------- Type system witnesses ----------
            if children.len() == 2 {
                if let (Node::Leaf(h), level) = (&children[0], &children[1]) {
                    if h == "Type" {
                        return wrap_proof("type-universe", vec![level.clone()]);
                    }
                }
            }
            if children.len() == 1 {
                if let Node::Leaf(h) = &children[0] {
                    if h == "Prop" {
                        return wrap_proof("prop", vec![]);
                    }
                }
            }
            if children.len() == 3 {
                if let Node::Leaf(h) = &children[0] {
                    if h == "Pi" {
                        return wrap_proof(
                            "pi-formation",
                            vec![children[1].clone(), children[2].clone()],
                        );
                    }
                    if h == "lambda" {
                        return wrap_proof(
                            "lambda-formation",
                            vec![children[1].clone(), children[2].clone()],
                        );
                    }
                    if h == "apply" {
                        return wrap_proof(
                            "beta-reduction",
                            vec![build_proof(&children[1], env), build_proof(&children[2], env)],
                        );
                    }
                }
            }
            // Normalization witnesses (issue #50, D4):
            //   `(whnf <expr>)` → `whnf-reduction`
            //   `(nf <expr>)` and `(normal-form <expr>)` → `nf-reduction`
            if children.len() == 2 {
                if let Node::Leaf(h) = &children[0] {
                    if h == "whnf" {
                        return wrap_proof("whnf-reduction", vec![children[1].clone()]);
                    }
                    if h == "nf" || h == "normal-form" {
                        return wrap_proof("nf-reduction", vec![children[1].clone()]);
                    }
                }
            }
            if children.len() == 4 {
                if let Node::Leaf(h) = &children[0] {
                    if h == "subst" {
                        return wrap_proof(
                            "substitution",
                            vec![
                                children[1].clone(),
                                children[2].clone(),
                                children[3].clone(),
                            ],
                        );
                    }
                    if h == "fresh" {
                        if let Node::Leaf(in_kw) = &children[2] {
                            if in_kw == "in" {
                                return wrap_proof(
                                    "fresh",
                                    vec![children[1].clone(), children[3].clone()],
                                );
                            }
                        }
                    }
                }
            }
            if children.len() == 3 {
                if let (Node::Leaf(h), Node::Leaf(m)) = (&children[0], &children[1]) {
                    if h == "type" && m == "of" {
                        return wrap_proof(
                            "type-query",
                            vec![children[2].clone()],
                        );
                    }
                }
                if let Node::Leaf(m) = &children[1] {
                    if m == "of" {
                        return wrap_proof(
                            "type-check",
                            vec![children[0].clone(), children[2].clone()],
                        );
                    }
                }
            }

            // Prefix operator: (op X Y ...)
            if let Node::Leaf(head) = &children[0] {
                if env.has_op(head) {
                    let subs: Vec<Node> = children[1..]
                        .iter()
                        .map(|arg| build_proof(arg, env))
                        .collect();
                    return wrap_proof(head, subs);
                }
            }

            // Fallback for unrecognised heads / named lambda applications.
            wrap_proof("reduce", vec![node.clone()])
        }
    }
}

// ========== Tactic engine (issues #55 and #56) ==========
// Tactics are ordinary links that transform an explicit proof state. Keeping
// goals, local assumptions, and tactic history as `Node` values preserves the
// project invariant that proof steps are links.

/// A single open proof goal plus its local hypothesis context.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofGoal {
    pub goal: Node,
    pub context: Vec<Node>,
}

impl ProofGoal {
    pub fn new(goal: Node) -> Self {
        Self {
            goal,
            context: Vec::new(),
        }
    }
}

/// A tactic proof state: open goals and the successful tactic links applied so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProofState {
    pub goals: Vec<ProofGoal>,
    pub proof: Vec<Node>,
}

impl ProofState {
    pub fn from_goals(goals: Vec<Node>) -> Self {
        Self {
            goals: goals.into_iter().map(ProofGoal::new).collect(),
            proof: Vec::new(),
        }
    }
}

/// Result of running tactics over a proof state.
#[derive(Debug, Clone, PartialEq)]
pub struct TacticRunResult {
    pub state: ProofState,
    pub diagnostics: Vec<Diagnostic>,
}

const DEFAULT_SIMPLIFY_MAX_STEPS: usize = 100;
const DEFAULT_ATP_TIMEOUT_MS: u64 = 5000;
const DEFAULT_SMT_TIMEOUT_MS: u64 = 5000;
const ATP_PROVED_STATUSES: &[&str] = &["Theorem", "Unsatisfiable", "ContradictoryAxioms"];
const ATP_UNKNOWN_STATUSES: &[&str] = &["Unknown", "GaveUp"];
const ATP_TIMEOUT_STATUSES: &[&str] = &["Timeout", "ResourceOut"];

/// Direction for applying an equality rewrite rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RewriteDirection {
    Forward,
    Backward,
}

/// Which occurrence of the left-hand side to rewrite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RewriteOccurrence {
    All,
    Index(usize),
}

/// Options for a single rewrite pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RewriteOptions {
    pub direction: RewriteDirection,
    pub occurrence: RewriteOccurrence,
}

impl Default for RewriteOptions {
    fn default() -> Self {
        Self {
            direction: RewriteDirection::Forward,
            occurrence: RewriteOccurrence::All,
        }
    }
}

/// Result of a single rewrite pass.
#[derive(Debug, Clone, PartialEq)]
pub struct RewriteResult {
    pub node: Node,
    pub changed: bool,
    pub count: usize,
}

/// Options for repeated simplification with a rewrite set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SimplifyOptions {
    pub max_steps: usize,
}

impl Default for SimplifyOptions {
    fn default() -> Self {
        Self {
            max_steps: DEFAULT_SIMPLIFY_MAX_STEPS,
        }
    }
}

/// Result of simplification by repeated rewrite passes.
#[derive(Debug, Clone, PartialEq)]
pub struct SimplifyResult {
    pub node: Node,
    pub changed: bool,
    pub steps: usize,
}

/// Configured external ATP invocation for the `(by atp)` tactic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtpOptions {
    pub path: Option<String>,
    pub args: Vec<String>,
    pub name: Option<String>,
    pub timeout_ms: u64,
}

impl Default for AtpOptions {
    fn default() -> Self {
        Self {
            path: None,
            args: Vec::new(),
            name: None,
            timeout_ms: DEFAULT_ATP_TIMEOUT_MS,
        }
    }
}

/// High-level classification of a parsed SZS ATP status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AtpStatusKind {
    Proved,
    Unknown,
    Timeout,
    Failure,
}

/// Parsed SZS status line from an ATP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtpStatus {
    pub status: String,
    pub kind: AtpStatusKind,
}

/// Options supplied to tactic execution.
#[derive(Debug, Clone, PartialEq)]
pub struct TacticOptions {
    pub rewrite_rules: Vec<Node>,
    pub simplify_max_steps: usize,
    pub atp: AtpOptions,
    pub smt_solver: Option<String>,
    pub smt_solver_args: Vec<String>,
    pub smt_timeout_ms: u64,
}

impl Default for TacticOptions {
    fn default() -> Self {
        Self {
            rewrite_rules: Vec::new(),
            simplify_max_steps: DEFAULT_SIMPLIFY_MAX_STEPS,
            atp: AtpOptions::default(),
            smt_solver: std::env::var("RML_SMT_SOLVER").ok(),
            smt_solver_args: std::env::var("RML_SMT_ARGS")
                .ok()
                .map(|args| {
                    args.split_whitespace()
                        .map(|arg| arg.to_string())
                        .collect()
                })
                .unwrap_or_default(),
            smt_timeout_ms: std::env::var("RML_SMT_TIMEOUT_MS")
                .ok()
                .and_then(|raw| raw.parse::<u64>().ok())
                .unwrap_or(DEFAULT_SMT_TIMEOUT_MS),
        }
    }
}

fn tactic_name(tactic: &Node) -> Option<&str> {
    match tactic {
        Node::Leaf(s) => Some(s.as_str()),
        Node::List(children) => match children.first() {
            Some(Node::Leaf(s)) => Some(s.as_str()),
            _ => None,
        },
    }
}

fn tactic_args(tactic: &Node) -> &[Node] {
    match tactic {
        Node::List(children) if !children.is_empty() => &children[1..],
        _ => &[],
    }
}

fn as_equality(node: &Node) -> Option<(&Node, &Node)> {
    if let Node::List(children) = node {
        if children.len() == 3 {
            if let Node::Leaf(op) = &children[1] {
                if op == "=" {
                    return Some((&children[0], &children[2]));
                }
            }
        }
    }
    None
}

fn tactic_diagnostic(
    tactic: &Node,
    goal: Option<&ProofGoal>,
    reason: impl AsRef<str>,
) -> Diagnostic {
    let goal_text = goal
        .map(|g| key_of(&g.goal))
        .unwrap_or_else(|| "<none>".to_string());
    Diagnostic::new(
        "E039",
        format!(
            "Tactic {} failed: {}; current goal: {}",
            key_of(tactic),
            reason.as_ref(),
            goal_text
        ),
        Span::unknown(),
    )
}

fn goal_with_context(current: &ProofGoal, goal: Node) -> ProofGoal {
    ProofGoal {
        goal,
        context: current.context.clone(),
    }
}

fn replace_current_goal(
    state: &ProofState,
    replacement_goals: Vec<ProofGoal>,
    record_tactic: &Node,
) -> ProofState {
    let mut goals = replacement_goals;
    goals.extend(state.goals.iter().skip(1).cloned());
    let mut proof = state.proof.clone();
    proof.push(record_tactic.clone());
    ProofState { goals, proof }
}

fn rewrite_diagnostic(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new("E039", message, Span::unknown())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SmtSort {
    Bool,
    Real,
}

impl SmtSort {
    fn as_str(self) -> &'static str {
        match self {
            SmtSort::Bool => "Bool",
            SmtSort::Real => "Real",
        }
    }
}

#[derive(Debug, Default)]
struct SmtContext {
    declarations: BTreeMap<String, SmtSort>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SmtStatus {
    Unsat,
    Sat,
    Unknown,
    Timeout,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SmtRunResult {
    status: SmtStatus,
    reason: String,
}

fn smt_escape_symbol(raw: &str) -> String {
    format!("|{}|", raw.replace('\\', "\\\\").replace('|', "\\|"))
}

fn smt_declare(ctx: &mut SmtContext, raw: String, sort: SmtSort) -> Result<String, String> {
    if let Some(existing) = ctx.declarations.get(&raw) {
        if *existing != sort {
            return Err(format!(
                "SMT symbol {} is used as both {} and {}",
                raw,
                existing.as_str(),
                sort.as_str()
            ));
        }
    }
    ctx.declarations.insert(raw.clone(), sort);
    Ok(smt_escape_symbol(&raw))
}

fn smt_number(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix('-') {
        format!("(- {})", rest)
    } else {
        raw.to_string()
    }
}

fn smt_infix<'a>(node: &'a Node, operators: &[&str]) -> Option<&'a str> {
    let Node::List(children) = node else {
        return None;
    };
    if children.len() != 3 {
        return None;
    }
    let Node::Leaf(op) = &children[1] else {
        return None;
    };
    if operators.contains(&op.as_str()) {
        Some(op.as_str())
    } else {
        None
    }
}

fn smt_is_boolish(node: &Node) -> bool {
    match node {
        Node::Leaf(s) => s == "true" || s == "false",
        Node::List(children) => {
            if children.is_empty() {
                return false;
            }
            if smt_infix(node, &["=", "!=", "and", "or", "=>", "implies"]).is_some() {
                return true;
            }
            matches!(
                &children[0],
                Node::Leaf(head)
                    if matches!(head.as_str(), "not" | "and" | "or" | "=>" | "implies")
            )
        }
    }
}

fn smt_term(node: &Node, ctx: &mut SmtContext) -> Result<String, String> {
    match node {
        Node::Leaf(s) => {
            if is_num(s) {
                return Ok(smt_number(s));
            }
            if s == "true" || s == "false" {
                return Err(format!(
                    "SMT bridge cannot use Boolean constant {} as a Real term",
                    s
                ));
            }
            smt_declare(ctx, s.clone(), SmtSort::Real)
        }
        Node::List(children) => {
            if children.is_empty() {
                return Err(format!("SMT bridge cannot translate term {}", key_of(node)));
            }
            if let Some(op) = smt_infix(node, &["+", "-", "*", "/"]) {
                return Ok(format!(
                    "({} {} {})",
                    op,
                    smt_term(&children[0], ctx)?,
                    smt_term(&children[2], ctx)?
                ));
            }
            if let Node::Leaf(head) = &children[0] {
                if ["+", "-", "*", "/"].contains(&head.as_str()) && children.len() >= 3 {
                    let args = children[1..]
                        .iter()
                        .map(|arg| smt_term(arg, ctx))
                        .collect::<Result<Vec<_>, _>>()?;
                    return Ok(format!("({} {})", head, args.join(" ")));
                }
            }
            smt_declare(ctx, key_of(node), SmtSort::Real)
        }
    }
}

fn smt_equality(left: &Node, right: &Node, ctx: &mut SmtContext) -> Result<String, String> {
    if smt_is_boolish(left) || smt_is_boolish(right) {
        return Ok(format!(
            "(= {} {})",
            smt_formula(left, ctx)?,
            smt_formula(right, ctx)?
        ));
    }
    Ok(format!(
        "(= {} {})",
        smt_term(left, ctx)?,
        smt_term(right, ctx)?
    ))
}

fn smt_formula(node: &Node, ctx: &mut SmtContext) -> Result<String, String> {
    match node {
        Node::Leaf(s) => {
            if s == "true" {
                return Ok("true".to_string());
            }
            if s == "false" {
                return Ok("false".to_string());
            }
            if is_num(s) {
                return Err(format!(
                    "SMT bridge cannot use numeric literal {} as a Boolean formula",
                    s
                ));
            }
            smt_declare(ctx, s.clone(), SmtSort::Bool)
        }
        Node::List(children) => {
            if children.is_empty() {
                return Err(format!("SMT bridge cannot translate formula {}", key_of(node)));
            }
            match smt_infix(node, &["=", "!=", "and", "or", "=>", "implies"]) {
                Some("=") => return smt_equality(&children[0], &children[2], ctx),
                Some("!=") => {
                    return Ok(format!(
                        "(not {})",
                        smt_equality(&children[0], &children[2], ctx)?
                    ));
                }
                Some("and") | Some("or") => {
                    let op = smt_infix(node, &["and", "or"]).unwrap();
                    return Ok(format!(
                        "({} {} {})",
                        op,
                        smt_formula(&children[0], ctx)?,
                        smt_formula(&children[2], ctx)?
                    ));
                }
                Some("=>") | Some("implies") => {
                    return Ok(format!(
                        "(=> {} {})",
                        smt_formula(&children[0], ctx)?,
                        smt_formula(&children[2], ctx)?
                    ));
                }
                _ => {}
            }

            if let Node::Leaf(head) = &children[0] {
                match head.as_str() {
                    "not" if children.len() == 2 => {
                        return Ok(format!("(not {})", smt_formula(&children[1], ctx)?));
                    }
                    "and" | "or" => {
                        if children.len() == 1 {
                            return Ok(if head == "and" {
                                "true".to_string()
                            } else {
                                "false".to_string()
                            });
                        }
                        let args = children[1..]
                            .iter()
                            .map(|arg| smt_formula(arg, ctx))
                            .collect::<Result<Vec<_>, _>>()?;
                        return Ok(format!("({} {})", head, args.join(" ")));
                    }
                    "=>" | "implies" if children.len() == 3 => {
                        return Ok(format!(
                            "(=> {} {})",
                            smt_formula(&children[1], ctx)?,
                            smt_formula(&children[2], ctx)?
                        ));
                    }
                    _ => {}
                }
            }

            smt_declare(ctx, key_of(node), SmtSort::Bool)
        }
    }
}

fn smt_lib_for_goal(goal: &Node) -> Result<String, String> {
    let mut ctx = SmtContext::default();
    let formula = smt_formula(goal, &mut ctx)?;
    let mut lines = Vec::new();
    for (name, sort) in ctx.declarations {
        lines.push(format!(
            "(declare-const {} {})",
            smt_escape_symbol(&name),
            sort.as_str()
        ));
    }
    lines.push(format!("(assert (not {}))", formula));
    lines.push("(check-sat)".to_string());
    lines.push("(exit)".to_string());
    lines.push(String::new());
    Ok(lines.join("\n"))
}

fn smt_solver_proof_name(options: &TacticOptions) -> String {
    let Some(solver) = options.smt_solver.as_deref() else {
        return "unconfigured".to_string();
    };
    let base = Path::new(solver)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(solver);
    let safe: String = base
        .chars()
        .map(|c| if c.is_whitespace() { '_' } else { c })
        .collect();
    if safe.is_empty() {
        "solver".to_string()
    } else {
        safe
    }
}

fn smt_trusted_node(options: &TacticOptions) -> Node {
    Node::List(vec![
        leaf("by"),
        leaf("smt-trusted"),
        Node::Leaf(smt_solver_proof_name(options)),
    ])
}

fn smt_process_summary(stdout: &[u8], stderr: &[u8]) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let stdout_text = String::from_utf8_lossy(stdout);
    let text = if stderr_text.trim().is_empty() {
        stdout_text.trim()
    } else {
        stderr_text.trim()
    };
    if text.is_empty() {
        return "<no output>".to_string();
    }
    let first = text.lines().next().unwrap_or(text);
    if first.chars().count() > 200 {
        format!("{}...", first.chars().take(200).collect::<String>())
    } else {
        first.to_string()
    }
}

fn parse_smt_check_sat(stdout: &[u8], stderr: &[u8]) -> Option<SmtStatus> {
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_text = String::from_utf8_lossy(stderr);
    for line in stdout_text.lines().chain(stderr_text.lines()) {
        match line.trim() {
            "unsat" => return Some(SmtStatus::Unsat),
            "sat" => return Some(SmtStatus::Sat),
            "unknown" => return Some(SmtStatus::Unknown),
            _ => {}
        }
    }
    None
}

fn run_smt_solver(smt_lib: &str, options: &TacticOptions) -> SmtRunResult {
    let Some(solver) = options
        .smt_solver
        .as_deref()
        .filter(|solver| !solver.trim().is_empty())
    else {
        return SmtRunResult {
            status: SmtStatus::Error,
            reason: "SMT solver path is not configured".to_string(),
        };
    };
    let solver_name = smt_solver_proof_name(options);
    let mut child = match Command::new(solver)
        .args(&options.smt_solver_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return SmtRunResult {
                status: SmtStatus::Error,
                reason: format!("SMT solver {} failed to start: {}", solver_name, err),
            };
        }
    };

    let mut stdin_error = None;
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(err) = stdin.write_all(smt_lib.as_bytes()) {
            stdin_error = Some(err.to_string());
        }
    }

    let started = Instant::now();
    let timeout = Duration::from_millis(options.smt_timeout_ms);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = match child.wait_with_output() {
                    Ok(output) => output,
                    Err(err) => {
                        return SmtRunResult {
                            status: SmtStatus::Error,
                            reason: format!(
                                "SMT solver {} output collection failed: {}",
                                solver_name, err
                            ),
                        };
                    }
                };
                if !output.status.success() {
                    return SmtRunResult {
                        status: SmtStatus::Error,
                        reason: format!(
                            "SMT solver {} exited with status {}: {}",
                            solver_name,
                            output.status,
                            smt_process_summary(&output.stdout, &output.stderr)
                        ),
                    };
                }
                let Some(status) = parse_smt_check_sat(&output.stdout, &output.stderr) else {
                    let reason = stdin_error
                        .map(|err| {
                            format!(
                                "SMT solver {} did not accept SMT-LIB input: {}",
                                solver_name, err
                            )
                        })
                        .unwrap_or_else(|| {
                            format!(
                                "SMT solver {} did not return sat, unsat, or unknown",
                                solver_name
                            )
                        });
                    return SmtRunResult {
                        status: SmtStatus::Error,
                        reason,
                    };
                };
                return SmtRunResult {
                    status,
                    reason: format!(
                        "SMT solver {} returned {}",
                        solver_name,
                        match status {
                            SmtStatus::Unsat => "unsat",
                            SmtStatus::Sat => "sat",
                            SmtStatus::Unknown => "unknown",
                            SmtStatus::Timeout | SmtStatus::Error => unreachable!(),
                        }
                    ),
                };
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return SmtRunResult {
                        status: SmtStatus::Timeout,
                        reason: format!(
                            "SMT solver {} timed out after {} ms",
                            solver_name, options.smt_timeout_ms
                        ),
                    };
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(err) => {
                return SmtRunResult {
                    status: SmtStatus::Error,
                    reason: format!("SMT solver {} wait failed: {}", solver_name, err),
                };
            }
        }
    }
}

fn tptp_identifier(raw: &str, role: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        cleaned = if role == "var" {
            "X".to_string()
        } else {
            "rml_symbol".to_string()
        };
    }
    if role == "var" {
        let mut chars = cleaned.chars();
        if let Some(first) = chars.next() {
            cleaned = first.to_ascii_uppercase().to_string() + chars.as_str();
        }
        if !cleaned
            .chars()
            .next()
            .map(|c| c.is_ascii_uppercase())
            .unwrap_or(false)
        {
            cleaned = format!("V_{}", cleaned);
        }
        return cleaned;
    }
    cleaned = cleaned.to_ascii_lowercase();
    if !cleaned
        .chars()
        .next()
        .map(|c| c.is_ascii_lowercase())
        .unwrap_or(false)
    {
        cleaned = format!("rml_{}", cleaned);
    }
    cleaned
}

fn tptp_term(node: &Node, bound_vars: &HashSet<String>) -> Result<String, Diagnostic> {
    match node {
        Node::Leaf(raw) => {
            if bound_vars.contains(raw) {
                Ok(tptp_identifier(raw, "var"))
            } else if is_num(raw) {
                Ok(tptp_identifier(&format!("num_{}", raw), "term"))
            } else {
                Ok(tptp_identifier(raw, "term"))
            }
        }
        Node::List(children) if !children.is_empty() => {
            let Node::Leaf(head) = &children[0] else {
                return Err(rewrite_diagnostic(format!(
                    "TPTP export supports first-order terms only (got {})",
                    key_of(node)
                )));
            };
            let args = children[1..]
                .iter()
                .map(|arg| tptp_term(arg, bound_vars))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("{}({})", tptp_identifier(head, "term"), args))
        }
        _ => Err(rewrite_diagnostic(format!(
            "TPTP export supports first-order terms only (got {})",
            key_of(node)
        ))),
    }
}

fn infix_operands<'a>(node: &'a Node, op: &str) -> Option<Vec<&'a Node>> {
    let Node::List(children) = node else {
        return None;
    };
    if children.len() < 3 || children.len() % 2 == 0 {
        return None;
    }
    let mut operands = Vec::new();
    let mut index = 0;
    while index < children.len() {
        if index > 0 && !matches!(&children[index - 1], Node::Leaf(mid) if mid == op) {
            return None;
        }
        operands.push(&children[index]);
        index += 2;
    }
    Some(operands)
}

fn tptp_join_formula(
    op: &str,
    operands: &[&Node],
    bound_vars: &HashSet<String>,
) -> Result<String, Diagnostic> {
    let parts = operands
        .iter()
        .map(|part| tptp_formula(part, bound_vars).map(|s| format!("({})", s)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join(&format!(" {} ", op)))
}

fn quantifier_parts<'a>(node: &'a Node) -> Result<Option<(&'a str, String, &'a Node)>, Diagnostic> {
    let Node::List(children) = node else {
        return Ok(None);
    };
    if children.len() != 3 {
        return Ok(None);
    }
    let Node::Leaf(head) = &children[0] else {
        return Ok(None);
    };
    if head != "forall" && head != "exists" && head != "Pi" {
        return Ok(None);
    }
    let Some((variable, _)) = parse_binding(&children[1]) else {
        return Err(rewrite_diagnostic(format!(
            "TPTP export could not parse quantifier binder {}",
            key_of(&children[1])
        )));
    };
    let quantifier = if head == "exists" { "?" } else { "!" };
    Ok(Some((quantifier, variable, &children[2])))
}

fn tptp_formula(node: &Node, bound_vars: &HashSet<String>) -> Result<String, Diagnostic> {
    match node {
        Node::Leaf(raw) => {
            if raw == "true" {
                return Ok("$true".to_string());
            }
            if raw == "false" {
                return Ok("$false".to_string());
            }
            if bound_vars.contains(raw) {
                return Ok(tptp_identifier(raw, "var"));
            }
            return Ok(tptp_identifier(raw, "pred"));
        }
        Node::List(children) if children.is_empty() => {
            return Err(rewrite_diagnostic(format!(
                "TPTP export supports first-order formulas only (got {})",
                key_of(node)
            )));
        }
        Node::List(_) => {}
    }

    if let Some((quantifier, variable, body)) = quantifier_parts(node)? {
        let mut next_bound = bound_vars.clone();
        next_bound.insert(variable.clone());
        return Ok(format!(
            "{}[{}] : ({})",
            quantifier,
            tptp_identifier(&variable, "var"),
            tptp_formula(body, &next_bound)?
        ));
    }

    if let Some((term, typ)) = type_ascription(node) {
        return Ok(format!(
            "{}({})",
            tptp_identifier(&key_of(typ), "pred"),
            tptp_term(term, bound_vars)?
        ));
    }

    if let Some((left, right)) = as_equality(node) {
        return Ok(format!(
            "{} = {}",
            tptp_term(left, bound_vars)?,
            tptp_term(right, bound_vars)?
        ));
    }
    if let Node::List(children) = node {
        if children.len() == 3 && matches!(&children[1], Node::Leaf(op) if op == "!=") {
            return Ok(format!(
                "{} != {}",
                tptp_term(&children[0], bound_vars)?,
                tptp_term(&children[2], bound_vars)?
            ));
        }
    }

    if let Some(operands) = infix_operands(node, "and") {
        return tptp_join_formula("&", &operands, bound_vars);
    }
    if let Some(operands) = infix_operands(node, "or") {
        return tptp_join_formula("|", &operands, bound_vars);
    }
    if let Some(operands) = infix_operands(node, "=>").or_else(|| infix_operands(node, "implies")) {
        if operands.len() == 2 {
            return tptp_join_formula("=>", &operands, bound_vars);
        }
    }
    if let Some(operands) = infix_operands(node, "<=>").or_else(|| infix_operands(node, "iff")) {
        if operands.len() == 2 {
            return tptp_join_formula("<=>", &operands, bound_vars);
        }
    }

    let Node::List(children) = node else {
        unreachable!();
    };
    let Node::Leaf(head) = &children[0] else {
        return Err(rewrite_diagnostic(format!(
            "TPTP export supports first-order formulas only (got {})",
            key_of(node)
        )));
    };
    match head.as_str() {
        "not" if children.len() == 2 => {
            Ok(format!("~({})", tptp_formula(&children[1], bound_vars)?))
        }
        "and" if children.len() >= 2 => {
            let operands: Vec<&Node> = children[1..].iter().collect();
            tptp_join_formula("&", &operands, bound_vars)
        }
        "or" if children.len() >= 2 => {
            let operands: Vec<&Node> = children[1..].iter().collect();
            tptp_join_formula("|", &operands, bound_vars)
        }
        "=>" | "implies" if children.len() == 3 => {
            let operands: Vec<&Node> = children[1..].iter().collect();
            tptp_join_formula("=>", &operands, bound_vars)
        }
        "<=>" | "iff" if children.len() == 3 => {
            let operands: Vec<&Node> = children[1..].iter().collect();
            tptp_join_formula("<=>", &operands, bound_vars)
        }
        _ => {
            let predicate = tptp_identifier(head, "pred");
            if children.len() == 1 {
                return Ok(predicate);
            }
            let args = children[1..]
                .iter()
                .map(|arg| tptp_term(arg, bound_vars))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("{}({})", predicate, args))
        }
    }
}

/// Export a proof goal plus local context as a TPTP FOF problem.
pub fn goal_to_tptp(goal: &ProofGoal) -> Result<String, Diagnostic> {
    let bound_vars = HashSet::new();
    let mut lines = Vec::new();
    for (index, ctx) in goal.context.iter().enumerate() {
        lines.push(format!(
            "fof(rml_context_{}, axiom, ({})).",
            index + 1,
            tptp_formula(ctx, &bound_vars)?
        ));
    }
    lines.push(format!(
        "fof(rml_goal, conjecture, ({})).",
        tptp_formula(&goal.goal, &bound_vars)?
    ));
    Ok(format!("{}\n", lines.join("\n")))
}

/// Parse the first SZS status line from ATP output.
pub fn parse_atp_status(output: &str) -> Option<AtpStatus> {
    let tokens: Vec<&str> = output.split_whitespace().collect();
    for window in tokens.windows(3) {
        if window[0] == "SZS" && window[1] == "status" {
            let status = window[2].to_string();
            let kind = if ATP_PROVED_STATUSES.contains(&window[2]) {
                AtpStatusKind::Proved
            } else if ATP_UNKNOWN_STATUSES.contains(&window[2]) {
                AtpStatusKind::Unknown
            } else if ATP_TIMEOUT_STATUSES.contains(&window[2]) {
                AtpStatusKind::Timeout
            } else {
                AtpStatusKind::Failure
            };
            return Some(AtpStatus { status, kind });
        }
    }
    None
}

fn atp_solver_name(options: &AtpOptions) -> String {
    let raw = options
        .name
        .clone()
        .or_else(|| {
            options.path.as_ref().and_then(|p| {
                Path::new(p)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.to_string())
            })
        })
        .unwrap_or_else(|| "atp".to_string());
    let cleaned = raw
        .chars()
        .map(|c| {
            if c.is_whitespace() || c == '(' || c == ')' {
                '_'
            } else {
                c
            }
        })
        .collect::<String>();
    if cleaned.is_empty() {
        "atp".to_string()
    } else {
        cleaned
    }
}

struct AtpRunSuccess {
    solver: String,
}

fn read_atp_pipe<R>(mut pipe: R) -> JoinHandle<Result<Vec<u8>, String>>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        pipe.read_to_end(&mut bytes)
            .map_err(|err| err.to_string())?;
        Ok(bytes)
    })
}

fn collect_atp_pipe(
    handle: Option<JoinHandle<Result<Vec<u8>, String>>>,
    label: &str,
) -> Result<Vec<u8>, String> {
    match handle {
        Some(handle) => handle
            .join()
            .map_err(|_| format!("ATP {} reader failed", label))?,
        None => Ok(Vec::new()),
    }
}

fn run_atp_process(tptp: &str, options: &AtpOptions) -> Result<AtpRunSuccess, String> {
    let Some(path) = options.path.as_ref().filter(|p| !p.is_empty()) else {
        return Err("ATP path is not configured".to_string());
    };
    if options.timeout_ms == 0 {
        return Err("ATP timeout must be a positive integer".to_string());
    }
    let mut child = Command::new(path)
        .args(&options.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("ATP invocation failed: {}", err))?;
    let stdout_reader = child.stdout.take().map(read_atp_pipe);
    let stderr_reader = child.stderr.take().map(read_atp_pipe);

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(tptp.as_bytes())
            .map_err(|err| format!("ATP invocation failed: {}", err))?;
    }

    let deadline = Instant::now() + Duration::from_millis(options.timeout_ms);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = collect_atp_pipe(stdout_reader, "stdout");
                    let _ = collect_atp_pipe(stderr_reader, "stderr");
                    return Err(format!("ATP timed out after {} ms", options.timeout_ms));
                }
                sleep(Duration::from_millis(5));
            }
            Err(err) => return Err(format!("ATP invocation failed: {}", err)),
        }
    }

    let status = child
        .wait()
        .map_err(|err| format!("ATP invocation failed: {}", err))?;
    let stdout_bytes = collect_atp_pipe(stdout_reader, "stdout")?;
    let stderr_bytes = collect_atp_pipe(stderr_reader, "stderr")?;
    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let stderr = String::from_utf8_lossy(&stderr_bytes);
    let combined = format!("{}\n{}", stdout, stderr);

    if !status.success() {
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            status
                .code()
                .map(|code| format!("exit status {}", code))
                .unwrap_or_else(|| "terminated by signal".to_string())
        };
        return Err(format!("ATP exited with status {}: {}", status, detail));
    }

    let Some(status) = parse_atp_status(&combined) else {
        return Err("ATP output did not contain an SZS status".to_string());
    };
    match status.kind {
        AtpStatusKind::Proved => Ok(AtpRunSuccess {
            solver: atp_solver_name(options),
        }),
        AtpStatusKind::Timeout | AtpStatusKind::Unknown => {
            Err(format!("ATP returned {}", status.status))
        }
        AtpStatusKind::Failure => Err(format!("ATP returned non-proving status {}", status.status)),
    }
}

fn rewrite_sides(
    eq: &Node,
    direction: RewriteDirection,
) -> Result<(&Node, &Node), Diagnostic> {
    let Some((left, right)) = as_equality(eq) else {
        return Err(rewrite_diagnostic("rewrite expects an equality link"));
    };
    Ok(match direction {
        RewriteDirection::Forward => (left, right),
        RewriteDirection::Backward => (right, left),
    })
}

fn rewrite_node(
    node: &Node,
    from: &Node,
    to: &Node,
    occurrence: RewriteOccurrence,
    seen: &mut usize,
    count: &mut usize,
) -> Node {
    if is_structurally_same(node, from) {
        *seen += 1;
        let selected = match occurrence {
            RewriteOccurrence::All => true,
            RewriteOccurrence::Index(index) => *seen == index,
        };
        if selected {
            *count += 1;
            return to.clone();
        }
    }
    match node {
        Node::Leaf(_) => node.clone(),
        Node::List(children) => Node::List(
            children
                .iter()
                .map(|child| rewrite_node(child, from, to, occurrence, seen, count))
                .collect(),
        ),
    }
}

/// Rewrite `goal` once using equality `eq` and explicit options.
pub fn rewrite_with_options(
    goal: &Node,
    eq: &Node,
    options: RewriteOptions,
) -> Result<RewriteResult, Diagnostic> {
    let (from, to) = rewrite_sides(eq, options.direction)?;
    let mut seen = 0;
    let mut count = 0;
    let node = rewrite_node(
        goal,
        from,
        to,
        options.occurrence,
        &mut seen,
        &mut count,
    );
    Ok(RewriteResult {
        node,
        changed: count > 0,
        count,
    })
}

/// Rewrite `goal` once using equality `eq` from left to right.
pub fn rewrite(goal: &Node, eq: &Node) -> Result<Node, Diagnostic> {
    rewrite_with_options(goal, eq, RewriteOptions::default()).map(|result| result.node)
}

/// Repeatedly apply `rules` until no rule changes the term or the guard fires.
pub fn simplify_with_options(
    goal: &Node,
    rules: &[Node],
    options: SimplifyOptions,
) -> Result<SimplifyResult, Diagnostic> {
    let mut node = goal.clone();
    let mut changed = false;
    let mut steps = 0;
    loop {
        let mut applied = false;
        for rule in rules {
            let rewritten = rewrite_with_options(&node, rule, RewriteOptions::default())?;
            if !rewritten.changed {
                continue;
            }
            if steps >= options.max_steps {
                return Err(rewrite_diagnostic(format!(
                    "simplify termination guard reached after {} rewrite steps",
                    options.max_steps
                )));
            }
            node = rewritten.node;
            steps += 1;
            changed = true;
            applied = true;
            break;
        }
        if !applied {
            return Ok(SimplifyResult {
                node,
                changed,
                steps,
            });
        }
    }
}

/// Repeatedly apply `rules` until no rule changes the term.
pub fn simplify(goal: &Node, rules: &[Node]) -> Result<Node, Diagnostic> {
    simplify_with_options(goal, rules, SimplifyOptions::default()).map(|result| result.node)
}

fn type_ascription(node: &Node) -> Option<(&Node, &Node)> {
    if let Node::List(children) = node {
        if children.len() == 3 {
            if let Node::Leaf(mid) = &children[1] {
                if mid == "of" {
                    return Some((&children[0], &children[2]));
                }
            }
        }
    }
    None
}

fn exact_closes_goal(arg: &Node, goal: &ProofGoal) -> bool {
    if is_structurally_same(arg, &goal.goal) {
        return true;
    }
    if let Some((_, typ)) = type_ascription(arg) {
        if is_structurally_same(typ, &goal.goal) {
            return true;
        }
    }
    goal.context.iter().any(|ctx| {
        if is_structurally_same(ctx, arg) && is_structurally_same(arg, &goal.goal) {
            return true;
        }
        if is_structurally_same(ctx, &goal.goal) && is_structurally_same(arg, &goal.goal) {
            return true;
        }
        if let Some((term, typ)) = type_ascription(ctx) {
            return is_structurally_same(term, arg) && is_structurally_same(typ, &goal.goal);
        }
        false
    })
}

fn is_leaf(node: &Node, value: &str) -> bool {
    matches!(node, Node::Leaf(s) if s == value)
}

fn parse_rewrite_direction(node: &Node) -> Option<RewriteDirection> {
    match node {
        Node::Leaf(s) if s == "->" => Some(RewriteDirection::Forward),
        Node::Leaf(s) if s == "<-" => Some(RewriteDirection::Backward),
        _ => None,
    }
}

fn parse_rewrite_occurrence(node: &Node) -> Result<RewriteOccurrence, String> {
    let Node::Leaf(raw) = node else {
        return Err(format!(
            "rewrite occurrence must be \"all\", \"first\", or a positive integer (got {})",
            key_of(node)
        ));
    };
    if raw == "all" {
        return Ok(RewriteOccurrence::All);
    }
    if raw == "first" {
        return Ok(RewriteOccurrence::Index(1));
    }
    let Ok(index) = raw.parse::<usize>() else {
        return Err(format!(
            "rewrite occurrence must be \"all\", \"first\", or a positive integer (got {})",
            key_of(node)
        ));
    };
    if index == 0 {
        return Err(format!(
            "rewrite occurrence must be \"all\", \"first\", or a positive integer (got {})",
            key_of(node)
        ));
    }
    Ok(RewriteOccurrence::Index(index))
}

struct ParsedRewriteTactic<'a> {
    eq: &'a Node,
    direction: RewriteDirection,
    occurrence: RewriteOccurrence,
}

fn parse_rewrite_tactic(args: &[Node]) -> Result<ParsedRewriteTactic<'_>, String> {
    let mut index = 0;
    let mut direction = RewriteDirection::Forward;
    if let Some(next_direction) = args.first().and_then(parse_rewrite_direction) {
        direction = next_direction;
        index += 1;
    }
    if args.len() < index + 3
        || !is_leaf(&args[index + 1], "in")
        || !is_leaf(&args[index + 2], "goal")
    {
        return Err("rewrite expects `(rewrite [->|<-] (L = R) in goal [at N])`".to_string());
    }
    let eq = &args[index];
    index += 3;
    let mut occurrence = RewriteOccurrence::All;
    if index < args.len() {
        if !is_leaf(&args[index], "at") || index + 2 != args.len() {
            return Err("rewrite expects optional occurrence selector `at N`".to_string());
        }
        occurrence = parse_rewrite_occurrence(&args[index + 1])?;
    }
    Ok(ParsedRewriteTactic {
        eq,
        direction,
        occurrence,
    })
}

fn rewrite_rules_from_node(node: &Node) -> Result<Vec<Node>, String> {
    if as_equality(node).is_some() {
        return Ok(vec![node.clone()]);
    }
    let Node::List(children) = node else {
        return Err(format!(
            "simplify expects equality rewrite rules (got {})",
            key_of(node)
        ));
    };
    let mut rules = Vec::with_capacity(children.len());
    for child in children {
        if as_equality(child).is_none() {
            return Err(format!(
                "simplify expects equality rewrite rules (got {})",
                key_of(child)
            ));
        }
        rules.push(child.clone());
    }
    Ok(rules)
}

struct ParsedSimplifyTactic {
    rules: Option<Vec<Node>>,
    max_steps: Option<usize>,
}

fn parse_simplify_tactic(args: &[Node]) -> Result<ParsedSimplifyTactic, String> {
    if args.len() < 2 || !is_leaf(&args[0], "in") || !is_leaf(&args[1], "goal") {
        return Err("simplify expects `(simplify in goal)`".to_string());
    }
    let mut index = 2;
    let mut rules = None;
    let mut max_steps = None;
    while index < args.len() {
        if is_leaf(&args[index], "using") && index + 1 < args.len() {
            rules = Some(rewrite_rules_from_node(&args[index + 1])?);
            index += 2;
            continue;
        }
        if (is_leaf(&args[index], "max") || is_leaf(&args[index], "limit"))
            && index + 1 < args.len()
        {
            let Node::Leaf(raw) = &args[index + 1] else {
                return Err("simplify max step count must be a non-negative integer".to_string());
            };
            let Ok(parsed) = raw.parse::<usize>() else {
                return Err("simplify max step count must be a non-negative integer".to_string());
            };
            max_steps = Some(parsed);
            index += 2;
            continue;
        }
        return Err("simplify expects optional `using <rules>` and `max <steps>` clauses".to_string());
    }
    Ok(ParsedSimplifyTactic { rules, max_steps })
}

fn apply_tactic(
    state: &ProofState,
    tactic: &Node,
    record_tactic: &Node,
    tactic_options: &TacticOptions,
) -> Result<ProofState, Diagnostic> {
    let name = tactic_name(tactic);
    let args = tactic_args(tactic);

    if name == Some("by") {
        if args.len() == 1 {
            return apply_tactic(state, &args[0], record_tactic, tactic_options);
        }
        if args.len() > 1 {
            return apply_tactic(state, &Node::List(args.to_vec()), record_tactic, tactic_options);
        }
        return Err(tactic_diagnostic(
            record_tactic,
            state.goals.first(),
            "`by` requires an inner tactic",
        ));
    }

    let Some(current) = state.goals.first() else {
        return Err(tactic_diagnostic(record_tactic, None, "no open goals"));
    };

    match name {
        Some("reflexivity") => {
            let Some((left, right)) = as_equality(&current.goal) else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "reflexivity expects an equality goal",
                ));
            };
            if !is_structurally_same(left, right) {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "both sides are not structurally equal",
                ));
            }
            Ok(replace_current_goal(state, Vec::new(), record_tactic))
        }
        Some("symmetry") => {
            let Some((left, right)) = as_equality(&current.goal) else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "symmetry expects an equality goal",
                ));
            };
            Ok(replace_current_goal(
                state,
                vec![goal_with_context(
                    current,
                    Node::List(vec![right.clone(), leaf("="), left.clone()]),
                )],
                record_tactic,
            ))
        }
        Some("transitivity") => {
            let Some((left, right)) = as_equality(&current.goal) else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "transitivity expects an equality goal and one intermediate term",
                ));
            };
            if args.len() != 1 {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "transitivity expects an equality goal and one intermediate term",
                ));
            }
            let mid = args[0].clone();
            Ok(replace_current_goal(
                state,
                vec![
                    goal_with_context(
                        current,
                        Node::List(vec![left.clone(), leaf("="), mid.clone()]),
                    ),
                    goal_with_context(
                        current,
                        Node::List(vec![mid, leaf("="), right.clone()]),
                    ),
                ],
                record_tactic,
            ))
        }
        Some("suppose") => {
            if args.len() != 1 {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "suppose expects one hypothesis link",
                ));
            }
            let mut next = state.clone();
            next.goals[0].context.push(args[0].clone());
            next.proof.push(record_tactic.clone());
            Ok(next)
        }
        Some("introduce") => {
            if args.len() != 1 {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "introduce expects one variable name",
                ));
            }
            let Node::Leaf(variable) = &args[0] else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "introduce expects one variable name",
                ));
            };
            let Node::List(goal_children) = &current.goal else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "introduce expects a Pi goal",
                ));
            };
            if goal_children.len() != 3 || !matches!(&goal_children[0], Node::Leaf(h) if h == "Pi") {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "introduce expects a Pi goal",
                ));
            }
            let Some((param, param_type_key)) = parse_binding(&goal_children[1]) else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "introduce could not parse the Pi binder",
                ));
            };
            let body = subst(&goal_children[2], &param, &Node::Leaf(variable.clone()));
            let mut introduced = goal_with_context(current, body);
            introduced.context.push(Node::List(vec![
                Node::Leaf(variable.clone()),
                leaf("of"),
                type_key_to_node(&param_type_key),
            ]));
            Ok(replace_current_goal(
                state,
                vec![introduced],
                record_tactic,
            ))
        }
        Some("rewrite") => {
            let parsed = parse_rewrite_tactic(args)
                .map_err(|reason| tactic_diagnostic(record_tactic, Some(current), reason))?;
            let rewritten = rewrite_with_options(
                &current.goal,
                parsed.eq,
                RewriteOptions {
                    direction: parsed.direction,
                    occurrence: parsed.occurrence,
                },
            )
            .map_err(|diag| tactic_diagnostic(record_tactic, Some(current), diag.message))?;
            if !rewritten.changed {
                let (from, _) = rewrite_sides(parsed.eq, parsed.direction)
                    .map_err(|diag| tactic_diagnostic(record_tactic, Some(current), diag.message))?;
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    format!("rewrite did not find {} in the current goal", key_of(from)),
                ));
            }
            Ok(replace_current_goal(
                state,
                vec![goal_with_context(current, rewritten.node)],
                record_tactic,
            ))
        }
        Some("simplify") => {
            let parsed = parse_simplify_tactic(args)
                .map_err(|reason| tactic_diagnostic(record_tactic, Some(current), reason))?;
            let rules = parsed
                .rules
                .as_deref()
                .unwrap_or_else(|| tactic_options.rewrite_rules.as_slice());
            if rules.is_empty() {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "simplify expects at least one configured rewrite rule",
                ));
            }
            let max_steps = parsed
                .max_steps
                .unwrap_or(tactic_options.simplify_max_steps);
            let simplified = simplify_with_options(
                &current.goal,
                rules,
                SimplifyOptions { max_steps },
            )
            .map_err(|diag| tactic_diagnostic(record_tactic, Some(current), diag.message))?;
            Ok(replace_current_goal(
                state,
                vec![goal_with_context(current, simplified.node)],
                record_tactic,
            ))
        }
        Some("smt") => {
            if !args.is_empty() {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "smt expects no arguments; configure the solver through tactic options",
                ));
            }
            let smt_lib = smt_lib_for_goal(&current.goal)
                .map_err(|reason| tactic_diagnostic(record_tactic, Some(current), reason))?;
            let checked = run_smt_solver(&smt_lib, tactic_options);
            if checked.status != SmtStatus::Unsat {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    checked.reason,
                ));
            }
            Ok(replace_current_goal(
                state,
                Vec::new(),
                &smt_trusted_node(tactic_options),
            ))
        }
        Some("atp") => {
            if !args.is_empty() {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "atp expects no tactic arguments",
                ));
            }
            let tptp = goal_to_tptp(current)
                .map_err(|diag| tactic_diagnostic(record_tactic, Some(current), diag.message))?;
            let proved = run_atp_process(&tptp, &tactic_options.atp)
                .map_err(|reason| tactic_diagnostic(record_tactic, Some(current), reason))?;
            Ok(replace_current_goal(
                state,
                Vec::new(),
                &Node::List(vec![
                    leaf("by"),
                    leaf("atp-trusted"),
                    Node::Leaf(proved.solver),
                ]),
            ))
        }
        Some("exact") => {
            if args.len() != 1 {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "exact expects one term or hypothesis",
                ));
            }
            if !exact_closes_goal(&args[0], current) {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    format!("{} does not prove the current goal", key_of(&args[0])),
                ));
            }
            Ok(replace_current_goal(state, Vec::new(), record_tactic))
        }
        Some("induction") => {
            if args.len() < 2 {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "induction expects a variable and at least one case",
                ));
            }
            let Node::Leaf(variable) = &args[0] else {
                return Err(tactic_diagnostic(
                    record_tactic,
                    Some(current),
                    "induction expects a variable and at least one case",
                ));
            };
            let mut open_goals = Vec::new();
            let mut nested_proofs = Vec::new();
            for case_node in &args[1..] {
                let Node::List(case_children) = case_node else {
                    return Err(tactic_diagnostic(
                        record_tactic,
                        Some(current),
                        "induction cases must be `(case <pattern> <tactic>...)` links",
                    ));
                };
                if case_children.len() < 2
                    || !matches!(&case_children[0], Node::Leaf(h) if h == "case")
                {
                    return Err(tactic_diagnostic(
                        record_tactic,
                        Some(current),
                        "induction cases must be `(case <pattern> <tactic>...)` links",
                    ));
                }
                let pattern = &case_children[1];
                let case_goal =
                    goal_with_context(current, subst(&current.goal, variable, pattern));
                let case_tactics = &case_children[2..];
                if case_tactics.is_empty() {
                    open_goals.push(case_goal);
                    continue;
                }
                let nested = run_tactics_with_options(
                    ProofState {
                        goals: vec![case_goal],
                        proof: Vec::new(),
                    },
                    case_tactics,
                    tactic_options.clone(),
                );
                if let Some(diag) = nested.diagnostics.first() {
                    return Err(diag.clone());
                }
                open_goals.extend(nested.state.goals);
                nested_proofs.extend(nested.state.proof);
            }
            let mut goals = open_goals;
            goals.extend(state.goals.iter().skip(1).cloned());
            let mut proof = state.proof.clone();
            proof.push(record_tactic.clone());
            proof.extend(nested_proofs);
            Ok(ProofState { goals, proof })
        }
        Some(other) => Err(tactic_diagnostic(
            record_tactic,
            Some(current),
            format!("unknown tactic \"{}\"", other),
        )),
        None => Err(tactic_diagnostic(
            record_tactic,
            Some(current),
            "tactic head must be a symbol",
        )),
    }
}

/// Parse a LiNo snippet into tactic links.
///
/// # Errors
///
/// The message of the first failure, exactly as [`parse_lino_forms`] reports
/// it, so a snippet that is not valid LiNo is rejected rather than run as a
/// shorter tactic list (like `_normaliseTacticList` in `js/src/rml-links.mjs`).
pub fn parse_tactic_links(text: &str) -> Result<Vec<Node>, String> {
    parse_lino_forms(text)
}

/// Apply link tactics with configured rewrite rules, stopping at the first failing tactic.
pub fn run_tactics_with_options(
    state: ProofState,
    tactics: &[Node],
    options: TacticOptions,
) -> TacticRunResult {
    let mut next = state;
    let mut diagnostics = Vec::new();
    for tactic in tactics {
        match apply_tactic(&next, tactic, tactic, &options) {
            Ok(applied) => next = applied,
            Err(diag) => {
                diagnostics.push(diag);
                break;
            }
        }
    }
    TacticRunResult {
        state: next,
        diagnostics,
    }
}

/// Apply link tactics to a proof state, stopping at the first failing tactic.
pub fn run_tactics(state: ProofState, tactics: &[Node]) -> TacticRunResult {
    run_tactics_with_options(state, tactics, TacticOptions::default())
}

// ---------- Mode declarations (issue #43, D15) ----------
// `(mode plus +input +input -output)` records the per-argument mode
// pattern for relation `plus`. `parse_mode_form` validates the shape and
// returns the normalised `(name, flags)` pair; `check_mode_at_call`
// inspects every call against any registered declaration. Both surface
// errors as panics with a recognisable prefix so the existing diagnostic
// dispatch in `decode_panic_payload` can map them to E030 / E031.

fn parse_mode_form(children: &[Node]) -> Option<(String, Vec<ModeFlag>)> {
    // Caller already verified `children[0]` is the leaf `mode`.
    if children.len() < 2 {
        return None;
    }
    let name = match &children[1] {
        Node::Leaf(s) => s.clone(),
        _ => panic!("Mode declaration error: relation name must be a bare symbol"),
    };
    if children.len() < 3 {
        panic!(
            "Mode declaration error: declaration for \"{}\" must list at least one mode flag",
            name
        );
    }
    let mut flags = Vec::with_capacity(children.len() - 2);
    for child in &children[2..] {
        match child {
            Node::Leaf(token) => match ModeFlag::from_token(token) {
                Some(flag) => flags.push(flag),
                None => panic!(
                    "Mode declaration error: declaration for \"{}\": unknown flag \"{}\" (expected +input, -output, or *either)",
                    name, token
                ),
            },
            _ => panic!(
                "Mode declaration error: declaration for \"{}\" contains a non-token flag",
                name
            ),
        }
    }
    Some((name, flags))
}

fn is_ground_for_mode(arg: &Node, env: &Env) -> bool {
    match arg {
        Node::Leaf(s) => {
            if is_num(s) {
                return true;
            }
            env_can_evaluate_name(env, s)
        }
        Node::List(_) => !has_unresolved_free_variables(arg, env),
    }
}

fn check_mode_at_call(name: &str, args: &[Node], env: &Env) {
    let flags = match env.modes.get(name) {
        Some(f) => f.clone(),
        None => return,
    };
    if args.len() != flags.len() {
        panic!(
            "Mode mismatch: \"{}\" expected {} argument{}, got {}",
            name,
            flags.len(),
            if flags.len() == 1 { "" } else { "s" },
            args.len()
        );
    }
    for (i, flag) in flags.iter().enumerate() {
        if *flag == ModeFlag::In && !is_ground_for_mode(&args[i], env) {
            panic!(
                "Mode mismatch: \"{}\" argument {} (+input) is not ground",
                name,
                i + 1
            );
        }
    }
}

// ---------- Relation declarations & totality (issue #44, D12) ----------
// Mirrors the JavaScript helpers in `js/src/rml-links.mjs`. The
// `(relation <name> <clause>...)` form stores the clause list per
// relation, and the single-rule shorthand
// `(relation <name> (<name> arg...) body)` is normalized to that clause
// shape. `(total <name>)` triggers `is_total`, and the same helper is
// exported for programmatic callers.

fn is_relation_clause_head(node: &Node, name: &str) -> bool {
    match node {
        Node::List(items) if items.len() >= 2 => match &items[0] {
            Node::Leaf(head) => head == name,
            _ => false,
        },
        _ => false,
    }
}

fn parse_relation_form(children: &[Node]) -> (String, Vec<Node>) {
    // Caller already verified `children[0]` is the leaf `relation`.
    if children.len() < 2 {
        panic!("Relation declaration error: relation name must be a bare symbol");
    }
    let name = match &children[1] {
        Node::Leaf(s) => s.clone(),
        _ => panic!("Relation declaration error: relation name must be a bare symbol"),
    };
    if children.len() < 3 {
        panic!(
            "Relation declaration error: declaration for \"{}\" must list at least one clause",
            name
        );
    }
    if children.len() == 4 {
        let pattern = &children[2];
        let body = &children[3];
        if is_relation_clause_head(pattern, &name) && !is_relation_clause_head(body, &name) {
            if let Node::List(items) = pattern {
                let mut clause = items.clone();
                clause.push(body.clone());
                return (name, vec![Node::List(clause)]);
            }
        }
    }
    let mut clauses = Vec::with_capacity(children.len() - 2);
    for (idx, clause) in children[2..].iter().enumerate() {
        match clause {
            Node::List(items) if items.len() >= 2 => match &items[0] {
                Node::Leaf(head) if *head == name => {
                    clauses.push(clause.clone());
                }
                _ => panic!(
                    "Relation declaration error: declaration for \"{}\": clause {} must be a list whose head is \"{}\"",
                    name,
                    idx + 1,
                    name
                ),
            },
            _ => panic!(
                "Relation declaration error: declaration for \"{}\": clause {} must be a list whose head is \"{}\"",
                name,
                idx + 1,
                name
            ),
        }
    }
    (name, clauses)
}

fn is_strict_subterm(inner: &Node, outer: &Node) -> bool {
    if let Node::List(children) = outer {
        for child in children {
            if inner == child {
                return true;
            }
            if is_strict_subterm(inner, child) {
                return true;
            }
        }
    }
    false
}

fn collect_recursive_calls(node: &Node, rel_name: &str, is_head: bool, out: &mut Vec<Node>) {
    if let Node::List(children) = node {
        if !is_head {
            if let Some(Node::Leaf(head)) = children.first() {
                if head == rel_name {
                    out.push(node.clone());
                }
            }
        }
        for (i, child) in children.iter().enumerate() {
            // Skip the head leaf — only descend into argument positions.
            if i == 0 {
                if let Node::Leaf(_) = child {
                    continue;
                }
            }
            collect_recursive_calls(child, rel_name, false, out);
        }
    }
}

/// Per-clause / per-call totality diagnostic returned by [`is_total`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TotalityDiagnostic {
    pub code: String,
    pub message: String,
}

/// Outcome of a totality check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TotalityResult {
    pub ok: bool,
    pub diagnostics: Vec<TotalityDiagnostic>,
}

fn check_recursive_decrease(
    call: &Node,
    head_args: &[Node],
    flags: &[ModeFlag],
    rel_name: &str,
) -> Option<String> {
    let call_args: Vec<Node> = match call {
        Node::List(items) if !items.is_empty() => items[1..].to_vec(),
        _ => return Some(format!("recursive call `{}` has no arguments", key_of(call))),
    };
    let input_indices: Vec<usize> = flags
        .iter()
        .enumerate()
        .filter(|(_, f)| **f == ModeFlag::In)
        .map(|(i, _)| i)
        .collect();

    let pairs: Vec<(&Node, &Node)> = if call_args.len() == flags.len() {
        input_indices
            .iter()
            .map(|&i| (&call_args[i], &head_args[i]))
            .collect()
    } else if call_args.len() == input_indices.len() {
        input_indices
            .iter()
            .enumerate()
            .map(|(j, &i)| (&call_args[j], &head_args[i]))
            .collect()
    } else {
        return Some(format!(
            "recursive call `{}` has {} argument{}, expected {} (or {} input{})",
            key_of(call),
            call_args.len(),
            if call_args.len() == 1 { "" } else { "s" },
            flags.len(),
            input_indices.len(),
            if input_indices.len() == 1 { "" } else { "s" },
        ));
    };

    if input_indices.is_empty() {
        return Some(format!(
            "relation \"{}\" has no `+input` slot, so structural decrease is unverifiable",
            rel_name
        ));
    }
    for (call_arg, head_arg) in &pairs {
        if is_strict_subterm(call_arg, head_arg) {
            return None;
        }
    }
    let head_with_args = {
        let mut items = Vec::with_capacity(head_args.len() + 1);
        items.push(Node::Leaf(rel_name.to_string()));
        items.extend(head_args.iter().cloned());
        Node::List(items)
    };
    Some(format!(
        "recursive call `{}` does not structurally decrease any `+input` slot of `{}`",
        key_of(call),
        key_of(&head_with_args)
    ))
}

/// Public totality checker. Returns a [`TotalityResult`] with structured
/// diagnostics; callers can either propagate them as-is or convert each
/// entry into a [`Diagnostic`] for the existing pipeline. The mirrored JS
/// helper is exported under the same name (`isTotal`) and produces an
/// equivalent shape so downstream tools see consistent output.
pub fn is_total(env: &Env, rel_name: &str) -> TotalityResult {
    let mut diagnostics: Vec<TotalityDiagnostic> = Vec::new();
    let flags = match env.modes.get(rel_name) {
        Some(f) => f.clone(),
        None => {
            diagnostics.push(TotalityDiagnostic {
                code: "E032".to_string(),
                message: format!(
                    "Totality check for \"{}\": no `(mode {} ...)` declaration found",
                    rel_name, rel_name
                ),
            });
            return TotalityResult {
                ok: false,
                diagnostics,
            };
        }
    };
    let clauses: Vec<Node> = match env.relations.get(rel_name) {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            diagnostics.push(TotalityDiagnostic {
                code: "E032".to_string(),
                message: format!(
                    "Totality check for \"{}\": no `(relation {} ...)` clauses found",
                    rel_name, rel_name
                ),
            });
            return TotalityResult {
                ok: false,
                diagnostics,
            };
        }
    };
    for (ci, clause) in clauses.iter().enumerate() {
        let head_args: Vec<Node> = match clause {
            Node::List(items) if !items.is_empty() => items[1..].to_vec(),
            _ => continue,
        };
        if head_args.len() != flags.len() {
            diagnostics.push(TotalityDiagnostic {
                code: "E032".to_string(),
                message: format!(
                    "Totality check for \"{}\": clause {} `{}` has {} argument{}, mode declares {}",
                    rel_name,
                    ci + 1,
                    key_of(clause),
                    head_args.len(),
                    if head_args.len() == 1 { "" } else { "s" },
                    flags.len(),
                ),
            });
            continue;
        }
        let mut calls: Vec<Node> = Vec::new();
        collect_recursive_calls(clause, rel_name, true, &mut calls);
        for call in &calls {
            if let Some(reason) = check_recursive_decrease(call, &head_args, &flags, rel_name) {
                diagnostics.push(TotalityDiagnostic {
                    code: "E032".to_string(),
                    message: format!(
                        "Totality check for \"{}\": clause {} `{}` — {}",
                        rel_name,
                        ci + 1,
                        key_of(clause),
                        reason
                    ),
                });
            }
        }
    }
    TotalityResult {
        ok: diagnostics.is_empty(),
        diagnostics,
    }
}

// ---------- Definitions & termination checking (issue #49, D13) ----------
// `(define <name> [(measure (lex <slot>...))] (case <pattern-args> <body>) ...)`
// records a recursive definition keyed by `<name>`. `is_terminating(env, name)`
// then verifies that every recursive call structurally decreases either the
// first argument (default) or the explicit lexicographic measure. Mirrors
// the JS export `isTerminating` and uses error code E035.

/// Per-clause / per-call termination diagnostic returned by [`is_terminating`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminationDiagnostic {
    pub code: String,
    pub message: String,
}

/// Outcome of a termination check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminationResult {
    pub ok: bool,
    pub diagnostics: Vec<TerminationDiagnostic>,
}

fn parse_define_form(children: &[Node]) -> DefineDecl {
    // Caller already verified `children[0]` is the leaf `define`.
    if children.len() < 2 {
        panic!("Termination check error: Define declaration: name must be a bare symbol");
    }
    let name = match &children[1] {
        Node::Leaf(s) => s.clone(),
        _ => panic!("Termination check error: Define declaration: name must be a bare symbol"),
    };
    if children.len() < 3 {
        panic!(
            "Termination check error: Define declaration for \"{}\" must list at least one `(case ...)` clause",
            name
        );
    }
    let mut measure: Option<DefineMeasure> = None;
    let mut clauses: Vec<DefineClause> = Vec::new();
    for child in &children[2..] {
        match child {
            Node::List(items) if !items.is_empty() => match &items[0] {
                Node::Leaf(head) if head == "measure" => {
                    if measure.is_some() {
                        panic!(
                            "Termination check error: Define declaration for \"{}\": only one `(measure ...)` clause is allowed",
                            name
                        );
                    }
                    if items.len() != 2 {
                        panic!(
                            "Termination check error: Define declaration for \"{}\": `(measure ...)` body must be `(lex <slot>...)`",
                            name
                        );
                    }
                    let body = &items[1];
                    let lex_items = match body {
                        Node::List(b) if b.len() >= 2 => match &b[0] {
                            Node::Leaf(h) if h == "lex" => &b[1..],
                            _ => panic!(
                                "Termination check error: Define declaration for \"{}\": `(measure ...)` body must be `(lex <slot>...)`",
                                name
                            ),
                        },
                        _ => panic!(
                            "Termination check error: Define declaration for \"{}\": `(measure ...)` body must be `(lex <slot>...)`",
                            name
                        ),
                    };
                    let mut slots: Vec<usize> = Vec::with_capacity(lex_items.len());
                    for item in lex_items {
                        let raw = match item {
                            Node::Leaf(s) => s.clone(),
                            _ => panic!(
                                "Termination check error: Define declaration for \"{}\": measure slot must be a positive integer",
                                name
                            ),
                        };
                        let parsed: Result<usize, _> = raw.parse();
                        match parsed {
                            Ok(n) if n >= 1 => slots.push(n - 1),
                            _ => panic!(
                                "Termination check error: Define declaration for \"{}\": measure slot must be a positive integer",
                                name
                            ),
                        }
                    }
                    measure = Some(DefineMeasure::Lex(slots));
                }
                Node::Leaf(head) if head == "case" => {
                    if items.len() != 3 {
                        panic!(
                            "Termination check error: Define declaration for \"{}\": `(case <pattern-args> <body>)` clause must have exactly two children",
                            name
                        );
                    }
                    let pattern = match &items[1] {
                        Node::List(p) => p.clone(),
                        // The upstream `links-notation` parser collapses
                        // single-element parens (`(zero)` → `zero`), so a
                        // surface pattern with one argument arrives here as a
                        // `Leaf`. Treat it as the equivalent one-element list
                        // so `(case (zero) zero)` parses the same way it does
                        // in the JS implementation.
                        Node::Leaf(_) => vec![items[1].clone()],
                    };
                    clauses.push(DefineClause {
                        pattern,
                        body: items[2].clone(),
                    });
                }
                _ => panic!(
                    "Termination check error: Define declaration for \"{}\": unexpected clause `{}` (expected `(measure ...)` or `(case ...)`)",
                    name,
                    key_of(child)
                ),
            },
            _ => panic!(
                "Termination check error: Define declaration for \"{}\": unexpected clause `{}` (expected `(measure ...)` or `(case ...)`)",
                name,
                key_of(child)
            ),
        }
    }
    if clauses.is_empty() {
        panic!(
            "Termination check error: Define declaration for \"{}\" must list at least one `(case ...)` clause",
            name
        );
    }
    DefineDecl {
        name,
        measure,
        clauses,
    }
}

fn check_define_decrease(
    call: &Node,
    pattern: &[Node],
    measure: &Option<DefineMeasure>,
    def_name: &str,
) -> Option<String> {
    let call_args: Vec<Node> = match call {
        Node::List(items) if !items.is_empty() => items[1..].to_vec(),
        _ => return Some(format!("recursive call `{}` has no arguments", key_of(call))),
    };
    if call_args.len() != pattern.len() {
        return Some(format!(
            "recursive call `{}` has {} argument{}, clause pattern declares {}",
            key_of(call),
            call_args.len(),
            if call_args.len() == 1 { "" } else { "s" },
            pattern.len(),
        ));
    }
    if let Some(DefineMeasure::Lex(slots)) = measure {
        for &slot in slots {
            if slot >= pattern.len() {
                return Some(format!(
                    "measure slot {} is out of range for {}-argument clause",
                    slot + 1,
                    pattern.len(),
                ));
            }
        }
        for &slot in slots {
            let call_arg = &call_args[slot];
            let pat_arg = &pattern[slot];
            if is_strict_subterm(call_arg, pat_arg) {
                return None;
            }
            if !is_node_equal(call_arg, pat_arg) {
                return Some(format!(
                    "recursive call `{}` does not lexicographically decrease the declared measure",
                    key_of(call),
                ));
            }
        }
        return Some(format!(
            "recursive call `{}` does not lexicographically decrease the declared measure",
            key_of(call),
        ));
    }
    if pattern.is_empty() {
        return Some(format!(
            "definition \"{}\" has no arguments, so structural decrease is unverifiable",
            def_name
        ));
    }
    if is_strict_subterm(&call_args[0], &pattern[0]) {
        return None;
    }
    let head_with_pattern = {
        let mut items = Vec::with_capacity(pattern.len() + 1);
        items.push(Node::Leaf(def_name.to_string()));
        items.extend(pattern.iter().cloned());
        Node::List(items)
    };
    Some(format!(
        "recursive call `{}` does not structurally decrease the first argument of `{}`",
        key_of(call),
        key_of(&head_with_pattern)
    ))
}

fn is_node_equal(a: &Node, b: &Node) -> bool {
    a == b
}

/// Public termination checker. Returns a [`TerminationResult`] with
/// structured diagnostics; callers can either propagate them as-is or
/// convert each entry into a [`Diagnostic`] for the existing pipeline. The
/// mirrored JS helper is exported under the same name (`isTerminating`).
pub fn is_terminating(env: &Env, def_name: &str) -> TerminationResult {
    let mut diagnostics: Vec<TerminationDiagnostic> = Vec::new();
    let decl = match env.definitions.get(def_name) {
        Some(d) => d.clone(),
        None => {
            diagnostics.push(TerminationDiagnostic {
                code: "E035".to_string(),
                message: format!(
                    "Termination check for \"{}\": no `(define {} ...)` declaration found",
                    def_name, def_name
                ),
            });
            return TerminationResult {
                ok: false,
                diagnostics,
            };
        }
    };
    for (ci, clause) in decl.clauses.iter().enumerate() {
        let mut calls: Vec<Node> = Vec::new();
        collect_recursive_calls(&clause.body, def_name, false, &mut calls);
        for call in &calls {
            if let Some(reason) =
                check_define_decrease(call, &clause.pattern, &decl.measure, def_name)
            {
                let case_node = Node::List(vec![
                    Node::Leaf("case".to_string()),
                    Node::List(clause.pattern.clone()),
                    clause.body.clone(),
                ]);
                diagnostics.push(TerminationDiagnostic {
                    code: "E035".to_string(),
                    message: format!(
                        "Termination check for \"{}\": clause {} `{}` — {}",
                        def_name,
                        ci + 1,
                        key_of(&case_node),
                        reason
                    ),
                });
            }
        }
    }
    TerminationResult {
        ok: diagnostics.is_empty(),
        diagnostics,
    }
}

// ---------- Coverage checking (issue #46, D14) ----------
// Mirrors the JavaScript `isCovered` helper. For every `+input` slot of the
// named relation, the union of clause patterns at that slot must exhaust
// every constructor of the slot's inductive type. Wildcard variables
// (lowercase symbols not registered in the env) cover all constructors;
// slots whose inductive type cannot be inferred are skipped. A missing
// constructor produces an `E037` diagnostic with an example pattern.

/// Structured coverage diagnostic mirroring [`TotalityDiagnostic`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageDiagnostic {
    pub code: String,
    pub message: String,
}

/// Outcome of a coverage check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageResult {
    pub ok: bool,
    pub diagnostics: Vec<CoverageDiagnostic>,
}

fn inductive_type_of_constructor(env: &Env, ctor_name: &str) -> Option<String> {
    for (type_name, decl) in &env.inductives {
        for ctor in &decl.constructors {
            if ctor.name == ctor_name {
                return Some(type_name.clone());
            }
        }
    }
    None
}

fn is_wildcard_pattern(pat: &Node, env: &Env) -> bool {
    match pat {
        Node::Leaf(s) => {
            if is_num(s) {
                return false;
            }
            if non_variable_token(s) {
                return false;
            }
            inductive_type_of_constructor(env, s).is_none()
        }
        _ => false,
    }
}

fn pattern_constructor_head(pat: &Node, env: &Env) -> Option<String> {
    match pat {
        Node::Leaf(s) => {
            if inductive_type_of_constructor(env, s).is_some() {
                Some(s.clone())
            } else {
                None
            }
        }
        Node::List(items) => {
            if let Some(Node::Leaf(head)) = items.first() {
                if inductive_type_of_constructor(env, head).is_some() {
                    return Some(head.clone());
                }
            }
            None
        }
    }
}

fn infer_slot_type(env: &Env, clauses: &[Node], slot_index: usize) -> Option<String> {
    for clause in clauses {
        if let Node::List(items) = clause {
            if let Some(pat) = items.get(slot_index + 1) {
                if let Some(head) = pattern_constructor_head(pat, env) {
                    return inductive_type_of_constructor(env, &head);
                }
            }
        }
    }
    None
}

fn example_constructor_pattern(ctor: &ConstructorDecl) -> String {
    if ctor.params.is_empty() {
        ctor.name.clone()
    } else {
        let placeholders = " _".repeat(ctor.params.len());
        format!("({}{})", ctor.name, placeholders)
    }
}

/// Public coverage checker. Mirrors `isCovered` in the JavaScript
/// implementation and returns identical diagnostic shapes so external
/// tooling sees consistent output across runtimes.
pub fn is_covered(env: &Env, rel_name: &str) -> CoverageResult {
    let mut diagnostics: Vec<CoverageDiagnostic> = Vec::new();
    let flags = match env.modes.get(rel_name) {
        Some(f) => f.clone(),
        None => {
            diagnostics.push(CoverageDiagnostic {
                code: "E037".to_string(),
                message: format!(
                    "Coverage check for \"{}\": no `(mode {} ...)` declaration found",
                    rel_name, rel_name
                ),
            });
            return CoverageResult {
                ok: false,
                diagnostics,
            };
        }
    };
    let clauses: Vec<Node> = match env.relations.get(rel_name) {
        Some(c) if !c.is_empty() => c.clone(),
        _ => {
            diagnostics.push(CoverageDiagnostic {
                code: "E037".to_string(),
                message: format!(
                    "Coverage check for \"{}\": no `(relation {} ...)` clauses found",
                    rel_name, rel_name
                ),
            });
            return CoverageResult {
                ok: false,
                diagnostics,
            };
        }
    };
    for (i, flag) in flags.iter().enumerate() {
        if *flag != ModeFlag::In {
            continue;
        }
        let slot_patterns: Vec<Node> = clauses
            .iter()
            .filter_map(|c| match c {
                Node::List(items) => items.get(i + 1).cloned(),
                _ => None,
            })
            .collect();
        if slot_patterns.iter().any(|p| is_wildcard_pattern(p, env)) {
            continue;
        }
        let type_name = match infer_slot_type(env, &clauses, i) {
            Some(t) => t,
            None => continue,
        };
        let decl = match env.inductives.get(&type_name) {
            Some(d) => d.clone(),
            None => continue,
        };
        let mut covered: Vec<String> = Vec::new();
        for pat in &slot_patterns {
            if let Some(head) = pattern_constructor_head(pat, env) {
                if !covered.contains(&head) {
                    covered.push(head);
                }
            }
        }
        let missing: Vec<&ConstructorDecl> = decl
            .constructors
            .iter()
            .filter(|c| !covered.contains(&c.name))
            .collect();
        if missing.is_empty() {
            continue;
        }
        let examples: Vec<String> = missing
            .iter()
            .map(|c| example_constructor_pattern(c))
            .collect();
        let plural = if missing.len() == 1 { "" } else { "s" };
        diagnostics.push(CoverageDiagnostic {
            code: "E037".to_string(),
            message: format!(
                "Coverage check for \"{}\": +input slot {} (type \"{}\") missing case{} for constructor{} {}",
                rel_name,
                i + 1,
                type_name,
                plural,
                plural,
                examples.join(", ")
            ),
        });
    }
    CoverageResult {
        ok: diagnostics.is_empty(),
        diagnostics,
    }
}

// ---------- World declarations (issue #54, D16) ----------
// `(world plus (Natural))` records that the relation `plus` may have
// arguments containing only the listed constants free (in addition to
// the relation's own argument variables and any locally-bound names).
// `parse_world_form` validates the shape and returns the normalised
// `(name, allowed_constants)` pair; `check_world_at_call` inspects every
// call against any registered declaration. Both surface errors as panics
// with a recognisable prefix so the existing diagnostic dispatch in
// `decode_panic_payload` can map them to E034.

fn parse_world_form(children: &[Node]) -> Option<(String, Vec<String>)> {
    // Caller already verified `children[0]` is the leaf `world`.
    if children.len() < 2 {
        return None;
    }
    let name = match &children[1] {
        Node::Leaf(s) => s.clone(),
        _ => panic!("World declaration error: relation name must be a bare symbol"),
    };
    if children.len() != 3 {
        panic!(
            "World declaration error: declaration for \"{}\" must have shape `(world {} (<const>...))`",
            name, name
        );
    }
    let allowed: Vec<String> = match &children[2] {
        Node::List(items) => {
            let mut consts = Vec::with_capacity(items.len());
            for item in items {
                match item {
                    Node::Leaf(s) => consts.push(s.clone()),
                    _ => panic!(
                        "World declaration error: declaration for \"{}\": each allowed constant must be a bare symbol",
                        name
                    ),
                }
            }
            consts
        }
        // The LiNo parser collapses a single-element paren group such as
        // `(Natural)` into the bare leaf `Natural`, so accept a lone leaf
        // here as a one-constant allow-list.
        Node::Leaf(s) => vec![s.clone()],
    };
    Some((name, allowed))
}

// Walk an argument expression and collect every free constant — i.e.
// every leaf symbol that is not numeric, not a reserved keyword, and is
// not bound by an enclosing `lambda`/`Pi`/`fresh` binder appearing
// inside the same argument. The collected names are matched against the
// world's `allowed` list to surface E033 violations.
fn collect_free_constants(node: &Node, bound: &mut HashSet<String>, out: &mut Vec<String>) {
    match node {
        Node::Leaf(s) => {
            if is_num(s) || non_variable_token(s) {
                return;
            }
            if bound.contains(s) {
                return;
            }
            if !out.contains(s) {
                out.push(s.clone());
            }
        }
        Node::List(items) => {
            // Recognise local binders so their bound name does not count
            // as a free constant inside the body.
            if items.len() >= 3 {
                if let Node::Leaf(head) = &items[0] {
                    if head == "lambda" || head == "Pi" {
                        if let Node::List(binder) = &items[1] {
                            if binder.len() == 2 {
                                if let Node::Leaf(var) = &binder[1] {
                                    let was_bound = bound.contains(var);
                                    if let Node::Leaf(ty) = &binder[0] {
                                        if !is_num(ty) && !non_variable_token(ty) && !bound.contains(ty) && !out.contains(ty) {
                                            out.push(ty.clone());
                                        }
                                    } else {
                                        collect_free_constants(&binder[0], bound, out);
                                    }
                                    bound.insert(var.clone());
                                    for child in &items[2..] {
                                        collect_free_constants(child, bound, out);
                                    }
                                    if !was_bound {
                                        bound.remove(var);
                                    }
                                    return;
                                }
                            }
                        }
                    }
                    if head == "fresh" && items.len() == 4 {
                        if let (Node::Leaf(var), Node::Leaf(in_kw)) = (&items[1], &items[2]) {
                            if in_kw == "in" {
                                let was_bound = bound.contains(var);
                                bound.insert(var.clone());
                                collect_free_constants(&items[3], bound, out);
                                if !was_bound {
                                    bound.remove(var);
                                }
                                return;
                            }
                        }
                    }
                }
            }
            for child in items {
                collect_free_constants(child, bound, out);
            }
        }
    }
}

fn check_world_at_call(name: &str, args: &[Node], env: &Env) {
    let allowed = match env.worlds.get(name) {
        Some(a) => a.clone(),
        None => return,
    };
    // Treat the relation's own name and the declared allowed constants
    // as the world's vocabulary. Other free constants raise E033.
    let mut violations: Vec<String> = Vec::new();
    for arg in args {
        let mut bound: HashSet<String> = HashSet::new();
        let mut found: Vec<String> = Vec::new();
        collect_free_constants(arg, &mut bound, &mut found);
        for sym in found {
            if sym == name {
                continue;
            }
            if allowed.iter().any(|a| a == &sym) {
                continue;
            }
            // Names that are themselves declared in the world list of
            // any other relation are also treated as part of the
            // ambient vocabulary — only truly unknown free constants
            // should fail. We keep the check strict for now: only the
            // explicit allow-list and the relation's own name are OK.
            if !violations.contains(&sym) {
                violations.push(sym);
            }
        }
    }
    if !violations.is_empty() {
        let listed = violations
            .iter()
            .map(|s| format!("\"{}\"", s))
            .collect::<Vec<_>>()
            .join(", ");
        panic!(
            "World violation: \"{}\" argument contains free constant{} {} not in declared world",
            name,
            if violations.len() == 1 { "" } else { "s" },
            listed
        );
    }
}

// ---------- Inductive declarations (issue #45, D10) ----------
// Mirrors the JavaScript helpers in `js/src/rml-links.mjs`. The
// `(inductive Name (constructor …) …)` form records an inductive
// datatype, installs every constructor, and synthesises the
// eliminator `Name-rec` with a dependent Pi-type. Errors panic with
// `Inductive declaration error:` so `decode_panic_payload` maps them
// to E033.

fn is_pi_sig(node: &Node) -> bool {
    matches!(node, Node::List(items)
        if items.len() == 3
            && matches!(&items[0], Node::Leaf(h) if h == "Pi"))
}

// Walk a `(Pi (A x) (Pi (B y) … R))` chain into binder pairs and the result.
fn flatten_pi(type_node: &Node) -> Option<(Vec<(String, Node)>, Node)> {
    let mut params: Vec<(String, Node)> = Vec::new();
    let mut current = type_node.clone();
    while is_pi_sig(&current) {
        let items = match &current {
            Node::List(items) => items.clone(),
            _ => return None,
        };
        let bindings = parse_bindings(&items[1])?;
        if bindings.is_empty() {
            return None;
        }
        for (name, type_str) in bindings {
            // parse_bindings returns the type as a string key — recover the
            // original type node from the binding form so a bare leaf stays
            // a leaf and a complex Pi-type round-trips structurally.
            let binding_node = &items[1];
            let type_node = recover_binding_type(binding_node, &name).unwrap_or(Node::Leaf(type_str));
            params.push((name, type_node));
        }
        current = items[2].clone();
    }
    Some((params, current))
}

// Pull the type-side of a `(A x)` (or its parsed equivalents) back as a Node.
// `parse_bindings` flattens to a String type key, but for Pi-construction
// we need to preserve list shapes such as `(Pi (Natural _) (Type 0))`.
fn recover_binding_type(binding: &Node, param_name: &str) -> Option<Node> {
    match binding {
        Node::List(items) if items.len() == 2 => {
            if let Node::Leaf(name) = &items[1] {
                if name == param_name {
                    return Some(items[0].clone());
                }
            }
            if let Node::Leaf(name) = &items[0] {
                if name == param_name {
                    return Some(items[1].clone());
                }
            }
            None
        }
        _ => None,
    }
}

// Build a chain of nested Pi nodes from a binder list and a final result.
fn build_pi(params: &[(String, Node)], result: Node) -> Node {
    let mut out = result;
    for (name, ty) in params.iter().rev() {
        out = Node::List(vec![
            Node::Leaf("Pi".to_string()),
            Node::List(vec![ty.clone(), Node::Leaf(name.clone())]),
            out,
        ]);
    }
    out
}

fn parse_constructor_clause(clause: &Node, type_name: &str) -> ConstructorDecl {
    let items = match clause {
        Node::List(items) if items.len() == 2 => items,
        _ => panic!(
            "Inductive declaration error: each clause must be `(constructor <name>)` or `(constructor (<name> <pi-type>))`"
        ),
    };
    match &items[0] {
        Node::Leaf(h) if h == "constructor" => {}
        _ => panic!(
            "Inductive declaration error: each clause must be `(constructor <name>)` or `(constructor (<name> <pi-type>))`"
        ),
    }
    match &items[1] {
        Node::Leaf(name) => ConstructorDecl {
            name: name.clone(),
            params: Vec::new(),
            typ: Node::Leaf(type_name.to_string()),
        },
        Node::List(inner) if inner.len() == 2 => {
            let name = match &inner[0] {
                Node::Leaf(s) => s.clone(),
                _ => panic!(
                    "Inductive declaration error: malformed constructor clause `{}`",
                    key_of(clause)
                ),
            };
            if !is_pi_sig(&inner[1]) {
                panic!(
                    "Inductive declaration error: malformed constructor clause `{}`",
                    key_of(clause)
                );
            }
            let (params, result) = match flatten_pi(&inner[1]) {
                Some(parts) => parts,
                None => panic!(
                    "Inductive declaration error: constructor \"{}\" has malformed Pi-type `{}`",
                    name,
                    key_of(&inner[1])
                ),
            };
            match &result {
                Node::Leaf(r) if r == type_name => {}
                other => panic!(
                    "Inductive declaration error: constructor \"{}\" must return \"{}\" (got \"{}\")",
                    name,
                    type_name,
                    key_of(other)
                ),
            }
            ConstructorDecl {
                name,
                params,
                typ: inner[1].clone(),
            }
        }
        _ => panic!(
            "Inductive declaration error: malformed constructor clause `{}`",
            key_of(clause)
        ),
    }
}

/// Parse an `(inductive Name (constructor …) …)` form into an
/// [`InductiveDecl`]. Panics with `Inductive declaration error:` on a
/// malformed declaration so the existing diagnostic dispatch maps it to
/// `E033`.
pub fn parse_inductive_form(node: &Node) -> Option<InductiveDecl> {
    let children = match node {
        Node::List(items) => items,
        _ => return None,
    };
    if children.is_empty() {
        return None;
    }
    match &children[0] {
        Node::Leaf(h) if h == "inductive" => {}
        _ => return None,
    }
    let name = match children.get(1) {
        Some(Node::Leaf(s)) => s.clone(),
        _ => panic!("Inductive declaration error: type name must be a bare symbol"),
    };
    if !name.chars().next().map_or(false, |c| c.is_ascii_uppercase()) {
        panic!(
            "Inductive declaration error: declaration for \"{}\": type name must start with an uppercase letter",
            name
        );
    }
    if children.len() < 3 {
        panic!(
            "Inductive declaration error: declaration for \"{}\" must list at least one constructor",
            name
        );
    }
    let mut constructors: Vec<ConstructorDecl> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for clause in &children[2..] {
        let ctor = parse_constructor_clause(clause, &name);
        if seen.contains(&ctor.name) {
            panic!(
                "Inductive declaration error: declaration for \"{}\": constructor \"{}\" is declared more than once",
                name, ctor.name
            );
        }
        seen.insert(ctor.name.clone());
        constructors.push(ctor);
    }
    let elim_name = format!("{}-rec", name);
    let elim_type = build_eliminator_type(&name, &constructors);
    Some(InductiveDecl {
        name,
        constructors,
        elim_name,
        elim_type,
    })
}

fn build_case_type(ctor: &ConstructorDecl, type_name: &str, motive_var: &str) -> Node {
    let mut rec_binders: Vec<(String, Node)> = Vec::new();
    for (pname, ptype) in &ctor.params {
        if let Node::Leaf(s) = ptype {
            if s == type_name {
                rec_binders.push((
                    format!("ih_{}", pname),
                    Node::List(vec![
                        Node::Leaf("apply".to_string()),
                        Node::Leaf(motive_var.to_string()),
                        Node::Leaf(pname.clone()),
                    ]),
                ));
            }
        }
    }
    let ctor_applied = if ctor.params.is_empty() {
        Node::Leaf(ctor.name.clone())
    } else {
        let mut items = vec![Node::Leaf(ctor.name.clone())];
        for (pname, _) in &ctor.params {
            items.push(Node::Leaf(pname.clone()));
        }
        Node::List(items)
    };
    let motive_on_target = Node::List(vec![
        Node::Leaf("apply".to_string()),
        Node::Leaf(motive_var.to_string()),
        ctor_applied,
    ]);
    let inner = build_pi(&rec_binders, motive_on_target);
    build_pi(&ctor.params, inner)
}

/// Compose the dependent eliminator type for `Name-rec`, given the parsed
/// constructor list. The motive parameter binds the symbol `_motive`
/// throughout, and each constructor case parameter binds `case_<ctorName>`.
pub fn build_eliminator_type(type_name: &str, constructors: &[ConstructorDecl]) -> Node {
    let motive_var = "_motive";
    let motive_type = Node::List(vec![
        Node::Leaf("Pi".to_string()),
        Node::List(vec![
            Node::Leaf(type_name.to_string()),
            Node::Leaf("_".to_string()),
        ]),
        Node::List(vec![
            Node::Leaf("Type".to_string()),
            Node::Leaf("0".to_string()),
        ]),
    ]);
    let case_params: Vec<(String, Node)> = constructors
        .iter()
        .map(|c| (format!("case_{}", c.name), build_case_type(c, type_name, motive_var)))
        .collect();
    let target_var = "_target";
    let final_node = Node::List(vec![
        Node::Leaf("apply".to_string()),
        Node::Leaf(motive_var.to_string()),
        Node::Leaf(target_var.to_string()),
    ]);
    let inner = build_pi(
        &[(target_var.to_string(), Node::Leaf(type_name.to_string()))],
        final_node,
    );
    let with_cases = build_pi(&case_params, inner);
    build_pi(
        &[(motive_var.to_string(), motive_type)],
        with_cases,
    )
}

/// Install an inductive declaration on the environment: register the type,
/// every constructor, and the generated eliminator together with its
/// dependent Pi-type. Mirrors `registerInductive` in the JavaScript kernel.
pub fn register_inductive(env: &mut Env, decl: InductiveDecl) {
    let store_type = env.qualify_name(&decl.name);
    env.terms.insert(store_type.clone());
    let type0 = Node::List(vec![
        Node::Leaf("Type".to_string()),
        Node::Leaf("0".to_string()),
    ]);
    env.set_type(&store_type, &key_of(&type0));
    eval_node(&type0, env);

    for ctor in &decl.constructors {
        let store_name = env.qualify_name(&ctor.name);
        env.terms.insert(store_name.clone());
        env.set_type(&store_name, &key_of(&ctor.typ));
        if matches!(ctor.typ, Node::List(_)) {
            eval_node(&ctor.typ, env);
        }
    }

    let store_elim = env.qualify_name(&decl.elim_name);
    env.terms.insert(store_elim.clone());
    env.set_type(&store_elim, &key_of(&decl.elim_type));
    eval_node(&decl.elim_type, env);

    env.inductives.insert(decl.name.clone(), decl);
}

// ---------- Coinductive declarations (issue #53, D11) ----------
// Mirrors the JavaScript helpers in `js/src/rml-links.mjs`. The
// `(coinductive Name (constructor …) …)` form records a coinductive
// datatype, installs every constructor, and synthesises a corecursor
// `Name-corec` with a dependent Pi-type following the standard
// coiteration principle. The declaration also enforces a syntactic
// productivity check: at least one constructor must take a recursive
// `Name` argument (otherwise no infinite value can ever be generated).
// Errors panic with `Coinductive declaration error:` so
// `decode_panic_payload` maps them to E036.

fn parse_coinductive_constructor_clause(clause: &Node, type_name: &str) -> ConstructorDecl {
    let items = match clause {
        Node::List(items) if items.len() == 2 => items,
        _ => panic!(
            "Coinductive declaration error: each clause must be `(constructor <name>)` or `(constructor (<name> <pi-type>))`"
        ),
    };
    match &items[0] {
        Node::Leaf(h) if h == "constructor" => {}
        _ => panic!(
            "Coinductive declaration error: each clause must be `(constructor <name>)` or `(constructor (<name> <pi-type>))`"
        ),
    }
    match &items[1] {
        Node::Leaf(name) => ConstructorDecl {
            name: name.clone(),
            params: Vec::new(),
            typ: Node::Leaf(type_name.to_string()),
        },
        Node::List(inner) if inner.len() == 2 => {
            let name = match &inner[0] {
                Node::Leaf(s) => s.clone(),
                _ => panic!(
                    "Coinductive declaration error: malformed constructor clause `{}`",
                    key_of(clause)
                ),
            };
            if !is_pi_sig(&inner[1]) {
                panic!(
                    "Coinductive declaration error: malformed constructor clause `{}`",
                    key_of(clause)
                );
            }
            let (params, result) = match flatten_pi(&inner[1]) {
                Some(parts) => parts,
                None => panic!(
                    "Coinductive declaration error: constructor \"{}\" has malformed Pi-type `{}`",
                    name,
                    key_of(&inner[1])
                ),
            };
            match &result {
                Node::Leaf(r) if r == type_name => {}
                other => panic!(
                    "Coinductive declaration error: constructor \"{}\" must return \"{}\" (got \"{}\")",
                    name,
                    type_name,
                    key_of(other)
                ),
            }
            ConstructorDecl {
                name,
                params,
                typ: inner[1].clone(),
            }
        }
        _ => panic!(
            "Coinductive declaration error: malformed constructor clause `{}`",
            key_of(clause)
        ),
    }
}

/// Walk a constructor's parameter list and return whether it has at least
/// one recursive `type_name` argument. Used by the productivity check.
fn ctor_has_recursive_param(ctor: &ConstructorDecl, type_name: &str) -> bool {
    ctor.params.iter().any(|(_, ty)| {
        if let Node::Leaf(s) = ty {
            s == type_name
        } else {
            false
        }
    })
}

/// Parse a `(coinductive Name (constructor …) …)` form into a
/// [`CoinductiveDecl`]. Panics with `Coinductive declaration error:` on
/// a malformed or non-productive declaration so the existing diagnostic
/// dispatch maps it to `E036`.
pub fn parse_coinductive_form(node: &Node) -> Option<CoinductiveDecl> {
    let children = match node {
        Node::List(items) => items,
        _ => return None,
    };
    if children.is_empty() {
        return None;
    }
    match &children[0] {
        Node::Leaf(h) if h == "coinductive" => {}
        _ => return None,
    }
    let name = match children.get(1) {
        Some(Node::Leaf(s)) => s.clone(),
        _ => panic!("Coinductive declaration error: type name must be a bare symbol"),
    };
    if !name.chars().next().map_or(false, |c| c.is_ascii_uppercase()) {
        panic!(
            "Coinductive declaration error: declaration for \"{}\": type name must start with an uppercase letter",
            name
        );
    }
    if children.len() < 3 {
        panic!(
            "Coinductive declaration error: declaration for \"{}\" must list at least one constructor",
            name
        );
    }
    let mut constructors: Vec<ConstructorDecl> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for clause in &children[2..] {
        let ctor = parse_coinductive_constructor_clause(clause, &name);
        if seen.contains(&ctor.name) {
            panic!(
                "Coinductive declaration error: declaration for \"{}\": constructor \"{}\" is declared more than once",
                name, ctor.name
            );
        }
        seen.insert(ctor.name.clone());
        constructors.push(ctor);
    }
    let any_recursive = constructors.iter().any(|c| ctor_has_recursive_param(c, &name));
    if !any_recursive {
        panic!(
            "Coinductive declaration error: declaration for \"{}\" is non-productive: at least one constructor must take a recursive \"{}\" argument",
            name, name
        );
    }
    let corec_name = format!("{}-corec", name);
    let corec_type = build_corecursor_type(&name, &constructors);
    Some(CoinductiveDecl {
        name,
        constructors,
        corec_name,
        corec_type,
    })
}

fn build_corec_case_type(ctor: &ConstructorDecl, type_name: &str, state_var: &str) -> Node {
    let dual_params: Vec<(String, Node)> = ctor
        .params
        .iter()
        .map(|(pname, ptype)| {
            let new_type = match ptype {
                Node::Leaf(s) if s == type_name => Node::Leaf(state_var.to_string()),
                other => other.clone(),
            };
            (pname.clone(), new_type)
        })
        .collect();
    let inner = build_pi(&dual_params, Node::Leaf(type_name.to_string()));
    build_pi(
        &[(
            "_state".to_string(),
            Node::Leaf(state_var.to_string()),
        )],
        inner,
    )
}

/// Compose the dependent corecursor type for `Name-corec`, given the parsed
/// constructor list. The state parameter binds the symbol `_state_type`
/// throughout, and each constructor case parameter binds `case_<ctorName>`.
pub fn build_corecursor_type(type_name: &str, constructors: &[ConstructorDecl]) -> Node {
    let state_var = "_state_type";
    let state_type = Node::List(vec![
        Node::Leaf("Type".to_string()),
        Node::Leaf("0".to_string()),
    ]);
    let case_params: Vec<(String, Node)> = constructors
        .iter()
        .map(|c| {
            (
                format!("case_{}", c.name),
                build_corec_case_type(c, type_name, state_var),
            )
        })
        .collect();
    let seed_var = "_seed";
    let final_node = Node::Leaf(type_name.to_string());
    let inner = build_pi(
        &[(seed_var.to_string(), Node::Leaf(state_var.to_string()))],
        final_node,
    );
    let with_cases = build_pi(&case_params, inner);
    build_pi(
        &[(state_var.to_string(), state_type)],
        with_cases,
    )
}

/// Install a coinductive declaration on the environment: register the type,
/// every constructor, and the generated corecursor together with its
/// dependent Pi-type. Mirrors `registerCoinductive` in the JavaScript kernel.
pub fn register_coinductive(env: &mut Env, decl: CoinductiveDecl) {
    let store_type = env.qualify_name(&decl.name);
    env.terms.insert(store_type.clone());
    let type0 = Node::List(vec![
        Node::Leaf("Type".to_string()),
        Node::Leaf("0".to_string()),
    ]);
    env.set_type(&store_type, &key_of(&type0));
    eval_node(&type0, env);

    for ctor in &decl.constructors {
        let store_name = env.qualify_name(&ctor.name);
        env.terms.insert(store_name.clone());
        env.set_type(&store_name, &key_of(&ctor.typ));
        if matches!(ctor.typ, Node::List(_)) {
            eval_node(&ctor.typ, env);
        }
    }

    let store_corec = env.qualify_name(&decl.corec_name);
    env.terms.insert(store_corec.clone());
    env.set_type(&store_corec, &key_of(&decl.corec_type));
    eval_node(&decl.corec_type, env);

    env.coinductives.insert(decl.name.clone(), decl);
}

pub fn decide_automatic_sequence_theorem(name: &str) -> Option<AutomaticSequenceDecision> {
    if name == "thue-morse-cube-free" {
        return Some(AutomaticSequenceDecision {
            theorem: name.to_string(),
            value: true,
            method: "built-in Buchi emptiness certificate".to_string(),
            certificate: Node::List(vec![
                Node::Leaf("buchi-emptiness".to_string()),
                Node::Leaf("thue-morse".to_string()),
                Node::Leaf("cube-free".to_string()),
            ]),
        });
    }
    None
}

pub fn automatic_sequences_domain_plugin(forms: &[Node], env: &mut Env) -> Result<(), String> {
    if forms.is_empty() {
        return Err("automatic-sequences domain requires at least one request".to_string());
    }
    let theorem_shape_error = "automatic-sequences entries must be `(theorem <name>)`".to_string();
    for form in forms {
        let theorem_name = match form {
            Node::List(children) if children.len() == 2 => {
                if let (Node::Leaf(head), Node::Leaf(name)) = (&children[0], &children[1]) {
                    if head == "theorem" {
                        name.clone()
                    } else {
                        return Err(theorem_shape_error.clone());
                    }
                } else {
                    return Err(theorem_shape_error.clone());
                }
            }
            _ => {
                return Err(theorem_shape_error.clone());
            }
        };
        let mut decision = decide_automatic_sequence_theorem(&theorem_name)
            .ok_or_else(|| format!("unknown automatic-sequences theorem \"{}\"", theorem_name))?;
        let store_name = env.qualify_name(&decision.theorem);
        let truth_value = if decision.value { env.hi } else { env.lo };
        env.terms.insert(store_name.clone());
        env.set_type(&store_name, "Theorem");
        env.set_symbol_prob(&store_name, truth_value);
        decision.theorem = store_name.clone();
        env.automatic_sequence_decisions
            .insert(store_name.clone(), decision);
        env.trace(
            "domain",
            format!("{} decided by automatic-sequences", store_name),
        );
    }
    Ok(())
}

fn eval_domain_form(children: &[Node], env: &mut Env) -> EvalResult {
    if children.len() < 3 {
        panic!("Domain plugin error: Domain form must be `(domain <name> <request>...)`");
    }
    let plugin_name = match &children[1] {
        Node::Leaf(name) => name.clone(),
        _ => {
            panic!("Domain plugin error: Domain form must be `(domain <name> <request>...)`");
        }
    };
    let plugin = env.get_domain_plugin(&plugin_name).unwrap_or_else(|| {
        panic!(
            "Domain plugin error: Unknown domain plugin \"{}\"",
            plugin_name
        )
    });
    if let Err(message) = plugin(&children[2..], env) {
        panic!("Domain plugin error: {}", message);
    }
    EvalResult::Value(1.0)
}

/// Evaluate an AST node in the given environment.
pub fn eval_node(node: &Node, env: &mut Env) -> EvalResult {
    // HOAS desugaring (issue #51, D7): rewrite `(forall (A x) body)` to
    // `(Pi (A x) body)` so callers passing AST nodes directly to `eval_node`
    // benefit from the same surface as `evaluate()` / `parse_term_input_str`.
    // The recursive walk also handles `forall` nested inside definition RHSs
    // such as `(succ: (forall (Natural n) Natural))`.
    let desugared;
    let node = if matches!(node, Node::List(_)) {
        desugared = desugar_hoas(node.clone());
        &desugared
    } else {
        node
    };
    match node {
        Node::Leaf(s) => {
            if is_num(s) {
                EvalResult::Value(env.to_num(s))
            } else {
                EvalResult::Value(env.get_symbol_prob(s))
            }
        }
        Node::List(children) => {
            if children.is_empty() {
                return EvalResult::Value(0.0);
            }

            // Definitions & operator redefs: (head: ...) form
            if let Node::Leaf(ref s) = children[0] {
                if s.ends_with(':') {
                    let head = &s[..s.len() - 1];
                    return define_form(head, &children[1..], env);
                }
            }

            // Note: (x : A) with spaces as a standalone colon separator is NOT supported.
            // Use (x: A) instead — the colon must be part of the link name.

            // Mode declaration (issue #43, D15): (mode <name> +input -output ...)
            // Records the per-argument mode pattern for a relation. Validation
            // lives in `parse_mode_form`, which panics with `Mode declaration
            // error:` on a malformed declaration so `decode_panic_payload`
            // surfaces it as E030.
            if let Node::Leaf(ref head) = children[0] {
                if head == "mode" {
                    if let Some((name, flags)) = parse_mode_form(children) {
                        env.modes.insert(name, flags);
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Relation declaration (issue #44, D12): (relation <name> <clause>...)
            // Stores the clause list keyed by relation name. `parse_relation_form`
            // panics with `Relation declaration error:` on a malformed
            // declaration so `decode_panic_payload` surfaces it as E032.
            if let Node::Leaf(ref head) = children[0] {
                if head == "relation" {
                    let (name, clauses) = parse_relation_form(children);
                    env.relations.insert(name, clauses);
                    return EvalResult::Value(1.0);
                }
            }

            // Totality declaration (issue #44, D12): (total <name>) runs
            // `is_total` and surfaces the first diagnostic via the existing
            // panic-based dispatch (`Totality check error:` -> E032).
            if let Node::Leaf(ref head) = children[0] {
                if head == "total" {
                    if children.len() == 2 {
                        if let Node::Leaf(ref rel_name) = children[1] {
                            let result = is_total(env, rel_name);
                            if !result.ok {
                                if let Some(first) = result.diagnostics.first() {
                                    panic!("Totality check error: {}", first.message);
                                }
                            }
                            return EvalResult::Value(1.0);
                        }
                    }
                    panic!(
                        "Totality check error: Totality declaration must be `(total <relation-name>)`"
                    );
                }
            }

            // Definition declaration (issue #49, D13):
            //   (define <name> [(measure (lex <slot>...))] (case <pat> <body>) ...)
            // Records the recursive definition on the env so termination can
            // be queried later. `parse_define_form` panics with
            // `Termination check error:` on a malformed declaration so
            // `decode_panic_payload` surfaces it as E035.
            if let Node::Leaf(ref head) = children[0] {
                if head == "define" {
                    let decl = parse_define_form(children);
                    env.definitions.insert(decl.name.clone(), decl);
                    return EvalResult::Value(1.0);
                }
            }

            // Termination declaration (issue #49, D13): (terminating <name>)
            // runs `is_terminating` and surfaces the first diagnostic via
            // the existing panic-based dispatch (`Termination check error:`
            // -> E035).
            if let Node::Leaf(ref head) = children[0] {
                if head == "terminating" {
                    if children.len() == 2 {
                        if let Node::Leaf(ref def_name) = children[1] {
                            let result = is_terminating(env, def_name);
                            if !result.ok {
                                if let Some(first) = result.diagnostics.first() {
                                    panic!("Termination check error: {}", first.message);
                                }
                            }
                            return EvalResult::Value(1.0);
                        }
                    }
                    panic!(
                        "Termination check error: Termination declaration must be `(terminating <definition-name>)`"
                    );
                }
            }

            // Coverage declaration (issue #46, D14): (coverage <name>) runs
            // `is_covered`. The first diagnostic becomes the panic so the
            // surrounding form gets a span; any extras land in
            // `shadow_diagnostics` so each missing slot reaches the user.
            if let Node::Leaf(ref head) = children[0] {
                if head == "coverage" {
                    if children.len() == 2 {
                        if let Node::Leaf(ref rel_name) = children[1] {
                            let result = is_covered(env, rel_name);
                            if !result.ok {
                                let span = env
                                    .current_span
                                    .clone()
                                    .unwrap_or_else(|| env.default_span.clone());
                                if result.diagnostics.len() > 1 {
                                    for d in result.diagnostics.iter().skip(1) {
                                        env.shadow_diagnostics.push(Diagnostic::new(
                                            &d.code,
                                            d.message.clone(),
                                            span.clone(),
                                        ));
                                    }
                                }
                                if let Some(first) = result.diagnostics.first() {
                                    panic!("Coverage check error: {}", first.message);
                                }
                            }
                            return EvalResult::Value(1.0);
                        }
                    }
                    panic!(
                        "Coverage check error: Coverage declaration must be `(coverage <relation-name>)`"
                    );
                }
            }

            // World declaration (issue #54, D16): (world <name> (<const>...))
            // Records the allow-list of free constants permitted in arguments
            // of a relation. `parse_world_form` panics with `World declaration
            // error:` on a malformed declaration so `decode_panic_payload`
            // surfaces it as E034.
            if let Node::Leaf(ref head) = children[0] {
                if head == "world" {
                    if let Some((name, allowed)) = parse_world_form(children) {
                        env.worlds.insert(name, allowed);
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Inductive declaration (issue #45, D10):
            //   (inductive Name (constructor c1) (constructor (c2 (Pi ...))) ...)
            // Stores the type, every constructor, and a generated `Name-rec`
            // eliminator on the env so they participate in `(of)`,
            // `(type of …)`, and the bidirectional checker.
            // `parse_inductive_form` panics with `Inductive declaration error:`
            // on a malformed declaration, which `decode_panic_payload` maps
            // to E033.
            if let Node::Leaf(ref head) = children[0] {
                if head == "inductive" {
                    if let Some(decl) = parse_inductive_form(node) {
                        register_inductive(env, decl);
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Coinductive declaration (issue #53, D11):
            //   (coinductive Name (constructor c1) (constructor (c2 (Pi ...))) ...)
            // Stores the type, every constructor, and a generated
            // `Name-corec` corecursor on the env. The form additionally
            // enforces a syntactic productivity check: at least one
            // constructor must take a recursive argument so non-productive
            // types (which cannot generate any infinite values) are
            // rejected up front. `parse_coinductive_form` panics with
            // `Coinductive declaration error:` on a malformed or
            // non-productive declaration, which `decode_panic_payload`
            // maps to E035.
            if let Node::Leaf(ref head) = children[0] {
                if head == "coinductive" {
                    if let Some(decl) = parse_coinductive_form(node) {
                        register_coinductive(env, decl);
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Domain plugin driver (issue #63): (domain <name> <request>...)
            // Dispatches the block body to a registered domain-specific
            // decision procedure. The default Env registers
            // `automatic-sequences`.
            if let Node::Leaf(ref head) = children[0] {
                if head == "domain" {
                    return eval_domain_form(children, env);
                }
            }

            // Mode-mismatch check (issue #43, D15): a call `(name args...)`
            // whose head has a registered mode declaration must agree with the
            // declared flags. Run before head evaluation so the diagnostic
            // points at the call site rather than at a downstream reduction.
            if let Node::Leaf(ref head) = children[0] {
                if env.modes.contains_key(head) {
                    let head_owned = head.clone();
                    let args: Vec<Node> = children[1..].to_vec();
                    check_mode_at_call(&head_owned, &args, env);
                }
            }

            // World-violation check (issue #54, D16): a call `(name args...)`
            // whose head has a registered world declaration must only contain
            // declared constants free in its arguments. Surface the first
            // offending free constant as E033.
            if let Node::Leaf(ref head) = children[0] {
                if env.worlds.contains_key(head) {
                    let head_owned = head.clone();
                    let args: Vec<Node> = children[1..].to_vec();
                    check_world_at_call(&head_owned, &args, env);
                }
            }

            // Assignment: ((expr) has probability p)
            if children.len() == 4 {
                if let (Node::Leaf(ref w1), Node::Leaf(ref w2), Node::Leaf(ref w3)) =
                    (&children[1], &children[2], &children[3])
                {
                    if w1 == "has" && w2 == "probability" && is_num(w3) {
                        let p: f64 = w3.parse().unwrap_or(0.0);
                        // Carrier enforcement (issue #97, Section 2): if an
                        // enclosing `(with-foundation ...)` declared a strict
                        // carrier, the assigned value must belong to that
                        // carrier. Violations surface as E063 instead of
                        // being silently clamped. We panic with a
                        // "Carrier violation:" prefix so the surrounding
                        // catch_unwind translates it to a Diagnostic.
                        let clamped = env.clamp(p);
                        if let Some(msg) = env.check_carrier_value(clamped) {
                            panic!(
                                "Carrier violation: Probability assignment {} = {} violates active foundation carrier: {}",
                                key_of(&children[0]),
                                format_trace_value(clamped),
                                msg
                            );
                        }
                        env.set_expr_prob(&children[0], p);
                        let key = key_of(&children[0]);
                        env.trace(
                            "assign",
                            format!("{} ← {}", key, format_trace_value(clamped)),
                        );
                        return EvalResult::Value(env.to_num(w3));
                    }
                }
            }

            // Range configuration: (range lo hi) prefix form
            if children.len() == 3 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "range" {
                        if let (Node::Leaf(ref lo_s), Node::Leaf(ref hi_s)) =
                            (&children[1], &children[2])
                        {
                            if is_num(lo_s) && is_num(hi_s) {
                                env.lo = lo_s.parse().unwrap_or(0.0);
                                env.hi = hi_s.parse().unwrap_or(1.0);
                                env.reinit_ops();
                                return EvalResult::Value(1.0);
                            }
                        }
                    }
                }
            }

            // Valence configuration: (valence N) prefix form
            if children.len() == 2 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "valence" {
                        if let Node::Leaf(ref val_s) = children[1] {
                            if is_num(val_s) {
                                env.valence = val_s.parse::<f64>().unwrap_or(0.0) as u32;
                                return EvalResult::Value(1.0);
                            }
                        }
                    }
                }
            }

            // Query: (? expr) or (? expr with proof)
            // The trailing `with proof` keyword pair is consumed here so it
            // does not interfere with evaluation; `evaluate_inner` looks at
            // the original form to decide whether to populate a proof slot.
            // The proof itself is built by `build_proof` after evaluation.
            if let Node::Leaf(ref first) = children[0] {
                if first == "?" {
                    let parts = strip_with_proof(&children[1..]);
                    let target: Node = if parts.len() == 1 {
                        parts[0].clone()
                    } else {
                        Node::List(parts.to_vec())
                    };
                    let result = eval_node(&target, env);
                    // If inner result is already a type query, pass it through
                    if result.is_type_query() {
                        return result;
                    }
                    if let EvalResult::Term(term) = result {
                        return EvalResult::TypeQuery(key_of(&term));
                    }
                    let v = result.as_f64();
                    return EvalResult::Query(env.clamp(v));
                }
            }

            // Kernel substitution primitive: (subst term x replacement)
            if children.len() == 4 {
                if let (Node::Leaf(ref head), Node::Leaf(ref var_name)) =
                    (&children[0], &children[2])
                {
                    if head == "subst" {
                        let term = eval_term_node(node, env);
                        let _ = var_name;
                        return EvalResult::Term(term);
                    }
                }
            }

            // Freshness binder: (fresh x in body)
            if children.len() == 4 {
                if let (Node::Leaf(ref head), Node::Leaf(ref var_name), Node::Leaf(ref in_kw)) =
                    (&children[0], &children[1], &children[2])
                {
                    if head == "fresh" && in_kw == "in" {
                        return eval_fresh(var_name, &children[3], env);
                    }
                }
            }

            // Infix arithmetic: (A + B), (A - B), (A * B), (A / B)
            // Arithmetic uses raw numeric values (not clamped to the logic range)
            if children.len() == 3 {
                if let Node::Leaf(ref op_name) = children[1] {
                    if op_name == "+" || op_name == "-" || op_name == "*" || op_name == "/" {
                        let l = eval_arith(&children[0], env);
                        let r = eval_arith(&children[2], env);
                        return EvalResult::Value(env.apply_op(op_name, &[l, r]));
                    }
                }
            }

            // Infix numeric comparisons: (A < B), (A <= B)
            if children.len() == 3 {
                if let Node::Leaf(ref op_name) = children[1] {
                    if op_name == "<" || op_name == "<=" {
                        let l = eval_arith(&children[0], env);
                        let r = eval_arith(&children[2], env);
                        return EvalResult::Value(env.clamp(env.apply_op(op_name, &[l, r])));
                    }
                }
            }

            // Infix AND/OR/BOTH/NEITHER: ((A) and (B)) / ((A) or (B)) / ((A) both (B)) / ((A) neither (B))
            if children.len() == 3 {
                if let Node::Leaf(ref op_name) = children[1] {
                    if op_name == "and"
                        || op_name == "or"
                        || op_name == "both"
                        || op_name == "neither"
                    {
                        let l = eval_node(&children[0], env).as_f64();
                        let r = eval_node(&children[2], env).as_f64();
                        return EvalResult::Value(env.clamp(env.apply_op(op_name, &[l, r])));
                    }
                }
            }

            // Composite natural language operators: (both A and B [and C ...]), (neither A nor B [nor C ...])
            if children.len() >= 4 && children.len() % 2 == 0 {
                if let Node::Leaf(ref head) = children[0] {
                    if head == "both" || head == "neither" {
                        let sep = if head == "both" { "and" } else { "nor" };
                        let mut valid = true;
                        for i in (2..children.len()).step_by(2) {
                            if let Node::Leaf(ref s) = children[i] {
                                if s != sep {
                                    valid = false;
                                    break;
                                }
                            } else {
                                valid = false;
                                break;
                            }
                        }
                        if valid {
                            let head_str = head.clone();
                            let vals: Vec<f64> = (1..children.len())
                                .step_by(2)
                                .map(|i| eval_node(&children[i], env).as_f64())
                                .collect();
                            return EvalResult::Value(env.clamp(env.apply_op(&head_str, &vals)));
                        }
                    }
                }
            }

            // Infix equality/inequality: (L = R), (L != R)
            if children.len() == 3 {
                if let Node::Leaf(ref op_name) = children[1] {
                    if op_name == "=" {
                        return eval_equality_node(&children[0], "=", &children[2], env);
                    }
                    if op_name == "!=" {
                        return eval_equality_node(&children[0], "!=", &children[2], env);
                    }
                }
            }

            // ---------- Type System: "everything is a link" ----------

            // Type universe: (Type N)
            if children.len() == 2 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "Type" {
                        if let Node::Leaf(ref level_s) = children[1] {
                            if let Some(level) = parse_universe_level_token(level_s) {
                                if let Some(next_level) = level.checked_add(1) {
                                    let key = key_of(&Node::List(children.clone()));
                                    env.set_type(&key, &format!("(Type {})", next_level));
                                    return EvalResult::Value(1.0);
                                }
                            }
                        }
                    }
                }
            }

            // Prop: (Prop) sugar for (Type 0)
            if children.len() == 1 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "Prop" {
                        env.set_type("(Prop)", "(Type 1)");
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Dependent product (Pi-type): (Pi (x: A) B)
            if children.len() == 3 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "Pi" {
                        if let Some((param_name, param_type)) = parse_binding(&children[1]) {
                            env.terms.insert(param_name.clone());
                            env.set_type(&param_name, &param_type);
                            let key = key_of(&Node::List(children.clone()));
                            env.set_type(&key, "(Type 0)");
                        }
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Lambda abstraction: (lambda (A x) body) or (lambda (x: A) body)
            // Also supports multi-param: (lambda (A x, B y) body)
            if children.len() == 3 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "lambda" {
                        if let Some(bindings) = parse_bindings(&children[1]) {
                            if !bindings.is_empty() {
                                let (ref param_name, ref param_type) = bindings[0];
                                env.terms.insert(param_name.clone());
                                env.set_type(param_name, param_type);
                                // Register additional bindings
                                for binding in &bindings[1..] {
                                    env.terms.insert(binding.0.clone());
                                    env.set_type(&binding.0, &binding.1);
                                }
                                let body_key = key_of(&children[2]);
                                let body_type = env
                                    .get_type(&body_key)
                                    .cloned()
                                    .unwrap_or_else(|| "unknown".to_string());
                                let key = key_of(&Node::List(children.clone()));
                                env.set_type(
                                    &key,
                                    &format!("(Pi ({} {}) {})", param_type, param_name, body_type),
                                );
                            }
                        }
                        return EvalResult::Value(1.0);
                    }
                }
            }

            // Normalization drivers (issue #50, D4):
            //   (whnf <expr>)         — weak-head normal form
            //   (nf <expr>)           — full normal form
            //   (normal-form <expr>)  — alias for `nf`
            // Each driver returns an `EvalResult::Term` whose printed form
            // is the reduct. Malformed driver shapes panic with
            // `Normalization error:` so `decode_panic_payload` maps them
            // to E038.
            if let Node::Leaf(ref first) = children[0] {
                if first == "whnf" {
                    if children.len() == 2 {
                        let opts = ConvertOptions::default();
                        let reduced = whnf_term(&children[1], env, opts);
                        return EvalResult::Term(reduced);
                    }
                    panic!("Normalization error: Normalization form must be `(whnf <expr>)`");
                }
                if first == "nf" {
                    if children.len() == 2 {
                        let opts = ConvertOptions::default();
                        let normalized = normalize_term(&children[1], env, opts);
                        let flat = flatten_neutral_applies(&normalized, env);
                        return EvalResult::Term(flat);
                    }
                    panic!("Normalization error: Normalization form must be `(nf <expr>)`");
                }
                if first == "normal-form" {
                    if children.len() == 2 {
                        let opts = ConvertOptions::default();
                        let normalized = normalize_term(&children[1], env, opts);
                        let flat = flatten_neutral_applies(&normalized, env);
                        return EvalResult::Term(flat);
                    }
                    panic!("Normalization error: Normalization form must be `(normal-form <expr>)`");
                }
            }

            // Application: (apply f x) — explicit application with beta-reduction
            if children.len() == 3 {
                if let Node::Leaf(ref first) = children[0] {
                    if first == "apply" {
                        let fn_node = &children[1];
                        let arg = &children[2];

                        // Check if fn is a lambda: (lambda (A x) body)
                        if let Node::List(ref fn_children) = fn_node {
                            if fn_children.len() == 3 {
                                if let Node::Leaf(ref fn_head) = fn_children[0] {
                                    if fn_head == "lambda" {
                                        if let Some((param_name, _)) =
                                            parse_binding(&fn_children[1])
                                        {
                                            let body = &fn_children[2];
                                            let result = subst(body, &param_name, arg);
                                            return eval_reduced_term(&result, env);
                                        }
                                    }
                                }
                            }
                        }

                        // Check if fn is a named lambda
                        if let Node::Leaf(ref fn_name) = fn_node {
                            if let Some(lambda) = env.get_lambda(fn_name).cloned() {
                                let result = subst(&lambda.body, &lambda.param, arg);
                                return eval_reduced_term(&result, env);
                            }
                        }

                        // Otherwise evaluate both
                        let f_val = eval_node(fn_node, env).as_f64();
                        return EvalResult::Value(f_val);
                    }
                }
            }

            // Type query: (type of expr) — returns the type of an expression
            // e.g. (? (type of x)) → returns the type string
            if children.len() == 3 {
                if let (Node::Leaf(ref first), Node::Leaf(ref mid)) = (&children[0], &children[1]) {
                    if first == "type" && mid == "of" {
                        let type_str = infer_type_key(&children[2], env)
                            .unwrap_or_else(|| "unknown".to_string());
                        return EvalResult::TypeQuery(type_str);
                    }
                }
            }

            // Type check query: (expr of Type) — checks if expr has the given type
            // e.g. (? (x of Natural)) → returns 1 or 0
            if children.len() == 3 {
                if let Node::Leaf(ref mid) = children[1] {
                    if mid == "of" {
                        let expected_key = match &children[2] {
                            Node::Leaf(s) => s.clone(),
                            other => key_of(other),
                        };
                        if let Some(actual) = infer_type_key(&children[0], env) {
                            return EvalResult::Value(if actual == expected_key {
                                env.hi
                            } else {
                                env.lo
                            });
                        }
                        return EvalResult::Value(env.lo);
                    }
                }
            }

            // Prefix: (not X), (and X Y ...), (or X Y ...)
            if let Node::Leaf(ref head) = children[0] {
                let head_str = head.clone();
                if (head_str == "=" || head_str == "!=") && children.len() == 3 {
                    return eval_equality_node(&children[1], &head_str, &children[2], env);
                }
                if env.has_op(&head_str) {
                    let vals: Vec<f64> = children[1..]
                        .iter()
                        .map(|a| eval_node(a, env).as_f64())
                        .collect();
                    return EvalResult::Value(env.clamp(env.apply_op(&head_str, &vals)));
                }

                // Named lambda application: (name arg ...)
                if children.len() >= 2 {
                    if let Some(lambda) = env.get_lambda(&head_str).cloned() {
                        let result = subst(&lambda.body, &lambda.param, &children[1]);
                        if children.len() == 2 {
                            return eval_reduced_term(&result, env);
                        }
                        let mut next = vec![result];
                        next.extend_from_slice(&children[2..]);
                        return eval_reduced_term(&Node::List(next), env);
                    }
                }
            }

            // Prefix application with an inline lambda head: ((lambda (A x) body) arg)
            if children.len() >= 2 {
                if let Node::List(head_children) = &children[0] {
                    if head_children.len() == 3 {
                        if let Node::Leaf(fn_head) = &head_children[0] {
                            if fn_head == "lambda" {
                                if let Some((param_name, _)) = parse_binding(&head_children[1]) {
                                    let result =
                                        subst(&head_children[2], &param_name, &children[1]);
                                    if children.len() == 2 {
                                        return eval_reduced_term(&result, env);
                                    }
                                    let mut next = vec![result];
                                    next.extend_from_slice(&children[2..]);
                                    return eval_reduced_term(&Node::List(next), env);
                                }
                            }
                        }
                    }
                }
            }

            EvalResult::Value(0.0)
        }
    }
}

/// Process definition forms: (head: rhs...)
fn define_form(head: &str, rhs: &[Node], env: &mut Env) -> EvalResult {
    // Configuration directives are file-level and never namespaced.
    // Range configuration: (range: lo hi)
    if head == "range" && rhs.len() == 2 {
        if let (Node::Leaf(ref lo_s), Node::Leaf(ref hi_s)) = (&rhs[0], &rhs[1]) {
            if is_num(lo_s) && is_num(hi_s) {
                env.lo = lo_s.parse().unwrap_or(0.0);
                env.hi = hi_s.parse().unwrap_or(1.0);
                env.reinit_ops();
                return EvalResult::Value(1.0);
            }
        }
    }

    // Valence configuration: (valence: N)
    if head == "valence" && rhs.len() == 1 {
        if let Node::Leaf(ref val_s) = rhs[0] {
            if is_num(val_s) {
                env.valence = val_s.parse::<f64>().unwrap_or(0.0) as u32;
                return EvalResult::Value(1.0);
            }
        }
    }

    // Bindings introduced inside `(namespace foo)` are stored under `foo.head`.
    // The syntactic head (e.g. `a` in `(a: a is a)`) is still used to match
    // patterns; only the storage key is qualified.
    let store_name = env.qualify_name(head);
    // Shadowing diagnostic (E008): if this name was already imported, warn.
    if store_name != head || env.namespace.is_none() {
        maybe_warn_shadow(env, &store_name);
    } else {
        maybe_warn_shadow(env, head);
    }

    // Term definition: (a: a is a) → declare 'a' as a term
    if rhs.len() == 3 {
        if let (Node::Leaf(ref r0), Node::Leaf(ref r1), Node::Leaf(ref r2)) =
            (&rhs[0], &rhs[1], &rhs[2])
        {
            if r1 == "is" && r0 == head && r2 == head {
                env.terms.insert(store_name.clone());
                return EvalResult::Value(1.0);
            }
        }
    }

    // Prefix type notation: (name: TypeName name) → typed self-referential declaration
    // e.g. (zero: Natural zero), (boolean: Type boolean), (true: Boolean true)
    if rhs.len() == 2 {
        if let Node::Leaf(ref last) = rhs[1] {
            if last == head {
                match &rhs[0] {
                    Node::Leaf(ref type_name)
                        if type_name.starts_with(|c: char| c.is_uppercase()) =>
                    {
                        env.terms.insert(store_name.clone());
                        env.types.insert(store_name.clone(), type_name.clone());
                        return EvalResult::Value(1.0);
                    }
                    Node::List(_) => {
                        env.terms.insert(store_name.clone());
                        let type_key = key_of(&rhs[0]);
                        env.types.insert(store_name.clone(), type_key);
                        eval_node(&rhs[0], env);
                        return EvalResult::Value(1.0);
                    }
                    _ => {}
                }
            }
        }
    }

    // Optional symbol prior: (a: 0.7)
    if rhs.len() == 1 {
        if let Node::Leaf(ref val_s) = rhs[0] {
            if is_num(val_s) {
                let p: f64 = val_s.parse().unwrap_or(0.0);
                env.set_symbol_prob(&store_name, p);
                return EvalResult::Value(env.to_num(val_s));
            }
        }
    }

    // Operator redefinitions
    let is_op_name = head == "="
        || head == "!="
        || head == "and"
        || head == "or"
        || head == "both"
        || head == "neither"
        || head == "not"
        || head == "is"
        || head == "?:"
        || head.contains('=')
        || head.contains('!');

    if is_op_name {
        // Operator alias: `(not: not)` inside a namespace exports the existing
        // operator under the qualified name, e.g. `classical.not`.
        if rhs.len() == 1 {
            if let Node::Leaf(ref target) = rhs[0] {
                if let Some(op) = env.get_op(target.as_str()).cloned() {
                    env.define_op(&store_name, op);
                    env.trace("resolve", format!("({}: {})", store_name, target));
                    return EvalResult::Value(1.0);
                }
            }
        }

        // Composition like: (!=: not =) or (=: =) (no-op)
        if rhs.len() == 2 {
            if let (Node::Leaf(ref outer), Node::Leaf(ref inner)) = (&rhs[0], &rhs[1]) {
                if env.has_op(outer.as_str()) && env.has_op(inner.as_str()) {
                    env.define_op(
                        &store_name,
                        Op::Compose {
                            outer: outer.clone(),
                            inner: inner.clone(),
                        },
                    );
                    env.trace("resolve", format!("({}: {} {})", store_name, outer, inner));
                    return EvalResult::Value(1.0);
                }
                // Mirror JS behavior: surface a diagnostic for the missing op.
                if !env.has_op(outer.as_str()) {
                    panic!("Unknown op: {}", outer);
                }
                if !env.has_op(inner.as_str()) {
                    panic!("Unknown op: {}", inner);
                }
            }
        }

        // Aggregator selection: (and: avg|min|max|product|probabilistic_sum)
        if (head == "and" || head == "or" || head == "both" || head == "neither") && rhs.len() == 1
        {
            if let Node::Leaf(ref sel) = rhs[0] {
                if let Some(agg) = Aggregator::from_name(sel) {
                    env.define_op(&store_name, Op::Agg(agg));
                    env.trace("resolve", format!("({}: {})", store_name, sel));
                    return EvalResult::Value(1.0);
                } else {
                    panic!("Unknown aggregator \"{}\"", sel);
                }
            }
        }
    }

    // Lambda definition: (name: lambda (A x) body)
    if rhs.len() >= 2 {
        if let Node::Leaf(ref first) = rhs[0] {
            if first == "lambda" && rhs.len() == 3 {
                if let Some((param_name, param_type)) = parse_binding(&rhs[1]) {
                    let body = rhs[2].clone();
                    env.terms.insert(store_name.clone());
                    let had_param_term = env.terms.contains(&param_name);
                    let previous_param_type = env.get_type(&param_name).cloned();
                    env.terms.insert(param_name.clone());
                    env.set_type(&param_name, &param_type);
                    let body_key = key_of(&body);
                    let body_type =
                        env.get_type(&body_key)
                            .cloned()
                            .unwrap_or_else(|| match &body {
                                Node::Leaf(s) => s.clone(),
                                other => key_of(other),
                            });
                    if !had_param_term {
                        env.terms.remove(&param_name);
                    }
                    if let Some(previous) = previous_param_type {
                        env.set_type(&param_name, &previous);
                    } else {
                        env.types.remove(&param_name);
                    }
                    env.set_type(
                        &store_name,
                        &format!("(Pi ({} {}) {})", param_type, param_name, body_type),
                    );
                    env.set_lambda(
                        &store_name,
                        Lambda {
                            param: param_name,
                            param_type,
                            body,
                        },
                    );
                    return EvalResult::Value(1.0);
                }
            }
        }
    }

    // Typed declaration with complex type expression: (succ: (Pi (Natural n) Natural))
    // Only complex expressions (arrays/lists) are accepted as type annotations in single-element form.
    // Simple name type annotations like (x: Natural) are NOT supported — use (x: Natural x) prefix form instead.
    if rhs.len() == 1 {
        let is_op = head == "="
            || head == "!="
            || head == "and"
            || head == "or"
            || head == "both"
            || head == "neither"
            || head == "not"
            || head == "is"
            || head == "?:"
            || head.contains('=')
            || head.contains('!');

        if !is_op {
            if let Node::List(_) = &rhs[0] {
                env.terms.insert(store_name.clone());
                let type_key = key_of(&rhs[0]);
                env.set_type(&store_name, &type_key);
                eval_node(&rhs[0], env);
                return EvalResult::Value(1.0);
            }
        }
    }

    // Generic symbol alias like (x: y) just copies y's prior probability if any
    if rhs.len() == 1 {
        if let Node::Leaf(ref sym) = rhs[0] {
            let prob = env.get_symbol_prob(sym);
            env.set_symbol_prob(&store_name, prob);
            return EvalResult::Value(env.get_symbol_prob(&store_name));
        }
    }

    // Else: ignore (keeps PoC minimal)
    EvalResult::Value(0.0)
}

/// Emit a shadowing warning (E008) if the name being defined was previously
/// brought in via `(import ...)`. The import handler tracks names it added to
/// the environment in `env.imported`; the importing file's own definitions are
/// not in that set, so re-binding them locally never triggers the warning.
/// Diagnostics are appended to `env.shadow_diagnostics` and surfaced by the
/// outer `evaluate_inner` boundary alongside other diagnostics.
fn maybe_warn_shadow(env: &mut Env, name: &str) {
    // Resolve the name through alias mappings so a re-binding like `(cl.and: ...)`
    // matches the canonical imported key `classical.and`.
    let key = if env.imported.contains(name) {
        name.to_string()
    } else {
        let resolved = env.resolve_qualified(name);
        if resolved != name && env.imported.contains(&resolved) {
            resolved
        } else {
            return;
        }
    };
    // Only warn once per name to keep noise down; remove from imported so the
    // shadow only fires the first time it's rebinding.
    env.imported.remove(&key);
    let span = env
        .current_span
        .clone()
        .unwrap_or_else(|| env.default_span.clone());
    let diag = Diagnostic::new(
        "E008",
        format!("Definition of \"{}\" shadows an imported binding", name),
        span,
    );
    env.shadow_diagnostics.push(diag);
}

// ========== Meta-expression Adapter ==========

/// Selected interpretation supplied by a consumer such as meta-expression.
#[derive(Debug, Clone, PartialEq)]
pub struct Interpretation {
    pub kind: String,
    pub expression: Option<String>,
    pub summary: Option<String>,
    pub lino: Option<String>,
}

impl Interpretation {
    pub fn arithmetic_equality(expression: &str) -> Self {
        Self {
            kind: "arithmetic-equality".to_string(),
            expression: Some(expression.to_string()),
            summary: None,
            lino: None,
        }
    }

    pub fn arithmetic_question(expression: &str) -> Self {
        Self {
            kind: "arithmetic-question".to_string(),
            expression: Some(expression.to_string()),
            summary: None,
            lino: None,
        }
    }

    pub fn real_world_claim(summary: &str) -> Self {
        Self {
            kind: "real-world-claim".to_string(),
            expression: None,
            summary: Some(summary.to_string()),
            lino: None,
        }
    }

    pub fn lino(expression: &str) -> Self {
        Self {
            kind: "lino".to_string(),
            expression: None,
            summary: None,
            lino: Some(expression.to_string()),
        }
    }
}

/// Explicit dependency record used to keep unsupported claims partial.
#[derive(Debug, Clone, PartialEq)]
pub struct Dependency {
    pub id: String,
    pub status: String,
    pub description: String,
}

impl Dependency {
    pub fn missing(id: &str, description: &str) -> Self {
        Self {
            id: id.to_string(),
            status: "missing".to_string(),
            description: description.to_string(),
        }
    }
}

/// Request object for `formalize_selected_interpretation`.
#[derive(Debug, Clone, PartialEq)]
pub struct FormalizationRequest {
    pub text: String,
    pub interpretation: Interpretation,
    pub formal_system: String,
    pub dependencies: Vec<Dependency>,
}

/// A dependency-aware RML formalization.
#[derive(Debug, Clone, PartialEq)]
pub struct Formalization {
    pub source_text: String,
    pub interpretation: Interpretation,
    pub formal_system: String,
    pub dependencies: Vec<Dependency>,
    pub computable: bool,
    pub formalization_level: u8,
    pub unknowns: Vec<String>,
    pub value_kind: String,
    pub ast: Option<Node>,
    pub lino: Option<String>,
}

/// Result value from evaluating a formalization.
#[derive(Debug, Clone, PartialEq)]
pub enum FormalizationResultValue {
    Number(f64),
    TruthValue(f64),
    Type(String),
    Partial(String),
}

/// Evaluation result for the meta-expression adapter.
#[derive(Debug, Clone, PartialEq)]
pub struct FormalizationEvaluation {
    pub computable: bool,
    pub formalization_level: u8,
    pub unknowns: Vec<String>,
    pub result: FormalizationResultValue,
}

fn normalize_question_expression(text: &str) -> String {
    let mut out = text.trim().trim_end_matches('?').trim().to_string();
    let lower = out.to_lowercase();
    if lower.starts_with("what is ") {
        out = out[8..].trim().to_string();
    }
    out
}

fn split_top_level_equals(expression: &str) -> Option<(String, String)> {
    let mut depth: i32 = 0;
    let chars: Vec<char> = expression.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            '=' if depth == 0 => {
                if i > 0 && chars[i - 1] == '!' {
                    continue;
                }
                if i + 1 < chars.len() && chars[i + 1] == '=' {
                    continue;
                }
                let left: String = chars[..i].iter().collect();
                let right: String = chars[i + 1..].iter().collect();
                return Some((left.trim().to_string(), right.trim().to_string()));
            }
            _ => {}
        }
    }
    None
}

fn parse_expression_shape(expression: &str, unwrap_single: bool) -> Result<Node, String> {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Err("empty expression".to_string());
    }
    let source = if trimmed.starts_with('(') && trimmed.ends_with(')') {
        trimmed.to_string()
    } else {
        format!("({})", trimmed)
    };
    let mut ast = parse_one(&tokenize_one(&source))?;
    loop {
        match ast {
            Node::List(ref children) if children.len() == 1 => {
                if unwrap_single || matches!(&children[0], Node::List(_)) {
                    ast = children[0].clone();
                    continue;
                }
                return Ok(ast);
            }
            _ => return Ok(ast),
        }
    }
}

fn unique_unknowns(unknowns: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for unknown in unknowns {
        if !out.contains(&unknown) {
            out.push(unknown);
        }
    }
    out
}

fn partial_formalization(
    request: FormalizationRequest,
    unknowns: Vec<String>,
    formalization_level: u8,
) -> Formalization {
    Formalization {
        source_text: request.text,
        interpretation: request.interpretation,
        formal_system: request.formal_system,
        dependencies: request.dependencies,
        computable: false,
        formalization_level,
        unknowns: unique_unknowns(unknowns),
        value_kind: "partial".to_string(),
        ast: None,
        lino: None,
    }
}

fn build_arithmetic_formalization(
    expression: &str,
    value_kind: &str,
) -> Result<(Node, String), String> {
    let ast = if value_kind == "truth-value" {
        if let Some((left, right)) = split_top_level_equals(expression) {
            Node::List(vec![
                parse_expression_shape(&left, true)?,
                Node::Leaf("=".to_string()),
                parse_expression_shape(&right, true)?,
            ])
        } else {
            parse_expression_shape(expression, true)?
        }
    } else {
        parse_expression_shape(expression, true)?
    };
    let lino = key_of(&ast);
    Ok((ast, lino))
}

/// Convert an explicitly selected interpretation into an executable or partial RML formalization.
pub fn formalize_selected_interpretation(request: FormalizationRequest) -> Formalization {
    let kind = request.interpretation.kind.to_lowercase();
    let raw_expression = request
        .interpretation
        .expression
        .clone()
        .or_else(|| request.interpretation.lino.clone())
        .unwrap_or_else(|| normalize_question_expression(&request.text));
    let can_use_arithmetic = request.formal_system == "rml-arithmetic"
        || request.formal_system == "arithmetic"
        || kind.starts_with("arithmetic");

    if can_use_arithmetic && !raw_expression.is_empty() {
        let value_kind =
            if kind.contains("equal") || split_top_level_equals(&raw_expression).is_some() {
                "truth-value"
            } else {
                "number"
            };
        match build_arithmetic_formalization(&raw_expression, value_kind) {
            Ok((ast, lino)) => Formalization {
                source_text: request.text,
                interpretation: request.interpretation,
                formal_system: request.formal_system,
                dependencies: request.dependencies,
                computable: true,
                formalization_level: 3,
                unknowns: vec![],
                value_kind: value_kind.to_string(),
                ast: Some(ast),
                lino: Some(lino),
            },
            Err(error) => partial_formalization(
                request,
                vec!["unsupported-arithmetic-shape".to_string(), error],
                1,
            ),
        }
    } else if request.interpretation.lino.is_some() && !raw_expression.is_empty() {
        match parse_expression_shape(&raw_expression, false) {
            Ok(ast) => {
                let lino = key_of(&ast);
                Formalization {
                    source_text: request.text,
                    interpretation: request.interpretation,
                    formal_system: request.formal_system,
                    dependencies: request.dependencies,
                    computable: true,
                    formalization_level: 3,
                    unknowns: vec![],
                    value_kind: if matches!(&ast, Node::List(children) if matches!(children.first(), Some(Node::Leaf(head)) if head == "?"))
                    {
                        "query".to_string()
                    } else {
                        "truth-value".to_string()
                    },
                    ast: Some(ast),
                    lino: Some(lino),
                }
            }
            Err(error) => partial_formalization(
                request,
                vec!["unsupported-lino-shape".to_string(), error],
                1,
            ),
        }
    } else {
        let mut unknowns = vec![
            "selected-subject".to_string(),
            "selected-relation".to_string(),
            "evidence-source".to_string(),
            "formal-shape".to_string(),
        ];
        for dependency in &request.dependencies {
            if dependency.status == "missing"
                || dependency.status == "unknown"
                || dependency.status == "partial"
            {
                unknowns.push(format!("dependency:{}", dependency.id));
            }
        }
        partial_formalization(request, unknowns, 2)
    }
}

/// Evaluate a formalization when it has an executable RML AST.
pub fn evaluate_formalization(formalization: &Formalization) -> FormalizationEvaluation {
    let Some(ast) = formalization.ast.as_ref() else {
        return FormalizationEvaluation {
            computable: false,
            formalization_level: formalization.formalization_level,
            unknowns: formalization.unknowns.clone(),
            result: FormalizationResultValue::Partial("unknown".to_string()),
        };
    };

    if !formalization.computable {
        return FormalizationEvaluation {
            computable: false,
            formalization_level: formalization.formalization_level,
            unknowns: formalization.unknowns.clone(),
            result: FormalizationResultValue::Partial("unknown".to_string()),
        };
    }

    let mut env = Env::new(None);
    let evaluated = eval_node(ast, &mut env);
    let result = match formalization.value_kind.as_str() {
        "truth-value" => FormalizationResultValue::TruthValue(evaluated.as_f64()),
        "query" => match evaluated {
            EvalResult::TypeQuery(s) => FormalizationResultValue::Type(s),
            other => FormalizationResultValue::Number(other.as_f64()),
        },
        _ => FormalizationResultValue::Number(evaluated.as_f64()),
    };

    FormalizationEvaluation {
        computable: true,
        formalization_level: formalization.formalization_level,
        unknowns: vec![],
        result,
    }
}

// ========== Program extraction (issue #66) ==========

/// Supported source-code generation targets for `extract_program`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractTarget {
    JavaScript,
    Rust,
}

impl ExtractTarget {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "js" | "javascript" => Some(Self::JavaScript),
            "rust" | "rs" => Some(Self::Rust),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
struct ExtractLambda {
    name: String,
    params: Vec<String>,
    body: Node,
}

#[derive(Debug, Clone)]
struct ExtractTest {
    left: Node,
    right: Node,
}

#[derive(Debug, Clone)]
struct ExtractProgram {
    lambdas: Vec<ExtractLambda>,
    tests: Vec<ExtractTest>,
}

struct ExtractContext<'a> {
    target: ExtractTarget,
    name_map: &'a HashMap<String, String>,
    locals: &'a HashMap<String, String>,
}

fn extract_compile_error(message: impl Into<String>) -> String {
    message.into()
}

fn extract_is_probability_assignment(node: &Node) -> bool {
    if let Node::List(children) = node {
        if children.len() == 4 {
            if let (Node::Leaf(w1), Node::Leaf(w2)) = (&children[1], &children[2]) {
                return w1 == "has" && w2 == "probability";
            }
        }
    }
    false
}

fn extract_is_query_form(node: &Node) -> bool {
    matches!(node, Node::List(children) if matches!(children.first(), Some(Node::Leaf(head)) if head == "?"))
}

fn extract_is_lambda_definition(node: &Node) -> bool {
    if let Node::List(children) = node {
        if children.len() >= 3 {
            return matches!(&children[0], Node::Leaf(head) if head.ends_with(':'))
                && matches!(&children[1], Node::Leaf(head) if head == "lambda")
                && matches!(&children[2], Node::List(_));
        }
    }
    false
}

fn extract_is_type_only_form(node: &Node) -> bool {
    let children = match node {
        Node::List(children) => children,
        Node::Leaf(_) => return true,
    };
    if children.is_empty() {
        return true;
    }
    if matches!(&children[0], Node::Leaf(head) if head == "Type" || head == "Prop" || head == "Pi")
    {
        return true;
    }
    let head = match &children[0] {
        Node::Leaf(head) if head.ends_with(':') => &head[..head.len() - 1],
        _ => return false,
    };
    let rhs = &children[1..];
    if rhs.len() == 2 {
        if let Node::Leaf(last) = &rhs[1] {
            if last == head {
                return true;
            }
        }
    }
    if rhs.len() == 3 {
        if let (Node::Leaf(r0), Node::Leaf(r1), Node::Leaf(r2)) = (&rhs[0], &rhs[1], &rhs[2]) {
            if r0 == head && r1 == "is" && r2 == head {
                return true;
            }
        }
    }
    rhs.len() == 1 && matches!(&rhs[0], Node::List(_))
}

fn extract_logic_token(token: &str) -> bool {
    matches!(
        token,
        "and" | "or" | "not" | "both" | "neither" | "has" | "probability"
    )
}

fn extract_contains_logic(node: &Node) -> bool {
    match node {
        Node::Leaf(s) => extract_logic_token(s),
        Node::List(children) => {
            extract_is_probability_assignment(node) || children.iter().any(extract_contains_logic)
        }
    }
}

fn extract_special_form(head: &str) -> bool {
    matches!(
        head,
        "range"
            | "valence"
            | "mode"
            | "relation"
            | "world"
            | "total"
            | "coverage"
            | "terminating"
            | "coinductive"
            | "template"
            | "import"
            | "namespace"
    )
}

fn extract_parse_forms(text: &str) -> Result<Vec<Node>, String> {
    parse_lino_forms(text).map_err(extract_compile_error)
}

fn extract_lambda_declaration(form: &Node) -> Result<ExtractLambda, String> {
    let children = match form {
        Node::List(children) => children,
        _ => return Err(extract_compile_error("Malformed lambda definition")),
    };
    let name = match &children[0] {
        Node::Leaf(head) if head.ends_with(':') => head[..head.len() - 1].to_string(),
        _ => return Err(extract_compile_error("Malformed lambda definition head")),
    };
    if children.len() != 4 {
        return Err(extract_compile_error(format!(
            "Cannot extract \"{}\": lambda definitions must have one body",
            name
        )));
    }
    let bindings = parse_bindings(&children[2]).ok_or_else(|| {
        extract_compile_error(format!(
            "Cannot extract \"{}\": malformed lambda binding",
            name
        ))
    })?;
    Ok(ExtractLambda {
        name,
        params: bindings.into_iter().map(|(param, _)| param).collect(),
        body: children[3].clone(),
    })
}

fn extract_parse_query(form: &Node) -> Result<ExtractTest, String> {
    let children = match form {
        Node::List(children) => children,
        _ => {
            return Err(extract_compile_error(format!(
                "Cannot extract query \"{}\"",
                key_of(form)
            )))
        }
    };
    let parts = strip_with_proof(&children[1..]);
    let target = if parts.len() == 1 {
        parts[0].clone()
    } else {
        Node::List(parts.to_vec())
    };
    if let Node::List(target_children) = target {
        if target_children.len() == 3 {
            if matches!(&target_children[1], Node::Leaf(op) if op == "=") {
                return Ok(ExtractTest {
                    left: target_children[0].clone(),
                    right: target_children[2].clone(),
                });
            }
        }
    }
    Err(extract_compile_error(format!(
        "Cannot extract query \"{}\"; expected (? (<left> = <right>))",
        key_of(form)
    )))
}

fn extract_parse_program(text: &str) -> Result<ExtractProgram, String> {
    let forms = extract_parse_forms(text)?;
    let mut lambdas = Vec::new();
    let mut tests = Vec::new();
    for form in forms {
        if extract_is_probability_assignment(&form) {
            return Err(extract_compile_error(
                "Cannot extract probability assignments",
            ));
        }
        if extract_is_lambda_definition(&form) {
            let lambda = extract_lambda_declaration(&form)?;
            if extract_contains_logic(&lambda.body) {
                return Err(extract_compile_error(format!(
                    "Cannot extract probabilistic or logical lambda \"{}\"",
                    lambda.name
                )));
            }
            lambdas.push(lambda);
            continue;
        }
        if extract_is_query_form(&form) {
            tests.push(extract_parse_query(&form)?);
            continue;
        }
        if let Node::List(children) = &form {
            if let Some(Node::Leaf(raw_head)) = children.first() {
                let head = raw_head.strip_suffix(':').unwrap_or(raw_head.as_str());
                if extract_special_form(head)
                    || matches!(head, "and" | "or" | "not" | "both" | "neither" | "=" | "!=")
                {
                    return Err(extract_compile_error(format!(
                        "Cannot extract unsupported form \"{}\"",
                        key_of(&form)
                    )));
                }
            }
        }
        if !extract_is_type_only_form(&form) {
            return Err(extract_compile_error(format!(
                "Cannot extract unsupported form \"{}\"",
                key_of(&form)
            )));
        }
    }
    if lambdas.is_empty() {
        return Err(extract_compile_error(
            "Cannot extract program: no lambda definitions found",
        ));
    }
    Ok(ExtractProgram { lambdas, tests })
}

fn extract_identifier(name: &str, target: ExtractTarget, used: &mut HashSet<String>) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() || out.chars().next().map_or(false, |c| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    let reserved = match target {
        ExtractTarget::JavaScript => matches!(
            out.as_str(),
            "await"
                | "break"
                | "case"
                | "catch"
                | "class"
                | "const"
                | "continue"
                | "debugger"
                | "default"
                | "delete"
                | "do"
                | "else"
                | "export"
                | "extends"
                | "finally"
                | "for"
                | "function"
                | "if"
                | "import"
                | "in"
                | "instanceof"
                | "let"
                | "new"
                | "return"
                | "super"
                | "switch"
                | "this"
                | "throw"
                | "try"
                | "typeof"
                | "var"
                | "void"
                | "while"
                | "with"
                | "yield"
        ),
        ExtractTarget::Rust => matches!(
            out.as_str(),
            "as" | "break"
                | "const"
                | "continue"
                | "crate"
                | "else"
                | "enum"
                | "extern"
                | "false"
                | "fn"
                | "for"
                | "if"
                | "impl"
                | "in"
                | "let"
                | "loop"
                | "match"
                | "mod"
                | "move"
                | "mut"
                | "pub"
                | "ref"
                | "return"
                | "self"
                | "Self"
                | "static"
                | "struct"
                | "super"
                | "trait"
                | "true"
                | "type"
                | "unsafe"
                | "use"
                | "where"
                | "while"
                | "async"
                | "await"
                | "dyn"
        ),
    };
    if reserved {
        out.push('_');
    }
    let base = out.clone();
    let mut i = 2usize;
    while used.contains(&out) {
        out = format!("{}_{}", base, i);
        i += 1;
    }
    used.insert(out.clone());
    out
}

fn extract_name_map(names: &[String], target: ExtractTarget) -> HashMap<String, String> {
    let mut used = HashSet::new();
    let mut out = HashMap::new();
    for name in names {
        out.insert(name.clone(), extract_identifier(name, target, &mut used));
    }
    out
}

fn extract_number_literal(token: &str, target: ExtractTarget) -> String {
    if target == ExtractTarget::Rust && token.parse::<i64>().is_ok() {
        format!("{}.0", token)
    } else {
        token.to_string()
    }
}

fn extract_collect_apply_spine<'a>(node: &'a Node) -> (&'a Node, Vec<&'a Node>) {
    let mut args = Vec::new();
    let mut head = node;
    loop {
        match head {
            Node::List(children)
                if children.len() == 3
                    && matches!(&children[0], Node::Leaf(apply) if apply == "apply") =>
            {
                args.push(&children[2]);
                head = &children[1];
            }
            _ => break,
        }
    }
    args.reverse();
    (head, args)
}

fn extract_compile_expr(node: &Node, ctx: &ExtractContext<'_>) -> Result<String, String> {
    match node {
        Node::Leaf(s) => {
            if is_num(s) {
                return Ok(extract_number_literal(s, ctx.target));
            }
            if let Some(local) = ctx.locals.get(s) {
                return Ok(local.clone());
            }
            if let Some(name) = ctx.name_map.get(s) {
                return Ok(name.clone());
            }
            Err(extract_compile_error(format!(
                "Cannot extract unresolved symbol \"{}\"",
                s
            )))
        }
        Node::List(children) => {
            if children.is_empty() {
                return Err(extract_compile_error(
                    "Cannot extract malformed expression \"()\"",
                ));
            }
            if extract_contains_logic(node) {
                return Err(extract_compile_error(format!(
                    "Cannot extract probabilistic or logical expression \"{}\"",
                    key_of(node)
                )));
            }
            if children.len() == 3 {
                if let Node::Leaf(op) = &children[1] {
                    if matches!(op.as_str(), "+" | "-" | "*" | "/") {
                        return Ok(format!(
                            "({} {} {})",
                            extract_compile_expr(&children[0], ctx)?,
                            op,
                            extract_compile_expr(&children[2], ctx)?
                        ));
                    }
                }
            }
            if children.len() == 3 && matches!(&children[0], Node::Leaf(head) if head == "apply") {
                let (head, args) = extract_collect_apply_spine(node);
                let fn_name = match head {
                    Node::Leaf(_) => extract_compile_expr(head, ctx)?,
                    _ => {
                        return Err(extract_compile_error(format!(
                            "Cannot extract higher-order application \"{}\"",
                            key_of(node)
                        )))
                    }
                };
                let compiled_args: Result<Vec<String>, String> = args
                    .iter()
                    .map(|arg| extract_compile_expr(arg, ctx))
                    .collect();
                return Ok(format!("{}({})", fn_name, compiled_args?.join(", ")));
            }
            if let Some(Node::Leaf(head)) = children.first() {
                if let Some(fn_name) = ctx.name_map.get(head) {
                    let compiled_args: Result<Vec<String>, String> = children[1..]
                        .iter()
                        .map(|arg| extract_compile_expr(arg, ctx))
                        .collect();
                    return Ok(format!("{}({})", fn_name, compiled_args?.join(", ")));
                }
            }
            Err(extract_compile_error(format!(
                "Cannot extract expression \"{}\"",
                key_of(node)
            )))
        }
    }
}

fn compile_javascript_program(program: &ExtractProgram) -> Result<String, String> {
    let names: Vec<String> = program.lambdas.iter().map(|l| l.name.clone()).collect();
    let name_map = extract_name_map(&names, ExtractTarget::JavaScript);
    let mut lines = vec![
        "// Generated by rml extract js. Do not edit by hand.".to_string(),
        "import { pathToFileURL } from 'node:url';".to_string(),
        String::new(),
    ];
    for lambda in &program.lambdas {
        let mut used: HashSet<String> = name_map.values().cloned().collect();
        let mut locals = HashMap::new();
        for param in &lambda.params {
            locals.insert(
                param.clone(),
                extract_identifier(param, ExtractTarget::JavaScript, &mut used),
            );
        }
        let ctx = ExtractContext {
            target: ExtractTarget::JavaScript,
            name_map: &name_map,
            locals: &locals,
        };
        let params = lambda
            .params
            .iter()
            .map(|param| locals.get(param).cloned().unwrap_or_else(|| param.clone()))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "export function {}({}) {{",
            name_map.get(&lambda.name).unwrap(),
            params
        ));
        lines.push(format!(
            "  return {};",
            extract_compile_expr(&lambda.body, &ctx)?
        ));
        lines.push("}".to_string());
        lines.push(String::new());
    }
    lines.push("function __rmlApproxEq(left, right) {".to_string());
    lines.push("  return Object.is(left, right) || Math.abs(left - right) <= 1e-9;".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push("export function __runRmlExtractedTests() {".to_string());
    if program.tests.is_empty() {
        lines.push("  return true;".to_string());
    } else {
        for (idx, test) in program.tests.iter().enumerate() {
            let locals = HashMap::new();
            let ctx = ExtractContext {
                target: ExtractTarget::JavaScript,
                name_map: &name_map,
                locals: &locals,
            };
            lines.push(format!(
                "  if (!__rmlApproxEq({}, {})) {{",
                extract_compile_expr(&test.left, &ctx)?,
                extract_compile_expr(&test.right, &ctx)?
            ));
            lines.push(format!(
                "    throw new Error('RML extracted test {} failed');",
                idx + 1
            ));
            lines.push("  }".to_string());
        }
        lines.push("  return true;".to_string());
    }
    lines.push("}".to_string());
    lines.push(String::new());
    lines.push(
        "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {"
            .to_string(),
    );
    lines.push("  __runRmlExtractedTests();".to_string());
    lines.push("}".to_string());
    lines.push(String::new());
    Ok(lines.join("\n"))
}

fn compile_rust_program(program: &ExtractProgram) -> Result<String, String> {
    let names: Vec<String> = program.lambdas.iter().map(|l| l.name.clone()).collect();
    let name_map = extract_name_map(&names, ExtractTarget::Rust);
    let mut lines = vec![
        "// Generated by rml extract rust. Do not edit by hand.".to_string(),
        String::new(),
    ];
    for lambda in &program.lambdas {
        let mut used: HashSet<String> = name_map.values().cloned().collect();
        let mut locals = HashMap::new();
        for param in &lambda.params {
            locals.insert(
                param.clone(),
                extract_identifier(param, ExtractTarget::Rust, &mut used),
            );
        }
        let ctx = ExtractContext {
            target: ExtractTarget::Rust,
            name_map: &name_map,
            locals: &locals,
        };
        let params = lambda
            .params
            .iter()
            .map(|param| format!("{}: f64", locals.get(param).unwrap()))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "pub fn {}({}) -> f64 {{",
            name_map.get(&lambda.name).unwrap(),
            params
        ));
        lines.push(format!("    {}", extract_compile_expr(&lambda.body, &ctx)?));
        lines.push("}".to_string());
        lines.push(String::new());
    }
    if !program.tests.is_empty() {
        lines.push("#[cfg(test)]".to_string());
        lines.push("mod tests {".to_string());
        lines.push("    use super::*;".to_string());
        lines.push(String::new());
        lines.push("    fn rml_approx_eq(left: f64, right: f64) -> bool {".to_string());
        lines.push("        (left - right).abs() <= 1e-9".to_string());
        lines.push("    }".to_string());
        lines.push(String::new());
        for (idx, test) in program.tests.iter().enumerate() {
            let locals = HashMap::new();
            let ctx = ExtractContext {
                target: ExtractTarget::Rust,
                name_map: &name_map,
                locals: &locals,
            };
            lines.push("    #[test]".to_string());
            lines.push(format!("    fn rml_query_{}() {{", idx + 1));
            lines.push(format!(
                "        assert!(rml_approx_eq({}, {}), \"RML query {} failed\");",
                extract_compile_expr(&test.left, &ctx)?,
                extract_compile_expr(&test.right, &ctx)?,
                idx + 1
            ));
            lines.push("    }".to_string());
            lines.push(String::new());
        }
        lines.push("}".to_string());
        lines.push(String::new());
    }
    Ok(lines.join("\n"))
}

/// Extract a typed, non-probabilistic lambda program to JavaScript or Rust.
///
/// The supported fragment erases RML type annotations, compiles named lambda
/// definitions to exported functions, compiles `apply` and arithmetic to
/// ordinary calls/expressions, and turns equality queries into generated
/// tests. Probabilistic assignments and logical/probabilistic operators are
/// rejected instead of being given misleading target-language semantics.
pub fn extract_program(text: &str, target: ExtractTarget) -> Result<String, String> {
    let parsed = extract_parse_program(text)?;
    match target {
        ExtractTarget::JavaScript => compile_javascript_program(&parsed),
        ExtractTarget::Rust => compile_rust_program(&parsed),
    }
}

// ========== Runner ==========

/// A result from running a query: a numeric value, a type string, a
/// foundation report, or a per-proof report (issue #97).
#[derive(Debug, Clone, PartialEq)]
pub enum RunResult {
    Num(f64),
    Type(String),
    Foundation(FoundationReport),
    Proof(ProofReport),
}

/// Evaluate a complete LiNo knowledge base and return both results and any
/// diagnostics emitted by the parser, evaluator, or type checker.
///
/// Each diagnostic carries a code (`E001`, `E002`, ...), a message, and a
/// source span (1-based line/col).  See `docs/DIAGNOSTICS.md` for the
/// full code list.  The source is read in full before any form runs: text
/// that is not valid LiNo yields one E006 diagnostic at the position the
/// front end names, and a form that does not read yields one E002
/// diagnostic at its span, with no results.  Once every form has been read,
/// evaluation errors do not abort it: independent forms continue to be
/// processed after a failing one.
pub fn evaluate(text: &str, file: Option<&str>, options: Option<EnvOptions>) -> EvaluateResult {
    evaluate_with_options(
        text,
        file,
        EvaluateOptions {
            env: options,
            ..EvaluateOptions::default()
        },
    )
}

/// Like `evaluate`, but takes structured `EvaluateOptions`. When
/// `options.trace` is true the returned `EvaluateResult.trace` carries a
/// deterministic sequence of `TraceEvent` values (operator resolutions,
/// assignment lookups, top-level reductions) — one entry per event,
/// in source order.
pub fn evaluate_with_options(
    text: &str,
    file: Option<&str>,
    options: EvaluateOptions,
) -> EvaluateResult {
    let mut env = Env::new(options.env.clone());
    env.trace_enabled = options.trace;
    env.default_span = Span::new(file.map(|s| s.to_string()), 1, 1, 0);
    let mut ctx = ImportContext::default();
    evaluate_inner(text, file, &mut env, &options, &mut ctx)
}

/// Variant of [`evaluate`] that runs against a caller-owned `Env` instead of
/// allocating a fresh one.  Used by the REPL to preserve state across inputs.
pub fn evaluate_with_env(text: &str, file: Option<&str>, env: &mut Env) -> EvaluateResult {
    let options = EvaluateOptions::default();
    let mut ctx = ImportContext::default();
    evaluate_inner(text, file, env, &options, &mut ctx)
}

/// Read a file from disk and evaluate it, honouring `(import "...")` directives.
/// Mirrors `evaluate()` but takes a path on disk; relative imports inside the
/// file are resolved against the file's directory. A missing file is reported
/// as an `E007` diagnostic instead of an OS error.
pub fn evaluate_file(file_path: &str, options: EvaluateOptions) -> EvaluateResult {
    let resolved: PathBuf = match fs::canonicalize(file_path) {
        Ok(p) => p,
        Err(_) => Path::new(file_path).to_path_buf(),
    };
    let text = match fs::read_to_string(&resolved) {
        Ok(t) => t,
        Err(err) => {
            let diag = Diagnostic::new(
                "E007",
                format!("Failed to read \"{}\": {}", file_path, err),
                Span::new(Some(file_path.to_string()), 1, 1, 0),
            );
            return EvaluateResult {
                results: Vec::new(),
                diagnostics: vec![diag],
                trace: Vec::new(),
                proofs: Vec::new(),
                provenance: Vec::new(),
            };
        }
    };
    let mut env = Env::new(options.env.clone());
    env.trace_enabled = options.trace;
    let resolved_str = resolved.to_string_lossy().into_owned();
    env.default_span = Span::new(Some(resolved_str.clone()), 1, 1, 0);
    let mut ctx = ImportContext::default();
    ctx.stack.push(resolved.clone());
    ctx.loaded.insert(resolved.clone());
    evaluate_inner(&text, Some(&resolved_str), &mut env, &options, &mut ctx)
}

/// Internal state threaded through nested `(import ...)` evaluations.
/// `stack` is the chain of files currently being loaded (for cycle detection);
/// `loaded` is the set of canonical paths already evaluated into the current
/// env (for diamond-import caching).
#[derive(Default)]
struct ImportContext {
    stack: Vec<PathBuf>,
    loaded: HashSet<PathBuf>,
}

/// Strip surrounding ASCII quotes from a path string. The LiNo parser strips
/// `"..."` for most inputs but `'...'` may also appear when whitespace forced
/// a quote conversion; either form is accepted.
fn unquote_path(s: &str) -> &str {
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Resolve an import target relative to the importing file's directory.
/// When `importing_file` is `None`, resolve relative to the current working
/// directory.
fn resolve_import_path(target: &str, importing_file: Option<&str>) -> PathBuf {
    let cleaned = unquote_path(target);
    let candidate = Path::new(cleaned);
    if candidate.is_absolute() {
        return candidate.to_path_buf();
    }
    let base_dir: PathBuf = if let Some(file) = importing_file {
        Path::new(file)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    base_dir.join(candidate)
}

/// Canonicalise an import path; falls back to the unresolved path when the
/// file does not exist (so missing-file diagnostics still carry a meaningful
/// path, and cycle keys stay consistent).
fn canonicalize_import(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Process a top-level `(import <path>)` directive. Reads the imported file
/// and evaluates its contents against the same `env`, threading the import
/// context for cycle detection and caching. Returns a `Diagnostic` if the
/// import itself fails (cycle, missing file, bad target).
///
/// When `alias` is Some, the imported file's declared namespace (or the alias
/// itself if no namespace was declared) is registered as `aliases[alias] -> ns`
/// so qualified references like `(? (alias.foo))` resolve into that namespace.
fn handle_import(
    target_node: &Node,
    alias: Option<&str>,
    span: &Span,
    importing_file: Option<&str>,
    env: &mut Env,
    options: &EvaluateOptions,
    ctx: &mut ImportContext,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<Diagnostic> {
    let raw = match target_node {
        Node::Leaf(s) => s.clone(),
        _ => {
            return Some(Diagnostic::new(
                "E007",
                "Import target must be a string path",
                span.clone(),
            ));
        }
    };
    let cleaned = unquote_path(&raw);
    if cleaned.is_empty() {
        return Some(Diagnostic::new(
            "E007",
            "Import target must be a non-empty string path",
            span.clone(),
        ));
    }

    // Validate alias collisions before reading the file.
    if let Some(a) = alias {
        if env.aliases.contains_key(a) || env.namespace.as_deref() == Some(a) {
            return Some(Diagnostic::new(
                "E009",
                format!(
                    "Import alias \"{}\" collides with an existing namespace or alias",
                    a
                ),
                span.clone(),
            ));
        }
    }

    let unresolved = resolve_import_path(&raw, importing_file);
    let resolved = canonicalize_import(&unresolved);

    if ctx.stack.iter().any(|p| p == &resolved) {
        let mut chain: Vec<String> = ctx
            .stack
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        chain.push(resolved.to_string_lossy().into_owned());
        return Some(Diagnostic::new(
            "E007",
            format!("Import cycle detected: {}", chain.join(" -> ")),
            span.clone(),
        ));
    }

    if ctx.loaded.contains(&resolved) {
        // For cached re-imports, the imported namespace is already loaded
        // into the env. We only need to wire up the alias.
        if let Some(a) = alias {
            let recorded_ns = env
                .file_namespaces
                .get(&resolved)
                .cloned()
                .unwrap_or_else(|| a.to_string());
            env.aliases.insert(a.to_string(), recorded_ns);
        }
        if options.trace {
            env.trace_events.push(TraceEvent::new(
                "import",
                format!("{} (cached)", resolved.to_string_lossy()),
                span.clone(),
            ));
        }
        return None;
    }

    let text = match fs::read_to_string(&resolved) {
        Ok(t) => t,
        Err(err) => {
            return Some(Diagnostic::new(
                "E007",
                format!("Failed to read import \"{}\": {}", cleaned, err),
                span.clone(),
            ));
        }
    };

    ctx.loaded.insert(resolved.clone());
    ctx.stack.push(resolved.clone());
    if options.trace {
        env.trace_events.push(TraceEvent::new(
            "import",
            resolved.to_string_lossy().into_owned(),
            span.clone(),
        ));
    }

    // Snapshot bindings so we can diff after the import to learn which names
    // were introduced by the imported file. Used to surface E008 when a later
    // top-level definition rebinds them.
    let before_ops: HashSet<String> = env.ops.keys().cloned().collect();
    let before_syms: HashSet<String> = env.symbol_prob.keys().cloned().collect();
    let before_terms: HashSet<String> = env.terms.iter().cloned().collect();
    let before_lambdas: HashSet<String> = env.lambdas.keys().cloned().collect();
    let before_templates: HashSet<String> = env.templates.keys().cloned().collect();
    let before_namespace = env.namespace.clone();

    let resolved_str = resolved.to_string_lossy().into_owned();
    let inner = evaluate_inner(&text, Some(&resolved_str), env, options, ctx);
    ctx.stack.pop();

    // The imported file may have declared its own (namespace ...) — capture it
    // before restoring the importing file's namespace so we can wire up the
    // alias and remember the file's namespace for cached re-imports.
    let imported_namespace = env.namespace.clone();
    env.namespace = before_namespace;
    if let Some(ns) = &imported_namespace {
        env.file_namespaces.insert(resolved.clone(), ns.clone());
    }

    // Track which bindings the imported file added so a later top-level
    // definition that rebinds them surfaces an E008 shadowing warning.
    for k in env.ops.keys() {
        if !before_ops.contains(k) {
            env.imported.insert(k.clone());
        }
    }
    for k in env.symbol_prob.keys() {
        if !before_syms.contains(k) {
            env.imported.insert(k.clone());
        }
    }
    for k in env.terms.iter() {
        if !before_terms.contains(k) {
            env.imported.insert(k.clone());
        }
    }
    for k in env.lambdas.keys() {
        if !before_lambdas.contains(k) {
            env.imported.insert(k.clone());
        }
    }
    for k in env.templates.keys() {
        if !before_templates.contains(k) {
            env.imported.insert(k.clone());
        }
    }

    // Wire up the alias once the imported file has finished evaluating. If the
    // imported file declared a namespace, alias maps to it; otherwise it maps
    // to the alias itself (so qualified refs `alias.x` resolve to `alias.x`).
    if let Some(a) = alias {
        let target_ns = imported_namespace.unwrap_or_else(|| a.to_string());
        env.aliases.insert(a.to_string(), target_ns);
    }

    for diag in inner.diagnostics {
        diagnostics.push(diag);
    }
    // The inner evaluator drained env.trace_events into inner.trace; restore
    // them so the outer call surfaces them in source order.
    if options.trace {
        env.trace_events.extend(inner.trace);
    }
    None
}

// Evaluate a single form inside a `(with-foundation ...)` body. Nested
// `(with-foundation ...)`, `(foundation ...)`, and `(foundation-report)`
// forms recurse through here so they behave the same way they would at
// the top level. Everything else is treated as a query expression.
fn eval_foundation_body_form(
    form: Node,
    span: &Span,
    env: &mut Env,
    diagnostics: &mut Vec<Diagnostic>,
    results: &mut Vec<RunResult>,
    proofs: &mut Option<Vec<Option<Node>>>,
    provenance: &mut Option<Vec<Option<String>>>,
    options: &EvaluateOptions,
) {
    let mut form = form;
    loop {
        match form {
            Node::List(ref children) if children.len() == 1 => {
                if let Node::List(_) = &children[0] {
                    form = children[0].clone();
                } else {
                    break;
                }
            }
            _ => break,
        }
    }

    if let Node::List(children) = &form {
        if let Some(Node::Leaf(head)) = children.first() {
            if head == "with-foundation" {
                if children.len() < 2 {
                    diagnostics.push(Diagnostic::new(
                        "E062",
                        "with-foundation form must be `(with-foundation <name> <body>...)`",
                        span.clone(),
                    ));
                    return;
                }
                let fname = match &children[1] {
                    Node::Leaf(s) if !s.is_empty() => s.clone(),
                    _ => {
                        diagnostics.push(Diagnostic::new(
                            "E062",
                            "with-foundation requires a foundation name",
                            span.clone(),
                        ));
                        return;
                    }
                };
                if let Err(message) = env.enter_foundation(&fname) {
                    diagnostics.push(Diagnostic::new("E062", message, span.clone()));
                    return;
                }
                if options.trace {
                    env.trace_events.push(TraceEvent::new(
                        "with-foundation/enter",
                        fname.clone(),
                        span.clone(),
                    ));
                }
                let bodies: Vec<Node> = children[2..].to_vec();
                for body in bodies {
                    eval_foundation_body_form(
                        body,
                        span,
                        env,
                        diagnostics,
                        results,
                        proofs,
                        provenance,
                        options,
                    );
                }
                env.exit_foundation();
                if options.trace {
                    env.trace_events.push(TraceEvent::new(
                        "with-foundation/exit",
                        fname,
                        span.clone(),
                    ));
                }
                return;
            }
            if head == "foundation" {
                match parse_foundation_form(&form) {
                    Ok(foundation) => {
                        let name = foundation.name.clone();
                        if let Err(message) = env.register_foundation(foundation) {
                            diagnostics.push(Diagnostic::new("E061", message, span.clone()));
                        } else if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "foundation",
                                name,
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E061", message, span.clone()));
                    }
                }
                return;
            }
            if head == "root-construct" {
                match parse_root_construct_form(&form) {
                    Ok(descriptor) => {
                        let name = descriptor.name.clone();
                        if let Err(message) = env.register_root_construct(descriptor) {
                            diagnostics.push(Diagnostic::new("E060", message, span.clone()));
                        } else if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "root-construct",
                                name,
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E060", message, span.clone()));
                    }
                }
                return;
            }
            if head == "foundation-report" || head == "foundation-report?" {
                let report = env.foundation_report();
                if options.trace {
                    env.trace_events.push(TraceEvent::new(
                        "foundation-report",
                        report.active_foundation.clone(),
                        span.clone(),
                    ));
                }
                results.push(RunResult::Foundation(report));
                if let Some(p) = proofs.as_mut() {
                    p.push(None);
                }
                if let Some(pv) = provenance.as_mut() {
                    pv.push(None);
                }
                return;
            }
            if head == "rule" && is_proof_rule_shape(children) {
                match parse_rule_form(&form) {
                    Ok(rule) => {
                        let name = rule.name.clone();
                        env.register_proof_rule(rule);
                        if options.trace {
                            env.trace_events
                                .push(TraceEvent::new("rule", name, span.clone()));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                    }
                }
                return;
            }
            if head == "assumption" || head == "axiom" {
                match parse_proof_assumption_form(&form) {
                    Ok(assumption) => {
                        let kind = assumption.kind.clone();
                        let name = assumption.name.clone();
                        env.register_proof_assumption(assumption);
                        if options.trace {
                            env.trace_events
                                .push(TraceEvent::new(&kind, name, span.clone()));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                    }
                }
                return;
            }
            if head == "proof-object" {
                match parse_proof_object_form(&form) {
                    Ok(po) => {
                        let name = po.name.clone();
                        env.register_proof_object(po);
                        if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "proof-object",
                                name,
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                    }
                }
                return;
            }
            if head == "check-proof" {
                if children.len() != 2 {
                    diagnostics.push(Diagnostic::new(
                        "E064",
                        "(check-proof <name>) requires a proof-object name",
                        span.clone(),
                    ));
                    return;
                }
                let target = match &children[1] {
                    Node::Leaf(s) if !s.is_empty() => s.clone(),
                    _ => {
                        diagnostics.push(Diagnostic::new(
                            "E064",
                            "(check-proof <name>) requires a proof-object name",
                            span.clone(),
                        ));
                        return;
                    }
                };
                let verdict = check_proof_object(env, &target);
                let (value, error) = match verdict {
                    CheckProofVerdict::Ok(_) => (1.0_f64, None),
                    CheckProofVerdict::Err(msg) => (0.0_f64, Some(msg)),
                };
                results.push(RunResult::Num(value));
                if let Some(p) = proofs.as_mut() {
                    p.push(None);
                }
                if let Some(pv) = provenance.as_mut() {
                    pv.push(None);
                }
                if let Some(msg) = error {
                    diagnostics.push(Diagnostic::new("E064", msg, span.clone()));
                }
                if options.trace {
                    env.trace_events.push(TraceEvent::new(
                        "check-proof",
                        format!("{} → {}", target, if value == 1.0 { "ok" } else { "fail" }),
                        span.clone(),
                    ));
                }
                return;
            }
            if head == "proof-report" {
                if children.len() != 2 {
                    diagnostics.push(Diagnostic::new(
                        "E064",
                        "(proof-report <name>) requires a proof-object name",
                        span.clone(),
                    ));
                    return;
                }
                let target = match &children[1] {
                    Node::Leaf(s) if !s.is_empty() => s.clone(),
                    _ => {
                        diagnostics.push(Diagnostic::new(
                            "E064",
                            "(proof-report <name>) requires a proof-object name",
                            span.clone(),
                        ));
                        return;
                    }
                };
                let report = env.proof_report(&target);
                results.push(RunResult::Proof(report));
                if let Some(p) = proofs.as_mut() {
                    p.push(None);
                }
                if let Some(pv) = provenance.as_mut() {
                    pv.push(None);
                }
                if options.trace {
                    env.trace_events.push(TraceEvent::new(
                        "proof-report",
                        target,
                        span.clone(),
                    ));
                }
                return;
            }
            if head == "eval-nat" {
                if children.len() != 2 {
                    diagnostics.push(Diagnostic::new(
                        "E067",
                        "(eval-nat <term>) requires exactly one term argument",
                        span.clone(),
                    ));
                    return;
                }
                match eval_nat_term(env, &children[1]) {
                    Ok(result) => {
                        results.push(RunResult::Num(result.value));
                        if let Some(p) = proofs.as_mut() {
                            p.push(None);
                        }
                        if let Some(pv) = provenance.as_mut() {
                            pv.push(None);
                        }
                        if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "eval-nat",
                                format!(
                                    "{} -> normal-form {} -> {}; rules-used: {}; host-primitives-used: structural-matcher; renderer: nat-normal-form-to-host-number",
                                    key_of(&children[1]),
                                    key_of(&result.normal_form),
                                    format_trace_value(result.value),
                                    if result.steps.is_empty() {
                                        "<none>".to_string()
                                    } else {
                                        result.steps.join(", ")
                                    }
                                ),
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E067", message, span.clone()));
                    }
                }
                return;
            }
            if head == "strict-foundation" {
                match parse_strict_foundation_form(&form) {
                    Ok(decl) => {
                        env.strict_pure_links = true;
                        if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "strict-foundation",
                                decl.profile,
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E065", message, span.clone()));
                    }
                }
                return;
            }
            if head == "allow-host-primitive" {
                match parse_allow_host_primitive_form(&form) {
                    Ok(decl) => {
                        for name in &decl.names {
                            env.allowed_host_primitives.insert(name.clone());
                        }
                        if options.trace {
                            env.trace_events.push(TraceEvent::new(
                                "allow-host-primitive",
                                decl.names.join(" "),
                                span.clone(),
                            ));
                        }
                    }
                    Err(message) => {
                        diagnostics.push(Diagnostic::new("E065", message, span.clone()));
                    }
                }
                return;
            }
        }
    }
    if let Node::Leaf(head) = &form {
        if head == "foundation-report" || head == "foundation-report?" {
            let report = env.foundation_report();
            if options.trace {
                env.trace_events.push(TraceEvent::new(
                    "foundation-report",
                    report.active_foundation.clone(),
                    span.clone(),
                ));
            }
            results.push(RunResult::Foundation(report));
            if let Some(p) = proofs.as_mut() {
                p.push(None);
            }
            if let Some(pv) = provenance.as_mut() {
                pv.push(None);
            }
            return;
        }
    }

    let inner_result = catch_unwind(AssertUnwindSafe(|| {
        let mut stack = Vec::new();
        let expanded = expand_templates(&form, env, &mut stack);
        let eval_res = eval_node(&expanded, env);
        (expanded, eval_res)
    }));
    match inner_result {
        Ok((expanded, eval_res)) => {
            let was_query = matches!(eval_res, EvalResult::Query(_) | EvalResult::TypeQuery(_));
            let query_value = if let EvalResult::Query(v) = &eval_res {
                Some(*v)
            } else {
                None
            };
            match eval_res {
                EvalResult::Query(v) => results.push(RunResult::Num(v)),
                EvalResult::TypeQuery(s) => results.push(RunResult::Type(s)),
                _ => {}
            }
            if was_query {
                if let Some(p) = proofs.as_mut() {
                    p.push(None);
                }
                let prov = equality_provenance_for_query(&expanded, env);
                record_provenance(
                    provenance,
                    results.len(),
                    prov,
                    env,
                    &expanded,
                    span,
                    options,
                );
                // Carrier enforcement (issue #97 Section 2): when the active
                // foundation strict-carrier is on, a numeric query result
                // outside the carrier produces an E063 diagnostic alongside
                // the value, so the trace stays explainable without losing
                // the result.
                if let Some(v) = query_value {
                    if let Some(msg) = env.check_carrier_value(v) {
                        diagnostics.push(Diagnostic::new(
                            "E063",
                            format!(
                                "Query result {} violates active foundation carrier: {}",
                                format_trace_value(v),
                                msg
                            ),
                            span.clone(),
                        ));
                    }
                }
                // Pure-links strict mode audit inside with-foundation bodies.
                if env.strict_pure_links {
                    if let Node::List(form_children) = &expanded {
                        if matches!(form_children.first(), Some(Node::Leaf(s)) if s == "?") {
                            let parts = &form_children[1..];
                            let inner = strip_with_proof(parts);
                            let target: Node = if inner.len() == 1 {
                                inner[0].clone()
                            } else {
                                Node::List(inner.to_vec())
                            };
                            let offenders = scan_pure_links_offenders(&target, env);
                            if !offenders.is_empty() {
                                diagnostics.push(Diagnostic::new(
                                    "E065",
                                    format!(
                                        "Query depends on host-primitive construct(s) under pure-links strict mode: {}",
                                        offenders.join(", ")
                                    ),
                                    span.clone(),
                                ));
                            }
                        }
                    }
                }
            }
        }
        Err(payload) => {
            let (code, message) = decode_panic_payload(&payload);
            diagnostics.push(Diagnostic::new(&code, message, span.clone()));
        }
    }
}

/// Append a per-query provenance entry, lazily allocating the vector on the
/// first non-`None` rule (mirrors JS's `out.provenance` shape). When `rule`
/// is `Some`, also emits an `equality-layer` trace event so tracing tools
/// can attribute each classification to its source span.
fn record_provenance(
    provenance: &mut Option<Vec<Option<String>>>,
    results_len: usize,
    rule: Option<String>,
    env: &mut Env,
    _form: &Node,
    span: &Span,
    options: &EvaluateOptions,
) {
    if let Some(rule_name) = rule {
        if provenance.is_none() {
            let backfill = results_len.saturating_sub(1);
            *provenance = Some(vec![None; backfill]);
        }
        provenance.as_mut().unwrap().push(Some(rule_name.clone()));
        if options.trace {
            env.trace_events.push(TraceEvent::new(
                "equality-layer",
                rule_name,
                span.clone(),
            ));
        }
    } else if let Some(pv) = provenance.as_mut() {
        pv.push(None);
    }
}

fn evaluate_inner(
    text: &str,
    file: Option<&str>,
    env: &mut Env,
    options: &EvaluateOptions,
    ctx: &mut ImportContext,
) -> EvaluateResult {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    // A literate file is normalized first, so a CRLF file closes its fences,
    // and prose lines become blank lines.
    let extracted_literate = if is_literate_lino_path(file) {
        Some(extract_literate_lino(&normalize_lino_source(text)))
    } else {
        None
    };
    let source_text = extracted_literate.as_deref().unwrap_or(text);

    // Read every top-level form, with the span of the line it starts on, before
    // running any of them: a document that does not read is reported once, at
    // the failing position, and nothing in it runs.
    let (forms, spans): (Vec<Node>, Vec<Span>) = match read_lino_forms(source_text, file) {
        Ok(read) => read.into_iter().unzip(),
        Err(diagnostic) => {
            diagnostics.push(diagnostic);
            return EvaluateResult {
                results: Vec::new(),
                diagnostics,
                trace: if options.trace {
                    std::mem::take(&mut env.trace_events)
                } else {
                    Vec::new()
                },
                proofs: Vec::new(),
                provenance: Vec::new(),
            };
        }
    };

    let mut results: Vec<RunResult> = Vec::new();

    // Proof collection (issue #35). When `options.with_proofs` is true the
    // global flag forces a derivation for every query; otherwise we lazily
    // allocate `proofs` on the first per-query `(? expr with proof)` opt-in
    // and backfill `None` for any prior bare queries so indices stay aligned
    // with `results`. When neither code path fires `proofs` stays empty and
    // is returned as `Vec::new()` — matching the plain `evaluate()` shape.
    let proofs_enabled = options.with_proofs;
    let mut proofs: Option<Vec<Option<Node>>> = if proofs_enabled {
        Some(Vec::new())
    } else {
        None
    };

    // Equality-layer provenance (issue #97). Lazily allocated on the first
    // query that classifies into one of the four equality layers; prior
    // bare queries are backfilled with `None` so indices stay aligned with
    // `results`. When no equality query ever fires the vector stays empty
    // and the public field is returned as `Vec::new()`, matching the JS
    // `{results, diagnostics}` shape for legacy programs.
    let mut provenance: Option<Vec<Option<String>>> = None;

    // Silence the default panic hook while we deliberately catch evaluator
    // panics — otherwise they'd leak to stderr alongside the diagnostics.
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));

    for (form, span) in forms.into_iter().zip(spans) {
        let mut form = form;
        loop {
            match form {
                Node::List(ref children) if children.len() == 1 => {
                    if let Node::List(_) = &children[0] {
                        form = children[0].clone();
                    } else {
                        break;
                    }
                }
                _ => break,
            }
        }
        env.current_span = Some(span.clone());

        // Top-level (namespace <name>) directive — sets the active namespace
        // for all subsequent definitions in this file. The `(namespace foo)`
        // form is itself never namespaced. (issue #34)
        if let Node::List(children) = &form {
            if children.len() == 2 {
                if let (Node::Leaf(h), Node::Leaf(n)) = (&children[0], &children[1]) {
                    if h == "namespace" {
                        if n.is_empty() || n.contains('.') {
                            diagnostics.push(Diagnostic::new(
                                "E009",
                                format!("Invalid namespace name \"{}\"", n),
                                span.clone(),
                            ));
                        } else {
                            env.namespace = Some(n.clone());
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "namespace",
                                    n.clone(),
                                    span.clone(),
                                ));
                            }
                        }
                        continue;
                    }
                }
            }
        }

        // Top-level (import <path>) and (import <path> as <alias>) directives —
        // handled before regular evaluation so they can recursively call
        // evaluate_inner against the same env while threading the import
        // context.
        if let Node::List(children) = &form {
            if let Some(Node::Leaf(head)) = children.first() {
                if head == "import" {
                    if children.len() == 2 {
                        let target = children[1].clone();
                        if let Some(diag) = handle_import(
                            &target,
                            None,
                            &span,
                            file,
                            env,
                            options,
                            ctx,
                            &mut diagnostics,
                        ) {
                            diagnostics.push(diag);
                        }
                        continue;
                    }
                    if children.len() == 4 {
                        if let (Node::Leaf(as_kw), Node::Leaf(alias_name)) =
                            (&children[2], &children[3])
                        {
                            if as_kw == "as" {
                                let target = children[1].clone();
                                if let Some(diag) = handle_import(
                                    &target,
                                    Some(alias_name),
                                    &span,
                                    file,
                                    env,
                                    options,
                                    ctx,
                                    &mut diagnostics,
                                ) {
                                    diagnostics.push(diag);
                                }
                                continue;
                            }
                        }
                    }
                }
            }
        }

        // Top-level `(template (<name> <param>...) <body>)` declarations are
        // recorded on the environment and produce no result. Later regular
        // forms are expanded through this registry before evaluation.
        if let Node::List(children) = &form {
            if let Some(Node::Leaf(head)) = children.first() {
                if head == "template" {
                    match register_template_form(&form, env) {
                        Ok(name) => {
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "template",
                                    name,
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E040", message, span.clone()));
                        }
                    }
                    continue;
                }
            }
        }

        // Foundation / root-construct registry (issue #97). Data-only:
        // declarations record what the prover trusts but never change
        // host operator behaviour. `(with-foundation <name> body...)`
        // pushes a foundation tag for the duration of the body so the
        // trust report and audit can attribute reductions to it.
        if let Node::List(children) = &form {
            if let Some(Node::Leaf(head)) = children.first() {
                if head == "root-construct" {
                    match parse_root_construct_form(&form) {
                        Ok(descriptor) => {
                            let name = descriptor.name.clone();
                            if let Err(message) = env.register_root_construct(descriptor) {
                                diagnostics.push(Diagnostic::new("E060", message, span.clone()));
                            } else if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "root-construct",
                                    name,
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E060", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "foundation" {
                    match parse_foundation_form(&form) {
                        Ok(foundation) => {
                            let name = foundation.name.clone();
                            if let Err(message) = env.register_foundation(foundation) {
                                diagnostics.push(Diagnostic::new("E061", message, span.clone()));
                            } else if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "foundation",
                                    name,
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E061", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "with-foundation" {
                    if children.len() < 2 {
                        diagnostics.push(Diagnostic::new(
                            "E062",
                            "with-foundation form must be `(with-foundation <name> <body>...)`",
                            span.clone(),
                        ));
                        continue;
                    }
                    let fname = match &children[1] {
                        Node::Leaf(s) if !s.is_empty() => s.clone(),
                        _ => {
                            diagnostics.push(Diagnostic::new(
                                "E062",
                                "with-foundation requires a foundation name",
                                span.clone(),
                            ));
                            continue;
                        }
                    };
                    if let Err(message) = env.enter_foundation(&fname) {
                        diagnostics.push(Diagnostic::new("E062", message, span.clone()));
                        continue;
                    }
                    if options.trace {
                        env.trace_events.push(TraceEvent::new(
                            "with-foundation/enter",
                            fname.clone(),
                            span.clone(),
                        ));
                    }
                    let bodies: Vec<Node> = children[2..].to_vec();
                    for body in bodies {
                        eval_foundation_body_form(
                            body,
                            &span,
                            env,
                            &mut diagnostics,
                            &mut results,
                            &mut proofs,
                            &mut provenance,
                            options,
                        );
                    }
                    env.exit_foundation();
                    if options.trace {
                        env.trace_events.push(TraceEvent::new(
                            "with-foundation/exit",
                            fname,
                            span.clone(),
                        ));
                    }
                    continue;
                }
                if head == "foundation-report" || head == "foundation-report?" {
                    let report = env.foundation_report();
                    if options.trace {
                        env.trace_events.push(TraceEvent::new(
                            "foundation-report",
                            report.active_foundation.clone(),
                            span.clone(),
                        ));
                    }
                    results.push(RunResult::Foundation(report));
                    if let Some(p) = proofs.as_mut() {
                        p.push(None);
                    }
                    if let Some(pv) = provenance.as_mut() {
                        pv.push(None);
                    }
                    continue;
                }
                // Proof-object substrate (issue #97, Phase 3). The
                // `(rule <name> (premise ...)... (conclusion ...))` shape is
                // routed here only when every clause uses the
                // `premise`/`conclusion` keywords and at least one
                // `conclusion` is present, so existing self-bootstrap
                // grammars that use `(rule <name> (sequence ...) ...)` fall
                // through to the legacy data path unchanged.
                if head == "rule" && is_proof_rule_shape(children) {
                    match parse_rule_form(&form) {
                        Ok(rule) => {
                            let name = rule.name.clone();
                            env.register_proof_rule(rule);
                            if options.trace {
                                env.trace_events
                                    .push(TraceEvent::new("rule", name, span.clone()));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "assumption" || head == "axiom" {
                    match parse_proof_assumption_form(&form) {
                        Ok(assumption) => {
                            let kind = assumption.kind.clone();
                            let name = assumption.name.clone();
                            env.register_proof_assumption(assumption);
                            if options.trace {
                                env.trace_events
                                    .push(TraceEvent::new(&kind, name, span.clone()));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "proof-object" {
                    match parse_proof_object_form(&form) {
                        Ok(po) => {
                            let name = po.name.clone();
                            env.register_proof_object(po);
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "proof-object",
                                    name,
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E064", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "check-proof" {
                    if children.len() != 2 {
                        diagnostics.push(Diagnostic::new(
                            "E064",
                            "(check-proof <name>) requires a proof-object name",
                            span.clone(),
                        ));
                        continue;
                    }
                    let target = match &children[1] {
                        Node::Leaf(s) if !s.is_empty() => s.clone(),
                        _ => {
                            diagnostics.push(Diagnostic::new(
                                "E064",
                                "(check-proof <name>) requires a proof-object name",
                                span.clone(),
                            ));
                            continue;
                        }
                    };
                    let verdict = check_proof_object(env, &target);
                    let (value, error) = match verdict {
                        CheckProofVerdict::Ok(_) => (1.0_f64, None),
                        CheckProofVerdict::Err(msg) => (0.0_f64, Some(msg)),
                    };
                    results.push(RunResult::Num(value));
                    if let Some(p) = proofs.as_mut() {
                        p.push(None);
                    }
                    if let Some(pv) = provenance.as_mut() {
                        pv.push(None);
                    }
                    if let Some(msg) = error {
                        diagnostics.push(Diagnostic::new("E064", msg, span.clone()));
                    }
                    if options.trace {
                        env.trace_events.push(TraceEvent::new(
                            "check-proof",
                            format!("{} → {}", target, if value == 1.0 { "ok" } else { "fail" }),
                            span.clone(),
                        ));
                    }
                    continue;
                }
                if head == "proof-report" {
                    if children.len() != 2 {
                        diagnostics.push(Diagnostic::new(
                            "E064",
                            "(proof-report <name>) requires a proof-object name",
                            span.clone(),
                        ));
                        continue;
                    }
                    let target = match &children[1] {
                        Node::Leaf(s) if !s.is_empty() => s.clone(),
                        _ => {
                            diagnostics.push(Diagnostic::new(
                                "E064",
                                "(proof-report <name>) requires a proof-object name",
                                span.clone(),
                            ));
                            continue;
                        }
                    };
                    let report = env.proof_report(&target);
                    results.push(RunResult::Proof(report));
                    if let Some(p) = proofs.as_mut() {
                        p.push(None);
                    }
                    if let Some(pv) = provenance.as_mut() {
                        pv.push(None);
                    }
                    if options.trace {
                        env.trace_events.push(TraceEvent::new(
                            "proof-report",
                            target,
                            span.clone(),
                        ));
                    }
                    continue;
                }
                if head == "eval-nat" {
                    if children.len() != 2 {
                        diagnostics.push(Diagnostic::new(
                            "E067",
                            "(eval-nat <term>) requires exactly one term argument",
                            span.clone(),
                        ));
                        continue;
                    }
                    match eval_nat_term(env, &children[1]) {
                        Ok(result) => {
                            results.push(RunResult::Num(result.value));
                            if let Some(p) = proofs.as_mut() {
                                p.push(None);
                            }
                            if let Some(pv) = provenance.as_mut() {
                                pv.push(None);
                            }
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "eval-nat",
                                    format!(
                                        "{} -> normal-form {} -> {}; rules-used: {}; host-primitives-used: structural-matcher; renderer: nat-normal-form-to-host-number",
                                        key_of(&children[1]),
                                        key_of(&result.normal_form),
                                        format_trace_value(result.value),
                                        if result.steps.is_empty() {
                                            "<none>".to_string()
                                        } else {
                                            result.steps.join(", ")
                                        }
                                    ),
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E067", message, span.clone()));
                        }
                    }
                    continue;
                }
                // Pure-links strict mode (issue #97, Phase 6).
                if head == "strict-foundation" {
                    match parse_strict_foundation_form(&form) {
                        Ok(decl) => {
                            env.strict_pure_links = true;
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "strict-foundation",
                                    decl.profile,
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E065", message, span.clone()));
                        }
                    }
                    continue;
                }
                if head == "allow-host-primitive" {
                    match parse_allow_host_primitive_form(&form) {
                        Ok(decl) => {
                            for name in &decl.names {
                                env.allowed_host_primitives.insert(name.clone());
                            }
                            if options.trace {
                                env.trace_events.push(TraceEvent::new(
                                    "allow-host-primitive",
                                    decl.names.join(" "),
                                    span.clone(),
                                ));
                            }
                        }
                        Err(message) => {
                            diagnostics.push(Diagnostic::new("E065", message, span.clone()));
                        }
                    }
                    continue;
                }
            }
        }

        let result = catch_unwind(AssertUnwindSafe(|| {
            let mut stack = Vec::new();
            let expanded_form = expand_templates(&form, env, &mut stack);
            let eval_res = eval_node(&expanded_form, env);
            (expanded_form, eval_res)
        }));
        match result {
            Ok((expanded_form, eval_res)) => {
                if options.trace {
                    let form_key = key_of(&expanded_form);
                    let summary = match &eval_res {
                        EvalResult::Query(v) => {
                            format!("{} → query {}", form_key, format_trace_value(*v))
                        }
                        EvalResult::TypeQuery(s) => {
                            format!("{} → type {}", form_key, s)
                        }
                        EvalResult::Value(v) => {
                            format!("{} → {}", form_key, format_trace_value(*v))
                        }
                        EvalResult::Term(term) => {
                            format!("{} → term {}", form_key, key_of(term))
                        }
                    };
                    env.trace_events
                        .push(TraceEvent::new("eval", summary, span.clone()));
                }
                let was_query = matches!(eval_res, EvalResult::Query(_) | EvalResult::TypeQuery(_));
                let query_value = if let EvalResult::Query(v) = &eval_res {
                    Some(*v)
                } else {
                    None
                };
                match eval_res {
                    EvalResult::Query(v) => results.push(RunResult::Num(v)),
                    EvalResult::TypeQuery(s) => results.push(RunResult::Type(s)),
                    _ => {}
                }
                if was_query {
                    let wants_proof = proofs_enabled || query_requests_proof(&expanded_form);
                    if wants_proof {
                        // Lazily allocate the proofs vec on first per-query
                        // opt-in so callers that never ask for proofs get
                        // an empty vec back. Backfill `None` for any prior
                        // bare queries so indices stay aligned with results.
                        if proofs.is_none() {
                            let backfill = results.len().saturating_sub(1);
                            proofs = Some(vec![None; backfill]);
                        }
                        // Strip the surrounding (? ...) so the proof attaches
                        // to the queried expression directly; this matches
                        // the issue example `(by structural-equality (a a))`
                        // rather than nesting under `(by query ...)`.
                        let proof_node = match &expanded_form {
                            Node::List(form_children)
                                if matches!(
                                    form_children.first(),
                                    Some(Node::Leaf(s)) if s == "?"
                                ) =>
                            {
                                let parts = &form_children[1..];
                                let inner = strip_with_proof(parts);
                                let target: Node = if inner.len() == 1 {
                                    inner[0].clone()
                                } else {
                                    Node::List(inner.to_vec())
                                };
                                build_proof(&target, env)
                            }
                            _ => build_proof(&expanded_form, env),
                        };
                        proofs.as_mut().unwrap().push(Some(proof_node));
                    } else if let Some(p) = proofs.as_mut() {
                        p.push(None);
                    }
                    let prov = equality_provenance_for_query(&expanded_form, env);
                    record_provenance(
                        &mut provenance,
                        results.len(),
                        prov,
                        env,
                        &expanded_form,
                        &span,
                        options,
                    );
                    // Carrier enforcement (issue #97 Section 2): also surface
                    // E063 at the top level so a `(with-foundation ...)` body
                    // that returns into a top-level query path still flags
                    // out-of-carrier results.
                    if let Some(v) = query_value {
                        if let Some(msg) = env.check_carrier_value(v) {
                            diagnostics.push(Diagnostic::new(
                                "E063",
                                format!(
                                    "Query result {} violates active foundation carrier: {}",
                                    format_trace_value(v),
                                    msg
                                ),
                                span.clone(),
                            ));
                        }
                    }
                    // Pure-links strict mode audit (issue #97 Phase 6). When
                    // `(strict-foundation pure-links)` is active, scan the
                    // queried form for operators registered as
                    // `host-primitive`/`host-derived` that have not been
                    // explicitly allow-listed via `(allow-host-primitive ...)`,
                    // and emit a single E065 listing them.
                    if env.strict_pure_links {
                        if let Node::List(form_children) = &expanded_form {
                            if matches!(form_children.first(), Some(Node::Leaf(s)) if s == "?") {
                                let parts = &form_children[1..];
                                let inner = strip_with_proof(parts);
                                let target: Node = if inner.len() == 1 {
                                    inner[0].clone()
                                } else {
                                    Node::List(inner.to_vec())
                                };
                                let offenders = scan_pure_links_offenders(&target, env);
                                if !offenders.is_empty() {
                                    diagnostics.push(Diagnostic::new(
                                        "E065",
                                        format!(
                                            "Query depends on host-primitive construct(s) under pure-links strict mode: {}",
                                            offenders.join(", ")
                                        ),
                                        span.clone(),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            Err(payload) => {
                let (code, message) = decode_panic_payload(&payload);
                diagnostics.push(Diagnostic::new(&code, message, span));
            }
        }
    }

    env.current_span = None;

    std::panic::set_hook(prev_hook);

    // Surface any shadow diagnostics collected during this evaluation pass.
    // Drain them so a nested evaluate_inner (called from handle_import) does
    // not re-emit the same diagnostic at the outer boundary.
    if !env.shadow_diagnostics.is_empty() {
        let drained = std::mem::take(&mut env.shadow_diagnostics);
        for d in drained {
            diagnostics.push(d);
        }
    }

    let trace = if options.trace {
        std::mem::take(&mut env.trace_events)
    } else {
        Vec::new()
    };

    let provenance_vec = match provenance {
        Some(mut v) => {
            while v.len() < results.len() {
                v.push(None);
            }
            v
        }
        None => Vec::new(),
    };

    EvaluateResult {
        results,
        diagnostics,
        trace,
        proofs: proofs.unwrap_or_default(),
        provenance: provenance_vec,
    }
}

/// Map a panic payload to a diagnostic `(code, message)` pair.  Known panic
/// messages emitted by the evaluator are mapped to the canonical `E001`/etc.
/// codes; anything else falls back to `E000`.
fn decode_panic_payload(payload: &Box<dyn std::any::Any + Send>) -> (String, String) {
    let raw_msg: String = if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "evaluation panicked".to_string()
    };
    if raw_msg.starts_with("Unknown op:") {
        ("E001".to_string(), raw_msg)
    } else if raw_msg.starts_with("Unknown aggregator") {
        ("E004".to_string(), raw_msg)
    } else if raw_msg.starts_with("Freshness error:") {
        (
            "E010".to_string(),
            raw_msg.replacen("Freshness error: ", "", 1),
        )
    } else if raw_msg.starts_with("Mode declaration error:") {
        (
            "E030".to_string(),
            raw_msg.replacen("Mode declaration error: ", "", 1),
        )
    } else if raw_msg.starts_with("Mode mismatch:") {
        (
            "E031".to_string(),
            raw_msg.replacen("Mode mismatch: ", "", 1),
        )
    } else if raw_msg.starts_with("Relation declaration error:") {
        (
            "E032".to_string(),
            raw_msg.replacen("Relation declaration error: ", "", 1),
        )
    } else if raw_msg.starts_with("Totality check error:") {
        (
            "E032".to_string(),
            raw_msg.replacen("Totality check error: ", "", 1),
        )
    } else if raw_msg.starts_with("Coverage check error:") {
        (
            "E037".to_string(),
            raw_msg.replacen("Coverage check error: ", "", 1),
        )
    } else if raw_msg.starts_with("World declaration error:") {
        (
            "E034".to_string(),
            raw_msg.replacen("World declaration error: ", "", 1),
        )
    } else if raw_msg.starts_with("World violation:") {
        (
            "E034".to_string(),
            raw_msg.replacen("World violation: ", "", 1),
        )
    } else if raw_msg.starts_with("Inductive declaration error:") {
        (
            "E033".to_string(),
            raw_msg.replacen("Inductive declaration error: ", "", 1),
        )
    } else if raw_msg.starts_with("Termination check error:") {
        (
            "E035".to_string(),
            raw_msg.replacen("Termination check error: ", "", 1),
        )
    } else if raw_msg.starts_with("Coinductive declaration error:") {
        (
            "E036".to_string(),
            raw_msg.replacen("Coinductive declaration error: ", "", 1),
        )
    } else if raw_msg.starts_with("Normalization error:") {
        (
            "E038".to_string(),
            raw_msg.replacen("Normalization error: ", "", 1),
        )
    } else if raw_msg.starts_with("Template expansion error:") {
        (
            "E040".to_string(),
            raw_msg.replacen("Template expansion error: ", "", 1),
        )
    } else if raw_msg.starts_with("Domain plugin error:") {
        (
            "E041".to_string(),
            raw_msg.replacen("Domain plugin error: ", "", 1),
        )
    } else if raw_msg.starts_with("Carrier violation:") {
        (
            "E063".to_string(),
            raw_msg.replacen("Carrier violation: ", "", 1),
        )
    } else {
        ("E000".to_string(), raw_msg)
    }
}

/// Run a complete LiNo knowledge base and return query results (including type queries).
pub fn run_typed(text: &str, options: Option<EnvOptions>) -> Vec<RunResult> {
    evaluate(text, None, options).results
}

/// Run a complete LiNo knowledge base and return query results.
pub fn run(text: &str, options: Option<EnvOptions>) -> Vec<f64> {
    run_typed(text, options)
        .into_iter()
        .filter_map(|result| match result {
            RunResult::Num(v) => Some(v),
            RunResult::Type(_) => None,
            RunResult::Foundation(_) => None,
            RunResult::Proof(_) => None,
        })
        .collect()
}

// Tests are in the tests/ directory (integration tests).
// To run: cargo test

pub mod repl;
pub mod check;
pub mod meta;
pub mod meta_language_support;
pub mod formal_corpus;
pub mod theory_network;
pub mod linked_program;
pub mod rocq;

// Universal CST converters (issue #138).
pub mod cst;
pub mod cst_rust;
pub mod cst_js;
pub mod cst_lean;
pub mod cst_rocq;
pub mod cst_convert;
