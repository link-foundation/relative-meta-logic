//! Independently validate the per-declaration and per-command stage map in
//! Rust: completeness against the Rust-parsed corpus, token partition of every
//! module, preservation fingerprints, exact stage counts, and that every
//! claimed stage names agreeing evidence. Re-execution of that evidence is
//! mirrored by meta_theory_native_tests.rs and meta_theory_certificates_tests.rs.
use rml::formal_corpus::{FormalCorpus, FormalToken};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const SOURCE: &str = include_str!("../../lib/meta-theory/upstream-0.0.3.lino");
const FOUNDATION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-foundation.lino");
const MAP: &str = include_str!("../../test-corpus/meta-theory-coverage/map.json");
const NATIVE_COVERAGE: &str = include_str!("../../test-corpus/meta-theory-native/coverage.json");
const NATIVE_CASES: &str = include_str!("../../test-corpus/meta-theory-native/cases.json");
const PROPOSITIONS_COVERAGE: &str = include_str!("../../test-corpus/formal-propositions/coverage.json");
const PROPOSITIONS_CASES: &str = include_str!("../../test-corpus/formal-propositions/cases.json");
const CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-certificates/certificates.json");

fn token_sha256(tokens: &[FormalToken]) -> String {
    let mut text = String::new();
    for token in tokens {
        text.push_str(&token.kind);
        text.push(':');
        for byte in token.text.as_bytes() {
            text.push_str(&format!("{byte:02x}"));
        }
        text.push('\n');
    }
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn range(value: &Value) -> [usize; 2] {
    [value[0].as_u64().unwrap() as usize, value[1].as_u64().unwrap() as usize]
}

fn tally<'a>(items: &'a [Value], key: impl Fn(&'a Value) -> &'a Value) -> Value {
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    for item in items {
        *counts.entry(key(item).as_str().unwrap().to_string()).or_default() += 1;
    }
    Value::Object(counts.into_iter().map(|(key, count)| (key, Value::from(count))).collect::<Map<String, Value>>())
}

fn counts(map: &Value, modules: usize) -> Value {
    let declarations = map["declarations"].as_array().unwrap();
    let commands = map["commands"].as_array().unwrap();
    serde_json::json!({
        "declarations": declarations.len(),
        "commands": commands.len(),
        "modules": modules,
        "declarationsByLanguage": tally(declarations, |item| &item["language"]),
        "commandsByLanguage": tally(commands, |item| &item["language"]),
        "commandsByKind": tally(commands, |item| &item["kind"]),
        "preservation": tally(declarations, |item| &item["preservation"]["status"]),
        "typedElaboration": tally(declarations, |item| &item["typedElaboration"]["status"]),
        "nativeElaboration": tally(declarations, |item| &item["nativeElaboration"]["status"]),
        "dependencyCheck": tally(declarations, |item| &item["dependencyCheck"]["status"]),
        "nativeExecution": tally(declarations, |item| &item["nativeExecution"]["status"]),
        "proof": tally(declarations, |item| &item["proof"]["status"]),
        "upstreamAdmission": tally(declarations, |item| &item["admission"]["upstream"]),
        "commandElaboration": tally(commands, |item| &item["elaboration"]["status"]),
        "commandExecution": tally(commands, |item| &item["execution"]["status"]),
    })
}

struct Evidence {
    corpus: FormalCorpus,
    native_coverage: Value,
    native_cases: Value,
    propositions_coverage: Value,
    propositions_cases: Value,
    certificates: Value,
}

fn evidence() -> Evidence {
    Evidence {
        corpus: FormalCorpus::from_rml(SOURCE, FOUNDATION).unwrap(),
        native_coverage: serde_json::from_str(NATIVE_COVERAGE).unwrap(),
        native_cases: serde_json::from_str(NATIVE_CASES).unwrap(),
        propositions_coverage: serde_json::from_str(PROPOSITIONS_COVERAGE).unwrap(),
        propositions_cases: serde_json::from_str(PROPOSITIONS_CASES).unwrap(),
        certificates: serde_json::from_str(CERTIFICATES).unwrap(),
    }
}

fn find<'a>(items: &'a Value, field: &str, value: &str) -> Option<&'a Value> {
    items.as_array().unwrap().iter().find(|item| item[field] == value)
}

fn validate(map: &Value, evidence: &Evidence) -> Vec<String> {
    let mut problems = Vec::new();
    let corpus = &evidence.corpus;
    if map["corpusFingerprint"].as_str() != Some(corpus.fingerprint()) {
        problems.push("map corpus fingerprint is stale".to_string());
    }
    let declarations = map["declarations"].as_array().unwrap();
    let commands = map["commands"].as_array().unwrap();

    let mut seen = BTreeSet::new();
    for entry in declarations {
        let address = entry["address"].as_str().unwrap();
        if !seen.insert(address.to_string()) {
            problems.push(format!("duplicate declaration {address}"));
        }
        if corpus.declaration_at(address).is_none() {
            problems.push(format!("unknown declaration {address}"));
        }
    }
    for declaration in corpus.declarations() {
        if !seen.contains(&declaration.address) {
            problems.push(format!("unmapped declaration {}", declaration.address));
        }
    }
    let mut command_ids = BTreeSet::new();
    for entry in commands {
        let id = entry["id"].as_str().unwrap();
        if !command_ids.insert(id.to_string()) {
            problems.push(format!("duplicate command {id}"));
        }
    }
    let analysed: BTreeSet<String> = evidence.native_coverage["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect();
    for id in &analysed {
        if !command_ids.contains(id) {
            problems.push(format!("unmapped command {id}"));
        }
    }
    for id in &command_ids {
        if !analysed.contains(id) {
            problems.push(format!("unknown command {id}"));
        }
    }

    // Partition and preservation, recomputed from the Rust-parsed tokens.
    for module in corpus.formal_modules() {
        let mut owner = vec![0usize; module.tokens.len()];
        let mut mark = |[start, end]: [usize; 2]| {
            for index in start..end.min(owner.len()) {
                owner[index] += 1;
            }
        };
        for entry in declarations.iter().chain(commands.iter()) {
            if entry["language"] != module.language.as_str() || entry["module"] != module.name.as_str() {
                continue;
            }
            let span = if entry.get("tokenRange").is_some() {
                range(&entry["tokenRange"])
            } else {
                range(&entry["preservation"]["syntaxRange"])
            };
            mark(span);
            if span[1] <= module.tokens.len()
                && entry["preservation"]["tokenSha256"].as_str() != Some(token_sha256(&module.tokens[span[0]..span[1]]).as_str())
            {
                let name = entry.get("id").or_else(|| entry.get("address")).unwrap();
                problems.push(format!("{}: preservation fingerprint differs from the corpus", name.as_str().unwrap()));
            }
        }
        let prefix = format!("rml.formal.{}.{}", module.language, module.name);
        let gaps = owner.iter().filter(|count| **count == 0).count();
        let overlaps = owner.iter().filter(|count| **count > 1).count();
        if gaps > 0 {
            problems.push(format!("{prefix}: {gaps} tokens belong to no declaration or command"));
        }
        if overlaps > 0 {
            problems.push(format!("{prefix}: {overlaps} tokens belong to more than one item"));
        }
    }
    for entry in declarations {
        let address = entry["address"].as_str().unwrap();
        let Some(declaration) = corpus.declaration_at(address) else { continue };
        if range(&entry["preservation"]["syntaxRange"]) != declaration.syntax_range {
            problems.push(format!("{address}: preservation fingerprint differs from the corpus"));
        }
        if entry["admission"]["upstream"] != declaration.proof_status.as_str() {
            problems.push(format!("{address}: upstream admission status differs"));
        }
    }

    // Stage claims against their evidence.
    for entry in declarations {
        let address = entry["address"].as_str().unwrap();
        let Some(native) = find(&evidence.native_coverage["declarations"], "address", address) else { continue };
        let Some(typed) = find(&evidence.propositions_coverage["declarations"], "address", address) else { continue };
        let typed_status = entry["typedElaboration"]["status"].as_str().unwrap();
        if entry["typedElaboration"]["status"] != typed["status"] {
            problems.push(format!("{address}: typed elaboration status differs from its evidence"));
        }
        if typed_status == "definition-checked" || typed_status == "conversion-proof-replayed" {
            let witness = entry["typedElaboration"]["witness"].as_str().unwrap_or("");
            let accepted = find(&evidence.propositions_cases["cases"], "name", witness)
                .is_some_and(|item| item["address"] == address && item["accepted"] == true);
            if !accepted {
                problems.push(format!("{address}: typed elaboration claimed without an accepted case"));
            }
        }
        if entry["nativeElaboration"]["status"] != native["status"] || entry["nativeElaboration"]["rules"] != native["rules"] {
            problems.push(format!("{address}: native elaboration claim differs from its evidence"));
        }
        if entry["dependencyCheck"]["status"] != native["dependencyCheck"]["status"] {
            problems.push(format!("{address}: dependency check claim differs"));
        }
        let execution = &entry["nativeExecution"];
        match execution["status"].as_str().unwrap() {
            "ablation-witnessed" => {
                if execution["witness"] != native["executionWitness"] {
                    problems.push(format!("{address}: native execution claimed without a recorded ablation witness"));
                }
            }
            "statement-normalized" => {
                let witness = execution["witness"].as_str().unwrap_or("");
                let normalized = find(&evidence.native_cases["cases"], "id", witness)
                    .is_some_and(|item| item["address"] == address);
                if entry["kind"] != "theorem" || !normalized {
                    problems.push(format!("{address}: statement normalization claimed without a case"));
                }
            }
            status => {
                if status != "not-witnessed" || !native["executionWitness"].is_null() {
                    problems.push(format!("{address}: native execution status {status} does not match its evidence"));
                }
            }
        }
        let certificate = find(&evidence.certificates["theorems"], "theorem", address);
        match entry["proof"]["status"].as_str().unwrap() {
            "certified" => {
                let agrees = certificate.is_some_and(|item| {
                    item["status"] == "certified" && item["chain"]["status"] == entry["proof"]["chain"]
                });
                if !agrees {
                    problems.push(format!("{address}: proof certified without a certificate"));
                }
            }
            "outside-fragment" => {
                if !certificate.is_some_and(|item| item["status"] == "outside-fragment") {
                    problems.push(format!("{address}: proof status differs from the certificates"));
                }
            }
            status => {
                if status != "not-applicable" || entry["kind"] == "theorem" {
                    problems.push(format!("{address}: proof status {status} does not match the declaration kind"));
                }
            }
        }
    }
    for entry in commands {
        let id = entry["id"].as_str().unwrap();
        let Some(analysis) = find(&evidence.native_coverage["commands"], "id", id) else { continue };
        if entry["elaboration"]["status"] != analysis["status"] {
            problems.push(format!("{id}: elaboration status differs from its evidence"));
        }
        let witness = entry["execution"]["witness"].as_str().unwrap_or("");
        let case = find(&evidence.native_cases["cases"], "id", witness);
        match entry["execution"]["status"].as_str().unwrap() {
            "value" => {
                if !case.is_some_and(|item| item["value"] == true && item["command"] == id) {
                    problems.push(format!("{id}: execution claimed without a value case"));
                }
            }
            "target-normalized" => {
                if !case.is_some_and(|item| item["command"] == id) {
                    problems.push(format!("{id}: check normalization claimed without a case"));
                }
            }
            _ => {}
        }
    }
    if map["counts"] != counts(map, corpus.formal_modules().len()) {
        problems.push("map counts are stale".to_string());
    }
    problems
}

fn map() -> Value {
    serde_json::from_str(MAP).unwrap()
}

fn expect(map: &Value, evidence: &Evidence, fragment: &str) {
    let problems = validate(map, evidence);
    assert!(problems.iter().any(|problem| problem.contains(fragment)), "{fragment} not in {problems:?}");
}

#[test]
fn validates_all_declarations_commands_partitions_and_counts() {
    let evidence = evidence();
    let map = map();
    assert_eq!(validate(&map, &evidence), Vec::<String>::new());
    assert_eq!(map["counts"]["declarations"], 229);
    assert_eq!(map["counts"]["commands"], 197);
    assert_eq!(map["counts"]["nativeElaboration"]["elaborated"], 229);
    assert_eq!(map["counts"]["dependencyCheck"]["exact"], 229);
    assert_eq!(map["counts"]["nativeExecution"]["ablation-witnessed"], 183);
    assert_eq!(map["counts"]["nativeExecution"]["not-witnessed"], 10);
    assert_eq!(map["counts"]["nativeExecution"]["statement-normalized"], 36);
    assert_eq!(map["counts"]["proof"]["certified"], 17);
    assert_eq!(map["counts"]["commandExecution"]["value"], 90);
    assert_eq!(evidence.corpus.declarations().len(), 229);
}

#[test]
fn rejects_unmapped_unknown_and_duplicated_items() {
    let evidence = evidence();
    let mut missing = map();
    missing["declarations"].as_array_mut().unwrap().pop();
    expect(&missing, &evidence, "unmapped declaration ");
    expect(&missing, &evidence, "tokens belong to no declaration or command");

    let mut unknown = map();
    let mut invented = unknown["declarations"][0].clone();
    invented["address"] = Value::String("rml.formal.lean.Invented.declaration".to_string());
    unknown["declarations"].as_array_mut().unwrap().push(invented);
    expect(&unknown, &evidence, "unknown declaration rml.formal.lean.Invented.declaration");

    let mut commandless = map();
    let removed = commandless["commands"].as_array_mut().unwrap().remove(5);
    expect(&commandless, &evidence, &format!("unmapped command {}", removed["id"].as_str().unwrap()));
}

#[test]
fn rejects_partition_gaps_overlaps_and_fingerprints() {
    let evidence = evidence();
    let mut shifted = map();
    let span = range(&shifted["commands"][3]["tokenRange"]);
    shifted["commands"][3]["tokenRange"] = serde_json::json!([span[0] + 1, span[1] + 1]);
    expect(&shifted, &evidence, "preservation fingerprint differs");
    let problems = validate(&shifted, &evidence);
    assert!(problems.iter().any(|problem| problem.contains("tokens belong to")));

    let mut fingerprint = map();
    fingerprint["declarations"][10]["preservation"]["tokenSha256"] = Value::String("0".repeat(64));
    expect(&fingerprint, &evidence, "preservation fingerprint differs from the corpus");
}

#[test]
fn rejects_stale_counts_and_claims_without_witnesses() {
    let evidence = evidence();
    let mut stale = map();
    let certified = stale["counts"]["proof"]["certified"].as_u64().unwrap();
    stale["counts"]["proof"]["certified"] = Value::from(certified + 1);
    expect(&stale, &evidence, "map counts are stale");

    let mut executed = map();
    for entry in executed["declarations"].as_array_mut().unwrap() {
        if entry["nativeExecution"]["status"] == "not-witnessed" {
            entry["nativeExecution"] = serde_json::json!({
                "status": "ablation-witnessed",
                "witness": { "case": "rml.formal.lean.NetworkExamples#command-17-execution", "ablation": "stuck" }
            });
            break;
        }
    }
    expect(&executed, &evidence, "native execution claimed without a recorded ablation witness");

    let mut proved = map();
    for entry in proved["declarations"].as_array_mut().unwrap() {
        if entry["proof"]["status"] == "outside-fragment" {
            entry["proof"] = serde_json::json!({ "status": "certified", "chain": "closed", "relativeTo": [] });
            break;
        }
    }
    expect(&proved, &evidence, "proof certified without a certificate");

    let mut command = map();
    for entry in command["commands"].as_array_mut().unwrap() {
        if entry["execution"]["status"] == "value" {
            entry["execution"]["witness"] =
                Value::String("rml.formal.lean.MetaDefinitions.meta_network_is_duplet_network-statement".to_string());
            break;
        }
    }
    expect(&command, &evidence, "execution claimed without a value case");
}
