// Tests for coinductive families and productivity (issue #53, D11).
// Mirrors js/tests/coinductive.test.mjs so any drift between the two
// implementations fails both test suites. Covers the `(coinductive ...)`
// parser form, the generated `Name-corec` corecursor, and the
// productivity check that rejects non-productive declarations.

use rml::{
    build_corecursor_type, check, evaluate, evaluate_with_env, key_of,
    parse_coinductive_form, synth, tokenize_one, parse_one, Env, Node, RunResult,
};

fn parse(src: &str) -> Node {
    let toks = tokenize_one(src);
    parse_one(&toks).expect("parse")
}

// ---------- (coinductive ...) parser form ----------

#[test]
fn records_type_constructors_and_corecursor_on_env() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    let decl = env
        .coinductives
        .get("Stream")
        .expect("Stream should be recorded");
    assert_eq!(decl.name, "Stream");
    let names: Vec<&str> = decl.constructors.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["cons"]);
    assert_eq!(decl.corec_name, "Stream-corec");
    assert!(env.terms.contains("Stream"));
    assert!(env.terms.contains("cons"));
    assert!(env.terms.contains("Stream-corec"));
    assert_eq!(
        env.get_type("cons").map(String::as_str),
        Some("(Pi (Natural head) (Pi (Stream tail) Stream))"),
    );
}

#[test]
fn rejects_coinductive_with_no_constructors() {
    let out = evaluate("(coinductive Empty)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("at least one constructor"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_malformed_coinductive_constructor_clause() {
    let out = evaluate("(coinductive Bad (cons))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("(constructor <name>)"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_coinductive_constructor_declared_twice() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream))))\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("declared more than once"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_coinductive_constructor_with_wrong_return_type() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Boolean)))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("must return \"Stream\""),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_lowercase_coinductive_type_name() {
    let out = evaluate(
        "(coinductive stream (constructor (cons (Pi (stream tail) stream))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("uppercase letter"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

// ---------- productivity check (guarded corecursion) ----------

#[test]
fn rejects_non_productive_declaration() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Bad\n\
         (constructor leaf)\n\
         (constructor (mid (Pi (Natural n) Bad))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E035");
    assert!(
        out.diagnostics[0].message.contains("non-productive"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn accepts_recursive_constructor() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
}

#[test]
fn accepts_mixed_constant_and_recursive_constructors() {
    let out = evaluate(
        "(coinductive Conat\n\
         (constructor cozero)\n\
         (constructor (cosucc (Pi (Conat n) Conat))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
}

// ---------- generated corecursor type-checks ----------

#[test]
fn builds_stream_corec_with_standard_coiteration_principle() {
    let node = parse(
        "(coinductive Stream \
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
    );
    let decl = parse_coinductive_form(&node).expect("parses");
    let corec = build_corecursor_type("Stream", &decl.constructors);
    assert_eq!(
        key_of(&corec),
        "(Pi ((Type 0) _state_type) \
         (Pi ((Pi (_state_type _state) \
         (Pi (Natural head) (Pi (_state_type tail) Stream))) case_cons) \
         (Pi (_state_type _seed) Stream)))"
    );
}

#[test]
fn type_of_stream_corec_returns_corecursor_type() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))\n\
         (? (type of Stream-corec))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(out.results.len(), 1);
    if let RunResult::Type(s) = &out.results[0] {
        assert!(s.starts_with("(Pi ("), "got: {}", s);
        assert!(s.contains("_state_type"), "got: {}", s);
        assert!(s.contains("case_cons"), "got: {}", s);
    } else {
        panic!("expected Type result, got {:?}", out.results[0]);
    }
}

#[test]
fn membership_query_holds_for_corecursor() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        &mut env,
    );
    let corec_type_key = key_of(&env.coinductives.get("Stream").unwrap().corec_type);
    let src = format!("(? (Stream-corec of {}))", corec_type_key);
    let out = evaluate_with_env(&src, None, &mut env);
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(out.results.len(), 1);
    if let RunResult::Num(v) = out.results[0] {
        assert_eq!(v, 1.0);
    } else {
        panic!("expected Num result, got {:?}", out.results[0]);
    }
}

// ---------- Streams are definable ----------

#[test]
fn stream_is_definable() {
    let mut env = Env::new(None);
    evaluate_with_env("(Natural: (Type 0) Natural)", None, &mut env);
    let out = evaluate_with_env(
        "(coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(
        env.get_type("cons").map(String::as_str),
        Some("(Pi (Natural head) (Pi (Stream tail) Stream))"),
    );
    let decl = env.coinductives.get("Stream").unwrap();
    assert_eq!(decl.corec_name, "Stream-corec");
    let cons = &decl.constructors[0];
    assert_eq!(cons.name, "cons");
    assert_eq!(cons.params.len(), 2);
    let (tail_name, tail_type) = &cons.params[1];
    assert_eq!(tail_name, "tail");
    if let Node::Leaf(s) = tail_type {
        assert_eq!(s, "Stream");
    } else {
        panic!("expected Leaf for tail param type");
    }
}

// ---------- Conat (coinductive Naturals) is definable ----------

#[test]
fn conat_is_definable() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(coinductive Conat\n\
         (constructor cozero)\n\
         (constructor (cosucc (Pi (Conat n) Conat))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    let decl = env.coinductives.get("Conat").unwrap();
    assert_eq!(decl.constructors.len(), 2);
    assert_eq!(decl.constructors[0].name, "cozero");
    let cosucc = &decl.constructors[1];
    assert_eq!(cosucc.params.len(), 1);
    let (n_name, n_type) = &cosucc.params[0];
    assert_eq!(n_name, "n");
    if let Node::Leaf(s) = n_type {
        assert_eq!(s, "Conat");
    } else {
        panic!("expected Leaf for n param type");
    }
}

// ---------- corecursor participates in the bidirectional checker ----------

#[test]
fn synth_stream_corec_returns_generated_pi_type() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(Natural: (Type 0) Natural)\n\
         (coinductive Stream\n\
         (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))",
        None,
        &mut env,
    );
    let term = Node::Leaf("Stream-corec".to_string());
    let result = synth(&term, &mut env);
    assert_eq!(result.diagnostics.len(), 0, "diagnostics: {:?}", result.diagnostics);
    let typ = result.typ.expect("Stream-corec should synthesise a type");
    assert_eq!(
        key_of(&typ),
        key_of(&env.coinductives.get("Stream").unwrap().corec_type),
    );
}

#[test]
fn check_accepts_constant_constructor_against_recorded_type() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(coinductive Conat\n\
         (constructor cozero)\n\
         (constructor (cosucc (Pi (Conat n) Conat))))",
        None,
        &mut env,
    );
    let term = Node::Leaf("cozero".to_string());
    let typ = Node::Leaf("Conat".to_string());
    let result = check(&term, &typ, &mut env);
    assert_eq!(result.diagnostics.len(), 0, "diagnostics: {:?}", result.diagnostics);
    assert!(result.ok);
}
