use rml::foundation_workspace::{
    FoundationBounds, FoundationChange, FoundationProof, FoundationRef, FoundationResult,
    FoundationWorkspace, TheoryRef,
};
use rml::linked_program::ExecutionBasis;
use rml::{parse_one, tokenize_one, Node};

const SOURCE: &str = include_str!("../../test-corpus/foundations/foundation-context.lino");

fn node(source: &str) -> Node {
    if !source.starts_with('(') {
        return Node::Leaf(source.to_string());
    }
    parse_one(&tokenize_one(source)).expect("test term")
}

fn workspace() -> FoundationWorkspace {
    FoundationWorkspace::from_rml_with_basis(SOURCE, ExecutionBasis::DirectStructural, &[])
        .expect("linked feedback logic")
}

fn signed(polarity: &str, item: &str) -> Node {
    node(&format!("(signed {polarity} {item})"))
}

fn ask(workspace: &FoundationWorkspace, instance: &str, item: &str) -> FoundationResult {
    workspace
        .ask(
            instance,
            &signed("positive", item),
            &[],
            FoundationBounds::default(),
        )
        .expect("query result")
}

fn has_hypothesis(proof: &FoundationProof) -> bool {
    proof.program == "<hypothesis>" || proof.premises.iter().any(has_hypothesis)
}

fn check_context(result: &FoundationResult, version: &str, assumptions: &[Node]) {
    assert_eq!(
        result.foundation,
        FoundationRef {
            name: "signed-network".to_string(),
            version: version.to_string(),
        }
    );
    assert_eq!(
        result.theory,
        TheoryRef {
            name: "feedback-circuit".to_string(),
            rebind: vec![]
        }
    );
    assert_eq!(result.assumptions, assumptions);
    assert_eq!(
        result.cycle_policy.kind,
        if version == "1" {
            "inductive"
        } else {
            "guarded-coinductive"
        }
    );
    assert!(result.bounds.max_steps > 0);
}

#[test]
fn checks_guarded_query_and_refutation_independently_when_other_side_already_proved() {
    let workspace = workspace();
    for item in ["gamma", "delta", "epsilon"] {
        let result = ask(&workspace, "guarded-circuit", item);
        assert_eq!(result.status, "contradictory", "{item}");
        let proof = result.proof.as_ref().expect("positive proof");
        let refutation = result
            .refutation
            .as_ref()
            .unwrap()
            .proof
            .as_ref()
            .expect("negative proof");
        assert_eq!(proof.judgement, signed("positive", item));
        assert_eq!(refutation.judgement, signed("negative", item));
        assert_eq!(has_hypothesis(proof), item != "epsilon");
        assert_eq!(has_hypothesis(refutation), item != "delta");
        check_context(&result, "2", &[]);
    }
    assert_eq!(ask(&workspace, "finite-circuit", "gamma").status, "unknown");
    assert_eq!(ask(&workspace, "finite-circuit", "delta").status, "refuted");
    assert_eq!(
        ask(&workspace, "finite-circuit", "epsilon").status,
        "proved"
    );
}

#[test]
fn keeps_hypothetical_evidence_local_and_distinguishes_guarded_refutation_from_unknown() {
    let workspace = workspace();
    let positive = ask(&workspace, "guarded-circuit", "alpha");
    assert_eq!(positive.status, "proved");
    assert_eq!(positive.coinduction.as_ref().unwrap().status, "derived");
    assert_eq!(
        positive
            .refutation
            .as_ref()
            .unwrap()
            .coinduction
            .as_ref()
            .unwrap()
            .status,
        "not-derived"
    );
    let negative = ask(&workspace, "guarded-circuit", "beta");
    assert_eq!(negative.status, "refuted");
    assert_eq!(negative.reason, "guarded-coinductive-refutation");
    assert_eq!(negative.coinduction.as_ref().unwrap().status, "not-derived");
    let cycle = negative
        .refutation
        .as_ref()
        .unwrap()
        .coinduction
        .as_ref()
        .unwrap();
    assert_eq!(cycle.status, "derived");
    assert_eq!(cycle.hypothesis, signed("negative", "beta"));
    for item in ["absent", "loop"] {
        assert_eq!(ask(&workspace, "guarded-circuit", item).status, "unknown");
        assert_eq!(ask(&workspace, "finite-circuit", item).status, "unknown");
    }
}

#[test]
fn keeps_assumptions_isolated_across_concurrent_versions_and_repeated_public_queries() {
    let workspace = workspace();
    let mut assumptions = vec![signed("positive", "absent")];
    let proved = workspace
        .ask(
            "finite-circuit",
            &signed("positive", "absent"),
            &assumptions,
            FoundationBounds::default(),
        )
        .unwrap();
    assert_eq!(proved.status, "proved");
    check_context(&proved, "1", &assumptions);
    for instance in ["guarded-circuit", "finite-circuit", "guarded-circuit"] {
        let result = ask(&workspace, instance, "absent");
        assert_eq!(result.status, "unknown");
        assert!(result.assumptions.is_empty());
        assert!(result.dependencies.assumptions.is_empty());
    }
    assumptions[0] = signed("positive", "mutated-outside");
    assert_eq!(proved.assumptions, vec![signed("positive", "absent")]);
    assert_eq!(
        workspace.foundations(),
        vec![
            FoundationRef {
                name: "signed-network".to_string(),
                version: "1".to_string()
            },
            FoundationRef {
                name: "signed-network".to_string(),
                version: "2".to_string()
            },
        ]
    );
}

#[test]
fn carries_context_on_success_unknown_exhaustion_unsupported_and_rewrite_execution() {
    let workspace = workspace();
    let mut outcomes = ["alpha", "beta", "gamma", "absent"]
        .map(|item| ask(&workspace, "guarded-circuit", item))
        .to_vec();
    outcomes.push(
        workspace
            .ask(
                "guarded-circuit",
                &signed("positive", "alpha"),
                &[],
                FoundationBounds {
                    max_facts: 1,
                    ..FoundationBounds::default()
                },
            )
            .unwrap(),
    );
    outcomes.push(
        workspace
            .ask(
                "guarded-circuit",
                &node("(outside signature)"),
                &[],
                FoundationBounds::default(),
            )
            .unwrap(),
    );
    assert_eq!(
        outcomes
            .iter()
            .map(|result| result.status)
            .collect::<Vec<_>>(),
        vec![
            "proved",
            "refuted",
            "contradictory",
            "unknown",
            "exhausted",
            "unsupported"
        ]
    );
    for result in &outcomes {
        check_context(result, "2", &[]);
    }
    let execution = workspace
        .execute(
            "guarded-circuit",
            &node("(refutation-of (signed positive alpha))"),
            10_000,
        )
        .unwrap();
    assert_eq!(execution.status, "normal");
    assert_eq!(execution.output, Some(signed("negative", "alpha")));
    let stopped = workspace
        .execute(
            "guarded-circuit",
            &node("(refutation-of (refutation-of (signed positive alpha)))"),
            1,
        )
        .unwrap();
    assert_eq!(stopped.status, "exhausted");
    assert_eq!(stopped.bounds.max_steps, 1);
    for result in [execution, stopped] {
        assert_eq!(
            result.foundation,
            FoundationRef {
                name: "signed-network".to_string(),
                version: "2".to_string()
            }
        );
        assert_eq!(
            result.theory,
            TheoryRef {
                name: "feedback-circuit".to_string(),
                rebind: vec![]
            }
        );
        assert!(result.assumptions.is_empty());
        assert_eq!(result.cycle_policy.kind, "guarded-coinductive");
    }
}

#[test]
fn invalidates_coinductive_refutation_dependencies_without_leaking_across_versions() {
    let workspace = workspace();
    let guarded = ask(&workspace, "guarded-circuit", "beta");
    let finite = ask(&workspace, "finite-circuit", "beta");
    assert!(guarded
        .dependencies
        .rules
        .iter()
        .any(|rule| rule.rule == "negative-step"));
    assert!(guarded
        .dependencies
        .rules
        .iter()
        .any(|rule| rule.rule == "beta-negative"));
    let revision = workspace
        .revise(
            &[guarded, finite],
            &FoundationChange::RemoveRule {
                program: "feedback-circuit".to_string(),
                rule: "beta-negative".to_string(),
            },
        )
        .unwrap();
    assert_eq!(revision.revisions[0].after.status, "unknown");
    assert!(revision.revisions[0].changed);
    assert_eq!(revision.revisions[1].after.status, "unknown");
    assert!(!revision.revisions[1].changed);
    check_context(&revision.revisions[0].after, "2", &[]);
    check_context(&revision.revisions[1].after, "1", &[]);
}

#[test]
fn does_not_conflate_package_names_and_versions_containing_version_delimiter() {
    let source = "
(linked-program empty)
(linked-foundation signed@network (version 1) (cycle-policy inductive))
(linked-foundation signed (version network@1) (cycle-policy inductive))
(linked-instance first (theory empty) (foundation signed@network (version 1)))
(linked-instance second (theory empty) (foundation signed (version network@1)))";
    let loaded =
        FoundationWorkspace::from_rml_with_basis(source, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    assert_eq!(loaded.foundations().len(), 2);
    assert_eq!(
        loaded
            .ask("first", &node("x"), &[], FoundationBounds::default())
            .unwrap()
            .foundation,
        FoundationRef {
            name: "signed@network".to_string(),
            version: "1".to_string()
        }
    );
    assert_eq!(
        loaded
            .ask("second", &node("x"), &[], FoundationBounds::default())
            .unwrap()
            .foundation,
        FoundationRef {
            name: "signed".to_string(),
            version: "network@1".to_string()
        }
    );
}

#[test]
fn reports_exhaustion_of_either_guarded_search_preserving_independent_evidence() {
    let workspace = workspace();
    let bounds = FoundationBounds {
        max_facts: 10,
        ..FoundationBounds::default()
    };
    for item in ["alpha", "beta"] {
        let result = workspace
            .ask("guarded-circuit", &signed("positive", item), &[], bounds)
            .unwrap();
        assert_eq!(result.status, "exhausted");
        assert_eq!(result.reason, "guarded-fact-limit");
        assert_eq!(
            result.search.unwrap().ended,
            rml::linked_program::SearchEnd::Saturated
        );
        let status = if item == "alpha" {
            result.coinduction.as_ref().unwrap().status
        } else {
            result.refutation.as_ref().unwrap().status
        };
        assert_eq!(status, "not-derived-within-bounds");
    }
    let result = workspace
        .ask(
            "guarded-circuit",
            &signed("positive", "epsilon"),
            &[],
            bounds,
        )
        .unwrap();
    assert_eq!(result.status, "proved");
    assert_eq!(
        result.refutation.as_ref().unwrap().status,
        "not-derived-within-bounds"
    );
    assert_eq!(
        result.proof.as_ref().unwrap().judgement,
        signed("positive", "epsilon")
    );
}

#[test]
fn executes_both_guarded_polarities_through_default_closed_s_k_public_runtime() {
    let closed = FoundationWorkspace::from_rml(SOURCE).unwrap();
    assert_eq!(closed.execution_basis(), ExecutionBasis::ClosedSk);
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("../../test-corpus/foundations/expected.json")).unwrap();
    for case in expected["signedFeedback"].as_array().unwrap() {
        let item = case["item"].as_str().unwrap();
        let status = case["guarded"].as_str().unwrap();
        assert_eq!(
            ask(&closed, "finite-circuit", item).status,
            case["inductive"].as_str().unwrap()
        );
        let result = ask(&closed, "guarded-circuit", item);
        assert_eq!(result.status, status, "{item}");
        check_context(&result, "2", &[]);
    }
}
