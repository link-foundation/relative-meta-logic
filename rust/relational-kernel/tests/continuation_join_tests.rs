//! Mirrors experiments/continuation-join/exhaustive.mjs and
//! js/tests/continuation-join.test.mjs: the conditional continuation join
//! over every three- and four-record binary structure.
use rml::linked_program::link_ontology_symmetry_report;
use serde_json::{json, Value};
use std::collections::BTreeSet;

const REPORT: &str = include_str!("../../../test-corpus/continuation-join/report.json");

type Record = Vec<usize>;
type Pair = (usize, usize);

/// The join of rml-foundation-search `conditionalContinuations`.
fn continuations(records: &[Record], unordered_witness: bool, reverse_projection: bool) -> Vec<Pair> {
    let mut pairs: Vec<Pair> = Vec::new();
    for first in records {
        for second in records {
            if first[0] == second[0] || first[2] != second[1] {
                continue;
            }
            let witnessed = records.iter().any(|witness| {
                if witness[0] == first[0] || witness[0] == second[0] {
                    return false;
                }
                let forward = witness[1] == first[0] && witness[2] == second[0];
                let backward = witness[1] == second[0] && witness[2] == first[0];
                forward || (unordered_witness && backward)
            });
            if !witnessed {
                continue;
            }
            let pair = if reverse_projection { (second[2], first[1]) } else { (first[1], second[2]) };
            if !pairs.contains(&pair) {
                pairs.push(pair);
            }
        }
    }
    pairs.sort();
    pairs
}
fn join(records: &[Record]) -> Vec<Pair> {
    continuations(records, false, false)
}
fn supports(records: &[Record], pair: Pair) -> Vec<[usize; 3]> {
    let mut found = Vec::new();
    for first in records {
        for second in records {
            if first[0] == second[0] || first[2] != second[1] || first[1] != pair.0 || second[2] != pair.1 {
                continue;
            }
            for witness in records {
                if witness[0] == first[0] || witness[0] == second[0] {
                    continue;
                }
                if witness[1] == first[0] && witness[2] == second[0] {
                    found.push([first[0], second[0], witness[0]]);
                }
            }
        }
    }
    found
}

fn normalize(sequence: &[usize]) -> Vec<usize> {
    let mut names: Vec<usize> = Vec::new();
    sequence
        .iter()
        .map(|item| match names.iter().position(|name| name == item) {
            Some(index) => index,
            None => {
                names.push(*item);
                names.len() - 1
            }
        })
        .collect()
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
/// One representative per class up to renaming and record order, in the
/// JavaScript enumeration order (any orbit-invariant canonical key works).
fn structures(count: usize) -> Vec<Vec<Record>> {
    fn extend(
        value: &mut Vec<usize>,
        index: usize,
        maximum: usize,
        visit: &mut dyn FnMut(&[usize]),
    ) {
        if index == value.len() {
            visit(value.as_slice());
            return;
        }
        for next in 0..=maximum + 1 {
            value[index] = next;
            extend(value, index + 1, maximum.max(next), visit);
        }
    }
    let orders = permutations(count);
    let mut seen: BTreeSet<Vec<usize>> = BTreeSet::new();
    let mut output = Vec::new();
    let mut value = vec![0; 3 * count];
    extend(&mut value, 1, 0, &mut |flat| {
        let records = (0..count).map(|index| flat[3 * index..3 * index + 3].to_vec()).collect::<Vec<_>>();
        if records.iter().map(|record| record[0]).collect::<BTreeSet<_>>().len() != count {
            return;
        }
        let canonical = orders
            .iter()
            .map(|order| normalize(&order.iter().flat_map(|index| records[*index].clone()).collect::<Vec<_>>()))
            .min()
            .unwrap();
        if seen.insert(canonical) {
            output.push(records);
        }
    });
    output
}

fn width_report(count: usize) -> Value {
    let all = structures(count);
    let (mut non_empty, mut differ, mut agree, mut reversal_failures, mut unordered_changes) = (0, 0, 0, 0, 0);
    let (mut recorded, mut self_pairs, mut extension_loses, mut redundant, mut output_pairs) = (0, 0, 0, 0, 0);
    let mut first_agree: Option<Vec<Record>> = None;
    let mut first_unordered: Option<Vec<Record>> = None;
    let mut first_recorded: Option<Vec<Record>> = None;
    let mut first_redundant: Option<Vec<Record>> = None;
    for records in &all {
        let forward = join(records);
        let reverse = continuations(records, false, true);
        if !forward.is_empty() {
            non_empty += 1;
        }
        if forward != reverse {
            differ += 1;
        } else if !forward.is_empty() {
            agree += 1;
            first_agree.get_or_insert_with(|| records.clone());
        }
        let reversed_records = records
            .iter()
            .map(|record| vec![record[0], record[2], record[1]])
            .collect::<Vec<_>>();
        let mut swapped = forward.iter().map(|(first, second)| (*second, *first)).collect::<Vec<_>>();
        swapped.sort();
        if join(&reversed_records) != swapped {
            reversal_failures += 1;
        }
        if continuations(records, true, false) != forward {
            unordered_changes += 1;
            first_unordered.get_or_insert_with(|| records.clone());
        }
        if forward
            .iter()
            .any(|(first, second)| records.iter().any(|record| record[1] == *first && record[2] == *second))
        {
            recorded += 1;
            first_recorded.get_or_insert_with(|| records.clone());
        }
        if forward.iter().any(|(first, second)| first == second) {
            self_pairs += 1;
        }
        let fresh = records.iter().flatten().max().unwrap() + 1;
        for pair in &forward {
            output_pairs += 1;
            let mut extended_records = records.clone();
            extended_records.push(vec![fresh, pair.0, pair.1]);
            let extended = join(&extended_records);
            if !forward.iter().all(|kept| extended.contains(kept)) {
                extension_loses += 1;
            }
            let survives = supports(records, *pair).iter().any(|triple| {
                triple.iter().any(|address| {
                    let remaining = records
                        .iter()
                        .filter(|record| record[0] != *address)
                        .cloned()
                        .collect::<Vec<_>>();
                    join(&remaining).contains(pair)
                })
            });
            if survives {
                redundant += 1;
                first_redundant.get_or_insert_with(|| records.clone());
            }
        }
    }
    let witness = |records: Option<Vec<Record>>| records.map(|value| json!(value)).unwrap_or(Value::Null);
    json!({
        "records": count,
        "classes": all.len(),
        "nonEmptyJoin": non_empty,
        "projectionsDiffer": differ,
        "projectionsAgreeNonEmpty": agree,
        "uniformReversalSwapsEveryPairFailures": reversal_failures,
        "unorderedWitnessChangesJoin": unordered_changes,
        "conclusionAlreadyRecorded": recorded,
        "selfPairs": self_pairs,
        "extensionLosesAPair": extension_loses,
        "pairsWithRedundantSupport": redundant,
        "outputPairs": output_pairs,
        "firstWitnesses": {
            "projectionsAgree": witness(first_agree),
            "unorderedWitnessChanges": witness(first_unordered),
            "conclusionAlreadyRecorded": witness(first_recorded),
            "redundantSupport": witness(first_redundant),
        },
    })
}

fn pairs_json(pairs: &[Pair]) -> Vec<Vec<usize>> {
    pairs.iter().map(|(first, second)| vec![*first, *second]).collect()
}

#[test]
fn the_copied_join_reproduces_the_conditional_continuation_probe_on_its_chain() {
    let report = link_ontology_symmetry_report();
    let probe = &report.observation_boundary.starting_representation_audit.conditional_continuation;
    for item in &probe.cases {
        assert_eq!(pairs_json(&join(&item.records)), item.continuations, "{}", item.id);
    }
    let mut chain = probe.premises.clone();
    chain.push(probe.forward_witness.clone());
    assert_eq!(continuations(&chain, false, true), vec![(2, 0)]);
    let mut reversed = probe.premises.clone();
    reversed.push(probe.reverse_witness.clone());
    assert_eq!(continuations(&reversed, true, false), vec![(0, 2)]);
}

#[test]
fn every_three_and_four_record_structure_is_classified_exactly_as_recorded() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    assert_eq!(structures(2).len(), 85);
    let rows = vec![width_report(3), width_report(4)];
    assert_eq!(Value::Array(rows.clone()), recorded["rows"]);
    let all = |field: &str, expected: u64| rows.iter().all(|row| row[field].as_u64().unwrap() == expected);
    let results = json!({
        "uniformSlotReversalReversesEveryContinuation": all("uniformReversalSwapsEveryPairFailures", 0),
        "joinIsMonotoneUnderAddingTheResultRecord": all("extensionLosesAPair", 0),
        "witnessOrientationDispensableInGeneral": all("unorderedWitnessChangesJoin", 0),
        "projectionsAlwaysDifferWhenNonEmpty": all("projectionsAgreeNonEmpty", 0),
        "supportingRecordsAlwaysIndividuallyNecessary": all("pairsWithRedundantSupport", 0),
        "resultRecordCanAlreadyBePresent": rows.iter().all(|row| row["conclusionAlreadyRecorded"].as_u64().unwrap() > 0),
    });
    assert_eq!(results, recorded["results"]);
    assert_eq!(rows[0]["pairsWithRedundantSupport"], json!(0));
    assert_eq!(rows[1]["pairsWithRedundantSupport"], json!(103));
}

#[test]
fn counterexample_witnesses_exhibit_their_counterexamples_directly() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    let records = |value: &Value| -> Vec<Record> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|record| record.as_array().unwrap().iter().map(|item| item.as_u64().unwrap() as usize).collect())
            .collect()
    };
    let agree = records(&recorded["rows"][0]["firstWitnesses"]["projectionsAgree"]);
    assert!(!join(&agree).is_empty());
    assert_eq!(join(&agree), continuations(&agree, false, true));
    let unordered = records(&recorded["rows"][0]["firstWitnesses"]["unorderedWitnessChanges"]);
    assert_ne!(continuations(&unordered, true, false), join(&unordered));
    let redundant = records(&recorded["rows"][1]["firstWitnesses"]["redundantSupport"]);
    let pair = join(&redundant)[0];
    assert!(redundant.iter().any(|record| {
        let remaining = redundant.iter().filter(|other| other[0] != record[0]).cloned().collect::<Vec<_>>();
        join(&remaining).contains(&pair)
    }));
    assert!(recorded["claimBoundary"].as_str().unwrap().contains("No result makes the join intrinsic"));
}
