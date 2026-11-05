//! Researcher recipe for the pinned upstream meta-theory corpus, the source
//! specifications of types, graphs and relational algebra, and an unseen
//! user-defined logic, through public Rust APIs only. Mirrors
//! examples/meta-theory-workflow.mjs and produces the same report
//! (test-corpus/researcher-workflow/meta-theory-expected.json).
use rml::formal_corpus::FormalCorpus;
use rml::foundation_packages::{FoundationPackages, LinkedFoundationPackage, PackageImport, PackageSelection};
use rml::foundation_workspace::FoundationBounds;
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::meta_theory_certificates::{certificate_registries, check_meta_theory_certificate};
use rml::meta_theory_native::{
    binary_natural, compact_native, expand_native, is_native_value, native_registry, render_native_value,
    META_THEORY_NATIVE_PROGRAM, NATIVE_MAX_STEPS,
};
use rml::spec_certificates::{check_spec_certificate, spec_evaluate, spec_registries, spec_term, spec_theorems};
use rml::Node;
use serde_json::{json, Value};

const SOURCE: &str = include_str!("../../lib/meta-theory/upstream-0.0.3.lino");
const FOUNDATION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-foundation.lino");
const PRELUDE: &str = include_str!("../../lib/meta-theory/meta-theory-native-prelude.lino");
const PROGRAM: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native.lino");
const CONVERSION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native-conversion.lino");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const NATURAL: &str = include_str!("../../lib/meta-theory/proof-verifier-natural.lino");
const MAP: &str = include_str!("../../test-corpus/meta-theory-coverage/map.json");
const CASES: &str = include_str!("../../test-corpus/meta-theory-native/cases.json");
const COVERAGE: &str = include_str!("../../test-corpus/meta-theory-native/coverage.json");
const CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-certificates/certificates.json");
const TYPE_SPECIFICATION: &str = include_str!("../../lib/meta-theory/type-specification.lino");
const GRAPH_SPECIFICATION: &str = include_str!("../../lib/meta-theory/graph-specification.lino");
const ALGEBRA_SPECIFICATION: &str = include_str!("../../lib/meta-theory/relational-algebra-specification.lino");
const SPEC_CASES: &str = include_str!("../../test-corpus/meta-theory-specifications/cases.json");
const SPEC_CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-specifications/certificates.json");
const UNSEEN: &str = include_str!("../../test-corpus/foundation-packages/unseen-modal-frames.json");
const UNSEEN_SOURCES: [&str; 3] = [
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-1.lino"),
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-2.lino"),
    include_str!("../../test-corpus/foundation-packages/unseen-modal-frames-3.lino"),
];

pub const MAPPED_DECLARATION: &str = "rml.formal.lean.SetSequenceEquivalence.toOrderedUnique";
pub const UPSTREAM_COMMAND: &str = "rml.formal.lean.NetworkExamples#command-17";
pub const CERTIFIED_THEOREM: &str = "rml.formal.lean.SetSequenceEquivalence.set_sequence_equivalence";
pub const UNSEEN_QUERY: &str = "home-reaches-dry";
/// The theorem of each source specification whose statement the report shows.
pub const SPEC_SAMPLES: [(&str, &str); 3] = [
    ("type-specification", "preservation-swap"),
    ("graph-specification", "reach-transitive-cycle"),
    ("relational-algebra-specification", "join-associative"),
];

fn parse(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|error| error.to_string())
}

pub fn node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(children) => Node::List(children.iter().map(node).collect()),
        _ => Node::Leaf(value.to_string()),
    }
}

fn leaf(text: &str) -> Node {
    Node::Leaf(text.to_string())
}

/// A natural-number list as a native value: (mt-v (mt-cons n ... mt-nil)).
pub fn native_list(numbers: &[u64]) -> Node {
    let raw = numbers
        .iter()
        .rev()
        .fold(leaf("mt-nil"), |tail, number| Node::List(vec![leaf("mt-cons"), binary_natural(*number), tail]));
    Node::List(vec![leaf("mt-v"), raw])
}

pub fn native_call(registry: &LinkedProgramRegistry, address: &str, args: Vec<Node>) -> Result<Node, String> {
    let mut term = vec![leaf(address)];
    term.extend(args);
    let reduced = registry.reduce_result(META_THEORY_NATIVE_PROGRAM, &Node::List(term), NATIVE_MAX_STEPS)?;
    if !is_native_value(&reduced.term) {
        return Err(format!("{address} did not reach a value"));
    }
    Ok(reduced.term)
}

/// Theorem dependencies recorded in the native coverage (references that are theorems).
pub fn theorem_dependencies(coverage: &Value, address: &str) -> Vec<String> {
    let declarations = coverage["declarations"].as_array().cloned().unwrap_or_default();
    let theorems: Vec<&str> = declarations
        .iter()
        .filter(|entry| entry["kind"] == "theorem")
        .filter_map(|entry| entry["address"].as_str())
        .collect();
    declarations
        .iter()
        .find(|entry| entry["address"] == address)
        .and_then(|entry| entry["references"].as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| theorems.contains(item))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn find<'a>(items: &'a Value, field: &str, value: &str) -> Result<&'a Value, String> {
    items
        .as_array()
        .and_then(|entries| entries.iter().find(|entry| entry[field] == value))
        .ok_or_else(|| format!("missing {field} {value}"))
}

/// The specification sources in program order; `overrides` replaces a program's source.
pub fn specification_sources(overrides: &[(&str, &str)]) -> Vec<(&'static str, String)> {
    [
        ("type-specification", TYPE_SPECIFICATION),
        ("graph-specification", GRAPH_SPECIFICATION),
        ("relational-algebra-specification", ALGEBRA_SPECIFICATION),
    ]
    .into_iter()
    .map(|(program, source)| {
        let replaced = overrides.iter().find(|(name, _)| *name == program).map(|(_, text)| text.to_string());
        (program, replaced.unwrap_or_else(|| source.to_string()))
    })
    .collect()
}

/// Execute every recorded specification case natively and re-check every
/// specification certificate, then show that a mutated certificate fails.
pub fn run_specifications(sources: &[(&'static str, String)]) -> Result<Value, String> {
    let specs: Vec<(&str, &str)> = sources.iter().map(|(program, source)| (*program, source.as_str())).collect();
    let registries = spec_registries(&specs, UNIVERSAL, VERIFIER, NATURAL)?;
    let cases = parse(SPEC_CASES)?;
    let certificates = parse(SPEC_CERTIFICATES)?;
    let cases = cases["cases"].as_array().cloned().unwrap_or_default();
    let certificates = certificates["certificates"].as_array().cloned().unwrap_or_default();
    let mut report = Vec::new();
    for (program, sample_theorem) in SPEC_SAMPLES {
        let own: Vec<&Value> = cases.iter().filter(|item| item["program"] == program).collect();
        let mut reproduced = 0;
        for item in &own {
            let reduced = spec_evaluate(&registries, program, &spec_term(&item["request"])?)?;
            if reduced.term == spec_term(&item["expected"])? && reduced.steps as u64 == item["steps"].as_u64().unwrap_or(u64::MAX) {
                reproduced += 1;
            }
        }
        let mut certified = Vec::new();
        for item in certificates.iter().filter(|item| item["program"] == program) {
            if check_spec_certificate(&registries, &item["certificate"])?.accepted {
                certified.push(item["theorem"].clone());
            }
        }
        let sample = &certificates
            .iter()
            .find(|item| item["program"] == program && item["theorem"] == sample_theorem)
            .ok_or_else(|| format!("missing certificate {program}.{sample_theorem}"))?["certificate"];
        let mut mutated = sample.clone();
        let last = mutated["facts"].as_array().map(Vec::len).unwrap_or(0).saturating_sub(1);
        mutated["facts"][last]["value"] = json!("mutated");
        report.push(json!({
            "program": program,
            "cases": own.len(),
            "negativeCases": own.iter().filter(|item| item["polarity"] == "negative").count(),
            "casesReproduced": reproduced,
            "theorems": spec_theorems(&registries, program)?,
            "certified": certified,
            "sample": { "theorem": sample_theorem, "statement": spec_term(&sample["goal"])?.to_string() },
            "mutatedCertificateAccepted": check_spec_certificate(&registries, &mutated)?.accepted,
        }));
    }
    Ok(Value::Array(report))
}

fn unseen_packages(fixture: &Value) -> Result<FoundationPackages, String> {
    let manifests: Vec<LinkedFoundationPackage> = fixture["packages"]
        .as_array()
        .ok_or("unseen fixture lists packages")?
        .iter()
        .enumerate()
        .map(|(index, item)| LinkedFoundationPackage {
            name: item["name"].as_str().unwrap_or("").to_string(),
            version: item["version"].as_str().unwrap_or("").to_string(),
            source: UNSEEN_SOURCES[index].to_string(),
            imports: item["imports"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|entry| PackageImport {
                    name: entry["name"].as_str().unwrap_or("").to_string(),
                    version: entry["version"].as_str().unwrap_or("").to_string(),
                    program: entry["program"].as_str().map(str::to_string),
                    alias: entry["alias"].as_str().map(str::to_string),
                })
                .collect(),
        })
        .collect();
    FoundationPackages::from_packages_with_basis(&manifests, ExecutionBasis::DirectStructural)
}

pub fn run() -> Result<Value, String> {
    // 1. Inspect where one upstream declaration stands in every stage.
    let map = parse(MAP)?;
    let row = find(&map["declarations"], "address", MAPPED_DECLARATION)?;
    let corpus = FormalCorpus::from_rml(SOURCE, FOUNDATION)?;

    // 2. Execute an upstream evaluation command natively, against its Rocq counterpart.
    let registry = native_registry(PRELUDE, PROGRAM)?;
    let cases = parse(CASES)?;
    let recorded = find(&cases["cases"], "id", &format!("{UPSTREAM_COMMAND}-execution"))?;
    let executed = registry.reduce_result(META_THEORY_NATIVE_PROGRAM, &expand_native(&node(&recorded["request"])), NATIVE_MAX_STEPS)?;
    let counterpart = find(&cases["cases"], "id", recorded["counterpart"].as_str().unwrap_or(""))?;
    let counterpart_run =
        registry.reduce_result(META_THEORY_NATIVE_PROGRAM, &expand_native(&node(&counterpart["request"])), NATIVE_MAX_STEPS)?;

    // 3. Run upstream definitions on the researcher's own data, in both languages.
    let mut new_data = Vec::new();
    for language in ["lean", "rocq"] {
        let module = format!("rml.formal.{language}.SetSequenceEquivalence");
        let ordered = native_call(&registry, &format!("{module}.toOrderedUnique"), vec![native_list(&[3, 1, 2, 3])])?;
        new_data.push(json!({
            "language": language, "definition": "toOrderedUnique", "input": [3, 1, 2, 3],
            "value": render_native_value(&ordered, language),
        }));
        for input in [vec![1u64, 2, 3], vec![2, 1]] {
            let decided = native_call(&registry, &format!("{module}.IsOrderedUniqueSequence"), vec![native_list(&input)])?;
            new_data.push(json!({
                "language": language, "definition": "IsOrderedUniqueSequence", "input": input,
                "value": render_native_value(&decided, language),
            }));
        }
    }

    // 4. Re-check a proof certificate and see which upstream admissions it is relative to.
    let certificates = parse(CERTIFICATES)?;
    let certified = find(&certificates["theorems"], "theorem", CERTIFIED_THEOREM)?;
    let registries = certificate_registries(PRELUDE, PROGRAM, CONVERSION, UNIVERSAL, VERIFIER, NATURAL)?;
    let dependencies = theorem_dependencies(&parse(COVERAGE)?, CERTIFIED_THEOREM);
    let checked = check_meta_theory_certificate(&registries, &certified["certificate"], &dependencies)?;
    let mut forged = certified["certificate"].clone();
    forged["candidate"][4][0][3] = json!(["holds", ["mt-v", "mt-true"]]);
    let forged_check = check_meta_theory_certificate(&registries, &forged, &dependencies)?;
    let relative_to: Vec<String> = certified["chain"]["relativeTo"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|item| {
            format!(
                "{} ({})",
                item["address"].as_str().unwrap_or(""),
                item["upstreamProofStatus"].as_str().unwrap_or("")
            )
        })
        .collect();

    // 5. Ask one question of an unseen links-only logic in three versions and replay each answer.
    let fixture = parse(UNSEEN)?;
    let packages = unseen_packages(&fixture)?;
    let query = node(&find(&fixture["queries"], "name", UNSEEN_QUERY)?["query"]);
    let instance = fixture["instance"].as_str().unwrap_or("").to_string();
    let mut answers = Vec::new();
    for item in fixture["packages"].as_array().cloned().unwrap_or_default() {
        let version = item["version"].as_str().unwrap_or("").to_string();
        let selection = PackageSelection { name: "modal-frames".to_string(), version: version.clone(), instance: instance.clone() };
        let answer = packages.ask(&selection, &query, &[], FoundationBounds::default())?;
        let replay = packages.replay(&answer)?;
        answers.push(json!({
            "version": version, "status": answer.result.status, "outcome": answer.result.outcome.kind,
            "replayAccepted": replay.replay.accepted,
        }));
    }

    // 6. Execute the type, graph and relational-algebra specifications natively and re-check their certificates.
    let specifications = run_specifications(&specification_sources(&[]))?;

    Ok(json!({
        "schema": "rml-meta-theory-workflow/v1",
        "corpus": { "declarations": corpus.declarations().len(), "fingerprint": corpus.fingerprint() },
        "map": {
            "declarations": map["counts"]["declarations"],
            "commands": map["counts"]["commands"],
            "row": {
                "address": row["address"],
                "typedElaboration": row["typedElaboration"]["status"],
                "nativeElaboration": row["nativeElaboration"]["status"],
                "dependencyCheck": row["dependencyCheck"]["status"],
                "nativeExecution": row["nativeExecution"]["status"],
                "proof": row["proof"]["status"],
            },
        },
        "upstreamCommand": {
            "id": UPSTREAM_COMMAND,
            "value": render_native_value(&executed.term, "lean"),
            "matchesRecordedCase": compact_native(&executed.term) == node(&recorded["expected"])
                && executed.steps as u64 == recorded["steps"].as_u64().unwrap_or(u64::MAX),
            "counterpart": counterpart["command"],
            "counterpartValue": render_native_value(&counterpart_run.term, "rocq"),
            "counterpartAgrees": recorded["counterpartAgrees"],
        },
        "newData": new_data,
        "certificate": {
            "theorem": CERTIFIED_THEOREM,
            "accepted": checked.accepted,
            "chain": certified["chain"]["status"],
            "relativeTo": relative_to,
            "forgedConclusionAccepted": forged_check.accepted,
        },
        "unseenLogic": { "query": UNSEEN_QUERY, "answers": answers },
        "specifications": specifications,
    }))
}

#[allow(dead_code)]
fn main() -> Result<(), String> {
    let report = std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(run)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|_| "meta-theory workflow panicked".to_string())??;
    println!("{}", serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?);
    Ok(())
}
