//! A bounded pure natural-number translation fragment over the registered RML network.
//! This is not a complete frontend for any of the four source languages.
use crate::lino_frontend::ParsedLink;
use crate::meta_language_support::{attach_rml_structure, rml_structured_document};
use meta_language::LinkNetwork;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::LazyLock;

pub const PORTABLE_NATURAL_MAX: u64 = 9_007_199_254_740_991;
const LANGUAGES: &[&str] = &["JavaScript", "Rust", "Lean", "Rocq"];
const RESERVED: &str = "if then else fn function return let const var true false null undefined match end fix cofix fun forall as in with where for def theorem axiom by namespace section type self crate super move ref mod pub use impl trait extern unsafe dyn async await loop while break continue switch case default throw try catch finally class new import export nat arguments eval typeof void delete debugger instanceof extends implements interface package private protected public static yield abstract become box do final gen macro override priv unsized virtual union example opaque abbrev constant variable universe mutual structure inductive instance open prelude set_option syntax attribute noncomputable partial deriving termination_by decreasing_by have show from calc sorry rfl";
static TOKEN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|===|<=\?|<\?|=\?|:=|->|<=|==|[(){}:;,+*?.<>=])",
    )
    .unwrap()
});

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableError {
    pub code: &'static str,
    pub message: String,
    pub offset: usize,
}
impl fmt::Display for PortableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: {} at UTF-16 offset {}",
            self.code, self.message, self.offset
        )
    }
}
impl std::error::Error for PortableError {}
fn unsupported(message: impl Into<String>) -> PortableError {
    PortableError {
        code: "RML_PORTABLE_UNSUPPORTED",
        message: message.into(),
        offset: 0,
    }
}
fn domain(message: &str) -> PortableError {
    PortableError {
        code: "RML_PORTABLE_DOMAIN",
        message: message.into(),
        offset: 0,
    }
}
fn name_valid(name: &str) -> bool {
    let mut characters = name.chars();
    characters.next().is_some_and(|c| c.is_ascii_lowercase())
        && characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !RESERVED.split(' ').any(|word| word == name)
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Expr {
    Literal(u64),
    Variable(String),
    Call(String, Vec<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Choose(Box<Expr>, Box<Expr>, Box<Expr>),
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Function {
    name: String,
    parameters: Vec<String>,
    body: Expr,
}
struct Token {
    text: String,
    offset: usize,
    byte_offset: usize,
}
fn lex(source: &str, language: &str) -> Result<Vec<Token>, PortableError> {
    if source.encode_utf16().count() > 1_000_000 {
        return Err(unsupported("Portable source limit exceeded"));
    }
    let mut tokens = Vec::new();
    let mut i = 0;
    let mut offset = 0;
    while i < source.len() {
        let character = source[i..].chars().next().unwrap();
        if matches!(character, ' ' | '\t' | '\r' | '\n') {
            offset += character.len_utf16();
            i += character.len_utf8();
            continue;
        }
        if ((language == "JavaScript" || language == "Rust") && source[i..].starts_with("//"))
            || language == "Lean" && source[i..].starts_with("--")
        {
            let start = i;
            i = source[i..]
                .find(|c| {
                    if language == "JavaScript" {
                        matches!(c, '\r' | '\n' | '\u{2028}' | '\u{2029}')
                    } else {
                        c == '\n'
                    }
                })
                .map_or(source.len(), |end| {
                    i + end + source[i + end..].chars().next().unwrap().len_utf8()
                });
            offset += source[start..i].encode_utf16().count();
            continue;
        }
        let (open, close) = match language {
            "Lean" => ("/-", "-/"),
            "Rocq" => ("(*", "*)"),
            _ => ("/*", "*/"),
        };
        if source[i..].starts_with(open) {
            let start = i;
            let mut depth = 1;
            i += 2;
            while i < source.len() && depth > 0 {
                if language != "JavaScript" && source[i..].starts_with(open) {
                    depth += 1;
                    i += 2;
                } else if source[i..].starts_with(close) {
                    depth -= 1;
                    i += 2;
                } else {
                    i += source[i..].chars().next().unwrap().len_utf8();
                }
                if depth > 64 {
                    return Err(PortableError {
                        offset,
                        ..unsupported("Comment nesting exceeds the portable limit")
                    });
                }
            }
            if depth > 0 {
                return Err(PortableError {
                    code: "RML_PORTABLE_INVALID",
                    message: "Unterminated comment".into(),
                    offset,
                });
            }
            offset += source[start..i].encode_utf16().count();
            continue;
        }
        let token = TOKEN.find(&source[i..]).ok_or_else(|| PortableError {
            offset,
            ..unsupported("Unsupported token; complete source is retained")
        })?;
        tokens.push(Token {
            text: token.as_str().to_string(),
            offset,
            byte_offset: i,
        });
        i += token.end();
        offset += token.as_str().len();
        if tokens.len() > 100_000 {
            return Err(unsupported("Portable token limit exceeded"));
        }
    }
    tokens.push(Token {
        text: "<eof>".into(),
        offset,
        byte_offset: source.len(),
    });
    Ok(tokens)
}
struct Parser<'a> {
    source: String,
    language: &'a str,
    tokens: Vec<Token>,
    index: usize,
    depth: usize,
    arities: BTreeMap<String, usize>,
}
impl<'a> Parser<'a> {
    fn new(source: &str, language: &'a str) -> Result<Self, PortableError> {
        Ok(Self {
            source: source.to_string(),
            language,
            tokens: lex(source, language)?,
            index: 0,
            depth: 0,
            arities: BTreeMap::new(),
        })
    }
    fn peek(&self) -> &str {
        &self.tokens[self.index].text
    }
    fn take(&mut self) -> String {
        let text = self.tokens[self.index].text.clone();
        self.index += 1;
        text
    }
    fn error(&self, message: impl Into<String>) -> PortableError {
        PortableError {
            offset: self
                .tokens
                .get(self.index)
                .unwrap_or_else(|| self.tokens.last().unwrap())
                .offset,
            ..unsupported(message)
        }
    }
    fn expect(&mut self, text: &str) -> Result<(), PortableError> {
        if self.peek() != text {
            return Err(self.error(format!("Expected {text}, found {}", self.peek())));
        }
        self.take();
        Ok(())
    }
    fn name(&mut self) -> Result<String, PortableError> {
        if !name_valid(self.peek()) {
            return Err(self.error(format!(
                "Unsupported or reserved portable identifier {}",
                self.peek()
            )));
        }
        Ok(self.take())
    }
    fn program(&mut self) -> Result<Vec<Function>, PortableError> {
        let mut functions = Vec::new();
        if self.language == "Rocq" && self.peek() == "Require" {
            for token in ["Require", "Import", "Arith", "."] {
                self.expect(token)?;
            }
        }
        while self.peek() != "<eof>" {
            if functions.len() >= 1000 {
                return Err(self.error("Portable function limit exceeded"));
            }
            self.expect(match self.language {
                "JavaScript" => "function",
                "Rust" => "fn",
                "Lean" => "def",
                _ => "Definition",
            })?;
            let name = self.name()?;
            let mut parameters = Vec::new();
            if self.language == "JavaScript" || self.language == "Rust" {
                self.expect("(")?;
                if self.peek() != ")" {
                    loop {
                        parameters.push(self.name()?);
                        if self.language == "Rust" {
                            self.expect(":")?;
                            self.expect("u64")?;
                        }
                        if self.peek() != "," {
                            break;
                        }
                        self.take();
                    }
                }
                self.expect(")")?;
                if self.language == "Rust" {
                    self.expect("->")?;
                    self.expect("u64")?;
                }
                self.expect("{")?;
                if self.language == "JavaScript" {
                    let start = self.tokens[self.index].byte_offset;
                    self.expect("return")?;
                    let end = self.tokens[self.index].byte_offset;
                    if self.source[start + 6..end]
                        .chars()
                        .any(|unit| matches!(unit, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
                    {
                        return Err(
                            self.error("Line break after return has JavaScript ASI semantics")
                        );
                    }
                }
            } else {
                while self.peek() == "(" {
                    self.take();
                    parameters.push(self.name()?);
                    while self.peek() != ":" && self.peek() != "<eof>" {
                        parameters.push(self.name()?);
                    }
                    self.expect(":")?;
                    self.expect(if self.language == "Lean" {
                        "Nat"
                    } else {
                        "nat"
                    })?;
                    self.expect(")")?;
                }
                self.expect(":")?;
                self.expect(if self.language == "Lean" {
                    "Nat"
                } else {
                    "nat"
                })?;
                self.expect(":=")?;
            }
            if self
                .arities
                .insert(name.clone(), parameters.len())
                .is_some()
            {
                return Err(self.error(format!("Duplicate function {name}")));
            }
            let body = self.expression(0)?;
            if self.language == "JavaScript" {
                self.expect(";")?;
            }
            if self.language == "JavaScript" || self.language == "Rust" {
                self.expect("}")?;
            }
            if self.language == "Rocq" {
                self.expect(".")?;
            }
            functions.push(Function {
                name,
                parameters,
                body,
            });
        }
        validate(&functions)?;
        Ok(functions)
    }
    fn expression(&mut self, minimum: i32) -> Result<Expr, PortableError> {
        self.depth += 1;
        if self.depth > 64 {
            return Err(self.error("Portable expression nesting exceeds 64"));
        }
        let bare_rust_if = self.language == "Rust" && self.peek() == "if";
        let mut left = self.atom(true)?;
        let mut operators = 0;
        loop {
            let op = match self.peek() {
                "+" => Some(("add", 10)),
                "*" => Some(("multiply", 20)),
                "<?" if self.language == "Rocq" => Some(("less", 5)),
                "<=?" if self.language == "Rocq" => Some(("less-equal", 5)),
                "=?" if self.language == "Rocq" => Some(("equal", 5)),
                "<" if self.language != "Rocq" => Some(("less", 5)),
                "<=" if self.language != "Rocq" => Some(("less-equal", 5)),
                "===" if self.language == "JavaScript" => Some(("equal", 5)),
                "==" if self.language == "Rust" => Some(("equal", 5)),
                "=" if self.language == "Lean" => Some(("equal", 5)),
                _ => None,
            };
            let Some((tag, precedence)) = op else {
                break;
            };
            if precedence < minimum {
                break;
            }
            if bare_rust_if {
                return Err(
                    self.error("A Rust conditional before an infix operator must be parenthesized")
                );
            }
            operators += 1;
            if operators > 64 {
                return Err(self.error("Portable expression operator limit exceeded"));
            }
            self.take();
            left = Expr::Binary(
                tag,
                Box::new(left),
                Box::new(self.expression(precedence + 1)?),
            );
        }
        if minimum == 0 && self.language == "JavaScript" && self.peek() == "?" {
            self.take();
            let yes = self.expression(0)?;
            self.expect(":")?;
            let no = self.expression(0)?;
            left = Expr::Choose(Box::new(left), Box::new(yes), Box::new(no));
        }
        self.depth -= 1;
        Ok(left)
    }
    fn atom(&mut self, allow_conditional: bool) -> Result<Expr, PortableError> {
        if self.peek() == "if" && self.language != "JavaScript" && allow_conditional {
            self.take();
            let condition = self.expression(0)?;
            self.expect(if self.language == "Rust" { "{" } else { "then" })?;
            let yes = self.expression(0)?;
            if self.language == "Rust" {
                self.expect("}")?;
            }
            self.expect("else")?;
            if self.language == "Rust" {
                self.expect("{")?;
            }
            let no = self.expression(0)?;
            if self.language == "Rust" {
                self.expect("}")?;
            }
            return Ok(Expr::Choose(
                Box::new(condition),
                Box::new(yes),
                Box::new(no),
            ));
        }
        if self.peek() == "(" {
            self.take();
            let value = self.expression(0)?;
            self.expect(")")?;
            return Ok(value);
        }
        if self.peek().bytes().all(|c| c.is_ascii_digit()) {
            let text = self.take();
            let value = text
                .parse::<u64>()
                .ok()
                .filter(|value| *value <= PORTABLE_NATURAL_MAX);
            if text.len() > 1 && text.starts_with('0') || value.is_none() {
                return Err(self.error("Literal outside the portable natural-number range"));
            }
            return Ok(Expr::Literal(value.unwrap()));
        }
        let name = self.name()?;
        if self.language == "JavaScript" || self.language == "Rust" {
            if self.peek() != "(" {
                return Ok(Expr::Variable(name));
            }
            self.take();
            let mut args = Vec::new();
            if self.peek() != ")" {
                loop {
                    args.push(self.expression(0)?);
                    if self.peek() != "," {
                        break;
                    }
                    self.take();
                }
            }
            self.expect(")")?;
            return Ok(Expr::Call(name, args));
        }
        let Some(arity) = self.arities.get(&name).copied() else {
            return Ok(Expr::Variable(name));
        };
        if !allow_conditional && arity > 0 {
            return Err(
                self.error("Function-valued arguments are unsupported; parenthesize nested calls")
            );
        }
        let mut args = Vec::new();
        for _ in 0..arity {
            args.push(self.atom(false)?);
        }
        Ok(Expr::Call(name, args))
    }
}

fn validate(functions: &[Function]) -> Result<(), PortableError> {
    if functions.is_empty() || functions.len() > 1000 {
        return Err(unsupported("Expected one through 1000 portable functions"));
    }
    let mut names = BTreeMap::new();
    for function in functions {
        if !name_valid(&function.name) || names.insert(function.name.clone(), function).is_some() {
            return Err(unsupported("Invalid or duplicate portable function"));
        }
        let unique: BTreeSet<_> = function.parameters.iter().collect();
        if unique.len() != function.parameters.len()
            || function.parameters.iter().any(|name| !name_valid(name))
        {
            return Err(unsupported("Invalid or duplicate parameters"));
        }
    }
    fn expression_type(
        expr: &Expr,
        parameters: &[String],
        names: &BTreeMap<String, &Function>,
        calls: &mut BTreeSet<String>,
        depth: usize,
    ) -> Result<bool, PortableError> {
        if depth > 64 {
            return Err(unsupported("Invalid or over-deep portable expression"));
        }
        let mut natural = |expr| {
            if expression_type(expr, parameters, names, calls, depth + 1)? {
                Ok(())
            } else {
                Err(unsupported("Expected natural-number expression"))
            }
        };
        match expr {
            Expr::Literal(value) if *value <= PORTABLE_NATURAL_MAX => Ok(true),
            Expr::Literal(_) => Err(unsupported("Invalid portable literal")),
            Expr::Variable(name) => {
                if parameters.contains(name) {
                    Ok(true)
                } else {
                    Err(unsupported(format!("Unresolved variable {name}")))
                }
            }
            Expr::Call(name, args) => {
                let callee = names.get(name).ok_or_else(|| {
                    unsupported(format!("Unresolved function or arity mismatch: {name}"))
                })?;
                if callee.parameters.len() != args.len() {
                    return Err(unsupported(format!(
                        "Unresolved function or arity mismatch: {name}"
                    )));
                }
                for arg in args {
                    natural(arg)?;
                }
                calls.insert(name.clone());
                Ok(true)
            }
            Expr::Binary(tag, left, right) => {
                natural(left)?;
                natural(right)?;
                Ok(*tag == "add" || *tag == "multiply")
            }
            Expr::Choose(condition, yes, no) => {
                if expression_type(condition, parameters, names, calls, depth + 1)? {
                    return Err(unsupported("Conditional type mismatch"));
                }
                if !expression_type(yes, parameters, names, calls, depth + 1)?
                    || !expression_type(no, parameters, names, calls, depth + 1)?
                {
                    return Err(unsupported("Conditional type mismatch"));
                }
                Ok(true)
            }
        }
    }
    let mut edges = BTreeMap::new();
    for function in functions {
        if function
            .parameters
            .iter()
            .any(|name| names.contains_key(name))
        {
            return Err(unsupported("A parameter shadows a function name"));
        }
        let mut calls = BTreeSet::new();
        if !expression_type(&function.body, &function.parameters, &names, &mut calls, 0)? {
            return Err(unsupported("Function result must be natural"));
        }
        edges.insert(function.name.clone(), calls);
    }
    fn visit(
        name: &str,
        edges: &BTreeMap<String, BTreeSet<String>>,
        active: &mut BTreeSet<String>,
        seen: &mut BTreeSet<String>,
    ) -> Result<(), PortableError> {
        if active.contains(name) {
            return Err(unsupported(
                "Recursive calls require termination and numeric-bound proofs",
            ));
        }
        if seen.contains(name) {
            return Ok(());
        }
        active.insert(name.to_string());
        for child in &edges[name] {
            visit(child, edges, active, seen)?;
        }
        active.remove(name);
        seen.insert(name.to_string());
        Ok(())
    }
    let mut seen = BTreeSet::new();
    for name in names.keys() {
        visit(name, &edges, &mut BTreeSet::new(), &mut seen)?;
    }
    Ok(())
}

fn expression_lino(expr: &Expr) -> String {
    match expr {
        Expr::Literal(value) => format!("(literal {value})"),
        Expr::Variable(name) => format!("(variable {name})"),
        Expr::Call(name, args) => format!(
            "(call {name}{})",
            args.iter()
                .map(|arg| format!(" {}", expression_lino(arg)))
                .collect::<String>()
        ),
        Expr::Binary(tag, left, right) => format!(
            "({tag} {} {})",
            expression_lino(left),
            expression_lino(right)
        ),
        Expr::Choose(condition, yes, no) => format!(
            "(choose {} {} {})",
            expression_lino(condition),
            expression_lino(yes),
            expression_lino(no)
        ),
    }
}
fn to_network(functions: &[Function]) -> Result<LinkNetwork, PortableError> {
    let text = format!(
        "(portable-natural-v1{})",
        functions
            .iter()
            .map(|function| format!(
                " (function {} (parameters{}) (body {}))",
                function.name,
                function
                    .parameters
                    .iter()
                    .map(|name| format!(" {name}"))
                    .collect::<String>(),
                expression_lino(&function.body)
            ))
            .collect::<String>()
    );
    let mut network = LinkNetwork::new();
    attach_rml_structure(&mut network, &text);
    rml_structured_document(&network).map_err(|error| unsupported(error.to_string()))?;
    Ok(network)
}
fn atom(link: &ParsedLink) -> Result<&str, PortableError> {
    if !link.values.is_empty() || link.compound {
        return Err(unsupported("Expected a portable atom"));
    }
    link.id
        .as_deref()
        .ok_or_else(|| unsupported("Expected a portable atom"))
}
fn items(link: &ParsedLink) -> Result<&[ParsedLink], PortableError> {
    if link.id.is_some() || link.compound {
        return Err(unsupported(
            "Named/compound LiNo links are not portable operations",
        ));
    }
    Ok(&link.values)
}
fn expression_from_link(link: &ParsedLink, depth: usize) -> Result<Expr, PortableError> {
    if depth > 64 {
        return Err(unsupported("Invalid or over-deep portable expression"));
    }
    let values = items(link)?;
    let tag = atom(
        values
            .first()
            .ok_or_else(|| unsupported("Empty portable expression"))?,
    )?;
    let args = &values[1..];
    match (tag, args) {
        ("literal", [value]) => {
            let text = atom(value)?;
            if text.is_empty()
                || !text.bytes().all(|c| c.is_ascii_digit())
                || text.len() > 1 && text.starts_with('0')
            {
                return Err(unsupported("Invalid portable literal"));
            }
            let value = text
                .parse::<u64>()
                .map_err(|_| unsupported("Invalid portable literal"))?;
            Ok(Expr::Literal(value))
        }
        ("variable", [value]) => Ok(Expr::Variable(atom(value)?.to_string())),
        ("call", [name, args @ ..]) => Ok(Expr::Call(
            atom(name)?.to_string(),
            args.iter()
                .map(|arg| expression_from_link(arg, depth + 1))
                .collect::<Result<_, _>>()?,
        )),
        ("choose", [condition, yes, no]) => Ok(Expr::Choose(
            Box::new(expression_from_link(condition, depth + 1)?),
            Box::new(expression_from_link(yes, depth + 1)?),
            Box::new(expression_from_link(no, depth + 1)?),
        )),
        ("add" | "multiply" | "less" | "less-equal" | "equal", [left, right]) => {
            let tag = match tag {
                "add" => "add",
                "multiply" => "multiply",
                "less" => "less",
                "less-equal" => "less-equal",
                _ => "equal",
            };
            Ok(Expr::Binary(
                tag,
                Box::new(expression_from_link(left, depth + 1)?),
                Box::new(expression_from_link(right, depth + 1)?),
            ))
        }
        _ => Err(unsupported(format!("Unsupported portable operation {tag}"))),
    }
}
fn from_network(network: &LinkNetwork) -> Result<Vec<Function>, PortableError> {
    let document =
        rml_structured_document(network).map_err(|error| unsupported(error.to_string()))?;
    if document.len() != 1 {
        return Err(unsupported("Expected one portable program root"));
    }
    let values = items(&document[0].1)?;
    if values.first().map(atom).transpose()? != Some("portable-natural-v1") {
        return Err(unsupported("Unsupported portable program schema"));
    }
    let functions = values[1..]
        .iter()
        .map(|link| {
            let values = items(link)?;
            if values.len() != 4 || atom(&values[0])? != "function" {
                return Err(unsupported("Malformed portable function"));
            }
            let parameters = items(&values[2])?;
            let body = items(&values[3])?;
            if parameters.first().map(atom).transpose()? != Some("parameters")
                || body.len() != 2
                || atom(&body[0])? != "body"
            {
                return Err(unsupported("Malformed portable function"));
            }
            Ok(Function {
                name: atom(&values[1])?.to_string(),
                parameters: parameters[1..]
                    .iter()
                    .map(|link| atom(link).map(str::to_string))
                    .collect::<Result<_, _>>()?,
                body: expression_from_link(&body[1], 0)?,
            })
        })
        .collect::<Result<Vec<_>, PortableError>>()?;
    validate(&functions)?;
    Ok(functions)
}

/// Parse the supported source grammar, resolve/type-check the fragment, and encode a source-free RML network.
pub fn parse_portable_natural(source: &str, language: &str) -> Result<LinkNetwork, PortableError> {
    if !LANGUAGES.contains(&language) {
        return Err(unsupported(format!(
            "Unsupported source language {language}"
        )));
    }
    to_network(&Parser::new(source, language)?.program()?)
}
fn expression_source(expr: &Expr, language: &str) -> String {
    match expr {
        Expr::Literal(value) => value.to_string(),
        Expr::Variable(name) => name.clone(),
        Expr::Call(name, args) => {
            if language == "JavaScript" || language == "Rust" {
                format!(
                    "{name}({})",
                    args.iter()
                        .map(|arg| expression_source(arg, language))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            } else {
                format!(
                    "({name}{})",
                    args.iter()
                        .map(|arg| format!(" ({})", expression_source(arg, language)))
                        .collect::<String>()
                )
            }
        }
        Expr::Choose(condition, yes, no) => {
            let test = expression_source(condition, language);
            let yes = expression_source(yes, language);
            let no = expression_source(no, language);
            match language {
                "JavaScript" => format!("({test} ? {yes} : {no})"),
                "Rust" => format!("(if {test} {{ {yes} }} else {{ {no} }})"),
                _ => format!("(if {test} then {yes} else {no})"),
            }
        }
        Expr::Binary(tag, left, right) => {
            let operator = match *tag {
                "add" => "+",
                "multiply" => "*",
                "less" => {
                    if language == "Rocq" {
                        "<?"
                    } else {
                        "<"
                    }
                }
                "less-equal" => {
                    if language == "Rocq" {
                        "<=?"
                    } else {
                        "<="
                    }
                }
                _ => match language {
                    "JavaScript" => "===",
                    "Rust" => "==",
                    "Lean" => "=",
                    _ => "=?",
                },
            };
            format!(
                "({} {operator} {})",
                expression_source(left, language),
                expression_source(right, language)
            )
        }
    }
}
/// Emit target-native syntax solely from the structured network. Numeric-domain assumptions remain explicit.
pub fn emit_portable_natural(
    network: &LinkNetwork,
    language: &str,
) -> Result<String, PortableError> {
    if !LANGUAGES.contains(&language) {
        return Err(unsupported(format!(
            "Unsupported target language {language}"
        )));
    }
    let functions = from_network(network)?;
    let by_name: BTreeMap<_, _> = functions
        .iter()
        .map(|function| (function.name.as_str(), function))
        .collect();
    fn order<'a>(
        function: &'a Function,
        by_name: &BTreeMap<&str, &'a Function>,
        done: &mut BTreeSet<String>,
        ordered: &mut Vec<&'a Function>,
    ) {
        if done.contains(&function.name) {
            return;
        }
        fn calls<'a>(
            expr: &Expr,
            by_name: &BTreeMap<&str, &'a Function>,
            done: &mut BTreeSet<String>,
            ordered: &mut Vec<&'a Function>,
        ) {
            match expr {
                Expr::Call(name, args) => {
                    order(by_name[name.as_str()], by_name, done, ordered);
                    for arg in args {
                        calls(arg, by_name, done, ordered);
                    }
                }
                Expr::Binary(_, left, right) => {
                    calls(left, by_name, done, ordered);
                    calls(right, by_name, done, ordered);
                }
                Expr::Choose(condition, yes, no) => {
                    calls(condition, by_name, done, ordered);
                    calls(yes, by_name, done, ordered);
                    calls(no, by_name, done, ordered);
                }
                _ => {}
            }
        }
        calls(&function.body, by_name, done, ordered);
        done.insert(function.name.clone());
        ordered.push(function);
    }
    let mut ordered = Vec::new();
    let mut done = BTreeSet::new();
    for function in &functions {
        order(function, &by_name, &mut done, &mut ordered);
    }
    let mut output = if language == "Rocq" {
        "Require Import Arith.\n".to_string()
    } else {
        String::new()
    };
    for function in ordered {
        let body = expression_source(&function.body, language);
        let text = match language {
            "JavaScript" => format!(
                "function {}({}) {{ return {body}; }}",
                function.name,
                function.parameters.join(", ")
            ),
            "Rust" => format!(
                "fn {}({}) -> u64 {{ {body} }}",
                function.name,
                function
                    .parameters
                    .iter()
                    .map(|name| format!("{name}: u64"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            _ => {
                let kind = if language == "Lean" { "Nat" } else { "nat" };
                let parameters = function
                    .parameters
                    .iter()
                    .map(|name| format!(" ({name} : {kind})"))
                    .collect::<String>();
                format!(
                    "{} {}{parameters} : {kind} := {body}{}",
                    if language == "Lean" {
                        "def"
                    } else {
                        "Definition"
                    },
                    function.name,
                    if language == "Rocq" { "." } else { "" }
                )
            }
        };
        output.push_str(&text);
        output.push('\n');
    }
    Ok(output)
}

pub fn portable_natural_contract() -> serde_json::Value {
    serde_json::json!({ "schema": "rml:portable-natural:1", "values": "natural numbers, 0 through 9007199254740991",
        "representations": { "JavaScript": "Number safe nonnegative integer, not BigInt", "Rust": "u64", "Lean": "Nat", "Rocq": "nat" },
        "observations": "return value of named pure functions on valid arguments",
        "assumptions": ["Every argument and arithmetic intermediate is an integer in the declared value range", "Functions are called in an environment without conflicting target declarations", "Resource exhaustion, stack limits, timing, and memory usage are outside the observations"],
        "preserves": ["function arity", "lexical parameter binding", "pure calls", "conditional branch selection", "natural-number results within bounds"],
        "excludes": ["effects", "modules", "ownership", "recursion", "proofs", "axioms", "universes", "full-language grammar"] })
}
#[derive(Debug)]
pub struct PortableTranslationReport {
    pub schema: &'static str,
    pub stages: serde_json::Value,
    pub status: &'static str,
    pub source_language: String,
    pub target_language: String,
    pub preserved_source: String,
    pub target_source: Option<String>,
    pub network: Option<LinkNetwork>,
    pub contract: serde_json::Value,
    pub obligations: serde_json::Value,
}
/// Translate the declared fragment; every unsupported construct preserves its complete source.
pub fn translate_portable_natural(
    source: &str,
    source_language: &str,
    target_language: &str,
) -> PortableTranslationReport {
    let result = parse_portable_natural(source, source_language).and_then(|network| {
        emit_portable_natural(&network, target_language).map(|text| (network, text))
    });
    let (status, network, target_source, obligations) = match result {
        Ok((network, text)) => (
            "translated-fragment",
            Some(network),
            Some(text),
            serde_json::json!([{ "code": "RML_PORTABLE_NUMERIC_DOMAIN", "status": "assumption", "description": "Every argument and arithmetic intermediate is an integer in the declared value range" }]),
        ),
        Err(error) => (
            "unsupported",
            None,
            None,
            serde_json::json!([{ "code": error.code, "stage": "portable-fragment", "description": error.message, "offset": error.offset }]),
        ),
    };
    PortableTranslationReport {
        schema: "rml:portable-natural:1",
        stages: if status == "translated-fragment" {
            serde_json::json!({
                "parsing": "portable-fragment", "resolution": "resolved-within-program",
                "elaboration": "natural-and-boolean-fragment", "execution": "not-run", "verification": "not-proved",
                "targetNativeValidation": "not-run", "equivalence": "structural-fragment-contract-not-formal-proof",
            })
        } else {
            serde_json::json!({ "parsing": "rejected", "resolution": "not-run", "elaboration": "not-run", "execution": "not-run", "verification": "not-proved" })
        },
        status,
        source_language: source_language.into(),
        target_language: target_language.into(),
        preserved_source: source.into(),
        target_source,
        network,
        contract: portable_natural_contract(),
        obligations,
    }
}

/// Execute the linked fragment under explicit numeric and finite-fuel bounds, without host eval.
pub fn evaluate_portable_natural(
    network: &LinkNetwork,
    name: &str,
    args: &[u64],
) -> Result<u64, PortableError> {
    let functions = from_network(network)?;
    let by_name: BTreeMap<_, _> = functions
        .iter()
        .map(|function| (function.name.as_str(), function))
        .collect();
    #[derive(Clone, Copy)]
    enum Value {
        Natural(u64),
        Boolean(bool),
    }
    impl Value {
        fn natural(self) -> Result<u64, PortableError> {
            match self {
                Self::Natural(value) => Ok(value),
                Self::Boolean(_) => Err(unsupported("Expected natural-number expression")),
            }
        }
    }
    fn step(fuel: &mut usize) -> Result<(), PortableError> {
        *fuel = fuel.checked_sub(1).ok_or_else(|| PortableError {
            code: "RML_PORTABLE_EXHAUSTED",
            message: "Portable evaluation fuel exhausted".into(),
            offset: 0,
        })?;
        Ok(())
    }
    fn call(
        name: &str,
        args: &[u64],
        by_name: &BTreeMap<&str, &Function>,
        fuel: &mut usize,
    ) -> Result<u64, PortableError> {
        step(fuel)?;
        let function = by_name
            .get(name)
            .ok_or_else(|| unsupported("Unknown function or wrong argument count"))?;
        if args.len() != function.parameters.len() {
            return Err(unsupported("Unknown function or wrong argument count"));
        }
        if args.iter().any(|value| *value > PORTABLE_NATURAL_MAX) {
            return Err(domain("Value outside the portable numeric domain"));
        }
        let environment: BTreeMap<_, _> = function
            .parameters
            .iter()
            .map(String::as_str)
            .zip(args.iter().copied())
            .collect();
        fn eval(
            expr: &Expr,
            environment: &BTreeMap<&str, u64>,
            by_name: &BTreeMap<&str, &Function>,
            fuel: &mut usize,
        ) -> Result<Value, PortableError> {
            step(fuel)?;
            match expr {
                Expr::Literal(value) => Ok(Value::Natural(*value)),
                Expr::Variable(name) => Ok(Value::Natural(environment[name.as_str()])),
                Expr::Call(name, args) => {
                    let args = args
                        .iter()
                        .map(|arg| eval(arg, environment, by_name, fuel)?.natural())
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(Value::Natural(call(name, &args, by_name, fuel)?))
                }
                Expr::Choose(condition, yes, no) => {
                    let Value::Boolean(condition) = eval(condition, environment, by_name, fuel)?
                    else {
                        return Err(unsupported("Conditional type mismatch"));
                    };
                    eval(if condition { yes } else { no }, environment, by_name, fuel)
                }
                Expr::Binary(tag, left, right) => {
                    let left = eval(left, environment, by_name, fuel)?.natural()?;
                    let right = eval(right, environment, by_name, fuel)?.natural()?;
                    let value = match *tag {
                        "less" => return Ok(Value::Boolean(left < right)),
                        "less-equal" => return Ok(Value::Boolean(left <= right)),
                        "equal" => return Ok(Value::Boolean(left == right)),
                        "add" => left.checked_add(right),
                        _ => left.checked_mul(right),
                    };
                    value
                        .filter(|value| *value <= PORTABLE_NATURAL_MAX)
                        .map(Value::Natural)
                        .ok_or_else(|| domain("Value outside the portable numeric domain"))
                }
            }
        }
        eval(&function.body, &environment, by_name, fuel)?.natural()
    }
    call(name, args, &by_name, &mut 100_000)
}
