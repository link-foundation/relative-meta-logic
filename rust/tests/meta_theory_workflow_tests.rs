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

const ADDRESS: &str = "rml.formal.lean.SetSequenceEquivalence.toOrderedUnique";

#[test]
fn upstream_definitions_run_on_new_data() {
    on_large_stack(|| {
        let registry = native_registry(PRELUDE, PROGRAM).unwrap();
        let ordered = workflow::native_call(&registry, ADDRESS, vec![workflow::native_list(&[9, 4, 9, 0])]).unwrap();
        assert_eq!(render_native_value(&ordered, "lean"), "[0, 4, 9]");
    });
}

#[test]
fn a_changed_definition_body_does_not_reproduce_the_original_result() {
    on_large_stack(|| {
        let registry = native_registry(PRELUDE, PROGRAM).unwrap();
        let ordered = workflow::native_call(&registry, ADDRESS, vec![workflow::native_list(&[9, 4, 9, 0])]).unwrap();
        let marker = format!("# {ADDRESS}\n");
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
        let mut term = vec![rml::Node::Leaf(ADDRESS.to_string())];
        term.push(workflow::native_list(&[9, 4, 9, 0]));
        let result = changed
            .reduce_result(META_THEORY_NATIVE_PROGRAM, &rml::Node::List(term), NATIVE_MAX_STEPS)
            .unwrap();
        assert_ne!(result.term, ordered);
    });
}

#[test]
fn a_changed_specification_definition_changes_the_recipe_result() {
    on_large_stack(|| {
        let program = "relational-algebra-specification";
        let sources = workflow::specification_sources(&[]);
        let source = &sources.iter().find(|(name, _)| *name == program).unwrap().1;
        // The natural join keeps every right-only field; dropping them changes every join.
        let original = "(to (ra-merge-fields ?left-schema ?rest (ra-cons (ra-field ?attribute ?value) ?accumulator))))";
        assert!(source.contains(original));
        let altered = source.replace(original, "(to (ra-merge-fields ?left-schema ?rest ?accumulator)))");
        let report = workflow::run_specifications(&workflow::specification_sources(&[(program, altered.as_str())])).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../../test-corpus/researcher-workflow/meta-theory-expected.json"
        ))
        .unwrap();
        let rows = report.as_array().unwrap();
        let recorded_rows = expected["specifications"].as_array().unwrap();
        let row = rows.iter().find(|item| item["program"] == program).unwrap();
        let recorded = recorded_rows.iter().find(|item| item["program"] == program).unwrap();
        assert_ne!(row, recorded);
        assert!(row["casesReproduced"].as_u64().unwrap() < recorded["casesReproduced"].as_u64().unwrap());
        for theorem in ["join-associative", "join-commutative", "select-pushdown-join", "join-distributes-over-union"] {
            assert!(recorded["certified"].as_array().unwrap().iter().any(|item| item == theorem), "{theorem}");
            assert!(!row["certified"].as_array().unwrap().iter().any(|item| item == theorem), "{theorem}");
        }
        for other in rows.iter().filter(|item| item["program"] != program) {
            let recorded_other = recorded_rows.iter().find(|item| item["program"] == other["program"]).unwrap();
            assert_eq!(other, recorded_other);
        }
    });
}
