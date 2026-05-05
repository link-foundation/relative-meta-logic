// Tests for totality checking (issue #44, D12).
// Mirrors js/tests/totality.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{evaluate, evaluate_with_env, is_total, Env, Node};

#[test]
fn relation_declaration_records_clauses_on_env() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(relation plus\n\
         (plus zero n n)\n\
         (plus (succ m) n (succ (plus m n))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0);
    let clauses = env
        .relations
        .get("plus")
        .expect("plus relation should be recorded");
    assert_eq!(clauses.len(), 2);
    // First clause: (plus zero n n).
    if let Node::List(items) = &clauses[0] {
        assert_eq!(items.len(), 4);
    } else {
        panic!("expected first clause to be a list");
    }
}

#[test]
fn relation_declaration_with_no_clauses_is_e032() {
    let out = evaluate("(relation plus)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E032");
    assert!(
        d.message.contains("at least one clause"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn relation_declaration_with_wrong_head_is_e032() {
    let out = evaluate("(relation plus (minus zero n n))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E032");
    assert!(
        d.message.contains("head is \"plus\""),
        "msg was: {}",
        d.message
    );
}

#[test]
fn total_accepts_plus() {
    let out = evaluate(
        "(mode plus +input +input -output)\n\
         (relation plus\n\
         (plus zero n n)\n\
         (plus (succ m) n (succ (plus m n))))\n\
         (total plus)",
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
fn total_accepts_le() {
    let out = evaluate(
        "(mode le +input +input -output)\n\
         (relation le\n\
         (le zero n true)\n\
         (le (succ m) zero false)\n\
         (le (succ m) (succ n) (le m n)))\n\
         (total le)",
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
fn total_accepts_append() {
    let out = evaluate(
        "(mode append +input +input -output)\n\
         (relation append\n\
         (append nil ys ys)\n\
         (append (cons x xs) ys (cons x (append xs ys))))\n\
         (total append)",
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
fn total_rejects_relation_without_decrease() {
    let out = evaluate(
        "(mode loop +input -output)\n\
         (relation loop\n\
         (loop zero zero)\n\
         (loop (succ n) (loop (succ n))))\n\
         (total loop)",
        None,
        None,
    );
    let e032: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E032")
        .collect();
    assert_eq!(e032.len(), 1);
    assert!(
        e032[0].message.contains("does not structurally decrease"),
        "msg was: {}",
        e032[0].message
    );
    assert!(
        e032[0].message.contains("(loop (succ n))"),
        "msg was: {}",
        e032[0].message
    );
}

#[test]
fn total_reports_specific_clause_on_failure() {
    let out = evaluate(
        "(mode bad +input -output)\n\
         (relation bad\n\
         (bad zero zero)\n\
         (bad (succ n) (bad n))\n\
         (bad (succ n) (bad (succ n))))\n\
         (total bad)",
        None,
        None,
    );
    let e032: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E032")
        .collect();
    assert_eq!(e032.len(), 1);
    assert!(
        e032[0].message.contains("clause 3"),
        "msg was: {}",
        e032[0].message
    );
}

#[test]
fn total_for_undeclared_relation_is_e032() {
    let out = evaluate("(total mystery)", None, None);
    let e032: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E032")
        .collect();
    assert_eq!(e032.len(), 1);
    assert!(
        e032[0].message.contains("no `(mode mystery ...)` declaration"),
        "msg was: {}",
        e032[0].message
    );
}

#[test]
fn total_with_modes_but_no_clauses_is_e032() {
    let out = evaluate(
        "(mode plus +input +input -output)\n(total plus)",
        None,
        None,
    );
    let e032: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E032")
        .collect();
    assert_eq!(e032.len(), 1);
    assert!(
        e032[0].message.contains("no `(relation plus ...)` clauses"),
        "msg was: {}",
        e032[0].message
    );
}

#[test]
fn malformed_total_form_is_e032() {
    let out = evaluate("(total plus extra)", None, None);
    let e032: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E032")
        .collect();
    assert_eq!(e032.len(), 1);
    assert!(
        e032[0].message.contains("must be `(total <relation-name>)`"),
        "msg was: {}",
        e032[0].message
    );
}

#[test]
fn is_total_api_returns_ok_on_total_relation() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(mode plus +input +input -output)\n\
         (relation plus\n\
         (plus zero n n)\n\
         (plus (succ m) n (succ (plus m n))))",
        None,
        &mut env,
    );
    let result = is_total(&env, "plus");
    assert!(result.ok);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn is_total_api_returns_diagnostics_on_failure() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(mode loop +input -output)\n\
         (relation loop\n\
         (loop zero zero)\n\
         (loop (succ n) (loop (succ n))))",
        None,
        &mut env,
    );
    let result = is_total(&env, "loop");
    assert!(!result.ok);
    assert_eq!(result.diagnostics.len(), 1);
    assert_eq!(result.diagnostics[0].code, "E032");
}
