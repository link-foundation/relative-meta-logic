// Tests for the typed-fragment normalization API (issue #50, D4).
//
// Mirrors js/tests/normalization.test.mjs so any drift between the two
// implementations fails both suites. Covers:
//   - the public `whnf` and `nf` functions,
//   - the surface-form drivers `(whnf ...)`, `(nf ...)`, `(normal-form ...)`,
//   - termination and equal results on Church numerals,
//   - proof witnesses for normalization steps.

use rml::{
    eval_node, evaluate, evaluate_with_options, is_structurally_same, key_of, nf, parse_one,
    tokenize_one, whnf, Env, EvaluateOptions, Node, RunResult,
};

fn opts_with_proofs() -> EvaluateOptions {
    EvaluateOptions {
        with_proofs: true,
        ..EvaluateOptions::default()
    }
}

fn evaluate_clean(src: &str) -> Vec<RunResult> {
    let out = evaluate(src, None, None);
    assert!(
        out.diagnostics.is_empty(),
        "unexpected diagnostics: {:?}",
        out.diagnostics
    );
    out.results
}

fn parse_term(src: &str) -> Node {
    parse_one(&tokenize_one(src)).expect("parse failed")
}

// ===== whnf reduces only the spine =====

#[test]
fn whnf_beta_reduces_outer_redex_but_leaves_arguments_unevaluated() {
    let mut env = Env::new(None);
    // (apply (lambda (Natural x) x) (apply (lambda (Natural y) y) zero))
    let term = parse_term("(apply (lambda (Natural x) x) (apply (lambda (Natural y) y) zero))");
    let reduced = whnf(&term, &mut env);
    let expected = parse_term("(apply (lambda (Natural y) y) zero)");
    assert!(
        is_structurally_same(&reduced, &expected),
        "got {}, expected {}",
        key_of(&reduced),
        key_of(&expected)
    );
}

#[test]
fn whnf_does_not_descend_under_a_lambda_binder() {
    let mut env = Env::new(None);
    // (lambda (Natural x) (apply (lambda (Natural y) y) x))
    let term = parse_term("(lambda (Natural x) (apply (lambda (Natural y) y) x))");
    let reduced = whnf(&term, &mut env);
    // Already a lambda value; whnf returns it unchanged.
    assert!(
        is_structurally_same(&reduced, &term),
        "got {}, expected {}",
        key_of(&reduced),
        key_of(&term)
    );
}

#[test]
fn whnf_reduces_a_named_lambda_head_and_stops_there() {
    let mut env = Env::new(None);
    // (identity: lambda (Natural x) x)
    eval_node(&parse_term("(identity: lambda (Natural x) x)"), &mut env);
    let term = parse_term("(apply identity (apply identity zero))");
    let reduced = whnf(&term, &mut env);
    let expected = parse_term("(apply identity zero)");
    assert!(
        is_structurally_same(&reduced, &expected),
        "got {}, expected {}",
        key_of(&reduced),
        key_of(&expected)
    );
}

// ===== nf reduces every redex =====

#[test]
fn nf_fully_normalizes_a_nested_application() {
    let mut env = Env::new(None);
    let term = parse_term("(apply (lambda (Natural x) x) (apply (lambda (Natural y) y) zero))");
    let reduced = nf(&term, &mut env);
    assert_eq!(key_of(&reduced), "zero");
}

#[test]
fn nf_reduces_redexes_under_a_lambda_binder() {
    let mut env = Env::new(None);
    let term = parse_term("(lambda (Natural x) (apply (lambda (Natural y) y) x))");
    let reduced = nf(&term, &mut env);
    let expected = parse_term("(lambda (Natural x) x)");
    assert!(
        is_structurally_same(&reduced, &expected),
        "got {}, expected {}",
        key_of(&reduced),
        key_of(&expected)
    );
}

// ===== `(whnf ...)` surface form =====

#[test]
fn whnf_surface_form_returns_weak_head_reduct_as_term_result() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(identity: lambda (Natural x) x)
(? (whnf (apply identity (apply identity zero))))
"#,
    );
    // Outer `identity` reduces, inner application is left alone.
    assert_eq!(
        results,
        vec![RunResult::Type("(apply identity zero)".to_string())]
    );
}

#[test]
fn whnf_surface_form_rejects_malformed_drivers_with_e038() {
    let out = evaluate("(whnf)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E038");
}

// ===== `(nf ...)` and `(normal-form ...)` surface forms =====

#[test]
fn nf_and_normal_form_reduce_to_the_same_beta_normal_form() {
    let results = evaluate_clean(
        r#"
(Natural: (Type 0) Natural)
(zero: Natural zero)
(identity: lambda (Natural x) x)
(? (nf (apply identity (apply identity zero))))
(? (normal-form (apply identity (apply identity zero))))
"#,
    );
    assert_eq!(
        results,
        vec![
            RunResult::Type("zero".to_string()),
            RunResult::Type("zero".to_string()),
        ]
    );
}

#[test]
fn nf_surface_form_rejects_malformed_drivers_with_e038() {
    let out = evaluate("(nf)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E038");
}

#[test]
fn normal_form_surface_form_rejects_malformed_drivers_with_e038() {
    let out = evaluate("(normal-form)", None, None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E038");
}

// ===== Church numerals normalize as expected =====

const CHURCH_PREAMBLE: &str = r#"
(Term: (Type 0) Term)
(zero: Term zero)
(succ: (Pi (Term n) Term))
(compose: lambda (Term f) (lambda (Term g) (lambda (Term x) (apply f (apply g x)))))
"#;

#[test]
fn normal_form_of_compose_succ_succ_zero_is_succ_succ_zero() {
    let src = format!(
        "{}\n(? (normal-form (apply (apply (apply compose succ) succ) zero)))",
        CHURCH_PREAMBLE
    );
    let results = evaluate_clean(&src);
    // Pretty-printer drops the explicit `apply` keyword for neutral
    // applications (head is a free constructor symbol), matching the surface
    // shape `(succ (succ zero))` from the issue's acceptance criterion.
    assert_eq!(
        results,
        vec![RunResult::Type("(succ (succ zero))".to_string())]
    );
}

#[test]
fn whnf_reduces_only_the_head_leaving_inner_succ_call_alone() {
    let mut env = Env::new(None);
    eval_node(&parse_term("(Term: (Type 0) Term)"), &mut env);
    eval_node(&parse_term("(zero: Term zero)"), &mut env);
    eval_node(&parse_term("(succ: (Pi (Term n) Term))"), &mut env);
    eval_node(
        &parse_term(
            "(compose: lambda (Term f) (lambda (Term g) (lambda (Term x) (apply f (apply g x)))))",
        ),
        &mut env,
    );
    let term = parse_term("(apply (apply (apply compose succ) succ) zero)");
    let head = whnf(&term, &mut env);
    // Whnf unfolds `compose` and applies it to its arguments, exposing the
    // outer `succ` application of the result. The inner `(apply succ zero)`
    // remains a redex because whnf does not descend into argument positions.
    let expected = parse_term("(apply succ (apply succ zero))");
    assert!(
        is_structurally_same(&head, &expected),
        "got {}, expected {}",
        key_of(&head),
        key_of(&expected)
    );
}

#[test]
fn nf_fully_normalizes_nested_compositions() {
    let src = format!(
        "{}\n(? (nf (apply (apply (apply compose succ) succ) (apply succ zero))))",
        CHURCH_PREAMBLE
    );
    let results = evaluate_clean(&src);
    assert_eq!(
        results,
        vec![RunResult::Type("(succ (succ (succ zero)))".to_string())]
    );
}

// ===== proof witnesses for whnf and nf =====

#[test]
fn attaches_whnf_reduction_witness_when_proofs_are_requested() {
    let out = evaluate(
        "(? (whnf (apply (lambda (Natural x) x) zero)) with proof)",
        None,
        None,
    );
    assert!(out.diagnostics.is_empty(), "diagnostics: {:?}", out.diagnostics);
    let proof = out.proofs[0].as_ref().expect("proof missing");
    // Proof witnesses are tagged (by <rule> ...sub-witnesses).
    if let Node::List(children) = proof {
        assert!(matches!(&children[0], Node::Leaf(s) if s == "by"));
        assert!(matches!(&children[1], Node::Leaf(s) if s == "whnf-reduction"));
    } else {
        panic!("proof was not a list");
    }
}

#[test]
fn attaches_nf_reduction_witness_for_both_nf_and_normal_form() {
    let src = "(? (nf (apply (lambda (Natural x) x) zero)) with proof)\n\
               (? (normal-form (apply (lambda (Natural x) x) zero)) with proof)";
    let out = evaluate(src, None, None);
    assert!(out.diagnostics.is_empty(), "diagnostics: {:?}", out.diagnostics);
    let p0 = out.proofs[0].as_ref().expect("proof missing");
    let p1 = out.proofs[1].as_ref().expect("proof missing");
    for proof in [p0, p1] {
        if let Node::List(children) = proof {
            assert!(matches!(&children[0], Node::Leaf(s) if s == "by"));
            assert!(matches!(&children[1], Node::Leaf(s) if s == "nf-reduction"));
        } else {
            panic!("proof was not a list");
        }
    }
}

// ===== isConvertible already uses full normalization =====

#[test]
fn nf_agrees_with_isconvertible_on_beta_equal_terms() {
    let mut env = Env::new(None);
    eval_node(&parse_term("(Term: (Type 0) Term)"), &mut env);
    eval_node(&parse_term("(zero: Term zero)"), &mut env);
    // `succ` as a Pi-typed constructor — defining it as `lambda n. succ n`
    // would loop because `succ` would unfold itself.
    eval_node(&parse_term("(succ: (Pi (Term n) Term))"), &mut env);
    eval_node(&parse_term("(identity: lambda (Term x) x)"), &mut env);
    // The `apply identity` redex inside should reduce away under nf, leaving
    // two stacked `succ` constructors (printed without the explicit `apply`).
    let lhs = parse_term("(apply succ (apply identity (apply succ zero)))");
    let expected = parse_term("(succ (succ zero))");
    let rhs = nf(&lhs, &mut env);
    assert!(
        is_structurally_same(&rhs, &expected) || key_of(&rhs) == key_of(&expected),
        "got {}, expected {}",
        key_of(&rhs),
        key_of(&expected)
    );
}

// ===== exercising EvaluateOptions::with_proofs flag for whnf =====

#[test]
fn whnf_proof_witness_under_global_with_proofs_flag() {
    let src = "(? (whnf (apply (lambda (Natural x) x) zero)))";
    let out = evaluate_with_options(src, None, opts_with_proofs());
    assert!(out.diagnostics.is_empty(), "diagnostics: {:?}", out.diagnostics);
    let proof = out.proofs[0].as_ref().expect("proof missing");
    if let Node::List(children) = proof {
        assert!(matches!(&children[1], Node::Leaf(s) if s == "whnf-reduction"));
    } else {
        panic!("proof was not a list");
    }
}
