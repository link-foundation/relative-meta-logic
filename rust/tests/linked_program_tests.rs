use std::fs;
use std::path::PathBuf;

use rml::linked_program::LinkedProgramRegistry;
use rml::{parse_one, tokenize_one, Node};

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).expect("test term must parse")
}

fn source() -> String {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().expect("repository root");
    fs::read_to_string(root.join("lib/meta-theory/universal.lino"))
        .expect("universal linked program")
}

fn registry(extra: &str) -> LinkedProgramRegistry {
    LinkedProgramRegistry::from_rml(&format!("{}\n{}", source(), extra))
        .expect("linked programs must load")
}

#[test]
fn performs_binding_substitution_and_beta_reduction_without_a_host_adapter() {
    let programs = registry("");
    let result = programs
        .reduce(
            "lambda-calculus",
            &node("(beta (lambda (bound zero)) (free a))"),
            10_000,
        )
        .expect("identity reduces");
    assert_eq!(result.term, node("(free a)"));

    let capture_safe = node(
        "(evaluate (apply (apply (lambda (lambda (bound (successor zero)))) (free a)) (free b)) empty-environment)",
    );
    let result = programs
        .reduce("lambda-calculus", &capture_safe, 10_000)
        .expect("nested binders reduce");
    assert_eq!(result.term, node("(free a)"));
}

#[test]
fn loads_a_new_logic_from_links_without_a_rust_callback() {
    let programs = registry(
        "(linked-program user-logic)\n\
         (linked-rewrite user-logic eliminate-double-negation\n\
           (from (negate (negate ?proposition)))\n\
           (to ?proposition))",
    );
    let result = programs
        .reduce("user-logic", &node("(negate (negate p))"), 10_000)
        .expect("custom logic reduces");
    assert_eq!(result.term, Node::Leaf("p".to_string()));
    assert_eq!(result.trace[0].rule, "eliminate-double-negation");
}

#[test]
fn derives_judgements_through_user_defined_inference() {
    let programs = registry(
        "(linked-program user-proof-system)\n\
         (linked-fact user-proof-system premise-p (judgement (holds p)))\n\
         (linked-fact user-proof-system premise-p-implies-q (judgement (implies p q)))\n\
         (linked-inference user-proof-system modus-ponens\n\
           (premise (holds ?antecedent))\n\
           (premise (implies ?antecedent ?consequent))\n\
           (conclusion (holds ?consequent)))",
    );
    let proof = programs
        .prove("user-proof-system", &node("(holds q)"), &[], 128, 10_000)
        .expect("proof search succeeds");
    assert_eq!(proof.rule, "modus-ponens");
    assert_eq!(proof.premises[0].rule, "premise-p");
}

#[test]
fn defines_sets_graphs_relations_and_types_as_linked_programs() {
    let programs = registry("");
    let set = node("(cons a (cons b (empty)))");
    let result = programs
        .reduce("set-theory", &node(&format!("(member b {set})")), 10_000)
        .expect("membership reduces");
    assert_eq!(result.term, Node::Leaf("true".to_string()));

    assert!(programs
        .prove(
            "graph-theory",
            &node("(reachable a c)"),
            &[node("(edge a b)"), node("(edge b c)")],
            128,
            10_000,
        )
        .is_some());
    assert!(programs
        .prove(
            "relational-algebra",
            &node("(relates (compose left right) a c)"),
            &[node("(relates left a b)"), node("(relates right b c)"),],
            128,
            10_000,
        )
        .is_some());
    assert!(programs
        .prove(
            "dependent-type-theory",
            &node("(has-type (apply (lambda Nat (bound zero)) zero) Nat)"),
            &[],
            128,
            10_000,
        )
        .is_some());
}

#[test]
fn rejects_unbound_replacements_and_rewrite_cycles() {
    let invalid = format!(
        "{}\n(linked-program invalid)\n\
         (linked-rewrite invalid unbound (from (f ?x)) (to (g ?missing)))",
        source()
    );
    assert!(LinkedProgramRegistry::from_rml(&invalid)
        .expect_err("unbound replacement must fail")
        .contains("unbound variable ?missing"));

    let programs = registry(
        "(linked-program looping)\n\
         (linked-rewrite looping left (from left) (to right))\n\
         (linked-rewrite looping right (from right) (to left))",
    );
    assert!(programs
        .reduce("looping", &Node::Leaf("left".to_string()), 10_000)
        .expect_err("cycle must fail")
        .contains("rewrite cycle"));
}

#[test]
fn applies_proof_fact_bound_to_declared_and_input_facts() {
    let programs = registry(
        "(linked-program bounded-proof)\n\
         (linked-fact bounded-proof first (judgement (holds a)))\n\
         (linked-fact bounded-proof second (judgement (holds b)))",
    );
    assert!(programs
        .prove("bounded-proof", &node("(holds b)"), &[], 128, 1)
        .is_none());

    let input_only = registry("(linked-program bounded-input)");
    assert!(input_only
        .prove(
            "bounded-input",
            &node("(holds b)"),
            &[node("(holds a)"), node("(holds b)")],
            128,
            1,
        )
        .is_none());
}
