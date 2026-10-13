//! Shared linked-kernel replay. Source elaboration currently belongs to the JS
//! adapter; these tests independently execute its source-bound requests in Rust.
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::Node;
use serde_json::Value;
use std::collections::BTreeMap;

const KERNEL: &str = include_str!("../../lib/meta-theory/formal-semantics.lino");
const CASES: &str = include_str!("../../test-corpus/formal-semantics/cases.json");
const COVERAGE: &str = include_str!("../../test-corpus/formal-semantics/coverage.json");

fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("formal semantic fixture terms contain strings and arrays only"),
    }
}

// This is transport/context binding, not a typing rule: every type and value
// must equal the result of a preceding execution of the linked type checker.
fn context_is_checked(globals: &Node, checked: &BTreeMap<String, (Node, Node)>) -> bool {
    let mut tail = globals;
    let mut names = std::collections::BTreeSet::new();
    loop {
        match tail {
            Node::Leaf(name) => return name == "fs-empty",
            Node::List(values) => match values.as_slice() {
                [Node::Leaf(tag), Node::Leaf(name), ty, value, rest] if tag == "fs-global-bind" => {
                    if !names.insert(name.clone())
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

#[test]
fn replays_source_bound_formal_semantics_and_mutations() {
    let registry =
        LinkedProgramRegistry::from_rml_with_basis(KERNEL, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let fixtures: Value = serde_json::from_str(CASES).unwrap();
    let cases = fixtures["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 56);
    let mut checked = BTreeMap::new();
    for case in cases {
        let request = node(&case["request"]);
        let Node::List(parts) = &request else {
            panic!("request must be a list");
        };
        let globals = parts.last().unwrap();
        assert!(
            context_is_checked(globals, &checked),
            "{} has unchecked global authority",
            case["name"]
        );
        let result = registry
            .reduce("formal-semantics", &request, 50_000)
            .unwrap();
        assert_eq!(result.term, node(&case["expected"]), "{}", case["name"]);
        assert_eq!(
            result.trace.len(),
            case["steps"].as_u64().unwrap() as usize,
            "{}",
            case["name"]
        );
        let accepted = if case["kind"] == "evaluation" || case["kind"] == "definition" {
            matches!(&result.term, Node::List(values) if values.first() == Some(&Node::Leaf("fs-ok".to_string())))
        } else {
            result.term == Node::Leaf("fs-proof-accepted".to_string())
        };
        assert_eq!(
            accepted,
            case["accepted"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        if case["kind"] == "definition" {
            let Node::List(values) = result.term else {
                panic!("checked definition must have a type and value");
            };
            assert_eq!(values.len(), 3);
            assert_eq!(values[0], Node::Leaf("fs-ok".to_string()));
            assert!(checked
                .insert(
                    case["address"].as_str().unwrap().to_string(),
                    (values[1].clone(), values[2].clone())
                )
                .is_none());
        }
    }
    assert_eq!(checked.len(), 38);
    assert!(!context_is_checked(
        &node(&serde_json::json!([
            "fs-global-bind",
            "fabricated",
            "fs-t-nat",
            "fs-v-zero",
            "fs-empty"
        ])),
        &checked
    ));
    let known = checked.keys().next().unwrap();
    assert!(!context_is_checked(
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
fn never_relabels_partial_source_semantics_as_corpus_completion() {
    let coverage: Value = serde_json::from_str(COVERAGE).unwrap();
    assert_eq!(coverage["declarationCount"], 229);
    assert_eq!(coverage["checkedDefinitions"], 38);
    assert_eq!(coverage["replayedProofs"], 2);
    assert_eq!(coverage["upstreamAdmissions"], 4);
    assert_eq!(coverage["fullCorpusVerified"], false);
    assert_eq!(coverage["declarations"].as_array().unwrap().len(), 229);
}

#[test]
fn changed_linked_conversion_rule_changes_rust_verdict() {
    let altered = KERNEL.replace(
        "(to fs-proof-accepted)",
        "(to (fs-error disabled-proof-rule))",
    );
    assert_ne!(KERNEL, altered);
    let registry =
        LinkedProgramRegistry::from_rml_with_basis(&altered, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let fixtures: Value = serde_json::from_str(CASES).unwrap();
    let case = fixtures["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "lean-source-identity-proof")
        .unwrap();
    let result = registry
        .reduce("formal-semantics", &node(&case["request"]), 50_000)
        .unwrap();
    assert_ne!(result.term, Node::Leaf("fs-proof-accepted".to_string()));
}
