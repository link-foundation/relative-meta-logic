use rml_relational::horn_resolution::Options;
use rml_relational::relational_kernel::{ProofState, RelationalKernel};
use rml_relational::Node;
use std::collections::BTreeMap;
fn atom(value: &str) -> Node {
    Node::Leaf(value.into())
}
fn state() -> ProofState {
    ProofState {
        rules: atom("end"),
        inferences: atom("end"),
        known: atom("end"),
        size: 0,
    }
}
#[test]
fn rewrite_codec_checks_all_constructors_and_arities() {
    for value in [
        "(other (step (atom end) (origin end end)))",
        "(some (other (atom end) (origin end end)))",
        "(some (step (atom end) (other end end)))",
        "(some (step (atom end) (origin end end extra)))",
    ] {
        let kernel = RelationalKernel::from_source(&format!(
            "(horn-clause malformed (rewrite-once ?rules ?term {value}))"
        ))
        .unwrap();
        assert!(kernel
            .rewrite_once(&atom("x"), &atom("end"), &Options::default())
            .unwrap_err()
            .contains("invalid relational"));
    }
}
#[test]
fn imports_inference_and_proof_codecs_reject_malformed_source_outputs() {
    let options = Options::default();
    let kernel = RelationalKernel::from_source(
        "(horn-clause malformed (resolve ?programs ?name ?kind ?seen (resolved end extra)))",
    )
    .unwrap();
    assert!(kernel
        .resolve(&BTreeMap::new(), "p", "rewrites", &options)
        .unwrap_err()
        .contains("invalid relational resolved"));
    let kernel=RelationalKernel::from_source("(horn-clause malformed (infer-step ?inferences ?known ?rules ?fuel (other (atom end) (proof (origin end end) (atom end) end))))").unwrap();
    assert!(kernel
        .infer_once(state(), &options)
        .unwrap_err()
        .contains("invalid relational transition"));
    let kernel=RelationalKernel::from_source("(horn-clause malformed (known-proof ?goal ?known (other (proof (origin end end) (atom end) end))))").unwrap();
    assert!(kernel
        .find_proof(&state(), &atom("x"), &options)
        .unwrap_err()
        .contains("invalid relational some"));
    let kernel=RelationalKernel::from_source("(horn-clause malformed (known-proof ?goal ?known (some (proof (origin end end extra) (atom end) end))))").unwrap();
    assert!(kernel
        .find_proof(&state(), &atom("x"), &options)
        .unwrap_err()
        .contains("invalid relational origin"));
}
#[test]
fn quoted_result_codec_rejects_tags_and_noncanonical_atom_codes() {
    for value in [
        "(other (atom (zero end)))",
        "(answer (atom end))",
        "(answer (atom (zero (zero end))))",
    ] {
        let kernel = RelationalKernel::from_source(&format!(
            "(horn-clause malformed (self-query-value ?program ?goal {value}))"
        ))
        .unwrap();
        assert!(kernel
            .self_query(
                &Node::List(vec![atom("x"), atom("?out")]),
                &Options::default()
            )
            .is_err());
    }
}
