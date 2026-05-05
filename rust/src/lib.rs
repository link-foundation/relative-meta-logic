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

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

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

/// Compute (line, col) source positions for every top-level link in `text`.
/// Mirrors `compute_form_spans` in the JavaScript implementation.
///
/// A "top-level link" is a parenthesized form not nested inside another; the
/// position is the 1-based line/col of its opening `(`. Full-line `# ...`
/// comments and inline `# ...` comments after a closing paren plus whitespace
/// are skipped so that parens inside a comment don't disturb the depth
/// counter.
pub fn compute_form_spans(text: &str, file: Option<&str>) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut depth: i32 = 0;
    let mut line: usize = 1;
    let mut col: usize = 1;
    let mut pending_start: Option<(usize, usize)> = None;
    let mut in_line_comment = false;
    let mut line_start_idx: usize = 0;
    let mut last_closing_depth_zero_col: i32 = -1;
    let mut saw_ws_after_close = false;
    let bytes = text.as_bytes();
    for (off, &b) in bytes.iter().enumerate() {
        let ch = b as char;
        if ch == '\n' {
            in_line_comment = false;
            line += 1;
            col = 1;
            line_start_idx = off + 1;
            last_closing_depth_zero_col = -1;
            saw_ws_after_close = false;
            continue;
        }
        if in_line_comment {
            col += 1;
            continue;
        }
        if ch == '#' && depth == 0 {
            // Full-line comment: line so far is all whitespace.
            let line_so_far = &text[line_start_idx..off];
            if line_so_far.chars().all(|c| c == ' ' || c == '\t') {
                in_line_comment = true;
                col += 1;
                continue;
            }
            // Inline comment after `)` + whitespace: discard rest of line.
            if last_closing_depth_zero_col >= 0 && saw_ws_after_close {
                in_line_comment = true;
                col += 1;
                continue;
            }
        }
        if ch == '(' {
            if depth == 0 {
                pending_start = Some((line, col));
            }
            depth += 1;
            saw_ws_after_close = false;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                if let Some((sl, sc)) = pending_start.take() {
                    spans.push(Span::new(file.map(|s| s.to_string()), sl, sc, 1));
                }
                last_closing_depth_zero_col = col as i32;
                saw_ws_after_close = false;
            }
        } else if ch == ' ' || ch == '\t' {
            if last_closing_depth_zero_col >= 0 {
                saw_ws_after_close = true;
            }
        } else {
            // Any other character resets the inline-comment-eligible state.
            last_closing_depth_zero_col = -1;
            saw_ws_after_close = false;
        }
        col += 1;
    }
    spans
}

// ========== LiNo Parser ==========
// Uses the official links-notation crate for parsing LiNo text.
// See: https://github.com/link-foundation/links-notation

// Find the index of an inline comment marker `#` that follows a `)` plus
// whitespace, mirroring the JS regex `(\)[ \t]+)#.*$`.
fn inline_comment_index(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut last_close: Option<usize> = None;
    for (i, b) in bytes.iter().enumerate() {
        match *b {
            b')' => last_close = Some(i),
            b'#' => {
                if let Some(close_idx) = last_close {
                    let between = &line[close_idx + 1..i];
                    if !between.is_empty() && between.chars().all(|c| c == ' ' || c == '\t') {
                        return Some(i);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Parse LiNo text into a vector of link strings (each a top-level parenthesized expression).
pub fn parse_lino(text: &str) -> Vec<String> {
    // Strip both full-line and inline comments (# ...) before parsing —
    // the LiNo parser doesn't handle them and an inline comment containing a
    // colon would otherwise be misread as a binding.
    let stripped: String = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('#') {
                String::new()
            } else if let Some(idx) = inline_comment_index(line) {
                line[..idx].trim_end().to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<String>>()
        .join("\n");

    // The links-notation crate treats blank lines as group separators,
    // so we split the input by blank lines and parse each segment separately.
    let mut all_links = Vec::new();
    for segment in stripped.split("\n\n") {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }
        match links_notation::parse_lino_to_links(trimmed) {
            Ok(links) => {
                for link in links {
                    all_links.push(link.to_string());
                }
            }
            Err(_) => {}
        }
    }
    all_links
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
/// See: https://en.wikipedia.org/wiki/Many-valued_logic
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
        };

        // Initialize truth constants: true, false, unknown, undefined
        // These are predefined symbol probabilities based on the current range.
        // By default: (false: min(range)), (true: max(range)),
        //             (unknown: mid(range)), (undefined: mid(range))
        // They can be redefined by the user via (true: <value>), (false: <value>), etc.
        env.init_truth_constants();
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
                || self.lambdas.contains_key(&qualified)
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
        self.trace_events
            .push(TraceEvent::new(kind, detail, span));
    }

    pub fn set_type(&mut self, expr: &str, type_expr: &str) {
        self.types.insert(expr.to_string(), type_expr.to_string());
    }

    pub fn get_type(&self, expr: &str) -> Option<&String> {
        self.types.get(expr)
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
            | "constructor"
            | "+"
            | "-"
            | "*"
            | "/"
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
    {
        return true;
    }
    let resolved = env.resolve_qualified(name);
    resolved != name
        && (env.symbol_prob.contains_key(&resolved)
            || env.terms.contains(&resolved)
            || env.types.contains_key(&resolved)
            || env.lambdas.contains_key(&resolved)
            || env.ops.contains_key(&resolved))
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
                    let fn_node = &children[1];
                    let arg = normalize_term(&children[2], env, options);
                    if let Node::List(fn_children) = fn_node {
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
                    if let Node::Leaf(fn_name) = fn_node {
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
                    return Node::List(vec![
                        Node::Leaf("apply".into()),
                        normalize_term(fn_node, env, options),
                        arg,
                    ]);
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
    {
        return true;
    }
    let resolved = env.resolve_qualified(name);
    resolved != name
        && (env.terms.contains(&resolved)
            || env.types.contains_key(&resolved)
            || env.lambdas.contains_key(&resolved)
            || env.symbol_prob.contains_key(&resolved)
            || env.ops.contains_key(&resolved))
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

/// Build a derivation tree witnessing how `node` reduces under `env`.
/// Returns a `Node::List` of the form `(by <rule> <subderivation>...)`.
///
/// The walker mirrors the structural cases of `eval_node`: definitions and
/// configuration directives become leaf witnesses, infix and prefix
/// operators become rule applications whose subderivations recurse through
/// `build_proof`, and equality picks `assigned-equality` /
/// `structural-equality` / `numeric-equality` (and the negated counterparts)
/// based on the same lookups `eval_node` performs.
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
                        let k_prefix =
                            key_of(&Node::List(vec![leaf("="), l.clone(), r.clone()]));
                        let k_infix =
                            key_of(&Node::List(vec![l.clone(), leaf("="), r.clone()]));
                        let rule = if env.assign.contains_key(&k_prefix)
                            || env.assign.contains_key(&k_infix)
                        {
                            if op_name == "!=" {
                                "assigned-inequality"
                            } else {
                                "assigned-equality"
                            }
                        } else if is_structurally_same(l, r) {
                            if op_name == "!=" {
                                "structural-inequality"
                            } else {
                                "structural-equality"
                            }
                        } else if op_name == "!=" {
                            "numeric-inequality"
                        } else {
                            "numeric-equality"
                        };
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
// relation, `(total <name>)` triggers `is_total`, and the same
// `is_total` helper is exported for programmatic callers.

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

// ---------- Coverage checking (issue #46, D14) ----------
// Mirrors the JavaScript `isCovered` helper. For every `+input` slot of the
// named relation, the union of clause patterns at that slot must exhaust
// every constructor of the slot's inductive type. Wildcard variables
// (lowercase symbols not registered in the env) cover all constructors;
// slots whose inductive type cannot be inferred are skipped. A missing
// constructor produces an `E035` diagnostic with an example pattern.

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
                code: "E035".to_string(),
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
                code: "E035".to_string(),
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
            code: "E035".to_string(),
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
                        env.set_expr_prob(&children[0], p);
                        let key = key_of(&children[0]);
                        let clamped = env.clamp(p);
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

// ========== Runner ==========

/// A result from running a query: either a numeric value or a type string.
#[derive(Debug, Clone, PartialEq)]
pub enum RunResult {
    Num(f64),
    Type(String),
}

/// Evaluate a complete LiNo knowledge base and return both results and any
/// diagnostics emitted by the parser, evaluator, or type checker.
///
/// Each diagnostic carries a code (`E001`, `E002`, ...), a message, and a
/// source span (1-based line/col).  See `docs/DIAGNOSTICS.md` for the
/// full code list.  Errors do not abort evaluation: independent forms
/// continue to be processed after a failing one.
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

fn evaluate_inner(text: &str, file: Option<&str>, env: &mut Env, options: &EvaluateOptions, ctx: &mut ImportContext) -> EvaluateResult {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let spans = compute_form_spans(text, file);

    let links = parse_lino(text);
    let forms: Vec<Node> = links
        .iter()
        .filter(|link_str| {
            let s = link_str.trim();
            !(s.starts_with("(#") && s.chars().nth(2).map_or(false, |c| c.is_whitespace()))
        })
        .filter_map(|link_str| {
            let toks = tokenize_one(link_str);
            match parse_one(&toks) {
                Ok(node) => Some(desugar_hoas(node)),
                Err(msg) => {
                    diagnostics.push(Diagnostic::new(
                        "E002",
                        msg,
                        Span::new(file.map(|s| s.to_string()), 1, 1, 0),
                    ));
                    None
                }
            }
        })
        .collect();

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

    // Silence the default panic hook while we deliberately catch evaluator
    // panics — otherwise they'd leak to stderr alongside the diagnostics.
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));

    for (idx, form) in forms.into_iter().enumerate() {
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
        let span = spans
            .get(idx)
            .cloned()
            .unwrap_or_else(|| Span::new(file.map(|s| s.to_string()), 1, 1, 0));
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
                                env.trace_events
                                    .push(TraceEvent::new("namespace", n.clone(), span.clone()));
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

        // We need to capture the form so the eval-trace event can reference it
        // by canonical key. Cloning is cheap: AST nodes are small strings.
        let form_for_trace = if options.trace {
            Some(form.clone())
        } else {
            None
        };
        let result = catch_unwind(AssertUnwindSafe(|| eval_node(&form, env)));
        match result {
            Ok(eval_res) => {
                if options.trace {
                    if let Some(ref form_node) = form_for_trace {
                        let form_key = key_of(form_node);
                        let summary = match &eval_res {
                            EvalResult::Query(v) => format!(
                                "{} → query {}",
                                form_key,
                                format_trace_value(*v)
                            ),
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
                }
                let was_query = matches!(
                    eval_res,
                    EvalResult::Query(_) | EvalResult::TypeQuery(_)
                );
                match eval_res {
                    EvalResult::Query(v) => results.push(RunResult::Num(v)),
                    EvalResult::TypeQuery(s) => results.push(RunResult::Type(s)),
                    _ => {}
                }
                if was_query {
                    let wants_proof = proofs_enabled || query_requests_proof(&form);
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
                        let proof_node = match &form {
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
                            _ => build_proof(&form, env),
                        };
                        proofs.as_mut().unwrap().push(Some(proof_node));
                    } else if let Some(p) = proofs.as_mut() {
                        p.push(None);
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

    EvaluateResult {
        results,
        diagnostics,
        trace,
        proofs: proofs.unwrap_or_default(),
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
            "E035".to_string(),
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
    } else {
        ("E000".to_string(), raw_msg)
    }
}

/// Run a complete LiNo knowledge base and return query results (including type queries).
pub fn run_typed(text: &str, options: Option<EnvOptions>) -> Vec<RunResult> {
    let links = parse_lino(text);
    let forms: Vec<Node> = links
        .iter()
        .filter(|link_str| {
            let s = link_str.trim();
            !(s.starts_with("(#") && s.chars().nth(2).map_or(false, |c| c.is_whitespace()))
        })
        .filter_map(|link_str| {
            let toks = tokenize_one(link_str);
            parse_one(&toks).ok()
        })
        .collect();

    let mut env = Env::new(options);
    let mut outs = Vec::new();

    for form in forms {
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
        let res = eval_node(&form, &mut env);
        match res {
            EvalResult::Query(v) => outs.push(RunResult::Num(v)),
            EvalResult::TypeQuery(s) => outs.push(RunResult::Type(s)),
            _ => {}
        }
    }
    outs
}

/// Run a complete LiNo knowledge base and return query results.
pub fn run(text: &str, options: Option<EnvOptions>) -> Vec<f64> {
    let links = parse_lino(text);

    // Filter out comment-only links and parse each link
    let forms: Vec<Node> = links
        .iter()
        .filter(|link_str| {
            let s = link_str.trim();
            // Skip if it's just a comment link like "(# ...)"
            !(s.starts_with("(#") && s.chars().nth(2).map_or(false, |c| c.is_whitespace()))
        })
        .filter_map(|link_str| {
            let toks = tokenize_one(link_str);
            parse_one(&toks).ok()
        })
        .collect();

    let mut env = Env::new(options);
    let mut outs = Vec::new();

    for form in forms {
        // Unwrap single-element arrays (LiNo wraps everything in outer parens)
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
        let res = eval_node(&form, &mut env);
        if let EvalResult::Query(v) = res {
            outs.push(v);
        }
    }
    outs
}

// Tests are in the tests/ directory (integration tests).
// To run: cargo test

pub mod repl;
pub mod check;
