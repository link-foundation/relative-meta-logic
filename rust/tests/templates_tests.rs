// Tests for `(template ...)` expansion (issue #59).
// Mirrors js/tests/templates.test.mjs so the two implementations keep the
// same macro/template surface.

use rml::{evaluate, run, RunResult};

#[test]
fn expands_reusable_assignment_shape_before_evaluation() {
    let out = evaluate(
        r#"
(template (known expr value)
  (expr has probability value))
(known (a = b) 1)
(? (a = b))
"#,
        None,
        None,
    );
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(out.results, vec![RunResult::Num(1.0)]);
}

#[test]
fn expansion_is_available_through_legacy_run_helper() {
    let out = run(
        r#"
(template (known expr value)
  (expr has probability value))
(known (a = b) 1)
(? (a = b))
"#,
        None,
    );
    assert_eq!(out, vec![1.0]);
}

#[test]
fn expands_nested_template_uses_until_ordinary_forms_remain() {
    let out = evaluate(
        r#"
(template (known expr value)
  (expr has probability value))
(template (known-true expr)
  (known expr 1))
(known-true (a = b))
(? (a = b))
"#,
        None,
        None,
    );
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(out.results, vec![RunResult::Num(1.0)]);
}

#[test]
fn renames_introduced_binders_so_placeholder_arguments_are_not_captured() {
    let out = evaluate(
        r#"
(Term: (Type 0) Term)
(zero: Term zero)
(x: Term x)
(template (const body)
  (lambda (Term x) body))
(? (nf (apply (const x) zero)))
"#,
        None,
        None,
    );
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(out.results, vec![RunResult::Type("x".to_string())]);
}
