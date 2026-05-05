// Tests for world declarations (issue #54, D16).
// Mirrors js/tests/worlds.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{evaluate, evaluate_with_env, Env};

#[test]
fn world_declaration_records_allowed_constants() {
    let mut env = Env::new(None);
    let out = evaluate_with_env("(world plus (Natural))", None, &mut env);
    assert_eq!(out.diagnostics.len(), 0);
    let allowed = env
        .worlds
        .get("plus")
        .expect("plus world should be recorded");
    assert_eq!(allowed, &vec!["Natural".to_string()]);
}

#[test]
fn world_declaration_records_multiple_constants() {
    let mut env = Env::new(None);
    let out = evaluate_with_env("(world rel (Natural Boolean))", None, &mut env);
    assert_eq!(out.diagnostics.len(), 0);
    assert_eq!(
        env.worlds.get("rel"),
        Some(&vec!["Natural".to_string(), "Boolean".to_string()])
    );
}

#[test]
fn world_declaration_with_non_symbolic_name_is_e033() {
    let out = evaluate("(world (foo bar) (Natural))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E033");
    assert!(
        d.message.contains("must be a bare symbol"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn world_declaration_without_constant_list_is_e033() {
    let out = evaluate("(world plus)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E033");
    assert!(
        d.message.contains("must have shape"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn world_declaration_with_non_symbolic_constant_is_e033() {
    let out = evaluate("(world plus ((foo bar)))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E033");
    assert!(
        d.message.contains("must be a bare symbol"),
        "msg was: {}",
        d.message
    );
}

#[test]
fn call_with_undeclared_constant_is_e033() {
    let out = evaluate(
        "(world plus (Natural))\n(? (plus 1 Boolean))",
        None,
        None,
    );
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 1);
    assert!(
        e033[0].message.contains("Boolean"),
        "msg was: {}",
        e033[0].message
    );
}

#[test]
fn call_with_only_declared_constants_passes() {
    let out = evaluate(
        "(world plus (Natural))\n(? (plus Natural Natural))",
        None,
        None,
    );
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 0);
}

#[test]
fn call_with_only_numeric_args_passes() {
    let out = evaluate("(world plus (Natural))\n(? (plus 1 2))", None, None);
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 0);
}

#[test]
fn call_without_world_declaration_is_unconstrained() {
    let out = evaluate("(? (plus Foo Bar))", None, None);
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 0);
}

#[test]
fn each_violating_call_is_reported_separately() {
    let out = evaluate(
        "(world plus (Natural))\n(? (plus Boolean 1))\n(? (plus 1 String))",
        None,
        None,
    );
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 2);
}

#[test]
fn nested_term_violations_are_flagged() {
    let out = evaluate(
        "(world plus (Natural))\n(? (plus (succ Boolean) Natural))",
        None,
        None,
    );
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 1);
    assert!(
        e033[0].message.contains("Boolean"),
        "msg was: {}",
        e033[0].message
    );
}

#[test]
fn relation_clauses_are_not_world_checked() {
    // Clause-level enforcement is intentionally out of scope for D16:
    // pattern variables vs. constants cannot be distinguished without
    // a naming convention. Only call sites are checked.
    let out = evaluate(
        "(world plus (Natural))\n\
         (relation plus\n\
         (plus zero n n)\n\
         (plus (succ m) n (succ (plus m n))))",
        None,
        None,
    );
    let e033: Vec<_> = out
        .diagnostics
        .iter()
        .filter(|d| d.code == "E033")
        .collect();
    assert_eq!(e033.len(), 0);
}

#[test]
fn worlds_coexist_with_mode_and_total_declarations() {
    let out = evaluate(
        "(world plus (Natural))\n\
         (mode plus +input +input -output)\n\
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
