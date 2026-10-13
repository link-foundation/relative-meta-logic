//! Independently recheck all source-produced proposition obligations in Rust.
//! The shared source parser is currently JavaScript; no native prover is used.
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::Node;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const CORE: &str = include_str!("../../lib/meta-theory/formal-semantics.lino");
const INDEXED: &str = include_str!("../../lib/meta-theory/formal-indexed.lino");
const RECORDS: &str = include_str!("../../lib/meta-theory/formal-records.lino");
const PROPOSITIONS: &str = include_str!("../../lib/meta-theory/formal-propositions.lino");
const CASES: &str = include_str!("../../test-corpus/formal-propositions/cases.json");
const COVERAGE: &str = include_str!("../../test-corpus/formal-propositions/coverage.json");

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(children) => Node::List(children.iter().map(node).collect()),
        _ => panic!("fixture terms must contain strings and arrays only"),
    }
}

fn checked_environment(environment: &Node, checked: &BTreeMap<String, (Node, Node)>) -> bool {
    let mut tail = environment;
    let mut seen = BTreeSet::new();
    loop {
        match tail {
            Node::Leaf(end) => return end == "fs-empty",
            Node::List(values) => match values.as_slice() {
                [Node::Leaf(tag), Node::Leaf(name), ty, value, rest] if tag == "fs-global-bind" => {
                    if !seen.insert(name.clone())
                        || !checked.get(name).is_some_and(|(known_type, known_value)| {
                            known_type == ty && known_value == value
                        })
                    {
                        return false;
                    }
                    tail = rest;
                }
                _ => return false,
            },
        }
    }
}

fn program(propositions: &str) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(
        &format!("{CORE}\n{INDEXED}\n{RECORDS}\n{propositions}\n(linked-program formal-proposition-checker (uses formal-propositions) (uses formal-indexed) (uses formal-records) (uses formal-semantics))"),
        ExecutionBasis::DirectStructural,
        &[],
    ).unwrap()
}

#[test]
fn rechecks_all_70_definitions_and_88_source_bound_requests() {
    let registry = program(PROPOSITIONS);
    let data: Value = serde_json::from_str(CASES).unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 88);
    let mut checked = BTreeMap::new();
    for case in cases {
        let request = node(&case["request"]);
        let Node::List(parts) = &request else {
            panic!("request must be a link");
        };
        assert!(
            checked_environment(parts.last().unwrap(), &checked),
            "{} imported unchecked type/value authority",
            case["name"]
        );
        let result = registry
            .reduce("formal-proposition-checker", &request, 50_000)
            .unwrap();
        assert_eq!(result.term, node(&case["expected"]), "{}", case["name"]);
        assert_eq!(
            result.trace.len(),
            case["steps"].as_u64().unwrap() as usize,
            "{}",
            case["name"]
        );
        let accepted = if case["kind"] == "conversion-proof" {
            result.term == Node::Leaf("fs-proof-accepted".to_string())
        } else {
            matches!(&result.term, Node::List(parts) if parts.first() == Some(&Node::Leaf("fs-ok".to_string())))
        };
        assert_eq!(
            accepted,
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        if case["kind"] == "definition" {
            let Node::List(parts) = result.term else {
                panic!("definition result must be a link");
            };
            assert!(accepted);
            assert!(checked
                .insert(
                    case["address"].as_str().unwrap().to_string(),
                    (parts[1].clone(), parts[2].clone())
                )
                .is_none());
        }
    }
    assert_eq!(checked.len(), 70);
    let known = checked.keys().next().unwrap();
    assert!(!checked_environment(
        &node(&serde_json::json!([
            "fs-global-bind",
            known,
            "forged-type",
            "forged-value",
            "fs-empty"
        ])),
        &checked
    ));
}

#[test]
fn whole_corpus_and_generated_traits_remain_explicitly_open() {
    let coverage: Value = serde_json::from_str(COVERAGE).unwrap();
    assert_eq!(coverage["declarationCount"], 229);
    assert_eq!(coverage["checkedDefinitions"], 70);
    assert_eq!(coverage["replayedProofs"], 2);
    assert_eq!(coverage["upstreamAdmissions"], 4);
    assert_eq!(coverage["fullCorpusVerified"], false);
    assert_eq!(
        coverage["pendingGeneratedTraits"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        coverage["declarations"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["address"]
                .as_str()
                .unwrap()
                .contains(".NetworkDefinitions.")
                && entry["status"] == "definition-checked")
            .count(),
        42
    );
}

#[test]
fn missing_linked_proposition_semantics_revokes_predicate_formation() {
    let data: Value = serde_json::from_str(CASES).unwrap();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["address"] == "rml.formal.lean.NetworkEquivalence.TupleFunctionEquivalence"
                && case["kind"] == "definition"
        })
        .unwrap();
    let result = program("(linked-program formal-propositions)")
        .reduce(
            "formal-proposition-checker",
            &node(&case["request"]),
            50_000,
        )
        .unwrap();
    assert_ne!(result.term, node(&case["expected"]));
    assert!(
        !matches!(&result.term, Node::List(parts) if parts.first() == Some(&Node::Leaf("fs-ok".to_string())))
    );
}

#[test]
fn false_equality_is_a_proposition_without_a_reflexivity_proof() {
    let registry = program(PROPOSITIONS);
    let equality = serde_json::json!(["fs-equal", ["fs-zero"], ["fs-successor", ["fs-zero"]]]);
    let inferred = registry
        .reduce(
            "formal-proposition-checker",
            &node(&serde_json::json!([
                "fs-infer", equality, "fs-empty", "fs-empty"
            ])),
            50_000,
        )
        .unwrap();
    assert_eq!(
        inferred.term,
        node(&serde_json::json!([
            "fs-ok",
            "fs-t-prop",
            [
                "fs-v-equality",
                "fs-t-nat",
                "fs-v-zero",
                ["fs-v-successor", "fs-v-zero"]
            ]
        ]))
    );
    let proof = registry
        .reduce(
            "formal-proposition-checker",
            &node(&serde_json::json!([
                "fs-prove",
                equality,
                ["fs-proof-refl"],
                "fs-empty",
                "fs-empty"
            ])),
            50_000,
        )
        .unwrap();
    assert_eq!(
        proof.term,
        node(&serde_json::json!(["fs-error", "unequal-normal-forms"]))
    );
}
