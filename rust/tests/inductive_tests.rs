// Tests for inductive families with eliminators (issue #45, D10).
// Mirrors js/tests/inductive.test.mjs so any drift between the two
// implementations fails both test suites. Covers the `(inductive ...)`
// parser form, the generated `Name-rec` eliminator, and the
// acceptance-criteria datatypes (Natural, List, Vector, propositional
// equality).

use rml::{
    build_eliminator_type, check, evaluate, evaluate_with_env, key_of,
    parse_inductive_form, synth, tokenize_one, parse_one, Env, Node, RunResult,
};

fn parse(src: &str) -> Node {
    let toks = tokenize_one(src);
    parse_one(&toks).expect("parse")
}

// ---------- (inductive ...) parser form ----------

#[test]
fn records_type_constructors_and_eliminator_on_env() {
    let mut env = Env::new(None);
    let out = evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    let decl = env
        .inductives
        .get("Natural")
        .expect("Natural should be recorded");
    assert_eq!(decl.name, "Natural");
    let names: Vec<&str> = decl.constructors.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["zero", "succ"]);
    assert_eq!(decl.elim_name, "Natural-rec");
    assert!(env.terms.contains("Natural"));
    assert!(env.terms.contains("zero"));
    assert!(env.terms.contains("succ"));
    assert!(env.terms.contains("Natural-rec"));
    assert_eq!(env.get_type("zero").map(String::as_str), Some("Natural"));
    assert_eq!(
        env.get_type("succ").map(String::as_str),
        Some("(Pi (Natural n) Natural)"),
    );
}

#[test]
fn rejects_inductive_with_no_constructors() {
    let out = evaluate("(inductive Empty)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E033");
    assert!(
        out.diagnostics[0].message.contains("at least one constructor"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_malformed_constructor_clause() {
    let out = evaluate("(inductive Bad (zero))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E033");
    assert!(
        out.diagnostics[0].message.contains("(constructor <name>)"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_constructor_declared_twice() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor zero))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E033");
    assert!(
        out.diagnostics[0].message.contains("declared more than once"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_constructor_with_wrong_return_type() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor (succ (Pi (Natural n) Boolean))))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E033");
    assert!(
        out.diagnostics[0].message.contains("must return \"Natural\""),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

#[test]
fn rejects_lowercase_type_name() {
    let out = evaluate("(inductive natural (constructor zero))", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E033");
    assert!(
        out.diagnostics[0].message.contains("uppercase letter"),
        "msg was: {}",
        out.diagnostics[0].message
    );
}

// ---------- generated eliminator type-checks ----------

#[test]
fn builds_natural_rec_with_standard_induction_principle() {
    let node = parse(
        "(inductive Natural \
         (constructor zero) \
         (constructor (succ (Pi (Natural n) Natural))))",
    );
    let decl = parse_inductive_form(&node).expect("parses");
    let elim = build_eliminator_type("Natural", &decl.constructors);
    assert_eq!(
        key_of(&elim),
        "(Pi ((Pi (Natural _) (Type 0)) _motive) \
         (Pi ((apply _motive zero) case_zero) \
         (Pi ((Pi (Natural n) (Pi ((apply _motive n) ih_n) (apply _motive (succ n)))) case_succ) \
         (Pi (Natural _target) (apply _motive _target)))))"
    );
}

#[test]
fn type_of_natural_rec_returns_eliminator_type() {
    let out = evaluate(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))\n\
         (? (type of Natural-rec))",
        None,
        None,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(out.results.len(), 1);
    if let RunResult::Type(s) = &out.results[0] {
        assert!(s.starts_with("(Pi ("), "got: {}", s);
        assert!(s.contains("_motive"), "got: {}", s);
        assert!(s.contains("case_zero"), "got: {}", s);
        assert!(s.contains("case_succ"), "got: {}", s);
    } else {
        panic!("expected Type result, got {:?}", out.results[0]);
    }
}

#[test]
fn membership_query_holds_for_eliminator() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))",
        None,
        &mut env,
    );
    let elim_type_key = key_of(&env.inductives.get("Natural").unwrap().elim_type);
    let src = format!("(? (Natural-rec of {}))", elim_type_key);
    let out = evaluate_with_env(&src, None, &mut env);
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(out.results.len(), 1);
    if let RunResult::Num(v) = out.results[0] {
        assert_eq!(v, 1.0);
    } else {
        panic!("expected Num result, got {:?}", out.results[0]);
    }
}

// ---------- Lists are definable ----------

#[test]
fn list_is_definable() {
    let mut env = Env::new(None);
    evaluate_with_env("(A: (Type 0) A)", None, &mut env);
    let out = evaluate_with_env(
        "(inductive List\n\
         (constructor nil)\n\
         (constructor (cons (Pi (A x) (Pi (List xs) List)))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(env.get_type("nil").map(String::as_str), Some("List"));
    assert_eq!(
        env.get_type("cons").map(String::as_str),
        Some("(Pi (A x) (Pi (List xs) List))"),
    );
    let decl = env.inductives.get("List").unwrap();
    assert_eq!(decl.elim_name, "List-rec");
    let cons_case = &decl.constructors[1];
    assert_eq!(cons_case.name, "cons");
    assert_eq!(cons_case.params.len(), 2);
    let (xs_name, xs_type) = &cons_case.params[1];
    assert_eq!(xs_name, "xs");
    if let Node::Leaf(s) = xs_type {
        assert_eq!(s, "List");
    } else {
        panic!("expected Leaf for xs param type");
    }
}

// ---------- Vectors (length-indexed lists) are definable ----------

#[test]
fn vector_is_definable() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(A: (Type 0) A)\n\
         (Natural: (Type 0) Natural)\n\
         (zero: Natural zero)\n\
         (succ: (Pi (Natural n) Natural))",
        None,
        &mut env,
    );
    let out = evaluate_with_env(
        "(inductive Vector\n\
         (constructor vnil)\n\
         (constructor (vcons (Pi (Natural n) (Pi (A x) (Pi (Vector xs) Vector))))))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    let decl = env.inductives.get("Vector").unwrap();
    assert_eq!(decl.constructors.len(), 2);
    let vcons = &decl.constructors[1];
    let signature: Vec<(String, String)> = vcons
        .params
        .iter()
        .map(|(name, t)| {
            let key = if let Node::Leaf(s) = t {
                s.clone()
            } else {
                key_of(t)
            };
            (name.clone(), key)
        })
        .collect();
    assert_eq!(
        signature,
        vec![
            ("n".to_string(), "Natural".to_string()),
            ("x".to_string(), "A".to_string()),
            ("xs".to_string(), "Vector".to_string()),
        ]
    );
}

// ---------- propositional equality ----------

#[test]
fn equality_is_definable() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(A: (Type 0) A)\n\
         (a: A a)",
        None,
        &mut env,
    );
    let out = evaluate_with_env(
        "(inductive Eq\n\
         (constructor refl))",
        None,
        &mut env,
    );
    assert_eq!(out.diagnostics.len(), 0, "diagnostics: {:?}", out.diagnostics);
    assert_eq!(env.get_type("refl").map(String::as_str), Some("Eq"));
    assert_eq!(env.inductives.get("Eq").unwrap().elim_name, "Eq-rec");
}

// ---------- bidirectional checker integration ----------

#[test]
fn synth_natural_rec_returns_generated_pi_type() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))",
        None,
        &mut env,
    );
    let result = synth(&Node::Leaf("Natural-rec".to_string()), &mut env);
    assert_eq!(result.diagnostics.len(), 0, "diagnostics: {:?}", result.diagnostics);
    let typ = result.typ.expect("type should be synthesised");
    let expected = key_of(&env.inductives.get("Natural").unwrap().elim_type);
    assert_eq!(key_of(&typ), expected);
}

#[test]
fn check_accepts_constructor_against_recorded_type() {
    let mut env = Env::new(None);
    evaluate_with_env(
        "(inductive Natural\n\
         (constructor zero)\n\
         (constructor (succ (Pi (Natural n) Natural))))",
        None,
        &mut env,
    );
    let term = Node::Leaf("zero".to_string());
    let expected = Node::Leaf("Natural".to_string());
    let result = check(&term, &expected, &mut env);
    assert_eq!(result.diagnostics.len(), 0, "diagnostics: {:?}", result.diagnostics);
    assert!(result.ok);
}
