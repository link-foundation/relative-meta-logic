#[path = "../examples/meta_theory_workflow.rs"]
mod workflow;
use rml::meta_theory_native::{native_registry, render_native_value, META_THEORY_NATIVE_PROGRAM, NATIVE_MAX_STEPS};
use serde_json::Value;

const PRELUDE: &str = include_str!("../../lib/meta-theory/meta-theory-native-prelude.lino");
const PROGRAM: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native.lino");

fn on_large_stack<F: FnOnce() + Send + 'static>(run: F) {
    std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn meta_theory_recipe_reproduces_the_shared_report() {
    on_large_stack(|| {
        let expected: Value = serde_json::from_str(include_str!(
            "../../test-corpus/researcher-workflow/meta-theory-expected.json"
        ))
        .unwrap();
        assert_eq!(workflow::run().unwrap(), expected);
    });
}

#[test]
fn upstream_definitions_run_on_new_data_and_a_changed_body_changes_the_result() {
    on_large_stack(|| {
        let address = "rml.formal.lean.SetSequenceEquivalence.toOrderedUnique";
        let registry = native_registry(PRELUDE, PROGRAM).unwrap();
        let ordered = workflow::native_call(&registry, address, vec![workflow::native_list(&[9, 4, 9, 0])]).unwrap();
        assert_eq!(render_native_value(&ordered, "lean"), "[0, 4, 9]");
        let marker = format!("# {address}\n");
        let start = PROGRAM.find(&marker).unwrap();
        let end = start + PROGRAM[start..].find("\n\n").unwrap();
        let altered = format!(
            "{}{}{}",
            &PROGRAM[..start],
            PROGRAM[start..end].replace("rml.formal.lean.SetSequenceEquivalence.insertSorted", "mt-cons"),
            &PROGRAM[end..]
        );
        assert_ne!(altered, PROGRAM);
        let changed = native_registry(PRELUDE, &altered).unwrap();
        let mut term = vec![rml::Node::Leaf(address.to_string())];
        term.push(workflow::native_list(&[9, 4, 9, 0]));
        let result = changed
            .reduce_result(META_THEORY_NATIVE_PROGRAM, &rml::Node::List(term), NATIVE_MAX_STEPS)
            .unwrap();
        assert_ne!(result.term, ordered);
    });
}
