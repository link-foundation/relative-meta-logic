// Tests for termination checking (issue #49, D13).
// Mirrors js/tests/termination.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{evaluate, evaluate_with_env, is_terminating, DefineMeasure, Env, Node};

#[test]
fn define_records_clauses_on_env() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(define plus\n\
         (case (zero n) n)\n\
         (case ((succ m) n) (succ (plus m n))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0);
    let decl = env
        .definitions
        .get("plus")
        .expect("plus definition should be recorded");
    assert_eq!(decl.name, "plus");
    assert!(decl.measure.is_none());
    assert_eq!(decl.clauses.len(), 2);
    // First clause: pattern (zero n), body n.
    assert_eq!(decl.clauses[0].pattern.len(), 2);
    if let Node::Leaf(s) = &decl.clauses[0].body {
        assert_eq!(s, "n");
    } else {
        panic!("expected first body to be a leaf");
    }
}

#[test]
fn define_records_lex_measure() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(define ackermann\n\
         (measure (lex 1 2))\n\
         (case (zero n) (succ n))\n\
         (case ((succ m) zero) (ackermann m (succ zero)))\n\
         (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))",
        None,
        &mut env,
    );
    assert!(
        out.diagnostics.is_empty(),
        "expected no diagnostics, got: {:?}",
        out.diagnostics
    );
    let decl = env
        .definitions
        .get("ackermann")
        .expect("ackermann definition should be recorded");
    match &decl.measure {
        Some(DefineMeasure::Lex(slots)) => assert_eq!(slots, &vec![0usize, 1usize]),
        _ => panic!("expected a Lex measure"),
    }
    assert_eq!(decl.clauses.len(), 3);
}

#[test]
fn define_with_no_clauses_is_e035() {
    let out = evaluate("(define plus)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E035");
    assert!(
        d.message.contains("at least one") && d.message.contains("case"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn define_malformed_case_is_e035() {
    // Note: the upstream `links-notation` Rust parser collapses
    // single-element parens (`(zero)` → `zero`), so the JS-mirror form
    // `(case zero n)` is indistinguishable from `(case (zero) n)` here and
    // is therefore accepted as a valid 1-arg pattern. We instead check a
    // case clause with the wrong arity.
    let out = evaluate("(define plus (case (a b) c d))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E035");
    assert!(
        d.message.contains("must have exactly two children"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn define_unknown_clause_is_e035() {
    let out = evaluate("(define plus (foo bar))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E035");
    assert!(
        d.message.contains("unexpected clause"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn define_malformed_measure_is_e035() {
    let out = evaluate(
        "(define ackermann (measure 1) (case ((succ m) n) (ackermann m n)))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E035");
    assert!(
        d.message.contains("must be `(lex"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn terminating_accepts_plus() {
    let out = evaluate(
        "(define plus\n\
         (case (zero n) n)\n\
         (case ((succ m) n) (succ (plus m n))))\n\
         (terminating plus)",
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
fn terminating_accepts_append() {
    let out = evaluate(
        "(define append\n\
         (case (nil ys) ys)\n\
         (case ((cons x xs) ys) (cons x (append xs ys))))\n\
         (terminating append)",
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
fn terminating_rejects_ackermann_without_measure() {
    let out = evaluate(
        "(define ackermann\n\
         (case (zero n) (succ n))\n\
         (case ((succ m) zero) (ackermann m (succ zero)))\n\
         (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))\n\
         (terminating ackermann)",
        None,
        None,
    );
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert!(
        !e035.is_empty(),
        "expected at least one E035, got: {:?}",
        out.diagnostics
    );
    assert!(
        e035[0]
            .message
            .contains("does not structurally decrease the first argument"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn terminating_accepts_ackermann_with_lex_measure() {
    let out = evaluate(
        "(define ackermann\n\
         (measure (lex 1 2))\n\
         (case (zero n) (succ n))\n\
         (case ((succ m) zero) (ackermann m (succ zero)))\n\
         (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))\n\
         (terminating ackermann)",
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
fn terminating_rejects_loop_on_same_input() {
    let out = evaluate(
        "(define loop\n\
         (case (zero) zero)\n\
         (case ((succ n)) (loop (succ n))))\n\
         (terminating loop)",
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
        e035[0].message.contains("does not structurally decrease"),
        "msg was: {}",
        e035[0].message
    );
    assert!(
        e035[0].message.contains("(loop (succ n))"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn terminating_reports_specific_clause_on_failure() {
    let out = evaluate(
        "(define bad\n\
         (case (zero) zero)\n\
         (case ((succ n)) (bad n))\n\
         (case ((succ n)) (bad (succ n))))\n\
         (terminating bad)",
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
        e035[0].message.contains("clause 3"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn terminating_undeclared_definition_is_e035() {
    let out = evaluate("(terminating mystery)", None, None);
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0]
            .message
            .contains("no `(define mystery ...)` declaration"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn malformed_terminating_form_is_e035() {
    let out = evaluate("(terminating plus extra)", None, None);
    let e035: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E035")
        .collect();
    assert_eq!(e035.len(), 1);
    assert!(
        e035[0]
            .message
            .contains("must be `(terminating <definition-name>)`"),
        "msg was: {}",
        e035[0].message
    );
}

#[test]
fn is_terminating_api_returns_ok_on_terminating_definition() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(define plus\n\
         (case (zero n) n)\n\
         (case ((succ m) n) (succ (plus m n))))",
        None,
        &mut env,
    );
    let result = is_terminating(&env, "plus");
    assert!(result.ok);
    assert!(result.diagnostics.is_empty());
}

#[test]
fn is_terminating_api_returns_diagnostics_on_failure() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(define ackermann\n\
         (case (zero n) (succ n))\n\
         (case ((succ m) zero) (ackermann m (succ zero)))\n\
         (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))",
        None,
        &mut env,
    );
    let result = is_terminating(&env, "ackermann");
    assert!(!result.ok);
    assert!(!result.diagnostics.is_empty());
    assert_eq!(result.diagnostics[0].code, "E035");
}

#[test]
fn is_terminating_api_returns_ok_for_ackermann_with_lex_measure() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(define ackermann\n\
         (measure (lex 1 2))\n\
         (case (zero n) (succ n))\n\
         (case ((succ m) zero) (ackermann m (succ zero)))\n\
         (case ((succ m) (succ n)) (ackermann m (ackermann (succ m) n))))",
        None,
        &mut env,
    );
    let result = is_terminating(&env, "ackermann");
    assert!(
        result.ok,
        "expected ok=true, got diagnostics: {:?}",
        result.diagnostics
    );
}
