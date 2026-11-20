use rml::linked_program::{
    link_ontology_symmetry_report, linked_certificate_candidates, self_incidence_by_reference_slot,
    LinkOntologyStartingRepresentationAudit,
};
use serde_json::Value;
use std::sync::OnceLock;

fn audit() -> &'static LinkOntologyStartingRepresentationAudit {
    static AUDIT: OnceLock<LinkOntologyStartingRepresentationAudit> = OnceLock::new();
    AUDIT.get_or_init(|| {
        link_ontology_symmetry_report()
            .observation_boundary
            .starting_representation_audit
    })
}

fn fixture(id: &str) -> Value {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../test-corpus/foundation-structural-evidence/certificates.json"
    ))
    .unwrap();
    corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
        .unwrap()
        .clone()
}
fn evaluate(item: &Value) -> Vec<usize> {
    let description: Vec<Vec<usize>> = serde_json::from_value(item["description"].clone()).unwrap();
    let records: Vec<Vec<usize>> = serde_json::from_value(item["records"].clone()).unwrap();
    let candidates: Vec<usize> =
        serde_json::from_value(item["candidateAddresses"].clone()).unwrap();
    linked_certificate_candidates(
        &description,
        &records,
        &candidates,
        item["contextAddress"].as_u64().unwrap() as usize,
    )
}

#[test]
fn r128_preserves_address_identity_direct_self_incidence_arity_and_ordered_quotient_counts() {
    let audit = audit();
    assert_eq!(
        audit
            .quotient_audit
            .finite_enumeration
            .iter()
            .map(|row| (
                row.occurrence_count,
                row.ordered_equality_classes_after_address_renaming,
                row.unlabelled_addressable_classes,
                row.classes_collapsed_by_occurrence_permutation
            ))
            .collect::<Vec<_>>(),
        vec![(1, 2, 2, 0), (2, 5, 4, 1), (3, 15, 7, 8), (4, 52, 12, 40)]
    );
    assert!(
        audit
            .quotient_audit
            .address_renaming_complete_invariant_verified
    );
    let witness = &audit.countermodel;
    assert_eq!(
        witness.direct_self_link.normalized_address_pattern,
        vec![0, 0, 1]
    );
    assert_eq!(
        witness.fresh_external_link.normalized_address_pattern,
        vec![0, 1, 2]
    );
    assert_eq!(witness.direct_self_link.direct_self_reference_count, 1);
    assert_eq!(witness.fresh_external_link.direct_self_reference_count, 0);
    for width in [0, 1, 2, 4, 19] {
        let record = vec![83; width + 1];
        assert_eq!(self_incidence_by_reference_slot(&record).len(), width);
        assert!(self_incidence_by_reference_slot(&record)
            .iter()
            .all(|value| *value));
    }
    assert!(
        audit
            .slotwise_self_incidence
            .ordered_faithful_descriptor
            .finite_enumeration_agreement
    );
}

#[test]
fn r128_rejects_erasing_direct_self_incidence_or_silently_quotienting_ordered_slots() {
    let audit = audit();
    assert!(audit.countermodel.same_reference_only_projection);
    assert!(!audit.countermodel.same_addressable_link_class);
    assert!(!audit.reference_only_projection_faithful);
    let quotient = &audit.quotient_audit;
    let countermodel = &quotient.occurrence_permutation_countermodel;
    assert_eq!(countermodel.first_ordered_pattern, vec![0, 0, 1]);
    assert_eq!(countermodel.second_ordered_pattern, vec![0, 1, 0]);
    assert!(!countermodel.same_under_address_renaming_alone);
    assert!(countermodel.same_after_occurrence_permutation);
    assert_ne!(
        self_incidence_by_reference_slot(&countermodel.first_ordered_pattern),
        self_incidence_by_reference_slot(&countermodel.second_ordered_pattern)
    );
    assert_eq!(
        quotient
            .transformations
            .iter()
            .map(|row| row.classification)
            .collect::<Vec<_>>(),
        vec![
            "DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT",
            "UNESTABLISHED_EQUIVALENCE"
        ]
    );
    assert_eq!(quotient.occurrence_permutation_intrinsic, "UNRESOLVED");
    for boundary in [
        "does not establish",
        "derive endpoint roles",
        "dynamics",
        "execution law",
    ] {
        assert!(audit.claim_boundary.contains(boundary));
    }
}

#[test]
fn r139_detects_cross_link_cycles_and_faithfully_enumerates_the_retained_shared_address_contract() {
    let shared = &audit().shared_address_composition;
    assert_eq!(
        shared
            .finite_enumeration
            .iter()
            .map(|row| (
                row.link_count,
                row.shared_address_classes,
                row.local_descriptor_classes,
                row.shared_descriptor_classes
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 2, 2, 2),
            (2, 10, 4, 10),
            (3, 77, 8, 77),
            (4, 799, 16, 799)
        ]
    );
    assert!(shared
        .finite_enumeration
        .iter()
        .all(|row| row.shared_descriptor_faithful));
    for row in &shared.finite_enumeration {
        assert_eq!(
            row.local_descriptor_fibre_histogram
                .iter()
                .map(|item| item.shared_address_classes * item.local_descriptor_classes)
                .sum::<usize>(),
            row.shared_address_classes
        );
    }
    assert_eq!(
        shared.countermodel.external_references,
        vec![vec![0, 1], vec![2, 3]]
    );
    assert_eq!(
        shared.countermodel.two_link_cycle,
        vec![vec![0, 2], vec![2, 0]]
    );
    assert_eq!(shared.countermodel.external_references_cycle_length, 0);
    assert_eq!(shared.countermodel.two_link_cycle_length, 2);
}

#[test]
fn r139_rejects_local_descriptor_completeness_and_leaves_retained_assumptions_uneliminated() {
    let shared = &audit().shared_address_composition;
    assert!(shared.countermodel.same_local_descriptors);
    assert!(!shared.countermodel.same_shared_address_class);
    assert!(!shared.local_descriptors_faithful_at_every_tested_multi_link_width);
    assert_eq!(
        shared
            .finite_enumeration
            .iter()
            .map(|row| row.local_descriptors_faithful)
            .collect::<Vec<_>>(),
        vec![true, false, false, false]
    );
    assert_eq!(
        shared.retained_assumptions,
        vec![
            "finite ordered link records",
            "one ordered reference slot per link",
            "distinct link addresses in one shared address space",
            "address equality is the only observation"
        ]
    );
    for text in ["order", "finite", "one reference slot"] {
        assert!(shared
            .assumption_classification
            .introduced_by_observer
            .contains(text));
    }
    for text in ["not a source", "execution edge"] {
        assert!(shared
            .assumption_classification
            .semantics_not_assigned
            .contains(text));
    }
}

#[test]
fn r140_preserves_every_stated_structural_premise_in_the_exact_conservative_extension() {
    let probe = &audit().structural_application_composition;
    let pair = &probe.composition_countermodel;
    assert_eq!(
        pair.without_proposed_result,
        vec![vec![3, 0, 1], vec![4, 1, 2], vec![5, 2, 0], vec![6, 6, 3]]
    );
    let mut extension = pair.without_proposed_result.clone();
    extension.push(vec![7, 0, 2]);
    assert_eq!(pair.with_proposed_result, extension);
    let facts = &pair.common_facts;
    assert!(
        facts.distinct_link_identities
            && facts.premise_link_identities_distinct_from_references
            && facts.premise_reference_addresses_pairwise_distinct
            && facts.direct_self_incidence
            && facts.shared_address_incidence
            && facts.recursive_link_references
    );
    assert!(pair.premises_hold_in_both);
    assert!(pair.reverse_pair_already_present);
    assert_eq!(
        probe.formation_probe.existing_addresses,
        vec![0, 1, 2, 3, 4, 5, 6]
    );
    assert_eq!(
        probe.formation_probe.ordered_pairs_using_existing_addresses,
        49
    );
    assert!(
        probe
            .formation_probe
            .every_formation_extension_preserves_premises
    );
}

#[test]
fn r140_rejects_deriving_composition_or_semantic_roles_from_formability_and_slot_order() {
    let probe = &audit().structural_application_composition;
    assert!(
        probe
            .composition_countermodel
            .proposed_result_absent_in_first
    );
    assert!(
        probe
            .composition_countermodel
            .proposed_result_present_in_second
    );
    assert!(
        !probe
            .formation_probe
            .composition_specific_selection_from_formation_only
    );
    assert_eq!(probe.role_recovery.unordered_leaf_orbit_sizes, vec![1, 2]);
    assert_eq!(probe.role_recovery.semantic_assignments_for_three_leaves, 6);
    assert!(!probe.role_recovery.ordered_positions_select_semantic_roles);
    assert!(!probe.role_recovery.all_four_semantic_roles_recovered);
    assert!(!probe.candidate_encodings.same_under_address_renaming_alone);
    assert!(
        probe
            .candidate_encodings
            .same_after_uniform_slot_reversal_and_address_renaming
    );
    assert!(probe
        .claim_boundary
        .contains("additional selection/closure law"));
    assert!(probe.claim_boundary.contains("authority"));
}

#[test]
fn r141_computes_symmetry_breaking_and_every_specified_evidence_perturbation() {
    let probe = &audit().link_carried_selection_authority;
    let symmetry = &probe.equivariant_selection_constraint;
    assert_eq!(
        symmetry.without_additional_link.candidate_automorphisms,
        vec![vec![0, 1], vec![1, 0]]
    );
    assert_eq!(
        symmetry.with_additional_link.candidate_automorphisms,
        vec![vec![0, 1]]
    );
    assert_eq!(
        symmetry.without_additional_link.candidate_orbit_sizes,
        vec![2]
    );
    assert_eq!(
        symmetry.with_additional_link.candidate_orbit_sizes,
        vec![1, 1]
    );
    assert!(probe.perturbations.removal.marked_candidates.is_empty());
    assert_eq!(probe.perturbations.replacement.marked_candidates, vec![8]);
    assert_eq!(
        probe.perturbations.duplication.marked_candidates,
        vec![7, 8]
    );
    assert!(
        probe
            .perturbations
            .context_relocation
            .same_under_context_address_renaming
    );
    assert!(
        probe
            .recursive_authority
            .finite_chain_candidate_swap_preserves_shape
    );
    assert!(
        probe
            .recursive_authority
            .self_referential_candidate_swap_preserves_shape
    );
}

#[test]
fn r141_rejects_asymmetry_isomorphic_evidence_and_recursive_marks_as_selection_authority() {
    let probe = &audit().link_carried_selection_authority;
    let symmetry = &probe.equivariant_selection_constraint;
    assert_eq!(
        symmetry
            .without_additional_link
            .invariant_singleton_selections,
        0
    );
    assert_eq!(
        symmetry.with_additional_link.invariant_singleton_selections,
        2
    );
    assert!(symmetry.singleton_selection_made_possible);
    assert!(!symmetry.singleton_selection_forced);
    assert_eq!(
        probe
            .opposite_equivariant_readings
            .iter()
            .map(|row| (
                row.selected_candidates.clone(),
                row.address_renaming_equivariant
            ))
            .collect::<Vec<_>>(),
        vec![(vec![7], true), (vec![8], true)]
    );
    assert!(!probe.perturbations.forgery.structurally_rejected);
    assert!(
        !probe
            .perturbations
            .context_relocation
            .ambient_existence_selects_active_context
    );
    assert!(
        probe
            .recursive_authority
            .selection_polarity_still_underdetermined
    );
    assert!(probe
        .claim_boundary
        .contains("does not prove that external authority is irreducible"));
}

#[test]
fn r142_accepts_exact_cover_certificates_under_renaming_and_record_reordering() {
    let original = fixture("complete");
    assert_eq!(evaluate(&original), vec![207]);
    let mut reordered = original.clone();
    reordered["records"].as_array_mut().unwrap().reverse();
    assert_eq!(evaluate(&reordered), vec![207]);
    let mut renamed = original.clone();
    for key in ["records", "description"] {
        for record in renamed[key].as_array_mut().unwrap() {
            for address in record.as_array_mut().unwrap() {
                *address = Value::from(7 * address.as_u64().unwrap() + 31);
            }
        }
    }
    for address in renamed["candidateAddresses"].as_array_mut().unwrap() {
        *address = Value::from(7 * address.as_u64().unwrap() + 31);
    }
    renamed["contextAddress"] = Value::from(7 * original["contextAddress"].as_u64().unwrap() + 31);
    assert_eq!(evaluate(&renamed), vec![7 * 207 + 31]);
    assert_eq!(original, fixture("complete"));
}

#[test]
fn r142_rejects_incomplete_foreign_duplicate_malformed_and_noninjective_evidence() {
    for id in [
        "missing",
        "duplicate",
        "foreign",
        "wrong-decomposition",
        "zero-domain",
        "malformed-record",
        "duplicate-record-address",
        "dangling-member",
        "missing-description",
        "noninjective-target",
    ] {
        assert!(evaluate(&fixture(id)).is_empty(), "{id}");
    }
}

#[test]
fn r142_distinguishes_context_applicability_and_replacement_descriptions_using_live_records() {
    for id in ["other-context", "relocated", "replaced-description"] {
        let item = fixture(id);
        let expected: Vec<usize> = serde_json::from_value(item["expected"].clone()).unwrap();
        assert_eq!(evaluate(&item), expected, "{id}");
    }
    assert_eq!(evaluate(&fixture("complete")), vec![207]);
}

#[test]
fn r142_rejects_uniqueness_when_two_locally_isomorphic_certificates_are_admissible() {
    assert_eq!(evaluate(&fixture("many")), vec![207, 208]);
    let probe = &audit().linked_structural_admissibility;
    assert!(
        !probe
            .adversarial_boundary
            .forged_locally_isomorphic_candidate_rejected
    );
    assert!(
        !probe
            .cardinality_audit
            .classification_derived_inside_link_substrate
    );
    assert!(
        !probe
            .authority_regress
            .description_authenticated_by_structure
    );
    assert!(
        !probe
            .authority_regress
            .observer_role_assignment_authorized_by_structure
    );
    assert!(
        !probe
            .authority_regress
            .verifier_represented_or_executed_by_tested_records
    );
    assert!(
        !probe
            .authority_regress
            .finite_linked_meta_chain_closes_authority_regress
    );
}
