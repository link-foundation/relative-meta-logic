use rml_relational::horn_resolution::{Options, Proof};
use rml_relational::relational_kernel::{encode_node, RelationalKernel, SOURCE};
use rml_relational::Node;
use serde_json::{json, Value};
fn node(value: &Node) -> Value {
    match value {
        Node::Leaf(text) => json!(text),
        Node::List(items) => Value::Array(items.iter().map(node).collect()),
    }
}
fn proof(value: &Proof) -> Value {
    json!({"clause":value.clause,"goal":node(&value.goal),"premises":value.premises.iter().map(proof).collect::<Vec<_>>()})
}
fn main() {
    let kernel = RelationalKernel::from_source(SOURCE).unwrap();
    let options = Options::default();
    let direct = kernel
        .call(
            "nodes-equal",
            vec![
                encode_node(&Node::Leaf("λ".into()), false),
                encode_node(&Node::Leaf("λ".into()), false),
            ],
            &options,
        )
        .unwrap();
    let query = Node::List(vec![
        Node::Leaf("bits-equal".into()),
        Node::List(vec![Node::Leaf("zero".into()), Node::Leaf("end".into())]),
        Node::List(vec![Node::Leaf("zero".into()), Node::Leaf("end".into())]),
        Node::Leaf("?out".into()),
    ]);
    let result = kernel
        .run_query(
            &query,
            &Options {
                self_interpret: true,
                include_source_proof: true,
                max_steps: 100_000_000,
                ..options
            },
        )
        .unwrap();
    let interpreted = &result.answers[0];
    println!("{}",serde_json::to_string_pretty(&json!({"schema":"rml-relational-cross-runtime-receipt/v1","producer":"rust","trust":rml_relational::horn_resolution::trust_report(),"direct":{"query":node(&direct.query),"value":node(&direct.value),"proof":proof(direct.proof.as_ref().unwrap())},"interpreted":{"query":node(&query),"goal":node(&interpreted.goal),"certificate":node(interpreted.source_proof.as_ref().unwrap())}})).unwrap());
}
