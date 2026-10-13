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
        // The Rust crate keeps comment extras in its native construct trees while the
        // JavaScript package drops them (meta-language-upstream-requests.md, request 19).
        // Pin that exact divergence so any other difference, or its repair, fails here.
        let comment_divergence: BTreeSet<&str> = match name {
            "Rust" => ["block_comment", "line_comment"].into_iter().collect(),
            "Rocq" => ["comment"].into_iter().collect(),
            _ => BTreeSet::new(),
        };
        let divergence: BTreeSet<&str> = observed.difference(&exercised).copied().collect();
        assert_eq!(
            divergence, comment_divergence,
            "{name}: Rust-only exercised constructs differ from the pinned comment divergence"
        );
        let shared: BTreeSet<&str> = observed.difference(&comment_divergence).copied().collect();
        assert_eq!(
            shared, exercised,
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

type RuleUse = (&'static str, String, Option<String>);

/// Every reference to `rule` from elsewhere in a native grammar text, as (kind, from, alias
/// target); mirrors `grammarRuleUses` in js/src/rml-language-inventory.mjs.
fn grammar_rule_uses(text: &str, rule: &str) -> Vec<RuleUse> {
    let reference = Regex::new(&format!(r"(\(alias (\S+) |\(not )?\(ref {rule}\)")).unwrap();
    let owner_pattern = Regex::new(r"^\((\S+) ?(\S+)?").unwrap();
    let mut uses = Vec::new();
    for line in text.split('\n') {
        let Some(owner) = owner_pattern.captures(line) else {
            continue;
        };
        let head = owner.get(1).unwrap().as_str();
        let name = owner.get(2).map(|name| name.as_str());
        if head == "rule" && name == Some(rule) {
            continue;
        }
        let from = if head == "rule" {
            name.unwrap_or_default().to_string()
        } else {
            head.to_string()
        };
        for capture in reference.captures_iter(line) {
            let kind = if head == "extra" {
                "extra"
            } else if capture.get(2).is_some() {
                "alias"
            } else if capture.get(1).is_some() {
                "lookahead"
            } else {
                "plain"
            };
            uses.push((
                kind,
                from.clone(),
                capture.get(2).map(|target| target.as_str().to_string()),
            ));
        }
    }
    uses
}

/// Why a receipt's reason holds structurally, or `None`; mirrors `receiptDetail`.
fn receipt_detail(reason: &str, uses: &[RuleUse], receipted: &BTreeSet<String>) -> Option<String> {
    match reason {
        "unreferenced" if uses.is_empty() => {
            Some("no other grammar rule or declaration references it".to_string())
        }
        "alias" if !uses.is_empty() && uses.iter().all(|item| item.0 == "alias") => {
            let targets: BTreeSet<&str> = uses.iter().filter_map(|item| item.2.as_deref()).collect();
            Some(format!(
                "every reference renames it to {}",
                targets.into_iter().collect::<Vec<_>>().join(", ")
            ))
        }
        "lookahead" if !uses.is_empty() && uses.iter().all(|item| item.0 == "lookahead") => {
            let owners: BTreeSet<&str> = uses.iter().map(|item| item.1.as_str()).collect();
            Some(format!(
                "only a negative lookahead (keyword boundary) in {} rules",
                owners.len()
            ))
        }
        "extra"
            if uses.iter().any(|item| item.0 == "extra")
                && uses.iter().all(|item| {
                    item.0 == "extra" || (item.0 == "plain" && receipted.contains(&item.1))
                }) =>
        {
            Some(
                "an extra: skipped between constructs, never placed in a JavaScript native construct tree"
                    .to_string(),
            )
        }
        _ => None,
    }
}

fn tree_has(tree: &ConstructTree, kind: &str) -> bool {
    tree.kind == kind || tree.children.iter().any(|child| tree_has(child, kind))
}

#[test]
fn rust_parser_and_grammar_text_confirm_every_construct_refusal_receipt() {
    let inventory = json("docs/case-studies/issue-183/language-constructs.json");
    let corpus = json(inventory["corpus"].as_str().unwrap());
    let receipts = corpus["receipts"].as_array().unwrap();
    for language in inventory["languages"].as_array().unwrap() {
        let name = language["language"].as_str().unwrap();
        let grammar = language["grammar"].as_str().unwrap();
        let text = read(&format!(
            "js/vendor/meta-language/js/src/data/native-grammars/{}.lino",
            grammar.trim_start_matches("native-")
        ));
        let mine: Vec<&Value> = receipts
            .iter()
            .filter(|receipt| receipt["language"] == name)
            .collect();
        let receipted: BTreeSet<String> = mine
            .iter()
            .map(|receipt| receipt["rule"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            language["receiptProblems"],
            Value::Array(Vec::new()),
            "{name}"
        );
        assert_eq!(language["unreceipted"], Value::Array(Vec::new()), "{name}");
        assert_eq!(
            language["unexercised"],
            Value::Array(mine.iter().map(|receipt| receipt["rule"].clone()).collect()),
            "{name}: every unexercised construct has exactly one receipt, in order"
        );
        let rows = language["refusalReceipts"].as_array().unwrap();
        assert_eq!(rows.len(), mine.len(), "{name}");
        for (receipt, row) in mine.iter().zip(rows) {
            let rule = receipt["rule"].as_str().unwrap();
            let reason = receipt["reason"].as_str().unwrap();
            let detail = receipt_detail(reason, &grammar_rule_uses(&text, rule), &receipted)
                .unwrap_or_else(|| panic!("{name}: {rule}: reason {reason} does not hold"));
            assert_eq!(row[0], rule, "{name}");
            assert_eq!(row[1], reason, "{name} {rule}");
            assert_eq!(row[2], detail.as_str(), "{name} {rule}");
            let probe = receipt["probe"].as_str().unwrap();
            let tree = native_construct_tree(grammar, probe)
                .unwrap_or_else(|| panic!("{name}: {rule}: probe refused by the Rust parser"));
            // The Rust crate keeps comment extras (request 19), so only non-extra receipts
            // must stay absent from the Rust construct tree of their probe.
            if reason != "extra" {
                assert!(
                    !tree_has(&tree, rule),
                    "{name}: {rule}: probe builds the construct"
                );
            }
        }
    }
}

#[test]
fn a_receipt_whose_structural_reason_fails_is_rejected() {
    let text = read("js/vendor/meta-language/js/src/data/native-grammars/rust.lino");
    let none = BTreeSet::new();
    let uses = grammar_rule_uses(&text, "last_match_arm");
    assert_eq!(
        uses,
        vec![(
            "alias",
            "match_block".to_string(),
            Some("match_arm".to_string())
        )]
    );
    assert_eq!(receipt_detail("unreferenced", &uses, &none), None);
    assert_eq!(receipt_detail("guess", &uses, &none), None);
    assert_eq!(
        receipt_detail("alias", &uses, &none).as_deref(),
        Some("every reference renames it to match_arm")
    );
    let plain = grammar_rule_uses(&text, "for_lifetimes");
    assert_eq!(receipt_detail("alias", &plain, &none), None);
    assert_eq!(receipt_detail("unreferenced", &plain, &none), None);
    let comment_owner: BTreeSet<String> = ["comment".to_string()].into_iter().collect();
    let line = grammar_rule_uses(&text, "line_comment");
    assert_eq!(receipt_detail("extra", &line, &none), None);
    assert!(receipt_detail("extra", &line, &comment_owner).is_some());
}
