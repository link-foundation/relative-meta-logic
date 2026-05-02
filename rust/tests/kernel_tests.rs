// Typed kernel rules for issues #37 and #38.
//
// These tests keep the documented D1 surface honest: Pi formation, lambda
// formation, application by beta-reduction, capture-avoiding substitution,
// freshness, and type membership/query links.

use rml::{evaluate, RunResult};

fn evaluate_clean(src: &str) -> Vec<RunResult> {
    let out = evaluate(src, None, None);
    assert!(
        out.diagnostics.is_empty(),
        "unexpected diagnostics: {:?}",
        out.diagnostics
    );
    out.results
}

#[test]
fn forms_pi_type_and_records_type_zero_membership() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(succ: (Pi (Natural n) Natural))
(? (Pi (Natural n) Natural))
(? ((Pi (Natural n) Natural) of (Type 0)))
(? (succ of (Pi (Natural n) Natural)))
(? (type of succ))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Num(1.0),
            RunResult::Num(1.0),
            RunResult::Num(1.0),
            RunResult::Type("(Pi (Natural n) Natural)".to_string()),
        ]
    );
}

#[test]
fn types_named_lambda_under_bound_parameter_context() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(identity: lambda (Natural x) x)
(? (identity of (Pi (Natural x) Natural)))
(? (type of identity))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Num(1.0),
            RunResult::Type("(Pi (Natural x) Natural)".to_string()),
        ]
    );
}

#[test]
fn keeps_named_lambda_parameter_scoped_to_lambda_body() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(identity: lambda (Natural x) x)
(? (x of Natural))
"#,
    );
    assert_eq!(results, vec![RunResult::Num(0.0)]);
}

#[test]
fn applies_lambdas_by_beta_reducing_argument_into_body() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(identity: lambda (Natural x) x)
(? ((apply identity zero) = zero))
(? (apply (lambda (Natural x) (x + 1)) 0))
(? (apply (lambda (Natural x) (x + 0.1)) 0.2))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Num(1.0),
            RunResult::Num(1.0),
            RunResult::Num(0.3)
        ]
    );
}

#[test]
fn beta_reduces_open_terms_without_evaluating_free_variables_as_probabilities() {
    let results = evaluate_clean(
        r#"
(? (apply (lambda (Natural x) (x + y)) z))
"#,
    );
    assert_eq!(results, vec![RunResult::Type("(z + y)".to_string())]);
}

#[test]
fn beta_reduction_is_capture_avoiding_for_open_replacements() {
    let results = evaluate_clean(
        r#"
(? (apply (lambda (Natural x) (lambda (Natural y) (x + y))) y))
"#,
    );
    assert_eq!(
        results,
        vec![RunResult::Type(
            "(lambda (Natural y_1) (y + y_1))".to_string()
        )]
    );
}

#[test]
fn exposes_substitution_as_capture_avoiding_kernel_primitive() {
    let results = evaluate_clean(
        r#"
(? (subst (lambda (Natural y) (x + y)) x y))
(? ((subst (lambda (Natural y) (x + y)) x y) = (lambda (Natural y_1) (y + y_1))))
(? ((subst (x + 0.1) x 0.2) = 0.3))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Type("(lambda (Natural y_1) (y + y_1))".to_string()),
            RunResult::Num(1.0),
            RunResult::Num(1.0),
        ]
    );
}

#[test]
fn scopes_fresh_variables_and_rejects_names_already_in_context() {
    let ok = evaluate(
        r#"
(? (fresh y in ((lambda (Natural x) (x + y)) y)))
(? (y of Natural))
"#,
        None,
        None,
    );
    assert!(
        ok.diagnostics.is_empty(),
        "unexpected diagnostics: {:?}",
        ok.diagnostics
    );
    assert_eq!(ok.results, vec![RunResult::Num(1.0), RunResult::Num(0.0)]);

    let bad = evaluate(
        r#"
(Natural: (Type 0) Natural)
(y: Natural y)
(? (fresh y in y))
"#,
        None,
        None,
    );
    assert!(bad.results.is_empty());
    assert_eq!(bad.diagnostics.len(), 1);
    assert_eq!(bad.diagnostics[0].code, "E010");
    assert!(
        bad.diagnostics[0].message.contains("fresh variable \"y\""),
        "message: {}",
        bad.diagnostics[0].message
    );
}

#[test]
fn checks_type_membership_and_returns_stored_types_through_of_links() {
    let results = evaluate_clean(
        r#"
(Type: Type Type)
(Natural: Type Natural)
(zero: Natural zero)
(Type 0)
(Type 1)
(? (zero of Natural))
(? (Natural of Type))
(? (type of zero))
(? ((Type 0) of (Type 1)))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Num(1.0),
            RunResult::Num(1.0),
            RunResult::Type("Natural".to_string()),
            RunResult::Num(1.0),
        ]
    );
}
