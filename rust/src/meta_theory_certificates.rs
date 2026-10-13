//! Trusted checker for meta-theory proof certificates.
//!
//! Mirrors the checker in `js/src/rml-meta-theory-certificates.mjs`. The
//! producer (shared JavaScript generator) is untrusted. This checker rebuilds
//! every logical part of the context itself: the theorem statement and each
//! cited lemma statement are recomputed by the native linked program, the
//! theorem's binders are generalized into eigen-constants and hypotheses,
//! lemma rules are offered only for recorded theorem dependencies, and each
//! certificate-supplied instance rule is validated (conversion by
//! normalization under the generated conversion program, eigen freshness,
//! witnessed bodies) before the shared linked proof verifier runs.
use crate::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use crate::linked_proof::{encode_linked_proof_data_with_limits, LinkedProofLimits, LINKED_PROOF_PROGRAM};
use crate::meta_theory_native::{META_THEORY_CONVERSION_PROGRAM, META_THEORY_NATIVE_PROGRAM, NATIVE_MAX_STEPS};
use crate::Node;
use serde_json::Value;
use std::collections::BTreeSet;

pub const META_THEORY_CERTIFICATE_SCHEMA: &str = "rml-meta-theory-certificate/v1";
const VERIFIER_STEPS: usize = 2_000_000;
const CONNECTIVES: &[&str] = &[
    "mt-equal", "mt-not-equal", "mt-and", "mt-or", "mt-not", "mt-iff", "mt-less", "mt-less-equal",
    "mt-member", "mt-forall", "mt-exists",
];

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

fn list(items: Vec<Node>) -> Node {
    Node::List(items)
}

/// Convert certificate JSON data (strings and arrays) into a link term.
pub fn certificate_term(value: &Value) -> Result<Node, String> {
    match value {
        Value::String(text) => Ok(Node::Leaf(text.clone())),
        Value::Array(children) => children.iter().map(certificate_term).collect::<Result<Vec<_>, _>>().map(Node::List),
        _ => Err("certificate terms contain strings and arrays only".to_string()),
    }
}

fn head(term: &Node) -> Option<&str> {
    match term {
        Node::List(items) => match items.first() {
            Some(Node::Leaf(text)) => Some(text.as_str()),
            _ => None,
        },
        Node::Leaf(_) => None,
    }
}

fn items(term: &Node) -> &[Node] {
    match term {
        Node::List(items) => items,
        Node::Leaf(_) => &[],
    }
}

pub fn eigen(bound: &str) -> Node {
    list(vec![leaf("mt-v"), list(vec![leaf("mt-eigen"), leaf(bound)])])
}

fn variable(name: &str) -> Node {
    list(vec![leaf("variable"), leaf(name)])
}

fn holds(proposition: Node) -> Node {
    list(vec![leaf("holds"), proposition])
}

fn substitute_local(term: &Node, bound: &str, replacement: &Node) -> Node {
    match term {
        Node::Leaf(_) => term.clone(),
        Node::List(children) => {
            if children.len() == 2 && children[0] == leaf("mt-local") && children[1] == leaf(bound) {
                return replacement.clone();
            }
            list(children.iter().map(|child| substitute_local(child, bound, replacement)).collect())
        }
    }
}

fn close_locals(term: &Node) -> Node {
    match term {
        Node::Leaf(_) => term.clone(),
        Node::List(children) => {
            if children.len() == 2 && children[0] == leaf("mt-local") {
                if let Node::Leaf(bound) = &children[1] {
                    return eigen(bound);
                }
            }
            list(children.iter().map(close_locals).collect())
        }
    }
}

fn occurs(term: &Node, part: &Node) -> bool {
    term == part || items(term).iter().any(|child| occurs(child, part))
}

fn has_variable(term: &Node) -> bool {
    match term {
        Node::Leaf(_) => false,
        Node::List(children) => {
            (children.len() == 2 && children[0] == leaf("variable")) || children.iter().any(has_variable)
        }
    }
}

/// The native/conversion registry and the linked proof verifier registry.
pub struct CertificateRegistries {
    pub native: LinkedProgramRegistry,
    pub verifier: LinkedProgramRegistry,
}

pub fn certificate_registries(
    prelude: &str,
    program: &str,
    conversion: &str,
    universal: &str,
    verifier: &str,
) -> Result<CertificateRegistries, String> {
    Ok(CertificateRegistries {
        native: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{prelude}\n{program}\n{conversion}"),
            ExecutionBasis::DirectStructural,
            &[],
        )?,
        verifier: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{universal}\n{verifier}"),
            ExecutionBasis::DirectStructural,
            &[],
        )?,
    })
}

fn normalize(registry: &LinkedProgramRegistry, program: &str, term: &Node) -> Option<Node> {
    registry.reduce_result(program, term, NATIVE_MAX_STEPS).ok().map(|summary| summary.term)
}

/// The statement the native linked program elaborates for a theorem.
pub fn theorem_statement(registries: &CertificateRegistries, address: &str) -> Result<Node, String> {
    let request = list(vec![leaf("mt-statement"), leaf(address)]);
    normalize(&registries.native, META_THEORY_NATIVE_PROGRAM, &request)
        .ok_or_else(|| format!("statement of {address} does not normalize"))
}

/// A prelude connective, or an application whose declared result type is Prop
/// after consuming the remaining arguments through arrow types.
pub fn is_hypothesis_type(registries: &CertificateRegistries, ty: &Node) -> bool {
    let Some(name) = head(ty) else { return false };
    if name == "mt-v" {
        return false;
    }
    if CONNECTIVES.contains(&name) {
        return true;
    }
    if !name.starts_with("rml.formal.") {
        return false;
    }
    let closed = close_locals(ty);
    let args = &items(&closed)[1..];
    for supplied in (0..=args.len()).rev() {
        let mut request = vec![leaf("mt-result-type"), leaf(name)];
        request.extend(args[..supplied].iter().cloned());
        let Some(result) = normalize(&registries.native, META_THEORY_NATIVE_PROGRAM, &list(request)) else {
            continue;
        };
        let parts = items(&result);
        if parts.len() != 2 || parts[0] != leaf("mt-v") {
            continue;
        }
        let mut remaining = parts[1].clone();
        for _ in supplied..args.len() {
            let arrow = items(&remaining);
            if arrow.len() != 3 || arrow[0] != leaf("mt-arrow") {
                return false;
            }
            remaining = arrow[2].clone();
        }
        return remaining == leaf("mt-prop-type");
    }
    false
}

/// One leading binder of a statement: data, or a hypothesis.
#[derive(Debug, Clone, PartialEq)]
pub struct StatementBinder {
    pub bound: String,
    pub ty: Node,
    pub hypothesis: bool,
}

/// Leading universal binders and implication premises of a statement.
pub fn statement_binders(registries: &CertificateRegistries, statement: &Node) -> (Vec<StatementBinder>, Node) {
    let mut binders = Vec::new();
    let mut body = statement.clone();
    let mut premises = 0;
    loop {
        let parts = items(&body).to_vec();
        if parts.len() == 3 && parts[0] == leaf("mt-forall") && head(&parts[1]) == Some("mt-binder") {
            let binder = items(&parts[1]);
            let (Some(Node::Leaf(bound)), Some(ty)) = (binder.get(1), binder.get(2)) else {
                return (binders, body);
            };
            let hypothesis = is_hypothesis_type(registries, ty);
            binders.push(StatementBinder { bound: bound.clone(), ty: ty.clone(), hypothesis });
            body = parts[2].clone();
        } else if parts.len() == 3 && parts[0] == leaf("mt-arrow") && is_hypothesis_type(registries, &parts[1]) {
            binders.push(StatementBinder { bound: format!("mt-premise-{premises}"), ty: parts[1].clone(), hypothesis: true });
            premises += 1;
            body = parts[2].clone();
        } else {
            return (binders, body);
        }
    }
}

/// A theorem generalized into eigen-constants, hypothesis rules and a goal.
#[derive(Debug, Clone, PartialEq)]
pub struct GeneralizedTheorem {
    pub statement: Node,
    pub goal: Node,
    pub hypotheses: Vec<Node>,
}

pub fn generalize_theorem(registries: &CertificateRegistries, address: &str) -> Result<GeneralizedTheorem, String> {
    let statement = theorem_statement(registries, address)?;
    let (binders, body) = statement_binders(registries, &statement);
    let close = |term: &Node| {
        binders.iter().fold(term.clone(), |current, binder| {
            if binder.hypothesis {
                current
            } else {
                substitute_local(&current, &binder.bound, &eigen(&binder.bound))
            }
        })
    };
    let hypotheses = binders
        .iter()
        .filter(|binder| binder.hypothesis)
        .map(|binder| {
            list(vec![
                leaf("rule"),
                Node::Leaf(format!("hypothesis:{}", binder.bound)),
                list(Vec::new()),
                holds(close(&binder.ty)),
            ])
        })
        .collect();
    let goal = holds(close(&body));
    Ok(GeneralizedTheorem { statement, goal, hypotheses })
}

/// The schematic rule of a cited lemma; instance premises bind its data binders.
pub fn lemma_rule(registries: &CertificateRegistries, address: &str) -> Result<Node, String> {
    let (binders, body) = statement_binders(registries, &theorem_statement(registries, address)?);
    let open = |term: &Node| {
        binders.iter().fold(term.clone(), |current, binder| {
            if binder.hypothesis {
                current
            } else {
                substitute_local(&current, &binder.bound, &variable(&binder.bound))
            }
        })
    };
    let premises = binders
        .iter()
        .map(|binder| {
            if binder.hypothesis {
                holds(open(&binder.ty))
            } else {
                list(vec![leaf("instance"), leaf(address), leaf(&binder.bound), variable(&binder.bound)])
            }
        })
        .collect();
    Ok(list(vec![leaf("rule"), Node::Leaf(format!("lemma:{address}")), list(premises), holds(open(&body))]))
}

/// Structural rules shared by every certificate context.
pub fn structural_rules() -> Vec<Node> {
    let and = list(vec![leaf("mt-and"), variable("left"), variable("right")]);
    vec![
        list(vec![
            leaf("rule"),
            leaf("and-intro"),
            list(vec![holds(variable("left")), holds(variable("right"))]),
            holds(and.clone()),
        ]),
        list(vec![leaf("rule"), leaf("and-left"), list(vec![holds(and.clone())]), holds(variable("left"))]),
        list(vec![leaf("rule"), leaf("and-right"), list(vec![holds(and)]), holds(variable("right"))]),
        list(vec![
            leaf("rule"),
            leaf("refl"),
            list(vec![list(vec![leaf("instance"), leaf("refl"), leaf("term"), variable("term")])]),
            holds(list(vec![leaf("mt-equal"), variable("term"), variable("term")])),
        ]),
    ]
}

/// Validate one certificate-supplied instance rule; `Some(problem)` rejects it.
pub fn check_instance_rule(
    registries: &CertificateRegistries,
    generalized: &GeneralizedTheorem,
    entry: &Value,
) -> Option<String> {
    let kind = entry["kind"].as_str().unwrap_or("");
    let Ok(rule) = certificate_term(&entry["rule"]) else {
        return Some("malformed instance rule".to_string());
    };
    let parts = items(&rule);
    let well_formed = parts.len() == 4
        && parts[0] == leaf("rule")
        && matches!(&parts[1], Node::Leaf(id) if id.starts_with(&format!("{kind}:")))
        && matches!(&parts[2], Node::List(_));
    if !well_formed {
        return Some("malformed instance rule".to_string());
    }
    let Node::Leaf(id) = &parts[1] else { return Some("malformed instance rule".to_string()) };
    let premises = items(&parts[2]);
    let conclusion = &parts[3];
    if has_variable(&parts[2]) || has_variable(conclusion) {
        return Some(format!("{id}: instance rules must be ground"));
    }
    if kind == "instance" {
        if !premises.is_empty() || items(conclusion).len() != 4 || head(conclusion) != Some("instance") {
            return Some(format!("{id}: malformed instance fact"));
        }
        return None;
    }
    if premises.len() != 1
        || head(&premises[0]) != Some("holds")
        || items(&premises[0]).len() != 2
        || head(conclusion) != Some("holds")
        || items(conclusion).len() != 2
    {
        return Some(format!("{id}: expects one holds premise"));
    }
    let premise = &items(&premises[0])[1];
    let target = &items(conclusion)[1];
    match kind {
        "conversion" => {
            let left = normalize(&registries.native, META_THEORY_CONVERSION_PROGRAM, premise);
            let right = normalize(&registries.native, META_THEORY_CONVERSION_PROGRAM, target);
            if left.is_some() && left == right {
                None
            } else {
                Some(format!("{id}: premise and conclusion are not convertible"))
            }
        }
        "forall-intro" | "exists-intro" => {
            let quantifier = if kind == "forall-intro" { "mt-forall" } else { "mt-exists" };
            let quantified = items(target);
            if quantified.len() != 3 || quantified[0] != leaf(quantifier) || head(&quantified[1]) != Some("mt-binder") {
                return Some(format!("{id}: conclusion is not {quantifier}"));
            }
            let Some(Node::Leaf(bound)) = items(&quantified[1]).get(1) else {
                return Some(format!("{id}: malformed binder"));
            };
            if kind == "forall-intro" {
                let constant = eigen(bound);
                if premise != &substitute_local(&quantified[2], bound, &constant) {
                    return Some(format!("{id}: premise is not the opened body"));
                }
                if occurs(target, &constant)
                    || occurs(&generalized.goal, &constant)
                    || generalized.hypotheses.iter().any(|hypothesis| occurs(hypothesis, &constant))
                {
                    return Some(format!("{id}: eigen-constant is not fresh"));
                }
                return None;
            }
            let witness = match certificate_term(&entry["witness"]) {
                Ok(witness) if !entry["witness"].is_null() && !has_variable(&witness) => witness,
                _ => return Some(format!("{id}: missing ground witness")),
            };
            if premise == &substitute_local(&quantified[2], bound, &witness) {
                None
            } else {
                Some(format!("{id}: premise is not the witnessed body"))
            }
        }
        _ => Some(format!("{id}: unknown instance rule kind {kind}")),
    }
}

/// The verdict of an independent certificate check.
#[derive(Debug, Clone, PartialEq)]
pub struct CertificateCheck {
    pub accepted: bool,
    pub problems: Vec<String>,
    pub steps: usize,
}

/// Independently check a certificate against the recorded theorem dependencies.
pub fn check_meta_theory_certificate(
    registries: &CertificateRegistries,
    certificate: &Value,
    theorem_dependencies: &[String],
) -> Result<CertificateCheck, String> {
    let rejected = |problems: Vec<String>| CertificateCheck { accepted: false, problems, steps: 0 };
    if certificate["schema"].as_str() != Some(META_THEORY_CERTIFICATE_SCHEMA) {
        return Ok(rejected(vec!["unsupported certificate schema".to_string()]));
    }
    let address = certificate["theorem"].as_str().unwrap_or("");
    let mut problems = Vec::new();
    if theorem_dependencies.iter().any(|item| item == address) {
        problems.push("a theorem cannot cite itself".to_string());
    }
    let generalized = generalize_theorem(registries, address)?;
    if certificate_term(&certificate["statement"]).ok().as_ref() != Some(&generalized.statement) {
        problems.push("statement differs from the native elaboration".to_string());
    }
    if certificate_term(&certificate["goal"]).ok().as_ref() != Some(&generalized.goal) {
        problems.push("goal differs from the generalized statement".to_string());
    }
    let mut ids = BTreeSet::new();
    let entries = certificate["instanceRules"].as_array().cloned().unwrap_or_default();
    let mut instance_rules = Vec::new();
    for entry in &entries {
        if let Some(problem) = check_instance_rule(registries, &generalized, entry) {
            problems.push(problem);
        }
        let id = entry["rule"][1].as_str().unwrap_or("").to_string();
        if !ids.insert(id.clone()) {
            problems.push(format!("duplicate instance rule {id}"));
        }
        if let Ok(rule) = certificate_term(&entry["rule"]) {
            instance_rules.push(rule);
        }
    }
    for cited in certificate["cites"].as_array().cloned().unwrap_or_default() {
        let cited = cited.as_str().unwrap_or("").to_string();
        if !theorem_dependencies.contains(&cited) {
            problems.push(format!("cites {cited}, which is not a recorded theorem dependency"));
        }
    }
    if !problems.is_empty() {
        return Ok(rejected(problems));
    }
    let candidate = certificate_term(&certificate["candidate"])?;
    let mut sorted = theorem_dependencies.to_vec();
    sorted.sort();
    let mut rules = structural_rules();
    rules.extend(generalized.hypotheses.iter().cloned());
    for dependency in &sorted {
        rules.push(lemma_rule(registries, dependency)?);
    }
    rules.extend(instance_rules);
    let context = list(vec![
        leaf("proof-context"),
        list(vec![leaf("rml-meta-theory"), leaf(address)]),
        list(rules),
    ]);
    let limits = LinkedProofLimits::for_receipt();
    let request = list(vec![
        leaf("verify-linked-proof"),
        encode_linked_proof_data_with_limits(&context, &limits)?,
        encode_linked_proof_data_with_limits(&generalized.goal, &limits)?,
        encode_linked_proof_data_with_limits(&candidate, &limits)?,
    ]);
    let reduced = registries.verifier.reduce_result(LINKED_PROOF_PROGRAM, &request, VERIFIER_STEPS)?;
    let accepted = head(&reduced.term) == Some("proof-accepted");
    Ok(CertificateCheck {
        accepted,
        problems: if accepted { Vec::new() } else { vec!["linked proof verifier rejected the derivation".to_string()] },
        steps: reduced.steps,
    })
}
