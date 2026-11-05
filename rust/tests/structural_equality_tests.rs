use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry, SearchEnd};
use rml::linked_proof::{verify_linked_proof, LinkedProofOptions};
use rml::{evaluate, is_structurally_same, key_of, Node, RunResult};
use serde_json::{json, Value};

const CASES: &str = include_str!("../../test-corpus/structural-equality/cases.json");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const SOURCE: &str = "(linked-program p)
(linked-rewrite p same (from (pair ?x ?x)) (to same))
(linked-program infer)
(linked-inference infer same (premise (pair ?x ?x)) (conclusion same))";

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(values) => Node::List(values.iter().map(node).collect()),
        _ => panic!("fixture terms contain strings or lists"),
    }
}

fn registry(source: &str, basis: ExecutionBasis) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(source, basis, &[]).unwrap()
}

#[test]
fn public_evaluator_cannot_report_structural_equality_for_different_shapes() {
    for source in ["(? (a = (a)) with proof)", "(? ((a b) = a,b) with proof)"] {
        let result = evaluate(source, None, None);
        assert!(result.diagnostics.is_empty());
        assert_eq!(result.results, vec![RunResult::Num(0.0)]);
        let Node::List(proof) = result.proofs[0].as_ref().unwrap() else {
            panic!("proof is a list");
        };
        assert_ne!(proof[1], Node::Leaf("structural-equality".into()));
    }
    let same = evaluate("(? (a = a) with proof)", None, None);
    assert_eq!(same.results, vec![RunResult::Num(1.0)]);
    let Node::List(proof) = same.proofs[0].as_ref().unwrap() else {
        panic!("proof is a list");
    };
    assert_eq!(proof[1], Node::Leaf("structural-equality".into()));
}

#[test]
fn public_structural_equality_preserves_leaf_and_list_identity() {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    for case in cases["equalities"].as_array().unwrap() {
        let (left, right) = (node(&case["left"]), node(&case["right"]));
        let expected = case["same"].as_bool().unwrap();
        assert_eq!(
            is_structurally_same(&left, &right),
            expected,
            "{}",
            case["name"]
        );
        assert_eq!(
            is_structurally_same(&right, &left),
            expected,
            "{}",
            case["name"]
        );
    }
}

#[test]
fn repeated_variables_respect_shape_in_both_reducers() {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let registry = registry(SOURCE, basis);
        for case in cases["equalities"].as_array().unwrap() {
            let (left, right) = (node(&case["left"]), node(&case["right"]));
            for (a, b) in [(&left, &right), (&right, &left)] {
                let input = Node::List(vec![Node::Leaf("pair".into()), a.clone(), b.clone()]);
                let expected = if case["same"].as_bool().unwrap() {
                    Node::Leaf("same".into())
                } else {
                    input.clone()
                };
                assert_eq!(
                    registry.reduce("p", &input, 3).unwrap().term,
                    expected,
                    "{}",
                    case["name"]
                );
                assert_eq!(
                    registry.reduce_result("p", &input, 3).unwrap().term,
                    expected,
                    "{}",
                    case["name"]
                );
            }
        }
    }
}

#[test]
fn display_collisions_cannot_manufacture_proofs_or_cycles() {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    for basis in [
        ExecutionBasis::DirectStructural,
        ExecutionBasis::ClosedSk,
        ExecutionBasis::HornRelational,
    ] {
        for case in cases["displayCollisions"].as_array().unwrap() {
            let (left, right) = (node(&case["left"]), node(&case["right"]));
            assert_eq!(
                key_of(&left),
                key_of(&right),
                "public formatting remains unchanged"
            );
            for (goal, fact) in [(&left, &right), (&right, &left)] {
                let registry = registry("(linked-program p)", basis);
                assert!(
                    registry.prove("p", goal, &[fact.clone()], 4, 10).is_none(),
                    "{}",
                    case["name"]
                );
                let search = registry
                    .search(
                        "p",
                        &[goal.clone(), fact.clone()],
                        &[goal.clone(), fact.clone()],
                        4,
                        10,
                        10,
                    )
                    .unwrap();
                assert_eq!(search.ended, SearchEnd::Found, "{}", case["name"]);
                assert_eq!(search.facts, 2, "{}", case["name"]);
                assert_eq!(search.goals[0].proof.as_ref().unwrap().judgement, *goal);
                assert_eq!(search.goals[1].proof.as_ref().unwrap().judgement, *fact);
                if basis == ExecutionBasis::HornRelational {
                    continue;
                }
                let forms = vec![
                    node(&json!(["linked-program", "p"])),
                    Node::List(vec![
                        Node::Leaf("linked-rewrite".into()),
                        Node::Leaf("p".into()),
                        Node::Leaf("distinct-shape".into()),
                        Node::List(vec![Node::Leaf("from".into()), goal.clone()]),
                        Node::List(vec![Node::Leaf("to".into()), fact.clone()]),
                    ]),
                ];
                let rewrite =
                    LinkedProgramRegistry::from_forms_with_basis(&forms, basis, &[]).unwrap();
                assert_eq!(
                    rewrite.reduce("p", goal, 3).unwrap().term,
                    *fact,
                    "{}",
                    case["name"]
                );
                assert_eq!(
                    rewrite.reduce_result("p", goal, 3).unwrap().term,
                    *fact,
                    "{}",
                    case["name"]
                );
            }
        }
    }
}

#[test]
fn foundation_matching_and_quoted_proofs_retain_exact_shape_identity() {
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let registry = registry(&format!("{UNIVERSAL}\n{VERIFIER}"), basis);
        for (left, right, same) in [
            (json!("a"), json!(["a"]), false),
            (json!(["a"]), json!(["a"]), true),
            (json!(""), json!([]), false),
        ] {
            let input = node(&json!([
                "meta-match",
                ["atom", left],
                ["atom", right],
                ["no-bindings"]
            ]));
            let expected = node(&if same {
                json!(["match-ok", ["no-bindings"]])
            } else {
                json!("match-failed")
            });
            assert_eq!(
                registry
                    .reduce("links-meta-foundation", &input, 10)
                    .unwrap()
                    .term,
                expected
            );
        }
        let context = json!(["proof-context", "a", [["rule", "axiom", [], "holds"]]]);
        let candidate = node(&json!([
            "proof",
            context,
            "holds",
            "root",
            [["node", "root", "axiom", "holds", [], [], ["axiom"]]],
            ["axiom"]
        ]));
        let goal = node(&json!("holds"));
        let options = LinkedProofOptions::default();
        assert!(
            verify_linked_proof(&registry, &node(&context), &goal, &candidate, &options)
                .unwrap()
                .accepted
        );
        let mut changed = context.clone();
        changed[1] = json!(["a"]);
        assert!(
            !verify_linked_proof(&registry, &node(&changed), &goal, &candidate, &options)
                .unwrap()
                .accepted
        );
        assert!(
            !verify_linked_proof(
                &registry,
                &node(&context),
                &node(&json!(["holds"])),
                &candidate,
                &options
            )
            .unwrap()
            .accepted
        );
    }
}

#[test]
fn inference_cannot_satisfy_repeated_variables_with_different_shapes() {
    for basis in [
        ExecutionBasis::DirectStructural,
        ExecutionBasis::ClosedSk,
        ExecutionBasis::HornRelational,
    ] {
        let registry = registry(SOURCE, basis);
        let goal = node(&json!("same"));
        assert!(registry
            .prove("infer", &goal, &[node(&json!(["pair", "a", ["a"]]))], 4, 10)
            .is_none());
        assert!(registry
            .prove(
                "infer",
                &goal,
                &[node(&json!(["pair", ["a"], ["a"]]))],
                4,
                10
            )
            .is_some());
    }
}
