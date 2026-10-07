use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::{parse_one, tokenize_one, Node};

const DEFAULT_ARTIFACT: &str = include_str!("../../lib/meta-theory/fixed-point.ski");
const REPLACEMENT: &str = include_str!("../../test-corpus/kernel-replacement/mirror-substitution.ski");
const PROGRAM: &str = "(linked-program kernel-witness)\n\
(linked-rewrite kernel-witness substitute\n\
(from (input ?value)) (to (pair (nested ?value) done)))";

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}

#[test]
fn runtime_loaded_linked_k0_substitution_changes_nested_execution_without_host_changes() {
    let original = LinkedProgramRegistry::from_rml(PROGRAM).unwrap();
    let replacement = original.clone().with_kernel_artifact(REPLACEMENT).unwrap();
    let request = node("(input value)");
    assert_eq!(original.reduce("kernel-witness", &request, 100).unwrap().term,
        node("(pair (nested value) done)"));
    assert_eq!(replacement.reduce("kernel-witness", &request, 100).unwrap().term,
        node("(done (value nested) pair)"));
    assert_eq!(replacement.loaded_kernel_artifact_counts().unwrap().1, 25);
    assert_eq!(original.loaded_kernel_artifact_counts(), None);
    assert_eq!(original.reduce("kernel-witness", &request, 100).unwrap().term,
        node("(pair (nested value) done)"));
    assert_eq!(LinkedProgramRegistry::from_rml(PROGRAM).unwrap()
        .reduce("kernel-witness", &request, 100).unwrap().term,
        node("(pair (nested value) done)"));
}

#[test]
fn loaded_baseline_preserves_proof_search_inference_imports_and_verification() {
    let program = "(linked-program imported)\n\
(linked-fact imported origin (judgement (holds seed)))\n\
(linked-program proof (uses imported))\n\
(linked-inference proof extend (premise (holds ?x)) (conclusion (reached ?x)))";
    let original = LinkedProgramRegistry::from_rml(program).unwrap();
    let loaded = original.clone().with_kernel_artifact(DEFAULT_ARTIFACT).unwrap();
    let goal = node("(reached seed)");
    let baseline = original.prove("proof", &goal, &[], 128, 10000).unwrap();
    assert_eq!(loaded.prove("proof", &goal, &[], 128, 10000).unwrap(), baseline);
}

#[test]
fn replacement_cannot_bypass_disabled_contraction_operations() {
    for operation in ["contract-s-link", "contract-k-link"] {
        let registry = LinkedProgramRegistry::from_rml_with_basis(
            PROGRAM, ExecutionBasis::ClosedSk, &[operation])
            .unwrap().with_kernel_artifact(REPLACEMENT).unwrap();
        assert!(registry.reduce("kernel-witness", &node("(input value)"), 100)
            .unwrap_err().contains("disabled host semantic operation"));
    }
}

#[test]
fn runtime_linked_artifacts_fail_closed_on_missing_roots_forged_references_and_bounds() {
    let registry = LinkedProgramRegistry::from_rml(PROGRAM).unwrap();
    let cases = [
        (String::new(), "header"),
        (DEFAULT_ARTIFACT.replace("REWRITE_ONCE\t", "UNUSED\t"), "missing fixed-point root REWRITE_ONCE"),
        (DEFAULT_ARTIFACT.replace("TRUE\t", "FALSE\t"), "root"),
        (DEFAULT_ARTIFACT.replacen("0\tK\tK", "0\tn999999\tK", 1), "unknown fixed-point node"),
        ("rml-addressed-link-dag-v1\n1000001\t25\n".to_string(), "resource bounds"),
        (format!("{DEFAULT_ARTIFACT}unexpected\n"), "unexpected"),
    ];
    for (artifact, message) in cases {
        assert!(registry.clone().with_kernel_artifact(&artifact).unwrap_err().contains(message));
    }
    assert!(LinkedProgramRegistry::from_rml_with_basis(
        PROGRAM, ExecutionBasis::DirectStructural, &[]).unwrap()
        .with_kernel_artifact(REPLACEMENT).unwrap_err().contains("requires the s-k"));
    let bounded = registry.with_kernel_artifact(REPLACEMENT).unwrap()
        .with_max_contractions(1).unwrap();
    assert!(bounded.reduce("kernel-witness", &node("(input value)"), 100)
        .unwrap_err().contains("contraction limit"));
}
