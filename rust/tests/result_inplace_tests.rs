use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::{parse_one, tokenize_one, Node};
use serde_json::Value;
use std::fs;
use std::path::Path;

const SOURCE: &str = r#"
(linked-program p)
(linked-rewrite p ancestor (from (wrap (ready ?x) (ready ?y))) (to (done ?x ?y)))
(linked-rewrite p child (from (seed ?x)) (to (ready ?x)))
(linked-rewrite p repeated (from (same ?x ?x)) (to (twice ?x ?x)))
(linked-rewrite p literal (from (a b)) (to pair))
(linked-rewrite p atom (from leaf) (to finished))
"#;

fn node(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.to_string())
    }
}
fn registry(disabled: &[&str]) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(SOURCE, ExecutionBasis::DirectStructural, disabled)
        .unwrap()
}
fn compare(input: &Node, bound: usize, disabled: &[&str]) {
    let full = registry(disabled);
    let summary = registry(disabled);
    let expected = full
        .reduce("p", input, bound)
        .map(|result| (result.term, result.trace.len()));
    let actual = summary
        .reduce_result("p", input, bound)
        .map(|result| (result.term, result.steps));
    assert_eq!(actual, expected);
    assert_eq!(
        summary.runtime_semantic_trace(),
        full.runtime_semantic_trace()
    );
}

#[test]
fn normal_siblings_do_not_hide_a_new_ancestor_match_or_later_child() {
    for input in [
        node("(wrap (seed x) (seed y))"),
        node("(outer (normal (deep data)) (wrap (seed x) (seed y)) (seed z))"),
        node("(outer (same (normal data) (normal data)) (seed z) leaf)"),
        node("(same (seed x) (ready x))"),
    ] {
        for bound in [0, 1, 2, 3, 4, 20] {
            compare(&input, bound, &[]);
        }
    }
    let result = registry(&[])
        .reduce_result("p", &node("(wrap (seed x) (seed y))"), 4)
        .unwrap();
    assert_eq!((result.term, result.steps), (node("(done x y)"), 3));
}

#[test]
fn normality_cache_distinguishes_leaf_and_list_display_collisions() {
    let input = Node::List(vec![
        Node::Leaf("outer".into()),
        Node::Leaf("a,b".into()),
        node("(a b)"),
        Node::Leaf("(a b)".into()),
        Node::List(vec![]),
        Node::Leaf("".into()),
    ]);
    compare(&input, 4, &[]);
    let result = registry(&[]).reduce_result("p", &input, 4).unwrap();
    assert_eq!(result.steps, 1);
    let Node::List(children) = result.term else {
        panic!("outer list")
    };
    assert_eq!(children[1], Node::Leaf("a,b".into()));
    assert_eq!(children[2], Node::Leaf("pair".into()));
    assert_eq!(children[3], Node::Leaf("(a b)".into()));
}

#[test]
fn normality_does_not_cross_runs_with_different_program_rules() {
    let programs = LinkedProgramRegistry::from_rml_with_basis(
        "(linked-program first)\n(linked-program second)\n(linked-rewrite second change (from (unmatched ?x)) (to (new ?x)))",
        ExecutionBasis::DirectStructural,
        &[],
    ).unwrap();
    let input = node("(unmatched x)");
    assert_eq!(programs.reduce_result("first", &input, 4).unwrap().steps, 0);
    for _ in 0..2 {
        let result = programs.reduce_result("second", &input, 4).unwrap();
        assert_eq!((result.term, result.steps), (node("(new x)"), 1));
    }
}

#[test]
fn result_and_repeated_replacement_occurrences_remain_owned() {
    let mut input = node("(same (normal data) (normal data))");
    let snapshot = input.clone();
    let mut result = registry(&[]).reduce_result("p", &input, 4).unwrap();
    assert_eq!(input, snapshot);
    let result_snapshot = result.clone();
    if let Node::List(children) = &mut input {
        children[1] = node("changed-input");
    }
    assert_eq!(result, result_snapshot);
    if let Node::List(children) = &mut result.term {
        children[1] = node("changed-result");
        assert_eq!(children[2], node("(normal data)"));
    }
    assert_ne!(input, snapshot);
}

#[test]
fn normality_memoization_preserves_first_guard_error_and_complete_observers() {
    let operations = [
        "resolve-and-rebind-program-imports",
        "enforce-cycle-and-resource-bounds",
        "select-and-traverse-rewrite-rules",
        "compare-link-structure",
        "bind-pattern-variables",
        "substitute-bound-structures",
    ];
    for first in operations {
        for second in operations {
            for input in [
                node("(outer (normal a) (normal a) (seed x))"),
                node("(wrap (seed x) (seed y))"),
                node("(same (normal a) (normal b))"),
            ] {
                compare(&input, 20, &[first, second]);
            }
        }
    }
}

#[test]
fn all_thirty_seven_recursion_cases_match_full_results_counts_and_observers() {
    fn data(value: &Value) -> Node {
        match value {
            Value::String(value) => Node::Leaf(value.clone()),
            Value::Array(values) => Node::List(values.iter().map(data).collect()),
            _ => panic!("fixture terms must be strings and arrays"),
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let cases: Value = serde_json::from_str(
        &fs::read_to_string(root.join("test-corpus/linked-dispatch/typed-recursion-cases.json"))
            .unwrap(),
    )
    .unwrap();
    let source =
        fs::read_to_string(root.join("test-corpus/linked-dispatch/typed-recursion-source.lino"))
            .unwrap();
    let mut total = 0;
    for case in cases["cases"].as_array().unwrap() {
        let full = LinkedProgramRegistry::from_rml_with_basis(
            &source,
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap();
        let summary = LinkedProgramRegistry::from_rml_with_basis(
            &source,
            ExecutionBasis::DirectStructural,
            &[],
        )
        .unwrap();
        let input = data(&case["request"]);
        let name = cases["program"].as_str().unwrap();
        let bound = cases["maxSteps"].as_u64().unwrap() as usize;
        let expected = full.reduce(name, &input, bound).unwrap();
        let actual = summary.reduce_result(name, &input, bound).unwrap();
        assert_eq!(actual.term, expected.term, "{}", case["name"]);
        assert_eq!(actual.steps, expected.trace.len(), "{}", case["name"]);
        assert_eq!(
            summary.runtime_semantic_trace(),
            full.runtime_semantic_trace(),
            "{}",
            case["name"]
        );
        total += actual.steps;
    }
    assert_eq!(cases["cases"].as_array().unwrap().len(), 37);
    assert_eq!(total, 9392);
}
