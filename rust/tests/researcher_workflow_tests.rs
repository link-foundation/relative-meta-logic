#[path = "../examples/researcher_workflow.rs"]
mod workflow;
use rml::foundation_packages::FoundationPackages;
use rml::foundation_workspace::{FoundationBounds, FoundationChange};
use rml::linked_program::ExecutionBasis;
use rml::linked_proof::{replay_linked_proof, verify_linked_proof, LinkedProofOptions};
use serde_json::{json, Value};

fn expected(basis: &str) -> Value {
    let mut result: Value = serde_json::from_str(include_str!(
        "../../test-corpus/researcher-workflow/expected.json"
    ))
    .unwrap();
    result["executionBasis"] = json!(basis);
    result
}
#[test]
fn researcher_lifecycle_uses_public_direct_apis() {
    assert_eq!(
        workflow::run(ExecutionBasis::DirectStructural).unwrap(),
        expected("direct-structural")
    );
}
#[test]
fn researcher_lifecycle_uses_public_closed_sk_apis() {
    assert_eq!(
        workflow::run(ExecutionBasis::ClosedSk).unwrap(),
        expected("s-k")
    );
}
#[test]
fn researcher_rejects_forged_proof_context_trace_and_dependencies() {
    let manifests = workflow::packages();
    let workspace =
        FoundationPackages::from_packages_with_basis(&manifests, ExecutionBasis::DirectStructural)
            .unwrap();
    let goal = workflow::node(&json!(["publishable", "specimen"]));
    let answer = workspace
        .ask(
            &workflow::selection("1"),
            &goal,
            &[],
            FoundationBounds::default(),
        )
        .unwrap();
    let (context, goal, candidate) = workflow::certificate(&manifests[0], &answer).unwrap();
    let registry = workflow::proof_registry(ExecutionBasis::DirectStructural).unwrap();
    let options = LinkedProofOptions::default();
    let receipt = verify_linked_proof(&registry, &context, &goal, &candidate, &options).unwrap();
    assert!(receipt.accepted);
    for mutation in 0..5 {
        let mut changed = candidate.clone();
        let rml::Node::List(root) = &mut changed else {
            panic!()
        };
        let rml::Node::List(nodes) = &mut root[4] else {
            panic!()
        };
        if mutation == 0 {
            nodes.pop();
        } else {
            let rml::Node::List(first) = &mut nodes[0] else {
                panic!()
            };
            match mutation {
                1 => first[3] = workflow::node(&json!(["publishable", "forged"])),
                2 => first[6] = workflow::node(&json!([])),
                3 => first[4] = workflow::node(&json!([["x", "forged"]])),
                _ => first[5] = workflow::node(&json!(["n0"])),
            }
        }
        assert!(
            !verify_linked_proof(&registry, &context, &goal, &changed, &options)
                .unwrap()
                .accepted
        );
    }
    let mut foreign = context.clone();
    let rml::Node::List(fields) = &mut foreign else {
        panic!()
    };
    fields[1] = workflow::node(&json!(["review-policy", "2"]));
    assert!(
        !replay_linked_proof(&registry, &foreign, &goal, &receipt, &options)
            .unwrap()
            .accepted
    );
    let mut forged = receipt;
    forged.trace = workflow::node(&json!(["linked-execution"]));
    assert!(
        !replay_linked_proof(&registry, &context, &goal, &forged, &options)
            .unwrap()
            .matches
    );
    assert!(workflow::certificate(&manifests[1], &answer).is_err());
    let mut changed_source = manifests[0].clone();
    changed_source.source = changed_source
        .source
        .replace("(input specimen)", "(input other)");
    let (changed_context, changed_goal, stale) =
        workflow::certificate(&changed_source, &answer).unwrap();
    assert!(
        !verify_linked_proof(&registry, &changed_context, &changed_goal, &stale, &options)
            .unwrap()
            .accepted
    );
    let mut unrelated = manifests[0].clone();
    unrelated.source.push_str("\n(linked-program unrelated)\n(linked-fact unrelated claim (judgement (publishable forged)))");
    let mut forged_answer = answer.clone();
    forged_answer
        .result
        .dependencies
        .closure
        .push(rml::foundation_workspace::ClosureMember {
            program: "unrelated".into(),
            role: "axioms",
        });
    forged_answer
        .programs
        .push(rml::foundation_packages::ProgramOrigin {
            address: "unrelated".into(),
            name: unrelated.name.clone(),
            version: unrelated.version.clone(),
            program: "unrelated".into(),
        });
    assert_eq!(
        workflow::certificate(&unrelated, &forged_answer).unwrap().0,
        context
    );
}
#[test]
fn researcher_source_changes_and_workspace_ownership_are_enforced() {
    let mut manifests = workflow::packages();
    let before =
        FoundationPackages::from_packages_with_basis(&manifests, ExecutionBasis::DirectStructural)
            .unwrap();
    let goal = workflow::node(&json!(["publishable", "specimen"]));
    let answer = before
        .ask(
            &workflow::selection("1"),
            &goal,
            &[],
            FoundationBounds::default(),
        )
        .unwrap();
    manifests[0].source = manifests[0]
        .source
        .replace("(conclusion (accepted ?x))", "(conclusion (rejected ?x))");
    let after =
        FoundationPackages::from_packages_with_basis(&manifests, ExecutionBasis::DirectStructural)
            .unwrap();
    assert_eq!(
        after
            .ask(
                &workflow::selection("1"),
                &goal,
                &[],
                FoundationBounds::default()
            )
            .unwrap()
            .result
            .status,
        "refuted"
    );
    assert_eq!(
        before
            .ask(
                &workflow::selection("1"),
                &goal,
                &[],
                FoundationBounds::default()
            )
            .unwrap()
            .result
            .status,
        "proved"
    );
    assert!(after
        .revise(
            &[answer],
            &workflow::selection("1"),
            &FoundationChange::RemoveRule {
                program: "rules".into(),
                rule: "admission".into()
            }
        )
        .unwrap_err()
        .contains("returned by this package workspace"));
    for target in ["Rust", "Lean", "Rocq"] {
        let result = rml::portable_natural::translate_portable_natural(
            "async function successor(n) { return await n; }",
            "JavaScript",
            target,
        );
        assert_eq!(result.status, "unsupported");
        assert!(result.target_source.is_none());
    }
}

#[test]
fn constructs_typed_link_valued_sets_and_executes_linked_length_on_both_bases() {
    let (summary, mut collections, typed) = workflow::construct_objects().unwrap();
    assert_eq!(summary, expected("direct-structural")["objects"]);
    assert!(collections
        .encode_ordered_set(
            &["specimen".into(), "specimen".into()],
            "bad-order",
            "balanced"
        )
        .unwrap_err()
        .contains("duplicate"));
    let mut missing = typed.snapshot();
    missing
        .links
        .retain(|(address, _, _)| address != "submitted-edge");
    assert!(rml::semantic_archive::TypedSemanticArchive::from_snapshot(
        &missing,
        &[summary["setRoot"].as_str().unwrap().into()]
    )
    .unwrap_err()
    .contains("dangling"));
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let mut packages = workflow::packages();
        let workspace = FoundationPackages::from_packages_with_basis(&packages, basis).unwrap();
        let members = summary["setMembers"].as_array().unwrap();
        assert_eq!(
            workflow::execute_algorithm(&workspace, members)
                .unwrap()
                .result
                .output,
            Some(workflow::node(&json!(["s", ["s", "z"]])))
        );
        assert_eq!(
            workflow::execute_algorithm(&workspace, &[])
                .unwrap()
                .result
                .output,
            Some(workflow::node(&json!("z")))
        );
        packages[0].source = packages[0]
            .source
            .replace("(to (s (length ?tail)))", "(to z)");
        let altered = FoundationPackages::from_packages_with_basis(&packages, basis).unwrap();
        assert_eq!(
            workflow::execute_algorithm(&altered, members)
                .unwrap()
                .result
                .output,
            Some(workflow::node(&json!("z")))
        );
    }
}
