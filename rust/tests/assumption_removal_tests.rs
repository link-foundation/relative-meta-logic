//! Mirrors experiments/assumption-removal/matrix.mjs and
//! js/tests/assumption-removal.test.mjs: one retained assumption of the
//! repaired addressed representation removed at a time, by exhaustive finite
//! enumeration.
use rml::linked_program::link_ontology_symmetry_report;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const REPORT: &str = include_str!("../../test-corpus/assumption-removal/report.json");

type Records = Vec<Vec<usize>>;

fn restricted_growth(width: usize, visit: &mut dyn FnMut(&[usize])) {
    fn extend(value: &mut Vec<usize>, index: usize, maximum: usize, visit: &mut dyn FnMut(&[usize])) {
        if index == value.len() {
            visit(value.as_slice());
            return;
        }
        for next in 0..=maximum + 1 {
            value[index] = next;
            extend(value, index + 1, maximum.max(next), visit);
        }
    }
    let mut value = vec![0; width];
    if width == 0 {
        visit(value.as_slice());
        return;
    }
    extend(&mut value, 1, 0, visit);
}
fn normalize(sequence: &[usize]) -> Vec<usize> {
    let mut names = BTreeMap::new();
    sequence
        .iter()
        .map(|item| {
            let next = names.len();
            *names.entry(*item).or_insert(next)
        })
        .collect()
}
fn text(records: &[Vec<usize>]) -> String {
    let flat = records.concat();
    normalize(&flat).iter().map(|value| value.to_string()).collect::<Vec<_>>().join(",")
}
fn split(flat: &[usize], arities: &[usize]) -> Records {
    let mut records = Vec::new();
    let mut offset = 0;
    for arity in arities {
        records.push(flat[offset..offset + arity + 1].to_vec());
        offset += arity + 1;
    }
    records
}
fn permutations(count: usize) -> Vec<Vec<usize>> {
    if count == 0 {
        return vec![vec![]];
    }
    let mut output = Vec::new();
    for order in permutations(count - 1) {
        for index in 0..=order.len() {
            let mut next = order[..index].to_vec();
            next.push(count - 1);
            next.extend_from_slice(&order[index..]);
            output.push(next);
        }
    }
    output
}
fn flip(record: &[usize]) -> Vec<usize> {
    vec![record[0], record[2], record[1]]
}
fn minimum(values: Vec<String>) -> String {
    values.into_iter().min().unwrap()
}
fn distinct_addresses(records: &Records) -> bool {
    records.iter().map(|record| record[0]).collect::<BTreeSet<_>>().len() == records.len()
}

fn base_classes(count: usize, arity: usize) -> Vec<Records> {
    let arities = vec![arity; count];
    let mut classes = Vec::new();
    restricted_growth(count * (arity + 1), &mut |flat| {
        let records = split(flat, &arities);
        if distinct_addresses(&records) {
            classes.push(records);
        }
    });
    classes
}

fn removal_key(id: &str, count: usize) -> Box<dyn Fn(&Records) -> String> {
    let orders = permutations(count);
    match id {
        "ordered-link-records" => Box::new(move |records: &Records| {
            minimum(
                orders
                    .iter()
                    .map(|order| text(&order.iter().map(|index| records[*index].clone()).collect::<Vec<_>>()))
                    .collect(),
            )
        }),
        "ordered-reference-slots" => Box::new(move |records: &Records| {
            minimum(
                (0..1usize << count)
                    .map(|mask| {
                        text(
                            &records
                                .iter()
                                .enumerate()
                                .map(|(index, item)| if (mask >> index) & 1 == 1 { flip(item) } else { item.clone() })
                                .collect::<Vec<_>>(),
                        )
                    })
                    .collect(),
            )
        }),
        "slot-orientation" => Box::new(|records: &Records| {
            minimum(vec![text(records), text(&records.iter().map(|item| flip(item)).collect::<Vec<_>>())])
        }),
        other => panic!("unknown identifying removal {other}"),
    }
}
fn local(item: &[usize]) -> String {
    normalize(item).iter().map(|value| value.to_string()).collect::<String>()
}
fn local_key(id: &str) -> Box<dyn Fn(&Records) -> String> {
    match id {
        "none" => Box::new(|records: &Records| records.iter().map(|item| local(item)).collect::<Vec<_>>().join("|")),
        "ordered-link-records" => Box::new(|records: &Records| {
            let mut locals = records.iter().map(|item| local(item)).collect::<Vec<_>>();
            locals.sort();
            locals.join("|")
        }),
        "ordered-reference-slots" => Box::new(|records: &Records| {
            records
                .iter()
                .map(|item| minimum(vec![local(item), local(&flip(item))]))
                .collect::<Vec<_>>()
                .join("|")
        }),
        "slot-orientation" => Box::new(|records: &Records| {
            minimum(vec![
                records.iter().map(|item| local(item)).collect::<Vec<_>>().join("|"),
                records.iter().map(|item| local(&flip(item))).collect::<Vec<_>>().join("|"),
            ])
        }),
        other => panic!("unknown descriptor reading {other}"),
    }
}
fn locally_non_faithful(
    classes: &[Records],
    class_key: &dyn Fn(&Records) -> String,
    descriptor_key: &dyn Fn(&Records) -> String,
) -> bool {
    let mut fibres: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for records in classes {
        fibres.entry(descriptor_key(records)).or_default().insert(class_key(records));
    }
    fibres.values().any(|fibre| fibre.len() > 1)
}

fn identifying_row(id: &str, count: usize, arity: usize) -> Value {
    let classes = base_classes(count, arity);
    let key = removal_key(id, count);
    let mut first: BTreeMap<String, Records> = BTreeMap::new();
    let mut witness: Option<(Records, Records)> = None;
    for records in &classes {
        let orbit = key(records);
        match first.get(&orbit) {
            None => {
                first.insert(orbit, records.clone());
            }
            Some(earlier) => {
                if witness.is_none() {
                    witness = Some((earlier.clone(), records.clone()));
                }
            }
        }
    }
    let plain = |records: &Records| text(records);
    json!({
        "links": count,
        "slots": arity,
        "baseClasses": classes.len(),
        "classesAfterRemoval": first.len(),
        "direction": "IDENTIFIES",
        "identifiedClasses": classes.len() - first.len(),
        "firstWitness": witness.map(|(left, right)| json!([left, right])).unwrap_or(Value::Null),
        "localNonFaithfulnessBefore": locally_non_faithful(&classes, &plain, &*local_key("none")),
        "localNonFaithfulnessAfter": locally_non_faithful(&classes, &*key, &*local_key(id)),
    })
}
fn distinct_address_row(count: usize, arity: usize) -> Value {
    let mut all = 0usize;
    let mut witness: Option<Records> = None;
    let arities = vec![arity; count];
    restricted_growth(count * (arity + 1), &mut |flat| {
        all += 1;
        let records = split(flat, &arities);
        if witness.is_none() && !distinct_addresses(&records) {
            witness = Some(records);
        }
    });
    let base = base_classes(count, arity).len();
    json!({
        "links": count, "slots": arity, "baseClasses": base, "classesAfterRemoval": all,
        "direction": "SEPARATES", "addedClasses": all - base,
        "firstWitness": witness.map(|records| json!([records])).unwrap_or(Value::Null),
    })
}
fn mixed_arity_row(count: usize) -> Value {
    let mut all = 0usize;
    let mut witness: Option<Records> = None;
    for mask in 0..1usize << count {
        let arities = (0..count).map(|index| if (mask >> index) & 1 == 1 { 2 } else { 1 }).collect::<Vec<_>>();
        let mixed = arities.iter().collect::<BTreeSet<_>>().len() > 1;
        restricted_growth(arities.iter().map(|arity| arity + 1).sum(), &mut |flat| {
            let records = split(flat, &arities);
            if !distinct_addresses(&records) {
                return;
            }
            all += 1;
            if witness.is_none() && mixed {
                witness = Some(records);
            }
        });
    }
    let base = base_classes(count, 1).len() + base_classes(count, 2).len();
    json!({
        "links": count, "slots": "1|2", "baseClasses": base, "classesAfterRemoval": all,
        "direction": "SEPARATES", "addedClasses": all - base,
        "firstWitness": witness.map(|records| json!([records])).unwrap_or(Value::Null),
    })
}
fn observer_order_row(count: usize, arity: usize) -> Value {
    let classes = base_classes(count, arity);
    let factorial = |value: usize| (1..=value).product::<usize>();
    let after: usize = classes
        .iter()
        .map(|records| factorial(records.concat().iter().collect::<BTreeSet<_>>().len()))
        .sum();
    let witness = classes
        .iter()
        .find(|records| records.concat().iter().collect::<BTreeSet<_>>().len() > 1);
    json!({
        "links": count, "slots": arity, "baseClasses": classes.len(), "classesAfterRemoval": after,
        "direction": "SEPARATES", "addedClasses": after - classes.len(),
        "firstWitness": witness.map(|records| json!([records])).unwrap_or(Value::Null),
    })
}

const ONE_SLOT: [usize; 4] = [1, 2, 3, 4];
const TWO_SLOTS: [usize; 3] = [1, 2, 3];

fn rows() -> Vec<(&'static str, Vec<Value>)> {
    let identifying = |id: &str, slots: &[usize]| -> Vec<Value> {
        let mut widths = Vec::new();
        if slots.contains(&1) {
            widths.extend(ONE_SLOT.iter().map(|count| identifying_row(id, *count, 1)));
        }
        if slots.contains(&2) {
            widths.extend(TWO_SLOTS.iter().map(|count| identifying_row(id, *count, 2)));
        }
        widths
    };
    let mut distinct = ONE_SLOT.iter().map(|count| distinct_address_row(*count, 1)).collect::<Vec<_>>();
    distinct.extend(TWO_SLOTS.iter().map(|count| distinct_address_row(*count, 2)));
    let mut ordered = ONE_SLOT.iter().map(|count| observer_order_row(*count, 1)).collect::<Vec<_>>();
    ordered.extend(TWO_SLOTS.iter().map(|count| observer_order_row(*count, 2)));
    vec![
        ("ordered-link-records", identifying("ordered-link-records", &[1, 2])),
        ("ordered-reference-slots", identifying("ordered-reference-slots", &[2])),
        ("slot-orientation", identifying("slot-orientation", &[2])),
        ("distinct-link-addresses", distinct),
        ("fixed-reference-arity", TWO_SLOTS.iter().map(|count| mixed_arity_row(*count)).collect()),
        ("equality-only-observation", ordered),
    ]
}

#[test]
fn the_removal_matrix_is_reproduced_exactly_and_starts_from_the_audited_base_contract() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    let computed = rows();
    let recorded_rows = recorded["rows"].as_array().unwrap();
    assert_eq!(computed.len(), recorded_rows.len());
    for ((id, widths), recorded_row) in computed.iter().zip(recorded_rows) {
        assert_eq!(recorded_row["id"], json!(id));
        assert_eq!(&Value::Array(widths.clone()), &recorded_row["widths"], "{id}");
    }
    let report = link_ontology_symmetry_report();
    let audit = &report.observation_boundary.starting_representation_audit.shared_address_composition;
    let one_slot_base = computed[0].1.iter().filter(|width| width["slots"] == json!(1))
        .map(|width| width["baseClasses"].as_u64().unwrap() as usize)
        .collect::<Vec<_>>();
    let audited = audit
        .finite_enumeration
        .iter()
        .map(|item| item.shared_address_classes)
        .collect::<Vec<_>>();
    assert_eq!(one_slot_base, audited);
}

#[test]
fn each_removal_identifies_or_separates_exactly_the_recorded_number_of_classes() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    let computed = rows();
    let after = |index: usize| -> Vec<u64> {
        computed[index].1.iter().map(|width| width["classesAfterRemoval"].as_u64().unwrap()).collect()
    };
    assert_eq!(after(0), vec![2, 7, 20, 61, 5, 85, 1855]);
    assert_eq!(after(1), vec![4, 66, 2406]);
    assert_eq!(after(2), vec![4, 85, 5328]);
    assert_eq!(after(3), vec![2, 15, 203, 4140, 5, 203, 21147]);
    assert_eq!(after(4), vec![7, 235, 17419]);
    assert_eq!(after(5), vec![3, 62, 3210, 310344, 13, 4142, 5544342]);
    let changes = computed.iter().all(|(_, widths)| {
        widths.iter().any(|width| width["classesAfterRemoval"] != width["baseClasses"])
    });
    let identifying = &computed[..3];
    let witnesses = identifying
        .iter()
        .all(|(_, widths)| widths.iter().any(|width| !width["firstWitness"].is_null()));
    let survives = identifying.iter().all(|(_, widths)| {
        widths
            .iter()
            .filter(|width| width["links"].as_u64().unwrap() >= 2)
            .all(|width| width["localNonFaithfulnessAfter"] == json!(true))
    });
    let orientation = computed[2].1.iter().zip(&computed[1].1).all(|(reversal, exchange)| {
        reversal["identifiedClasses"].as_u64().unwrap() <= exchange["identifiedClasses"].as_u64().unwrap()
    });
    assert_eq!(
        json!({
            "everyRemovalChangesSomeWidth": changes,
            "everyIdentifyingRemovalHasAWitness": witnesses,
            "localNonFaithfulnessSurvivesEveryIdentifyingRemovalFromTwoLinks": survives,
            "orientationRemovalIdentifiesLessThanSlotOrderRemoval": orientation,
        }),
        recorded["results"]
    );
}

#[test]
fn negative_controls_a_single_link_has_no_local_non_faithfulness_and_no_record_order_witness() {
    let single = identifying_row("ordered-link-records", 1, 1);
    assert!(single["firstWitness"].is_null());
    assert_eq!(single["localNonFaithfulnessBefore"], json!(false));
    assert!(distinct_address_row(1, 2)["firstWitness"].is_null());
    assert_eq!(identifying_row("ordered-reference-slots", 1, 2)["localNonFaithfulnessAfter"], json!(false));
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    assert!(recorded["claimBoundary"]
        .as_str()
        .unwrap()
        .contains("No assumption is thereby shown intrinsic or eliminable"));
}

// Mirrors experiments/assumption-removal/finiteness.mjs: finiteness removed by
// finitely presented affine one-slot structures.
const FINITENESS: &str = include_str!("../../test-corpus/assumption-removal/finiteness.json");
const PREFIX_BOUND: i64 = 32;
const DELETION_BOUND: i64 = 24;

struct Affine {
    id: &'static str,
    start: Option<i64>,
    step: i64,
}

const STRUCTURES: [Affine; 3] = [
    Affine { id: "forward-ray", start: Some(0), step: 1 },
    Affine { id: "backward-ray", start: Some(1), step: -1 },
    Affine { id: "two-sided-line", start: None, step: 1 },
];

fn embeddings(records: &[Vec<usize>], into: &[Vec<usize>]) -> Vec<Vec<usize>> {
    fn choose(
        index: usize,
        chosen: &mut Vec<usize>,
        records: &[Vec<usize>],
        into: &[Vec<usize>],
        found: &mut Vec<Vec<usize>>,
    ) {
        if index == records.len() {
            let mut image: BTreeMap<usize, usize> = BTreeMap::new();
            for (position, target) in chosen.iter().enumerate() {
                for slot in 0..2 {
                    let (from, to) = (records[position][slot], into[*target][slot]);
                    if image.get(&from).is_some_and(|existing| *existing != to) {
                        return;
                    }
                    image.insert(from, to);
                }
            }
            if image.values().collect::<BTreeSet<_>>().len() == image.len() {
                found.push(chosen.clone());
            }
            return;
        }
        for target in 0..into.len() {
            chosen.push(target);
            choose(index + 1, chosen, records, into, found);
            chosen.pop();
        }
    }
    let mut found = Vec::new();
    choose(0, &mut Vec::new(), records, into, &mut found);
    found
}

fn finite_control(widths: &[usize]) -> Value {
    Value::Array(
        widths
            .iter()
            .map(|&links| {
                let (mut structures, mut maps, mut non_surjective, mut invisible) = (0u64, 0u64, 0u64, 0u64);
                restricted_growth(links * 2, &mut |flat: &[usize]| {
                    let records: Records = (0..links).map(|index| flat[index * 2..index * 2 + 2].to_vec()).collect();
                    if records.iter().map(|record| record[0]).collect::<BTreeSet<_>>().len() != links {
                        return;
                    }
                    structures += 1;
                    for map in embeddings(&records, &records) {
                        maps += 1;
                        if map.iter().collect::<BTreeSet<_>>().len() != links {
                            non_surjective += 1;
                        }
                    }
                    for deleted in 0..links {
                        let rest: Records = records
                            .iter()
                            .enumerate()
                            .filter(|(index, _)| *index != deleted)
                            .map(|(_, record)| record.clone())
                            .collect();
                        if !embeddings(&records, &rest).is_empty() {
                            invisible += 1;
                        }
                    }
                });
                json!({
                    "links": links,
                    "structures": structures,
                    "selfEmbeddings": maps,
                    "nonSurjectiveSelfEmbeddings": non_surjective,
                    "invisibleDeletions": invisible,
                })
            })
            .collect(),
    )
}

fn affine_record(structure: &Affine, n: i64) -> [i64; 2] {
    [n, n + structure.step]
}

fn shift_certificate(structure: &Affine) -> Value {
    let offsets = [0, structure.step];
    let shifted = offsets.map(|offset| offset + 1);
    let successor = offsets.map(|offset| offset + 1);
    let commute = shifted == successor;
    match structure.start {
        Some(start) => {
            let address_start = start + structure.step.min(0);
            let tail_start = start + 1 + structure.step.min(0);
            json!({
                "map": "x -> x + 1",
                "injective": true,
                "recordsCommute": commute,
                "imageRecordStart": start + 1,
                "imageAddressStart": address_start + 1,
                "tailAddressStart": tail_start,
                "surjective": false,
                "identifiesWithProperSubstructure": commute && address_start + 1 == tail_start,
            })
        }
        None => json!({
            "map": "x -> x + 1",
            "injective": true,
            "recordsCommute": commute,
            "imageRecordStart": null,
            "imageAddressStart": null,
            "tailAddressStart": null,
            "surjective": true,
            "identifiesWithProperSubstructure": false,
        }),
    }
}

fn prefix_check(structure: &Affine, bound: i64, record_of: &dyn Fn(&Affine, i64) -> [i64; 2]) -> Value {
    let from = structure.start.unwrap_or(-bound);
    for length in 1..=bound {
        for n in from..from + length {
            let image = record_of(structure, n).map(|address| address + 1);
            if image != record_of(structure, n + 1) {
                return json!({ "bound": bound, "holds": false, "failure": { "length": length, "n": n } });
            }
        }
    }
    json!({ "bound": bound, "holds": true, "failure": null })
}

fn invariants(structure: &Affine, deleted: Option<i64>, radius: i64) -> (i64, i64) {
    let centre = deleted.or(structure.start).unwrap_or(0);
    let low = structure.start.unwrap_or(centre - radius);
    let high = centre.max(structure.start.unwrap_or(centre)) + radius;
    let first = low - if structure.start.is_none() { radius } else { 0 };
    let records: Vec<[i64; 2]> = (first..=high + radius)
        .filter(|n| Some(*n) != deleted)
        .map(|n| affine_record(structure, n))
        .collect();
    let links: BTreeSet<i64> = records.iter().map(|record| record[0]).collect();
    let referenced: BTreeSet<i64> = records.iter().map(|record| record[1]).collect();
    let lowest = match structure.start {
        None => low,
        Some(start) => start + structure.step.min(0),
    };
    let (mut atoms, mut unreferenced) = (0, 0);
    for address in lowest..=high {
        if referenced.contains(&address) && !links.contains(&address) {
            atoms += 1;
        }
        if links.contains(&address) && !referenced.contains(&address) {
            unreferenced += 1;
        }
    }
    (atoms, unreferenced)
}

fn infinite_row(structure: &Affine) -> Value {
    let base = invariants(structure, None, 4);
    let from = structure.start.unwrap_or(-DELETION_BOUND);
    let mut deletions = Vec::new();
    for deleted in from..from + DELETION_BOUND {
        let narrow = invariants(structure, Some(deleted), 4);
        let wide = invariants(structure, Some(deleted), 8);
        deletions.push((deleted, narrow, narrow == wide, narrow != base));
    }
    json!({
        "id": structure.id,
        "start": structure.start,
        "step": structure.step,
        "certificate": shift_certificate(structure),
        "prefix": prefix_check(structure, PREFIX_BOUND, &affine_record),
        "invariants": { "atoms": base.0, "unreferencedLinks": base.1 },
        "firstDeletionInvariants": deletions.iter().take(3).map(|(deleted, (atoms, unreferenced), _, _)| {
            json!({ "deleted": deleted, "atoms": atoms, "unreferencedLinks": unreferenced })
        }).collect::<Vec<_>>(),
        "invisibleDeletions": deletions.iter().filter(|item| !item.3).map(|item| item.0).collect::<Vec<_>>(),
        "everyWindowStable": deletions.iter().all(|item| item.2),
    })
}

#[test]
fn finiteness_removal_is_reproduced_exactly_and_no_finite_structure_embeds_onto_a_proper_part_of_itself() {
    let recorded: Value = serde_json::from_str(FINITENESS).unwrap();
    let control = finite_control(&[1, 2, 3, 4]);
    assert_eq!(control, recorded["finiteControl"]);
    let counts = |key: &str| -> Vec<u64> {
        control.as_array().unwrap().iter().map(|item| item[key].as_u64().unwrap()).collect()
    };
    assert_eq!(counts("structures"), vec![2, 10, 77, 799]);
    assert_eq!(counts("selfEmbeddings"), vec![2, 14, 120, 1464]);
    assert_eq!(counts("nonSurjectiveSelfEmbeddings"), vec![0, 0, 0, 0]);
    assert_eq!(counts("invisibleDeletions"), vec![0, 0, 0, 0]);
    let computed = STRUCTURES.iter().map(infinite_row).collect::<Vec<_>>();
    assert_eq!(Value::Array(computed), recorded["infinite"]);
    let matrix: Value = serde_json::from_str(REPORT).unwrap();
    assert_eq!(matrix["retainedWithoutRemoval"], json!([]));
    assert_eq!(matrix["removedByProbe"]["finiteness"], json!("experiments/assumption-removal/finiteness.mjs"));
}

#[test]
fn removing_finiteness_identifies_each_ray_with_its_tail_by_a_symbolic_shift_certificate() {
    for structure in &STRUCTURES[..2] {
        let certificate = shift_certificate(structure);
        assert_eq!(certificate["identifiesWithProperSubstructure"], json!(true), "{}", structure.id);
        assert_eq!(certificate["surjective"], json!(false), "{}", structure.id);
        assert_eq!(certificate["imageAddressStart"], certificate["tailAddressStart"], "{}", structure.id);
        assert_eq!(
            prefix_check(structure, PREFIX_BOUND, &affine_record),
            json!({ "bound": 32, "holds": true, "failure": null })
        );
    }
    let recorded: Value = serde_json::from_str(FINITENESS).unwrap();
    assert_eq!(
        recorded["results"],
        json!({
            "finiteStructuresHaveOnlySurjectiveSelfEmbeddings": true,
            "finiteControlReproducesAuditedBaseCounts": true,
            "everyRayIsIdentifiedWithItsTail": true,
            "onlyTheFirstLinkOfARayIsInvisible": true,
            "theTwoSidedLineHasNoInvisibleDeletion": true,
            "bothSlotOrientationsBehaveAlike": true,
        })
    );
}

#[test]
fn only_the_first_link_of_a_ray_is_an_invisible_deletion_and_the_two_sided_line_has_none() {
    let rows = STRUCTURES.iter().map(infinite_row).collect::<Vec<_>>();
    assert_eq!(rows[0]["invariants"], json!({ "atoms": 0, "unreferencedLinks": 1 }));
    assert_eq!(rows[1]["invariants"], json!({ "atoms": 1, "unreferencedLinks": 0 }));
    assert_eq!(rows[0]["invisibleDeletions"], json!([0]));
    assert_eq!(rows[1]["invisibleDeletions"], json!([1]));
    assert_eq!(rows[2]["invisibleDeletions"], json!([]));
    assert!(rows.iter().all(|row| row["everyWindowStable"] == json!(true)));
    // Deleting a later link leaves a dangling reference, an isomorphism invariant.
    assert_eq!(invariants(&STRUCTURES[0], Some(40), 4), (1, 2));
}

#[test]
fn negative_controls_a_surjective_shift_or_a_non_affine_structure_identifies_no_proper_substructure() {
    let line = shift_certificate(&STRUCTURES[2]);
    assert_eq!(line["surjective"], json!(true));
    assert_eq!(line["identifiesWithProperSubstructure"], json!(false));
    // References growing at slope 2 are not shift-invariant: the very first window fails.
    let doubled = |_: &Affine, n: i64| [n, 2 * n];
    assert_eq!(
        prefix_check(&STRUCTURES[0], PREFIX_BOUND, &doubled),
        json!({ "bound": 32, "holds": false, "failure": { "length": 1, "n": 0 } })
    );
    let control = finite_control(&[1, 2]);
    assert!(control.as_array().unwrap().iter().all(|item| item["invisibleDeletions"] == json!(0)));
    let recorded: Value = serde_json::from_str(FINITENESS).unwrap();
    assert!(recorded["claimBoundary"]
        .as_str()
        .unwrap()
        .contains("not a claim that finiteness is intrinsic or eliminable"));
}
