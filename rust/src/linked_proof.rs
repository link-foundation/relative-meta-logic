//! Data-only adapter for `lib/meta-theory/proof-verifier.lino`.
//!
//! The existing generic reducer executes every proof-specific decision as a
//! linked rule. This module quotes data, records the execution, and independently
//! replays it. Callers supply their authoritative context and goal on both paths.

use crate::linked_program::{LinkedProgramRegistry, RewriteTraceStep};
use crate::Node;

pub const LINKED_PROOF_PROGRAM: &str = "linked-proof-verifier";
pub const LINKED_PROOF_SCHEMA: &str = "rml-linked-proof-replay/v1";

fn leaf(value: &str) -> Node {
    Node::Leaf(value.to_string())
}
fn list(values: Vec<Node>) -> Node {
    Node::List(values)
}

/// Hard recursion ceiling for the host representation adapter, not a proof rule.
pub const MAX_LINKED_PROOF_DEPTH: usize = 256;

/// External representation limits. Nodes count the unfolded tree, even when a
/// source language can share subtrees. Text is counted as UTF-8 bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProofLimits {
    pub max_depth: usize,
    pub max_nodes: usize,
    pub max_text_bytes: usize,
}
impl Default for LinkedProofLimits {
    fn default() -> Self {
        Self {
            max_depth: 128,
            max_nodes: 10_000,
            max_text_bytes: 1_048_576,
        }
    }
}
impl LinkedProofLimits {
    /// Replay traces repeat intermediate terms, so they have a separate budget.
    pub fn for_receipt() -> Self {
        Self {
            max_depth: 256,
            max_nodes: 1_000_000,
            max_text_bytes: 16_777_216,
        }
    }
}
struct Budget<'a> {
    limits: &'a LinkedProofLimits,
    nodes: usize,
    text_bytes: usize,
}
impl<'a> Budget<'a> {
    fn new(limits: &'a LinkedProofLimits) -> Result<Self, String> {
        if limits.max_depth == 0
            || limits.max_depth > MAX_LINKED_PROOF_DEPTH
            || limits.max_nodes == 0
            || limits.max_text_bytes == 0
        {
            return Err(format!("linked proof limits must be positive, with max depth at most {MAX_LINKED_PROOF_DEPTH}"));
        }
        Ok(Self {
            limits,
            nodes: 0,
            text_bytes: 0,
        })
    }
    fn visit(&mut self, depth: usize, text: Option<&str>) -> Result<(), String> {
        if depth > self.limits.max_depth {
            return Err(format!(
                "linked proof depth limit {} exceeded",
                self.limits.max_depth
            ));
        }
        self.nodes = self
            .nodes
            .checked_add(1)
            .ok_or("linked proof node count overflow")?;
        if self.nodes > self.limits.max_nodes {
            return Err(format!(
                "linked proof node limit {} exceeded",
                self.limits.max_nodes
            ));
        }
        if let Some(text) = text {
            if text.is_empty() {
                return Err("proof data leaves must be nonempty strings".to_string());
            }
            self.text_bytes = self
                .text_bytes
                .checked_add(text.len())
                .ok_or("linked proof text byte count overflow")?;
            if self.text_bytes > self.limits.max_text_bytes {
                return Err(format!(
                    "linked proof text byte limit {} exceeded",
                    self.limits.max_text_bytes
                ));
            }
        }
        Ok(())
    }
}

fn encode(value: &Node, budget: &mut Budget<'_>, depth: usize) -> Result<Node, String> {
    match value {
        Node::Leaf(value) => {
            budget.visit(depth, Some(value))?;
            Ok(list(vec![leaf("atom"), leaf(value)]))
        }
        Node::List(values) => {
            budget.visit(depth, None)?;
            let mut tail = list(vec![leaf("list-end")]);
            for (index, value) in values.iter().enumerate().rev() {
                tail = list(vec![
                    leaf("pair"),
                    encode(value, budget, depth + index + 1)?,
                    tail,
                ]);
            }
            Ok(tail)
        }
    }
}

/// Injective generic quotation under the default external input budget.
pub fn encode_linked_proof_data(value: &Node) -> Result<Node, String> {
    encode_linked_proof_data_with_limits(value, &LinkedProofLimits::default())
}

/// Quote with an explicit bounded depth, node count and UTF-8 byte budget.
pub fn encode_linked_proof_data_with_limits(
    value: &Node,
    limits: &LinkedProofLimits,
) -> Result<Node, String> {
    encode(value, &mut Budget::new(limits)?, 1)
}

fn decode(value: &Node, budget: &mut Budget<'_>, depth: usize) -> Result<Node, String> {
    if let Node::List(values) = value {
        if let [Node::Leaf(tag), Node::Leaf(value)] = values.as_slice() {
            if tag == "atom" {
                budget.visit(depth, Some(value))?;
                return Ok(leaf(value));
            }
        }
    }
    budget.visit(depth, None)?;
    let mut values = Vec::new();
    let mut tail = value;
    loop {
        match tail {
            Node::List(parts) => match parts.as_slice() {
                [Node::Leaf(tag)] if tag == "list-end" => return Ok(list(values)),
                [Node::Leaf(tag), head, rest] if tag == "pair" => {
                    values.push(decode(head, budget, depth + values.len() + 1)?);
                    tail = rest;
                }
                _ => return Err("invalid quoted proof data".to_string()),
            },
            _ => return Err("invalid quoted proof data".to_string()),
        }
    }
}

/// Decode only canonical quoted data under the default input budget.
pub fn decode_linked_proof_data(value: &Node) -> Result<Node, String> {
    decode_linked_proof_data_with_limits(value, &LinkedProofLimits::default())
}

/// Decode with explicit limits, before constructing an expanded result.
pub fn decode_linked_proof_data_with_limits(
    value: &Node,
    limits: &LinkedProofLimits,
) -> Result<Node, String> {
    decode(value, &mut Budget::new(limits)?, 1)
}

fn validate(value: &Node, budget: &mut Budget<'_>, depth: usize) -> Result<(), String> {
    match value {
        Node::Leaf(text) => budget.visit(depth, Some(text)),
        Node::List(values) => {
            budget.visit(depth, None)?;
            for value in values {
                validate(value, budget, depth + 1)?;
            }
            Ok(())
        }
    }
}

/// Represent the complete generic reduction trace as inspectable ordinary links.
pub fn linked_proof_trace(trace: &[RewriteTraceStep]) -> Node {
    let mut steps = vec![leaf("linked-execution")];
    steps.extend(trace.iter().map(|step| {
        list(vec![
            leaf("step"),
            leaf(&step.program),
            leaf(&step.rule),
            step.before.clone(),
            step.after.clone(),
        ])
    }));
    list(steps)
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProofReceipt {
    pub schema: String,
    pub program: String,
    pub accepted: bool,
    pub request: Node,
    pub result: Node,
    pub trace: Node,
    pub steps: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProofReplay {
    pub accepted: bool,
    pub matches: bool,
    pub result: Node,
    pub trace: Node,
    pub steps: usize,
}

#[derive(Debug, Clone)]
pub struct LinkedProofOptions {
    pub program: String,
    pub max_steps: usize,
    pub input_limits: LinkedProofLimits,
    pub receipt_limits: LinkedProofLimits,
}

impl Default for LinkedProofOptions {
    fn default() -> Self {
        Self {
            program: LINKED_PROOF_PROGRAM.to_string(),
            max_steps: 100_000,
            input_limits: LinkedProofLimits::default(),
            receipt_limits: LinkedProofLimits::for_receipt(),
        }
    }
}

/// Verify a finite inductive candidate using the caller-selected linked program.
/// Load `universal.lino` and `proof-verifier.lino` into the registry first.
/// A rejection is not a proof of logical falsity. Reduction resource failures
/// remain errors, rather than being mislabeled as proof rejections.
pub fn verify_linked_proof(
    registry: &LinkedProgramRegistry,
    context: &Node,
    goal: &Node,
    candidate: &Node,
    options: &LinkedProofOptions,
) -> Result<LinkedProofReceipt, String> {
    let mut budget = Budget::new(&options.input_limits)?;
    let request = list(vec![
        leaf("verify-linked-proof"),
        encode(context, &mut budget, 1)?,
        encode(goal, &mut budget, 1)?,
        encode(candidate, &mut budget, 1)?,
    ]);
    let reduced = registry.reduce(&options.program, &request, options.max_steps)?;
    let accepted = matches!(&reduced.term, Node::List(values)
        if values.first() == Some(&leaf("proof-accepted")));
    Ok(LinkedProofReceipt {
        schema: LINKED_PROOF_SCHEMA.to_string(),
        program: options.program.clone(),
        accepted,
        request,
        result: reduced.term,
        trace: linked_proof_trace(&reduced.trace),
        steps: reduced.trace.len(),
    })
}

/// Independently replay a receipt against an externally chosen context and goal.
/// Receipt claims cannot choose the verifier, substitute assumptions, or inject an
/// executable request. The supplied registry may be freshly loaded in another
/// process/runtime; no search result or cached proof object is used.
pub fn replay_linked_proof(
    registry: &LinkedProgramRegistry,
    context: &Node,
    goal: &Node,
    receipt: &LinkedProofReceipt,
    options: &LinkedProofOptions,
) -> Result<LinkedProofReplay, String> {
    if receipt.schema != LINKED_PROOF_SCHEMA || receipt.program != options.program {
        return Err("unsupported linked proof replay receipt".to_string());
    }
    let mut budget = Budget::new(&options.receipt_limits)?;
    for value in [&receipt.request, &receipt.result, &receipt.trace] {
        validate(value, &mut budget, 1)?;
    }
    let candidate = match &receipt.request {
        Node::List(values) => match values.as_slice() {
            [Node::Leaf(tag), _, _, candidate] if tag == "verify-linked-proof" => {
                decode_linked_proof_data_with_limits(candidate, &options.input_limits)?
            }
            _ => return Err("unsupported linked proof replay request".to_string()),
        },
        _ => return Err("unsupported linked proof replay request".to_string()),
    };
    let replay = verify_linked_proof(registry, context, goal, &candidate, options)?;
    Ok(LinkedProofReplay {
        accepted: replay.accepted,
        matches: replay.accepted == receipt.accepted
            && replay.steps == receipt.steps
            && replay.request == receipt.request
            && replay.result == receipt.result
            && replay.trace == receipt.trace,
        result: replay.result,
        trace: replay.trace,
        steps: replay.steps,
    })
}
