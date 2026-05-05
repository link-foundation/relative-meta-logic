// Prenex polymorphism tests for issue #52 (D9).
//
// Mirrors `js/tests/prenex-polymorphism.test.mjs` so both runtimes lock
// in the same surface form `(forall A T)` ≡ `(Pi (Type A) T)` and the
// three canonical examples — polymorphic identity, apply, and compose.

use rml::{check, eval_node, key_of, synth, Env, Node};

fn leaf(s: &str) -> Node {
    Node::Leaf(s.to_string())
}

fn list(children: Vec<Node>) -> Node {
    Node::List(children)
}

fn base_env() -> Env {
    let mut env = Env::new(None);
    eval_node(
        &list(vec![leaf("Type:"), leaf("Type"), leaf("Type")]),
        &mut env,
    );
    eval_node(
        &list(vec![leaf("Natural:"), leaf("Type"), leaf("Natural")]),
        &mut env,
    );
    eval_node(
        &list(vec![leaf("Boolean:"), leaf("Type"), leaf("Boolean")]),
        &mut env,
    );
    eval_node(
        &list(vec![leaf("zero:"), leaf("Natural"), leaf("zero")]),
        &mut env,
    );
    env
}

#[test]
fn synth_forall_at_universe_type() {
    let mut env = base_env();
    // (forall A (Pi (A x) A)) — the polymorphic identity type
    let result = synth(
        &list(vec![
            leaf("forall"),
            leaf("A"),
            list(vec![
                leaf("Pi"),
                list(vec![leaf("A"), leaf("x")]),
                leaf("A"),
            ]),
        ]),
        &mut env,
    );
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(key_of(&result.typ.unwrap()), "(Type 0)");
}

#[test]
fn forall_is_definitionally_equal_to_explicit_pi_type() {
    let mut env = base_env();
    let poly_type = list(vec![
        leaf("forall"),
        leaf("A"),
        list(vec![
            leaf("Pi"),
            list(vec![leaf("A"), leaf("x")]),
            leaf("A"),
        ]),
    ]);
    let desugared = list(vec![
        leaf("Pi"),
        list(vec![leaf("Type"), leaf("A")]),
        list(vec![
            leaf("Pi"),
            list(vec![leaf("A"), leaf("x")]),
            leaf("A"),
        ]),
    ]);
    eval_node(
        &list(vec![leaf("polyId:"), desugared.clone()]),
        &mut env,
    );
    let r = check(&leaf("polyId"), &poly_type, &mut env);
    assert!(r.ok, "diagnostics: {:?}", r.diagnostics);
}

#[test]
fn check_polymorphic_identity_value_against_forall_type() {
    let mut env = base_env();
    let poly_type = list(vec![
        leaf("forall"),
        leaf("A"),
        list(vec![
            leaf("Pi"),
            list(vec![leaf("A"), leaf("x")]),
            leaf("A"),
        ]),
    ]);
    // (lambda (Type A) (lambda (A x) x))
    let poly_value = list(vec![
        leaf("lambda"),
        list(vec![leaf("Type"), leaf("A")]),
        list(vec![
            leaf("lambda"),
            list(vec![leaf("A"), leaf("x")]),
            leaf("x"),
        ]),
    ]);
    let result = check(&poly_value, &poly_type, &mut env);
    assert!(result.ok, "diagnostics: {:?}", result.diagnostics);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn instantiate_polymorphic_identity_at_natural() {
    let mut env = base_env();
    eval_node(
        &list(vec![
            leaf("polyId:"),
            list(vec![
                leaf("forall"),
                leaf("A"),
                list(vec![
                    leaf("Pi"),
                    list(vec![leaf("A"), leaf("x")]),
                    leaf("A"),
                ]),
            ]),
        ]),
        &mut env,
    );
    let result = synth(
        &list(vec![leaf("apply"), leaf("polyId"), leaf("Natural")]),
        &mut env,
    );
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(
        key_of(&result.typ.unwrap()),
        "(Pi (Natural x) Natural)"
    );
}

#[test]
fn fully_apply_polymorphic_identity() {
    let mut env = base_env();
    eval_node(
        &list(vec![
            leaf("polyId:"),
            list(vec![
                leaf("forall"),
                leaf("A"),
                list(vec![
                    leaf("Pi"),
                    list(vec![leaf("A"), leaf("x")]),
                    leaf("A"),
                ]),
            ]),
        ]),
        &mut env,
    );
    // (apply (apply polyId Natural) zero) :: Natural
    let result = synth(
        &list(vec![
            leaf("apply"),
            list(vec![leaf("apply"), leaf("polyId"), leaf("Natural")]),
            leaf("zero"),
        ]),
        &mut env,
    );
    assert!(result.diagnostics.is_empty(), "{:?}", result.diagnostics);
    assert_eq!(key_of(&result.typ.unwrap()), "Natural");
}

#[test]
fn check_polymorphic_apply() {
    let mut env = base_env();
    // forall A. forall B. (A -> B) -> (A -> B)
    let apply_type = list(vec![
        leaf("forall"),
        leaf("A"),
        list(vec![
            leaf("forall"),
            leaf("B"),
            list(vec![
                leaf("Pi"),
                list(vec![
                    list(vec![
                        leaf("Pi"),
                        list(vec![leaf("A"), leaf("x")]),
                        leaf("B"),
                    ]),
                    leaf("f"),
                ]),
                list(vec![
                    leaf("Pi"),
                    list(vec![leaf("A"), leaf("x")]),
                    leaf("B"),
                ]),
            ]),
        ]),
    ]);

    let apply_value = list(vec![
        leaf("lambda"),
        list(vec![leaf("Type"), leaf("A")]),
        list(vec![
            leaf("lambda"),
            list(vec![leaf("Type"), leaf("B")]),
            list(vec![
                leaf("lambda"),
                list(vec![
                    list(vec![
                        leaf("Pi"),
                        list(vec![leaf("A"), leaf("x")]),
                        leaf("B"),
                    ]),
                    leaf("f"),
                ]),
                list(vec![
                    leaf("lambda"),
                    list(vec![leaf("A"), leaf("x")]),
                    list(vec![leaf("apply"), leaf("f"), leaf("x")]),
                ]),
            ]),
        ]),
    ]);

    let result = check(&apply_value, &apply_type, &mut env);
    assert!(result.ok, "diagnostics: {:?}", result.diagnostics);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn check_polymorphic_compose() {
    let mut env = base_env();
    // forall A. forall B. forall C. (B -> C) -> (A -> B) -> (A -> C)
    let compose_type = list(vec![
        leaf("forall"),
        leaf("A"),
        list(vec![
            leaf("forall"),
            leaf("B"),
            list(vec![
                leaf("forall"),
                leaf("C"),
                list(vec![
                    leaf("Pi"),
                    list(vec![
                        list(vec![
                            leaf("Pi"),
                            list(vec![leaf("B"), leaf("y")]),
                            leaf("C"),
                        ]),
                        leaf("g"),
                    ]),
                    list(vec![
                        leaf("Pi"),
                        list(vec![
                            list(vec![
                                leaf("Pi"),
                                list(vec![leaf("A"), leaf("x")]),
                                leaf("B"),
                            ]),
                            leaf("f"),
                        ]),
                        list(vec![
                            leaf("Pi"),
                            list(vec![leaf("A"), leaf("x")]),
                            leaf("C"),
                        ]),
                    ]),
                ]),
            ]),
        ]),
    ]);

    let compose_value = list(vec![
        leaf("lambda"),
        list(vec![leaf("Type"), leaf("A")]),
        list(vec![
            leaf("lambda"),
            list(vec![leaf("Type"), leaf("B")]),
            list(vec![
                leaf("lambda"),
                list(vec![leaf("Type"), leaf("C")]),
                list(vec![
                    leaf("lambda"),
                    list(vec![
                        list(vec![
                            leaf("Pi"),
                            list(vec![leaf("B"), leaf("y")]),
                            leaf("C"),
                        ]),
                        leaf("g"),
                    ]),
                    list(vec![
                        leaf("lambda"),
                        list(vec![
                            list(vec![
                                leaf("Pi"),
                                list(vec![leaf("A"), leaf("x")]),
                                leaf("B"),
                            ]),
                            leaf("f"),
                        ]),
                        list(vec![
                            leaf("lambda"),
                            list(vec![leaf("A"), leaf("x")]),
                            list(vec![
                                leaf("apply"),
                                leaf("g"),
                                list(vec![leaf("apply"), leaf("f"), leaf("x")]),
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ]),
    ]);

    let result = check(&compose_value, &compose_type, &mut env);
    assert!(result.ok, "diagnostics: {:?}", result.diagnostics);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn wrong_instantiation_emits_e021() {
    let mut env = base_env();
    eval_node(
        &list(vec![
            leaf("polyId:"),
            list(vec![
                leaf("forall"),
                leaf("A"),
                list(vec![
                    leaf("Pi"),
                    list(vec![leaf("A"), leaf("x")]),
                    leaf("A"),
                ]),
            ]),
        ]),
        &mut env,
    );
    // (apply polyId Natural) :: (Pi (Natural x) Natural). Checking against
    // (Pi (Boolean x) Boolean) is a definitional mismatch.
    let r = check(
        &list(vec![leaf("apply"), leaf("polyId"), leaf("Natural")]),
        &list(vec![
            leaf("Pi"),
            list(vec![leaf("Boolean"), leaf("x")]),
            leaf("Boolean"),
        ]),
        &mut env,
    );
    assert!(!r.ok);
    assert!(
        r.diagnostics.iter().any(|d| d.code == "E021"),
        "expected E021 in {:?}",
        r.diagnostics.iter().map(|d| d.code.clone()).collect::<Vec<_>>()
    );
}
