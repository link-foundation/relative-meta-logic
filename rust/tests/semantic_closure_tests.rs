//! Mirrors `js/tests/semantic-closure.test.mjs`: one closed links network for
//! semantic artefacts, and foundation-declared universe/soundness contracts.
use rml::foundation_workspace::{FoundationBounds, FoundationWorkspace};
use rml::linked_program::{ExecutionBasis, LinkedProgramRegistry};
use rml::semantic_archive::TypedSemanticArchive;
use rml::semantic_closure::{
    closure_hash, project_semantic_closure, reconstruct_semantic_closure,
    validate_semantic_closure, validate_universe_contract, ClosureFoundation, ClosureJudgement,
    ClosureValue, ClosureValueRecord, SemanticClosureBuilder, SemanticClosureInput,
    SEMANTIC_CLOSURE_CATEGORIES,
};
use rml::theory_network::{TypedLinkNetwork, TypedLinkNetworkSnapshot};
use rml::{parse_one, tokenize_one, Node};
use serde_json::Value;
use sha2::{Digest, Sha256};

const PROGRAMS: &str = include_str!("../../test-corpus/semantic-archive/closure-programs.lino");
const FOUNDATIONS: &str =
    include_str!("../../test-corpus/semantic-archive/closure-foundations.lino");
const UNIVERSES: &str =
    include_str!("../../test-corpus/semantic-archive/universe-soundness-contracts.lino");
const EXPECTED: &str = include_str!("../../test-corpus/semantic-archive/closure-expected.json");
const INPUT: &str = "(length (cons a (cons b nil)))";
const ROOT: &str = "rml.closure";

fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}
fn json_node(value: &Value) -> Node {
    match value {
        Value::String(text) => Node::Leaf(text.clone()),
        Value::Array(items) => Node::List(items.iter().map(json_node).collect()),
        _ => panic!("expected terms contain strings and arrays only"),
    }
}
fn expected() -> Value {
    serde_json::from_str(EXPECTED).unwrap()
}
fn sha256(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

struct Host {
    workspace: FoundationWorkspace,
    registry: LinkedProgramRegistry,
}

fn host(basis: ExecutionBasis) -> Host {
    Host {
        workspace: FoundationWorkspace::from_rml_with_basis(
            &format!("{PROGRAMS}\n{FOUNDATIONS}"),
            basis,
            &[],
        )
        .unwrap(),
        registry: LinkedProgramRegistry::from_rml_with_basis(PROGRAMS, basis, &[]).unwrap(),
    }
}

fn project(host: &Host, ontology: Option<&TypedLinkNetwork>) -> TypedSemanticArchive {
    let foundations = vec![host.workspace.describe("closure-logic", Some("1")).unwrap()];
    let ask = |query: &str, assumptions: &[Node]| {
        host.workspace
            .ask(
                "closure-study",
                &node(query),
                assumptions,
                FoundationBounds::default(),
            )
            .unwrap()
    };
    let judgements = vec![
        ask("(publishable specimen)", &[]),
        ask("(publishable extra)", &[node("(input extra)")]),
        ask("(accepted ?x)", &[]),
    ];
    let input = node(INPUT);
    let result = host
        .registry
        .reduce("closure-computation", &input, 10_000)
        .unwrap();
    let values = [ClosureValue {
        program: "closure-computation",
        input: &input,
        result: &result,
    }];
    project_semantic_closure(&SemanticClosureInput {
        ontology,
        registry: &host.registry,
        foundations: &foundations,
        judgements: &judgements,
        values: &values,
    })
    .unwrap()
}

fn closure(basis: ExecutionBasis) -> TypedSemanticArchive {
    let ontology = TypedLinkNetwork::with_default_ontology();
    project(&host(basis), Some(&ontology))
}

fn archive(snapshot: &TypedLinkNetworkSnapshot) -> Result<TypedSemanticArchive, String> {
    TypedSemanticArchive::from_snapshot(snapshot, &[ROOT.to_string()])
}

fn invalid(snapshot: &TypedLinkNetworkSnapshot) -> String {
    validate_semantic_closure(&archive(snapshot).unwrap()).unwrap_err()
}

fn payload(snapshot: &TypedLinkNetworkSnapshot, address: &str) -> String {
    snapshot
        .links
        .iter()
        .find(|row| row.0 == address)
        .unwrap()
        .2
        .clone()
}

fn items(snapshot: &TypedLinkNetworkSnapshot, address: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut at = address.to_string();
    while at != "rml.nil" {
        let row = snapshot.links.iter().find(|row| row.0 == at).unwrap();
        result.push(row.1.clone());
        at = row.2.clone();
    }
    result
}

fn rule_of(program: &str, kind: &str, name: &str) -> String {
    format!("rml.rule/{kind}/{}:{program}/{name}", program.len())
}

fn edit(
    snapshot: &TypedLinkNetworkSnapshot,
    change: impl FnOnce(&mut SemanticClosureBuilder),
) -> TypedLinkNetworkSnapshot {
    let mut builder = SemanticClosureBuilder::from_snapshot(snapshot);
    change(&mut builder);
    builder.snapshot(&[ROOT.to_string()])
}

#[test]
fn projects_actual_host_objects_into_one_closed_network_with_shared_expected_bytes() {
    let archive = closure(ExecutionBasis::DirectStructural);
    let bytes = archive.serialize().unwrap();
    let expected = expected();
    assert_eq!(
        bytes.len() as u64,
        expected["closure"]["bytes"].as_u64().unwrap()
    );
    assert_eq!(
        sha256(&bytes),
        expected["closure"]["sha256"].as_str().unwrap()
    );
    let report = validate_semantic_closure(&archive).unwrap();
    assert_eq!(
        report.links as u64,
        expected["closure"]["links"].as_u64().unwrap()
    );
    assert_eq!(
        report.type_facts as u64,
        expected["closure"]["typeFacts"].as_u64().unwrap()
    );
    let names: Vec<&str> = report.categories.iter().map(|(name, _)| *name).collect();
    assert_eq!(names, SEMANTIC_CLOSURE_CATEGORIES.to_vec());
    for (name, count) in &report.categories {
        assert_eq!(
            *count as u64,
            expected["closure"]["categories"][*name].as_u64().unwrap(),
            "{name}"
        );
        assert!(*count > 0);
    }
    assert_eq!(
        archive.doublet("rml.category/proof"),
        Some(("rml.category", "rml.category/proof"))
    );
}

#[test]
fn round_trips_bytes_and_reconstructs_host_records_exactly() {
    let host = host(ExecutionBasis::DirectStructural);
    let ontology = TypedLinkNetwork::with_default_ontology();
    let bytes = project(&host, Some(&ontology)).serialize().unwrap();
    let restored = TypedSemanticArchive::deserialize(&bytes).unwrap();
    assert_eq!(restored.serialize().unwrap(), bytes);
    let back = reconstruct_semantic_closure(&restored).unwrap();
    let programs: Vec<_> = host
        .registry
        .names()
        .into_iter()
        .map(|name| host.registry.program(name).unwrap().clone())
        .collect();
    assert_eq!(back.programs, programs);
    let described = host.workspace.describe("closure-logic", Some("1")).unwrap();
    assert_eq!(back.foundations, vec![ClosureFoundation::of(&described)]);
    let ask = |query: &str, assumptions: &[Node]| {
        host.workspace
            .ask(
                "closure-study",
                &node(query),
                assumptions,
                FoundationBounds::default(),
            )
            .unwrap()
    };
    let judgements = vec![
        ClosureJudgement::of(&ask("(publishable specimen)", &[])),
        ClosureJudgement::of(&ask("(publishable extra)", &[node("(input extra)")])),
        ClosureJudgement::of(&ask("(accepted ?x)", &[])),
    ];
    assert_eq!(back.judgements, judgements);
    assert_eq!(
        back.values,
        vec![ClosureValueRecord {
            program: "closure-computation".to_string(),
            input: node(INPUT),
            term: node("(s (s z))"),
            steps: 3,
        }]
    );
    let mut ontology_snapshot = ontology.snapshot();
    ontology_snapshot.links.sort();
    ontology_snapshot.type_facts.sort();
    assert_eq!(back.ontology, Some(ontology_snapshot));
    // Reconstructed rules are executable again by an unchanged generic registry.
    let leaf = |text: &str| Node::Leaf(text.to_string());
    let list = Node::List;
    let mut forms = Vec::new();
    for program in &back.programs {
        let mut form = vec![leaf("linked-program"), leaf(&program.name)];
        for import in &program.uses {
            let mut uses = vec![leaf("uses"), leaf(&import.program)];
            for (from, to) in &import.rebindings {
                uses.push(list(vec![leaf("rebind"), leaf(from), leaf(to)]));
            }
            form.push(list(uses));
        }
        forms.push(list(form));
    }
    for program in &back.programs {
        for rule in &program.rewrites {
            forms.push(list(vec![
                leaf("linked-rewrite"),
                leaf(&rule.program),
                leaf(&rule.name),
                list(vec![leaf("from"), rule.pattern.clone()]),
                list(vec![leaf("to"), rule.replacement.clone()]),
            ]));
        }
        for rule in &program.facts {
            forms.push(list(vec![
                leaf("linked-fact"),
                leaf(&rule.program),
                leaf(&rule.name),
                list(vec![leaf("judgement"), rule.judgement.clone()]),
            ]));
        }
        for rule in &program.inferences {
            let mut form = vec![
                leaf("linked-inference"),
                leaf(&rule.program),
                leaf(&rule.name),
            ];
            for premise in &rule.premises {
                form.push(list(vec![leaf("premise"), premise.clone()]));
            }
            form.push(list(vec![leaf("conclusion"), rule.conclusion.clone()]));
            forms.push(list(form));
        }
    }
    let rebuilt =
        LinkedProgramRegistry::from_forms_with_basis(&forms, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    assert_eq!(
        rebuilt
            .reduce("closure-computation", &node(INPUT), 10_000)
            .unwrap()
            .term,
        node("(s (s z))")
    );
    assert!(rebuilt
        .prove(
            "closure-theory",
            &node("(publishable specimen)"),
            &[],
            128,
            10_000
        )
        .is_some());
}

#[test]
fn preserves_shared_identity_and_named_cycles_instead_of_unfolding_them() {
    let archive = closure(ExecutionBasis::DirectStructural);
    let back = reconstruct_semantic_closure(&archive).unwrap();
    let shared = &back.judgements[0].proof.as_ref().unwrap().premises[0];
    assert_eq!(
        &back.judgements[2].answers.as_ref().unwrap()[1].proof,
        shared
    );
    let report = validate_semantic_closure(&archive).unwrap();
    assert!(report.categories.contains(&("proof", 8)));
    let snapshot = archive.snapshot();
    let program = "rml.program/closure-rules";
    let rules = items(
        &snapshot,
        &items(&snapshot, &payload(&snapshot, program))[2],
    );
    assert_eq!(
        rules,
        vec![
            rule_of("closure-rules", "inference", "admission"),
            rule_of("closure-rules", "inference", "publication"),
        ]
    );
    for rule in &rules {
        assert_eq!(items(&snapshot, &payload(&snapshot, rule))[0], program);
    }
    assert_eq!(archive.doublet("Type"), Some(("Type", "Type")));
    let admission_body = items(&snapshot, &payload(&snapshot, &rules[0]))[3].clone();
    let publication_body = items(&snapshot, &payload(&snapshot, &rules[1]))[3].clone();
    assert_eq!(
        items(&snapshot, &admission_body)[1],
        items(&snapshot, &items(&snapshot, &publication_body)[0])[0]
    );
    let cons: Vec<_> = snapshot
        .links
        .iter()
        .filter(|row| row.0.starts_with("rml.cons/"))
        .collect();
    let distinct: std::collections::BTreeSet<_> = cons
        .iter()
        .map(|row| (row.1.clone(), row.2.clone()))
        .collect();
    assert_eq!(distinct.len(), cons.len());
    for row in cons {
        assert_eq!(row.0, format!("rml.cons/{}", closure_hash(&row.1, &row.2)));
    }
}

#[test]
fn produces_identical_bytes_from_both_public_execution_bases() {
    let direct = closure(ExecutionBasis::DirectStructural)
        .serialize()
        .unwrap();
    let closed = closure(ExecutionBasis::ClosedSk).serialize().unwrap();
    assert_eq!(sha256(&closed), sha256(&direct));
    assert_eq!(
        sha256(&direct),
        expected()["closure"]["sha256"].as_str().unwrap()
    );
}

#[test]
fn rejects_dangling_references_hidden_fields_and_unrepresented_nodes() {
    let snapshot = closure(ExecutionBasis::DirectStructural).snapshot();
    let admission = rule_of("closure-rules", "inference", "admission");
    let mut dangling = snapshot.clone();
    dangling.links.retain(|row| row.0 != admission);
    assert!(archive(&dangling)
        .unwrap_err()
        .contains("dangling references"));
    let mut stray = snapshot.clone();
    stray.links.push((
        "hidden-note".to_string(),
        "hidden-note".to_string(),
        "hidden-note".to_string(),
    ));
    assert!(invalid(&stray).contains("unrepresented node hidden-note"));
    let extra_field = edit(&snapshot, |builder| {
        let mut fields = items(&snapshot, &payload(&snapshot, &admission));
        fields.push(builder.atom("hidden").unwrap());
        let extended = builder.seq(&fields).unwrap();
        builder.replace(&admission, "rml.atom/rml.rule", &extended);
    });
    assert!(invalid(&extra_field).contains("must have 4 fields"));
    let wrong_root =
        TypedSemanticArchive::from_snapshot(&snapshot, &["rml.ontology".to_string()]).unwrap();
    assert!(validate_semantic_closure(&wrong_root)
        .unwrap_err()
        .contains("single root"));
}

#[test]
fn rejects_category_spoofing_and_missing_category_membership() {
    let snapshot = closure(ExecutionBasis::DirectStructural).snapshot();
    let admission = rule_of("closure-rules", "inference", "admission");
    let spoofed = edit(&snapshot, |builder| {
        builder.classify(&admission, "proof");
    });
    assert!(invalid(&spoofed).contains("category spoofing"));
    let mut untyped = snapshot.clone();
    untyped
        .type_facts
        .retain(|row| !(row.1 == admission && row.2 == "rml.category/rule"));
    assert!(invalid(&untyped).contains("missing its rule category"));
    let mut forged = snapshot.clone();
    let fact = forged
        .type_facts
        .iter_mut()
        .find(|row| row.1 == admission)
        .unwrap();
    fact.0 = format!("rml.typed/{}", "0".repeat(64));
    assert!(invalid(&forged).contains("type fact"));
}

#[test]
fn rejects_identity_splitting_merging_and_named_identity_spoofing() {
    let snapshot = closure(ExecutionBasis::DirectStructural).snapshot();
    let mut split = snapshot.clone();
    let cell = split
        .links
        .iter()
        .find(|row| row.0.starts_with("rml.cons/") && row.2 == "rml.nil")
        .unwrap()
        .clone();
    let forged = format!("rml.cons/{}", "f".repeat(64));
    let parent = split.links.iter_mut().find(|row| row.2 == cell.0).unwrap();
    parent.2 = forged.clone();
    split.links.push((forged, cell.1.clone(), cell.2.clone()));
    assert!(invalid(&split).contains("content address mismatch"));
    let admission = rule_of("closure-rules", "inference", "admission");
    let mut merged = snapshot.clone();
    let duplicate = merged
        .links
        .iter()
        .find(|row| row.0 == admission)
        .unwrap()
        .clone();
    merged
        .links
        .push((duplicate.0, duplicate.1, "rml.nil".to_string()));
    assert!(archive(&merged).is_err());
    let renamed = edit(&snapshot, |builder| {
        let fields = items(&snapshot, &payload(&snapshot, &admission));
        let name = builder.atom("publication").unwrap();
        let changed = builder
            .seq(&[
                fields[0].clone(),
                fields[1].clone(),
                name,
                fields[3].clone(),
            ])
            .unwrap();
        builder.replace(&admission, "rml.atom/rml.rule", &changed);
    });
    assert!(invalid(&renamed).contains("identity mismatch for rule"));
}

#[test]
fn rejects_broken_program_rule_cycles_in_either_direction() {
    let snapshot = closure(ExecutionBasis::DirectStructural).snapshot();
    let program = "rml.program/closure-rules";
    let fields = items(&snapshot, &payload(&snapshot, program));
    let rules = items(&snapshot, &fields[2]);
    let dropped = edit(&snapshot, |builder| {
        let kept = builder.seq(&rules[1..]).unwrap();
        let changed = builder
            .seq(&[fields[0].clone(), fields[1].clone(), kept])
            .unwrap();
        builder.replace(program, "rml.atom/rml.program", &changed);
    });
    assert!(invalid(&dropped).contains("is not listed by its program"));
    let foreign = rule_of("closure-computation", "rewrite", "length-empty");
    let captured = edit(&snapshot, |builder| {
        let mut extended = rules.clone();
        extended.push(foreign.clone());
        let listed = builder.seq(&extended).unwrap();
        let changed = builder
            .seq(&[fields[0].clone(), fields[1].clone(), listed])
            .unwrap();
        builder.replace(program, "rml.atom/rml.program", &changed);
    });
    assert!(invalid(&captured).contains("does not link back to program closure-rules"));
}

#[test]
fn requires_a_selected_ontology_for_full_closure_and_never_invents_one() {
    let archive = project(&host(ExecutionBasis::DirectStructural), None);
    assert_eq!(archive.doublet("Type"), None);
    assert!(validate_semantic_closure(&archive)
        .unwrap_err()
        .contains("missing category ontology"));
}

fn json_terms(value: &Value) -> Vec<Node> {
    value.as_array().unwrap().iter().map(json_node).collect()
}

#[test]
fn checks_declared_universe_policies_relative_to_each_foundation_on_both_bases() {
    let expected = expected();
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let workspace = FoundationWorkspace::from_rml_with_basis(UNIVERSES, basis, &[]).unwrap();
        for (instance, want) in expected["universe"].as_object().unwrap() {
            let report =
                validate_universe_contract(&workspace, instance, &[], FoundationBounds::default())
                    .unwrap();
            assert_eq!(
                report.status,
                want["status"].as_str().unwrap(),
                "{instance}"
            );
            assert_eq!(
                report.reason,
                want["reason"].as_str().unwrap(),
                "{instance}"
            );
            assert_eq!(
                report.policy,
                (!want["policy"].is_null()).then(|| json_node(&want["policy"])),
                "{instance}"
            );
            assert_eq!(report.consistency, "not-established");
            let obligations = want["obligations"].as_array().unwrap();
            assert_eq!(report.obligations.len(), obligations.len(), "{instance}");
            for (actual, wanted) in report.obligations.iter().zip(obligations) {
                assert_eq!(actual.name, wanted["name"].as_str().unwrap());
                assert_eq!(actual.source, wanted["source"].as_str().unwrap());
                assert_eq!(actual.status, wanted["status"].as_str().unwrap());
                let judgement = actual
                    .witness
                    .as_ref()
                    .and_then(|witness| witness.judgement.clone());
                assert_eq!(
                    judgement,
                    (!wanted["judgement"].is_null()).then(|| json_node(&wanted["judgement"]))
                );
                let cycle = actual
                    .witness
                    .as_ref()
                    .map(|witness| witness.cycle.clone())
                    .unwrap_or_default();
                assert_eq!(cycle, json_terms(&wanted["cycle"]));
            }
        }
    }
}

#[test]
fn keeps_the_link_cli_graph_self_link_representable_without_making_it_a_judgement() {
    let ontology = TypedLinkNetwork::with_default_ontology();
    let snapshot = ontology.snapshot();
    for (address, source, target) in [
        ("Type", "Type", "Type"),
        ("SubType", "Type", "SubType"),
        ("Value", "SubType", "Value"),
    ] {
        assert!(snapshot.links.contains(&(
            address.to_string(),
            source.to_string(),
            target.to_string()
        )));
    }
    let workspace =
        FoundationWorkspace::from_rml_with_basis(UNIVERSES, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let check = |instance: &str, extra: &[Node]| {
        validate_universe_contract(&workspace, instance, extra, FoundationBounds::default())
            .unwrap()
    };
    assert_eq!(check("stratified-study", &[]).status, "accepted");
    let promoted: Vec<Node> = ontology
        .type_facts()
        .into_iter()
        .map(|(_, subject, kind)| node(&format!("(has-type {subject} {kind})")))
        .collect();
    let report = check("stratified-study", &promoted);
    assert_eq!(report.status, "violated");
    let self_typing = report
        .obligations
        .iter()
        .find(|item| item.name == "no-universe-self-typing")
        .unwrap();
    let witness = self_typing.witness.as_ref().unwrap();
    assert_eq!(witness.judgement, Some(node("(has-type Type Type)")));
    assert_eq!(witness.cycle, vec![node("Type"), node("Type")]);
    let opted = check("type-in-type-study", &promoted);
    assert_eq!(opted.status, "accepted");
    assert_eq!(opted.reason, "accepted-relative-to-declared-type-in-type");
    assert_eq!(opted.consistency, "not-established");
    assert_eq!(
        ontology.snapshot(),
        TypedLinkNetwork::with_default_ontology().snapshot()
    );
}

#[test]
fn changes_its_verdict_when_the_linked_contract_changes() {
    let removed = UNIVERSES.replace(
        "(linked-fact cumulative-contract cumulativity (judgement (universe-cumulativity cumulative)))",
        "",
    );
    assert_ne!(removed, UNIVERSES);
    let workspace =
        FoundationWorkspace::from_rml_with_basis(&removed, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    let report = validate_universe_contract(
        &workspace,
        "cumulative-study",
        &[],
        FoundationBounds::default(),
    )
    .unwrap();
    assert_eq!(report.status, "violated");
    assert!(!report.cumulative);
    let restored =
        FoundationWorkspace::from_rml_with_basis(UNIVERSES, ExecutionBasis::DirectStructural, &[])
            .unwrap();
    assert_eq!(
        validate_universe_contract(
            &restored,
            "cumulative-study",
            &[],
            FoundationBounds::default()
        )
        .unwrap()
        .status,
        "accepted"
    );
    let bounded = validate_universe_contract(
        &restored,
        "cumulative-study",
        &[],
        FoundationBounds {
            max_rounds: 1,
            ..FoundationBounds::default()
        },
    )
    .unwrap();
    assert_eq!(bounded.status, "incomplete");
}
