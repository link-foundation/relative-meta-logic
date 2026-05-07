// Tests for finite-valence counter-model search (issue #58).
// Mirrors `js/tests/counter-model.test.mjs` so JS and Rust stay aligned.

use rml::{counter_model, evaluate, parse_one, tokenize_one, RunResult};

fn link(src: &str) -> rml::Node {
    parse_one(&tokenize_one(src)).unwrap()
}

#[test]
fn finds_kleene_excluded_middle_witness_in_ternary_valence() {
    let witness = counter_model(&link("(or p (not p))"), 3).expect("expected witness");

    assert_eq!(witness.variables, vec!["p"]);
    assert_eq!(witness.valuation, vec![("p".to_string(), 0.5)]);
    assert_eq!(witness.value, 0.5);
}

#[test]
fn returns_none_when_boolean_excluded_middle_has_no_counter_model() {
    let witness = counter_model(&link("(or p (not p))"), 2);

    assert!(witness.is_none());
}

#[test]
fn exposes_counter_model_search_as_lino_form_using_current_valence() {
    let out = evaluate("(valence: 3)\n(counter-model (or p (not p)))", None, None);

    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(
        out.results,
        vec![RunResult::Type(
            "(counter-model (or p (not p)) (valuation (p 0.5)) (value 0.5))".to_string()
        )]
    );
}

#[test]
fn reports_diagnostic_when_lino_form_has_no_finite_valence() {
    let out = evaluate("(counter-model (or p (not p)))", None, None);

    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E041");
    assert!(out.diagnostics[0].message.contains("finite valence"));
}
