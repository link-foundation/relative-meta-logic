//! Mirrors js/tests/linked-proof-outcome.test.mjs over the shared fixtures.

use rml::foundation_workspace::FoundationWorkspace;
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::{
    check_linked_proof, linked_proof_outcome, verify_linked_proof, LinkedProofCheck,
    LinkedProofLimits, LinkedProofOptions, LINKED_PROOF_NATURAL_PROGRAM,
    LINKED_PROOF_OUTCOME_SCHEMA,
};
use rml::Node;
use serde_json::Value;

const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const NATURAL: &str = include_str!("../../lib/meta-theory/proof-verifier-natural.lino");
const CASES: &str = include_str!("../../test-corpus/linked-proof/cases.json");
const NATURAL_CASES: &str = include_str!("../../test-corpus/linked-proof/natural-cases.json");

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("fixture terms contain strings or arrays"),
    }
}

fn leaf(value: &str) -> Node {
    Node::Leaf(value.to_string())
}

fn registry() -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(
        &format!("{UNIVERSAL}\n{VERIFIER}\n{NATURAL}"),
        ExecutionBasis::DirectStructural,
        &[],
    )
    .unwrap()
}

fn sample(name: &str) -> Value {
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    cases.into_iter().find(|case| case["name"] == name).unwrap()
}

fn check(
    registry: &LinkedProgramRegistry,
    case: &Value,
    options: &LinkedProofOptions,
    assumptions: &[&str],
) -> LinkedProofCheck {
    check_linked_proof(
        registry,
        &node(&case["context"]),
        &node(&case["goal"]),
        &node(&case["candidate"]),
        options,
        assumptions,
    )
    .unwrap()
}

#[test]
fn linked_proof_accepted_without_assumptions_is_proved() {
    let registry = registry();
    let checked = check(
        &registry,
        &sample("valid-modus-ponens"),
        &LinkedProofOptions::default(),
        &[],
    );
    assert!(checked.receipt.unwrap().accepted);
    assert_eq!(checked.outcome.schema, LINKED_PROOF_OUTCOME_SCHEMA);
    assert_eq!(checked.outcome.kind, "proved");
    assert_eq!(checked.outcome.truth, "true");
    assert!(checked.outcome.establishes);
    assert!(checked.outcome.assumptions.is_empty());
}

#[test]
fn linked_proof_using_a_declared_assumption_is_assumption_dependent() {
    let registry = registry();
    let checked = check(
        &registry,
        &sample("valid-modus-ponens"),
        &LinkedProofOptions::default(),
        &["p", "unused-rule"],
    );
    assert_eq!(checked.outcome.kind, "assumption-dependent");
    assert_eq!(checked.outcome.status, "proved");
    assert_eq!(checked.outcome.truth, "conditional");
    assert!(checked.outcome.assumption_dependent);
    assert_eq!(checked.outcome.assumptions, vec!["p".to_string()]);
}

#[test]
fn linked_proof_rejection_is_unknown_never_refuted() {
    let registry = registry();
    let forged = sample("forged-root-conclusion");
    let checked = check(&registry, &forged, &LinkedProofOptions::default(), &[]);
    let receipt = checked.receipt.unwrap();
    assert!(!receipt.accepted);
    assert_eq!(checked.outcome.kind, "unknown");
    assert_eq!(checked.outcome.truth, "undetermined");
    assert!(!checked.outcome.establishes);
    let Node::List(result) = &receipt.result else {
        panic!("rejection")
    };
    assert_eq!(leaf(&checked.outcome.reason), result[1]);
    let natural = LinkedProofOptions {
        program: LINKED_PROOF_NATURAL_PROGRAM.to_string(),
        max_steps: 200_000,
        ..LinkedProofOptions::default()
    };
    let base: Vec<Value> = serde_json::from_str(CASES).unwrap();
    let extended: Vec<Value> = serde_json::from_str(NATURAL_CASES).unwrap();
    for (cases, options) in [(base, LinkedProofOptions::default()), (extended, natural)] {
        for case in &cases {
            let checked = check(&registry, case, &options, &[]);
            let kind = checked.outcome.kind;
            let rejected = matches!(&checked.receipt.unwrap().result, Node::List(values)
                if values.first() == Some(&leaf("proof-rejected")));
            // A derivation left without a linked verdict is unsupported, never unknown or refuted.
            let expected = if case["accepted"].as_bool().unwrap() {
                "proved"
            } else if rejected {
                "unknown"
            } else {
                "unsupported"
            };
            assert_eq!(kind, expected, "{}", case["name"]);
        }
    }
}

#[test]
fn linked_proof_spent_bound_is_exhausted() {
    let registry = registry();
    let valid = sample("valid-modus-ponens");
    let stepped = check(
        &registry,
        &valid,
        &LinkedProofOptions {
            max_steps: 5,
            ..LinkedProofOptions::default()
        },
        &[],
    );
    assert!(stepped.receipt.is_none());
    assert_eq!(stepped.outcome.kind, "exhausted");
    assert_eq!(stepped.outcome.reason, "rewrite-limit");
    let bounded = check(
        &registry,
        &valid,
        &LinkedProofOptions {
            input_limits: LinkedProofLimits {
                max_depth: 128,
                max_nodes: 4,
                max_text_bytes: 1_048_576,
            },
            ..LinkedProofOptions::default()
        },
        &[],
    );
    assert_eq!(bounded.outcome.kind, "exhausted");
    assert!(!bounded.outcome.establishes);
}

#[test]
fn linked_proof_malformed_or_verdict_free_result_is_unsupported() {
    let registry = registry();
    let valid = sample("valid-modus-ponens");
    let malformed = check_linked_proof(
        &registry,
        &node(&valid["context"]),
        &node(&valid["goal"]),
        &Node::List(vec![leaf("proof"), leaf("")]),
        &LinkedProofOptions::default(),
        &[],
    )
    .unwrap();
    assert!(malformed.receipt.is_none());
    assert_eq!(malformed.outcome.kind, "unsupported");
    assert_eq!(malformed.outcome.reason, "malformed-input");
    let mut receipt = verify_linked_proof(
        &registry,
        &node(&valid["context"]),
        &node(&valid["goal"]),
        &node(&valid["candidate"]),
        &LinkedProofOptions::default(),
    )
    .unwrap();
    receipt.result = Node::List(vec![leaf("pv-root"), leaf("stuck")]);
    assert_eq!(linked_proof_outcome(&receipt, &[]).kind, "unsupported");
    receipt.result = Node::List(vec![
        leaf("proof-accepted"),
        leaf("not"),
        leaf("quoted"),
        leaf("data"),
    ]);
    assert_eq!(linked_proof_outcome(&receipt, &[]).kind, "unsupported");
}

#[test]
fn linked_proof_relabelled_verdict_follows_the_linked_result() {
    let registry = registry();
    let forged = sample("forged-root-conclusion");
    let mut receipt = verify_linked_proof(
        &registry,
        &node(&forged["context"]),
        &node(&forged["goal"]),
        &node(&forged["candidate"]),
        &LinkedProofOptions::default(),
    )
    .unwrap();
    receipt.accepted = true;
    assert_eq!(linked_proof_outcome(&receipt, &[]).kind, "unknown");
}

#[test]
fn linked_proof_outcomes_use_only_the_shared_contract_kinds() {
    let registry = registry();
    let valid = sample("valid-modus-ponens");
    let forged = sample("forged-root-conclusion");
    let default = LinkedProofOptions::default();
    let mut kinds = vec![
        check(&registry, &valid, &default, &[]).outcome.kind,
        check(&registry, &valid, &default, &["p"]).outcome.kind,
        check(&registry, &forged, &default, &[]).outcome.kind,
        check(
            &registry,
            &valid,
            &LinkedProofOptions {
                max_steps: 5,
                ..LinkedProofOptions::default()
            },
            &[],
        )
        .outcome
        .kind,
        check_linked_proof(
            &registry,
            &node(&valid["context"]),
            &node(&valid["goal"]),
            &Node::List(vec![leaf("proof"), leaf("")]),
            &default,
            &[],
        )
        .unwrap()
        .outcome
        .kind,
    ];
    kinds.sort();
    kinds.dedup();
    assert_eq!(
        kinds,
        vec![
            "assumption-dependent",
            "exhausted",
            "proved",
            "unknown",
            "unsupported"
        ]
    );
    let contract: Vec<&str> = FoundationWorkspace::outcomes()
        .iter()
        .map(|outcome| outcome.kind)
        .collect();
    for kind in &kinds {
        assert!(contract.contains(kind), "{kind}");
    }
    assert!(!kinds.contains(&"refuted") && !kinds.contains(&"contradictory"));
}
