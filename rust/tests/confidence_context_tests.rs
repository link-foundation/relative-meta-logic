use rml::foundation_workspace::{
    FoundationBounds, FoundationChange, FoundationResult, FoundationWorkspace,
};
use rml::linked_program::ExecutionBasis;
use rml::{parse_one, tokenize_one, Node};

fn source() -> String {
    [
        include_str!("../../lib/foundations/packages.lino"),
        include_str!("../../lib/foundations/confidence.lino"),
        include_str!("../../test-corpus/foundations/confidence-context.lino"),
    ]
    .join("\n")
}
fn workspace() -> FoundationWorkspace {
    FoundationWorkspace::from_rml_with_basis(&source(), ExecutionBasis::DirectStructural, &[])
        .unwrap()
}
fn node(source: &str) -> Node {
    if !source.starts_with('(') {
        return Node::Leaf(source.to_string());
    }
    parse_one(&tokenize_one(source)).unwrap()
}
fn unary(n: usize) -> String {
    if n == 0 {
        "z".to_string()
    } else {
        format!("(s {})", unary(n - 1))
    }
}
fn ratio(a: usize, b: usize) -> Node {
    node(&format!("(ratio {} {})", unary(a), unary(b)))
}
fn observations() -> Vec<Node> {
    vec![
        node("(observation meter-a left (ratio one two) (ratio three four))"),
        node("(observation meter-b right (ratio one two) (ratio one two))"),
    ]
}
fn event_independence() -> Node {
    node("(independent-events left right)")
}
fn confidence_independence() -> Node {
    node("(independent-confidence left right)")
}
fn assumptions() -> Vec<Node> {
    let mut facts = observations();
    facts.push(event_independence());
    facts.push(confidence_independence());
    facts
}
fn query(statement: &str) -> Node {
    node(&format!(
        "(estimate {statement} (probability ?p) (confidence ?c) (depends ?sources))"
    ))
}
fn ask(
    workspace: &FoundationWorkspace,
    instance: &str,
    statement: &str,
    facts: &[Node],
) -> FoundationResult {
    workspace
        .ask(
            instance,
            &query(statement),
            facts,
            FoundationBounds::default(),
        )
        .unwrap()
}
fn value<'a>(result: &'a FoundationResult, variable: &str) -> &'a Node {
    assert_eq!(result.status, "proved");
    let answers = result.answers.as_ref().unwrap();
    assert_eq!(answers.len(), 1);
    &answers[0]
        .bindings
        .iter()
        .find(|(name, _)| name == variable)
        .unwrap()
        .1
}
const MINIMUM: &str = "minimum-confidence-study";
const INDEPENDENT: &str = "independent-confidence-study";

#[test]
fn carries_separate_probability_confidence_and_linked_source_dependencies_under_selected_policies()
{
    let workspace = workspace();
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("../../test-corpus/foundations/expected.json")).unwrap();
    let expected_ratio = |field: &str| {
        let parts = expected["confidenceCombination"][field].as_array().unwrap();
        ratio(
            parts[0].as_u64().unwrap() as usize,
            parts[1].as_u64().unwrap() as usize,
        )
    };
    let min = ask(&workspace, MINIMUM, "combined", &assumptions());
    let product = ask(&workspace, INDEPENDENT, "combined", &assumptions());
    assert_eq!(value(&min, "?p"), &expected_ratio("probability"));
    assert_eq!(value(&product, "?p"), &expected_ratio("probability"));
    assert_eq!(value(&min, "?c"), &expected_ratio("minimumConfidence"));
    assert_eq!(
        value(&product, "?c"),
        &expected_ratio("independentConfidence")
    );
    assert_eq!(
        value(&product, "?sources"),
        &node("(joint (source meter-a) (source meter-b))")
    );
    let description = workspace
        .describe("confidence-estimation", Some("2"))
        .unwrap();
    assert!(description
        .rules
        .iter()
        .any(|rule| rule.program == "independent-confidence" && rule.rule == "combine-confidence"));
    let reduction = workspace
        .execute(
            INDEPENDENT,
            &node("(confidence-combine (ratio three four) (ratio one two))"),
            10_000,
        )
        .unwrap();
    assert_eq!(reduction.output, Some(ratio(3, 8)));
    assert!(reduction
        .trace
        .unwrap()
        .iter()
        .any(|step| step.program == "independent-confidence"));
}

#[test]
fn requires_explicit_event_and_separate_confidence_independence_for_multiplication() {
    let workspace = workspace();
    assert_eq!(
        ask(&workspace, MINIMUM, "combined", &observations()).status,
        "unknown"
    );
    assert_eq!(
        ask(&workspace, INDEPENDENT, "combined", &observations()).status,
        "unknown"
    );
    let mut event_only = observations();
    event_only.push(event_independence());
    assert_eq!(
        ask(&workspace, MINIMUM, "combined", &event_only).status,
        "proved"
    );
    assert_eq!(
        ask(&workspace, INDEPENDENT, "combined", &event_only).status,
        "unknown"
    );
    let mut confidence_only = observations();
    confidence_only.push(confidence_independence());
    assert_eq!(
        ask(&workspace, INDEPENDENT, "combined", &confidence_only).status,
        "unknown"
    );
    assert_eq!(
        ask(&workspace, INDEPENDENT, "combined", &assumptions()).status,
        "proved"
    );
    assert_eq!(
        ask(&workspace, INDEPENDENT, "combined", &observations()).status,
        "unknown"
    );
}

#[test]
fn does_not_turn_probability_one_or_confidence_zero_into_object_level_truth_or_falsity() {
    let workspace = workspace();
    let certain = node("(observation single assertion (ratio one one) (ratio zero one))");
    let estimate = ask(&workspace, INDEPENDENT, "assertion", &[certain.clone()]);
    assert_eq!(value(&estimate, "?p"), &ratio(1, 1));
    assert_eq!(value(&estimate, "?c"), &ratio(0, 1));
    let truth = workspace
        .ask(
            INDEPENDENT,
            &node("(holds assertion)"),
            &[certain],
            FoundationBounds::default(),
        )
        .unwrap();
    assert_eq!(truth.status, "unknown");
    assert_eq!(truth.refutation.unwrap().status, "undefined");
    let zero = node("(observation single assertion (ratio zero one) (ratio one one))");
    assert_eq!(
        ask(&workspace, INDEPENDENT, "assertion", &[zero.clone()]).status,
        "proved"
    );
    assert_eq!(
        workspace
            .ask(
                INDEPENDENT,
                &node("(holds assertion)"),
                &[zero],
                FoundationBounds::default()
            )
            .unwrap()
            .status,
        "unknown"
    );
}

#[test]
fn rejects_out_of_range_and_zero_denominator_estimates_without_inventing_probability_or_proof() {
    let workspace = workspace();
    for (p, c) in [
        ("(ratio two one)", "(ratio one one)"),
        ("(ratio one zero)", "(ratio one one)"),
        ("(ratio one one)", "(ratio three two)"),
        ("(ratio one one)", "(ratio zero zero)"),
    ] {
        let facts = vec![node(&format!("(observation invalid assertion {p} {c})"))];
        assert_eq!(
            ask(&workspace, INDEPENDENT, "assertion", &facts).status,
            "unknown"
        );
        let checked = workspace
            .ask(
                INDEPENDENT,
                &node("(checked-observation invalid assertion ?p ?c ?validP ?validC)"),
                &facts,
                FoundationBounds::default(),
            )
            .unwrap();
        assert!(
            value(&checked, "?validP") == &node("no") || value(&checked, "?validC") == &node("no")
        );
    }
    let mut cyclic = assumptions();
    cyclic.push(node("(independent-events circular left)"));
    cyclic.push(node("(independent-confidence circular left)"));
    assert_eq!(
        ask(&workspace, INDEPENDENT, "circular", &cyclic).status,
        "unknown"
    );
}

#[test]
fn rechecks_changed_observation_confidence_and_dependencies_preserving_unrelated_statements() {
    let workspace = workspace();
    let combined = ask(&workspace, INDEPENDENT, "combined", &assumptions());
    let right = ask(&workspace, INDEPENDENT, "right", &assumptions());
    let untouched = workspace
        .ask(
            INDEPENDENT,
            &right.answers.unwrap()[0].judgement,
            &assumptions(),
            FoundationBounds::default(),
        )
        .unwrap();
    let revised_observation = node("(observation meter-a left (ratio one two) (ratio one four))");
    let change = FoundationChange::ReplaceAssumption {
        from: observations()[0].clone(),
        to: revised_observation,
    };
    let revision = workspace
        .revise(&[combined.clone(), untouched.clone()], &change)
        .unwrap();
    assert!(revision.revisions[0].changed);
    assert_eq!(value(&revision.revisions[0].after, "?p"), &ratio(1, 4));
    assert_eq!(value(&revision.revisions[0].after, "?c"), &ratio(1, 8));
    assert_eq!(revision.revisions[1].action, "kept");
    assert!(!revision.revisions[1].changed);
    assert_eq!(revision.revisions[1].after.proof, untouched.proof);
    assert_eq!(
        untouched.dependencies.assumptions,
        vec![observations()[1].clone()]
    );
    let dependency = FoundationChange::ReplaceRule(node("(linked-fact instrument-study both-measurements (judgement (joint combined left unobserved)))"));
    let revision = workspace.revise(&[combined.clone()], &dependency).unwrap();
    assert!(revision.revisions[0].changed);
    assert_eq!(revision.revisions[0].after.status, "unknown");
    let independence = FoundationChange::ReplaceAssumption {
        from: confidence_independence(),
        to: node("(independent-confidence other right)"),
    };
    assert_eq!(
        workspace
            .revise(&[combined], &independence)
            .unwrap()
            .revisions[0]
            .after
            .status,
        "unknown"
    );
}

#[test]
fn replaces_linked_combination_policy_invalidating_only_selected_foundation_closure() {
    let workspace = workspace();
    let product = ask(&workspace, INDEPENDENT, "combined", &assumptions());
    let min = ask(&workspace, MINIMUM, "combined", &assumptions());
    let rule = FoundationChange::ReplaceRule(node("(linked-rewrite independent-confidence combine-confidence (from (confidence-combine ?left ?right)) (to ?left))"));
    let changed = workspace.revise(&[product, min], &rule).unwrap();
    assert_eq!(changed.revisions[0].action, "rechecked");
    assert!(changed.revisions[0].changed);
    assert_eq!(value(&changed.revisions[0].after, "?c"), &ratio(3, 4));
    assert_eq!(value(&changed.revisions[0].after, "?p"), &ratio(1, 4));
    assert_eq!(changed.revisions[1].action, "kept");
    assert!(!changed.revisions[1].changed);
}

#[test]
fn changes_probability_independently_exposing_closed_s_k_evidence_and_bounded_exhaustion() {
    let workspace = workspace();
    let before = ask(&workspace, INDEPENDENT, "combined", &assumptions());
    let revised = node("(observation meter-a left (ratio one one) (ratio three four))");
    let change = FoundationChange::ReplaceAssumption {
        from: observations()[0].clone(),
        to: revised,
    };
    let revision = workspace.revise(&[before.clone()], &change).unwrap();
    let after = &revision.revisions[0].after;
    assert_eq!(value(after, "?p"), &ratio(1, 2));
    assert_eq!(value(after, "?c"), &ratio(3, 8));
    let closed = FoundationWorkspace::from_rml(&source()).unwrap();
    let reduction = closed
        .execute(
            INDEPENDENT,
            &node("(confidence-combine (ratio three four) (ratio one two))"),
            10_000,
        )
        .unwrap();
    assert_eq!(reduction.execution_basis, ExecutionBasis::ClosedSk);
    assert_eq!(reduction.output, Some(ratio(3, 8)));
    let leaf = node("(estimate left (probability (ratio one two)) (confidence (ratio three four)) (depends (source meter-a)))");
    let result = closed
        .ask(
            INDEPENDENT,
            &leaf,
            &[observations()[0].clone()],
            FoundationBounds::default(),
        )
        .unwrap();
    assert_eq!(result.execution_basis, ExecutionBasis::ClosedSk);
    assert_eq!(result.status, "proved");
    assert_eq!(
        result.proof.as_ref().unwrap().judgement,
        result.normalized.as_ref().unwrap().clone()
    );
    let bounded = FoundationWorkspace::from_rml(&source())
        .unwrap()
        .with_max_contractions(3000)
        .unwrap();
    let exhausted = ask(&bounded, INDEPENDENT, "combined", &assumptions());
    assert_eq!(exhausted.status, "exhausted");
    assert_eq!(exhausted.reason, "contraction-limit");
}
