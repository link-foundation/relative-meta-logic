//! Generic typed eliminator obligations, independent of source function names.
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::Node;
use serde_json::Value;

fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("term data must be strings or arrays"),
    }
}
#[test]
fn independently_checks_all_37_typed_structural_recursion_obligations() {
    let data: Value = serde_json::from_str(include_str!(
        "../../test-corpus/formal-recursion/cases.json"
    ))
    .unwrap();
    let source = [
        include_str!("../../lib/meta-theory/formal-semantics.lino"),
        include_str!("../../lib/meta-theory/formal-indexed.lino"),
        include_str!("../../lib/meta-theory/formal-records.lino"),
        include_str!("../../lib/meta-theory/formal-recursion.lino"),
        "(linked-program formal-recursion-replay (uses formal-recursion) (uses formal-indexed) (uses formal-records) (uses formal-semantics))",
    ].join("\n");
    let registry =
        LinkedProgramRegistry::from_rml_with_basis(&source, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let cases = data["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 37);
    for example in cases {
        let actual = registry
            .reduce(
                "formal-recursion-replay",
                &node(&example["request"]),
                50_000,
            )
            .unwrap();
        if example["accepted"] == true {
            assert_eq!(
                actual.term,
                node(&example["expected"]),
                "{}",
                example["name"]
            );
        } else {
            assert!(
                !matches!(&actual.term, Node::List(parts) if parts.first() == Some(&Node::Leaf("fs-ok".to_string()))),
                "{}",
                example["name"]
            );
        }
    }
}
