// Tests for coverage checking (issue #46, D14).
// Mirrors js/tests/coverage.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{evaluate, evaluate_with_env, is_covered, Env};

#[test]
fn coverage_accepts_a_relation_covering_every_natural_constructor() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode double +input -output)\n\
         (relation double\n\
         (double zero zero)\n\
         (double (succ n) (succ (succ (double n)))))\n\
         (coverage double)",
        None,
        None,
    );
    assert!(
        out.diagnostics.is_empty(),
        "expected no diagnostics, got: {:?}",
        out.diagnostics
    );
}

#[test]
fn coverage_accepts_wildcard_input_slot() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode id +input -output)\n\
         (relation id (id n n))\n\
         (coverage id)",
        None,
        None,
    );
    assert!(
        out.diagnostics.is_empty(),
        "expected no diagnostics, got: {:?}",
        out.diagnostics
    );
}

#[test]
fn coverage_rejects_omitted_succ_case() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode f +input -output)\n\
         (relation f (f zero zero))\n\
         (coverage f)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0].message.contains("missing case"),
        "msg was: {}",
        e035[0].message
    );
    assert!(
        e035[0].message.contains("(succ"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn coverage_rejects_omitted_zero_case() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode g +input -output)\n\
         (relation g ((g (succ n) zero)))\n\
         (coverage g)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert!(!e035.is_empty(), "expected an E035 diagnostic, got: {:?}", out.diagnostics);
}

#[test]
fn coverage_rejects_omitted_list_constructor() {
    let out = evaluate(
        "(A: (Type 0) A)\n\
         (inductive List\n\
         (constructor nil)\n\
         (constructor (cons (Pi (A x) (Pi (List xs) List)))))\n\
         (mode head +input -output)\n\
         (relation head (head (cons x xs) x))\n\
         (coverage head)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0].message.contains("nil"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn coverage_reports_each_input_slot_independently() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode add +input +input -output)\n\
         (relation add (add zero zero zero))\n\
         (coverage add)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 2);
}

#[test]
fn coverage_for_relation_without_mode_is_e035() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (relation f (f zero zero))\n\
         (coverage f)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0].message.contains("no `(mode f ...)` declaration"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn coverage_with_mode_but_no_clauses_is_e035() {
    let out = evaluate("(mode f +input -output)\n(coverage f)", None, None);
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0].message.contains("no `(relation f ...)` clauses"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn malformed_coverage_form_is_e035() {
    let out = evaluate("(coverage f extra)", None, None);
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0].message.contains("must be `(coverage <relation-name>)`"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn is_covered_api_returns_ok_when_covered() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode plus +input +input -output)\n\
         (relation plus\n\
         (plus zero n n)\n\
         (plus (succ m) n (succ (plus m n))))",
        None,
        &mut env,
    );
    let result = is_covered(&env, "plus");
    assert!(result.ok);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn is_covered_api_returns_diagnostics_when_missing() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (mode f +input -output)\n\
         (relation f (f zero zero))",
        None,
        &mut env,
    );
    let result = is_covered(&env, "f");
    assert!(!result.ok);
    assert_eq!(result.diagnostics.len(), 1);
    assert_eq!(result.diagnostics[0].code, "E035");
}

#[test]
fn is_covered_skips_when_no_inductive_inferable() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(mode opaque +input -output)\n\
         (relation opaque (opaque x x))",
        None,
        &mut env,
    );
    let result = is_covered(&env, "opaque");
    assert!(result.ok);
    assert!(result.diagnostics.is_empty());
}
