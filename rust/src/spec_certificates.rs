//! Native execution and the trusted certificate checker for the source
//! specifications of types, graphs and relational algebra.
//!
//! Mirrors the checker in `js/src/rml-spec-certificates.mjs`; the producer
//! there is untrusted and only its output is read here. Each specification is
//! an ordinary linked program that lists its theorems with `(spec-theorems)`,
//! computes each statement with `(spec-theorem NAME)` and states its proof
//! rules with `(spec-proof-rules)`. The checker recomputes the statement,
//! takes the rules from the specification, re-executes every recorded fact
//! `(F ARGUMENTS...)` and offers it as the premise-free rule
//! `(evaluates (spec-call F ARGUMENTS...) VALUE)`, then runs the
//! natural-deduction linked proof verifier over exactly that context.
use crate::linked_program::{ExecutionBasis, LinkedProgramRegistry, ReductionSummary};
use crate::linked_proof::{encode_linked_proof_data_with_limits, LinkedProofLimits, LINKED_PROOF_NATURAL_PROGRAM};
use crate::Node;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const SPEC_CERTIFICATE_SCHEMA: &str = "rml-spec-certificate/v1";
pub const SPEC_PROGRAMS: [(&str, &str); 3] = [
    ("type-specification", "lib/meta-theory/type-specification.lino"),
    ("graph-specification", "lib/meta-theory/graph-specification.lino"),
    ("relational-algebra-specification", "lib/meta-theory/relational-algebra-specification.lino"),
];
pub const SPEC_MAX_STEPS: usize = 5_000_000;
const VERIFIER_STEPS: usize = 2_000_000;

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

fn list(items: Vec<Node>) -> Node {
    Node::List(items)
}

fn items(term: &Node) -> &[Node] {
    match term {
        Node::List(items) => items,
        Node::Leaf(_) => &[],
    }
}

fn head(term: &Node) -> Option<&str> {
    match items(term).first() {
        Some(Node::Leaf(text)) => Some(text.as_str()),
        _ => None,
    }
}

/// LiNo text of a term: atoms as they are, links as `(a b c)`.
pub fn render_link(term: &Node) -> String {
    term.to_string()
}

/// Convert fixture JSON (strings and arrays) into a link term.
pub fn spec_term(value: &Value) -> Result<Node, String> {
    match value {
        Value::String(text) => Ok(Node::Leaf(text.clone())),
        Value::Array(children) => children.iter().map(spec_term).collect::<Result<Vec<_>, _>>().map(Node::List),
        _ => Err("specification terms contain strings and arrays only".to_string()),
    }
}

/// One registry per specification program, and the linked proof verifier.
pub struct SpecRegistries {
    pub programs: BTreeMap<String, LinkedProgramRegistry>,
    pub verifier: LinkedProgramRegistry,
}

/// `specs` pairs program names with their sources; `natural` is
/// lib/meta-theory/proof-verifier-natural.lino, loaded after the base verifier.
pub fn spec_registries(
    specs: &[(&str, &str)],
    universal: &str,
    verifier: &str,
    natural: &str,
) -> Result<SpecRegistries, String> {
    let mut programs = BTreeMap::new();
    for (program, source) in specs {
        programs.insert(
            program.to_string(),
            LinkedProgramRegistry::from_rml_with_basis(source, ExecutionBasis::DirectStructural, &[])?,
        );
    }
    Ok(SpecRegistries {
        programs,
        verifier: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{universal}\n{verifier}\n{natural}"),
            ExecutionBasis::DirectStructural,
            &[],
        )?,
    })
}

/// Execute a request natively in a specification program.
pub fn spec_evaluate(registries: &SpecRegistries, program: &str, request: &Node) -> Result<ReductionSummary, String> {
    let registry = registries
        .programs
        .get(program)
        .ok_or_else(|| format!("unknown specification program {program}"))?;
    registry.reduce_result(program, request, SPEC_MAX_STEPS)
}

fn evaluate(registries: &SpecRegistries, program: &str, request: &Node) -> Result<Node, String> {
    spec_evaluate(registries, program, request).map(|summary| summary.term)
}

/// The theorem names a specification states.
pub fn spec_theorems(registries: &SpecRegistries, program: &str) -> Result<Vec<String>, String> {
    let listed = evaluate(registries, program, &list(vec![leaf("spec-theorems")]))?;
    if head(&listed) != Some("spec-list") {
        return Err(format!("{program} does not list its theorems"));
    }
    items(&listed)[1..]
        .iter()
        .map(|name| match name {
            Node::Leaf(text) => Ok(text.clone()),
            Node::List(_) => Err(format!("{program} lists a malformed theorem name")),
        })
        .collect()
}

/// The goal a specification computes for one of its theorems.
pub fn spec_statement(registries: &SpecRegistries, program: &str, theorem: &str) -> Result<Option<Node>, String> {
    let statement = evaluate(registries, program, &list(vec![leaf("spec-theorem"), leaf(theorem)]))?;
    let parts = items(&statement);
    Ok(if parts.len() == 2 && head(&statement) == Some("spec-statement") { Some(parts[1].clone()) } else { None })
}

fn is_fact_id(id: &str) -> bool {
    id.strip_prefix("fact:")
        .map(|digits| !digits.is_empty() && !digits.starts_with('0') && digits.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false)
}

/// The proof rules a specification states, in order.
pub fn spec_proof_rules(registries: &SpecRegistries, program: &str) -> Result<Vec<Node>, String> {
    let stated = evaluate(registries, program, &list(vec![leaf("spec-proof-rules")]))?;
    if head(&stated) != Some("spec-rules") {
        return Err(format!("{program} does not state proof rules"));
    }
    let rules = items(&stated)[1..].to_vec();
    for rule in &rules {
        let parts = items(rule);
        let well_formed = parts.len() == 4
            && head(rule) == Some("rule")
            && matches!(&parts[1], Node::Leaf(id) if !is_fact_id(id))
            && matches!(&parts[2], Node::List(_));
        if !well_formed {
            return Err(format!("{program} states a malformed proof rule {rule}"));
        }
    }
    Ok(rules)
}

fn has_variable(term: &Node) -> bool {
    match term {
        Node::Leaf(_) => false,
        Node::List(children) => {
            (children.len() == 2 && children[0] == leaf("variable")) || children.iter().any(has_variable)
        }
    }
}

/// A recorded fact: a ground call and its recorded native value.
pub struct SpecFact {
    pub id: String,
    pub expression: Node,
    pub value: Node,
}

/// The premise-free rule a re-executed fact becomes.
pub fn fact_rule(fact: &SpecFact) -> Node {
    let mut call = vec![leaf("spec-call")];
    call.extend(items(&fact.expression).iter().cloned());
    list(vec![
        leaf("rule"),
        leaf(&fact.id),
        list(Vec::new()),
        list(vec![leaf("evaluates"), list(call), fact.value.clone()]),
    ])
}

/// Re-execute recorded facts: every fact must be a ground call whose native
/// value is exactly the recorded value. Returns the facts and the problems.
pub fn check_spec_facts(registries: &SpecRegistries, program: &str, facts: &Value) -> (Vec<SpecFact>, Vec<String>) {
    let mut problems = Vec::new();
    let mut checked = Vec::new();
    let Some(entries) = facts.as_array() else {
        return (checked, vec!["facts must be a list".to_string()]);
    };
    let mut ids = BTreeSet::new();
    for entry in entries {
        let id = entry["id"].as_str().unwrap_or("").to_string();
        if !is_fact_id(&id) {
            problems.push(format!("malformed fact id {id}"));
            continue;
        }
        if !ids.insert(id.clone()) {
            problems.push(format!("duplicate fact {id}"));
        }
        let (Ok(expression), Ok(value)) = (spec_term(&entry["expression"]), spec_term(&entry["value"])) else {
            problems.push(format!("{id}: malformed fact"));
            continue;
        };
        if !matches!(items(&expression).first(), Some(Node::Leaf(_))) {
            problems.push(format!("{id}: malformed fact"));
            continue;
        }
        if has_variable(&expression) || has_variable(&value) {
            problems.push(format!("{id}: facts must be ground"));
            continue;
        }
        match evaluate(registries, program, &expression) {
            Ok(actual) if actual == value => {}
            Ok(actual) => problems.push(format!("{id}: {expression} evaluates to {actual}, not {value}")),
            Err(error) => problems.push(format!("{id}: {error}")),
        }
        checked.push(SpecFact { id, expression, value });
    }
    (checked, problems)
}

/// The exact context the checker trusts: the specification's rules, then the re-executed facts.
pub fn spec_context(
    registries: &SpecRegistries,
    program: &str,
    identity: &Node,
    facts: &[SpecFact],
) -> Result<Node, String> {
    let mut rules = spec_proof_rules(registries, program)?;
    rules.extend(facts.iter().map(fact_rule));
    Ok(list(vec![leaf("proof-context"), identity.clone(), list(rules)]))
}

/// The checker's verdict.
#[derive(Debug, Clone)]
pub struct SpecCheck {
    pub accepted: bool,
    pub problems: Vec<String>,
    pub steps: usize,
}

fn rejected(problems: Vec<String>) -> SpecCheck {
    SpecCheck { accepted: false, problems, steps: 0 }
}

/// Check a derivation of an arbitrary goal against a specification.
pub fn check_spec_derivation(
    registries: &SpecRegistries,
    program: &str,
    identity: &Node,
    goal: &Node,
    facts: &Value,
    candidate: &Value,
) -> Result<SpecCheck, String> {
    let (facts, problems) = check_spec_facts(registries, program, facts);
    if !problems.is_empty() {
        return Ok(rejected(problems));
    }
    let context = spec_context(registries, program, identity, &facts)?;
    let candidate = spec_term(candidate)?;
    let limits = LinkedProofLimits::for_receipt();
    let request = list(vec![
        leaf("verify-linked-proof"),
        encode_linked_proof_data_with_limits(&context, &limits)?,
        encode_linked_proof_data_with_limits(goal, &limits)?,
        encode_linked_proof_data_with_limits(&candidate, &limits)?,
    ]);
    let reduced = registries.verifier.reduce_result(LINKED_PROOF_NATURAL_PROGRAM, &request, VERIFIER_STEPS)?;
    let accepted = head(&reduced.term) == Some("proof-accepted");
    Ok(SpecCheck {
        accepted,
        problems: if accepted { Vec::new() } else { vec!["linked proof verifier rejected the derivation".to_string()] },
        steps: reduced.steps,
    })
}

/// Independently check a theorem certificate of a specification.
pub fn check_spec_certificate(registries: &SpecRegistries, certificate: &Value) -> Result<SpecCheck, String> {
    if certificate["schema"].as_str() != Some(SPEC_CERTIFICATE_SCHEMA) {
        return Ok(rejected(vec!["unsupported certificate schema".to_string()]));
    }
    let program = certificate["program"].as_str().unwrap_or("");
    let theorem = certificate["theorem"].as_str().unwrap_or("");
    if !registries.programs.contains_key(program) {
        return Ok(rejected(vec![format!("unknown specification program {program}")]));
    }
    if !spec_theorems(registries, program)?.iter().any(|name| name == theorem) {
        return Ok(rejected(vec![format!("{program} states no theorem {theorem}")]));
    }
    let Some(goal) = spec_statement(registries, program, theorem)? else {
        return Ok(rejected(vec![format!("{theorem} has no statement")]));
    };
    if spec_term(&certificate["goal"]).ok().as_ref() != Some(&goal) {
        return Ok(rejected(vec!["goal differs from the statement the specification computes".to_string()]));
    }
    let identity = list(vec![leaf("spec"), leaf(program), leaf(theorem)]);
    check_spec_derivation(registries, program, &identity, &goal, &certificate["facts"], &certificate["candidate"])
}
