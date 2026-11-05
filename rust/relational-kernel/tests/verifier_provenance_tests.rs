//! Mirrors js/tests/verifier-provenance.test.mjs and
//! experiments/verifier-provenance/removal-matrix.mjs: the local verifier step
//! as linked Horn clauses, with every operation removed one at a time.
use rml::linked_program::link_ontology_symmetry_report;
use rml_relational::horn_resolution::{HornResolution, Options, LAWS};
use rml_relational::relational_kernel::{decode_bits, decode_list, encode_bits, encode_list};
use rml_relational::Node;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

const VERIFIER: &str = include_str!("../../../lib/meta-theory/horn-local-verifier.lino");
const CASES: &str = include_str!("../../../test-corpus/verifier-provenance/cases.json");
const REPORT: &str = include_str!("../../../test-corpus/verifier-provenance/report.json");

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

#[derive(Clone, Debug)]
struct Case {
    id: String,
    description: Vec<u64>,
    mappings: Vec<Vec<u64>>,
    records: Vec<Vec<u64>>,
    candidates: Vec<u64>,
}
fn numbers(value: &Value) -> Vec<u64> {
    value.as_array().unwrap().iter().map(|item| item.as_u64().unwrap()).collect()
}
fn triples(value: &Value) -> Vec<Vec<u64>> {
    value.as_array().unwrap().iter().map(numbers).collect()
}
/// Mirrors `expandedCases`: the renamed case is expanded from its source.
fn cases() -> Vec<Case> {
    let corpus: Value = serde_json::from_str(CASES).unwrap();
    let scale = corpus["renaming"]["scale"].as_u64().unwrap();
    let offset = corpus["renaming"]["offset"].as_u64().unwrap();
    let rename = |value: u64| offset + scale * value;
    let items = corpus["cases"].as_array().unwrap();
    items
        .iter()
        .map(|item| {
            let id = item["id"].as_str().unwrap().to_string();
            if let Some(source) = item["renamedFrom"].as_str() {
                let source = items.iter().find(|other| other["id"] == json!(source)).unwrap();
                let renamed = |list: Vec<Vec<u64>>| -> Vec<Vec<u64>> {
                    list.into_iter()
                        .map(|record| record.into_iter().map(rename).collect())
                        .collect()
                };
                return Case {
                    id,
                    description: numbers(&source["description"]).into_iter().map(rename).collect(),
                    mappings: renamed(triples(&source["mappings"])),
                    records: renamed(triples(&source["records"])),
                    candidates: numbers(&source["candidates"]).into_iter().map(rename).collect(),
                };
            }
            Case {
                id,
                description: numbers(&item["description"]),
                mappings: triples(&item["mappings"]),
                records: triples(&item["records"]),
                candidates: numbers(&item["candidates"]),
            }
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq)]
enum Codec {
    Injective,
    Collapsed,
}
impl Codec {
    fn encode(self, value: u64) -> Node {
        match self {
            Codec::Injective => encode_bits(&value.to_string()),
            Codec::Collapsed => encode_bits("x"),
        }
    }
    fn decode(self, bits: &Node) -> Result<u64, String> {
        let text = decode_bits(bits)?;
        match self {
            Codec::Collapsed => Ok(0),
            Codec::Injective => {
                let canonical = text == "0"
                    || (!text.is_empty()
                        && !text.starts_with('0')
                        && text.chars().all(|c| c.is_ascii_digit()));
                if !canonical {
                    return Err("invalid verifier address code".into());
                }
                text.parse::<u64>().map_err(|error| error.to_string())
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Outcome {
    cell: String,
    cardinality: Option<String>,
    matches: Vec<(u64, u64, Vec<u64>)>,
    trace: Option<Vec<Vec<u64>>>,
}

/// Mirrors `runCase`; the host allocates trace addresses and classifies multiplicity.
fn run_case(
    resolver: &HornResolution,
    case: &Case,
    ablated: &[&str],
    max_answers: usize,
    codec: Codec,
) -> Result<Outcome, String> {
    let record = |values: &Vec<u64>| -> Result<Node, String> {
        if values.len() != 3 {
            return Err("verifier records must be addressed triples".into());
        }
        let mut items = vec![leaf("rec")];
        items.extend(values.iter().map(|value| codec.encode(*value)));
        Ok(Node::List(items))
    };
    let goal = Node::List(vec![
        leaf("local-match"),
        record(&case.description)?,
        encode_list(case.mappings.iter().map(record).collect::<Result<_, _>>()?),
        encode_list(case.records.iter().map(record).collect::<Result<_, _>>()?),
        encode_list(case.candidates.iter().map(|value| codec.encode(*value)).collect()),
        leaf("?match"),
    ]);
    let options = Options {
        max_steps: 200_000,
        max_depth: 4096,
        max_answers,
        capture_proof: false,
        ablated: ablated.iter().map(|law| law.to_string()).collect::<BTreeSet<_>>(),
        ..Options::default()
    };
    let result = match resolver.query(&goal, &options) {
        Ok(result) => result,
        Err(error) if error.contains("bound exceeded") => {
            return Ok(Outcome { cell: "BOUND".into(), cardinality: None, matches: vec![], trace: None })
        }
        Err(error) => return Err(error),
    };
    let decode = |answer: &Node| -> Result<(u64, u64, Vec<u64>), String> {
        let Node::List(goal) = answer else { return Err("invalid answer".into()) };
        let Some(Node::List(parts)) = goal.last() else { return Err("invalid match".into()) };
        if parts.len() != 4 || parts[0] != leaf("match") {
            return Err("invalid match".into());
        }
        Ok((
            codec.decode(&parts[1])?,
            codec.decode(&parts[2])?,
            decode_list(&parts[3])?
                .iter()
                .map(|bits| codec.decode(bits))
                .collect::<Result<_, _>>()?,
        ))
    };
    let matches = match result
        .answers
        .iter()
        .map(|answer| decode(&answer.goal))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(matches) => matches,
        Err(_) => {
            return Ok(Outcome { cell: "INVALID".into(), cardinality: None, matches: vec![], trace: None })
        }
    };
    let mut trace = Vec::new();
    for (index, (description, concrete, witnesses)) in matches.iter().enumerate() {
        let root = 200 + 10 * index as u64;
        trace.push(vec![root, *description, *concrete]);
        for (position, witness) in witnesses.iter().enumerate() {
            trace.push(vec![root + position as u64 + 1, root, *witness]);
        }
    }
    let cardinality = match matches.len() {
        0 => "ZERO",
        1 => "ONE",
        _ => "MANY",
    };
    Ok(Outcome {
        cell: cardinality.into(),
        cardinality: Some(cardinality.into()),
        matches,
        trace: Some(trace),
    })
}

fn apply_replacement(source: &str, replacement: &Value) -> Result<String, String> {
    let mut changed = source.to_string();
    for edit in replacement["replace"].as_array().unwrap() {
        let (before, after) = (edit[0].as_str().unwrap(), edit[1].as_str().unwrap());
        if changed.matches(before).count() != 1 {
            return Err(format!(
                "verifier replacement {} no longer matches",
                replacement["id"].as_str().unwrap()
            ));
        }
        changed = changed.replacen(before, after, 1);
    }
    Ok(changed)
}

/// Mirrors `removalMatrix` rows: id, kind, cells and changed cases.
fn matrix_rows() -> (Vec<Value>, Vec<Outcome>) {
    let corpus: Value = serde_json::from_str(CASES).unwrap();
    let cases = cases();
    let base = HornResolution::from_source(VERIFIER).unwrap();
    let run = |resolver: &HornResolution, ablated: &[&str], max_answers: usize, codec: Codec| {
        cases
            .iter()
            .map(|case| run_case(resolver, case, ablated, max_answers, codec).unwrap())
            .collect::<Vec<_>>()
    };
    let baseline = run(&base, &[], 64, Codec::Injective);
    let row = |kind: &str, id: &str, results: Vec<Outcome>| -> Value {
        let mut cells = Map::new();
        let mut changed = Vec::new();
        for (index, result) in results.iter().enumerate() {
            let reference = &baseline[index];
            let mark = result.cardinality.is_some()
                && result.cardinality == reference.cardinality
                && result.trace != reference.trace;
            let cell = format!("{}{}", result.cell, if mark { "*" } else { "" });
            if cell != reference.cell {
                changed.push(cases[index].id.clone());
            }
            cells.insert(cases[index].id.clone(), json!(cell));
        }
        json!({"kind": kind, "id": id, "cells": cells, "changed": changed})
    };
    let mut rows = vec![row("baseline", "none", baseline.clone())];
    for clause in base.clauses() {
        let kept = base
            .clauses()
            .iter()
            .filter(|other| other.name != clause.name)
            .cloned()
            .collect::<Vec<_>>();
        let resolver = HornResolution::new(kept).unwrap();
        rows.push(row("linked-clause", &clause.name, run(&resolver, &[], 64, Codec::Injective)));
    }
    for replacement in corpus["replacements"].as_array().unwrap() {
        let source = apply_replacement(VERIFIER, replacement).unwrap();
        let resolver = HornResolution::from_source(&source).unwrap();
        rows.push(row(
            "linked-replacement",
            replacement["id"].as_str().unwrap(),
            run(&resolver, &[], 64, Codec::Injective),
        ));
    }
    for law in LAWS {
        rows.push(row("resolver-law", law, run(&base, &[*law], 64, Codec::Injective)));
    }
    rows.push(row("host-operation", "exhaustive-answer-enumeration", run(&base, &[], 1, Codec::Injective)));
    rows.push(row("host-operation", "injective-address-codec", run(&base, &[], 64, Codec::Collapsed)));
    (rows, baseline)
}

#[test]
fn the_linked_local_verifier_reproduces_every_linked_verifier_step_probe_case_and_trace() {
    let report = link_ontology_symmetry_report();
    let probe = &report.observation_boundary.starting_representation_audit.linked_verifier_step;
    let (_, baseline) = matrix_rows();
    let cases = cases();
    assert_eq!(probe.cases.len(), 7);
    for (index, item) in probe.cases.iter().enumerate() {
        assert_eq!(cases[index].id, item.id);
        assert_eq!(baseline[index].cell, item.cardinality, "{}", item.id);
        let trace = baseline[index]
            .trace
            .clone()
            .unwrap()
            .into_iter()
            .map(|record| record.into_iter().map(|value| value as usize).collect::<Vec<_>>())
            .collect::<Vec<_>>();
        assert_eq!(trace, item.trace_records, "{}", item.id);
    }
}

#[test]
fn the_removal_matrix_is_reproduced_exactly_from_the_linked_verifier_source() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    let (rows, baseline) = matrix_rows();
    assert_eq!(Value::Array(rows.clone()), recorded["rows"]);
    let cases = cases();
    for (index, case) in cases.iter().enumerate() {
        let trace = baseline[index].trace.clone().unwrap();
        assert_eq!(json!(trace), recorded["baselineTraces"][&case.id], "{}", case.id);
    }
    let clause_count = HornResolution::from_source(VERIFIER).unwrap().clauses().len();
    assert_eq!(rows.len(), 1 + clause_count + 2 + LAWS.len() + 2);
    let ids = |kind: &str, changed: bool| -> Value {
        json!(rows
            .iter()
            .filter(|row| row["kind"] == json!(kind)
                && row["changed"].as_array().unwrap().is_empty() != changed)
            .map(|row| row["id"].clone())
            .collect::<Vec<_>>())
    };
    for (field, kind) in [
        ("linkedClauses", "linked-clause"),
        ("readingReplacements", "linked-replacement"),
        ("resolverLaws", "resolver-law"),
        ("hostOperations", "host-operation"),
    ] {
        assert_eq!(ids(kind, true), recorded["necessary"][field], "{field}");
        assert_eq!(ids(kind, false), recorded["noCaseChanged"][field], "{field}");
    }
}

#[test]
fn representation_changes_separate_what_follows_from_the_links_from_declared_readings() {
    let recorded: Value = serde_json::from_str(REPORT).unwrap();
    let (rows, baseline) = matrix_rows();
    let cases = cases();
    let at = |id: &str| -> Outcome {
        baseline[cases.iter().position(|case| case.id == id).unwrap()].clone()
    };
    let cell = |row_id: &str, case: &str| -> Value {
        rows.iter().find(|row| row["id"] == json!(row_id)).unwrap()["cells"][case].clone()
    };
    let corpus: Value = serde_json::from_str(CASES).unwrap();
    let scale = corpus["renaming"]["scale"].as_u64().unwrap();
    let offset = corpus["renaming"]["offset"].as_u64().unwrap();
    let renamed = at("complete-local-match")
        .trace
        .unwrap()
        .into_iter()
        .enumerate()
        .map(|(index, record)| {
            if index == 0 {
                vec![record[0], offset + scale * record[1], offset + scale * record[2]]
            } else {
                vec![record[0], record[1], offset + scale * record[2]]
            }
        })
        .collect::<Vec<_>>();
    let match_set = |outcome: Outcome| {
        let mut set = outcome.matches;
        set.sort();
        set
    };
    let renaming_preserved = at("renamed-complete-local-match").cell == "ONE"
        && at("renamed-complete-local-match").trace.unwrap() == renamed;
    let order_preserves_set =
        match_set(at("reordered-two-concrete-records")) == match_set(at("two-concrete-records"));
    let order_preserves_sequence =
        at("reordered-two-concrete-records").trace == at("two-concrete-records").trace;
    let representation = json!({
        "renamingPreservesTraceUpToRenaming": renaming_preserved,
        "recordOrderPreservesMatchSet": order_preserves_set,
        "recordOrderPreservesTraceSequence": order_preserves_sequence,
        "slotReversalForwardReading": at("slot-reversed-complete-local-match").cell,
        "slotReversalReversedReading": cell("reversed-reading", "slot-reversed-complete-local-match"),
        "duplicatedDescriptionSetPresence": at("duplicated-description").cell,
        "duplicatedDescriptionProofMultiplicity": cell("presence-as-proof-multiplicity", "duplicated-description"),
        "relocatedDescriptionWithMovedMapping": at("relocated-description").cell,
        "relocatedDescriptionWithStaleMapping": at("relocated-description-stale-mapping").cell,
        "traceReplayBySameJoin": at("trace-replay").cell,
    });
    assert_eq!(representation, recorded["representation"]);
    assert_eq!(recorded["representation"]["duplicatedDescriptionProofMultiplicity"], json!("MANY"));
    assert_eq!(recorded["representation"]["slotReversalReversedReading"], json!("ONE"));
    assert_eq!(
        recorded["status"],
        json!("LOCAL_TRACE_FOLLOWS_FROM_LINKS_ONLY_WITH_DECLARED_READINGS_AND_RESOLVER_LAWS")
    );
}

#[test]
fn malformed_inputs_stale_replacements_and_unknown_laws_are_rejected() {
    let corpus: Value = serde_json::from_str(CASES).unwrap();
    let resolver = HornResolution::from_source(VERIFIER).unwrap();
    let first = cases()[0].clone();
    let malformed = Case { records: vec![vec![40, 30]], ..first.clone() };
    assert_eq!(
        run_case(&resolver, &malformed, &[], 64, Codec::Injective).unwrap_err(),
        "verifier records must be addressed triples"
    );
    assert!(run_case(&resolver, &first, &["no-such-law"], 64, Codec::Injective)
        .unwrap_err()
        .contains("unknown Horn law"));
    let reversed = &corpus["replacements"][0];
    let once = apply_replacement(VERIFIER, reversed).unwrap();
    assert!(apply_replacement(&once, reversed).unwrap_err().contains("no longer matches"));
    let replaced = HornResolution::from_source(&once).unwrap();
    assert_eq!(run_case(&replaced, &first, &[], 64, Codec::Injective).unwrap().cell, "ZERO");
    assert_eq!(run_case(&resolver, &first, &[], 64, Codec::Injective).unwrap().cell, "ONE");
}
