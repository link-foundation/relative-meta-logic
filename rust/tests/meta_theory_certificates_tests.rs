//! Independently re-check the meta-theory proof certificates in Rust through
//! the public `rml::meta_theory_certificates` checker. Certificates are
//! produced from preserved source proofs by
//! scripts/generate-meta-theory-certificates.mjs (the producer is untrusted).
use rml::meta_theory_certificates::{
    certificate_registries, certificate_term, check_eigen_scopes, check_meta_theory_certificate, CertificateCheck,
    CertificateRegistries,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const PRELUDE: &str = include_str!("../../lib/meta-theory/meta-theory-native-prelude.lino");
const PROGRAM: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native.lino");
const CONVERSION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-native-conversion.lino");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const NATURAL: &str = include_str!("../../lib/meta-theory/proof-verifier-natural.lino");
const CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-certificates/certificates.json");
const COVERAGE: &str = include_str!("../../test-corpus/meta-theory-native/coverage.json");
const LEAN_SET: &str = "rml.formal.lean.SetSequenceEquivalence.set_sequence_equivalence";
const ROCQ_HEAD: &str = "rml.formal.rocq.SetSequenceEquivalence.strictly_ascending_head";

fn on_large_stack<F: FnOnce() + Send + 'static>(run: F) {
    std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}

fn registries(conversion: &str) -> CertificateRegistries {
    certificate_registries(PRELUDE, PROGRAM, conversion, UNIVERSAL, VERIFIER, NATURAL).unwrap()
}

/// Recorded theorem dependencies, read from the native coverage listing.
fn theorem_dependencies(coverage: &Value) -> BTreeMap<String, Vec<String>> {
    let declarations = coverage["declarations"].as_array().unwrap();
    let theorems: BTreeSet<&str> = declarations
        .iter()
        .filter(|entry| entry["kind"] == "theorem")
        .map(|entry| entry["address"].as_str().unwrap())
        .collect();
    declarations
        .iter()
        .map(|entry| {
            let references: Vec<String> = entry["references"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item.as_str().unwrap())
                .filter(|item| theorems.contains(item))
                .map(str::to_string)
                .collect();
            (entry["address"].as_str().unwrap().to_string(), references)
        })
        .collect()
}

struct Fixture {
    data: Value,
    dependencies: BTreeMap<String, Vec<String>>,
    registries: CertificateRegistries,
}

fn fixture() -> Fixture {
    Fixture {
        data: serde_json::from_str(CERTIFICATES).unwrap(),
        dependencies: theorem_dependencies(&serde_json::from_str(COVERAGE).unwrap()),
        registries: registries(CONVERSION),
    }
}

impl Fixture {
    fn record(&self, address: &str) -> &Value {
        self.data["theorems"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["theorem"] == address)
            .unwrap()
    }

    fn certificate(&self, address: &str) -> Value {
        self.record(address)["certificate"].clone()
    }

    fn check_with(&self, certificate: &Value, dependencies: &[String]) -> CertificateCheck {
        check_meta_theory_certificate(&self.registries, certificate, dependencies).unwrap()
    }

    fn check(&self, certificate: &Value) -> CertificateCheck {
        let address = certificate["theorem"].as_str().unwrap();
        self.check_with(certificate, &self.dependencies[address])
    }

    fn rejected(&self, certificate: &Value, expected: &str) {
        let checked = self.check(certificate);
        assert!(!checked.accepted);
        assert!(
            checked.problems.iter().any(|problem| problem.contains(expected)),
            "{:?} lacks {expected}",
            checked.problems
        );
    }
}

fn candidate_nodes(certificate: &mut Value) -> &mut Vec<Value> {
    certificate["candidate"][4].as_array_mut().unwrap()
}

#[test]
fn rechecks_every_certified_theorem_with_the_linked_verifier() {
    on_large_stack(|| {
        let fixture = fixture();
        assert_eq!(fixture.data["theoremCount"], 36);
        assert_eq!(fixture.data["certified"], 17);
        assert_eq!(fixture.data["certifiedClosed"], 5);
        let mut certified = 0;
        for item in fixture.data["theorems"].as_array().unwrap() {
            if item["upstreamProofStatus"] == "admitted" {
                assert_eq!(item["status"], "outside-fragment");
            }
            if item["status"] != "certified" {
                assert!(item["certificate"].is_null());
                continue;
            }
            certified += 1;
            let checked = fixture.check(&item["certificate"]);
            assert!(checked.accepted, "{}: {:?}", item["theorem"], checked.problems);
            assert_eq!(checked.steps as u64, item["verifierSteps"].as_u64().unwrap(), "{}", item["theorem"]);
        }
        assert_eq!(certified, 17);
    });
}

#[test]
fn rejects_a_corrupted_definition_body_used_by_a_conversion() {
    on_large_stack(|| {
        let mut fixture = fixture();
        let body = "(to (rml.formal.lean.SetSequenceEquivalence.StrictlyAscending ?v0)))";
        assert!(CONVERSION.contains(body));
        let corrupted = CONVERSION.replacen(body, "(to (rml.formal.lean.SetSequenceEquivalence.NoDuplicates ?v0)))", 1);
        fixture.registries = registries(&corrupted);
        fixture.rejected(&fixture.certificate(LEAN_SET), "not convertible");
    });
}

#[test]
fn rejects_binder_mutations() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut opened = fixture.certificate(LEAN_SET);
        for entry in opened["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "forall-intro" {
                let text = serde_json::to_string(&entry["rule"][2]).unwrap().replace("\"mt-bound-2\"", "\"mt-bound-0\"");
                entry["rule"][2] = serde_json::from_str(&text).unwrap();
                break;
            }
        }
        fixture.rejected(&opened, "premise is not the opened body");

        let mut instance = fixture.certificate(LEAN_SET);
        for entry in instance["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "instance" && entry["rule"][3][1] != "refl" {
                let swapped = if entry["rule"][3][2] == "mt-bound-0" { "mt-bound-1" } else { "mt-bound-0" };
                entry["rule"][3][2] = Value::String(swapped.to_string());
                break;
            }
        }
        fixture.rejected(&instance, "verifier rejected");
    });
}

#[test]
fn rejects_removed_premises_substituted_rules_and_edited_conclusions() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut premise = fixture.certificate(LEAN_SET);
        for item in candidate_nodes(&mut premise).iter_mut() {
            let premises = item[5].as_array_mut().unwrap();
            if premises.len() > 1 {
                premises.remove(0);
                break;
            }
        }
        fixture.rejected(&premise, "verifier rejected");

        let mut swapped = fixture.certificate(LEAN_SET);
        for item in candidate_nodes(&mut swapped).iter_mut() {
            let rule = item[2].as_str().unwrap().to_string();
            if rule.starts_with("lemma:") {
                let replacement = if rule.ends_with("mem_toOrderedUnique") {
                    "lemma:rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending"
                } else {
                    "lemma:rml.formal.lean.SetSequenceEquivalence.mem_toOrderedUnique"
                };
                item[2] = Value::String(replacement.to_string());
                break;
            }
        }
        fixture.rejected(&swapped, "verifier rejected");

        let mut conclusion = fixture.certificate(ROCQ_HEAD);
        for item in candidate_nodes(&mut conclusion).iter_mut() {
            if item[2].as_str().unwrap().starts_with("hypothesis:") {
                item[3] = serde_json::json!(["holds", ["mt-v", "mt-true"]]);
                break;
            }
        }
        fixture.rejected(&conclusion, "verifier rejected");
    });
}

#[test]
fn rejects_edited_goals_statements_and_forged_conversions() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut goal = fixture.certificate(ROCQ_HEAD);
        goal["goal"] = serde_json::json!(["holds", ["mt-v", "mt-true"]]);
        fixture.rejected(&goal, "goal differs");

        let mut statement = fixture.certificate(ROCQ_HEAD);
        statement["statement"] = serde_json::json!(["mt-v", "mt-true"]);
        fixture.rejected(&statement, "statement differs");

        let mut forged = fixture.certificate(ROCQ_HEAD);
        for entry in forged["instanceRules"].as_array_mut().unwrap() {
            if entry["kind"] == "conversion" {
                entry["rule"][2] = serde_json::json!([["holds", ["mt-v", "mt-true"]]]);
                break;
            }
        }
        fixture.rejected(&forged, "not convertible");
    });
}

#[test]
fn rejects_undeclared_dependencies_self_citation_and_edited_dependency_lists() {
    on_large_stack(|| {
        let fixture = fixture();
        let certificate = fixture.certificate(LEAN_SET);
        let dependencies = fixture.dependencies[LEAN_SET].clone();
        let without: Vec<String> = dependencies
            .iter()
            .filter(|item| !item.ends_with("mem_toOrderedUnique"))
            .cloned()
            .collect();
        let checked = fixture.check_with(&certificate, &without);
        assert!(!checked.accepted);
        assert!(checked.problems.iter().any(|problem| problem.contains("not a recorded theorem dependency")));

        let mut with_self = dependencies.clone();
        with_self.push(LEAN_SET.to_string());
        let checked = fixture.check_with(&certificate, &with_self);
        assert!(checked.problems.iter().any(|problem| problem.contains("cannot cite itself")));

        let mut edited = certificate.clone();
        edited["candidate"][5].as_array_mut().unwrap().pop();
        fixture.rejected(&edited, "verifier rejected");
    });
}

const ROCQ_INDUCTION: &str = "rml.formal.rocq.SetSequenceEquivalence.toOrderedUnique_is_ascending";
const LEAN_INDUCTION: &str = "rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending";
const ROCQ_CASES: &str = "rml.formal.rocq.SetSequenceEquivalence.strictly_ascending_tail";

fn instance_rules(certificate: &mut Value) -> &mut Vec<Value> {
    certificate["instanceRules"].as_array_mut().unwrap()
}

fn entry_of<'a>(certificate: &'a mut Value, kind: &str) -> &'a mut Value {
    instance_rules(certificate).iter_mut().find(|entry| entry["kind"] == kind).unwrap()
}

impl Fixture {
    fn rejected_any(&self, certificate: &Value, expected: &[&str]) {
        let checked = self.check(certificate);
        assert!(!checked.accepted);
        assert!(
            checked.problems.iter().any(|problem| expected.iter().any(|item| problem.contains(item))),
            "{:?} lacks any of {expected:?}",
            checked.problems
        );
    }
}

#[test]
fn certifies_list_induction_and_case_analysis_through_discharged_locals() {
    on_large_stack(|| {
        let fixture = fixture();
        for address in [ROCQ_INDUCTION, LEAN_INDUCTION, ROCQ_CASES] {
            let item = fixture.record(address);
            assert_eq!(item["status"], "certified", "{address}: {}", item["reason"]);
            let entries = item["certificate"]["instanceRules"].as_array().unwrap();
            let structural_kind = if address == ROCQ_CASES { "cases" } else { "induction" };
            assert!(entries.iter().any(|entry| entry["kind"] == "local"), "{address}");
            let structural = entries.iter().find(|entry| entry["kind"] == structural_kind).unwrap();
            assert!(
                structural["rule"][2].as_array().unwrap().iter().any(|premise| premise[0] == "discharge"),
                "{address}"
            );
            // The local is used by a node and discharged by the structural rule, so no root dependency keeps it.
            let nodes = item["certificate"]["candidate"][4].as_array().unwrap();
            assert!(nodes.iter().any(|node| node[2].as_str().unwrap().starts_with("local:")), "{address}");
            let roots = item["certificate"]["candidate"][5].as_array().unwrap();
            assert!(!roots.iter().any(|dependency| dependency.as_str().unwrap().starts_with("local:")), "{address}");
        }
        let cases = fixture.record(ROCQ_CASES)["certificate"]["instanceRules"].as_array().unwrap();
        assert!(cases.iter().any(|entry| entry["kind"] == "rewrite"));
    });
}

#[test]
fn rejects_a_missing_ownerless_misstated_or_doubly_discharged_local() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut missing = fixture.certificate(ROCQ_INDUCTION);
        instance_rules(&mut missing).retain(|entry| entry["kind"] != "local");
        fixture.rejected(&missing, "missing local");

        let mut ownerless = fixture.certificate(ROCQ_INDUCTION);
        instance_rules(&mut ownerless).push(serde_json::json!({
            "kind": "local", "rule": ["local", "local:extra", ["holds", ["mt-v", "mt-true"]]]
        }));
        fixture.rejected(&ownerless, "local:extra: local has no discharging rule");

        let mut misstated = fixture.certificate(ROCQ_CASES);
        let equations = entry_of(&mut misstated, "cases")["equations"].clone();
        let second = instance_rules(&mut misstated)
            .iter()
            .find(|entry| entry["kind"] == "local" && entry["rule"][1] == equations[1])
            .unwrap()["rule"][2]
            .clone();
        for entry in instance_rules(&mut misstated).iter_mut() {
            if entry["kind"] == "local" && entry["rule"][1] == equations[0] {
                entry["rule"][2] = second.clone();
            }
        }
        fixture.rejected(&misstated, "local does not state what");

        let mut twice = fixture.certificate(ROCQ_CASES);
        let both = entry_of(&mut twice, "cases");
        let first = both["equations"][0].clone();
        both["equations"][1] = first.clone();
        both["rule"][2][1][1] = first;
        fixture.rejected_any(&twice, &["discharged by more than one rule", "premises are not the two discharged cases"]);
    });
}

#[test]
fn rejects_an_induction_with_a_wrong_motive_a_mistyped_target_or_stale_eigen_constants() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut motive = fixture.certificate(ROCQ_INDUCTION);
        entry_of(&mut motive, "induction")["rule"][2][0] = serde_json::json!(["holds", ["mt-v", "mt-true"]]);
        fixture.rejected(&motive, "premises are not the base and step cases of the motive");

        let mut typed = fixture.certificate(ROCQ_INDUCTION);
        entry_of(&mut typed, "induction")["domain"] = serde_json::json!(["mt-v", ["mt-list-type", ["mt-v", "mt-prop-type"]]]);
        fixture.rejected_any(&typed, &["is not of type", "is not declared"]);

        let mut stale = fixture.certificate(ROCQ_INDUCTION);
        let restep = entry_of(&mut stale, "induction");
        restep["head"] = restep["target"][1][1].clone();
        fixture.rejected(&stale, "must be distinct names");

        let mut shared = fixture.certificate(ROCQ_INDUCTION);
        let goal = serde_json::to_string(&shared["goal"]).unwrap();
        let goal_eigen = goal
            .split("\"mt-eigen\",\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .map(str::to_string);
        let reuse = entry_of(&mut shared, "induction");
        if let Some(other) = goal_eigen.filter(|name| reuse["target"][1][1] != name.as_str()) {
            reuse["tail"] = Value::String(other);
            fixture.rejected_any(&shared, &["not fresh", "distinct names"]);
        }
    });
}

#[test]
fn rejects_a_forged_rewrite_through_the_linked_congruence_side_condition() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut forged = fixture.certificate(ROCQ_CASES);
        let bogus = serde_json::json!(["mt-v", "mt-false"]);
        let rewrite = entry_of(&mut forged, "rewrite");
        let side = rewrite["rule"][4].clone();
        let id = rewrite["rule"][1].clone();
        rewrite["rule"][3] = serde_json::json!(["holds", bogus]);
        rewrite["rule"][4] = serde_json::json!([side[0], side[1], side[2], side[3], bogus]);
        for node in candidate_nodes(&mut forged).iter_mut() {
            if node[2] == id {
                node[3] = serde_json::json!(["holds", bogus]);
            }
        }
        fixture.rejected(&forged, "verifier rejected");

        let mut restated = fixture.certificate(ROCQ_CASES);
        let loose = entry_of(&mut restated, "rewrite");
        assert_eq!(loose["rule"][2][0][0], "holds");
        let source = loose["rule"][2][1][1].clone();
        let target = loose["rule"][3][1].clone();
        loose["rule"][4] = serde_json::json!(["congruent", source, source, source, target]);
        fixture.rejected(&restated, "side condition does not restate the rewrite");
    });
}

#[test]
fn rejects_an_eigen_constant_escaping_through_an_undischarged_local() {
    on_large_stack(|| {
        let fixture = fixture();
        let mut escaped = fixture.certificate(ROCQ_INDUCTION);
        let induction = entry_of(&mut escaped, "induction").clone();
        for node in candidate_nodes(&mut escaped).iter_mut() {
            if node[2] == induction["rule"][1] {
                node[6].as_array_mut().unwrap().push(induction["hypothesis"].clone());
            }
        }
        assert!(!fixture.check(&escaped).accepted);
        // The eigenvariable condition alone also catches it: the hypothesis mentions the step tail.
        let entries = escaped["instanceRules"].as_array().unwrap().clone();
        let problems = check_eigen_scopes(&entries, &certificate_term(&escaped["candidate"]).unwrap());
        assert!(
            problems.iter().any(|problem| problem.contains("eigen-constant escapes through undischarged")),
            "{problems:?}"
        );
        let original = fixture.certificate(ROCQ_INDUCTION);
        let entries = original["instanceRules"].as_array().unwrap().clone();
        assert!(check_eigen_scopes(&entries, &certificate_term(&original["candidate"]).unwrap()).is_empty());
    });
}
