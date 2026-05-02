// rml-check — independent proof-replay checker (issue #36).
//
// Verifies that a derivation produced by the proof-producing evaluator
// (issue #35) replays under the kernel alone — no evaluator. Each
// `(by <rule> <sub>...)` node is matched against the kernel's structural
// shape for its expression: rule name, arity, and that sub-derivations
// recurse onto matching sub-expressions. Mutating any of those rejects.

use crate::{is_num, is_structurally_same, key_of, parse_lino, parse_one, tokenize_one, Node};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq)]
pub struct CheckOk {
    pub rule: String,
    pub expr: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CheckError {
    pub path: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CheckResult {
    pub ok: Vec<CheckOk>,
    pub errors: Vec<CheckError>,
}

impl CheckResult {
    pub fn is_ok(&self) -> bool {
        self.errors.is_empty()
    }
}

// Built-in operator names plus user-declared `(name: ...)` heads. Used to
// validate the prefix-operator fallback rule. Mirrors the names recognised
// by `Env::new()` so the checker can validate proofs without an env.
fn collect_operators(forms: &[Node]) -> HashSet<String> {
    let mut ops: HashSet<String> = ["not", "and", "or", "=", "!=", "+", "-", "*", "/"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    for f in forms {
        if let Node::List(c) = f {
            if let Some(Node::Leaf(s)) = c.first() {
                if let Some(name) = s.strip_suffix(':') {
                    if !name.is_empty() {
                        ops.insert(name.to_string());
                    }
                }
            }
        }
    }
    ops
}

// Equality keys (both prefix and infix shapes) that the program assigned a
// probability to. Used by `expected_rule` to know whether `assigned-*`
// rules are admissible at a given equality node.
fn collect_assignments(forms: &[Node]) -> HashSet<String> {
    let mut out = HashSet::new();
    for f in forms {
        if let Node::List(c) = f {
            if c.len() == 4 {
                if let (Node::Leaf(w1), Node::Leaf(w2), Node::Leaf(w3)) = (&c[1], &c[2], &c[3]) {
                    if w1 == "has" && w2 == "probability" && is_num(w3) {
                        if let Node::List(inner) = &c[0] {
                            out.insert(key_of(&c[0]));
                            if inner.len() == 3 {
                                if let Node::Leaf(op) = &inner[1] {
                                    if op == "=" {
                                        out.insert(key_of(&Node::List(vec![
                                            Node::Leaf("=".into()),
                                            inner[0].clone(),
                                            inner[2].clone(),
                                        ])));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

// Parse a `.lino` source into top-level forms via the kernel parser.
fn parse_forms(src: &str) -> Vec<Node> {
    parse_lino(src)
        .into_iter()
        .filter(|s| !s.trim_start().starts_with("(#"))
        .filter_map(|s| parse_one(&tokenize_one(&s)).ok())
        .collect()
}

// Strip `(? expr)` wrappers and the optional `with proof` keyword pair.
fn query_target(n: &Node) -> Option<Node> {
    if let Node::List(c) = n {
        if let Some(Node::Leaf(h)) = c.first() {
            if h == "?" {
                let parts: Vec<Node> = c[1..].to_vec();
                let parts = if parts.len() >= 2 {
                    if let (Node::Leaf(a), Node::Leaf(b)) =
                        (&parts[parts.len() - 2], &parts[parts.len() - 1])
                    {
                        if a == "with" && b == "proof" {
                            parts[..parts.len() - 2].to_vec()
                        } else {
                            parts
                        }
                    } else {
                        parts
                    }
                } else {
                    parts
                };
                return Some(if parts.len() == 1 {
                    parts[0].clone()
                } else {
                    Node::List(parts)
                });
            }
        }
    }
    None
}

// Decompose `(by <rule> <sub>...)` or fail with a descriptive error.
fn decode<'a>(p: &'a Node, path: &[String]) -> Result<(String, &'a [Node]), CheckError> {
    if let Node::List(c) = p {
        if c.len() >= 2 {
            if let (Node::Leaf(by), Node::Leaf(rule)) = (&c[0], &c[1]) {
                if by == "by" {
                    return Ok((rule.clone(), &c[2..]));
                }
            }
        }
    }
    Err(CheckError {
        path: path.to_vec(),
        message: format!("expected `(by <rule> ...)`, got `{}`", key_of(p)),
    })
}

// The single rule the kernel would emit for `expr`. Equality is the only
// shape with multiple admissible rules (assigned/structural/numeric); we
// pick the unique one matching the program facts.
fn expected_rule(expr: &Node, ops: &HashSet<String>, assigned: &HashSet<String>) -> &'static str {
    match expr {
        Node::Leaf(s) => {
            if is_num(s) {
                "literal"
            } else {
                "symbol"
            }
        }
        Node::List(c) => {
            if let Some(Node::Leaf(h)) = c.first() {
                if h.ends_with(':') {
                    return "definition";
                }
                match h.as_str() {
                    "Type" if c.len() == 2 => return "type-universe",
                    "Prop" if c.len() == 1 => return "prop",
                    "Pi" if c.len() == 3 => return "pi-formation",
                    "lambda" if c.len() == 3 => return "lambda-formation",
                    "apply" if c.len() == 3 => return "beta-reduction",
                    "subst" if c.len() == 4 => return "substitution",
                    "fresh" if c.len() == 4 => {
                        if let Node::Leaf(in_kw) = &c[2] {
                            if in_kw == "in" {
                                return "fresh";
                            }
                        }
                    }
                    "type" if c.len() == 3 => {
                        if let Node::Leaf(of) = &c[1] {
                            if of == "of" {
                                return "type-query";
                            }
                        }
                    }
                    _ => {}
                }
            }
            // ((expr) has probability p)
            if c.len() == 4 {
                if let (Node::Leaf(w1), Node::Leaf(w2), Node::Leaf(w3)) = (&c[1], &c[2], &c[3]) {
                    if w1 == "has" && w2 == "probability" && is_num(w3) {
                        return "assigned-probability";
                    }
                }
            }
            // (range lo hi) / (valence N)
            if c.len() == 3 {
                if let (Node::Leaf(h), Node::Leaf(a), Node::Leaf(b)) = (&c[0], &c[1], &c[2]) {
                    if h == "range" && is_num(a) && is_num(b) {
                        return "configuration";
                    }
                }
            }
            if c.len() == 2 {
                if let (Node::Leaf(h), Node::Leaf(v)) = (&c[0], &c[1]) {
                    if h == "valence" && is_num(v) {
                        return "configuration";
                    }
                }
            }
            // (L op R) infix.
            if c.len() == 3 {
                if let Node::Leaf(op) = &c[1] {
                    return match op.as_str() {
                        "+" => "sum",
                        "-" => "difference",
                        "*" => "product",
                        "/" => "quotient",
                        "and" => "and",
                        "or" => "or",
                        "both" => "both",
                        "neither" => "neither",
                        "of" => "type-check",
                        "=" | "!=" => {
                            let l = &c[0];
                            let r = &c[2];
                            let kp = key_of(&Node::List(vec![
                                Node::Leaf("=".into()),
                                l.clone(),
                                r.clone(),
                            ]));
                            let ki = key_of(&Node::List(vec![
                                l.clone(),
                                Node::Leaf("=".into()),
                                r.clone(),
                            ]));
                            let assigned = assigned.contains(&kp) || assigned.contains(&ki);
                            if op == "!=" {
                                if assigned {
                                    "assigned-inequality"
                                } else if is_structurally_same(l, r) {
                                    "structural-inequality"
                                } else {
                                    "numeric-inequality"
                                }
                            } else if assigned {
                                "assigned-equality"
                            } else if is_structurally_same(l, r) {
                                "structural-equality"
                            } else {
                                "numeric-equality"
                            }
                        }
                        _ => fallback_prefix(c, ops),
                    };
                }
            }
            // Composite (both A and B [...]) / (neither A nor B [...]).
            if c.len() >= 4 && c.len() % 2 == 0 {
                if let Node::Leaf(h) = &c[0] {
                    if h == "both" {
                        return "both";
                    }
                    if h == "neither" {
                        return "neither";
                    }
                }
            }
            fallback_prefix(c, ops)
        }
    }
}

fn fallback_prefix(c: &[Node], ops: &HashSet<String>) -> &'static str {
    if let Some(Node::Leaf(h)) = c.first() {
        if ops.contains(h) {
            return prefix_marker(h);
        }
    }
    "reduce"
}

// Stable static slice for prefix-op rule names: the rule string is the op
// name itself, so we look it up via `prefix_marker` to keep the return
// type `&'static str`. Any unrecognised name falls back to `reduce`.
fn prefix_marker(name: &str) -> &'static str {
    match name {
        "not" => "not",
        "and" => "and",
        "or" => "or",
        "+" => "sum",
        "-" => "difference",
        "*" => "product",
        "/" => "quotient",
        // User-declared / less common prefix ops: report `reduce` so the
        // checker's structural validator handles them via the prefix path.
        _ => "reduce",
    }
}

// Walk both trees in lockstep and verify each level matches.
fn check_node(
    expr: &Node,
    proof: &Node,
    ops: &HashSet<String>,
    assigned: &HashSet<String>,
    path: &[String],
) -> Result<String, CheckError> {
    let (rule, subs) = decode(proof, path)?;
    let exp = expected_rule(expr, ops, assigned);
    // For prefix-applied operators the kernel writes the op name itself
    // (e.g. `not`, `and`, custom `myop`); accept either the marker we
    // returned or the matching head leaf when expr is a prefix call.
    let rule_ok = rule == exp || prefix_match(&rule, expr, ops);
    if !rule_ok {
        return Err(err(
            path,
            format!(
                "rule `{}` does not justify `{}` (expected `{}`)",
                rule,
                key_of(expr),
                exp
            ),
        ));
    }
    let mut next_path = path.to_vec();
    next_path.push(format!("{}", rule));
    match rule.as_str() {
        // Leaves
        "literal" => arity(&rule, subs, 1, path).and_then(|_| match (&subs[0], expr) {
            (Node::Leaf(n), Node::Leaf(en)) if is_num(n) && n == en => Ok(rule),
            _ => Err(err(
                path,
                format!("literal `{}` ≠ `{}`", key_of(&subs[0]), key_of(expr)),
            )),
        }),
        "symbol" => arity(&rule, subs, 1, path).and_then(|_| match (&subs[0], expr) {
            (Node::Leaf(s), Node::Leaf(es)) if s == es => Ok(rule),
            _ => Err(err(
                path,
                format!("symbol `{}` ≠ `{}`", key_of(&subs[0]), key_of(expr)),
            )),
        }),
        // Top-level leaf-like forms carry payloads that must match the
        // expression exactly, even though there are no sub-derivations.
        "definition" => check_payload(&rule, subs, &[expr.clone()], path),
        "configuration" => check_configuration(expr, &rule, subs, path),
        "assigned-probability" => check_assigned_probability(expr, &rule, subs, path),
        "query" => Err(err(path, "stray `query` rule (stripped by checker)".into())),
        "reduce" => check_payload(&rule, subs, &[expr.clone()], path),
        // Infix arithmetic
        "sum" | "difference" | "product" | "quotient" => {
            let op = match rule.as_str() {
                "sum" => "+",
                "difference" => "-",
                "product" => "*",
                "quotient" => "/",
                _ => unreachable!(),
            };
            check_infix(expr, &rule, subs, op, ops, assigned, &next_path, path)
        }
        // Logic — binary infix or composite chain
        "and" | "or" | "both" | "neither" => {
            check_logic(expr, &rule, subs, ops, assigned, &next_path, path)
        }
        // Unary not. Composite chains for `not` aren't a thing; only (not X).
        "not" => arity(&rule, subs, 1, path).and_then(|_| match expr {
            Node::List(c) if c.len() == 2 => match &c[0] {
                Node::Leaf(h) if h == "not" => {
                    check_node(&c[1], &subs[0], ops, assigned, &next_path).map(|_| rule.clone())
                }
                _ => Err(err(path, format!("`not` ≠ `{}`", key_of(expr)))),
            },
            _ => Err(err(path, format!("`not` ≠ `{}`", key_of(expr)))),
        }),
        // Equality / inequality
        "structural-equality"
        | "numeric-equality"
        | "assigned-equality"
        | "structural-inequality"
        | "numeric-inequality"
        | "assigned-inequality" => check_eq(expr, &rule, subs, ops, assigned, path),
        // Type-system witnesses
        "type-universe" | "prop" | "pi-formation" | "lambda-formation" | "type-query"
        | "type-check" | "substitution" | "fresh" => check_typesys(expr, &rule, subs, path),
        "beta-reduction" => arity(&rule, subs, 2, path).and_then(|_| match expr {
            Node::List(c) if c.len() == 3 => match &c[0] {
                Node::Leaf(h) if h == "apply" => {
                    check_node(&c[1], &subs[0], ops, assigned, &next_path)?;
                    check_node(&c[2], &subs[1], ops, assigned, &next_path)?;
                    Ok(rule.clone())
                }
                _ => Err(err(path, format!("`beta-reduction` ≠ `{}`", key_of(expr)))),
            },
            _ => Err(err(path, format!("`beta-reduction` ≠ `{}`", key_of(expr)))),
        }),
        // Prefix operator named after the rule.
        _ => check_prefix(expr, &rule, subs, ops, assigned, &next_path, path),
    }
}

fn err(path: &[String], message: String) -> CheckError {
    CheckError {
        path: path.to_vec(),
        message,
    }
}

fn arity(rule: &str, subs: &[Node], n: usize, path: &[String]) -> Result<(), CheckError> {
    if subs.len() == n {
        Ok(())
    } else {
        Err(err(
            path,
            format!("rule `{}` expects {} sub(s), got {}", rule, n, subs.len()),
        ))
    }
}

fn check_payload(
    rule: &str,
    subs: &[Node],
    expected: &[Node],
    path: &[String],
) -> Result<String, CheckError> {
    arity(rule, subs, expected.len(), path)?;
    for (i, want) in expected.iter().enumerate() {
        if !is_structurally_same(&subs[i], want) {
            return Err(err(
                path,
                format!("payload {} `{}` ≠ `{}`", i, key_of(&subs[i]), key_of(want)),
            ));
        }
    }
    Ok(rule.into())
}

fn check_configuration(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    path: &[String],
) -> Result<String, CheckError> {
    match expr {
        Node::List(c) if c.len() == 3 => match (&c[0], &c[1], &c[2]) {
            (Node::Leaf(h), lo, hi) if h == "range" => check_payload(
                rule,
                subs,
                &[Node::Leaf("range".into()), lo.clone(), hi.clone()],
                path,
            ),
            _ => Err(err(path, format!("`{}` ≠ `{}`", rule, key_of(expr)))),
        },
        Node::List(c) if c.len() == 2 => match (&c[0], &c[1]) {
            (Node::Leaf(h), v) if h == "valence" => {
                check_payload(rule, subs, &[Node::Leaf("valence".into()), v.clone()], path)
            }
            _ => Err(err(path, format!("`{}` ≠ `{}`", rule, key_of(expr)))),
        },
        _ => Err(err(path, format!("`{}` ≠ `{}`", rule, key_of(expr)))),
    }
}

fn check_assigned_probability(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    path: &[String],
) -> Result<String, CheckError> {
    if let Node::List(c) = expr {
        if c.len() == 4 {
            if let (Node::Leaf(w1), Node::Leaf(w2)) = (&c[1], &c[2]) {
                if w1 == "has" && w2 == "probability" {
                    return check_payload(rule, subs, &[c[0].clone(), c[3].clone()], path);
                }
            }
        }
    }
    Err(err(path, format!("`{}` ≠ `{}`", rule, key_of(expr))))
}

// True when `rule` is the bare name of a prefix operator applied at expr.
fn prefix_match(rule: &str, expr: &Node, ops: &HashSet<String>) -> bool {
    if !ops.contains(rule) {
        return false;
    }
    if let Node::List(c) = expr {
        if let Some(Node::Leaf(h)) = c.first() {
            return h == rule;
        }
    }
    false
}

fn check_infix(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    op: &str,
    ops: &HashSet<String>,
    assigned: &HashSet<String>,
    next_path: &[String],
    path: &[String],
) -> Result<String, CheckError> {
    arity(rule, subs, 2, path)?;
    if let Node::List(c) = expr {
        if c.len() == 3 {
            if let Node::Leaf(o) = &c[1] {
                if o == op {
                    check_node(&c[0], &subs[0], ops, assigned, next_path)?;
                    check_node(&c[2], &subs[1], ops, assigned, next_path)?;
                    return Ok(rule.into());
                }
            }
        }
    }
    Err(err(path, format!("rule `{}` ≠ `{}`", rule, key_of(expr))))
}

fn check_logic(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    ops: &HashSet<String>,
    assigned: &HashSet<String>,
    next_path: &[String],
    path: &[String],
) -> Result<String, CheckError> {
    if let Node::List(c) = expr {
        // Binary infix.
        if c.len() == 3 {
            if let Node::Leaf(o) = &c[1] {
                if o == rule {
                    arity(rule, subs, 2, path)?;
                    check_node(&c[0], &subs[0], ops, assigned, next_path)?;
                    check_node(&c[2], &subs[1], ops, assigned, next_path)?;
                    return Ok(rule.into());
                }
            }
        }
        // Composite chain.
        if (rule == "both" || rule == "neither") && c.len() >= 4 && c.len() % 2 == 0 {
            if let Node::Leaf(h) = &c[0] {
                if h == rule {
                    let sep = if rule == "both" { "and" } else { "nor" };
                    for i in (2..c.len()).step_by(2) {
                        if let Node::Leaf(s) = &c[i] {
                            if s != sep {
                                return Err(err(
                                    path,
                                    format!("composite `{}` separator must be `{}`", rule, sep),
                                ));
                            }
                        } else {
                            return Err(err(
                                path,
                                format!("composite `{}` separator must be `{}`", rule, sep),
                            ));
                        }
                    }
                    let n = c.len() / 2;
                    arity(rule, subs, n, path)?;
                    for (j, sub) in subs.iter().enumerate() {
                        check_node(&c[1 + j * 2], sub, ops, assigned, next_path)?;
                    }
                    return Ok(rule.into());
                }
            }
        }
    }
    Err(err(path, format!("rule `{}` ≠ `{}`", rule, key_of(expr))))
}

fn check_eq(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    ops: &HashSet<String>,
    assigned: &HashSet<String>,
    path: &[String],
) -> Result<String, CheckError> {
    arity(rule, subs, 1, path)?;
    let pair = match &subs[0] {
        Node::List(p) if p.len() == 2 => p,
        _ => return Err(err(path, format!("`{}` expects `(L R)` sub", rule))),
    };
    if let Node::List(c) = expr {
        if c.len() == 3 {
            if let Node::Leaf(op) = &c[1] {
                if op == "=" || op == "!=" {
                    if !is_structurally_same(&c[0], &pair[0])
                        || !is_structurally_same(&c[2], &pair[1])
                    {
                        return Err(err(
                            path,
                            format!(
                                "operands `{} {}` ≠ `{} {}`",
                                key_of(&pair[0]),
                                key_of(&pair[1]),
                                key_of(&c[0]),
                                key_of(&c[2])
                            ),
                        ));
                    }
                    let exp = expected_rule(expr, ops, assigned);
                    if exp == rule {
                        return Ok(rule.into());
                    }
                    return Err(err(path, format!("rule `{}` ≠ expected `{}`", rule, exp)));
                }
            }
        }
    }
    Err(err(path, format!("rule `{}` ≠ `{}`", rule, key_of(expr))))
}

fn check_typesys(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    path: &[String],
) -> Result<String, CheckError> {
    let bad = |reason: &str| {
        Err(err(
            path,
            format!("`{}` ≠ `{}` ({})", rule, key_of(expr), reason),
        ))
    };
    if let Node::List(c) = expr {
        match (rule, c.len()) {
            ("type-universe", 2) => {
                arity(rule, subs, 1, path)?;
                if let Node::Leaf(h) = &c[0] {
                    if h == "Type" && is_structurally_same(&c[1], &subs[0]) {
                        return Ok(rule.into());
                    }
                }
                return bad("Type level mismatch");
            }
            ("prop", 1) => {
                arity(rule, subs, 0, path)?;
                if let Node::Leaf(h) = &c[0] {
                    if h == "Prop" {
                        return Ok(rule.into());
                    }
                }
                return bad("Prop head mismatch");
            }
            ("pi-formation", 3) | ("lambda-formation", 3) => {
                arity(rule, subs, 2, path)?;
                let head = if rule == "pi-formation" {
                    "Pi"
                } else {
                    "lambda"
                };
                if let Node::Leaf(h) = &c[0] {
                    if h == head
                        && is_structurally_same(&c[1], &subs[0])
                        && is_structurally_same(&c[2], &subs[1])
                    {
                        return Ok(rule.into());
                    }
                }
                return bad("binder mismatch");
            }
            ("type-query", 3) => {
                arity(rule, subs, 1, path)?;
                if let (Node::Leaf(h), Node::Leaf(of)) = (&c[0], &c[1]) {
                    if h == "type" && of == "of" && is_structurally_same(&c[2], &subs[0]) {
                        return Ok(rule.into());
                    }
                }
                return bad("type-query mismatch");
            }
            ("type-check", 3) => {
                arity(rule, subs, 2, path)?;
                if let Node::Leaf(of) = &c[1] {
                    if of == "of"
                        && is_structurally_same(&c[0], &subs[0])
                        && is_structurally_same(&c[2], &subs[1])
                    {
                        return Ok(rule.into());
                    }
                }
                return bad("type-check mismatch");
            }
            ("substitution", 4) => {
                arity(rule, subs, 3, path)?;
                if let Node::Leaf(h) = &c[0] {
                    if h == "subst"
                        && is_structurally_same(&c[1], &subs[0])
                        && is_structurally_same(&c[2], &subs[1])
                        && is_structurally_same(&c[3], &subs[2])
                    {
                        return Ok(rule.into());
                    }
                }
                return bad("substitution mismatch");
            }
            ("fresh", 4) => {
                arity(rule, subs, 2, path)?;
                if let (Node::Leaf(h), Node::Leaf(in_kw)) = (&c[0], &c[2]) {
                    if h == "fresh"
                        && in_kw == "in"
                        && is_structurally_same(&c[1], &subs[0])
                        && is_structurally_same(&c[3], &subs[1])
                    {
                        return Ok(rule.into());
                    }
                }
                return bad("fresh mismatch");
            }
            _ => {}
        }
    }
    bad("shape mismatch")
}

fn check_prefix(
    expr: &Node,
    rule: &str,
    subs: &[Node],
    ops: &HashSet<String>,
    assigned: &HashSet<String>,
    next_path: &[String],
    path: &[String],
) -> Result<String, CheckError> {
    if let Node::List(c) = expr {
        if let Some(Node::Leaf(h)) = c.first() {
            if h == rule && ops.contains(rule) {
                arity(rule, subs, c.len() - 1, path)?;
                for (i, sub) in subs.iter().enumerate() {
                    check_node(&c[1 + i], sub, ops, assigned, next_path)?;
                }
                return Ok(rule.into());
            }
        }
    }
    Err(err(
        path,
        format!("unknown rule `{}` for `{}`", rule, key_of(expr)),
    ))
}

/// Public entry point: parse both `.lino` sources, pair queries with
/// derivations 1:1, and verify each pair structurally. Returns a
/// `CheckResult` with one `CheckOk` per replayed derivation or a list of
/// `CheckError`s describing the first divergence per query.
pub fn check_program(program_src: &str, proofs_src: &str) -> CheckResult {
    let program_forms = parse_forms(program_src);
    let proof_forms = parse_forms(proofs_src);
    let queries: Vec<Node> = program_forms.iter().filter_map(query_target).collect();
    let ops = collect_operators(&program_forms);
    let assigned = collect_assignments(&program_forms);
    let mut result = CheckResult::default();
    if queries.len() != proof_forms.len() {
        result.errors.push(CheckError {
            path: vec![],
            message: format!(
                "expected {} derivation(s), got {}",
                queries.len(),
                proof_forms.len()
            ),
        });
        return result;
    }
    for (i, (q, p)) in queries.iter().zip(proof_forms.iter()).enumerate() {
        let path = vec![format!("query[{}]", i)];
        match check_node(q, p, &ops, &assigned, &path) {
            Ok(rule) => result.ok.push(CheckOk {
                rule,
                expr: key_of(q),
            }),
            Err(e) => result.errors.push(e),
        }
    }
    result
}

#[cfg(test)]
mod sanity {
    // Real coverage in `rust/tests/check_tests.rs`. These confirm the
    // checker compiles against the kernel without pulling the evaluator.
    use super::*;

    #[test]
    fn smoke_structural_equality() {
        assert!(
            check_program("(a: a is a)\n(? (a = a))", "(by structural-equality (a a))").is_ok()
        );
    }

    #[test]
    fn smoke_mutated_rule_fails() {
        assert!(!check_program("(a: a is a)\n(? (a = a))", "(by numeric-equality (a a))").is_ok());
    }
}
