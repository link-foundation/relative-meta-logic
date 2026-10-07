use rml_relational::horn_resolution::{Options, Proof};
use rml_relational::relational_kernel::{RelationalKernel, SOURCE};
use rml_relational::Node;
use serde_json::Value;
fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("invalid receipt term"),
    }
}
fn proof(value: &Value) -> Proof {
    Proof {
        clause: value["clause"].as_str().unwrap().into(),
        goal: node(&value["goal"]),
        premises: value["premises"]
            .as_array()
            .unwrap()
            .iter()
            .map(proof)
            .collect(),
    }
}
fn replay(source: &str) {
    let receipt: Value = serde_json::from_str(source).unwrap();
    let kernel = RelationalKernel::from_source(SOURCE).unwrap();
    assert_eq!(
        receipt["trust"],
        rml_relational::horn_resolution::trust_report()
    );
    let options = Options {
        max_steps: 100_000_000,
        ..Options::default()
    };
    let direct = kernel
        .resolver()
        .replay(
            &node(&receipt["direct"]["query"]),
            &proof(&receipt["direct"]["proof"]),
            &options,
        )
        .unwrap();
    assert!(direct.accepted);
    let Node::List(goal) = direct.goal.unwrap() else {
        panic!()
    };
    assert_eq!(goal.last().unwrap(), &node(&receipt["direct"]["value"]));
    let interpreted = kernel
        .self_replay(
            &node(&receipt["interpreted"]["query"]),
            &node(&receipt["interpreted"]["certificate"]),
            &options,
        )
        .unwrap()
        .unwrap();
    assert_eq!(interpreted, node(&receipt["interpreted"]["goal"]));
}
#[test]
fn independently_replays_javascript_receipts() {
    replay(include_str!(
        "../../../test-corpus/relational-kernel/js-receipt.json"
    ));
}
#[test]
fn independently_replays_rust_receipts() {
    replay(include_str!(
        "../../../test-corpus/relational-kernel/rust-receipt.json"
    ));
}
