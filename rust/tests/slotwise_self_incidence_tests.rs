use rml::linked_program::{link_ontology_symmetry_report, self_incidence_by_reference_slot};

#[test]
fn classifies_every_boolean_self_incidence_mask_through_eight_ordered_slots() {
    for width in 0..=8 {
        for bits in 0..(1 << width) {
            let expected: Vec<bool> = (0..width).map(|slot| bits & (1 << slot) != 0).collect();
            let record: Vec<usize> = std::iter::once(17)
                .chain(
                    expected
                        .iter()
                        .enumerate()
                        .map(|(slot, self_ref)| if *self_ref { 17 } else { 100 + slot }),
                )
                .collect();
            assert_eq!(self_incidence_by_reference_slot(&record), expected);
        }
    }
}

#[test]
fn preserves_each_slot_classification_under_injective_address_renaming() {
    let record = [13, 13, 0, 28, 13, 0];
    let expected = vec![true, false, false, true, false];
    assert_eq!(self_incidence_by_reference_slot(&record), expected);
    assert_eq!(
        self_incidence_by_reference_slot(&record.map(|address| format!("address-{address}"))),
        expected
    );
    assert_eq!(
        self_incidence_by_reference_slot(&record.map(|address| 200 - 3 * address)),
        expected
    );
}

#[test]
fn classifies_wide_record_arities_without_a_binary_slot_assumption() {
    let expected: Vec<bool> = (0..4096).map(|slot| slot % 7 == 0).collect();
    let record: Vec<usize> = std::iter::once(9)
        .chain(
            expected
                .iter()
                .enumerate()
                .map(|(slot, self_ref)| if *self_ref { 9 } else { 100 + slot }),
        )
        .collect();
    assert_eq!(self_incidence_by_reference_slot(&record), expected);
}

#[test]
fn rejects_replacing_ordered_slot_incidence_with_only_a_self_reference_count() {
    let first = self_incidence_by_reference_slot(&[4, 4, 8]);
    let second = self_incidence_by_reference_slot(&[4, 8, 4]);
    assert_eq!(
        first.iter().filter(|value| **value).count(),
        second.iter().filter(|value| **value).count()
    );
    assert_ne!(first, second);
    assert_eq!(second, first.into_iter().rev().collect::<Vec<_>>());
}

#[test]
fn rejects_noninjective_renaming_as_an_incidence_preserving_equivalence() {
    assert_ne!(
        self_incidence_by_reference_slot(&[4, 8, 4]),
        self_incidence_by_reference_slot(&[4, 4, 4])
    );
}

#[test]
fn rejects_a_record_without_a_link_address() {
    let failure = std::panic::catch_unwind(|| self_incidence_by_reference_slot::<usize>(&[]))
        .expect_err("a missing link address must be rejected");
    let message = failure
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| failure.downcast_ref::<&str>().copied());
    assert_eq!(message, Some("self-incidence requires a link address"));
}

#[test]
fn retains_the_ordered_equality_contract_and_rejects_inferred_slot_roles() {
    let audit = link_ontology_symmetry_report()
        .observation_boundary
        .starting_representation_audit
        .slotwise_self_incidence;
    assert_eq!(
        audit
            .finite_enumeration
            .iter()
            .map(|row| row.self_incidence_patterns)
            .collect::<Vec<_>>(),
        vec![2, 4, 8, 16]
    );
    assert!(
        audit
            .ordered_faithful_descriptor
            .finite_enumeration_agreement
    );
    assert!(audit.occurrence_permutation_equivariant_verified);
    assert!(!audit.occurrence_permutation_invariant);
    assert!(audit.claim_boundary.contains("does not establish"));
    assert!(audit.claim_boundary.contains("intrinsic"));
    assert!(audit.claim_boundary.contains("assign endpoint roles"));
    assert!(audit.claim_boundary.contains("dynamics or execution"));
}
