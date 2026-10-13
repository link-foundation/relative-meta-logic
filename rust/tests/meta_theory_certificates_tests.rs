//! Independently re-check the meta-theory proof certificates in Rust.
//! Certificates are produced from preserved source proofs by
//! scripts/generate-meta-theory-certificates.mjs (the producer is untrusted).
//! This mirror rebuilds every logical part of the context itself: theorem and
//! lemma statements from the native linked program, generalization into
//! eigen-constants and hypotheses, lemma rules for recorded theorem
//! dependencies only, and checks each instance rule (conversion by
//! normalization, eigen freshness, witnessed bodies) before running the shared
//! linked proof verifier.
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::{encode_linked_proof_data_with_limits, LinkedProofLimits, LINKED_PROOF_PROGRAM};
use rml::Node;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const PRELUDE: &str = include_str!("../../lib/meta-theory/meta-theory-native-prelude.lino");
const PROGRAM: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native.lino");
const CONVERSION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native-conversion.lino");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-certificates/certificates.json");
const COVERAGE: &str = include_str!("../../test-corpus/meta-theory-native/coverage.json");
const NATIVE_PROGRAM: &str = "upstream-0.0.3-native";
const CONVERSION_PROGRAM: &str = "upstream-0.0.3-native-conversion";
const SCHEMA: &str = "rml-meta-theory-certificate/v1";
const MAX_STEPS: usize = 200_000;
const VERIFIER_STEPS: usize = 2_000_000;
const CONNECTIVES: &[&str] = &[
    "mt-equal", "mt-not-equal", "mt-and", "mt-or", "mt-not", "mt-iff", "mt-less", "mt-less-equal",
    "mt-member", "mt-forall", "mt-exists",
];
const LEAN_SET: &str = "rml.formal.lean.SetSequenceEquivalence.set_sequence_equivalence";
const ROCQ_HEAD: &str = "rml.formal.rocq.SetSequenceEquivalence.strictly_ascending_head";

fn on_large_stack<F: FnOnce() + Send + 'static>(run: F) {
    std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

fn list(items: Vec<Node>) -> Node {
    Node::List(items)
}

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(children) => Node::List(children.iter().map(node).collect()),
        _ => panic!("certificate terms contain strings and arrays only"),
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

fn eigen(bound: &str) -> Node {
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

struct Registries {
    native: LinkedProgramRegistry,
    verifier: LinkedProgramRegistry,
}

fn registries(conversion: &str) -> Registries {
    Registries {
        native: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{PRELUDE}\n{PROGRAM}\n{conversion}"),
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap(),
        verifier: LinkedProgramRegistry::from_rml_with_basis(
            &format!("{UNIVERSAL}\n{VERIFIER}"),
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap(),
    }
}

fn normalize(registry: &LinkedProgramRegistry, program: &str, term: &Node) -> Option<Node> {
    registry.reduce_result(program, term, MAX_STEPS).ok().map(|summary| summary.term)
}

fn theorem_statement(registries: &Registries, address: &str) -> Node {
    let request = list(vec![leaf("mt-statement"), leaf(address)]);
    normalize(&registries.native, NATIVE_PROGRAM, &request).expect("statement normalizes")
}

/// A prelude connective, or an application whose declared result type is Prop
/// after consuming the remaining arguments through arrow types.
fn is_hypothesis_type(registries: &Registries, ty: &Node) -> bool {
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
        let Some(result) = normalize(&registries.native, NATIVE_PROGRAM, &list(request)) else { continue };
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

struct Binder {
    bound: String,
    ty: Node,
    hypothesis: bool,
}

fn statement_binders(registries: &Registries, statement: &Node) -> (Vec<Binder>, Node) {
    let mut binders = Vec::new();
    let mut body = statement.clone();
    let mut premises = 0;
    loop {
        let parts = items(&body).to_vec();
        if parts.len() == 3 && parts[0] == leaf("mt-forall") && head(&parts[1]) == Some("mt-binder") {
            let binder = items(&parts[1]);
            let Node::Leaf(bound) = &binder[1] else { panic!("binder names are leaves") };
            let ty = binder[2].clone();
            let hypothesis = is_hypothesis_type(registries, &ty);
            binders.push(Binder { bound: bound.clone(), ty, hypothesis });
            body = parts[2].clone();
        } else if parts.len() == 3 && parts[0] == leaf("mt-arrow") && is_hypothesis_type(registries, &parts[1]) {
            binders.push(Binder { bound: format!("mt-premise-{premises}"), ty: parts[1].clone(), hypothesis: true });
            premises += 1;
            body = parts[2].clone();
        } else {
            return (binders, body);
        }
    }
}

struct Generalized {
    statement: Node,
    goal: Node,
    hypotheses: Vec<Node>,
}

fn generalize(registries: &Registries, address: &str) -> Generalized {
    let statement = theorem_statement(registries, address);
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
    Generalized { statement, goal, hypotheses }
}

fn lemma_rule(registries: &Registries, address: &str) -> Node {
    let (binders, body) = statement_binders(registries, &theorem_statement(registries, address));
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
    list(vec![leaf("rule"), Node::Leaf(format!("lemma:{address}")), list(premises), holds(open(&body))])
}

fn structural_rules() -> Vec<Node> {
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

fn check_instance_rule(registries: &Registries, generalized: &Generalized, entry: &Value) -> Option<String> {
    let kind = entry["kind"].as_str().unwrap_or("");
    let rule = node(&entry["rule"]);
    let parts = items(&rule);
    let well_formed = parts.len() == 4
        && parts[0] == leaf("rule")
        && matches!(&parts[1], Node::Leaf(id) if id.starts_with(&format!("{kind}:")))
        && matches!(&parts[2], Node::List(_));
    if !well_formed {
        return Some("malformed instance rule".to_string());
    }
    let Node::Leaf(id) = &parts[1] else { unreachable!() };
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
    if premises.len() != 1 || head(&premises[0]) != Some("holds") || head(conclusion) != Some("holds") {
        return Some(format!("{id}: expects one holds premise"));
    }
    let premise = &items(&premises[0])[1];
    let target = &items(conclusion)[1];
    match kind {
        "conversion" => {
            let left = normalize(&registries.native, CONVERSION_PROGRAM, premise);
            let right = normalize(&registries.native, CONVERSION_PROGRAM, target);
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
            let Node::Leaf(bound) = &items(&quantified[1])[1] else {
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
            if entry["witness"].is_null() {
                return Some(format!("{id}: missing ground witness"));
            }
            let witness = node(&entry["witness"]);
            if has_variable(&witness) {
                return Some(format!("{id}: missing ground witness"));
            }
            if premise == &substitute_local(&quantified[2], bound, &witness) {
                None
            } else {
                Some(format!("{id}: premise is not the witnessed body"))
            }
        }
        _ => Some(format!("{id}: unknown instance rule kind {kind}")),
    }
}

struct Checked {
    accepted: bool,
    problems: Vec<String>,
    steps: usize,
}

fn check(registries: &Registries, certificate: &Value, dependencies: &[String]) -> Checked {
    let rejected = |problems: Vec<String>| Checked { accepted: false, problems, steps: 0 };
    if certificate["schema"].as_str() != Some(SCHEMA) {
        return rejected(vec!["unsupported certificate schema".to_string()]);
    }
    let address = certificate["theorem"].as_str().unwrap_or("");
    let mut problems = Vec::new();
    if dependencies.iter().any(|item| item == address) {
        problems.push("a theorem cannot cite itself".to_string());
    }
    let generalized = generalize(registries, address);
    if generalized.statement != node(&certificate["statement"]) {
        problems.push("statement differs from the native elaboration".to_string());
    }
    if generalized.goal != node(&certificate["goal"]) {
        problems.push("goal differs from the generalized statement".to_string());
    }
    let mut ids = BTreeSet::new();
    let entries = certificate["instanceRules"].as_array().cloned().unwrap_or_default();
    for entry in &entries {
        if let Some(problem) = check_instance_rule(registries, &generalized, entry) {
            problems.push(problem);
        }
        let id = entry["rule"][1].as_str().unwrap_or("").to_string();
        if !ids.insert(id.clone()) {
            problems.push(format!("duplicate instance rule {id}"));
        }
    }
    for cited in certificate["cites"].as_array().cloned().unwrap_or_default() {
        let cited = cited.as_str().unwrap_or("").to_string();
        if !dependencies.contains(&cited) {
            problems.push(format!("cites {cited}, which is not a recorded theorem dependency"));
        }
    }
    if !problems.is_empty() {
        return rejected(problems);
    }
    let mut sorted = dependencies.to_vec();
    sorted.sort();
    let mut rules = structural_rules();
    rules.extend(generalized.hypotheses.iter().cloned());
    rules.extend(sorted.iter().map(|dependency| lemma_rule(registries, dependency)));
    rules.extend(entries.iter().map(|entry| node(&entry["rule"])));
    let context = list(vec![
        leaf("proof-context"),
        list(vec![leaf("rml-meta-theory"), leaf(address)]),
        list(rules),
    ]);
    let limits = LinkedProofLimits::for_receipt();
    let request = list(vec![
        leaf("verify-linked-proof"),
        encode_linked_proof_data_with_limits(&context, &limits).unwrap(),
        encode_linked_proof_data_with_limits(&generalized.goal, &limits).unwrap(),
        encode_linked_proof_data_with_limits(&node(&certificate["candidate"]), &limits).unwrap(),
    ]);
    let reduced = registries
        .verifier
        .reduce_result(LINKED_PROOF_PROGRAM, &request, VERIFIER_STEPS)
        .unwrap();
    let accepted = head(&reduced.term) == Some("proof-accepted");
    Checked {
        accepted,
        problems: if accepted { Vec::new() } else { vec!["linked proof verifier rejected the derivation".to_string()] },
        steps: reduced.steps,
    }
}

/// Recorded theorem dependencies, read from the native coverage listing.
fn theorem_dependencies(coverage: &Value) -> BTreeMap<String, Vec<String>> {
    let declarations = coverage["declarations"].as_array().unwrap();
    let theorems: BTreeSet<&str> = declarations
        .iter()
        .filter(|entry| entry["kind"] == "theorem")
        .map(|entry| entry["address"].as_str().unwrap())
        .collect();
    declarations
        .iter()
        .map(|entry| {
            let references: Vec<String> = entry["references"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item.as_str().unwrap())
                .filter(|item| theorems.contains(item))
                .map(str::to_string)
                .collect();
            (entry["address"].as_str().unwrap().to_string(), references)
        })
        .collect()
}

struct Fixture {
    data: Value,
    dependencies: BTreeMap<String, Vec<String>>,
    registries: Registries,
}

fn fixture() -> Fixture {
    Fixture {
        data: serde_json::from_str(CERTIFICATES).unwrap(),
        dependencies: theorem_dependencies(&serde_json::from_str(COVERAGE).unwrap()),
        registries: registries(CONVERSION),
    }
}

impl Fixture {
    fn record(&self, address: &str) -> &Value {
        self.data["theorems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["theorem"] == address)
            .unwrap()
    }

    fn certificate(&self, address: &str) -> Value {
        self.record(address)["certificate"].clone()
    }

    fn check(&self, certificate: &Value) -> Checked {
        let address = certificate["theorem"].as_str().unwrap();
        check(&self.registries, certificate, &self.dependencies[address])
    }

    fn rejected(&self, certificate: &Value, expected: &str) {
        let checked = self.check(certificate);
        assert!(!checked.accepted);
        assert!(
            checked.problems.iter().any(|problem| problem.contains(expected)),
            "{:?} lacks {expected}",
            checked.problems
        );
    }
}

fn candidate_nodes(certificate: &mut Value) -> &mut Vec<Value> {
    certificate["candidate"][4].as_array_mut().unwrap()
}

#[test]
fn rechecks_every_certified_theorem_with_the_linked_verifier() {
    on_large_stack(|| {
        let fixture = fixture();
        assert_eq!(fixture.data["theoremCount"], 36);
        assert_eq!(fixture.data["certified"], 14);
        assert_eq!(fixture.data["certifiedClosed"], 4);
        let mut certified = 0;
        for item in fixture.data["theorems"].as_array().unwrap() {
            if item["upstreamProofStatus"] == "admitted" {
                assert_eq!(item["status"], "outside-fragment");
            }
            if item["status"] != "certified" {
                assert!(item["certificate"].is_null());
                continue;
            }
            certified += 1;
            let checked = fixture.check(&item["certificate"]);
            assert!(checked.accepted, "{}: {:?}", item["theorem"], checked.problems);
            assert_eq!(checked.steps as u64, item["verifierSteps"].as_u64().unwrap(), "{}", item["theorem"]);
        }
        assert_eq!(certified, 14);
    });
}

#[test]
fn rejects_a_corrupted_definition_body_used_by_a_conversion() {
    on_large_stack(|| {
        let mut fixture = fixture();
        let body = "(to (rml.formal.lean.SetSequenceEquivalence.StrictlyAscending ?v0)))";
        assert!(CONVERSION.contains(body));
        let corrupted = CONVERSION.replacen(body, "(to (rml.formal.lean.SetSequenceEquivalence.NoDuplicates ?v0)))", 1);
        fixture.registries = registries(&corrupted);
        fixture.rejected(&fixture.certificate(LEAN_SET), "not convertible");
    });
}

#[test]
fn rejects_binder_mutations() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut opened = fixture.certificate(LEAN_SET);
        for entry in opened["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "forall-intro" {
                let text = serde_json::to_string(&entry["rule"][2]).unwrap().replace("\"mt-bound-2\"", "\"mt-bound-0\"");
                entry["rule"][2] = serde_json::from_str(&text).unwrap();
                break;
            }
        }
        fixture.rejected(&opened, "premise is not the opened body");

        let mut instance = fixture.certificate(LEAN_SET);
        for entry in instance["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "instance" && entry["rule"][3][1] != "refl" {
                let swapped = if entry["rule"][3][2] == "mt-bound-0" { "mt-bound-1" } else { "mt-bound-0" };
                entry["rule"][3][2] = Value::String(swapped.to_string());
                break;
            }
        }
        fixture.rejected(&instance, "verifier rejected");
    });
}

#[test]
fn rejects_removed_premises_substituted_rules_and_edited_conclusions() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut premise = fixture.certificate(LEAN_SET);
        for item in candidate_nodes(&mut premise).iter_mut() {
            let premises = item[5].as_array_mut().unwrap();
            if premises.len() > 1 {
                premises.remove(0);
                break;
            }
        }
        fixture.rejected(&premise, "verifier rejected");

        let mut swapped = fixture.certificate(LEAN_SET);
        for item in candidate_nodes(&mut swapped).iter_mut() {
            let rule = item[2].as_str().unwrap().to_string();
            if rule.starts_with("lemma:") {
                let replacement = if rule.ends_with("mem_toOrderedUnique") {
                    "lemma:rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending"
                } else {
                    "lemma:rml.formal.lean.SetSequenceEquivalence.mem_toOrderedUnique"
                };
                item[2] = Value::String(replacement.to_string());
                break;
            }
        }
        fixture.rejected(&swapped, "verifier rejected");

        let mut conclusion = fixture.certificate(ROCQ_HEAD);
        for item in candidate_nodes(&mut conclusion).iter_mut() {
            if item[2].as_str().unwrap().starts_with("hypothesis:") {
                item[3] = serde_json::json!(["holds", ["mt-v", "mt-true"]]);
                break;
            }
        }
        fixture.rejected(&conclusion, "verifier rejected");
    });
}

#[test]
fn rejects_edited_goals_statements_and_forged_conversions() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut goal = fixture.certificate(ROCQ_HEAD);
        goal["goal"] = serde_json::json!(["holds", ["mt-v", "mt-true"]]);
        fixture.rejected(&goal, "goal differs");

        let mut statement = fixture.certificate(ROCQ_HEAD);
        statement["statement"] = serde_json::json!(["mt-v", "mt-true"]);
        fixture.rejected(&statement, "statement differs");

        let mut forged = fixture.certificate(ROCQ_HEAD);
        for entry in forged["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "conversion" {
                entry["rule"][2] = serde_json::json!([["holds", ["mt-v", "mt-true"]]]);
                break;
            }
        }
        fixture.rejected(&forged, "not convertible");
    });
}

#[test]
fn rejects_undeclared_dependencies_self_citation_and_edited_dependency_lists() {
    on_large_stack(|| {
        let fixture = fixture();
        let certificate = fixture.certificate(LEAN_SET);
        let dependencies = fixture.dependencies[LEAN_SET].clone();
        let without: Vec<String> = dependencies
            .iter()
            .filter(|item| !item.ends_with("mem_toOrderedUnique"))
            .cloned()
            .collect();
        let checked = check(&fixture.registries, &certificate, &without);
        assert!(!checked.accepted);
        assert!(checked.problems.iter().any(|problem| problem.contains("not a recorded theorem dependency")));

        let mut with_self = dependencies.clone();
        with_self.push(LEAN_SET.to_string());
        let checked = check(&fixture.registries, &certificate, &with_self);
        assert!(checked.problems.iter().any(|problem| problem.contains("cannot cite itself")));

        let mut edited = certificate.clone();
        edited["candidate"][5].as_array_mut().unwrap().pop();
        fixture.rejected(&edited, "verifier rejected");
    });
}
