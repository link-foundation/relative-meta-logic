//! Hand-written mirror of js/tests/meta-theory-specifications.test.mjs over the
//! shared fixtures in test-corpus/meta-theory-specifications/.
use rml::spec_certificates::{
    check_spec_certificate, check_spec_derivation, spec_evaluate, spec_proof_rules, spec_registries, spec_statement,
    spec_term, spec_theorems, SpecRegistries,
};
use rml::Node;
use serde_json::{json, Value};

const TYPES: &str = include_str!("../../lib/meta-theory/type-specification.lino");
const GRAPHS: &str = include_str!("../../lib/meta-theory/graph-specification.lino");
const ALGEBRA: &str = include_str!("../../lib/meta-theory/relational-algebra-specification.lino");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const VERIFIER: &str = include_str!("../../lib/meta-theory/proof-verifier.lino");
const NATURAL: &str = include_str!("../../lib/meta-theory/proof-verifier-natural.lino");
const CASES: &str = include_str!("../../test-corpus/meta-theory-specifications/cases.json");
const CERTIFICATES: &str = include_str!("../../test-corpus/meta-theory-specifications/certificates.json");

fn on_large_stack<F: FnOnce() + Send + 'static>(run: F) {
    std::thread::Builder::new()
        .stack_size(256 * 1024 * 1024)
        .spawn(run)
        .unwrap()
        .join()
        .unwrap();
}

fn registries_with(algebra: &str) -> SpecRegistries {
    spec_registries(
        &[
            ("type-specification", TYPES),
            ("graph-specification", GRAPHS),
            ("relational-algebra-specification", algebra),
        ],
        UNIVERSAL,
        VERIFIER,
        NATURAL,
    )
    .unwrap()
}

fn registries() -> SpecRegistries {
    registries_with(ALGEBRA)
}

fn fixture(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn term(value: &Value) -> Node {
    spec_term(value).unwrap()
}

fn certificate_of<'a>(certificates: &'a Value, program: &str, theorem: &str) -> &'a Value {
    &certificates["certificates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["program"] == program && item["theorem"] == theorem)
        .unwrap()["certificate"]
}

#[test]
fn every_recorded_specification_case_reproduces_its_value_and_steps() {
    on_large_stack(|| {
        let registries = registries();
        let cases = fixture(CASES);
        for item in cases["cases"].as_array().unwrap() {
            let program = item["program"].as_str().unwrap();
            let reduced = spec_evaluate(&registries, program, &term(&item["request"])).unwrap();
            assert_eq!(reduced.term, term(&item["expected"]), "{}", item["id"]);
            assert_eq!(reduced.steps as u64, item["steps"].as_u64().unwrap(), "{}", item["id"]);
        }
    });
}

#[test]
fn negative_specification_cases_reject_ill_typed_terms_cyclic_graphs_and_mismatched_unions() {
    let cases = fixture(CASES);
    let value = |id: &str| {
        cases["cases"].as_array().unwrap().iter().find(|item| item["id"] == id).unwrap()["expected"].clone()
    };
    assert_eq!(value("ill-typed-not-a-function"), json!(["ty-error", "not-a-function"]));
    assert_eq!(value("ill-typed-argument"), json!(["ty-error", "argument-mismatch"]));
    assert_eq!(value("ill-typed-branches"), json!(["ty-error", "branch-mismatch"]));
    assert_eq!(value("cyclic-graph-rejected"), json!("gr-no"));
    assert_eq!(value("acyclic-dag"), json!("gr-yes"));
    assert_eq!(value("schema-mismatched-union"), json!(["ra-error", "schema-mismatch"]));
    assert_eq!(value("schema-mismatched-difference"), json!(["ra-error", "schema-mismatch"]));
}

#[test]
fn specifications_state_the_recorded_theorems_and_proof_rules() {
    on_large_stack(|| {
        let registries = registries();
        let certificates = fixture(CERTIFICATES);
        for (program, rules) in [
            ("type-specification", 17usize),
            ("graph-specification", 8),
            ("relational-algebra-specification", 1),
        ] {
            let theorems: Vec<Value> = spec_theorems(&registries, program).unwrap().into_iter().map(Value::String).collect();
            assert_eq!(Value::Array(theorems), certificates["theorems"][program], "{program}");
            assert_eq!(spec_proof_rules(&registries, program).unwrap().len(), rules, "{program}");
        }
        assert_eq!(certificates["theorems"]["relational-algebra-specification"].as_array().unwrap().len(), 16);
    });
}

#[test]
fn every_specification_certificate_is_accepted() {
    on_large_stack(|| {
        let registries = registries();
        let certificates = fixture(CERTIFICATES);
        let items = certificates["certificates"].as_array().unwrap();
        assert_eq!(items.len(), 28);
        for item in items {
            let checked = check_spec_certificate(&registries, &item["certificate"]).unwrap();
            assert!(checked.accepted, "{} {}: {:?}", item["program"], item["theorem"], checked.problems);
            assert_eq!(checked.steps as u64, item["verifierSteps"].as_u64().unwrap(), "{}", item["theorem"]);
        }
    });
}

#[test]
fn mutated_specification_certificates_are_rejected() {
    on_large_stack(|| {
        let registries = registries();
        let certificates = fixture(CERTIFICATES);
        let original = certificate_of(&certificates, "relational-algebra-specification", "join-associative").clone();
        assert!(check_spec_certificate(&registries, &original).unwrap().accepted);
        let mutate = |change: &dyn Fn(&mut Value)| {
            let mut copy = original.clone();
            change(&mut copy);
            check_spec_certificate(&registries, &copy).unwrap()
        };
        let value = mutate(&|copy| copy["facts"][2]["value"] = json!("ra-no"));
        assert!(!value.accepted);
        assert!(value.problems[0].starts_with("fact:3: "), "{:?}", value.problems);
        assert!(!mutate(&|copy| {
            copy["facts"].as_array_mut().unwrap().pop();
        })
        .accepted);
        assert!(!mutate(&|copy| copy["facts"][0]["expression"] = json!(["ra-eval", ["ra-named", "employees"]])).accepted);
        assert!(!mutate(&|copy| copy["goal"] = json!(["ra-equal-relations", "x", "x"])).accepted);
        assert!(!mutate(&|copy| copy["theorem"] = json!("join-commutative")).accepted);
        assert!(!mutate(&|copy| copy["theorem"] = json!("join-is-free")).accepted);
        assert!(!mutate(&|copy| copy["schema"] = json!("rml-spec-certificate/v0")).accepted);
        let root = mutate(&|copy| {
            let nodes = copy["candidate"][4].as_array_mut().unwrap();
            let last = nodes.len() - 1;
            nodes[last][3] = json!(["ra-equal-relations", "x", "x"]);
        });
        assert!(!root.accepted);
        assert_eq!(root.problems, vec!["linked proof verifier rejected the derivation".to_string()]);
        let mut typing = certificate_of(&certificates, "type-specification", "typing-twice").clone();
        typing["candidate"][4][0][2] = json!("t-true");
        assert!(!check_spec_certificate(&registries, &typing).unwrap().accepted);
    });
}

#[test]
fn forged_specification_derivations_are_rejected_for_the_recorded_reason() {
    on_large_stack(|| {
        let registries = registries();
        let certificates = fixture(CERTIFICATES);
        let forged = certificates["forged"].as_array().unwrap();
        assert_eq!(forged.len(), 5);
        for item in forged {
            let checked = check_spec_derivation(
                &registries,
                item["program"].as_str().unwrap(),
                &term(&item["identity"]),
                &term(&item["goal"]),
                &item["facts"],
                &item["candidate"],
            )
            .unwrap();
            assert!(!checked.accepted, "{}", item["name"]);
            let reason = if checked.problems[0].starts_with("fact:") { "fact" } else { "verifier" };
            assert_eq!(reason, item["rejection"].as_str().unwrap(), "{}", item["name"]);
        }
    });
}

#[test]
fn a_changed_join_definition_rejects_the_old_specification_certificate() {
    on_large_stack(|| {
        let original = "(to (ra-merge-fields ?left-schema ?rest (ra-cons (ra-field ?attribute ?value) ?accumulator))))";
        assert!(ALGEBRA.contains(original));
        let altered = ALGEBRA.replace(original, "(to (ra-merge-fields ?left-schema ?rest ?accumulator)))");
        let registries = registries();
        let changed = registries_with(&altered);
        let request = term(&json!(["ra-eval", ["ra-join", ["ra-named", "employees"], ["ra-named", "departments"]]]));
        let program = "relational-algebra-specification";
        assert_ne!(
            spec_evaluate(&changed, program, &request).unwrap().term,
            spec_evaluate(&registries, program, &request).unwrap().term
        );
        let certificates = fixture(CERTIFICATES);
        let certificate = certificate_of(&certificates, program, "join-associative");
        let checked = check_spec_certificate(&changed, certificate).unwrap();
        assert!(!checked.accepted);
        assert!(checked.problems[0].starts_with("fact:"), "{:?}", checked.problems);
        assert_eq!(
            spec_statement(&changed, program, "join-associative").unwrap(),
            spec_statement(&registries, program, "join-associative").unwrap()
        );
    });
}
