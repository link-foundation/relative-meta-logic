//! Mirrors experiments/assumption-removal/matrix.mjs and
//! js/tests/assumption-removal.test.mjs: one retained assumption of the
//! repaired addressed representation removed at a time, by exhaustive finite
//! enumeration.
use rml::linked_program::link_ontology_symmetry_report;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const REPORT: &str = include_str!("../../../test-corpus/assumption-removal/report.json");

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
