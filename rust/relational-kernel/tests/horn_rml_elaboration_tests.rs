//! Mirrors js/tests/horn-rml-elaboration.test.mjs: RML elaboration decided by
//! lib/meta-theory/horn-rml-elaboration.lino on the Horn foundation.
use rml_relational::horn_link_substitution::{self as link, HornLinkSubstitution, Rejection};
use rml_relational::horn_resolution::Options;
use rml_relational::linked_program::{LinkedProgram, LinkedProgramRegistry, LinkedProof};
use rml_relational::relational_kernel::{decode_bits, decode_list, encode_list, encode_programs};
use rml_relational::Node;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("../../../lib/meta-theory/fixed-point-source.lino");
const WORKLOAD: &str = include_str!("../../../test-corpus/lambda-kernel/workload.lino");
const CASES: &str = include_str!("../../../test-corpus/lambda-kernel/cases.json");
const OBSERVATIONS: &str =
    include_str!("../../../test-corpus/kernel-replacement/mechanism-observations.json");
const ELABORATION_CASES: &str =
    include_str!("../../../test-corpus/kernel-replacement/elaboration-cases.json");
const ELABORATION_REPLACEMENTS: &str =
    include_str!("../../../test-corpus/kernel-replacement/elaboration-replacements.json");
const HOST: &str = include_str!("../src/horn_link_substitution.rs");
/// The accepted corpus of elaboration-cases.json, in the same order.
const ACCEPTED: [(&str, &str); 15] = [
    ("test-corpus/lambda-kernel/workload.lino", include_str!("../../../test-corpus/lambda-kernel/workload.lino")),
    ("test-corpus/relational-kernel/workload.lino", include_str!("../../../test-corpus/relational-kernel/workload.lino")),
    ("test-corpus/relational-kernel/fairness.lino", include_str!("../../../test-corpus/relational-kernel/fairness.lino")),
    ("test-corpus/foundation-comparison/sk-laws.lino", include_str!("../../../test-corpus/foundation-comparison/sk-laws.lino")),
    ("test-corpus/foundation-packages/version-one.lino", include_str!("../../../test-corpus/foundation-packages/version-one.lino")),
    ("test-corpus/foundation-packages/version-two.lino", include_str!("../../../test-corpus/foundation-packages/version-two.lino")),
    ("test-corpus/researcher-workflow/theory.lino", include_str!("../../../test-corpus/researcher-workflow/theory.lino")),
    ("test-corpus/researcher-workflow/foundation-one.lino", include_str!("../../../test-corpus/researcher-workflow/foundation-one.lino")),
    ("test-corpus/researcher-workflow/foundation-two.lino", include_str!("../../../test-corpus/researcher-workflow/foundation-two.lino")),
    ("test-corpus/foundations/confidence-context.lino", include_str!("../../../test-corpus/foundations/confidence-context.lino")),
    ("test-corpus/foundations/foundation-context.lino", include_str!("../../../test-corpus/foundations/foundation-context.lino")),
    ("test-corpus/semantic-archive/universe-contracts.lino", include_str!("../../../test-corpus/semantic-archive/universe-contracts.lino")),
    ("lib/meta-theory/formal-propositions.lino", include_str!("../../../lib/meta-theory/formal-propositions.lino")),
    ("lib/meta-theory/formal-definition-context.lino", include_str!("../../../lib/meta-theory/formal-definition-context.lino")),
    ("lib/foundations/confidence.lino", include_str!("../../../lib/foundations/confidence.lino")),
];
const NO_ANSWER: &str = "linked Horn workflow has no answer within the declared search";

fn with_stack<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(512 * 1024 * 1024)
        .spawn(work)
        .unwrap()
        .join()
        .unwrap()
}
fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}
fn fields(node: &Node) -> Vec<Node> {
    match node {
        Node::List(items) => items.clone(),
        Node::Leaf(_) => panic!("expected an encoded record"),
    }
}
fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("invalid shared fixture node"),
    }
}
fn node_json(node: &Node) -> Value {
    match node {
        Node::Leaf(value) => Value::String(value.clone()),
        Node::List(items) => Value::Array(items.iter().map(node_json).collect()),
    }
}
fn proof_json(proof: &LinkedProof) -> Value {
    json!({
        "judgement": node_json(&proof.judgement),
        "program": proof.program,
        "rule": proof.rule,
        "premises": proof.premises.iter().map(proof_json).collect::<Vec<_>>(),
    })
}
fn optional_proof_json(proof: &Option<LinkedProof>) -> Value {
    proof.as_ref().map(proof_json).unwrap_or(Value::Null)
}
fn small() -> Options {
    Options {
        max_steps: 2_000_000,
        ..link::default_options()
    }
}

fn host_programs(text: &str) -> Result<Node, String> {
    let registry = LinkedProgramRegistry::from_rml(text)?;
    let programs: BTreeMap<String, LinkedProgram> = registry
        .names()
        .iter()
        .map(|name| (name.to_string(), registry.program(name).unwrap().clone()))
        .collect();
    Ok(encode_programs(&programs))
}
/// The Rust registry keys programs and rebindings by name, while the linked
/// elaboration keeps source order; both are maps with distinct keys, so the
/// comparison orders programs by name and each rebinding chain by source.
fn by_name(programs: &Node) -> Node {
    let mut entries = decode_list(programs)
        .unwrap()
        .iter()
        .map(|program| {
            let parts = fields(program);
            assert_eq!(parts.len(), 6);
            assert_eq!(parts[0], leaf("program"));
            let imports = decode_list(&parts[5])
                .unwrap()
                .iter()
                .map(|import| {
                    let import = fields(import);
                    let mut chain = decode_list(&import[2]).unwrap();
                    chain.sort_by_key(|rebind| decode_bits(&fields(rebind)[1]).unwrap());
                    Node::List(vec![import[0].clone(), import[1].clone(), encode_list(chain)])
                })
                .collect::<Vec<_>>();
            let name = decode_bits(&parts[1]).unwrap();
            let mut ordered = parts[..5].to_vec();
            ordered.push(encode_list(imports));
            (name, Node::List(ordered))
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    encode_list(entries.into_iter().map(|(_, program)| program).collect())
}

/// Mirrors `hornSourceObservations` in mechanism-matrix.mjs.
fn source_observations(kernel: &HornLinkSubstitution, document: &str) -> Value {
    let run = || -> Result<Value, String> {
        let cases: Value = serde_json::from_str(CASES).unwrap();
        let options = link::default_options();
        let mut reductions = Vec::new();
        for case in cases["reductions"].as_array().unwrap() {
            let result = kernel.reduce_source(
                document,
                case["program"].as_str().unwrap(),
                &node(&case["input"]),
                16,
                &options,
            )?;
            let trace = result
                .trace
                .iter()
                .map(|(program, name)| json!({"program": program, "name": name}))
                .collect::<Vec<_>>();
            reductions.push(json!({"name": case["name"], "term": node_json(&result.term), "trace": trace}));
        }
        let proved = kernel.prove_source(
            document,
            cases["program"].as_str().unwrap(),
            &node(&cases["goal"]),
            &node(&cases["absentGoal"]),
            8,
            &options,
        )?;
        let derivations = proved
            .derivations
            .iter()
            .map(|(judgement, proof)| json!({"judgement": node_json(judgement), "proof": proof_json(proof)}))
            .collect::<Vec<_>>();
        Ok(json!({
            "reductions": reductions, "derivations": derivations,
            "proof": optional_proof_json(&proved.proof), "absentProof": optional_proof_json(&proved.absent_proof),
            "known": proved.known, "fixedPoint": true,
        }))
    };
    run().unwrap_or_else(|error| json!({"error": error}))
}
/// Mirrors `changedObservations` in mechanism-matrix.mjs.
fn changed_observations(before: &Value, after: &Value) -> Vec<String> {
    if before.get("error").is_some() || after.get("error").is_some() {
        return if before.get("error") == after.get("error") { vec![] } else { vec!["error".into()] };
    }
    let mut changed = Vec::new();
    for (index, item) in before["reductions"].as_array().unwrap().iter().enumerate() {
        if Some(item) != after["reductions"].as_array().unwrap().get(index) {
            changed.push(format!("reduction:{}", item["name"].as_str().unwrap()));
        }
    }
    for key in ["derivations", "proof", "absentProof", "known", "fixedPoint"] {
        if before[key] != after[key] {
            changed.push(key.to_string());
        }
    }
    changed
}
/// Mirrors `applyElaborationReplacement` in mechanism-matrix.mjs.
fn apply_replacement(replacement: &Value) -> (String, String) {
    let mut changed = link::ELABORATION_SOURCE.to_string();
    for edit in replacement["replace"].as_array().unwrap() {
        let (before, after) = (edit[0].as_str().unwrap(), edit[1].as_str().unwrap());
        assert_eq!(changed.matches(before).count(), 1, "stale elaboration replacement");
        changed = changed.replacen(before, after, 1);
    }
    let mut spelled = WORKLOAD.to_string();
    for edit in replacement["workloadEdit"].as_array().unwrap() {
        spelled = spelled.replace(edit[0].as_str().unwrap(), edit[1].as_str().unwrap());
    }
    (changed, spelled)
}
fn without_clause(text: &str, prefix: &str, lines: usize) -> String {
    let mut output = Vec::new();
    let mut skip = 0;
    for line in text.lines() {
        if skip > 0 {
            skip -= 1;
            continue;
        }
        if line.starts_with(prefix) {
            skip = lines - 1;
            continue;
        }
        output.push(line);
    }
    output.join("\n")
}

#[test]
fn linked_elaboration_builds_exactly_the_host_registry_programs_for_the_accepted_corpus() {
    with_stack(|| {
        let cases: Value = serde_json::from_str(ELABORATION_CASES).unwrap();
        let listed = cases["accepted"].as_array().unwrap();
        assert_eq!(listed.len(), ACCEPTED.len());
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        let options = link::default_options();
        let mut documents = Vec::new();
        for (index, (path, text)) in ACCEPTED.iter().enumerate() {
            assert_eq!(listed[index].as_str().unwrap(), *path);
            documents.push((path.to_string(), text.to_string()));
        }
        for item in cases["inline"].as_array().unwrap() {
            documents.push((
                item["name"].as_str().unwrap().to_string(),
                item["source"].as_str().unwrap().to_string(),
            ));
        }
        assert!(documents.len() >= 17);
        for (name, text) in documents {
            let elaborated = kernel.elaborate(&text, &options).unwrap();
            assert_eq!(elaborated.rejection, None, "{name}");
            assert_eq!(
                by_name(&elaborated.programs.unwrap()),
                by_name(&host_programs(&text).unwrap()),
                "{name}"
            );
        }
    });
}

#[test]
fn linked_elaboration_rejects_invalid_documents_for_the_same_reasons_as_the_host_registry() {
    with_stack(|| {
        let cases: Value = serde_json::from_str(ELABORATION_CASES).unwrap();
        let rejected = cases["rejected"].as_array().unwrap();
        assert_eq!(rejected.len(), 12);
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        let options = link::default_options();
        for item in rejected {
            let name = item["name"].as_str().unwrap();
            let text = item["source"].as_str().unwrap();
            let host = host_programs(text).unwrap_err();
            assert!(host.contains(item["host"].as_str().unwrap()), "{name}: {host}");
            let expected = Rejection {
                reason: item["reason"].as_str().unwrap().to_string(),
                detail: item["detail"].as_str().unwrap().to_string(),
            };
            let elaborated = kernel.elaborate(text, &options).unwrap();
            assert_eq!(elaborated.programs, None, "{name}");
            assert_eq!(elaborated.rejection, Some(expected.clone()), "{name}");
            let error = kernel
                .reduce_source(text, "a", &leaf("x"), 16, &options)
                .unwrap_err();
            assert_eq!(
                error,
                format!("linked elaboration rejected the document: {} {}", expected.reason, expected.detail),
                "{name}"
            );
        }
    });
}

#[test]
fn documents_outside_the_linked_form_shapes_have_no_linked_elaboration() {
    with_stack(|| {
        let cases: Value = serde_json::from_str(ELABORATION_CASES).unwrap();
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        for item in cases["unelaborated"].as_array().unwrap() {
            let name = item["name"].as_str().unwrap();
            let text = item["source"].as_str().unwrap();
            assert!(host_programs(text).is_err(), "{name}");
            assert_eq!(kernel.elaborate(text, &small()).unwrap_err(), NO_ANSWER, "{name}");
        }
    });
}

#[test]
fn source_workflows_reproduce_the_shared_observations_with_no_host_rml_elaboration() {
    with_stack(|| {
        let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
        let kernel = HornLinkSubstitution::new(SOURCE).unwrap();
        assert_eq!(source_observations(&kernel, WORKLOAD), shared["baseline"]);
        let options = link::default_options();
        assert_eq!(
            kernel.reduce_source(WORKLOAD, "absent", &leaf("x"), 16, &options).unwrap_err(),
            "linked-program absent is missing"
        );
        let error = kernel
            .prove_source(
                "(linked-program a)\n(linked-rewrite b r (from x) (to y))",
                "a",
                &leaf("x"),
                &leaf("y"),
                8,
                &options,
            )
            .unwrap_err();
        assert_eq!(error, "linked elaboration rejected the document: unknown-program b");
    });
}

#[test]
fn replacing_a_linked_language_decision_changes_execution_with_every_host_file_unchanged() {
    with_stack(|| {
        let shared: Value = serde_json::from_str(OBSERVATIONS).unwrap();
        let replacements: Value = serde_json::from_str(ELABORATION_REPLACEMENTS).unwrap();
        let replacements = replacements["replacements"].as_array().unwrap();
        assert_eq!(replacements.len(), 2);
        let options = link::default_options();
        for replacement in replacements {
            let id = replacement["id"].as_str().unwrap();
            let (elaboration, document) = apply_replacement(replacement);
            assert_ne!(document, WORKLOAD, "{id}");
            let kernel =
                HornLinkSubstitution::from_all_sources(SOURCE, link::SOURCE, &elaboration).unwrap();
            assert_eq!(source_observations(&kernel, &document), shared["baseline"], "{id}");
            let original = source_observations(&kernel, WORKLOAD);
            assert!(original.get("error").is_none(), "{id}");
            let expected = replacement["originalWorkloadChanges"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item.as_str().unwrap().to_string())
                .collect::<Vec<_>>();
            assert_eq!(changed_observations(&shared["baseline"], &original), expected, "{id}");
            let replaced = kernel.elaborate(&document, &options).unwrap();
            assert_eq!(replaced.rejection, None, "{id}");
            assert_ne!(
                by_name(&host_programs(&document).unwrap()),
                by_name(&replaced.programs.unwrap()),
                "{id}"
            );
        }
    });
}

#[test]
fn removing_a_linked_language_decision_removes_the_elaboration_it_decided() {
    with_stack(|| {
        let without_sigil = without_clause(link::ELABORATION_SOURCE, "(horn-clause variable-sigil ", 1);
        assert!(without_sigil.len() < link::ELABORATION_SOURCE.len());
        let kernel = HornLinkSubstitution::from_all_sources(SOURCE, link::SOURCE, &without_sigil).unwrap();
        assert_eq!(kernel.elaborate(WORKLOAD, &small()).unwrap_err(), NO_ANSWER);
        let without_keyword =
            without_clause(link::ELABORATION_SOURCE, "(horn-clause keyword-linked-program ", 2);
        assert!(without_keyword.len() < link::ELABORATION_SOURCE.len());
        let kernel = HornLinkSubstitution::from_all_sources(SOURCE, link::SOURCE, &without_keyword).unwrap();
        assert_eq!(kernel.elaborate(WORKLOAD, &small()).unwrap_err(), NO_ANSWER);
    });
}

#[test]
fn the_source_workflow_host_takes_no_rml_decision_and_lists_every_residual_host_law() {
    with_stack(|| {
        for name in [
            "\"linked-rewrite\"",
            "\"linked-program\"",
            "\"linked-fact\"",
            "\"linked-inference\"",
            "\"uses\"",
            "\"rebind\"",
            "\"from\"",
            "\"premise\"",
            "starts_with('?')",
        ] {
            assert!(!HOST.contains(name), "source-workflow host mentions {name}");
        }
        let report = HornLinkSubstitution::new(SOURCE).unwrap().trust_report();
        let elaboration = &report["sourceElaboration"];
        assert_eq!(elaboration["hostRegistryElaborationOnThisPath"], json!(false));
        assert_eq!(elaboration["residualHostLaws"], json!(link::RESIDUAL_HOST_LAWS));
        assert_eq!(elaboration["residualHostLaws"].as_array().unwrap().len(), 7);
        assert_eq!(elaboration["linkedDecisions"].as_array().unwrap().len(), 7);
        let digest = elaboration["elaborationSourceSha256"].as_str().unwrap();
        assert_eq!(digest.len(), 64);
        assert!(digest.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(report["fullImplementationClosure"], json!(false));
    });
}
