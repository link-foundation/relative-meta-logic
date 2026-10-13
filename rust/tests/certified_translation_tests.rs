//! Shared-corpus tests for the Rust mirror of the certificate integrity checker.
//! The certificates are produced by the JavaScript pipeline; Rust must parse,
//! re-serialize and integrity-check exactly the same Links documents.
use rml::certified_translation::{
    check_certificate_integrity, check_refusal_integrity, read_links_document, serialize_links,
    sha256_hex, CertificateInputs, LinksNode, CERTIFIED_LANGUAGES, LOWERING_KINDS, REFUSAL_STAGES,
    SURFACE_LOWERING_SCHEMA,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn corpus_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../test-corpus/certified-translation")
        .join(relative)
}

fn read(relative: &str) -> String {
    fs::read_to_string(corpus_path(relative)).unwrap_or_else(|error| panic!("{relative}: {error}"))
}

fn corpus() -> Value {
    serde_json::from_str(&read("cases.json")).unwrap()
}

struct Translator {
    commit: String,
    lock_sha256: String,
}

fn translator() -> Translator {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/vendor/meta-language-pr201/upstream-files.json");
    let bytes = fs::read(path).unwrap();
    let lock: Value = serde_json::from_slice(&bytes).unwrap();
    Translator {
        commit: lock["commit"].as_str().unwrap().to_string(),
        lock_sha256: sha256_hex(&bytes),
    }
}

fn extension(language: &str) -> &'static str {
    match language {
        "JavaScript" => "js",
        "Rust" => "rs",
        "Lean" => "lean",
        _ => "v",
    }
}

struct Case {
    name: String,
    language: String,
    source: String,
}

fn translations() -> Vec<Case> {
    corpus()["translations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| Case {
            name: item["name"].as_str().unwrap().to_string(),
            language: item["language"].as_str().unwrap().to_string(),
            source: read(item["source"].as_str().unwrap()),
        })
        .collect()
}

fn generated(relative: &str) -> String {
    read(&format!("generated/{relative}"))
}

fn certificate_files(case: &Case, target: &str) -> (String, String, String) {
    let stem = format!("{}/{}", case.name, target.to_lowercase());
    (
        generated(&format!("{stem}.certificate.lino")),
        generated(&format!("{stem}.{}", extension(target))),
        generated(&format!("{}/intermediate.lino", case.name)),
    )
}

fn check(certificate: &str, case: &Case, target: Option<&str>, intermediate: Option<&str>, translator: &Translator) -> Vec<&'static str> {
    check_certificate_integrity(
        certificate,
        CertificateInputs {
            source: &case.source,
            target,
            intermediate,
            translator_commit: &translator.commit,
            translator_lock_sha256: &translator.lock_sha256,
        },
    )
    .codes()
}

fn items_mut(node: &mut LinksNode) -> &mut Vec<LinksNode> {
    match node {
        LinksNode::List(items) => items,
        LinksNode::Atom(_) => panic!("expected a list"),
    }
}

fn section_mut<'a>(node: &'a mut LinksNode, name: &str) -> &'a mut LinksNode {
    items_mut(node)
        .iter_mut()
        .find(|item| item.head() == Some(name))
        .unwrap_or_else(|| panic!("missing section {name}"))
}

fn set_field(node: &mut LinksNode, name: &str, value: &str) {
    let field = section_mut(node, name);
    items_mut(field)[1] = LinksNode::Atom(value.to_string());
}

/// Edit a certificate and re-sign its canonical digest, as a forger would.
fn forge(certificate: &str, edit: impl FnOnce(&mut LinksNode)) -> String {
    let mut form = read_links_document(certificate).unwrap().remove(0);
    edit(&mut form);
    let items = items_mut(&mut form);
    items.retain(|item| item.head() != Some("digest"));
    let body = LinksNode::List(items.clone());
    let digest = sha256_hex(serialize_links(&body).as_bytes());
    items.push(LinksNode::List(vec![
        LinksNode::Atom("digest".to_string()),
        LinksNode::Atom("sha256".to_string()),
        LinksNode::Atom(digest),
    ]));
    serialize_links(&form)
}

fn obligation_mut<'a>(form: &'a mut LinksNode, id: &str) -> &'a mut LinksNode {
    items_mut(section_mut(form, "obligations"))
        .iter_mut()
        .find(|item| item.field("id") == Some(id))
        .unwrap_or_else(|| panic!("missing obligation {id}"))
}

#[test]
fn every_certificate_round_trips_through_the_rust_links_reader() {
    for case in translations() {
        for target in CERTIFIED_LANGUAGES.iter().filter(|target| **target != case.language) {
            let (certificate, _, _) = certificate_files(&case, target);
            let forms = read_links_document(&certificate).unwrap();
            assert_eq!(forms.len(), 1);
            assert_eq!(serialize_links(&forms[0]), certificate, "{} {target}", case.name);
        }
    }
}

#[test]
fn every_committed_certificate_passes_the_integrity_mirror() {
    let translator = translator();
    let mut paths = std::collections::BTreeSet::new();
    for case in translations() {
        for target in CERTIFIED_LANGUAGES.iter().filter(|target| **target != case.language) {
            let (certificate, emitted, intermediate) = certificate_files(&case, target);
            assert_eq!(
                check(&certificate, &case, Some(emitted.as_str()), Some(intermediate.as_str()), &translator),
                Vec::<&str>::new(),
                "{} to {target}",
                case.name
            );
            paths.insert(format!("{}->{target}", case.language));
        }
    }
    assert_eq!(paths.len(), 12, "all twelve directed paths are certified");
}

#[test]
fn forged_stale_and_mismatched_certificates_are_rejected() {
    let translator = translator();
    let cases = translations();
    let case = cases.iter().find(|case| case.name == "lean-list").unwrap();
    let (certificate, emitted, intermediate) = certificate_files(case, "Rust");
    let other = cases.iter().find(|case| case.name == "lean-tree").unwrap();
    let (_, other_target, other_intermediate) = certificate_files(other, "Rust");

    let unsigned = certificate.replacen("(status open)", "(status discharged)", 1);
    assert!(check(&unsigned, case, None, None, &translator).contains(&"RML_CERT_DIGEST"));

    let forged = forge(&certificate, |form| {
        let obligation = obligation_mut(form, "theorem:add_zero_right");
        set_field(obligation, "status", "discharged");
    });
    assert!(check(&forged, case, None, None, &translator).contains(&"RML_CERT_OBLIGATION_FORGED"));

    let kernel = forge(&certificate, |form| {
        let obligation = obligation_mut(form, "emitter-faithfulness");
        set_field(obligation, "status", "discharged");
        set_field(obligation, "by", "rml-evaluation");
    });
    assert!(check(&kernel, case, None, None, &translator).contains(&"RML_CERT_OBLIGATION_FORGED"));

    let dropped = forge(&certificate, |form| {
        items_mut(section_mut(form, "obligations")).retain(|item| item.field("id") != Some("theorem:add_zero_right"));
    });
    let codes = check(&dropped, case, None, None, &translator);
    assert!(codes.contains(&"RML_CERT_OBLIGATION_DROPPED"));
    assert!(codes.contains(&"RML_CERT_VERDICT"));

    let stale = Case {
        name: case.name.clone(),
        language: case.language.clone(),
        source: case.source.replace("NatList.cons 10", "NatList.cons 11"),
    };
    assert!(check(&certificate, &stale, None, None, &translator).contains(&"RML_CERT_SOURCE_HASH"));
    assert!(check(&certificate, case, Some(other_target.as_str()), None, &translator).contains(&"RML_CERT_TARGET_HASH"));
    assert!(check(&certificate, case, Some(emitted.as_str()), Some(other_intermediate.as_str()), &translator).contains(&"RML_CERT_INTERMEDIATE"));
    assert!(check(&certificate, other, None, None, &translator).contains(&"RML_CERT_CORRESPONDENCE"));
    assert_eq!(check(&certificate, case, Some(emitted.as_str()), Some(intermediate.as_str()), &translator), Vec::<&str>::new());

    let relabelled = forge(&certificate, |form| set_field(section_mut(form, "source"), "language", "Rocq"));
    assert!(check(&relabelled, case, None, None, &translator).contains(&"RML_CERT_SOURCE_LANGUAGE"));
    let granted = forge(&certificate, |form| set_field(section_mut(form, "authority"), "traits", "granted"));
    assert!(check(&granted, case, None, None, &translator).contains(&"RML_CERT_AUTHORITY"));
    let stale_pin = forge(&certificate, |form| set_field(section_mut(form, "translator"), "lock-sha256", &"0".repeat(64)));
    assert!(check(&stale_pin, case, None, None, &translator).contains(&"RML_CERT_TRANSLATOR"));
    let weakened = forge(&certificate, |form| {
        items_mut(section_mut(form, "preservation")).retain(|item| item.head() != Some("ownership"));
    });
    assert!(check(&weakened, case, None, None, &translator).contains(&"RML_CERT_PRESERVATION"));
    let observed = forge(&certificate, |form| {
        let observation = section_mut(form, "observation");
        let line = items_mut(observation)
            .iter_mut()
            .find(|item| item.head() == Some("line"))
            .unwrap();
        items_mut(line)[1] = LinksNode::Atom("4".to_string());
    });
    assert!(check(&observed, case, None, None, &translator).contains(&"RML_CERT_OBSERVATION"));
    assert!(check("(unclosed", case, None, None, &translator).contains(&"RML_CERT_SYNTAX"));
    assert!(check("(not a certificate)", case, None, None, &translator).contains(&"RML_CERT_SCHEMA"));
}

#[test]
fn refusal_receipts_retain_the_source_and_reject_tampering() {
    let translator = translator();
    let corpus = corpus();
    for item in corpus["refusals"].as_array().unwrap() {
        let name = item["name"].as_str().unwrap();
        let language = item["language"].as_str().unwrap();
        let source = read(item["source"].as_str().unwrap());
        for target in CERTIFIED_LANGUAGES.iter().filter(|target| **target != language) {
            let receipt = generated(&format!("refusals/{name}.{}.refusal.lino", target.to_lowercase()));
            let report = check_refusal_integrity(&receipt, &source, &translator.lock_sha256);
            assert!(report.valid, "{name} {target}: {:?}", report.errors);
            assert_eq!(serialize_links(&read_links_document(&receipt).unwrap()[0]), receipt);
            let edited = format!("{source}\n");
            assert!(!check_refusal_integrity(&receipt, &edited, &translator.lock_sha256).valid);
        }
    }
    let receipt = generated("refusals/rust-trait-impl.javascript.refusal.lino");
    let source = read("refusals/rust-trait-impl.rs");
    let tampered = receipt.replace("(status retained-unchanged)", "(status summarized)");
    assert!(!check_refusal_integrity(&tampered, &source, &translator.lock_sha256).valid);
    let emitted = receipt.replace("(status not-emitted)", "(status emitted)");
    assert!(!check_refusal_integrity(&emitted, &source, &translator.lock_sha256).valid);
}

const LOWERED_CASES: &[&str] = &["rust-records", "rust-generic", "lean-structure", "rocq-record"];

fn first_rewrite(form: &mut LinksNode) -> &mut LinksNode {
    items_mut(section_mut(form, "lowering"))
        .iter_mut()
        .find(|item| item.head() == Some("rewrite"))
        .unwrap()
}

#[test]
fn lowered_certificates_record_every_rewrite_with_an_exact_span() {
    let translator = translator();
    let cases = translations();
    for name in LOWERED_CASES {
        let case = cases.iter().find(|case| case.name == *name).unwrap();
        for target in CERTIFIED_LANGUAGES.iter().filter(|target| **target != case.language) {
            let (certificate, emitted, intermediate) = certificate_files(case, target);
            let form = read_links_document(&certificate).unwrap().remove(0);
            let lowering = form
                .section("lowering")
                .unwrap_or_else(|| panic!("{name} {target} has no lowering section"));
            assert_eq!(lowering.field("schema"), Some(SURFACE_LOWERING_SCHEMA));
            let rewrites: Vec<&LinksNode> = lowering.sections("rewrite").collect();
            assert!(!rewrites.is_empty());
            assert!(rewrites
                .iter()
                .all(|rewrite| LOWERING_KINDS.contains(&rewrite.field("kind").unwrap())));
            assert_eq!(
                check(&certificate, case, Some(emitted.as_str()), Some(intermediate.as_str()), &translator),
                Vec::<&str>::new(),
                "{name} to {target}"
            );
        }
    }
    let plain = cases.iter().find(|case| case.name == "lean-list").unwrap();
    let (certificate, _, _) = certificate_files(plain, "Rust");
    assert!(read_links_document(&certificate).unwrap()[0].section("lowering").is_none());

    let case = cases.iter().find(|case| case.name == "rust-records").unwrap();
    let (certificate, _, _) = certificate_files(case, "Lean");
    let renamed = forge(&certificate, |form| set_field(first_rewrite(form), "kind", "rust-macro-expansion"));
    assert!(check(&renamed, case, None, None, &translator).contains(&"RML_CERT_LOWERING"));
    let moved = forge(&certificate, |form| {
        let span = section_mut(first_rewrite(form), "span");
        items_mut(span)[1] = LinksNode::Atom("1".to_string());
    });
    assert!(check(&moved, case, None, None, &translator).contains(&"RML_CERT_LOWERING"));
    let hidden = forge(&certificate, |form| {
        items_mut(section_mut(form, "lowering")).retain(|item| item.head() != Some("rewrite"));
    });
    assert!(check(&hidden, case, None, None, &translator).contains(&"RML_CERT_LOWERING"));
}

fn obligation_field(certificate: &str, id: &str, name: &str) -> Option<String> {
    let form = read_links_document(certificate).unwrap().remove(0);
    let obligations = form.section("obligations")?;
    let found = obligations.sections("obligation").find(|item| item.field("id") == Some(id))?;
    found.field(name).map(str::to_string)
}

#[test]
fn termination_obligations_discharge_only_by_structural_decrease() {
    let translator = translator();
    let cases = translations();
    let lean = cases.iter().find(|case| case.name == "lean-list").unwrap();
    let (certificate, _, _) = certificate_files(lean, "Rust");
    assert_eq!(obligation_field(&certificate, "termination:length", "status").as_deref(), Some("discharged"));
    assert_eq!(obligation_field(&certificate, "termination:length", "by").as_deref(), Some("rml-structural-decrease"));

    let fold = cases.iter().find(|case| case.name == "rust-fold").unwrap();
    let (certificate, _, _) = certificate_files(fold, "Lean");
    assert_eq!(obligation_field(&certificate, "termination:gcd", "status").as_deref(), Some("open"));
    assert_eq!(obligation_field(&certificate, "termination:gcd", "by").as_deref(), Some("unproved-general-recursion"));
    let promoted = forge(&certificate, |form| set_field(obligation_mut(form, "termination:gcd"), "status", "discharged"));
    assert!(check(&promoted, fold, None, None, &translator).contains(&"RML_CERT_OBLIGATION_FORGED"));
    let misused = forge(&certificate, |form| {
        let obligation = obligation_mut(form, "emitter-faithfulness");
        set_field(obligation, "status", "discharged");
        set_field(obligation, "by", "rml-structural-decrease");
    });
    assert!(check(&misused, fold, None, None, &translator).contains(&"RML_CERT_OBLIGATION_FORGED"));
}

#[test]
fn refusal_receipts_name_a_known_pipeline_stage() {
    let translator = translator();
    let receipt = generated("refusals/rust-generic-function.javascript.refusal.lino");
    let source = read("refusals/rust-generic-function.rs");
    let form = read_links_document(&receipt).unwrap().remove(0);
    assert_eq!(form.field("stage"), Some("rml-lowering"));
    assert!(REFUSAL_STAGES.contains(&"rml-lowering"));
    assert!(check_refusal_integrity(&receipt, &source, &translator.lock_sha256).valid);
    let restaged = forge(&receipt, |form| set_field(form, "stage", "kernel"));
    let report = check_refusal_integrity(&restaged, &source, &translator.lock_sha256);
    assert!(!report.valid);
    assert!(report
        .errors
        .iter()
        .any(|error| error.message.contains("unknown pipeline stage")));
}
