// Tests for the link-based tactic engine (issue #55).
// Mirrors js/tests/tactics.test.mjs so drift between runtimes fails CI.

use rml::{
    key_of, parse_one, parse_tactic_links, run_tactics, tokenize_one, Node, ProofGoal, ProofState,
};

fn link(src: &str) -> Node {
    parse_one(&tokenize_one(src)).expect("parse failed")
}

fn state(goals: &[&str]) -> ProofState {
    ProofState {
        goals: goals
            .iter()
            .map(|goal| ProofGoal {
                goal: link(goal),
                context: Vec::new(),
            })
            .collect(),
        proof: Vec::new(),
    }
}

fn goal_keys(proof_state: &ProofState) -> Vec<String> {
    proof_state
        .goals
        .iter()
        .map(|goal| key_of(&goal.goal))
        .collect()
}

#[test]
fn closes_equality_goal_with_by_reflexivity() {
    let out = run_tactics(state(&["(a = a)"]), &[link("(by reflexivity)")]);

    assert!(out.diagnostics.is_empty());
    assert!(out.state.goals.is_empty());
    assert_eq!(
        out.state.proof.iter().map(key_of).collect::<Vec<_>>(),
        vec!["(by reflexivity)"]
    );
}

#[test]
fn parses_tactic_text_into_links() {
    let tactics = parse_tactic_links("(reflexivity)");
    let out = run_tactics(state(&["(a = a)"]), &tactics);

    assert!(out.diagnostics.is_empty());
    assert!(out.state.goals.is_empty());
    assert_eq!(
        out.state.proof.iter().map(key_of).collect::<Vec<_>>(),
        vec!["(reflexivity)"]
    );
}

#[test]
fn transforms_goals_with_symmetry_and_transitivity() {
    let out = run_tactics(
        state(&["(a = c)"]),
        &[link("(symmetry)"), link("(transitivity b)")],
    );

    assert!(out.diagnostics.is_empty());
    assert_eq!(goal_keys(&out.state), vec!["(c = b)", "(b = a)"]);
    assert_eq!(
        out.state.proof.iter().map(key_of).collect::<Vec<_>>(),
        vec!["(symmetry)", "(transitivity b)"]
    );
}

#[test]
fn introduces_pi_binders_into_current_context() {
    let introduced = run_tactics(
        state(&["(Pi (Natural n) (n = n))"]),
        &[link("(introduce k)")],
    );

    assert!(introduced.diagnostics.is_empty());
    assert_eq!(goal_keys(&introduced.state), vec!["(k = k)"]);
    assert_eq!(
        introduced.state.goals[0]
            .context
            .iter()
            .map(key_of)
            .collect::<Vec<_>>(),
        vec!["(k of Natural)"]
    );

    let closed = run_tactics(introduced.state, &[link("(by reflexivity)")]);
    assert!(closed.diagnostics.is_empty());
    assert!(closed.state.goals.is_empty());
}

#[test]
fn adds_assumptions_with_suppose_and_closes_them_with_exact() {
    let supposed = run_tactics(state(&["(p = q)"]), &[link("(suppose (p = q))")]);

    assert!(supposed.diagnostics.is_empty());
    assert_eq!(goal_keys(&supposed.state), vec!["(p = q)"]);
    assert_eq!(
        supposed.state.goals[0]
            .context
            .iter()
            .map(key_of)
            .collect::<Vec<_>>(),
        vec!["(p = q)"]
    );

    let closed = run_tactics(supposed.state, &[link("(exact (p = q))")]);
    assert!(closed.diagnostics.is_empty());
    assert!(closed.state.goals.is_empty());
}

#[test]
fn rewrites_current_goal_with_equality_link() {
    let out = run_tactics(
        state(&["((f a) = (f a))"]),
        &[link("(rewrite (a = b) in goal)"), link("(by reflexivity)")],
    );

    assert!(out.diagnostics.is_empty());
    assert!(out.state.goals.is_empty());
    assert_eq!(
        out.state.proof.iter().map(key_of).collect::<Vec<_>>(),
        vec!["(rewrite (a = b) in goal)", "(by reflexivity)"]
    );
}

#[test]
fn runs_per_case_tactic_links_during_induction() {
    let out = run_tactics(
        state(&["(n = n)"]),
        &[link(
            "(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))",
        )],
    );

    assert!(out.diagnostics.is_empty());
    assert!(out.state.goals.is_empty());
    assert_eq!(
        key_of(&out.state.proof[0]),
        "(induction n (case zero (by reflexivity)) (case (succ m) (by reflexivity)))"
    );
}

#[test]
fn failed_tactic_reports_current_goal() {
    let out = run_tactics(state(&["(a = b)"]), &[link("(by reflexivity)")]);

    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E039");
    assert!(out.diagnostics[0].message.contains("current goal: (a = b)"));
    assert_eq!(goal_keys(&out.state), vec!["(a = b)"]);
}
