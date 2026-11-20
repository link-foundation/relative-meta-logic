//! Native linked execution of the pinned upstream meta-theory corpus.
//!
//! Mirrors the runtime-facing part of `js/src/rml-meta-theory-native.mjs`.
//! The shared generator (scripts/generate-meta-theory-native.mjs) elaborates
//! preserved declaration tokens into `lib/meta-theory/upstream-0.0.3-native.lino`;
//! this module loads that program with the call-by-value prelude, executes
//! terms on the generic linked reducer, compacts canonical binary naturals for
//! fixtures, slices the program to static closures and classifies ablations.
//! Nothing here names a corpus declaration.
use crate::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use crate::Node;
use std::collections::{BTreeMap, BTreeSet};

pub const META_THEORY_NATIVE_PROGRAM: &str = "upstream-0.0.3-native";
pub const META_THEORY_CONVERSION_PROGRAM: &str = "upstream-0.0.3-native-conversion";
pub const NATIVE_COMMAND_SECTION: &str = "commands";
pub const NATIVE_MAX_STEPS: usize = 200_000;

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

/// Canonical little-endian binary natural: mt-zero, (mt-b0 N) or (mt-b1 N).
pub fn binary_natural(mut number: u64) -> Node {
    let mut bits = Vec::new();
    while number > 0 {
        bits.push(if number % 2 == 1 { "mt-b1" } else { "mt-b0" });
        number /= 2;
    }
    bits.iter()
        .rev()
        .fold(leaf("mt-zero"), |inner, bit| Node::List(vec![leaf(bit), inner]))
}

/// The number denoted by a canonical binary natural link.
pub fn natural_value(term: &Node) -> Option<u64> {
    match term {
        Node::Leaf(text) if text == "mt-zero" => Some(0),
        Node::List(items) => match items.as_slice() {
            [Node::Leaf(bit), inner] if bit == "mt-b0" || bit == "mt-b1" => {
                let half = natural_value(inner)?;
                if bit == "mt-b0" && half == 0 {
                    return None;
                }
                half.checked_mul(2)?.checked_add(u64::from(bit == "mt-b1"))
            }
            _ => None,
        },
        Node::Leaf(_) => None,
    }
}

/// Shared JSON transport: every nonzero binary natural becomes (mt-natural DECIMAL).
pub fn compact_native(term: &Node) -> Node {
    if let Node::List(items) = term {
        if let Some(number) = natural_value(term) {
            return Node::List(vec![leaf("mt-natural"), Node::Leaf(number.to_string())]);
        }
        return Node::List(items.iter().map(compact_native).collect());
    }
    term.clone()
}

/// Inverse of `compact_native`: (mt-natural N) back to a binary natural link.
pub fn expand_native(term: &Node) -> Node {
    match term {
        Node::List(items) => match items.as_slice() {
            [Node::Leaf(tag), Node::Leaf(number)] if tag == "mt-natural" => {
                binary_natural(number.parse().unwrap_or(0))
            }
            _ => Node::List(items.iter().map(expand_native).collect()),
        },
        Node::Leaf(_) => term.clone(),
    }
}

fn is_raw(term: &Node) -> bool {
    match term {
        Node::Leaf(text) => text != "mt-v",
        Node::List(items) => {
            !items.is_empty()
                && !matches!(&items[0], Node::Leaf(text) if text == "mt-v")
                && items.iter().all(is_raw)
        }
    }
}

/// A finished value: the tagged link (mt-v RAW) whose RAW contains no tag.
pub fn is_native_value(term: &Node) -> bool {
    matches!(term, Node::List(items) if items.len() == 2
        && matches!(&items[0], Node::Leaf(tag) if tag == "mt-v")
        && is_raw(&items[1]))
}

/// Load the prelude and a (possibly sliced) native program on the direct reducer.
pub fn native_registry(prelude: &str, program: &str) -> Result<LinkedProgramRegistry, String> {
    LinkedProgramRegistry::from_rml_with_basis(&format!("{prelude}\n{program}"), ExecutionBasis::DirectStructural, &[])
}

fn section_header(section: &str) -> &str {
    let line = section.split('\n').next().unwrap_or("");
    line.strip_prefix("# ").unwrap_or("")
}

/// The generated program restricted to the given declaration sections plus
/// the shared command section. Removing one address ablates its rules.
pub fn slice_native_program(program: &str, addresses: &[String]) -> String {
    let keep: BTreeSet<&str> = addresses
        .iter()
        .map(String::as_str)
        .chain([NATIVE_COMMAND_SECTION])
        .collect();
    let kept: Vec<&str> = program
        .trim_end()
        .split("\n\n")
        .filter(|section| {
            !section.starts_with("# ")
                || section.starts_with("# Generated")
                || keep.contains(section_header(section))
        })
        .collect();
    format!("{}\n", kept.join("\n\n"))
}

/// Declarations reachable from `roots` through recorded references.
pub fn native_closure(references: &BTreeMap<String, Vec<String>>, roots: &[String]) -> BTreeSet<String> {
    let mut reached = BTreeSet::new();
    let mut pending: Vec<String> = roots.to_vec();
    while let Some(address) = pending.pop() {
        let Some(next) = references.get(&address) else { continue };
        if !reached.insert(address.clone()) {
            continue;
        }
        pending.extend(next.iter().cloned());
    }
    reached
}

/// The outcome of a bounded native execution; reduction failures are outcomes.
#[derive(Debug, Clone, PartialEq)]
pub struct NativeOutcome {
    pub term: Option<Node>,
    pub steps: usize,
}

impl NativeOutcome {
    pub fn value(&self) -> bool {
        self.term.as_ref().is_some_and(is_native_value)
    }
}

pub fn execute_native(registry: &LinkedProgramRegistry, term: &Node) -> NativeOutcome {
    match registry.reduce_result(META_THEORY_NATIVE_PROGRAM, term, NATIVE_MAX_STEPS) {
        Ok(summary) => NativeOutcome { term: Some(summary.term), steps: summary.steps },
        Err(_) => NativeOutcome { term: None, steps: 0 },
    }
}

/// Whether an ablated outcome still reaches the recorded (compacted) value.
pub fn ablation_outcome(expected: &Node, outcome: &NativeOutcome) -> &'static str {
    match &outcome.term {
        None => "failure",
        Some(_) if !outcome.value() => "stuck",
        Some(term) if &compact_native(term) == expected => "unchanged",
        Some(_) => "different-value",
    }
}

/// Source-like rendering of naturals, lists, pairs, options and Booleans.
pub fn render_native_value(term: &Node, language: &str) -> String {
    if let Node::List(items) = term {
        if items.len() == 2 && items[0] == leaf("mt-v") {
            return render_native_value(&items[1], language);
        }
    }
    if let Some(number) = natural_value(term) {
        return number.to_string();
    }
    match term {
        Node::Leaf(text) => match text.as_str() {
            "mt-nil" => "[]".to_string(),
            "mt-true" => "true".to_string(),
            "mt-false" => "false".to_string(),
            "mt-none" => (if language == "lean" { "none" } else { "None" }).to_string(),
            other => other.to_string(),
        },
        Node::List(items) => match items.first() {
            Some(Node::Leaf(tag)) if tag == "mt-cons" => {
                let mut rendered = Vec::new();
                let mut current = term;
                while let Node::List(cell) = current {
                    if cell.len() != 3 || cell[0] != leaf("mt-cons") {
                        break;
                    }
                    rendered.push(render_native_value(&cell[1], language));
                    current = &cell[2];
                }
                if current != &leaf("mt-nil") {
                    return format!("({} :: {})", rendered.join(" :: "), render_native_value(current, language));
                }
                format!("[{}]", rendered.join(if language == "lean" { ", " } else { "; " }))
            }
            Some(Node::Leaf(tag)) if tag == "mt-pair" && items.len() == 3 => format!(
                "({}, {})",
                render_native_value(&items[1], language),
                render_native_value(&items[2], language)
            ),
            Some(Node::Leaf(tag)) if tag == "mt-some" && items.len() == 2 => format!(
                "{} {}",
                if language == "lean" { "some" } else { "Some" },
                render_native_value(&items[1], language)
            ),
            _ => term.to_string(),
        },
    }
}
