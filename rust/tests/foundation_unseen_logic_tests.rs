//! An unseen links-only logic through the public package API, with the
//! shared outcome contract, foundation-defined cycle policies, independent
//! replay, assumption isolation and a host-source guard. Mirrors
//! `js/tests/foundation-unseen-logic.test.mjs` on the same fixtures.
use regex::Regex;
use rml::foundation_packages::{
    FoundationPackages, LinkedFoundationPackage, PackageImport, PackageResult, PackageSelection,
};
use rml::foundation_workspace::{
    FoundationBounds, FoundationChange, FoundationProof, FoundationWorkspace,
};
use rml::linked_program::ExecutionBasis;
use rml::{parse_lino_forms, Node};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const FIXTURE: &str =
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames.json");
const VOCABULARY: &str = include_str!("../../test-corpus/foundation-packages/host-vocabulary.json");
const SOURCES: [&str; 3] = [
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-1.lino"),
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-2.lino"),
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-3.lino"),
];
const VERSIONS: [&str; 3] = ["1", "2", "3"];
/// Words of the linked foundation schema itself; every other fixture leaf
/// belongs to the user's logic. The same list is in
/// `js/tests/foundation-source-guard.mjs`.
const SCHEMA_WORDS: &[&str] = &[
    "linked-program",
    "linked-fact",
    "linked-inference",
    "linked-rewrite",
    "linked-foundation",
    "linked-instance",
    "uses",
    "rebind",
    "premise",
    "conclusion",
    "judgement",
    "from",
    "to",
    "version",
    "depends-on",
    "signature",
    "cycle-policy",
    "guard",
    "theory",
    "foundation",
    "axioms",
    "inference",
    "typing",
    "reduction",
    "equality",
    "truth",
    "proof",
    "inductive",
    "guarded-coinductive",
    "refutation-of",
];

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(children) => Node::List(children.iter().map(node).collect()),
        _ => panic!("fixture terms must contain strings and arrays only"),
    }
}

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

fn list(items: Vec<Node>) -> Node {
    Node::List(items)
}

fn manifests() -> Vec<LinkedFoundationPackage> {
    let data = fixture();
    data["packages"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(index, item)| LinkedFoundationPackage {
            name: item["name"].as_str().unwrap().to_string(),
            version: item["version"].as_str().unwrap().to_string(),
            source: SOURCES[index].to_string(),
            imports: item["imports"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| PackageImport {
                    name: entry["name"].as_str().unwrap().to_string(),
                    version: entry["version"].as_str().unwrap().to_string(),
                    program: entry["program"].as_str().map(str::to_string),
                    alias: entry["alias"].as_str().map(str::to_string),
                })
                .collect(),
        })
        .collect()
}

fn selection(version: &str) -> PackageSelection {
    PackageSelection {
        name: "modal-frames".to_string(),
        version: version.to_string(),
        instance: "study-lab".to_string(),
    }
}

fn direct() -> FoundationPackages {
    FoundationPackages::from_packages_with_basis(&manifests(), ExecutionBasis::DirectStructural)
        .unwrap()
}

fn query_case(name: &str) -> Value {
    fixture()["queries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == name)
        .unwrap()
        .clone()
}

fn assumptions_of(item: &Value) -> Vec<Node> {
    item["assumptions"]
        .as_array()
        .map(|values| values.iter().map(node).collect())
        .unwrap_or_default()
}

fn ask(packages: &FoundationPackages, version: &str, name: &str) -> PackageResult {
    let item = query_case(name);
    let mut bounds = FoundationBounds::default();
    if let Some(max_facts) = item["maxFacts"].as_u64() {
        bounds.max_facts = max_facts as usize;
    }
    packages
        .ask(
            &selection(version),
            &node(&item["query"]),
            &assumptions_of(&item),
            bounds,
        )
        .unwrap()
}

fn has_hypothesis(proof: &FoundationProof) -> bool {
    proof.program == "<hypothesis>" || proof.premises.iter().any(has_hypothesis)
}

fn origin(packages: &FoundationPackages, address: &str) -> (String, String) {
    let item = packages
        .programs()
        .into_iter()
        .find(|item| item.address == address)
        .unwrap();
    (item.version, item.program)
}

#[test]
fn executes_every_fixture_query_in_all_three_versions_with_distinct_outcomes() {
    let loaded = direct();
    let data = fixture();
    let mut kinds = BTreeSet::new();
    for item in data["queries"].as_array().unwrap() {
        let name = item["name"].as_str().unwrap();
        for (index, version) in VERSIONS.iter().enumerate() {
            let answer = ask(&loaded, version, name);
            let result = &answer.result;
            assert_eq!(result.status, item["statuses"][index], "{name} v{version}");
            assert_eq!(
                result.outcome.kind, item["outcomes"][index],
                "{name} v{version}"
            );
            assert_eq!(result.foundation.name, "modal-frames");
            assert_eq!(result.foundation.version, *version);
            assert_eq!(result.assumptions, assumptions_of(item));
            assert_eq!(result.outcome, FoundationWorkspace::classify_result(result));
            if let Some(used) = item["used"].as_array() {
                assert_eq!(
                    result.outcome.assumptions,
                    used.iter().map(node).collect::<Vec<_>>()
                );
            }
            kinds.insert(result.outcome.kind.to_string());
        }
    }
    for item in data["executions"].as_array().unwrap() {
        let max_steps = item["maxSteps"]
            .as_u64()
            .map_or(10_000, |steps| steps as usize);
        let execution = loaded
            .execute(&selection("1"), &node(&item["term"]), max_steps)
            .unwrap()
            .result;
        assert_eq!(execution.status, item["status"], "{}", item["name"]);
        assert_eq!(execution.outcome.kind, item["outcome"], "{}", item["name"]);
        assert!(!execution.outcome.establishes);
        if item.get("output").is_some() {
            assert_eq!(execution.output, Some(node(&item["output"])));
            assert_eq!(execution.trace.as_ref().unwrap()[0].role, "reduction");
        }
        if let Some(reason) = item["reason"].as_str() {
            assert_eq!(execution.reason, reason);
        }
        kinds.insert(execution.outcome.kind.to_string());
    }
    let expected: Vec<String> = data["outcomeKinds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|kind| kind.as_str().unwrap().to_string())
        .collect();
    let mut sorted = expected.clone();
    sorted.sort();
    assert_eq!(kinds.into_iter().collect::<Vec<_>>(), sorted);
    assert_eq!(
        FoundationWorkspace::outcomes()
            .iter()
            .map(|outcome| outcome.kind.to_string())
            .collect::<Vec<_>>(),
        expected
    );
}

#[test]
fn separates_truth_falsity_contradiction_assumption_dependence_and_non_results() {
    let loaded = direct();
    let lab = ask(&loaded, "1", "lab-reaches-dry").result.outcome;
    assert_eq!(
        (lab.truth, lab.establishes, lab.assumption_dependent),
        ("true", true, false)
    );
    let field = ask(&loaded, "1", "field-dead-end").result.outcome;
    assert_eq!((field.kind, field.truth), ("refuted", "false"));
    let both = ask(&loaded, "1", "field-contradiction-under-assumption").result;
    assert_eq!(both.status, "contradictory");
    assert_eq!(
        (both.outcome.kind, both.outcome.truth),
        ("assumption-dependent", "both")
    );
    let unused = loaded
        .ask(
            &selection("1"),
            &node(&query_case("lab-reaches-dry")["query"]),
            &[list(vec![leaf("dead-end"), leaf("w-unused")])],
            FoundationBounds::default(),
        )
        .unwrap()
        .result;
    assert_eq!(unused.outcome.kind, "proved");
    assert!(unused.outcome.assumptions.is_empty());
    for name in ["home-reaches-dry", "bounded-search", "outside-signature"] {
        let outcome = ask(&loaded, "1", name).result.outcome;
        assert_eq!(
            (outcome.truth, outcome.establishes),
            ("undetermined", false),
            "{name}"
        );
    }
}

#[test]
fn describes_the_user_foundation_rule_content_and_cycle_policy_as_data() {
    let loaded = direct();
    let third = loaded.describe("modal-frames", "3").unwrap();
    assert_eq!(third.cycle_policy.kind, "guarded-coinductive");
    let guard = &third.cycle_policy.guards[0];
    assert_eq!(
        origin(&loaded, &guard.program),
        ("1".to_string(), "frame-rules".to_string())
    );
    assert_eq!(guard.rule, "path-step");
    assert_eq!(
        third
            .roles
            .iter()
            .map(|role| (role.role, origin(&loaded, &role.program).1))
            .collect::<Vec<_>>(),
        vec![
            ("inference", "frame-rules".to_string()),
            ("reduction", "modal-abbreviations".to_string()),
            ("proof", "modal-negation".to_string()),
        ]
    );
    assert_eq!(third.rule_forms.len(), third.rules.len());
    let path_step = third
        .rule_forms
        .iter()
        .find_map(|form| match form {
            Node::List(parts)
                if parts.first() == Some(&leaf("linked-inference"))
                    && parts.get(2) == Some(&leaf("path-step")) =>
            {
                Some(parts[3..].to_vec())
            }
            _ => None,
        })
        .unwrap();
    let clause = |head: &str, value: Node| list(vec![leaf(head), value]);
    let forces = |world: &str, formula: Node| list(vec![leaf("forces-at"), leaf(world), formula]);
    let along = |formula: Node| list(vec![leaf("along-path"), formula]);
    assert_eq!(
        path_step,
        vec![
            clause("premise", forces("?w", leaf("?phi"))),
            clause(
                "premise",
                list(vec![leaf("acc-arrow"), leaf("?w"), leaf("?v")])
            ),
            clause("premise", forces("?v", along(leaf("?phi")))),
            clause("conclusion", forces("?w", along(leaf("?phi")))),
        ]
    );
    let names = |version: &str| -> Vec<Node> {
        loaded
            .describe("modal-frames", version)
            .unwrap()
            .rule_forms
            .iter()
            .filter_map(|form| match form {
                Node::List(parts) => parts.get(2).cloned(),
                Node::Leaf(_) => None,
            })
            .collect()
    };
    assert_eq!(
        loaded
            .describe("modal-frames", "2")
            .unwrap()
            .cycle_policy
            .kind,
        "inductive"
    );
    assert!(names("2").contains(&leaf("acc-compose")));
    assert!(!names("1").contains(&leaf("acc-compose")));
}

fn collect_leaves(term: &Node, output: &mut BTreeSet<String>) {
    match term {
        Node::Leaf(value) => {
            output.insert(value.clone());
        }
        Node::List(children) => children
            .iter()
            .for_each(|child| collect_leaves(child, output)),
    }
}

fn fixture_names() -> Vec<String> {
    let mut names = BTreeSet::new();
    for source in SOURCES {
        let normalized: String = source
            .lines()
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        for form in parse_lino_forms(&normalized).unwrap() {
            collect_leaves(&form, &mut names);
        }
    }
    names
        .into_iter()
        .filter(|name| {
            !name.starts_with('?')
                && !name.chars().all(|character| character.is_ascii_digit())
                && !SCHEMA_WORDS.contains(&name.as_str())
        })
        .collect()
}

fn source_files(root: &Path, directory: &str, extension: &str, output: &mut Vec<(String, String)>) {
    let mut entries: Vec<_> = std::fs::read_dir(root.join(directory))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    entries.sort();
    for entry in entries {
        let relative = format!("{directory}/{entry}");
        let path = root.join(&relative);
        if path.is_dir() {
            source_files(root, &relative, extension, output);
        } else if entry.ends_with(extension) {
            output.push((relative, std::fs::read_to_string(path).unwrap()));
        }
    }
}

fn occurrences(names: &[String], files: &[(String, String)]) -> Vec<String> {
    let mut found = Vec::new();
    for name in names {
        let pattern = Regex::new(&format!(
            "(^|[^A-Za-z0-9_-]){}($|[^A-Za-z0-9_-])",
            regex::escape(name)
        ))
        .unwrap();
        for (path, text) in files {
            if pattern.is_match(text) {
                found.push(format!("{name} in {path}"));
            }
        }
    }
    found
}

/// Identifier-like string literals after comments (and, in JavaScript,
/// template literals) are removed, as in `js/tests/foundation-source-guard.mjs`.
fn identifier_literals(path: &str, text: &str) -> BTreeSet<String> {
    let javascript = path.ends_with(".mjs");
    let block = Regex::new(r"/\*[\s\S]*?\*/").unwrap();
    let line = Regex::new(r#"(^|[^:"'])//[^\n]*"#).unwrap();
    let mut code = line
        .replace_all(&block.replace_all(text, " "), "$1")
        .to_string();
    if javascript {
        code = Regex::new(r"`(?:[^`\\]|\\.)*`")
            .unwrap()
            .replace_all(&code, "``")
            .to_string();
    }
    let pattern = if javascript {
        Regex::new(r#"'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)""#).unwrap()
    } else {
        Regex::new(r#""((?:[^"\\\n]|\\.)*)""#).unwrap()
    };
    let identifier = Regex::new(r"^[a-z][a-z0-9-]*$").unwrap();
    pattern
        .captures_iter(&code)
        .filter_map(|captures| captures.get(1).or_else(|| captures.get(2)))
        .map(|value| value.as_str().to_string())
        .filter(|value| identifier.is_match(value))
        .collect()
}

#[test]
fn keeps_host_foundation_code_free_of_the_unseen_logic_and_of_new_dispatch_keys() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let names = fixture_names();
    assert!(names.len() >= 40);
    for name in ["forces-at", "path-step", "modal-frames"] {
        assert!(names.iter().any(|item| item == name));
    }
    let mut files = Vec::new();
    source_files(&root, "js/src", ".mjs", &mut files);
    source_files(&root, "rust/src", ".rs", &mut files);
    assert!(files.len() > 10);
    assert_eq!(occurrences(&names, &files), Vec::<String>::new());

    let vocabulary: Value = serde_json::from_str(VOCABULARY).unwrap();
    let allowed: BTreeSet<String> = vocabulary["literals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect();
    for module in vocabulary["modules"].as_array().unwrap() {
        let path = module.as_str().unwrap();
        let text = std::fs::read_to_string(root.join(path)).unwrap();
        let unlisted: Vec<String> = identifier_literals(path, &text)
            .into_iter()
            .filter(|value| !allowed.contains(value))
            .collect();
        assert!(
            unlisted.is_empty(),
            "{path} gained identifier-like literals {unlisted:?}; review host-vocabulary.json"
        );
        if path.ends_with(".mjs") {
            assert!(
                !Regex::new(r"\bswitch\s*\(").unwrap().is_match(&text),
                "{path}"
            );
            assert!(
                !Regex::new(r#"\bcase\s+['"]"#).unwrap().is_match(&text),
                "{path}"
            );
        }
    }
    assert!(names.iter().all(|name| !allowed.contains(name)));
    let planted = vec![(
        "rust/src/planted.rs".to_string(),
        "if head == \"forces-at\" { return proved; }".to_string(),
    )];
    assert_eq!(
        occurrences(&["forces-at".to_string()], &planted),
        vec!["forces-at in rust/src/planted.rs".to_string()]
    );
}

#[test]
fn changes_only_the_outcome_governed_by_the_declared_policy_or_frame_condition() {
    let loaded = direct();
    let orbit: Vec<_> = VERSIONS
        .iter()
        .map(|version| ask(&loaded, version, "orbit-dry-path").result)
        .collect();
    assert_eq!(
        orbit.iter().map(|result| result.status).collect::<Vec<_>>(),
        vec!["unknown", "unknown", "proved"]
    );
    assert_eq!(orbit[2].reason, "guarded-coinduction");
    assert!(has_hypothesis(orbit[2].proof.as_ref().unwrap()));
    assert!(orbit[2].outcome.coinductive);
    assert!(orbit[0].coinduction.is_none());
    let home: Vec<_> = VERSIONS
        .iter()
        .map(|version| ask(&loaded, version, "home-reaches-dry").result.status)
        .collect();
    assert_eq!(home, vec!["unknown", "proved", "unknown"]);
    for result in &orbit {
        assert_eq!(result.theory.name, "lab-frame");
    }
}

#[test]
fn rejects_undeclared_and_unknown_cycle_policies_instead_of_defaulting_to_induction() {
    let packages = manifests();
    let mut without = packages[0].clone();
    without.source = without.source.replace("(cycle-policy inductive)", "");
    let error = FoundationPackages::from_packages(&[without]).unwrap_err();
    assert!(error.contains("requires (cycle-policy"), "{error}");
    let mut unknown = packages[0].clone();
    unknown.source = unknown
        .source
        .replace("(cycle-policy inductive)", "(cycle-policy productive-only)");
    let error = FoundationPackages::from_packages(&[unknown]).unwrap_err();
    assert!(
        error.contains("unknown cycle policy productive-only"),
        "{error}"
    );
    let mut theory_guard = packages[2].clone();
    theory_guard.source = theory_guard.source.replace(
        "(guard k-frame path-step)",
        "(guard shared-frame orbit-sees-orbit)",
    );
    let error =
        FoundationPackages::from_packages(&[packages[0].clone(), theory_guard]).unwrap_err();
    assert!(
        error.contains("must name a rule of an inference or typing program"),
        "{error}"
    );
}

#[test]
fn replays_every_established_answer_and_every_non_result_without_searching() {
    let loaded = direct();
    for item in fixture()["queries"].as_array().unwrap() {
        let name = item["name"].as_str().unwrap();
        for version in VERSIONS {
            let answer = ask(&loaded, version, name);
            let replay = loaded.replay(&answer).unwrap();
            assert!(
                replay.replay.accepted,
                "{name} v{version}: {}",
                replay.replay.reason
            );
            assert_eq!(replay.replay.outcome.as_ref(), Some(&answer.result.outcome));
            assert_eq!(replay.replay.foundation.version, version);
            assert_eq!(replay.replay.instance, "study-lab");
        }
    }
    let pattern = loaded
        .ask(
            &selection("2"),
            &list(vec![
                leaf("forces-at"),
                leaf("?w"),
                list(vec![leaf("pos-dia"), leaf("sample-dry")]),
            ]),
            &[],
            FoundationBounds::default(),
        )
        .unwrap();
    let worlds: Vec<Node> = pattern
        .result
        .answers
        .as_ref()
        .unwrap()
        .iter()
        .map(|answer| match &answer.judgement {
            Node::List(parts) => parts[1].clone(),
            Node::Leaf(_) => panic!("answers are links"),
        })
        .collect();
    assert_eq!(
        worlds,
        vec![
            leaf("w-ghost"),
            leaf("w-home"),
            leaf("w-lab"),
            leaf("w-orbit")
        ]
    );
    let replay = loaded.replay(&pattern).unwrap().replay;
    assert!(replay.accepted);
    assert_eq!(
        replay
            .checks
            .iter()
            .map(|check| check.side.as_str())
            .collect::<Vec<_>>(),
        vec!["answer-1", "answer-2", "answer-3", "answer-4"]
    );
}

fn proof(answer: &mut PackageResult) -> &mut FoundationProof {
    answer.result.proof.as_mut().unwrap()
}

fn rejected(
    loaded: &FoundationPackages,
    answer: &PackageResult,
    mutate: impl FnOnce(&mut PackageResult),
) -> &'static str {
    let mut copy = answer.clone();
    mutate(&mut copy);
    loaded.replay(&copy).unwrap().replay.reason
}

#[test]
fn rejects_forged_proof_steps_relabelled_statuses_and_policy_violating_hypotheses() {
    let loaded = direct();
    let home = ask(&loaded, "2", "home-reaches-dry");
    assert_eq!(
        rejected(&loaded, &home, |answer| {
            let Node::List(parts) = &mut proof(answer).premises[2].judgement else {
                panic!("judgement is a link");
            };
            parts[1] = leaf("w-lab");
        }),
        "step-does-not-instantiate-rule"
    );
    assert_eq!(
        rejected(&loaded, &home, |answer| proof(answer).rule =
            "box-elim".to_string()),
        "step-does-not-instantiate-rule"
    );
    assert_eq!(
        rejected(&loaded, &home, |answer| {
            proof(answer).premises.pop();
        }),
        "step-does-not-instantiate-rule"
    );
    assert_eq!(
        rejected(&loaded, &home, |answer| {
            proof(answer).judgement = list(vec![
                leaf("forces-at"),
                leaf("w-lab"),
                list(vec![leaf("pos-dia"), leaf("sample-dry")]),
            ]);
        }),
        "goal-mismatch"
    );
    let wet = ask(&loaded, "1", "lab-wet-by-box");
    assert_eq!(
        rejected(&loaded, &wet, |answer| proof(answer).role = "theory"),
        "role-mismatch"
    );
    let wild = ask(&loaded, "1", "wild-under-assumptions");
    assert_eq!(
        rejected(&loaded, &wild, |answer| {
            answer.result.assumptions[0] = list(vec![
                leaf("valuation-holds"),
                leaf("w-lab"),
                leaf("sample-tame"),
            ]);
        }),
        "forged-assumption"
    );
    let unknown = ask(&loaded, "1", "home-reaches-dry");
    assert_eq!(
        rejected(&loaded, &unknown, |answer| answer.result.status = "proved"),
        "evidence-status-mismatch"
    );
    let field = ask(&loaded, "1", "field-dead-end");
    assert_eq!(
        rejected(&loaded, &field, |answer| answer.result.status = "proved"),
        "evidence-status-mismatch"
    );
    let orbit = ask(&loaded, "3", "orbit-dry-path");
    assert_eq!(
        rejected(&loaded, &orbit, |answer| {
            answer.result.cycle_policy.kind = "inductive";
            answer.result.cycle_policy.guards.clear();
        }),
        "cycle-policy-mismatch"
    );
    assert_eq!(
        rejected(&loaded, &orbit, |answer| answer.result.foundation.version =
            "1".to_string()),
        "foundation-mismatch"
    );
    assert_eq!(
        rejected(&loaded, &orbit, |answer| {
            answer.result.coinduction.as_mut().unwrap().hypothesis = list(vec![
                leaf("forces-at"),
                leaf("w-lab"),
                list(vec![leaf("along-path"), leaf("sample-dry")]),
            ]);
        }),
        "forged-hypothesis"
    );
    let inductive = ask(&loaded, "1", "orbit-dry-path");
    assert_eq!(
        rejected(&loaded, &inductive, |answer| {
            answer.result.status = "proved";
            answer.result.proof = orbit.result.proof.clone();
            answer.result.coinduction = orbit.result.coinduction.clone();
        }),
        "hypothesis-under-inductive-policy"
    );
    assert_eq!(
        rejected(&loaded, &orbit, |answer| {
            let hypothesis = proof(answer).premises[2].clone();
            answer.result.proof = Some(hypothesis);
        }),
        "hypothesis-without-final-guard"
    );
    let lab = ask(&loaded, "3", "lab-reaches-dry");
    assert_eq!(
        rejected(&loaded, &lab, |answer| {
            let premise = &mut proof(answer).premises[2];
            premise.program = "<hypothesis>".to_string();
            premise.rule = "coinductive-hypothesis".to_string();
            premise.role = "hypothesis";
            premise.premises.clear();
        }),
        "forged-hypothesis"
    );
    let foreign = ask(&direct(), "1", "lab-reaches-dry");
    assert!(loaded
        .replay(&foreign)
        .unwrap_err()
        .contains("returned by this package workspace"));
}

#[test]
fn never_lets_one_version_see_assumptions_hypotheses_or_revisions_of_another() {
    let packages = direct();
    let wild = query_case("wild-under-assumptions");
    let query = node(&wild["query"]);
    let assumptions = assumptions_of(&wild);
    let assumed = packages
        .ask(
            &selection("2"),
            &query,
            &assumptions,
            FoundationBounds::default(),
        )
        .unwrap();
    assert_eq!(assumed.result.outcome.kind, "assumption-dependent");
    for version in VERSIONS {
        let plain = packages
            .ask(
                &selection(version),
                &query,
                &[],
                FoundationBounds::default(),
            )
            .unwrap();
        assert_eq!(plain.result.status, "unknown", "{version}");
        assert!(plain.result.assumptions.is_empty());
    }
    ask(&packages, "3", "orbit-dry-path");
    assert_eq!(
        ask(&packages, "1", "orbit-dry-path").result.status,
        "unknown"
    );

    let answers: Vec<PackageResult> = VERSIONS
        .iter()
        .map(|version| {
            packages
                .ask(
                    &selection(version),
                    &query,
                    &assumptions,
                    FoundationBounds::default(),
                )
                .unwrap()
        })
        .collect();
    let revised = packages
        .revise(
            &answers,
            &selection("2"),
            &FoundationChange::ReplaceAssumption {
                from: list(vec![
                    leaf("valuation-holds"),
                    leaf("w-lab"),
                    leaf("sample-wild"),
                ]),
                to: list(vec![
                    leaf("valuation-holds"),
                    leaf("w-lab"),
                    leaf("sample-tame"),
                ]),
            },
        )
        .unwrap();
    assert_eq!(
        revised
            .revisions
            .iter()
            .map(|item| item.action)
            .collect::<Vec<_>>(),
        vec!["kept", "rechecked", "kept"]
    );
    assert_eq!(
        revised
            .revisions
            .iter()
            .map(|item| item.after.result.status)
            .collect::<Vec<_>>(),
        vec!["proved", "unknown", "proved"]
    );
    assert_eq!(revised.revisions[0].after.result.assumptions, assumptions);
    assert_eq!(
        revised.revisions[2].after.result.outcome.assumptions,
        wild["used"]
            .as_array()
            .unwrap()
            .iter()
            .map(node)
            .collect::<Vec<_>>()
    );
    assert_eq!(revised.revisions[1].after.result.outcome.kind, "unknown");
}

#[test]
fn propagates_a_rule_change_through_the_aliased_shared_theory_but_keeps_assumptions_local() {
    let packages = direct();
    let answers: Vec<PackageResult> = VERSIONS
        .iter()
        .map(|version| ask(&packages, version, "lab-reaches-dry"))
        .collect();
    let changed = packages
        .revise(
            &answers,
            &selection("1"),
            &FoundationChange::RemoveRule {
                program: "lab-frame".to_string(),
                rule: "field-is-dry".to_string(),
            },
        )
        .unwrap();
    assert!(changed
        .revisions
        .iter()
        .all(|item| item.changed && item.after.result.status == "unknown"));
    assert!(changed
        .revisions
        .iter()
        .all(|item| item.after.result.assumptions.is_empty()));
    let orbit = ask(&changed.workspace, "3", "orbit-dry-path");
    assert_eq!(orbit.result.status, "proved");
    assert!(changed.workspace.replay(&orbit).unwrap().replay.accepted);
}

#[test]
fn derives_guarded_and_refuted_results_on_the_default_closed_s_k_runtime_and_replays_them() {
    let closed = FoundationPackages::from_packages(&manifests()).unwrap();
    let orbit = ask(&closed, "3", "orbit-dry-path");
    assert_eq!(orbit.result.status, "proved");
    assert_eq!(orbit.result.execution_basis, ExecutionBasis::default());
    assert!(closed.replay(&orbit).unwrap().replay.accepted);
    let field = ask(&closed, "1", "field-dead-end");
    assert_eq!(field.result.outcome.kind, "refuted");
    assert!(closed.replay(&field).unwrap().replay.accepted);
    assert_eq!(ask(&closed, "1", "orbit-dry-path").result.status, "unknown");
}
