use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use rml::linked_program::{
    foundation_comparison_eligibility, link_representation_boundary_report, ExecutionBasis,
    LinkedProgramRegistry,
};
use rml::{parse_one, tokenize_one, Node};

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).expect("test link must parse")
}

fn source() -> String {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().expect("repository root");
    format!(
        "{}\n{}",
        fs::read_to_string(root.join("lib/meta-theory/universal.lino")).expect("universal source"),
        fs::read_to_string(root.join("lib/meta-theory/alternative-foundations.lino"))
            .expect("alternative source"),
    )
}

fn counter_program() -> Node {
    node(
        "(instructions
           (instruction q0 decrement-left failed q1)
           (instructions
             (instruction q1 increment-left q2 unused)
             (instructions
               (instruction q2 decrement-left q3 failed)
               (instructions
                 (instruction q3 decrement-right failed q4)
                 (instructions
                   (instruction q4 increment-right q5 unused)
                   (instructions
                     (instruction q5 decrement-right halt failed)
                     (no-instructions)))))))",
    )
}

fn assert_halted(result: &Node) -> Result<(), String> {
    let Node::List(children) = result else {
        return Err("counter machine returned an atom".to_string());
    };
    if children.get(0) != Some(&Node::Leaf("machine-halted".to_string()))
        || children.get(1) != Some(&Node::Leaf("zero".to_string()))
        || children.get(2) != Some(&Node::Leaf("zero".to_string()))
    {
        return Err(format!(
            "counter machine did not halt at zero/zero: {result}"
        ));
    }
    Ok(())
}

fn run_rewrite_candidate(
    source: &str,
    basis: ExecutionBasis,
    disabled: &[&str],
) -> Result<BTreeSet<String>, String> {
    let registry = LinkedProgramRegistry::from_rml_with_basis(source, basis, disabled)?;
    if !registry.has("foundation-search-import") {
        return Err("load acceptance failed".to_string());
    }
    let imported = registry.reduce(
        "foundation-search-import",
        &node("(measured-input alpha)"),
        10_000,
    )?;
    if imported.term != node("(foundation-output alpha)") {
        return Err("import/rebind/rewrite acceptance failed".to_string());
    }

    let interpreted = registry.reduce(
        "links-meta-foundation",
        &node(
            "(meta-verify
               (atom alpha)
               (meta-rewrite
                 (rules
                   (rewrite
                     (pair (atom identity) (meta-variable argument))
                     (meta-variable argument))
                   (no-rules))
                 (pair (atom identity) (atom alpha))))",
        ),
        10_000,
    )?;
    if interpreted.term != Node::Leaf("verified".to_string()) {
        return Err("match/substitute/verify/self-interpret acceptance failed".to_string());
    }
    if registry
        .prove(
            "foundation-search-proof",
            &node("(foundation-derived alpha)"),
            &[],
            128,
            10_000,
        )
        .is_none()
    {
        return Err("inference acceptance failed".to_string());
    }

    let referential = registry.reduce(
        "guarded-referential-links",
        &node("(observe (guarded-link proof-knot pulse proof-knot))"),
        10_000,
    )?;
    if referential.term != node("(observation proof-knot pulse (resume proof-knot))") {
        return Err("guarded referential observation failed".to_string());
    }
    let unguarded = registry.reduce(
        "guarded-referential-links",
        &node("(observe (guarded-link left-address pulse right-address))"),
        10_000,
    )?;
    if unguarded.term != node("(observe (guarded-link left-address pulse right-address))") {
        return Err("repeated-address guard accepted unequal addresses".to_string());
    }

    let described = registry.reduce(
        "links-meta-foundation",
        &node(
            "(meta-describe
               (rewrite
                 (pair (atom identity) (meta-variable argument))
                 (meta-variable argument)))",
        ),
        10_000,
    )?;
    if described.term
        != node(
            "(rule-description
               (pattern (pair (atom identity) (meta-variable argument)))
               (replacement (meta-variable argument)))",
        )
    {
        return Err("self-description acceptance failed".to_string());
    }

    let program = counter_program();
    let machine = registry.reduce(
        "link-register-machine",
        &Node::List(vec![
            Node::Leaf("machine-start".to_string()),
            program.clone(),
            Node::Leaf("q0".to_string()),
            Node::Leaf("zero".to_string()),
            Node::Leaf("zero".to_string()),
        ]),
        10_000,
    )?;
    assert_halted(&machine.term)?;
    let rules = machine
        .trace
        .iter()
        .map(|step| step.rule.clone())
        .collect::<BTreeSet<_>>();
    for instruction in [
        "execute-increment-left",
        "execute-increment-right",
        "execute-decrement-left-nonzero",
        "execute-decrement-left-zero",
        "execute-decrement-right-nonzero",
        "execute-decrement-right-zero",
    ] {
        if !rules.contains(instruction) {
            return Err(format!("counter witness missed {instruction}"));
        }
    }

    for (program_name, constructor) in [
        ("javascript-core", "javascript-execute"),
        ("rust-core", "rust-execute"),
    ] {
        let result = registry.reduce(
            program_name,
            &Node::List(vec![
                Node::Leaf(constructor.to_string()),
                Node::List(vec![
                    Node::Leaf("counter-program".to_string()),
                    program.clone(),
                    Node::Leaf("q0".to_string()),
                ]),
            ]),
            10_000,
        )?;
        assert_halted(&result.term)?;
    }
    for (program_name, goal) in [
        (
            "lean-dependent-core",
            "(lean-has-type
               (lean-lambda lean-Type (lean-bound zero))
               (lean-pi lean-Type lean-Type))",
        ),
        (
            "rocq-dependent-core",
            "(rocq-has-type
               (rocq-fun rocq-Type (rocq-rel zero))
               (rocq-prod rocq-Type rocq-Type))",
        ),
    ] {
        if registry
            .prove(program_name, &node(goal), &[], 128, 10_000)
            .is_none()
        {
            return Err(format!("{program_name} identity proof failed"));
        }
    }
    Ok(registry
        .runtime_semantic_trace()
        .observed_operations
        .into_iter()
        .collect())
}

fn run_horn_candidate(source: &str, disabled: &[&str]) -> Result<BTreeSet<String>, String> {
    let registry = LinkedProgramRegistry::from_rml_with_basis(
        source,
        ExecutionBasis::HornRelational,
        disabled,
    )?;
    for goal in [
        "(accepted load)",
        "(effective-rewrite foundation-horn measured-input foundation-output)",
        "(matched foundation-horn foundation-output alpha)",
        "(substituted foundation-horn (foundation-output alpha))",
        "(rewritten foundation-horn (foundation-output alpha))",
        "(foundation-derived alpha)",
        "(verified foundation-horn alpha)",
        "(self-interpreted horn-self-rule (encoded-derived alpha))",
        "(generated-clause
           copied-clause
           (premise (encoded-known (meta-variable value)))
           (conclusion (encoded-copied (meta-variable value))))",
        "(turing-completeness-witness two-counter-machine zero zero)",
        "(guarded-observation proof-knot pulse (resume proof-knot))",
        "(language-core-executes javascript two-counter-machine)",
        "(language-core-executes rust two-counter-machine)",
        "(dependent-identity-checks
           lean
           (lean-lambda lean-Type (lean-bound zero))
           (lean-pi lean-Type lean-Type))",
        "(dependent-identity-checks
           rocq
           (rocq-fun rocq-Type (rocq-rel zero))
           (rocq-prod rocq-Type rocq-Type))",
    ] {
        if registry
            .prove("horn-link-foundation", &node(goal), &[], 128, 10_000)
            .is_none()
        {
            return Err(format!("Horn acceptance failed for {goal}"));
        }
    }
    Ok(registry
        .runtime_semantic_trace()
        .observed_operations
        .into_iter()
        .collect())
}

#[test]
fn executes_three_independent_foundation_mechanisms_with_rust_parity() {
    let source = source();
    let sk = run_rewrite_candidate(&source, ExecutionBasis::ClosedSk, &[])
        .expect("closed S/K candidate must pass");
    let direct = run_rewrite_candidate(&source, ExecutionBasis::DirectStructural, &[])
        .expect("direct structural candidate must pass");
    let horn = run_horn_candidate(&source, &[]).expect("Horn candidate must pass");

    assert!(sk.contains("contract-s-link"));
    assert!(sk.contains("contract-k-link"));
    assert!(!direct.contains("contract-s-link"));
    assert!(!direct.contains("contract-k-link"));
    assert!(direct.contains("select-and-traverse-rewrite-rules"));
    assert!(!horn.contains("select-and-traverse-rewrite-rules"));
    assert!(horn.contains("schedule-horn-saturation"));
}

#[test]
fn fault_injects_every_candidate_residual_law() {
    let source = source();
    for operation in ["contract-s-link", "contract-k-link"] {
        assert!(run_rewrite_candidate(&source, ExecutionBasis::ClosedSk, &[operation]).is_err());
    }
    for operation in [
        "compare-link-structure",
        "bind-pattern-variables",
        "substitute-bound-structures",
        "select-and-traverse-rewrite-rules",
        "resolve-and-rebind-program-imports",
        "saturate-inference-rules",
    ] {
        assert!(
            run_rewrite_candidate(&source, ExecutionBasis::DirectStructural, &[operation]).is_err()
        );
    }
    for operation in [
        "compare-link-structure",
        "bind-pattern-variables",
        "substitute-bound-structures",
        "insert-derived-fact",
        "schedule-horn-saturation",
    ] {
        assert!(run_horn_candidate(&source, &[operation]).is_err());
    }
}

#[test]
fn host_representation_witness_does_not_claim_link_ontology() {
    let report = link_representation_boundary_report();
    assert_eq!(
        report.classification,
        "ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS"
    );
    assert_eq!(
        report.investigated_object,
        "host-representation-of-an-ordered-link"
    );
    assert!(!report.link_ontology_covered);
    assert!(!report.representation_exhaustiveness_established);
    assert_eq!(report.intrinsic_transition_authority, "UNRESOLVED");
    assert_eq!(
        report.structure_transformation_separation,
        "ASSUMED_BY_EXPERIMENT"
    );
    assert_eq!(report.transition_externality, "ASSUMED_BY_EXPERIMENT");
    assert_eq!(
        report
            .model_assumptions
            .iter()
            .map(|assumption| assumption.id)
            .collect::<Vec<_>>(),
        vec![
            "tagged-ternary-host-value",
            "ordered-endpoint-positions",
            "passive-link-value",
            "external-transition-function",
        ]
    );
    assert!(report.model_assumptions.iter().all(|assumption| {
        assumption.status == "ASSUMED_NOT_DERIVED" && !assumption.role.is_empty()
    }));
    assert_eq!(report.interpretations.len(), 2);
    assert_eq!(report.interpretations[0].input, report.shared_input);
    assert_eq!(report.interpretations[1].input, report.shared_input);
    assert_ne!(
        report.interpretations[0].output,
        report.interpretations[1].output
    );
    assert!(report
        .interpretations
        .iter()
        .all(|item| item.preserves_link_formation && item.renaming_invariant));
    assert!(!report.unique_transition_selected);
    assert!(report
        .admissible_conclusion
        .contains("host representation signature"));
    assert!(report
        .prohibited_conclusions
        .contains(&"no execution principle can arise from links themselves"));
    assert!(!report.admissible_conclusion.contains("intrinsic to links"));
}

#[test]
fn excludes_asymmetrically_reduced_candidates_from_ranking() {
    let closed_sk = foundation_comparison_eligibility(9, 0, 0, true);
    assert!(closed_sk.eligible);
    assert!(closed_sk.exclusion_reasons.is_empty());

    for (host_capabilities, expected_closure) in [(6, "9/15"), (5, "9/14")] {
        let control = foundation_comparison_eligibility(9, host_capabilities, 1, true);
        assert!(
            !control.eligible,
            "{expected_closure} must not enter ranking"
        );
        assert_eq!(
            control.exclusion_reasons,
            vec![
                "INCOMPLETE_SELF_HOSTING_CLOSURE",
                "HOST_SELF_SEMANTIC_DUPLICATION",
                "EXTERNAL_SEMANTIC_SOURCE_DESCRIPTION",
            ]
        );
    }
}
