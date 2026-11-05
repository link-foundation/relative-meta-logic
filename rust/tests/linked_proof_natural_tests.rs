//! Mirrors js/tests/linked-proof-natural.test.mjs over the shared fixtures.

use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::{
    verify_linked_proof, LinkedProofOptions, LinkedProofReceipt, LINKED_PROOF_NATURAL_PROGRAM,
    LINKED_PROOF_PROGRAM,
};
use rml::Node;
use serde_json::Value;

const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const NATURAL: &str = include_str!("../../lib/meta-theory/proof-verifier-natural.lino");
const CASES: &str = include_str!("../../test-corpus/linked-proof/natural-cases.json");
const BASE_CASES: &str = include_str!("../../test-corpus/linked-proof/cases.json");

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("fixture terms contain strings or arrays"),
    }
}

fn registry() -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(
        &format!("{UNIVERSAL}\n{VERIFIER}\n{NATURAL}"),
        ExecutionBasis::DirectStructural,
        &[],
    )
    .unwrap()
}

fn verify(registry: &LinkedProgramRegistry, case: &Value, program: &str) -> LinkedProofReceipt {
    let options = LinkedProofOptions {
        program: program.to_string(),
        max_steps: 200_000,
        ..LinkedProofOptions::default()
    };
    verify_linked_proof(
        registry,
        &node(&case["context"]),
        &node(&case["goal"]),
        &node(&case["candidate"]),
        &options,
    )
    .unwrap()
}

fn head(term: &Node) -> Option<&str> {
    match term {
        Node::List(values) => match values.first() {
            Some(Node::Leaf(head)) => Some(head.as_str()),
            _ => None,
        },
        Node::Leaf(_) => None,
    }
}

#[test]
fn natural_deduction_fixture_verdicts_and_reasons() {
    let registry = registry();
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    assert_eq!(cases.len(), 13);
    for case in &cases {
        let result = verify(&registry, case, LINKED_PROOF_NATURAL_PROGRAM);
        let accepted = case["accepted"].as_bool().unwrap();
        assert_eq!(
            result.accepted, accepted,
            "{}: {}",
            case["name"], result.result
        );
        if accepted {
            assert_eq!(
                head(&result.result),
                Some("proof-accepted"),
                "{}",
                case["name"]
            );
        } else {
            let reason = case["reason"].as_str().unwrap();
            assert_eq!(
                result.result,
                Node::List(vec![
                    Node::Leaf("proof-rejected".to_string()),
                    Node::Leaf(reason.to_string()),
                ]),
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn natural_verifier_keeps_every_base_verdict_and_reason() {
    let registry = registry();
    let cases: Vec<Value> = serde_json::from_str(BASE_CASES).unwrap();
    for case in &cases {
        let base = verify(&registry, case, LINKED_PROOF_PROGRAM);
        let extended = verify(&registry, case, LINKED_PROOF_NATURAL_PROGRAM);
        assert_eq!(extended.accepted, base.accepted, "{}", case["name"]);
        let verdict = |result: &Node| match head(result) {
            Some("proof-accepted") => "proof-accepted",
            Some("proof-rejected") => "proof-rejected",
            _ => "no-verdict",
        };
        // A base derivation without a verdict (an unbound conclusion variable) stays without one.
        assert_eq!(
            verdict(&extended.result),
            verdict(&base.result),
            "{}",
            case["name"]
        );
        if verdict(&base.result) == "proof-rejected" {
            assert_eq!(extended.result, base.result, "{}", case["name"]);
        }
    }
}

#[test]
fn base_verifier_rejects_natural_derivations() {
    let registry = registry();
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    for case in cases
        .iter()
        .filter(|case| case["accepted"].as_bool() == Some(true))
    {
        assert!(
            !verify(&registry, case, LINKED_PROOF_PROGRAM).accepted,
            "{}",
            case["name"]
        );
    }
}

#[test]
fn natural_discharge_and_closure_run_as_linked_rules() {
    let declared: Vec<&str> = NATURAL
        .lines()
        .filter_map(|line| line.strip_prefix("(linked-rewrite linked-proof-verifier-natural "))
        .filter_map(|rest| rest.split_whitespace().next())
        .collect();
    for name in [
        "premises-discharge",
        "discharge-local",
        "discharge-invalid",
        "side-congruent",
        "cong-replace",
        "cong-spine-pair",
        "closed-local",
        "root-open",
    ] {
        assert!(declared.contains(&name), "{name}");
    }
    let registry = registry();
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    let case = cases
        .iter()
        .find(|case| case["name"] == "induction-discharges-its-hypothesis")
        .unwrap();
    let result = verify(&registry, case, LINKED_PROOF_NATURAL_PROGRAM);
    let Node::List(trace) = &result.trace else {
        panic!("linked trace")
    };
    let used: Vec<String> = trace
        .iter()
        .skip(1)
        .filter_map(|step| match step {
            Node::List(parts) => match (parts.get(1), parts.get(2)) {
                (Some(Node::Leaf(program)), Some(Node::Leaf(rule))) => {
                    Some(format!("{program}.{rule}"))
                }
                _ => None,
            },
            Node::Leaf(_) => None,
        })
        .collect();
    for name in [
        "premises-discharge",
        "discharge-local",
        "remove-head",
        "closed-step",
        "root-closed",
    ] {
        let qualified = format!("linked-proof-verifier-natural.{name}");
        assert!(used.contains(&qualified), "{qualified}");
    }
}
