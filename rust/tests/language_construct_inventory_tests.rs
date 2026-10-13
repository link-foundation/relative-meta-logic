//! Rust mirror of the four-language construct inventory: the same classifier, applied to the
//! rule/concept list reported by the Rust meta-language crate, and the same corpus parsed by
//! the Rust native grammar parser, must reproduce the checked-in inventory.
use meta_language::{native_construct_tree, native_grammar_rule_concepts, ConstructTree};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../");

fn sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(format!("{ROOT}{path}"))
        .unwrap_or_else(|error| panic!("{path}: {error}"))
}

fn json(path: &str) -> Value {
    serde_json::from_str(&read(path)).unwrap()
}

/// First-match classification; `None` marks an unclassified rule.
fn classify(patterns: &[(String, Regex)], rule: &str) -> Option<usize> {
    patterns.iter().position(|(_, regex)| regex.is_match(rule))
}

fn programs(corpus: &Value) -> Vec<(String, String, String, Option<bool>)> {
    let mut out = Vec::new();
    for file in corpus["files"].as_array().unwrap() {
        let path = file["path"].as_str().unwrap();
        out.push((
            file["language"].as_str().unwrap().to_string(),
            path.to_string(),
            read(path),
            None,
        ));
    }
    let conformance = json(corpus["conformance"]["path"].as_str().unwrap());
    for section in corpus["conformance"]["sections"].as_array().unwrap() {
        let section = section.as_str().unwrap();
        for (index, item) in conformance[section].as_array().unwrap().iter().enumerate() {
            let language = item["language"].as_str().or_else(|| item["name"].as_str());
            if let (Some(language), Some(source)) = (language, item["source"].as_str()) {
                out.push((
                    language.to_string(),
                    format!("{section}[{index}]"),
                    source.to_string(),
                    None,
                ));
            }
        }
    }
    for program in corpus["programs"].as_array().unwrap() {
        out.push((
            program["language"].as_str().unwrap().to_string(),
            program["name"].as_str().unwrap().to_string(),
            program["source"].as_str().unwrap().to_string(),
            program["accepted"].as_bool(),
        ));
    }
    out
}

fn count(tree: &ConstructTree, counts: &mut BTreeMap<String, usize>) {
    *counts.entry(tree.kind.clone()).or_default() += 1;
    for child in &tree.children {
        count(child, counts);
    }
}

#[test]
fn rust_grammar_api_and_parser_reproduce_the_shared_construct_inventory() {
    let classifier = json("docs/case-studies/issue-183/language-construct-classifier.json");
    let inventory = json("docs/case-studies/issue-183/language-constructs.json");
    let corpus = json(inventory["corpus"].as_str().unwrap());
    let programs = programs(&corpus);
    let kind_pattern = Regex::new(r"(?m)^\(rule (\S+) (\S+)").unwrap();
    let languages = inventory["languages"].as_array().unwrap();
    assert_eq!(languages.len(), 4);
    for language in languages {
        let name = language["language"].as_str().unwrap();
        let grammar = language["grammar"].as_str().unwrap();
        let rules = native_grammar_rule_concepts(grammar);
        let fingerprint: String = rules
            .iter()
            .map(|rule| {
                format!(
                    "{}\t{}\n",
                    rule.rule,
                    rule.concept.as_deref().unwrap_or_default()
                )
            })
            .collect();
        assert_eq!(
            sha256(&fingerprint),
            language["ruleConceptSha256"],
            "{name}"
        );
        let text = read(&format!(
            "js/vendor/meta-language/js/src/data/native-grammars/{}.lino",
            grammar.trim_start_matches("native-")
        ));
        assert_eq!(sha256(&text), language["grammarTextSha256"], "{name}");
        let kinds: BTreeMap<&str, &str> = kind_pattern
            .captures_iter(&text)
            .map(|capture| {
                (
                    capture.get(1).unwrap().as_str(),
                    capture.get(2).unwrap().as_str(),
                )
            })
            .collect();
        let patterns: Vec<(String, Regex)> = classifier["languages"][name]["patterns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                (
                    pair[0].as_str().unwrap().to_string(),
                    Regex::new(pair[1].as_str().unwrap()).unwrap(),
                )
            })
            .collect();
        let mut used = BTreeSet::new();
        let mut unclassified = Vec::new();
        let rows = language["constructs"].as_array().unwrap();
        assert_eq!(rows.len(), rules.len(), "{name}");
        for (rule, row) in rules.iter().zip(rows) {
            assert_eq!(row[0], rule.rule.as_str(), "{name}");
            assert_eq!(
                row[1].as_str(),
                rule.concept.as_deref(),
                "{name} {}",
                rule.rule
            );
            assert_eq!(
                row[2].as_str(),
                kinds.get(rule.rule.as_str()).copied(),
                "{name} {}",
                rule.rule
            );
            match classify(&patterns, &rule.rule) {
                Some(index) => {
                    used.insert(index);
                    assert_eq!(row[3], patterns[index].0.as_str(), "{name} {}", rule.rule);
                }
                None => unclassified.push(rule.rule.clone()),
            }
        }
        assert!(
            unclassified.is_empty(),
            "{name}: unclassified {unclassified:?}"
        );
        assert_eq!(
            used.len(),
            patterns.len(),
            "{name}: a classifier pattern matches nothing"
        );

        let mut counts = BTreeMap::new();
        let mut refused = Vec::new();
        for (program_language, program, source, accepted) in &programs {
            if program_language != name {
                continue;
            }
            match native_construct_tree(grammar, source) {
                Some(tree) => {
                    assert_ne!(
                        *accepted,
                        Some(false),
                        "{name}: {program} unexpectedly accepted"
                    );
                    count(&tree, &mut counts);
                }
                None => {
                    assert_ne!(
                        *accepted,
                        Some(true),
                        "{name}: {program} unexpectedly refused"
                    );
                    refused.push(Value::String(program.clone()));
                }
            }
        }
        assert_eq!(Value::Array(refused), language["refusedPrograms"], "{name}");
        let exercised: BTreeSet<&str> = rows
            .iter()
            .filter(|row| row[4].as_u64().unwrap() > 0)
            .map(|row| row[0].as_str().unwrap())
            .collect();
        let observed: BTreeSet<&str> = counts.keys().map(String::as_str).collect();
        assert_eq!(
            observed, exercised,
            "{name}: exercised constructs differ between runtimes"
        );
    }
}

#[test]
fn an_unclassified_construct_or_a_dead_pattern_is_detected() {
    let classifier = json("docs/case-studies/issue-183/language-construct-classifier.json");
    let patterns: Vec<(String, Regex)> = classifier["languages"]["Rust"]["patterns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|pair| {
            (
                pair[0].as_str().unwrap().to_string(),
                Regex::new(pair[1].as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    assert_eq!(classify(&patterns, "brand_new_construct"), None);
    let dead = Regex::new("^never_a_rule$").unwrap();
    assert!(native_grammar_rule_concepts("native-rust")
        .iter()
        .all(|rule| !dead.is_match(&rule.rule)));
}
