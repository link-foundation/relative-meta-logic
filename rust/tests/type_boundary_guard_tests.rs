use rml::lino_frontend::{MAX_LINO_NESTING_DEPTH, MAX_LINO_SOURCE_UNITS};
use rml::{check, emit_lino_term, synth, Env, Node};
use std::panic::{catch_unwind, AssertUnwindSafe};
fn leaf(s: &str) -> Node {
    Node::Leaf(s.to_string())
}
fn nested(depth: usize) -> Node {
    let mut node = leaf("leaf");
    for _ in 0..depth {
        node = Node::List(vec![node]);
    }
    node
}

#[test]
fn type_store_failures_are_atomic_and_checker_boundaries_return_explicit_diagnostics() {
    for (input, message) in [
        (nested(MAX_LINO_NESTING_DEPTH + 1), "nesting limit"),
        (
            leaf(&"x".repeat(MAX_LINO_SOURCE_UNITS + 1)),
            "source length limit",
        ),
    ] {
        let mut env = Env::new(None);
        env.set_type_node(&leaf("kept"), &leaf("Original"));
        let types = env.types.clone();
        let terms = env.terms.clone();
        assert!(catch_unwind(AssertUnwindSafe(
            || env.set_type_node(&input, &leaf("Other"))
        ))
        .is_err());
        assert_eq!(env.types, types);
        assert!(
            catch_unwind(AssertUnwindSafe(|| env.set_type_node(&leaf("kept"), &input))).is_err()
        );
        assert_eq!(env.types, types);
        assert!(catch_unwind(AssertUnwindSafe(|| env.get_type_node(&input))).is_err());
        let result = synth(&input, &mut env);
        assert!(result.typ.is_none());
        assert!(result.diagnostics[0].message.contains(message));
        for result in [
            check(&input, &leaf("T"), &mut env),
            check(&leaf("kept"), &input, &mut env),
        ] {
            assert!(!result.ok);
            assert!(result.diagnostics[0].message.contains(message));
        }
        assert_eq!(env.types, types);
        assert_eq!(env.terms, terms);
    }
}

#[test]
fn exact_depth_and_source_limits_survive_type_storage_and_decoding() {
    let mut env = Env::new(None);
    let deepest = nested(MAX_LINO_NESTING_DEPTH);
    env.set_type_node(&deepest, &leaf("T"));
    assert_eq!(synth(&deepest, &mut env).typ, Some(leaf("T")));
    env.set_type_node(&leaf("deep-type"), &deepest);
    assert_eq!(
        synth(&leaf("deep-type"), &mut env).typ,
        Some(deepest.clone())
    );
    assert!(check(&leaf("deep-type"), &deepest, &mut env).ok);
    let largest = leaf(&"x".repeat(MAX_LINO_SOURCE_UNITS));
    env.set_type_node(&leaf("large-type"), &largest);
    assert_eq!(synth(&leaf("large-type"), &mut env).typ, Some(largest));
}

#[test]
fn owned_inputs_and_returned_types_do_not_mutate_stored_snapshots() {
    let shared_value = Node::List(vec![leaf("constructor"), leaf("label")]);
    let term = Node::List(vec![
        leaf("pair"),
        shared_value.clone(),
        shared_value.clone(),
    ]);
    let typ = Node::List(vec![
        leaf("TypeOf"),
        shared_value.clone(),
        shared_value.clone(),
    ]);
    let mut env = Env::new(None);
    env.set_type_node(&term, &typ);
    let stored = env.get_type_node(&term).unwrap().clone();
    assert_eq!(stored, emit_lino_term(&typ));
    assert!(check(&term, &typ, &mut env).ok);
    let mut result = synth(&term, &mut env).typ.unwrap();
    assert_eq!(result, typ);
    if let Node::List(children) = &mut result {
        children[1] = leaf("changed");
    }
    assert_eq!(env.get_type_node(&term), Some(&stored));
    assert_eq!(
        shared_value,
        Node::List(vec![leaf("constructor"), leaf("label")])
    );
}
