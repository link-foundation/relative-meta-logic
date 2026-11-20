use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::linked_proof::encode_linked_proof_data;
use rml::{parse_one, tokenize_one, Node};
use serde_json::Value;

const SOURCE: &str = r#"
(linked-program imported)
(linked-rewrite imported rename (from (source ?x)) (to (imported ?x)))
(linked-program probe (uses imported (rebind source mapped)))
(linked-rewrite probe first (from (pick ?x)) (to (chosen ?x)))
(linked-rewrite probe shadowed (from (pick a)) (to wrong))
(linked-rewrite probe root (from (choose (pick ?x))) (to (root ?x)))
(linked-program loop)
(linked-rewrite loop left (from left) (to right))
(linked-rewrite loop right (from right) (to left))
(linked-program stalled)
(linked-rewrite stalled unchanged (from (same ?x)) (to (same ?x)))
"#;

fn node(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.to_string())
    }
}

fn registry(basis: ExecutionBasis) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(SOURCE, basis, &[]).unwrap()
}

#[test]
fn result_only_matches_full_trace_priority_traversal_and_import_rebinding() {
    for basis in [ExecutionBasis::ClosedSk, ExecutionBasis::DirectStructural] {
        let programs = registry(basis);
        for (input, expected, steps) in [
            (
                "(wrap (pick a) (pick b))",
                "(wrap (chosen a) (chosen b))",
                2,
            ),
            ("(choose (pick a))", "(root a)", 1),
            ("(mapped a)", "(imported a)", 1),
        ] {
            let input = node(input);
            let before = input.clone();
            let full = programs.reduce("probe", &input, 8).unwrap();
            let result = programs.reduce_result("probe", &input, 8).unwrap();
            assert_eq!(result.term, node(expected));
            assert_eq!(result.steps, steps);
            assert_eq!(result.term, full.term);
            assert_eq!(result.steps, full.trace.len());
            assert_eq!(input, before);
        }
        let full = programs.reduce("probe", &node("(pick a)"), 8).unwrap();
        assert_eq!(full.trace[0].rule, "first");
        assert_eq!(full.trace[0].before, node("(pick a)"));
        assert_eq!(full.trace[0].after, node("(chosen a)"));
    }
}

#[test]
fn result_only_preserves_unmatched_and_quoted_forms() {
    for basis in [ExecutionBasis::ClosedSk, ExecutionBasis::DirectStructural] {
        let programs = registry(basis);
        for input in [
            node("unknown"),
            node("()"),
            node("(pick)"),
            node("(choose x)"),
            encode_linked_proof_data(&node("(choose (pick a))")).unwrap(),
        ] {
            let result = programs.reduce_result("probe", &input, 1).unwrap();
            assert_eq!(result.term, input);
            assert_eq!(result.steps, 0);
            assert_eq!(
                result.term,
                programs.reduce("probe", &input, 1).unwrap().term
            );
        }
    }
}

#[test]
fn result_only_cycles_exhaust_fuel_and_stalled_rewrites_fail_immediately() {
    for basis in [ExecutionBasis::ClosedSk, ExecutionBasis::DirectStructural] {
        let programs = registry(basis);
        assert!(programs
            .reduce("loop", &node("left"), 7)
            .unwrap_err()
            .contains("rewrite cycle after 2 steps"));
        assert_eq!(
            programs
                .reduce_result("loop", &node("left"), 7)
                .unwrap_err(),
            "rewrite step limit 7 exceeded"
        );
        assert!(programs
            .reduce_result("stalled", &node("(same a)"), 7)
            .unwrap_err()
            .contains("made no progress"));
    }
}

#[test]
fn result_only_uses_the_full_reducer_fuel_boundary() {
    for basis in [ExecutionBasis::ClosedSk, ExecutionBasis::DirectStructural] {
        let programs = registry(basis);
        let input = node("(pick a)");
        assert!(programs
            .reduce("probe", &input, 1)
            .unwrap_err()
            .contains("step limit 1"));
        assert!(programs
            .reduce_result("probe", &input, 1)
            .unwrap_err()
            .contains("step limit 1"));
        let full = programs.reduce("probe", &input, 2).unwrap();
        let result = programs.reduce_result("probe", &input, 2).unwrap();
        assert_eq!(result.steps, 1);
        assert_eq!(result.term, full.term);
        assert_eq!(result.steps, full.trace.len());
    }
}

#[test]
fn result_only_rejects_zero_fuel_unknown_programs_and_malformed_source_input() {
    for basis in [
        ExecutionBasis::ClosedSk,
        ExecutionBasis::DirectStructural,
        ExecutionBasis::HornRelational,
    ] {
        let programs = registry(basis);
        assert_eq!(
            programs
                .reduce_result("probe", &node("normal"), 0)
                .unwrap_err(),
            "max_steps must be positive"
        );
        assert!(programs
            .reduce_result("missing", &node("normal"), 1)
            .unwrap_err()
            .contains("unknown linked-program"));
    }
    // The typed API cannot accept object/null/numeric leaves or cyclic trees;
    // malformed text must fail while constructing its Node input.
    assert!(parse_one(&tokenize_one("(pick a")).is_err());
    assert!(parse_one(&tokenize_one("a b")).is_err());
}

#[test]
fn result_only_preserves_the_horn_identity_reduction() {
    let programs = registry(ExecutionBasis::HornRelational);
    let input = node("(pick a)");
    let result = programs.reduce_result("probe", &input, 1).unwrap();
    assert_eq!(result.term, input);
    assert_eq!(result.steps, 0);
}

#[test]
fn result_only_preserves_kernel_host_guards_and_contraction_bounds() {
    let closed = LinkedProgramRegistry::from_rml_with_basis(
        SOURCE,
        ExecutionBasis::ClosedSk,
        &[
            "select-and-traverse-rewrite-rules",
            "bind-pattern-variables",
        ],
    )
    .unwrap();
    let result = closed.reduce_result("probe", &node("(pick a)"), 2).unwrap();
    assert_eq!(result.term, node("(chosen a)"));
    assert_eq!(result.steps, 1);
    let direct = LinkedProgramRegistry::from_rml_with_basis(
        SOURCE,
        ExecutionBasis::DirectStructural,
        &["select-and-traverse-rewrite-rules"],
    )
    .unwrap();
    assert!(direct
        .reduce_result("probe", &node("(pick a)"), 2)
        .unwrap_err()
        .contains("disabled host semantic operation select-and-traverse-rewrite-rules"));
    let tiny = registry(ExecutionBasis::ClosedSk)
        .with_max_contractions(1)
        .unwrap();
    assert!(tiny
        .reduce_result("probe", &node("(pick a)"), 2)
        .unwrap_err()
        .contains("contraction limit"));
}

#[test]
fn result_only_matches_a_real_bounded_proof_certificate_and_full_step_count() {
    fn data(value: &Value) -> Node {
        match value {
            Value::String(text) => Node::Leaf(text.clone()),
            Value::Array(values) => Node::List(values.iter().map(data).collect()),
            _ => panic!("fixture terms must contain strings or arrays"),
        }
    }
    let programs = LinkedProgramRegistry::from_rml_with_basis(
        &format!(
            "{}\n{}",
            include_str!("../../lib/meta-theory/universal.lino"),
            include_str!("../../lib/meta-theory/proof-verifier.lino")
        ),
        ExecutionBasis::DirectStructural,
        &[],
    )
    .unwrap();
    let cases: Value =
        serde_json::from_str(include_str!("../../test-corpus/linked-proof/cases.json")).unwrap();
    let mut request = vec![Node::Leaf("verify-linked-proof".into())];
    for field in ["context", "goal", "candidate"] {
        request.push(encode_linked_proof_data(&data(&cases[0][field])).unwrap());
    }
    let request = Node::List(request);
    let full = programs
        .reduce("linked-proof-verifier", &request, 262)
        .unwrap();
    let result = programs
        .reduce_result("linked-proof-verifier", &request, 262)
        .unwrap();
    let Node::List(term) = &full.term else {
        panic!("proof result must be a list")
    };
    assert_eq!(term[0], Node::Leaf("proof-accepted".into()));
    assert_eq!(full.trace.len(), 261);
    assert_eq!(result.term, full.term);
    assert_eq!(result.steps, full.trace.len());
    assert!(programs
        .reduce_result("linked-proof-verifier", &request, 261)
        .unwrap_err()
        .contains("step limit"));
}
