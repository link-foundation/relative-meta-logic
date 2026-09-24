use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use rml::linked_program::{
    foundation_comparison_eligibility, link_ontology_symmetry_report,
    link_representation_boundary_report, ExecutionBasis, LinkedProgramRegistry,
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
    assert_eq!(report.foundational_status, "OPEN");
    assert_eq!(
        report.investigation_status,
        "OPEN_INDEPENDENT_INVESTIGATION"
    );
    assert_eq!(
        report
            .open_questions
            .iter()
            .map(|question| (question.id, question.status))
            .collect::<Vec<_>>(),
        vec![
            ("link-ontology", "UNRESOLVED"),
            ("primitive-categories", "UNRESOLVED"),
            ("structure-transformation-relation", "UNRESOLVED"),
            ("intrinsic-semantic-authority", "UNRESOLVED"),
            ("comparative-minimality", "UNRESOLVED"),
        ]
    );
    assert_eq!(
        report
            .imported_primitive_categories
            .iter()
            .map(|category| category.id)
            .collect::<Vec<_>>(),
        vec![
            "data",
            "operation",
            "state",
            "transition",
            "interpreter",
            "evaluator",
            "rewrite",
            "rule",
            "function",
            "relation",
        ]
    );
    assert!(report.imported_primitive_categories.iter().all(|category| {
        category.provenance == "IMPORTED_EXPERIMENTAL_VOCABULARY"
            && category.foundational_status == "UNESTABLISHED"
    }));
    assert_eq!(report.existing_candidates_role, "EXECUTABLE_CONTROLS_ONLY");
    assert!(!report.existing_candidates_constrain_search);
    assert!(!report.target_architecture_selected);
    assert_eq!(
        report.comparison_scope,
        "EXECUTION_ARCHITECTURE_ONLY_NOT_ONTOLOGY"
    );
    assert!(report.provenance_questions.len() >= 3);
}

#[test]
fn exhaustive_link_symmetries_derive_representation_independent_facts() {
    let report = link_ontology_symmetry_report();

    assert_eq!(report.schema, "rml-link-ontology-symmetry-experiment/v13");
    assert_eq!(report.occurrence_count, 2);
    assert_eq!(
        report
            .assumptions
            .iter()
            .map(|item| item.id)
            .collect::<Vec<_>>(),
        vec!["two-unlabelled-reference-occurrences", "reference-equality"]
    );
    assert_eq!(report.assignments_examined, 3);
    assert_eq!(report.group_actions_examined, 6);
    assert_eq!(report.action_applications_examined, 10);
    assert!(report.support_restriction.contains("unused references"));
    assert_eq!(
        report
            .canonical_classes
            .iter()
            .map(|item| (item.signature, item.orbit.clone()))
            .collect::<Vec<_>>(),
        vec![
            ("same-reference", vec![vec![0, 0]]),
            ("distinct-references", vec![vec![0, 1], vec![1, 0]]),
        ]
    );
    assert_eq!(
        report.complete_invariant,
        "equality partition of the two reference occurrences"
    );
    assert!(report.representation_agreement.iter().all(|item| {
        item.same_reference == "same-reference"
            && item.distinct_references == "distinct-references"
            && item.invariant_across_all_actions
            && item.same_reference_output != item.distinct_references_output
    }));

    assert_eq!(report.distinct_reference_symmetry.automorphisms.len(), 2);
    assert_eq!(
        report.distinct_reference_symmetry.occurrence_orbits,
        vec![vec![0, 1]]
    );
    assert_eq!(
        report.distinct_reference_symmetry.unary_selectors_examined,
        4
    );
    assert_eq!(
        report.distinct_reference_symmetry.invariant_unary_selectors,
        vec![Vec::<usize>::new(), vec![0, 1]]
    );
    assert!(
        !report
            .distinct_reference_symmetry
            .invariant_singleton_selector_exists
    );
    assert_eq!(
        report.distinct_reference_symmetry.total_self_maps_examined,
        4
    );
    assert_eq!(
        report
            .distinct_reference_symmetry
            .equivariant_self_maps
            .iter()
            .map(|item| (item.id, item.mapping.clone()))
            .collect::<Vec<_>>(),
        vec![("identity", vec![0, 1]), ("swap", vec![1, 0])]
    );
    assert!(
        !report
            .distinct_reference_symmetry
            .unique_equivariant_self_map
    );

    assert_eq!(report.reification_countermodels.len(), 2);
    assert!(report
        .reification_countermodels
        .iter()
        .all(|model| model.projected_observation == "distinct-references"));
    assert_eq!(
        report
            .reification_countermodels
            .iter()
            .map(|model| model.has_link_identity)
            .collect::<Vec<_>>(),
        vec![false, true]
    );
    assert_eq!(
        report
            .results
            .iter()
            .map(|item| (item.id, item.result))
            .collect::<Vec<_>>(),
        vec![
            ("endpoint-direction", "NOT_DERIVABLE"),
            ("reified-link-identity", "REPRESENTATION_DEPENDENT"),
            (
                "reference-equality-pattern",
                "COMPLETE_INVARIANT_FOR_CONTRACT"
            ),
            (
                "structure-transformation-separation",
                "NON_ABSOLUTE_FOR_SYMMETRIES"
            ),
            (
                "representation-independent-authority",
                "NEGATIVE_CONSTRAINT_ONLY"
            ),
            ("intrinsic-dynamics", "NOT_SELECTED"),
            (
                "fixed-binary-observation-sufficiency",
                "INSUFFICIENT_OUTSIDE_FIXED_ARITY",
            ),
            (
                "conditional-refinement-recoverability",
                "NOT_RECOVERABLE_FROM_BASE_PROJECTION",
            ),
            (
                "conditional-structural-asymmetry",
                "EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL",
            ),
            (
                "conditional-asymmetry-provenance",
                "BASE_FORCED_AND_REFINEMENT_DEPENDENT_COMPONENTS_SEPARATED",
            ),
            (
                "conditional-interaction-forcedness",
                "SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE",
            ),
            (
                "starting-representation-faithfulness",
                "REFERENCE_ONLY_PROJECTION_NON_FAITHFUL_FOR_SELF_REFERENCE",
            ),
            (
                "slotwise-self-incidence",
                "CLASSIFIED_PER_ORDERED_REFERENCE_SLOT",
            ),
            (
                "shared-address-composition",
                "LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL",
            ),
            (
                "structural-application-composition",
                "RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION",
            ),
            (
                "link-carried-selection-authority",
                "LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY",
            ),
            (
                "linked-structural-admissibility",
                "LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING",
            ),
            (
                "linked-verifier-step",
                "LOCAL_MATCH_HAS_LINKED_TRACE_BUT_RETAINS_HOST_EXECUTION_BOUNDARY",
            ),
            (
                "conditional-continuation",
                "LINKED_WITNESS_CONDITIONALLY_SELECTS_CONTINUATION_WITHOUT_FORCING_IT",
            ),
            (
                "addressable-quotient-assumptions",
                "RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED",
            ),
            ("observation-loss-provenance", "CLASSIFIED_NOT_RESOLVED"),
        ]
    );
    assert!(report
        .admissible_conclusion
        .to_lowercase()
        .contains("exhaustive"));
    assert!(report
        .admissible_conclusion
        .contains("cannot assign source"));
    assert!(report
        .remaining_boundary
        .contains("does not define a link ontology"));

    let boundary = &report.observation_boundary;
    assert_eq!(boundary.status, "BINARY_CONTRACT_NOT_EXHAUSTIVE");
    assert_eq!(
        boundary
            .arity_enumeration
            .iter()
            .map(|item| (
                item.occurrence_count,
                item.surjective_assignments_examined,
                item.reference_rename_classes,
                item.quotient_classes,
                item.multiplicity_spectra.clone(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 1, 1, 1, vec![vec![1]]),
            (2, 3, 2, 2, vec![vec![1, 1], vec![2]]),
            (3, 13, 5, 3, vec![vec![1, 1, 1], vec![2, 1], vec![3]]),
            (
                4,
                75,
                15,
                5,
                vec![
                    vec![1, 1, 1, 1],
                    vec![2, 1, 1],
                    vec![2, 2],
                    vec![3, 1],
                    vec![4]
                ],
            ),
        ]
    );
    assert!(boundary.arity_enumeration_complete);
    assert_eq!(
        boundary.generalized_complete_invariant,
        "reference multiplicity spectrum for each exhaustively tested unlabelled width 1 through 4"
    );

    let refinement = &boundary.conditional_refinement;
    assert_eq!(
        refinement.assumption.provenance,
        "CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED"
    );
    assert_eq!(refinement.assumption.foundational_status, "UNESTABLISHED");
    assert_eq!(refinement.occurrence_count, 4);
    assert_eq!(refinement.reference_partitions_examined, 15);
    assert_eq!(refinement.refinement_partitions_examined, 15);
    assert_eq!(refinement.labelled_joint_structures_examined, 225);
    assert_eq!(refinement.occurrence_permutations_examined, 24);
    assert_eq!(refinement.joint_quotient_classes, 33);
    assert_eq!(
        refinement
            .encodings
            .iter()
            .map(|item| (
                item.id,
                item.distinct_classes,
                item.complete_for_enumeration
            ))
            .collect::<Vec<_>>(),
        vec![
            ("canonical-partition-pair", 33, true),
            ("paired-equality-matrices", 33, true),
            ("intersection-multiplicity-table", 33, true),
        ]
    );
    assert!(refinement.encoding_agreement);
    assert_eq!(
        refinement
            .projection_fibres
            .iter()
            .map(|item| (
                item.reference_multiplicity_spectrum.clone(),
                item.joint_classes,
                item.classes_with_invariant_singleton,
                item.classes_without_invariant_singleton,
                item.singleton_presence_classification,
            ))
            .collect::<Vec<_>>(),
        vec![
            (vec![1, 1, 1, 1], 5, 1, 4, "REFINEMENT_DEPENDENT"),
            (vec![2, 1, 1], 9, 3, 6, "REFINEMENT_DEPENDENT"),
            (vec![2, 2], 7, 1, 6, "REFINEMENT_DEPENDENT"),
            (vec![3, 1], 7, 7, 0, "BASE_FORCED"),
            (vec![4], 5, 1, 4, "REFINEMENT_DEPENDENT"),
        ]
    );
    assert!(refinement.every_projection_fibre_ambiguous);
    assert!(!refinement.refinement_recoverable_from_base);
    assert_eq!(refinement.classes_with_invariant_singleton, 13);
    assert_eq!(refinement.classes_without_invariant_singleton, 20);
    assert!(refinement.conditional_singleton_selector_exists);
    assert!(!refinement.universal_singleton_selector_exists);
    assert_eq!(
        refinement
            .singleton_orbit_histogram
            .iter()
            .map(|item| (item.singleton_orbits, item.joint_classes))
            .collect::<Vec<_>>(),
        vec![(0, 20), (1, 5), (2, 7), (4, 1)]
    );
    assert_eq!(
        refinement
            .asymmetry_provenance
            .classifications
            .iter()
            .map(|item| (item.id, item.joint_classes))
            .collect::<Vec<_>>(),
        vec![
            ("BASE_FORCED", 7),
            ("REFINEMENT_PRESENT_NOT_BASE_FORCED", 5),
            ("RELATIONAL_INTERACTION_ONLY", 1),
            ("NO_SINGLETON_ORBIT", 20),
        ]
    );
    assert_eq!(
        refinement
            .asymmetry_provenance
            .base_projection_fibres_with_both_outcomes,
        4
    );
    assert_eq!(
        refinement
            .asymmetry_provenance
            .base_projection_fibres_forcing_singleton,
        1
    );
    let countermodel = &refinement.asymmetry_provenance.countermodel;
    assert_eq!(
        countermodel.normalized_reference_partition,
        vec![0, 0, 1, 2]
    );
    assert_eq!(countermodel.reference_occurrence_orbit_sizes, vec![2, 2]);
    assert_eq!(
        countermodel
            .without_singleton_refinement
            .normalized_partition,
        vec![0, 0, 0, 0]
    );
    assert_eq!(
        countermodel
            .without_singleton_refinement
            .refinement_occurrence_orbit_sizes,
        vec![4]
    );
    assert_eq!(
        countermodel
            .without_singleton_refinement
            .joint_occurrence_orbit_sizes,
        vec![2, 2]
    );
    assert_eq!(
        countermodel
            .interaction_only_refinement
            .normalized_partition,
        vec![0, 1, 0, 2]
    );
    assert_eq!(
        countermodel
            .interaction_only_refinement
            .refinement_occurrence_orbit_sizes,
        vec![2, 2]
    );
    assert_eq!(
        countermodel
            .interaction_only_refinement
            .joint_occurrence_orbit_sizes,
        vec![1, 1, 1, 1]
    );
    assert_eq!(
        refinement
            .derivation_boundary
            .finite_enumeration
            .iter()
            .map(|item| (
                item.occurrence_count,
                item.base_patterns_examined,
                item.candidate_observations_examined,
                item.base_symmetry_preserving_candidates,
                item.symmetry_breaking_candidates,
                item.preserving_candidates_changing_occurrence_orbits,
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 1, 1, 1, 0, 0),
            (2, 2, 4, 4, 0, 0),
            (3, 5, 25, 13, 12, 0),
            (4, 15, 225, 55, 170, 0),
        ]
    );
    assert_eq!(
        refinement.derivation_boundary.consequence,
        "BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS"
    );
    assert_eq!(
        refinement.derivation_boundary.general_argument.scope,
        "all finite observations satisfying the stated derivation criterion"
    );
    let interaction_counterexample = &refinement
        .derivation_boundary
        .interaction_only_counterexample;
    assert_eq!(interaction_counterexample.base_pattern, vec![0, 0, 1, 2]);
    assert_eq!(
        interaction_counterexample.conditional_pattern,
        vec![0, 1, 0, 2]
    );
    assert_eq!(
        interaction_counterexample.base_preserving_relabelling,
        vec![1, 0, 2, 3]
    );
    assert_eq!(
        interaction_counterexample.relabelled_base_pattern,
        vec![0, 0, 1, 2]
    );
    assert_eq!(
        interaction_counterexample.relabelled_conditional_pattern,
        vec![0, 1, 1, 2]
    );
    assert!(interaction_counterexample.base_preserved);
    assert!(!interaction_counterexample.conditional_pattern_preserved);

    let starting_representation = &boundary.starting_representation_audit;
    assert_eq!(
        starting_representation.status,
        "REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE"
    );
    assert_eq!(
        starting_representation.independent_justification.provenance,
        "ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT"
    );
    assert_eq!(
        starting_representation
            .finite_enumeration
            .iter()
            .map(|item| (
                item.occurrence_count,
                item.reference_only_classes,
                item.addressable_link_classes,
                item.classes_with_no_direct_self_reference,
                item.classes_with_direct_self_reference,
                item.projection_fibre_histogram
                    .iter()
                    .map(|row| (row.addressable_classes, row.reference_only_classes))
                    .collect::<Vec<_>>(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 1, 2, 1, 1, vec![(2, 1)]),
            (2, 2, 4, 2, 2, vec![(2, 2)]),
            (3, 3, 7, 3, 4, vec![(2, 2), (3, 1)]),
            (4, 5, 12, 5, 7, vec![(2, 3), (3, 2)]),
        ]
    );
    assert!(starting_representation.every_projection_fibre_ambiguous);
    assert!(!starting_representation.reference_only_projection_faithful);
    assert_eq!(
        starting_representation
            .countermodel
            .projected_reference_multiplicity_spectrum,
        vec![1, 1]
    );
    assert_eq!(
        starting_representation
            .countermodel
            .direct_self_link
            .normalized_address_pattern,
        vec![0, 0, 1]
    );
    assert_eq!(
        starting_representation
            .countermodel
            .direct_self_link
            .direct_self_reference_count,
        1
    );
    assert_eq!(
        starting_representation
            .countermodel
            .fresh_external_link
            .normalized_address_pattern,
        vec![0, 1, 2]
    );
    assert_eq!(
        starting_representation
            .countermodel
            .fresh_external_link
            .direct_self_reference_count,
        0
    );
    assert!(
        starting_representation
            .countermodel
            .same_reference_only_projection
    );
    assert!(
        !starting_representation
            .countermodel
            .same_addressable_link_class
    );
    assert_eq!(
        starting_representation.general_argument.consequence,
        "REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY"
    );
    let slotwise_incidence = &starting_representation.slotwise_self_incidence;
    assert_eq!(
        slotwise_incidence.status,
        "CLASSIFIED_PER_ORDERED_REFERENCE_SLOT"
    );
    assert_eq!(
        slotwise_incidence.provenance,
        "ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT"
    );
    assert_eq!(
        slotwise_incidence.predicate,
        "selfIncidenceByReferenceSlot[i] = (referenceAddress[i] === linkAddress)"
    );
    assert_eq!(
        slotwise_incidence
            .finite_enumeration
            .iter()
            .map(|item| (
                item.occurrence_count,
                item.self_incidence_patterns,
                item.ordered_equality_classes,
                item.classes_by_self_incidence
                    .iter()
                    .map(|row| (
                        row.self_incidence_by_reference_slot.clone(),
                        row.ordered_equality_classes,
                    ))
                    .collect::<Vec<_>>(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 2, 2, vec![(vec![false], 1), (vec![true], 1)]),
            (
                2,
                4,
                5,
                vec![
                    (vec![false, false], 2),
                    (vec![false, true], 1),
                    (vec![true, false], 1),
                    (vec![true, true], 1),
                ],
            ),
            (
                3,
                8,
                15,
                vec![
                    (vec![false, false, false], 5),
                    (vec![false, false, true], 2),
                    (vec![false, true, false], 2),
                    (vec![false, true, true], 1),
                    (vec![true, false, false], 2),
                    (vec![true, false, true], 1),
                    (vec![true, true, false], 1),
                    (vec![true, true, true], 1),
                ],
            ),
            (
                4,
                16,
                52,
                vec![
                    (vec![false, false, false, false], 15),
                    (vec![false, false, false, true], 5),
                    (vec![false, false, true, false], 5),
                    (vec![false, false, true, true], 2),
                    (vec![false, true, false, false], 5),
                    (vec![false, true, false, true], 2),
                    (vec![false, true, true, false], 2),
                    (vec![false, true, true, true], 1),
                    (vec![true, false, false, false], 5),
                    (vec![true, false, false, true], 2),
                    (vec![true, false, true, false], 2),
                    (vec![true, false, true, true], 1),
                    (vec![true, true, false, false], 2),
                    (vec![true, true, false, true], 1),
                    (vec![true, true, true, false], 1),
                    (vec![true, true, true, true], 1),
                ],
            ),
        ]
    );
    assert!(slotwise_incidence.every_boolean_slot_pattern_realized);
    assert!(slotwise_incidence.address_renaming_invariant_verified);
    assert!(slotwise_incidence.occurrence_permutation_equivariant_verified);
    assert!(!slotwise_incidence.occurrence_permutation_invariant);
    assert_eq!(
        slotwise_incidence.countermodel.first_ordered_pattern,
        vec![0, 0, 1]
    );
    assert_eq!(
        slotwise_incidence.countermodel.second_ordered_pattern,
        vec![0, 1, 0]
    );
    assert_eq!(
        slotwise_incidence
            .countermodel
            .first_self_incidence_by_reference_slot,
        vec![true, false]
    );
    assert_eq!(
        slotwise_incidence
            .countermodel
            .second_self_incidence_by_reference_slot,
        vec![false, true]
    );
    assert!(
        slotwise_incidence
            .countermodel
            .same_self_incidence_multiplicity
    );
    assert!(!slotwise_incidence.countermodel.same_slotwise_self_incidence);
    assert!(
        slotwise_incidence
            .countermodel
            .same_after_occurrence_permutation
    );
    assert_eq!(
        slotwise_incidence.ordered_faithful_descriptor.fields,
        vec!["referenceEqualityMatrix", "selfIncidenceByReferenceSlot"]
    );
    assert_eq!(
        slotwise_incidence.ordered_faithful_descriptor.status,
        "COMPLETE_INVARIANT_FOR_ORDERED_ADDRESS_EQUALITY_CONTRACT"
    );
    assert!(
        slotwise_incidence
            .ordered_faithful_descriptor
            .finite_enumeration_agreement
    );
    let shared_address_composition = &starting_representation.shared_address_composition;
    assert_eq!(
        shared_address_composition.status,
        "LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL"
    );
    assert_eq!(
        shared_address_composition.provenance,
        "ISSUE_183_INDIRECT_SELF_REFERENCE_REQUIREMENT"
    );
    assert_eq!(
        shared_address_composition
            .finite_enumeration
            .iter()
            .map(|item| (
                item.link_count,
                item.reference_slots_per_link,
                item.shared_address_classes,
                item.local_descriptor_classes,
                item.local_descriptor_fibre_histogram
                    .iter()
                    .map(|row| (row.shared_address_classes, row.local_descriptor_classes))
                    .collect::<Vec<_>>(),
                item.local_descriptors_faithful,
                item.shared_descriptor_classes,
                item.shared_descriptor_faithful,
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 1, 2, 2, vec![(1, 2)], true, 2, true),
            (2, 1, 10, 4, vec![(1, 1), (2, 2), (5, 1)], false, 10, true),
            (
                3,
                1,
                77,
                8,
                vec![(1, 1), (3, 3), (10, 3), (37, 1)],
                false,
                77,
                true,
            ),
            (
                4,
                1,
                799,
                16,
                vec![(1, 1), (4, 4), (17, 6), (77, 4), (372, 1)],
                false,
                799,
                true,
            ),
        ]
    );
    assert!(
        !shared_address_composition.local_descriptors_faithful_at_every_tested_multi_link_width
    );
    assert_eq!(
        shared_address_composition.countermodel.external_references,
        vec![vec![0, 1], vec![2, 3]]
    );
    assert_eq!(
        shared_address_composition.countermodel.two_link_cycle,
        vec![vec![0, 2], vec![2, 0]]
    );
    assert!(
        shared_address_composition
            .countermodel
            .same_local_descriptors
    );
    assert!(
        !shared_address_composition
            .countermodel
            .same_shared_address_class
    );
    assert_eq!(
        shared_address_composition
            .countermodel
            .external_references_cycle_length,
        0
    );
    assert_eq!(
        shared_address_composition
            .countermodel
            .two_link_cycle_length,
        2
    );
    assert_eq!(
        shared_address_composition.shared_faithful_descriptor.status,
        "COMPLETE_INVARIANT_FOR_ORDERED_SHARED_ADDRESS_EQUALITY_CONTRACT"
    );
    assert_eq!(
        shared_address_composition.shared_faithful_descriptor.fields,
        vec![
            "referenceEqualityMatrixAcrossLinks",
            "referenceToLinkAddressIncidenceMatrix",
        ]
    );
    assert!(
        shared_address_composition
            .shared_faithful_descriptor
            .finite_enumeration_agreement
    );
    assert!(shared_address_composition
        .assumption_classification
        .semantics_not_assigned
        .contains("not a source, target, transition, dependency, or execution edge"));
    let structural_probe = &starting_representation.structural_application_composition;
    let continuation = &starting_representation.conditional_continuation;
    assert_eq!(
        continuation.status,
        "LINKED_WITNESS_CONDITIONALLY_SELECTS_CONTINUATION_WITHOUT_FORCING_IT"
    );
    assert_eq!(continuation.premises, vec![vec![3, 0, 1], vec![4, 1, 2]]);
    assert_eq!(continuation.forward_witness, vec![5, 3, 4]);
    assert_eq!(continuation.reverse_witness, vec![5, 4, 3]);
    assert_eq!(
        continuation
            .cases
            .iter()
            .map(|case| (case.id, case.continuations.clone()))
            .collect::<Vec<_>>(),
        vec![
            ("forward-witness", vec![vec![0, 2]]),
            ("reverse-witness", vec![]),
            ("without-first-premise", vec![]),
            ("without-second-premise", vec![]),
            ("without-witness", vec![]),
            ("unrelated-result-record", vec![vec![0, 2]]),
        ]
    );
    assert!(continuation.address_renaming_equivariant);
    assert!(continuation.record_reordering_invariant);
    assert!(continuation.slot_reversal_changes_continuation);
    assert!(continuation.result_absent_with_witness);
    assert!(continuation.result_present_in_extension);
    assert!(continuation.witness_condition_holds_in_both);
    assert!(!continuation.intrinsic_creation_or_authority_established);
    let law_audit = &continuation.transition_law_audit;
    assert!(law_audit.nested_encoding_preserves_readout);
    assert!(law_audit.both_readouts_address_renaming_equivariant);
    assert!(law_audit.both_readouts_record_reordering_invariant);
    assert_eq!(law_audit.unordered_witness_readout, vec![vec![0, 2]]);
    assert_eq!(
        law_audit.reversed_witness_under_unordered_reading,
        vec![vec![0, 2]]
    );
    assert_eq!(
        law_audit.same_facts_competing_readouts.forward_projection,
        vec![vec![0, 2]]
    );
    assert_eq!(
        law_audit.same_facts_competing_readouts.reverse_projection,
        vec![vec![2, 0]]
    );
    assert_eq!(
        law_audit.same_facts_with_rule_record_competing_readouts,
        law_audit.same_facts_competing_readouts
    );
    assert!(
        law_audit
            .adjacency_equality_erasure_countermodel
            .same_retained_addresses_and_witness
    );
    assert_eq!(
        law_audit
            .adjacency_equality_erasure_countermodel
            .shared_reference_readout,
        vec![vec![0, 2]]
    );
    assert!(law_audit
        .adjacency_equality_erasure_countermodel
        .split_reference_readout
        .is_empty());
    assert_eq!(
        law_audit.operation_removal.without_witness_orientation,
        "SAME_CANDIDATE_FOR_THIS_CHAIN"
    );
    assert_eq!(
        law_audit.operation_removal.without_output_projection,
        "TWO_CANDIDATE_READOUTS"
    );
    assert_eq!(
        law_audit.operation_removal.without_incidence_equality,
        "JOIN_UNDETERMINED"
    );
    assert_eq!(
        law_audit.operation_removal.without_enumeration,
        "CANDIDATE_DISCOVERY_UNDETERMINED"
    );
    assert_eq!(
        law_audit.operation_removal.without_construction,
        "NO_RESULT_RECORD_PRODUCED"
    );
    assert!(law_audit.stage_boundary.formable);
    assert!(law_audit.stage_boundary.conditionally_identifiable);
    assert!(!law_audit.stage_boundary.intrinsically_admissible);
    assert!(!law_audit.stage_boundary.follows_from_records_alone);
    assert!(!law_audit.stage_boundary.produced_by_records_alone);
    assert!(!law_audit.law_self_application_established);
    assert_eq!(
        structural_probe.status,
        "RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION"
    );
    assert_eq!(
        (
            structural_probe.semantic_separation.logical_implication,
            structural_probe.semantic_separation.link_structure,
            structural_probe.semantic_separation.composition,
            structural_probe.semantic_separation.execution,
        ),
        (
            "NOT_IDENTIFIED_WITH_LINK_STRUCTURE",
            "ADDRESS_REFERENCE_INCIDENCE_ONLY",
            "PROPOSED_LINK_NOT_FORCED",
            "NO_TRANSFORMATION_OR_CREATION_LAW_PRESENT",
        )
    );
    assert_eq!(
        structural_probe.candidate_encodings.left_associated,
        vec![vec![3, 0, 1], vec![4, 3, 2]]
    );
    assert_eq!(
        structural_probe.candidate_encodings.right_associated,
        vec![vec![3, 1, 2], vec![4, 0, 3]]
    );
    assert!(
        !structural_probe
            .candidate_encodings
            .same_under_address_renaming_alone
    );
    assert!(
        structural_probe
            .candidate_encodings
            .same_after_uniform_slot_reversal_and_address_renaming
    );
    assert!(
        structural_probe
            .candidate_encodings
            .recursive_address_references_present
    );
    assert_eq!(
        structural_probe
            .role_recovery
            .semantic_assignments_for_three_leaves,
        6
    );
    assert_eq!(
        structural_probe
            .role_recovery
            .unordered_structure_automorphisms,
        2
    );
    assert_eq!(
        structural_probe.role_recovery.unordered_leaf_orbit_sizes,
        vec![1, 2]
    );
    assert!(
        !structural_probe
            .role_recovery
            .all_four_semantic_roles_recovered
    );
    assert_eq!(
        structural_probe.role_recovery.status,
        "ADDITIONAL_ROLE_ASSIGNMENT_REQUIRED"
    );
    assert_eq!(
        structural_probe
            .composition_countermodel
            .without_proposed_result,
        vec![vec![3, 0, 1], vec![4, 1, 2], vec![5, 2, 0], vec![6, 6, 3]]
    );
    assert_eq!(
        structural_probe
            .composition_countermodel
            .with_proposed_result,
        vec![
            vec![3, 0, 1],
            vec![4, 1, 2],
            vec![5, 2, 0],
            vec![6, 6, 3],
            vec![7, 0, 2],
        ]
    );
    assert_eq!(
        structural_probe.composition_countermodel.premise_p,
        vec![3, 0, 1]
    );
    assert_eq!(
        structural_probe.composition_countermodel.premise_q,
        vec![4, 1, 2]
    );
    assert_eq!(
        structural_probe.composition_countermodel.proposed_result,
        vec![7, 0, 2]
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .distinct_link_identities
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .premise_link_identities_distinct_from_references
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .premise_reference_addresses_pairwise_distinct
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .direct_self_incidence
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .shared_address_incidence
    );
    assert!(
        structural_probe
            .composition_countermodel
            .common_facts
            .recursive_link_references
    );
    assert!(
        structural_probe
            .composition_countermodel
            .premises_hold_in_both
    );
    assert!(
        structural_probe
            .composition_countermodel
            .reverse_pair_already_present
    );
    assert!(
        structural_probe
            .composition_countermodel
            .proposed_result_absent_in_first
    );
    assert!(
        structural_probe
            .composition_countermodel
            .proposed_result_present_in_second
    );
    assert_eq!(
        structural_probe
            .formation_probe
            .ordered_pairs_using_existing_addresses,
        49
    );
    assert_eq!(
        structural_probe.formation_probe.existing_addresses,
        vec![0, 1, 2, 3, 4, 5, 6]
    );
    assert_eq!(
        structural_probe.formation_probe.proposed_reference_pair,
        vec![0, 2]
    );
    assert!(
        structural_probe
            .formation_probe
            .every_formation_extension_preserves_premises
    );
    assert!(
        !structural_probe
            .formation_probe
            .composition_specific_selection_from_formation_only
    );
    assert!(structural_probe
        .claim_boundary
        .contains("additional selection/closure law"));
    let authority_probe = &starting_representation.link_carried_selection_authority;
    assert_eq!(
        authority_probe.status,
        "LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY"
    );
    assert_eq!(
        authority_probe.records.premises,
        vec![vec![3, 0, 1], vec![4, 1, 2]]
    );
    assert_eq!(
        authority_probe.records.candidates,
        vec![vec![7, 0, 2], vec![8, 0, 2]]
    );
    assert_eq!(authority_probe.records.additional_link, vec![9, 7, 7]);
    assert_eq!(
        authority_probe.records.incidence_readout_provenance,
        "EXPERIMENTAL_EQUAL-REFERENCE_OBSERVATION_NOT_INTRINSIC_AUTHORITY"
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .without_additional_link
            .candidate_automorphisms,
        vec![vec![0, 1], vec![1, 0]]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .without_additional_link
            .candidate_orbit_sizes,
        vec![2]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .without_additional_link
            .invariant_candidate_subsets,
        vec![vec![], vec![7, 8]]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .without_additional_link
            .invariant_singleton_selections,
        0
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .with_additional_link
            .candidate_automorphisms,
        vec![vec![0, 1]]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .with_additional_link
            .candidate_orbit_sizes,
        vec![1, 1]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .with_additional_link
            .invariant_candidate_subsets,
        vec![vec![], vec![7], vec![8], vec![7, 8]]
    );
    assert_eq!(
        authority_probe
            .equivariant_selection_constraint
            .with_additional_link
            .invariant_singleton_selections,
        2
    );
    assert!(
        authority_probe
            .equivariant_selection_constraint
            .singleton_selection_made_possible
    );
    assert!(
        !authority_probe
            .equivariant_selection_constraint
            .singleton_selection_forced
    );
    assert_eq!(
        authority_probe
            .opposite_equivariant_readings
            .iter()
            .map(|reading| (
                reading.id,
                reading.selected_candidates.clone(),
                reading.address_renaming_equivariant,
            ))
            .collect::<Vec<_>>(),
        vec![
            ("referenced-candidate", vec![7], true),
            ("unreferenced-candidate", vec![8], true),
        ]
    );
    assert!(authority_probe
        .perturbations
        .removal
        .marked_candidates
        .is_empty());
    assert_eq!(
        authority_probe.perturbations.replacement.marked_candidates,
        vec![8]
    );
    assert_eq!(
        authority_probe.perturbations.duplication.marked_candidates,
        vec![7, 8]
    );
    assert!(!authority_probe.perturbations.duplication.unique);
    assert!(!authority_probe.perturbations.forgery.structurally_rejected);
    assert!(
        authority_probe
            .perturbations
            .context_relocation
            .same_under_context_address_renaming
    );
    assert!(
        authority_probe
            .recursive_authority
            .finite_chain_candidate_swap_preserves_shape
    );
    assert!(
        authority_probe
            .recursive_authority
            .self_reference_closes_address_cycle
    );
    assert!(
        authority_probe
            .recursive_authority
            .self_referential_candidate_swap_preserves_shape
    );
    assert!(
        authority_probe
            .recursive_authority
            .selection_polarity_still_underdetermined
    );
    assert_eq!(
        (
            authority_probe.distinctions.formation,
            authority_probe.distinctions.selection,
            authority_probe.distinctions.justification,
            authority_probe.distinctions.activation,
            authority_probe.distinctions.applicability,
            authority_probe.distinctions.execution,
        ),
        (
            "BOTH_CANDIDATE_LINKS_EXIST",
            "NOT_FORCED_TWO_OPPOSITE_EQUIVARIANT_READINGS",
            "ISOMORPHIC_FORGERY_NOT_REJECTED",
            "NO_LINK_DERIVED_ADMISSION_VALIDATION_OR_ACTIVATION",
            "AMBIENT_EXISTENCE_DOES_NOT_SELECT_APPLICABILITY",
            "NO_TRANSITION_CREATION_OR_PUBLICATION_EVENT",
        )
    );
    assert!(authority_probe
        .claim_boundary
        .contains("does not prove that external authority is irreducible"));
    let admissibility_probe = &starting_representation.linked_structural_admissibility;
    assert_eq!(
        admissibility_probe.status,
        "LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING"
    );
    assert_eq!(
        admissibility_probe.contract.verification_provenance,
        "EXTERNAL_FINITE_RELATIONAL_CHECK_NOT_LINK_DERIVED_AUTHORITY"
    );
    assert_eq!(
        admissibility_probe
            .cases
            .iter()
            .map(|item| (
                item.id,
                item.cardinality,
                item.admissible_candidates.clone(),
            ))
            .collect::<Vec<_>>(),
        vec![
            ("valid-complete-evidence", "ONE", vec![7]),
            ("missing-evidence", "ZERO", vec![]),
            ("duplicate-evidence", "ZERO", vec![]),
            ("foreign-evidence", "ZERO", vec![]),
            ("wrong-decomposition", "ZERO", vec![]),
            ("two-equally-admissible-candidates", "MANY", vec![7, 8]),
            ("zero-admissible-candidates", "ZERO", vec![]),
            ("same-candidate-other-context", "ZERO", vec![]),
            ("context-relocated-evidence", "ONE", vec![7]),
            ("replacement-description", "ONE", vec![8]),
        ]
    );
    assert_eq!(
        admissibility_probe
            .cardinality_audit
            .observed_classifications,
        vec!["ZERO", "ONE", "MANY"]
    );
    assert!(
        !admissibility_probe
            .adversarial_boundary
            .forged_locally_isomorphic_candidate_rejected
    );
    assert!(
        admissibility_probe
            .authority_regress
            .description_represented_as_links
    );
    assert!(
        !admissibility_probe
            .authority_regress
            .description_authenticated_by_structure
    );
    assert!(admissibility_probe
        .claim_boundary
        .contains("conditional on the observer-supplied verifier and role assignment"));
    let verifier_step = &starting_representation.linked_verifier_step;
    assert_eq!(
        verifier_step.status,
        "LOCAL_MATCH_HAS_LINKED_TRACE_BUT_RETAINS_HOST_EXECUTION_BOUNDARY"
    );
    assert_eq!(
        verifier_step
            .cases
            .iter()
            .map(|item| (item.id, item.cardinality, item.trace_records.len()))
            .collect::<Vec<_>>(),
        vec![
            ("complete-local-match", "ONE", 4),
            ("missing-description-record", "ZERO", 0),
            ("missing-mapping", "ZERO", 0),
            ("duplicate-mapping", "MANY", 8),
            ("reversed-concrete-record", "ZERO", 0),
            ("two-concrete-records", "MANY", 8),
            ("self-application", "ONE", 4),
        ]
    );
    assert_eq!(
        verifier_step.cases[0].trace_records,
        vec![
            vec![200, 40, 3],
            vec![201, 200, 50],
            vec![202, 200, 51],
            vec![203, 200, 52]
        ]
    );
    assert_eq!(
        verifier_step.trace_replay_records,
        vec![
            vec![200, 40, 3],
            vec![801, 200, 200],
            vec![802, 40, 40],
            vec![803, 3, 3]
        ]
    );
    assert_eq!(
        verifier_step.removal_tests.reversed_mapping_reading,
        "ZERO_FOR_SAME_LINKS"
    );
    assert_eq!(
        verifier_step.removal_tests.no_cardinality_classification,
        "TRACE_EXISTS_CLASSIFICATION_UNAVAILABLE"
    );
    assert_eq!(
        verifier_step.removal_tests.self_application_cardinality,
        "ONE"
    );
    assert!(verifier_step.removal_tests.trace_replay_by_same_join);
    assert_eq!(
        verifier_step
            .removal_tests
            .alternate_description_on_same_links,
        "ZERO_WHILE_SELECTED_DESCRIPTION_IS_ONE"
    );
    assert_eq!(
        verifier_step.boundaries.execution,
        "HOST_ITERATION_PROJECTION_EQUALITY_AND_BRANCHING_REMAIN"
    );
    assert_eq!(
        verifier_step.boundaries.semantic_authority,
        "ACTIVE_DESCRIPTION_AND_MAPPING_ROLE_NOT_LINK_AUTHORIZED"
    );
    assert_eq!(
        starting_representation
            .quotient_audit
            .finite_enumeration
            .iter()
            .map(|item| (
                item.occurrence_count,
                item.ordered_equality_classes_after_address_renaming,
                item.unlabelled_addressable_classes,
                item.classes_collapsed_by_occurrence_permutation,
            ))
            .collect::<Vec<_>>(),
        vec![(1, 2, 2, 0), (2, 5, 4, 1), (3, 15, 7, 8), (4, 52, 12, 40)]
    );
    assert!(
        starting_representation
            .quotient_audit
            .address_renaming_complete_invariant_verified
    );
    assert_eq!(
        starting_representation
            .quotient_audit
            .transformations
            .iter()
            .map(|item| (item.transformation, item.classification))
            .collect::<Vec<_>>(),
        vec![
            (
                "global address renaming",
                "DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT",
            ),
            (
                "reference-occurrence permutation",
                "UNESTABLISHED_EQUIVALENCE",
            ),
        ]
    );
    let permutation_countermodel = &starting_representation
        .quotient_audit
        .occurrence_permutation_countermodel;
    assert_eq!(
        permutation_countermodel.first_ordered_pattern,
        vec![0, 0, 1]
    );
    assert_eq!(
        permutation_countermodel.second_ordered_pattern,
        vec![0, 1, 0]
    );
    assert!(!permutation_countermodel.same_under_address_renaming_alone);
    assert!(permutation_countermodel.same_after_occurrence_permutation);
    assert_eq!(
        permutation_countermodel.interpretation,
        "DISTINGUISHABLE_ONLY_IF_REFERENCE_SLOTS_HAVE_IDENTITY"
    );
    assert_eq!(
        starting_representation
            .quotient_audit
            .minimal_faithful_descriptor
            .status,
        "COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT"
    );
    assert_eq!(
        starting_representation
            .quotient_audit
            .minimal_faithful_descriptor
            .fields,
        vec![
            "referenceMultiplicitySpectrum",
            "directSelfReferenceMultiplicity",
        ]
    );
    assert!(
        starting_representation
            .quotient_audit
            .minimal_faithful_descriptor
            .finite_enumeration_agreement
    );
    assert_eq!(
        starting_representation
            .quotient_audit
            .occurrence_permutation_intrinsic,
        "UNRESOLVED"
    );
    assert_eq!(
        boundary
            .loss_audit
            .iter()
            .map(|item| (item.distinction, item.classification))
            .collect::<Vec<_>>(),
        vec![
            (
                "reference names",
                "DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT"
            ),
            ("occurrence order", "UNESTABLISHED_EQUIVALENCE"),
            ("width beyond two occurrences", "PROVEN_INFORMATION_LOSS"),
            ("second equivalence observation", "PROVEN_NOT_RECOVERABLE"),
            (
                "direct self-reference",
                "PROVEN_INFORMATION_LOSS_FOR_ADDRESSABLE_LINKS"
            ),
            (
                "self-incidence reference slot",
                "RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT"
            ),
            (
                "cross-link address incidence",
                "PROVEN_INFORMATION_LOSS_UNDER_LOCAL_PROJECTION"
            ),
            (
                "application and composition meaning",
                "PROVEN_NOT_ENTAILED_BY_TESTED_LINK_STRUCTURE"
            ),
            (
                "selection authority from additional linked incidence",
                "ASYMMETRY_PERMITS_BUT_DOES_NOT_FORCE_SELECTION"
            ),
            (
                "admissibility from linked descriptions and evidence",
                "STRUCTURAL_CERTIFICATES_FILTER_RELATIVE_TO_EXTERNAL_VERIFIER"
            ),
            ("endpoint direction", "NOT_OBSERVED_NOT_DISPROVED"),
            ("dynamics and time", "NOT_OBSERVED_NOT_DISPROVED"),
        ]
    );
    assert!(report.results.iter().any(|item| {
        item.id == "fixed-binary-observation-sufficiency"
            && item.result == "INSUFFICIENT_OUTSIDE_FIXED_ARITY"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "conditional-structural-asymmetry"
            && item.result == "EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "conditional-interaction-forcedness"
            && item.result == "SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "addressable-quotient-assumptions"
            && item.result == "RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "shared-address-composition"
            && item.result == "LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "structural-application-composition"
            && item.result == "RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "link-carried-selection-authority"
            && item.result == "LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY"
    }));
    assert!(report.results.iter().any(|item| {
        item.id == "linked-structural-admissibility"
            && item.result
                == "LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING"
    }));
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
