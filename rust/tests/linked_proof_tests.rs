use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::{
    decode_linked_proof_data, decode_linked_proof_data_with_limits, encode_linked_proof_data,
    encode_linked_proof_data_with_limits, replay_linked_proof, verify_linked_proof,
    LinkedProofLimits, LinkedProofOptions,
};
use rml::Node;
use serde_json::Value;
use sha2::{Digest, Sha256};

const DISABLED_HOST_SERVICES: &[&str] = &[
    "resolve-and-rebind-program-imports",
    "select-and-traverse-rewrite-rules",
    "bind-pattern-variables",
    "compare-link-structure",
    "substitute-bound-structures",
    "saturate-inference-rules",
];
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const OBSERVATIONS: &str = include_str!("../../test-corpus/linked-proof/observations.json");
const CASES: &str = include_str!("../../test-corpus/linked-proof/cases.json");

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("fixture terms contain strings or arrays"),
    }
}
fn json(value: &Node) -> Value {
    match value {
        Node::Leaf(value) => Value::String(value.clone()),
        Node::List(values) => Value::Array(values.iter().map(json).collect()),
    }
}
fn digest(value: &Node) -> String {
    Sha256::digest(serde_json::to_string(&json(value)).unwrap().as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn registry(source: &str, basis: ExecutionBasis) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(&format!("{UNIVERSAL}\n{source}"), basis, &[])
        .unwrap()
}
fn fixture() -> (Node, Node, Node) {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    (
        node(&cases[0]["context"]),
        node(&cases[0]["goal"]),
        node(&cases[0]["candidate"]),
    )
}

#[test]
fn shared_linked_proof_adversarial_corpus() {
    let registry = registry(VERIFIER, ExecutionBasis::DirectStructural);
    let cases: Vec<Value> = serde_json::from_str(CASES).unwrap();
    let observations: Value = serde_json::from_str(OBSERVATIONS).unwrap();
    assert!(cases.len() >= 34);
    for case in cases {
        let result = verify_linked_proof(
            &registry,
            &node(&case["context"]),
            &node(&case["goal"]),
            &node(&case["candidate"]),
            &LinkedProofOptions::default(),
        )
        .unwrap();
        assert_eq!(
            result.accepted,
            case["accepted"].as_bool().unwrap(),
            "{}: {}",
            case["name"],
            result.result
        );
        let Node::List(trace) = &result.trace else {
            panic!("linked trace")
        };
        let expected = observations["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["name"] == case["name"])
            .unwrap();
        assert_eq!(result.steps, expected["steps"].as_u64().unwrap() as usize);
        assert_eq!(
            digest(&result.result),
            expected["resultSha256"].as_str().unwrap()
        );
        assert_eq!(trace.len(), result.steps + 1);
        assert_eq!(trace[0], Node::Leaf("linked-execution".to_string()));
    }
}

#[test]
fn generic_quotation_is_injective_and_rejects_executable_payloads() {
    let values: Vec<Value> =
        serde_json::from_str(r#"[[],"list-end",["pair","atom",[]],["variable","x"]]"#).unwrap();
    for value in values {
        let value = node(&value);
        assert_eq!(
            decode_linked_proof_data(&encode_linked_proof_data(&value).unwrap()).unwrap(),
            value
        );
    }
    assert!(
        decode_linked_proof_data(&Node::List(vec![Node::Leaf("proof-accepted".to_string())]))
            .is_err()
    );
}

#[test]
fn independent_replay_detects_forged_receipts_and_context_swaps() {
    let programs = registry(VERIFIER, ExecutionBasis::DirectStructural);
    let (context, goal, candidate) = fixture();
    let options = LinkedProofOptions::default();
    let receipt = verify_linked_proof(&programs, &context, &goal, &candidate, &options).unwrap();
    let replay = replay_linked_proof(
        &registry(VERIFIER, ExecutionBasis::DirectStructural),
        &context,
        &goal,
        &receipt,
        &options,
    )
    .unwrap();
    assert!(replay.accepted && replay.matches);
    let observations: Value = serde_json::from_str(OBSERVATIONS).unwrap();
    assert_eq!(
        digest(&receipt.request),
        observations["requestSha256"].as_str().unwrap()
    );
    assert_eq!(
        digest(&receipt.trace),
        observations["traceSha256"].as_str().unwrap()
    );
    let mut forged = receipt.clone();
    forged.trace = Node::Leaf("forged".to_string());
    assert!(
        !replay_linked_proof(&programs, &context, &goal, &forged, &options)
            .unwrap()
            .matches
    );
    forged = receipt.clone();
    forged.result = Node::Leaf("forged".to_string());
    assert!(
        !replay_linked_proof(&programs, &context, &goal, &forged, &options)
            .unwrap()
            .matches
    );
    forged = receipt.clone();
    forged.request = Node::List(vec![Node::Leaf("proof-accepted".to_string())]);
    assert!(replay_linked_proof(&programs, &context, &goal, &forged, &options).is_err());
    forged = receipt.clone();
    if let Node::List(parts) = &mut forged.request {
        parts[3] = Node::List(vec![Node::Leaf("proof-accepted".to_string())]);
    }
    assert!(replay_linked_proof(&programs, &context, &goal, &forged, &options).is_err());
    forged = receipt.clone();
    forged.accepted = false;
    let replay = replay_linked_proof(&programs, &context, &goal, &forged, &options).unwrap();
    assert!(replay.accepted && !replay.matches);
    forged = receipt.clone();
    forged.steps += 1;
    let replay = replay_linked_proof(&programs, &context, &goal, &forged, &options).unwrap();
    assert!(replay.accepted && !replay.matches);
    let mut changed_context = context.clone();
    if let Node::List(parts) = &mut changed_context {
        parts[1] = Node::Leaf("a-different-foundation".to_string());
    }
    let replay =
        replay_linked_proof(&programs, &changed_context, &goal, &receipt, &options).unwrap();
    assert!(!replay.accepted && !replay.matches);
}

#[test]
fn replacing_the_linked_verifier_changes_execution_without_a_host_change() {
    let (context, goal, candidate) = fixture();
    let options = LinkedProofOptions::default();
    let altered = VERIFIER.replace(
        "(to (proof-accepted ?context ?goal ?dependencies ?evidence))",
        "(to (proof-rejected replaced-verification-policy))",
    );
    assert_ne!(altered, VERIFIER);
    assert!(
        !verify_linked_proof(
            &registry(&altered, ExecutionBasis::DirectStructural),
            &context,
            &goal,
            &candidate,
            &options
        )
        .unwrap()
        .accepted
    );
    let disabled = VERIFIER.replacen("(to (match-ok ?bindings))", "(to match-failed)", 1);
    assert!(
        !verify_linked_proof(
            &registry(&disabled, ExecutionBasis::DirectStructural),
            &context,
            &goal,
            &candidate,
            &options
        )
        .unwrap()
        .accepted
    );
    assert!(
        verify_linked_proof(
            &registry(VERIFIER, ExecutionBasis::DirectStructural),
            &context,
            &goal,
            &candidate,
            &options
        )
        .unwrap()
        .accepted
    );
}

#[test]
fn stopped_reductions_are_not_mislabeled_as_rejected_proofs() {
    let (context, goal, candidate) = fixture();
    let options = LinkedProofOptions {
        max_steps: 1,
        ..Default::default()
    };
    assert!(verify_linked_proof(
        &registry(VERIFIER, ExecutionBasis::DirectStructural),
        &context,
        &goal,
        &candidate,
        &options
    )
    .unwrap_err()
    .contains("step limit"));
}

#[test]
fn closed_sk_executes_the_complete_inference_certificate_and_matches_independent_replay() {
    let (context, goal, candidate) = fixture();
    let options = LinkedProofOptions::default();
    let runtime = LinkedProgramRegistry::from_rml_with_basis(
        &format!("{UNIVERSAL}\n{VERIFIER}"),
        ExecutionBasis::ClosedSk,
        DISABLED_HOST_SERVICES,
    )
    .unwrap();
    let closed = verify_linked_proof(&runtime, &context, &goal, &candidate, &options).unwrap();
    assert!(closed.accepted);
    let replay = replay_linked_proof(
        &registry(VERIFIER, ExecutionBasis::DirectStructural),
        &context,
        &goal,
        &closed,
        &options,
    )
    .unwrap();
    assert!(replay.accepted && replay.matches);
}

#[test]
fn declared_bootstrap_operations_are_required_but_direct_host_services_are_not() {
    let (context, goal, candidate) = fixture();
    let options = LinkedProofOptions::default();
    for operation in ["contract-s-link", "contract-k-link"] {
        let runtime = LinkedProgramRegistry::from_rml_with_basis(
            &format!("{UNIVERSAL}\n{VERIFIER}"),
            ExecutionBasis::ClosedSk,
            &[operation],
        )
        .unwrap();
        assert!(
            verify_linked_proof(&runtime, &context, &goal, &candidate, &options)
                .unwrap_err()
                .contains("disabled host semantic operation")
        );
    }
    let direct = LinkedProgramRegistry::from_rml_with_basis(
        &format!("{UNIVERSAL}\n{VERIFIER}"),
        ExecutionBasis::DirectStructural,
        DISABLED_HOST_SERVICES,
    )
    .unwrap();
    assert!(
        verify_linked_proof(&direct, &context, &goal, &candidate, &options)
            .unwrap_err()
            .contains("disabled host semantic operation")
    );
}

#[test]
fn codec_bounds_nodes_nesting_quoted_list_spines_and_utf8_text() {
    let wide = Node::List(vec![Node::Leaf("leaf".to_string()); 64]);
    let encoded = encode_linked_proof_data(&wide).unwrap();
    let limits = LinkedProofLimits {
        max_nodes: 64,
        ..Default::default()
    };
    assert!(encode_linked_proof_data_with_limits(&wide, &limits)
        .unwrap_err()
        .contains("node limit"));
    assert!(decode_linked_proof_data_with_limits(&encoded, &limits)
        .unwrap_err()
        .contains("node limit"));
    let mut deep = Node::Leaf("leaf".to_string());
    for _ in 0..8 {
        deep = Node::List(vec![deep]);
    }
    let limits = LinkedProofLimits {
        max_depth: 8,
        ..Default::default()
    };
    assert!(encode_linked_proof_data_with_limits(&deep, &limits)
        .unwrap_err()
        .contains("depth limit"));
    let larger = LinkedProofLimits {
        max_depth: 9,
        ..Default::default()
    };
    let encoded = encode_linked_proof_data_with_limits(&deep, &larger).unwrap();
    assert!(decode_linked_proof_data_with_limits(&encoded, &limits)
        .unwrap_err()
        .contains("depth limit"));
    assert_eq!(
        decode_linked_proof_data_with_limits(&encoded, &larger).unwrap(),
        deep
    );
    let wide = Node::List(vec![Node::Leaf("x".to_string()); 129]);
    assert!(encode_linked_proof_data(&wide)
        .unwrap_err()
        .contains("depth limit"));
    let encoded = encode_linked_proof_data_with_limits(
        &wide,
        &LinkedProofLimits {
            max_depth: 131,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(decode_linked_proof_data(&encoded)
        .unwrap_err()
        .contains("depth limit"));
    let text = Node::Leaf("😀😀".to_string());
    let encoded = encode_linked_proof_data(&text).unwrap();
    let limits = LinkedProofLimits {
        max_text_bytes: 7,
        ..Default::default()
    };
    assert!(encode_linked_proof_data_with_limits(&text, &limits)
        .unwrap_err()
        .contains("text byte limit"));
    assert!(decode_linked_proof_data_with_limits(&encoded, &limits)
        .unwrap_err()
        .contains("text byte limit"));
    let limits = LinkedProofLimits {
        max_text_bytes: 8,
        ..Default::default()
    };
    assert_eq!(
        decode_linked_proof_data_with_limits(
            &encode_linked_proof_data_with_limits(&text, &limits).unwrap(),
            &limits
        )
        .unwrap(),
        text
    );
    assert!(encode_linked_proof_data_with_limits(
        &text,
        &LinkedProofLimits {
            max_depth: 257,
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn request_budgets_are_shared_and_checked_before_reduction() {
    let no_verifier = LinkedProgramRegistry::from_rml("(linked-program empty)").unwrap();
    let options = LinkedProofOptions {
        input_limits: LinkedProofLimits {
            max_nodes: 2,
            ..Default::default()
        },
        ..Default::default()
    };
    let value = Node::Leaf("value".to_string());
    assert!(
        verify_linked_proof(&no_verifier, &value, &value, &value, &options)
            .unwrap_err()
            .contains("node limit")
    );
    let options = LinkedProofOptions {
        input_limits: LinkedProofLimits {
            max_text_bytes: 7,
            ..Default::default()
        },
        ..Default::default()
    };
    let text = Node::Leaf("😀".to_string());
    assert!(
        verify_linked_proof(&no_verifier, &text, &text, &value, &options)
            .unwrap_err()
            .contains("text byte limit")
    );
}

fn node_count(value: &Node) -> usize {
    1 + match value {
        Node::Leaf(_) => 0,
        Node::List(values) => values.iter().map(node_count).sum(),
    }
}

#[test]
fn forged_replay_metadata_is_bounded_before_comparison() {
    let (context, goal, candidate) = fixture();
    let receipt = verify_linked_proof(
        &registry(VERIFIER, ExecutionBasis::DirectStructural),
        &context,
        &goal,
        &candidate,
        &LinkedProofOptions::default(),
    )
    .unwrap();
    let no_verifier = LinkedProgramRegistry::from_rml("(linked-program empty)").unwrap();
    let options = LinkedProofOptions {
        receipt_limits: LinkedProofLimits {
            max_nodes: node_count(&receipt.request) + node_count(&receipt.result) + 64,
            ..LinkedProofLimits::for_receipt()
        },
        ..Default::default()
    };
    let mut forged = receipt.clone();
    forged.trace = Node::List(vec![Node::Leaf("leaf".to_string()); 64]);
    assert!(
        replay_linked_proof(&no_verifier, &context, &goal, &forged, &options)
            .unwrap_err()
            .contains("node limit")
    );
    let mut deep = Node::Leaf("leaf".to_string());
    for _ in 0..257 {
        deep = Node::List(vec![deep]);
    }
    forged.trace = deep;
    assert!(replay_linked_proof(
        &no_verifier,
        &context,
        &goal,
        &forged,
        &LinkedProofOptions::default()
    )
    .unwrap_err()
    .contains("depth limit"));
}
