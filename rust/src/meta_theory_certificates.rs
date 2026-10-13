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
//! witnessed bodies, rewrite side conditions, induction and case-analysis
//! shapes, local ownership and list typing of their targets) before the
//! natural-deduction linked proof verifier runs. After acceptance the
//! eigenvariable condition is checked on the verified derivation.
use crate::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use crate::linked_proof::{encode_linked_proof_data_with_limits, LinkedProofLimits, LINKED_PROOF_NATURAL_PROGRAM};
use crate::meta_theory_native::{META_THEORY_CONVERSION_PROGRAM, META_THEORY_NATIVE_PROGRAM, NATIVE_MAX_STEPS};
use crate::Node;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const META_THEORY_CERTIFICATE_SCHEMA: &str = "rml-meta-theory-certificate/v1";
const VERIFIER_STEPS: usize = 2_000_000;
const CONNECTIVES: &[&str] = &[
    "mt-equal", "mt-not-equal", "mt-and", "mt-or", "mt-not", "mt-iff", "mt-less", "mt-less-equal",
    "mt-member", "mt-forall", "mt-exists",
];
const MOTIVE: &str = "mt-motive";
const INSTANCE_KINDS: &[&str] = &[
    "instance", "conversion", "forall-intro", "exists-intro", "local", "rewrite", "induction", "cases",
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

fn eigen_name(term: &Node) -> Option<&str> {
    let parts = items(term);
    if parts.len() != 2 || parts[0] != leaf("mt-v") {
        return None;
    }
    match items(&parts[1]) {
        [tag, Node::Leaf(name)] if *tag == leaf("mt-eigen") => Some(name.as_str()),
        _ => None,
    }
}

fn nil() -> Node {
    list(vec![leaf("mt-v"), leaf("mt-nil")])
}

fn truth() -> Node {
    list(vec![leaf("mt-v"), leaf("mt-true")])
}

/// The value of a list built from eigen-constants `head` and `tail`.
pub fn cons_of(head: &str, tail: &str) -> Node {
    list(vec![leaf("mt-cons"), eigen(head), eigen(tail)])
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

fn mentions_local(term: &Node) -> bool {
    match term {
        Node::Leaf(_) => false,
        Node::List(children) => {
            (children.len() == 2 && children[0] == leaf("mt-local")) || children.iter().any(mentions_local)
        }
    }
}

fn binds_name(term: &Node, name: &str) -> bool {
    match term {
        Node::Leaf(_) => false,
        Node::List(children) => {
            (children.len() >= 2 && children[0] == leaf("mt-binder") && children[1] == leaf(name))
                || children.iter().any(|child| binds_name(child, name))
        }
    }
}

/// The native/conversion registry and the linked proof verifier registry.
pub struct CertificateRegistries {
    pub native: LinkedProgramRegistry,
    pub verifier: LinkedProgramRegistry,
}

/// `natural` is lib/meta-theory/proof-verifier-natural.lino, loaded after the
/// base verifier it reuses.
pub fn certificate_registries(
    prelude: &str,
    program: &str,
    conversion: &str,
    universal: &str,
    verifier: &str,
    natural: &str,
) -> Result<CertificateRegistries, String> {
    Ok(CertificateRegistries {
        native: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{prelude}\n{program}\n{conversion}"),
            ExecutionBasis::DirectStructural,
            &[],
        )?,
        verifier: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{universal}\n{verifier}\n{natural}"),
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
    pub binders: Vec<StatementBinder>,
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
    Ok(GeneralizedTheorem { statement, binders, goal, hypotheses })
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
        list(vec![leaf("rule"), leaf("true-intro"), list(Vec::new()), holds(truth())]),
    ]
}

/// The declared type of an inferred binder: every corpus function the
/// statement applies directly to the binder declares a closed parameter type
/// `(mt-parameter-type F k)` in the conversion program; all witnesses must
/// agree. `None` when there is no witness or they disagree.
pub fn inferred_binder_type(registries: &CertificateRegistries, statement: &Node, bound: &str) -> Option<Node> {
    fn visit(registries: &CertificateRegistries, term: &Node, local: &Node, witnesses: &mut Vec<Node>) {
        let Node::List(children) = term else { return };
        if let Some(Node::Leaf(name)) = children.first() {
            if name.starts_with("rml.formal.") {
                for (index, argument) in children[1..].iter().enumerate() {
                    if argument != local {
                        continue;
                    }
                    let request = list(vec![leaf("mt-parameter-type"), leaf(name), Node::Leaf(index.to_string())]);
                    if let Some(ty) = normalize(&registries.native, META_THEORY_CONVERSION_PROGRAM, &request) {
                        if matches!(ty, Node::List(_)) && head(&ty) != Some("mt-parameter-type") {
                            witnesses.push(ty);
                        }
                    }
                }
            }
        }
        for child in children {
            visit(registries, child, local, witnesses);
        }
    }
    let mut witnesses = Vec::new();
    visit(registries, statement, &list(vec![leaf("mt-local"), leaf(bound)]), &mut witnesses);
    let first = witnesses.first()?.clone();
    witnesses.iter().all(|ty| *ty == first).then_some(first)
}

/// Declared types of the theorem's own data eigen-constants.
pub fn theorem_eigen_types(
    registries: &CertificateRegistries,
    generalized: &GeneralizedTheorem,
) -> BTreeMap<String, Vec<Node>> {
    let mut types = BTreeMap::new();
    for binder in generalized.binders.iter().filter(|binder| !binder.hypothesis) {
        let ty = if binder.ty == leaf("mt-inferred-domain") {
            inferred_binder_type(registries, &generalized.statement, &binder.bound)
        } else {
            Some(close_locals(&binder.ty))
        };
        if let Some(ty) = ty {
            types.insert(binder.bound.clone(), vec![ty]);
        }
    }
    types
}

/// Every declared type of every eigen-constant: statement, quantifier, induction and cases.
fn eigen_declarations(
    registries: &CertificateRegistries,
    generalized: &GeneralizedTheorem,
    entries: &[Value],
) -> BTreeMap<String, Vec<Node>> {
    let mut types = theorem_eigen_types(registries, generalized);
    let mut declare = |name: &str, ty: Node| {
        if ty != leaf("mt-inferred-domain") {
            types.entry(name.to_string()).or_default().push(ty);
        }
    };
    for entry in entries {
        let kind = entry["kind"].as_str().unwrap_or("");
        if kind == "forall-intro" {
            if let Ok(binder) = certificate_term(&entry["rule"][3][1][1]) {
                if let [tag, Node::Leaf(bound), ty, ..] = items(&binder) {
                    if *tag == leaf("mt-binder") {
                        declare(bound, ty.clone());
                    }
                }
            }
        }
        if kind == "induction" || kind == "cases" {
            let Ok(domain) = certificate_term(&entry["domain"]) else { continue };
            if !matches!(domain, Node::List(_)) {
                continue;
            }
            let mut element = vec![leaf("mt-v")];
            element.extend(items(&domain).get(1).and_then(|ty| items(ty).get(1)).cloned());
            declare(entry["head"].as_str().unwrap_or(""), list(element));
            declare(entry["tail"].as_str().unwrap_or(""), domain);
        }
    }
    types
}

fn is_list_domain(domain: &Node) -> bool {
    let parts = items(domain);
    parts.len() == 2 && parts[0] == leaf("mt-v") && {
        let inner = items(&parts[1]);
        inner.len() == 2 && inner[0] == leaf("mt-list-type")
    }
}

/// Shape and freshness of an induction or cases rule; its locals are checked by the owner check.
fn check_structural_induction(
    generalized: &GeneralizedTheorem,
    entry: &Value,
    kind: &str,
    id: &str,
    premises: &Node,
    conclusion: &Node,
) -> Option<String> {
    let target = certificate_term(&entry["target"]).ok();
    let Some(name) = target.as_ref().and_then(eigen_name) else {
        return Some(format!("{id}: the {kind} target must be an eigen-constant"));
    };
    if !certificate_term(&entry["domain"]).is_ok_and(|domain| is_list_domain(&domain)) {
        return Some(format!("{id}: the {kind} domain must be a list type"));
    }
    let (Some(head_name), Some(tail_name)) = (entry["head"].as_str(), entry["tail"].as_str()) else {
        return Some(format!("{id}: the {kind} eigen-constants must be distinct names"));
    };
    if head_name == tail_name || head_name == name || tail_name == name {
        return Some(format!("{id}: the {kind} eigen-constants must be distinct names"));
    }
    let fresh = [eigen(head_name), eigen(tail_name)];
    let stale = |term: &Node| fresh.iter().any(|constant| occurs(term, constant));
    if stale(conclusion) || stale(&generalized.goal) || generalized.hypotheses.iter().any(stale) {
        return Some(format!("{id}: eigen-constant is not fresh"));
    }
    let target = target.clone().unwrap_or_else(|| leaf(""));
    if kind == "induction" {
        let body = certificate_term(&entry["motive"]["body"]).ok();
        let Some(body) = body.filter(|body| {
            matches!(body, Node::List(_)) && entry["motive"]["bound"].as_str() == Some(MOTIVE) && !binds_name(body, MOTIVE)
        }) else {
            return Some(format!("{id}: malformed motive"));
        };
        if stale(&body) {
            return Some(format!("{id}: the motive mentions the step eigen-constants"));
        }
        let at = |value: &Node| holds(substitute_local(&body, MOTIVE, value));
        let expected = certificate_term(&entry["hypothesis"]).ok().map(|hypothesis| {
            list(vec![at(&nil()), list(vec![leaf("discharge"), hypothesis, at(&cons_of(head_name, tail_name))])])
        });
        if expected.as_ref() != Some(premises) {
            return Some(format!("{id}: premises are not the base and step cases of the motive"));
        }
        if *conclusion != at(&target) {
            return Some(format!("{id}: conclusion is not the motive at the target"));
        }
        return None;
    }
    let zero = certificate_term(&entry["equations"][0]).ok();
    let one = certificate_term(&entry["equations"][1]).ok();
    let expected = zero.zip(one).map(|(zero, one)| {
        list(vec![
            list(vec![leaf("discharge"), zero, conclusion.clone()]),
            list(vec![leaf("discharge"), one, conclusion.clone()]),
        ])
    });
    if expected.as_ref() != Some(premises) {
        return Some(format!("{id}: premises are not the two discharged cases of the conclusion"));
    }
    None
}

/// The local id and conclusion each owned local must state.
fn owned_locals(entry: &Value) -> Vec<(String, Node)> {
    let kind = entry["kind"].as_str().unwrap_or("");
    let text = |value: &Value| value.as_str().unwrap_or("").to_string();
    if kind == "induction" {
        let body = certificate_term(&entry["motive"]["body"]).unwrap_or_else(|_| leaf(""));
        let tail = entry["tail"].as_str().unwrap_or("");
        return vec![(text(&entry["hypothesis"]), holds(substitute_local(&body, MOTIVE, &eigen(tail))))];
    }
    if kind == "cases" {
        let target = certificate_term(&entry["target"]).unwrap_or_else(|_| leaf(""));
        let (head_name, tail_name) = (entry["head"].as_str().unwrap_or(""), entry["tail"].as_str().unwrap_or(""));
        return vec![
            (text(&entry["equations"][0]), holds(list(vec![leaf("mt-equal"), target.clone(), nil()]))),
            (
                text(&entry["equations"][1]),
                holds(list(vec![leaf("mt-equal"), target, cons_of(head_name, tail_name)])),
            ),
        ];
    }
    Vec::new()
}

/// Validate one certificate-supplied instance rule; `Some(problem)` rejects it.
pub fn check_instance_rule(
    registries: &CertificateRegistries,
    generalized: &GeneralizedTheorem,
    entry: &Value,
) -> Option<String> {
    let kind = entry["kind"].as_str().unwrap_or("");
    if !INSTANCE_KINDS.contains(&kind) {
        return Some(format!("unknown instance rule kind {kind}"));
    }
    let Ok(rule) = certificate_term(&entry["rule"]) else {
        return Some(if kind == "local" { "malformed local" } else { "malformed instance rule" }.to_string());
    };
    let parts = items(&rule);
    if kind == "local" {
        let well_formed = parts.len() == 3
            && parts[0] == leaf("local")
            && matches!(&parts[1], Node::Leaf(id) if id.starts_with("local:"))
            && head(&parts[2]) == Some("holds")
            && items(&parts[2]).len() == 2;
        let (true, Some(Node::Leaf(id))) = (well_formed, parts.get(1)) else {
            return Some("malformed local".to_string());
        };
        return has_variable(&parts[2]).then(|| format!("{id}: locals must be ground"));
    }
    let sided = kind == "rewrite";
    let arity = if sided { 5 } else { 4 };
    let well_formed = parts.len() == arity
        && parts[0] == leaf("rule")
        && matches!(&parts[1], Node::Leaf(id) if id.starts_with(&format!("{kind}:")))
        && matches!(&parts[2], Node::List(_));
    if !well_formed {
        return Some("malformed instance rule".to_string());
    }
    let Node::Leaf(id) = &parts[1] else { return Some("malformed instance rule".to_string()) };
    let premises = items(&parts[2]);
    let conclusion = &parts[3];
    if has_variable(&parts[2]) || has_variable(conclusion) || (sided && has_variable(&parts[4])) {
        return Some(format!("{id}: instance rules must be ground"));
    }
    if kind == "induction" || kind == "cases" {
        return check_structural_induction(generalized, entry, kind, id, &parts[2], conclusion);
    }
    if kind == "rewrite" {
        let shaped = premises.len() == 2
            && head(&premises[0]) == Some("holds")
            && items(&premises[0]).len() == 2
            && head(&items(&premises[0])[1]) == Some("mt-equal")
            && items(&items(&premises[0])[1]).len() == 3
            && head(&premises[1]) == Some("holds")
            && items(&premises[1]).len() == 2
            && head(conclusion) == Some("holds")
            && items(conclusion).len() == 2;
        if !shaped {
            return Some(format!("{id}: expects an equation and a holds premise"));
        }
        let equation = items(&items(&premises[0])[1]);
        let (left, right) = (&equation[1], &equation[2]);
        if mentions_local(left) || mentions_local(right) {
            return Some(format!("{id}: rewritten terms must be closed"));
        }
        let (source, target) = (&items(&premises[1])[1], &items(conclusion)[1]);
        let side = |from: &Node, to: &Node| {
            list(vec![leaf("congruent"), from.clone(), to.clone(), source.clone(), target.clone()])
        };
        // Only the shape is checked here; the congruence itself is checked by the linked verifier.
        return (parts[4] != side(left, right) && parts[4] != side(right, left))
            .then(|| format!("{id}: side condition does not restate the rewrite"));
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

/// Check a certificate's instance rules together: each rule alone, unique ids,
/// every local owned by exactly one induction or cases rule that states it,
/// and induction and cases targets typed as the list type the rule names.
pub fn check_instance_rules(
    registries: &CertificateRegistries,
    generalized: &GeneralizedTheorem,
    entries: &[Value],
) -> Vec<String> {
    let mut problems = Vec::new();
    let mut ids = BTreeSet::new();
    let rule_id = |entry: &Value| entry["rule"][1].as_str().unwrap_or("").to_string();
    for entry in entries {
        if let Some(problem) = check_instance_rule(registries, generalized, entry) {
            problems.push(problem);
        }
        let id = rule_id(entry);
        if !ids.insert(id.clone()) {
            problems.push(format!("duplicate instance rule {id}"));
        }
    }
    if !problems.is_empty() {
        return problems;
    }
    let locals: BTreeMap<String, Node> = entries
        .iter()
        .filter(|entry| entry["kind"] == "local")
        .filter_map(|entry| Some((rule_id(entry), certificate_term(&entry["rule"][2]).ok()?)))
        .collect();
    let mut owners: BTreeMap<String, String> = BTreeMap::new();
    for entry in entries {
        for (id, conclusion) in owned_locals(entry) {
            let owner = rule_id(entry);
            if owners.contains_key(&id) {
                problems.push(format!("{id}: discharged by more than one rule"));
            }
            owners.insert(id.clone(), owner.clone());
            match locals.get(&id) {
                None => problems.push(format!("{owner}: missing local {id}")),
                Some(stated) if *stated != conclusion => {
                    problems.push(format!("{id}: local does not state what {owner} assumes"))
                }
                Some(_) => {}
            }
        }
    }
    for id in locals.keys() {
        if !owners.contains_key(id) {
            problems.push(format!("{id}: local has no discharging rule"));
        }
    }
    let declarations = eigen_declarations(registries, generalized, entries);
    for entry in entries {
        let kind = entry["kind"].as_str().unwrap_or("");
        if kind != "induction" && kind != "cases" {
            continue;
        }
        let target = certificate_term(&entry["target"]).unwrap_or_else(|_| leaf(""));
        let name = eigen_name(&target).unwrap_or("");
        let domain = certificate_term(&entry["domain"]).unwrap_or_else(|_| leaf(""));
        let owner = rule_id(entry);
        match declarations.get(name) {
            None => problems.push(format!("{owner}: the type of eigen-constant {name} is not declared")),
            Some(types) if types.is_empty() => {
                problems.push(format!("{owner}: the type of eigen-constant {name} is not declared"))
            }
            Some(types) if types.iter().any(|ty| *ty != domain) => {
                problems.push(format!("{owner}: eigen-constant {name} is not of type {}", entry["domain"]))
            }
            Some(_) => {}
        }
    }
    problems
}

/// Eigenvariable condition on the verified derivation: a forall-intro,
/// induction or cases node may not depend on an undischarged local that
/// mentions the eigen-constants it introduces.
pub fn check_eigen_scopes(entries: &[Value], candidate: &Node) -> Vec<String> {
    let by_id: BTreeMap<&str, &Value> =
        entries.iter().filter_map(|entry| Some((entry["rule"][1].as_str()?, entry))).collect();
    let mut problems = Vec::new();
    let nodes = items(candidate).get(4).map(items).unwrap_or(&[]);
    for node in nodes {
        let parts = items(node);
        let Some(Node::Leaf(rule)) = parts.get(2) else { continue };
        let Some(entry) = by_id.get(rule.as_str()) else { continue };
        let introduced: Vec<&str> = match entry["kind"].as_str().unwrap_or("") {
            "forall-intro" => entry["rule"][3][1][1][1].as_str().into_iter().collect(),
            "induction" | "cases" => [entry["head"].as_str(), entry["tail"].as_str()].into_iter().flatten().collect(),
            _ => Vec::new(),
        };
        for dependency in parts.get(6).map(items).unwrap_or(&[]) {
            let Node::Leaf(dependency) = dependency else { continue };
            let Some(local) = by_id.get(dependency.as_str()) else { continue };
            if local["kind"] != "local" {
                continue;
            }
            let Ok(stated) = certificate_term(&local["rule"][2]) else { continue };
            if introduced.iter().any(|name| occurs(&stated, &eigen(name))) {
                let node_id = match parts.get(1) {
                    Some(Node::Leaf(id)) => id.clone(),
                    _ => String::new(),
                };
                problems.push(format!("{node_id}: eigen-constant escapes through undischarged {dependency}"));
            }
        }
    }
    problems
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
    let entries = certificate["instanceRules"].as_array().cloned().unwrap_or_default();
    problems.extend(check_instance_rules(registries, &generalized, &entries));
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
    for entry in &entries {
        rules.push(certificate_term(&entry["rule"])?);
    }
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
    let reduced = registries.verifier.reduce_result(LINKED_PROOF_NATURAL_PROGRAM, &request, VERIFIER_STEPS)?;
    let verified = head(&reduced.term) == Some("proof-accepted");
    let scopes = if verified { check_eigen_scopes(&entries, &candidate) } else { Vec::new() };
    let accepted = verified && scopes.is_empty();
    Ok(CertificateCheck {
        accepted,
        problems: if accepted {
            Vec::new()
        } else if verified {
            scopes
        } else {
            vec!["linked proof verifier rejected the derivation".to_string()]
        },
        steps: reduced.steps,
    })
}
