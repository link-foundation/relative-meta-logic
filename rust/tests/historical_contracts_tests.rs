use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::{Node, parse_one, tokenize_one};
use serde_json::Value;
const SOURCE: &str = include_str!("../../lib/meta-theory/universal.lino");
fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/historical-contracts/cases.json"
    ))
    .unwrap()
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap()
}
fn term(source: &str) -> Node {
    if source.starts_with('(') {
        parse_one(&tokenize_one(source)).unwrap()
    } else {
        Node::Leaf(source.to_string())
    }
}
fn programs(source: &str) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml_with_basis(source, ExecutionBasis::DirectStructural, &[])
        .unwrap()
}
fn omit(code: &str, kind: &str, program: &str, name: &str) -> String {
    let marker = format!("(linked-{kind} {program} {name}\n");
    let start = code.find(&marker).expect("fixture rule exists");
    let mut depth = 0;
    for (offset, byte) in code.as_bytes()[start..].iter().enumerate() {
        if *byte == b'(' {
            depth += 1;
        }
        if *byte == b')' {
            depth -= 1;
            if depth == 0 {
                return format!("{}{}", &code[..start], &code[start + offset + 1..]);
            }
        }
    }
    panic!("unterminated fixture rule")
}
fn rebound(node: Node, prefix: &str) -> Node {
    match node {
        Node::List(items) => Node::List(items.into_iter().map(|n| rebound(n, prefix)).collect()),
        Node::Leaf(value) => Node::Leaf(if value == "cons" {
            format!("{prefix}-cons")
        } else if value == "empty" {
            format!("{prefix}-empty")
        } else {
            value
        }),
    }
}
fn facts(f: &Value) -> Vec<Node> {
    f["facts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| term(s.as_str().unwrap()))
        .collect()
}
const CONTEXTS: [(&str, &str); 2] = [
    ("set-theory-over-traditional-sequences", "sequence"),
    ("set-theory-over-associative-links", "link"),
];

#[test]
fn executes_every_finite_set_operation_through_unchanged_framework_under_both_imports() {
    let registry = programs(SOURCE);
    for (program, prefix) in CONTEXTS {
        for f in corpus()["sets"].as_array().unwrap() {
            assert_eq!(
                registry
                    .reduce(program, &rebound(term(text(f, "input")), prefix), 10000)
                    .unwrap()
                    .term,
                rebound(term(text(f, "expected")), prefix),
                "{program}: {}",
                text(f, "name")
            );
        }
    }
}
#[test]
fn removing_required_set_rules_breaks_observable_contracts_in_both_imports() {
    for f in corpus()["sets"].as_array().unwrap() {
        let registry = programs(&omit(SOURCE, "rewrite", "set-theory", text(f, "remove")));
        for (program, prefix) in CONTEXTS {
            assert_ne!(
                registry
                    .reduce(program, &rebound(term(text(f, "input")), prefix), 10000)
                    .unwrap()
                    .term,
                rebound(term(text(f, "expected")), prefix),
                "{program}: {}",
                text(f, "name")
            );
        }
    }
}
#[test]
fn derives_graph_endpoint_typing_and_reachability_from_linked_rules() {
    for f in corpus()["graph"].as_array().unwrap() {
        let proof = programs(SOURCE)
            .prove("graph-theory", &term(text(f, "goal")), &facts(f), 8, 128)
            .expect("graph proof");
        assert_eq!(proof.rule, text(f, "remove"));
    }
}
#[test]
fn rejects_graph_constraints_from_unrelated_links_or_removed_rules() {
    for f in corpus()["graph"].as_array().unwrap() {
        let registry = programs(&omit(
            SOURCE,
            "inference",
            "graph-theory",
            text(f, "remove"),
        ));
        assert!(
            registry
                .prove("graph-theory", &term(text(f, "goal")), &facts(f), 8, 128)
                .is_none()
        );
    }
    assert!(
        programs(SOURCE)
            .prove(
                "graph-theory",
                &term("(valid-edge g a b)"),
                &[term("(edge a b)"), term("(vertex g a)")],
                8,
                128
            )
            .is_none()
    );
}
#[test]
fn derives_all_seven_relational_algebra_operations_and_typing_obligations() {
    for f in corpus()["relations"].as_array().unwrap() {
        let proof = programs(SOURCE)
            .prove(
                "relational-algebra",
                &term(text(f, "goal")),
                &facts(f),
                1,
                128,
            )
            .expect(text(f, "name"));
        assert_eq!(proof.rule, text(f, "remove"));
    }
}
#[test]
fn removed_relational_rules_or_unrelated_endpoints_cannot_produce_requested_evidence() {
    for f in corpus()["relations"].as_array().unwrap() {
        let registry = programs(&omit(
            SOURCE,
            "inference",
            "relational-algebra",
            text(f, "remove"),
        ));
        let result = registry
            .search(
                "relational-algebra",
                &[term(text(f, "goal"))],
                &facts(f),
                1,
                128,
                10000,
            )
            .unwrap();
        assert!(result.goals[0].proof.is_none(), "{}", text(f, "name"));
    }
    assert!(
        programs(SOURCE)
            .prove(
                "relational-algebra",
                &term("(valid-pair r a b)"),
                &[
                    term("(member-of a (domain r))"),
                    term("(member-of b (codomain other))")
                ],
                8,
                128
            )
            .is_none()
    );
}
#[test]
fn executes_unknown_inference_without_object_callbacks_and_refuses_missing_premise() {
    let source = "(linked-program unfamiliar)\n(linked-inference unfamiliar consequence (premise (observed ?x)) (premise (enabled ?x)) (conclusion (accepted ?x)))";
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let registry = LinkedProgramRegistry::from_rml_with_basis(source, basis, &[]).unwrap();
        let positive = registry
            .prove(
                "unfamiliar",
                &term("(accepted new-symbol)"),
                &[term("(observed new-symbol)"), term("(enabled new-symbol)")],
                128,
                10000,
            )
            .unwrap();
        assert_eq!(positive.rule, "consequence");
        assert!(
            registry
                .prove(
                    "unfamiliar",
                    &term("(accepted new-symbol)"),
                    &[
                        term("(observed new-symbol)"),
                        term("(enabled other-symbol)")
                    ],
                    128,
                    10000
                )
                .is_none()
        );
    }
}
#[test]
fn linked_beta_evaluation_distinguishes_bound_positions_and_missing_substitution() {
    let request = term(
        "(evaluate (apply (apply (lambda (lambda (bound (successor zero)))) (free a)) (free b)) empty-environment)",
    );
    let result = programs(SOURCE)
        .reduce("lambda-calculus", &request, 10000)
        .unwrap()
        .term;
    assert_eq!(result, term("(free a)"));
    assert_ne!(result, term("(free b)"));
    let changed = omit(
        SOURCE,
        "rewrite",
        "lambda-calculus",
        "evaluate-bound-successor",
    );
    assert_ne!(
        programs(&changed)
            .reduce("lambda-calculus", &request, 10000)
            .unwrap()
            .term,
        term("(free a)")
    );
}
