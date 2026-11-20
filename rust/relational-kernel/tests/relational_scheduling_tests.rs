use rml_relational::horn_resolution::Options;
use rml_relational::linked_program::{LinkedProgram, LinkedProgramRegistry};
use rml_relational::relational_kernel::{RelationalKernel, SOURCE};
use rml_relational::{parse_one, tokenize_one, Node};
use std::collections::BTreeMap;
fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}
fn programs(source: &str) -> BTreeMap<String, LinkedProgram> {
    let registry = LinkedProgramRegistry::from_rml(source).unwrap();
    registry
        .names()
        .iter()
        .map(|name| (name.to_string(), registry.program(name).unwrap().clone()))
        .collect()
}
#[test]
fn linked_scheduling_preserves_sk_rotation_under_a_productive_first_rule() {
    let source = include_str!("../../../test-corpus/relational-kernel/fairness.lino");
    let registry = LinkedProgramRegistry::from_rml(source).unwrap();
    let goal = node("(m (s z))");
    let baseline = registry.search("fair", &[goal], &[], 8, 16, 16).unwrap();
    let expected = [
        node("(n (s z))"),
        node("(m z)"),
        node("(n (s (s z)))"),
        node("(m (s z))"),
    ];
    assert_eq!(
        baseline
            .derived
            .iter()
            .map(|item| item.judgement.clone())
            .collect::<Vec<_>>(),
        expected
    );
    for self_interpret in [false, true] {
        let kernel = RelationalKernel::from_source(SOURCE).unwrap();
        let options = Options {
            self_interpret,
            max_steps: 100_000_000,
            ..Options::default()
        };
        let mut state = kernel
            .create_proof_state(&programs(source), "fair", &[], &options)
            .unwrap();
        for (expected, baseline) in expected.iter().zip(&baseline.derived) {
            let next = kernel.infer_once(state, &options).unwrap();
            let (judgement, proof) = next.derivation.unwrap();
            assert_eq!(&judgement, expected);
            assert_eq!(proof, baseline.proof);
            state = next.state;
        }
    }
}
#[test]
fn unfinished_conclusion_normalization_is_blocked_not_saturated() {
    let source="(linked-program bounded)\n(linked-fact bounded seed (judgement (ready z)))\n(linked-inference bounded derive (premise (ready ?x)) (conclusion (loop ?x)))\n(linked-rewrite bounded loop (from (loop ?x)) (to (loop ?x)))";
    let programs = programs(source);
    for self_interpret in [false, true] {
        let kernel = RelationalKernel::from_source(SOURCE).unwrap();
        let options = Options {
            self_interpret,
            max_steps: 100_000_000,
            normalization_fuel: 2,
            ..Options::default()
        };
        let state = kernel
            .create_proof_state(&programs, "bounded", &[], &options)
            .unwrap();
        assert!(kernel
            .infer_once(state, &options)
            .unwrap_err()
            .contains("blocked: normalization-limit"));
    }
    assert!(RelationalKernel::from_source(SOURCE)
        .unwrap()
        .create_proof_state(
            &programs,
            "bounded",
            &[],
            &Options {
                normalization_fuel: 257,
                ..Options::default()
            }
        )
        .unwrap_err()
        .contains("normalization_fuel"));
}
