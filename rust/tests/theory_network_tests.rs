// Executable meta-theory acceptance tests for issue #183.
// Mirrors js/tests/theory-network.test.mjs so both runtimes expose the same
// theory network, unified-address, and self-referential sequence semantics.

use rml::formal_corpus::FormalCorpus;
use rml::theory_network::{
    DoubletSequenceStore, FiniteRelation, LinkClosureReport, LinkGraph, LinkNetwork,
    MembershipSetStore, SequenceLayout, TheoryNetwork, TypedLinkNetwork,
};
use rml::{evaluate, RunResult};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const CORE: &str = include_str!("../../lib/meta-theory/core.lino");
const UNIVERSAL: &str = include_str!("../../lib/meta-theory/universal.lino");
const FOUNDATION: &str = include_str!("../../lib/meta-theory/foundation.lino");
const UPSTREAM_CORPUS: &str = include_str!("../../lib/meta-theory/upstream-0.0.3.lino");
const UPSTREAM_CORPUS_FOUNDATION: &str =
    include_str!("../../lib/meta-theory/upstream-0.0.3-foundation.lino");

fn network_from(source: &str) -> Result<TheoryNetwork, String> {
    TheoryNetwork::from_rml(&format!("{UNIVERSAL}\n{source}"), FOUNDATION)
}

fn bundled_network() -> TheoryNetwork {
    network_from(CORE).expect("bundled meta-theory must be valid")
}

fn files_under(directory: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory).expect("source directory exists") {
        let path = entry.expect("source directory entry").path();
        if path.is_dir() {
            files.extend(files_under(&path));
        } else {
            files.push(path);
        }
    }
    files
}

#[test]
fn accounts_for_complete_pinned_lean_and_rocq_declaration_corpus() {
    let corpus = FormalCorpus::from_rml(UPSTREAM_CORPUS, UPSTREAM_CORPUS_FOUNDATION)
        .expect("bundled formal corpus must match its independent contract");

    assert!(corpus.meta_language_round_trip_ok());
    assert!(corpus.trusted_foundation_round_trip_ok());
    assert_eq!(
        corpus.revision(),
        "087f4515d0652925eecc54bcade724445c3978f1"
    );
    assert_eq!(corpus.schema(), "linked-source-v1");
    assert_eq!(corpus.formal_modules().len(), 18);
    assert_eq!(corpus.declarations().len(), 229);
    assert_eq!(corpus.semantic_token_count(), 8815);
    assert_eq!(corpus.dependency_count(), 510);
    assert_eq!(corpus.languages(), vec!["lean", "rocq"]);
    assert_eq!(
        corpus.modules("lean"),
        vec![
            "MetaDefinitions",
            "NetworkConversions",
            "NetworkDefinitions",
            "NetworkEquivalence",
            "NetworkExamples",
            "NetworkLemmas",
            "SequenceDefinitions",
            "SetDefinitions",
            "SetSequenceEquivalence",
        ]
    );
    assert_eq!(
        corpus
            .declarations()
            .iter()
            .filter(|declaration| declaration.proof_status == "admitted")
            .map(|declaration| format!("{}.{}", declaration.language, declaration.symbol))
            .collect::<Vec<_>>(),
        vec![
            "lean.insertSorted_preserves_ascending",
            "lean.mem_insertSorted",
            "lean.mem_toOrderedUnique",
            "lean.strictly_ascending_implies_no_dup",
        ]
    );
    assert!(corpus
        .declaration("rocq", "SetSequenceEquivalence", "mem_toOrderedUnique")
        .is_some());

    let balanced = corpus
        .declaration("lean", "SequenceDefinitions", "ListToBalancedTree")
        .expect("the complete recursive Lean definition must be linked");
    assert!(balanced.recursive);
    assert!(balanced
        .signature
        .iter()
        .any(|token| token.text == "Option"));
    assert!(balanced
        .body
        .iter()
        .any(|token| token.text == "ListToBalancedTree"));
    assert!(balanced.dependencies.contains(&balanced.address));

    let read_sequence = corpus
        .declaration("lean", "SequenceDefinitions", "ReadSequence_")
        .expect("the complete recursive sequence reader must be linked");
    assert!(read_sequence.recursive);
    assert!(read_sequence
        .body
        .iter()
        .any(|token| token.text == "ReadSequence_"));

    let theorem = corpus
        .declaration("lean", "SetSequenceEquivalence", "set_sequence_equivalence")
        .expect("the complete theorem judgement and proof must be linked");
    assert!(theorem.signature.iter().any(|token| token.text == "∃"));
    assert!(theorem
        .proof
        .iter()
        .any(|token| token.text == "mem_toOrderedUnique"));
    assert!(theorem.dependencies.contains(
        &"rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending".to_string()
    ));
    assert_eq!(
        corpus
            .counterpart(theorem)
            .expect("the theorem must have a Rocq counterpart")
            .address,
        "rml.formal.rocq.SetSequenceEquivalence.set_sequence_equivalence"
    );
    assert!(corpus
        .dependency_closure(&theorem.address)
        .expect("the theorem dependency graph must resolve")
        .contains(&"rml.formal.lean.SetSequenceEquivalence.insertSorted"));

    let rocq_proof = corpus
        .declaration("rocq", "MetaDefinitions", "meta_network_is_duplet_network")
        .expect("the complete Rocq proof script must be linked");
    assert_eq!(
        rocq_proof
            .proof
            .iter()
            .take(2)
            .map(|token| token.text.as_str())
            .collect::<Vec<_>>(),
        vec!["Proof", "."]
    );
}

#[test]
fn rejects_incomplete_or_self_authorized_formal_corpus() {
    let marker = "\n  (declaration definition ReferenceDefault\n";
    let start = UPSTREAM_CORPUS
        .find(marker)
        .expect("ReferenceDefault declaration must be present");
    let relative_end = UPSTREAM_CORPUS[start..]
        .find("\n  )\n")
        .expect("ReferenceDefault declaration must be closed");
    let end = start + relative_end + "\n  )\n".len();
    let incomplete = format!("{}\n{}", &UPSTREAM_CORPUS[..start], &UPSTREAM_CORPUS[end..]);
    let error = FormalCorpus::from_rml(&incomplete, UPSTREAM_CORPUS_FOUNDATION).unwrap_err();
    assert!(
        error.contains("unknown dependency")
            || error.contains("declaration count 228 does not match trusted declaration count 229"),
        "{error}"
    );

    let module = UPSTREAM_CORPUS
        .find("(formal-module meta-theory-0.0.3 lean NetworkDefinitions")
        .expect("Lean NetworkDefinitions module must be present");
    let body_token = UPSTREAM_CORPUS[module..]
        .find("(token numeral 30)")
        .map(|offset| module + offset)
        .expect("a definition-body numeral token must be present");
    let mut changed_body = UPSTREAM_CORPUS.to_string();
    changed_body.replace_range(
        body_token..body_token + "(token numeral 30)".len(),
        "(token numeral 31)",
    );
    let error = FormalCorpus::from_rml(&changed_body, UPSTREAM_CORPUS_FOUNDATION).unwrap_err();
    assert!(
        error.contains("fingerprint") && error.contains("does not match trusted fingerprint"),
        "{error}"
    );

    let self_authorized = format!("{UPSTREAM_CORPUS}\n{UPSTREAM_CORPUS_FOUNDATION}");
    let error = FormalCorpus::from_rml(&self_authorized, UPSTREAM_CORPUS_FOUNDATION).unwrap_err();
    assert!(
        error.contains(
            "candidate formal corpus cannot declare trusted formal-corpus-contract forms"
        ),
        "{error}"
    );

    let error = FormalCorpus::from_rml("(formal-corpus incomplete)", UPSTREAM_CORPUS_FOUNDATION)
        .expect_err("malformed headers must be rejected without panicking");
    assert!(
        error.contains("formal-corpus must have a name and clauses"),
        "{error}"
    );
}

#[test]
fn expands_doublet_and_derived_triplet_definitions_through_import() {
    let virtual_root_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("inline-meta-theory-test.lino");
    let out = evaluate(
        r#"
(import "lib/meta-theory/core.lino" as mt)
(? ((mt.doublet pair left right) =
     (pair maps-to (left right))))
(? ((mt.triplet statement subject relation object) =
     (statement maps-to (subject (relation object)))))
(? (mt.same-address
     rml.concept.addressable-link
     rml.concept.addressable-link))
"#,
        Some(virtual_root_file.to_str().unwrap()),
        None,
    );

    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(
        out.results,
        vec![
            RunResult::Num(1.0),
            RunResult::Num(1.0),
            RunResult::Num(1.0),
        ]
    );
}

#[test]
fn loads_bundled_theory_network_losslessly_through_meta_language() {
    let network = bundled_network();

    assert!(network.meta_language_round_trip_ok());
    assert!(network.trusted_foundation_round_trip_ok());
    assert_eq!(
        network.theory_names(),
        vec![
            "graph-theory",
            "links-theory",
            "relational-algebra",
            "relative-meta-logic",
            "set-theory",
            "type-theory",
        ]
    );
}

#[test]
fn makes_rml_depend_on_links_theory_and_closes_set_type_self_cycle() {
    let network = bundled_network();

    assert_eq!(
        network.definition_chain("relative-meta-logic", "set-theory"),
        Some(
            ["relative-meta-logic", "links-theory", "set-theory"]
                .map(str::to_string)
                .to_vec()
        )
    );
    assert_eq!(
        network.definition_chain("relative-meta-logic", "type-theory"),
        Some(
            ["relative-meta-logic", "links-theory", "type-theory"]
                .map(str::to_string)
                .to_vec()
        )
    );
    assert!(network
        .definitions_for("links-theory")
        .iter()
        .any(|definition| definition.using == "links-theory"));
    assert_eq!(
        network
            .definitions_for("set-theory")
            .iter()
            .filter(|definition| definition.using == "links-theory")
            .count(),
        2
    );
    let witness = network
        .definition_witness("rml.definition.links.set-function")
        .expect("set-function definition must expose its witness");
    assert_eq!(witness.kind, "set-theoretic-function");
    assert_eq!(witness.implementation, "addressed-doublet-network");
    assert_eq!(witness.proof, "rml.proof.links.set-function");
    let verification = network
        .definition_verification("links-by-sets")
        .expect("links-by-sets must have executable verification");
    assert_eq!(verification.witness, "rml.definition.links.set-function");
    assert_eq!(verification.proof, "rml.proof.links.set-function");
    assert_eq!(verification.implementation, "addressed-doublet-network");
    assert_eq!(
        verification.obligations,
        ["address-function", "ordered-pair"].map(str::to_string)
    );
    assert!(verification.verified);
    let implementation = network
        .implementation("typed-doublet-network")
        .expect("typed doublet implementation contract must be inspectable");
    assert_eq!(implementation.contract, "typed-doublet-network");
    assert_eq!(implementation.program, "dependent-type-theory");
    assert_eq!(implementation.kind, "dependent-function");
    assert_eq!(implementation.subject, "links-theory");
    assert_eq!(implementation.using, "type-theory");
    assert_eq!(
        implementation.obligations,
        [
            "reference-typing",
            "dependent-pair",
            "ill-typed-rejection",
            "typed-proof-replay",
        ]
        .map(str::to_string)
    );
    assert_eq!(
        network
            .definitions_for("graph-theory")
            .iter()
            .map(|definition| definition.using.as_str())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["set-theory", "type-theory"])
    );
    assert_eq!(
        network
            .definitions_for("relational-algebra")
            .iter()
            .map(|definition| definition.using.as_str())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["set-theory", "type-theory"])
    );
    assert!(
        network
            .definition_verification("graphs-by-finite-sets")
            .unwrap()
            .verified
    );
    assert!(
        network
            .definition_verification("relations-by-types")
            .unwrap()
            .verified
    );
}

#[test]
fn maps_terms_from_every_theory_into_a_shared_concept_address() {
    let network = bundled_network();
    let address = "rml.concept.addressable-link";

    assert_eq!(network.resolve_term("links-theory", "link"), Some(address));
    assert_eq!(
        network.resolve_term("relative-meta-logic", "expression"),
        Some(address)
    );
    assert_eq!(
        network.resolve_term("set-theory", "reference"),
        Some(address)
    );
    assert_eq!(network.resolve_term("type-theory", "term"), Some(address));
    assert_eq!(
        network.resolve_term("links-theory", "network"),
        Some("rml.concept.link-network")
    );
    assert_eq!(
        network.resolve_term("graph-theory", "directed-graph"),
        Some("rml.concept.directed-graph")
    );
    assert_eq!(
        network.resolve_term("relational-algebra", "relation-network"),
        Some("rml.concept.finite-binary-relation")
    );
    assert_eq!(
        network.terms_at(address),
        vec![
            ("graph-theory", "vertex"),
            ("links-theory", "link"),
            ("relational-algebra", "element"),
            ("relative-meta-logic", "expression"),
            ("set-theory", "reference"),
            ("type-theory", "term"),
        ]
    );
    assert_eq!(
        network.translate_term("set-theory", "reference", "links-theory"),
        vec!["link"]
    );
}

#[test]
fn accepts_user_theories_without_hard_coded_theory_names() {
    let source = format!(
        "{}\n{}",
        CORE,
        r#"
(theory user-theory (address user.theory))
(term user-theory entity rml.concept.addressable-link)
(implementation user-theory-network
  (contract theory-network)
  (program links-meta-theory)
  (kind link-network-composition)
  (subject user-theory)
  (using relative-meta-logic)
  (obligation meta-language-round-trip)
  (obligation definition-link))
(witness user.definition.rml
  (kind link-network-composition)
  (implementation user-theory-network)
  (proof user.proof.rml))
(proof-object user.proof.rml
  (applies verified-theory-definition)
  (premise-by user.capability.theory-network)
  (conclusion
    (user-by-rml defines user-theory using relative-meta-logic
      via user-theory-network as link-network-composition)))
(definition user-by-rml
  (subject user-theory)
  (using relative-meta-logic)
  (witness user.definition.rml))
"#
    );
    let trusted_foundation = format!(
        "{FOUNDATION}\n(axiom user.capability.theory-network\n  (judgement (user-theory-network implements link-network-composition)))\n"
    );
    let network = TheoryNetwork::from_rml(&format!("{UNIVERSAL}\n{source}"), &trusted_foundation)
        .expect("user theory must be valid");

    assert_eq!(
        network.resolve_term("user-theory", "entity"),
        Some("rml.concept.addressable-link")
    );
    assert_eq!(
        network.definition_chain("user-theory", "type-theory"),
        Some(
            [
                "user-theory",
                "relative-meta-logic",
                "links-theory",
                "type-theory",
            ]
            .map(str::to_string)
            .to_vec()
        )
    );
}

#[test]
fn accepts_user_defined_linked_semantics_without_host_source_changes() {
    let source = r#"
(linked-program user-counter-program)
(linked-rewrite user-counter-program evaluate-linked-contract
  (from (counter (successor ?value)))
  (to ?value))
(theory source-theory (address user.source-theory))
(theory target-theory (address user.target-theory))
(term source-theory entity user.concept.entity)
(term target-theory entity user.concept.entity)
(implementation user-counter
  (contract user-counter-contract)
  (program user-counter-program)
  (kind user-defined-semantics)
  (subject source-theory)
  (using target-theory)
  (obligation evaluates-linked-contract))
(witness user.definition.counter
  (kind user-defined-semantics)
  (implementation user-counter)
  (proof user.proof.counter))
(proof-object user.proof.counter
  (applies verified-theory-definition)
  (premise-by user.capability.counter)
  (conclusion
    (source-by-target defines source-theory using target-theory
      via user-counter as user-defined-semantics)))
(definition source-by-target
  (subject source-theory)
  (using target-theory)
  (witness user.definition.counter))
"#;
    let trusted_foundation = format!(
        r#"{FOUNDATION}
(implementation-contract user-counter-contract
  (kind user-defined-semantics)
  (obligation evaluates-linked-contract))
(conformance-case user-counter-contract evaluates-linked-contract
  (program user-counter-program)
  (input (counter (successor zero)))
  (expected zero))
(axiom user.capability.counter
  (judgement (user-counter implements user-defined-semantics)))
"#
    );
    let network = TheoryNetwork::from_rml(&format!("{UNIVERSAL}\n{source}"), &trusted_foundation)
        .expect("link-defined semantics must be accepted");

    assert!(
        network
            .definition_verification("source-by-target")
            .unwrap()
            .verified
    );
}

#[test]
fn rejects_ambiguous_term_addresses() {
    let error = network_from(
        r#"
(theory t (address theory.t))
(term t x concept.one)
(term t x concept.two)
"#,
    )
    .expect_err("ambiguous term must be rejected");

    assert_eq!(error, "term t.x maps to both concept.one and concept.two");
}

#[test]
fn rejects_definition_links_without_a_declared_implementation_witness() {
    let error = network_from(
        r#"
(theory base (address theory.base))
(theory derived (address theory.derived))
(definition derived-by-base
  (subject derived)
  (using base)
  (witness missing.implementation))
"#,
    )
    .expect_err("definition witness must be declared");

    assert_eq!(
        error,
        "definition derived-by-base has unknown witness missing.implementation"
    );
}

#[test]
fn rejects_bundled_network_when_every_definition_witness_reference_is_missing() {
    let witnesses = [
        "rml.definition.relative-meta-logic.links",
        "rml.definition.links.set-function",
        "rml.definition.links.dependent-function",
        "rml.definition.links.self",
        "rml.definition.set.extensional-membership",
        "rml.definition.set.ordered-unique-sequence",
        "rml.definition.type.links",
        "rml.definition.graph.finite-sets",
        "rml.definition.graph.types",
        "rml.definition.relation.finite-sets",
        "rml.definition.relation.types",
    ];
    let source = witnesses
        .into_iter()
        .fold(CORE.to_string(), |source, witness| {
            source.replace(
                &format!("(witness {witness}))"),
                "(witness DOES_NOT_EXIST))",
            )
        });
    let error = network_from(&source).expect_err("missing witnesses must fail");
    assert_eq!(
        error,
        "definition rml-by-links has unknown witness DOES_NOT_EXIST"
    );
}

#[test]
fn rejects_network_when_all_declared_implementations_are_non_executable() {
    let source = [
        "theory-network",
        "addressed-doublet-network",
        "typed-doublet-network",
        "doublet-template",
        "membership-doublet-network",
        "canonical-doublet-tree",
        "typed-kernel-links",
        "finite-directed-link-graph",
        "vertex-typed-link-graph",
        "finite-binary-link-relation",
        "typed-binary-link-relation",
    ]
    .into_iter()
    .fold(CORE.to_string(), |source, implementation| {
        source.replace(
            &format!("(implementation {implementation})"),
            "(implementation DOES_NOT_EXIST)",
        )
    });
    let error = network_from(&source).expect_err("unknown implementation must fail");
    assert_eq!(
        error,
        "witness rml.definition.relative-meta-logic.links uses unknown implementation DOES_NOT_EXIST"
    );
}

#[test]
fn rejects_implementation_rebound_to_a_different_theory_definition() {
    let source = CORE.replacen(
        "(implementation addressed-doublet-network\n  (contract addressed-doublet-network)\n  (program links-meta-theory)\n  (kind set-theoretic-function)\n  (subject links-theory)",
        "(implementation addressed-doublet-network\n  (contract addressed-doublet-network)\n  (program links-meta-theory)\n  (kind set-theoretic-function)\n  (subject graph-theory)",
        1,
    );
    let error = network_from(&source).expect_err("rebound implementation must fail");
    assert_eq!(
        error,
        "implementation addressed-doublet-network is declared for graph-theory using set-theory, not links-theory using set-theory"
    );
}

#[test]
fn rejects_implementation_with_incomplete_declared_obligations() {
    let source = CORE.replacen("  (obligation ordered-pair))", ")", 1);
    let error = network_from(&source).expect_err("incomplete implementation must fail");
    assert_eq!(
        error,
        "implementation addressed-doublet-network obligations do not match contract addressed-doublet-network"
    );
}

#[test]
fn rejects_undeclared_implementation_contract_clauses() {
    let source = CORE.replacen(
        "  (contract addressed-doublet-network)",
        "  (contract addressed-doublet-network)\n  (unchecked true)",
        1,
    );
    let error = network_from(&source).expect_err("unknown contract clause must fail");
    assert_eq!(
        error,
        "implementation addressed-doublet-network has unsupported clause unchecked"
    );
}

#[test]
fn rejects_typed_implementation_when_kernel_derivation_no_longer_replays() {
    let source = CORE.replacen(
        "(premise-by rml.type.beta-id-zero)",
        "(premise-by DOES_NOT_EXIST)",
        1,
    );
    let error = network_from(&source).expect_err("invalid typed proof must fail");
    assert_eq!(
        error,
        "proof-obligation typed-kernel-links.beta-conversion failed proof replay"
    );
}

#[test]
fn rejects_valid_typed_witnesses_that_establish_unrelated_judgements() {
    let mut source = CORE.to_string();
    for name in [
        "pi-formation",
        "lambda-introduction",
        "application-elimination",
        "beta-conversion",
    ] {
        let marker = format!("(proof-object rml.type.proof.{name}\n");
        let start = source
            .find(&marker)
            .expect("bundled typed proof object must exist");
        let end = start
            + source[start..]
                .find("\n\n")
                .expect("bundled typed proof object must be closed");
        source.replace_range(
            start..end,
            &format!(
                "(proof-object rml.type.proof.{name}\n  (applies verified-theory-definition)\n  (premise-by rml.capability.addressed-doublet-network)\n  (conclusion\n    (links-by-sets defines links-theory using set-theory\n      via addressed-doublet-network as set-theoretic-function)))"
            ),
        );
    }

    let error =
        network_from(&source).expect_err("typed witnesses for unrelated judgements must fail");
    assert_eq!(
        error,
        "proof-obligation typed-kernel-links.application-elimination failed proof replay"
    );
}

#[test]
fn rejects_missing_or_mismatched_witness_proof() {
    let missing = CORE.replacen(
        "(proof rml.proof.links.set-function)",
        "(proof DOES_NOT_EXIST)",
        1,
    );
    let error = network_from(&missing).expect_err("missing proof must fail");
    assert_eq!(
        error,
        "witness rml.definition.links.set-function has invalid proof DOES_NOT_EXIST: unknown proof-object DOES_NOT_EXIST"
    );

    let mismatched = CORE.replacen(
        "(links-by-sets defines links-theory using set-theory",
        "(links-by-sets defines type-theory using set-theory",
        1,
    );
    let error = network_from(&mismatched).expect_err("mismatched proof must fail");
    assert_eq!(
        error,
        "proof rml.proof.links.set-function does not establish definition links-by-sets"
    );
}

#[test]
fn rejects_definition_proof_after_one_capability_premise_is_corrupted() {
    let corrupted_foundation = FOUNDATION.replacen(
        "(addressed-doublet-network implements set-theoretic-function)",
        "(addressed-doublet-network implements WRONG-KIND)",
        1,
    );
    let error = TheoryNetwork::from_rml(&format!("{UNIVERSAL}\n{CORE}"), &corrupted_foundation)
        .expect_err("corrupted premise must fail");
    assert_eq!(
        error,
        "witness rml.definition.links.set-function has invalid proof rml.proof.links.set-function: proof-object rml.proof.links.set-function: conclusion does not match rule verified-theory-definition"
    );
}

#[test]
fn rejects_candidates_that_attempt_to_authorize_their_own_proofs() {
    let source = format!(
        "{CORE}\n{}",
        r#"
(rule candidate-accepts-anything
  (conclusion
    (forged defines links-theory using set-theory
      via addressed-doublet-network as set-theoretic-function)))
(axiom candidate-capability
  (judgement (addressed-doublet-network implements set-theoretic-function)))
"#
    );

    let error = network_from(&source).expect_err("candidate-authored trust must fail");
    assert_eq!(
        error,
        "candidate theory source cannot declare trusted rule forms"
    );
}

#[test]
fn enforces_typed_doublet_endpoints_and_records_dependent_pair_type() {
    let mut links = TypedLinkNetwork::new();
    links.declare("source.reference", "Reference").unwrap();
    links.declare("source.reference", "Entity").unwrap();
    links.declare("target.reference", "Reference").unwrap();
    links.declare("wrong.reference", "Natural").unwrap();
    links
        .define(
            "typed.link",
            "source.reference",
            "target.reference",
            "Reference",
            "Reference",
        )
        .unwrap();

    assert_eq!(
        links.doublet("typed.link"),
        Some(("source.reference", "target.reference"))
    );
    assert_eq!(
        links.type_of("typed.link"),
        Some("(Pair Reference Reference)")
    );
    assert_eq!(
        links.types_of("source.reference"),
        vec!["Entity", "Reference"]
    );
    assert_eq!(
        links.type_facts(),
        vec![
            ("rml.type-fact.0", "source.reference", "Reference"),
            ("rml.type-fact.1", "source.reference", "Entity"),
            ("rml.type-fact.2", "target.reference", "Reference"),
            ("rml.type-fact.3", "wrong.reference", "Natural"),
            (
                "rml.type-fact.4",
                "typed.link",
                "(Pair Reference Reference)"
            ),
        ]
    );
    let snapshot = links.snapshot();
    links.clear_type_index();
    assert_eq!(
        links.types_of("source.reference"),
        vec!["Entity", "Reference"]
    );
    links.rebuild_type_index();
    assert_eq!(links.snapshot(), snapshot);
    assert_eq!(
        links.define(
            "invalid.typed.link",
            "wrong.reference",
            "target.reference",
            "Reference",
            "Reference",
        ),
        Err("typed link source wrong.reference has type Natural; expected Reference".to_string())
    );
}

#[test]
fn provides_a_selectable_recursively_linked_default_type_ontology() {
    let bare = TypedLinkNetwork::new();
    assert_eq!(bare.doublet("Type"), None);

    let links = TypedLinkNetwork::with_default_ontology();
    assert_eq!(links.doublet("Type"), Some(("Type", "Type")));
    assert_eq!(links.doublet("SubType"), Some(("Type", "SubType")));
    assert_eq!(links.doublet("Value"), Some(("SubType", "Value")));
    assert_eq!(links.types_of("Type"), vec!["Type"]);
    assert_eq!(links.types_of("SubType"), vec!["Type"]);
    assert_eq!(links.types_of("Value"), vec!["SubType"]);
    assert_eq!(
        links.validate_closure(),
        LinkClosureReport {
            closed: true,
            missing_references: Vec::new(),
        }
    );

    let interop = links.link_cli_interop_profile();
    assert_eq!(interop.revision, "e801cb877f8ed90a103ee253add6f702da89ee40");
    assert_eq!(
        interop
            .pinned_types
            .iter()
            .map(|mapping| (mapping.rml_address.as_str(), mapping.exact_shape))
            .collect::<Vec<_>>(),
        vec![("Type", true), ("SubType", true), ("Value", false)]
    );
    assert_eq!(interop.pinned_types[2].mapped_rml_shape, Some((3, 2, 3)));
    assert_eq!(interop.pinned_types[2].link_cli_shape, (3, 1, 3));
    assert!(interop.unicode_type_fact_orientation_compatible);
    assert!(!interop.unicode_canonical_definition_orientation_compatible);
    assert!(!interop.names_require_numeric_identity);
}

#[test]
fn leaves_the_default_type_ontology_to_the_callers_that_select_it() {
    // The ontology's `Type: (Type, Type)` link is not a `Type : Type` rule of
    // the evaluator, whose universes stay stratified and which answers
    // `Type of Type` only for a source that declares it.
    let ontology = TypedLinkNetwork::with_default_ontology();
    assert_eq!(ontology.doublet("Type"), Some(("Type", "Type")));
    let out = evaluate(
        r#"
(? (Type of Type))
(? ((Type 0) of (Type 1)))
(? ((Type 1) of (Type 0)))
"#,
        None,
        None,
    );
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
    assert_eq!(
        out.results,
        vec![
            RunResult::Num(0.0),
            RunResult::Num(1.0),
            RunResult::Num(0.0),
        ]
    );
    assert_eq!(
        evaluate("(Type: Type Type)\n(? (Type of Type))", None, None).results,
        vec![RunResult::Num(1.0)]
    );

    // No runtime module selects the ontology: its definition is the only line
    // under `rust/src` that names it.
    let source_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = files_under(&source_directory);
    files.sort();
    let mut selections = Vec::new();
    for path in files {
        let name = path
            .strip_prefix(&source_directory)
            .expect("file under the source directory")
            .to_string_lossy()
            .into_owned();
        for line in fs::read_to_string(&path).expect("readable source").lines() {
            if line.contains("with_default_ontology") {
                selections.push(format!("{name}: {}", line.trim()));
            }
        }
    }
    assert_eq!(
        selections,
        vec!["theory_network.rs: pub fn with_default_ontology() -> Self {"]
    );
}

#[test]
fn stores_directed_graphs_as_vertex_membership_and_typed_edge_links() {
    let mut links = LinkNetwork::new();
    links.define("raw.link", "vertex.a", "vertex.b").unwrap();
    assert_eq!(links.doublet("raw.link"), Some(("vertex.a", "vertex.b")));

    let mut graph = LinkGraph::new("example.graph").unwrap();
    graph.add_vertex("vertex.c").unwrap();
    graph.add_vertex("vertex.a").unwrap();
    graph.add_vertex("vertex.b").unwrap();
    graph
        .define_edge("edge.ab", "vertex.a", "vertex.b")
        .unwrap();
    graph
        .define_edge("edge.bc", "vertex.b", "vertex.c")
        .unwrap();

    assert_eq!(graph.vertices(), vec!["vertex.a", "vertex.b", "vertex.c"]);
    assert_eq!(graph.edge("edge.ab"), Some(("vertex.a", "vertex.b")));
    assert_eq!(
        graph.edge_type("edge.ab"),
        Some("(Pair example.graph.vertex example.graph.vertex)")
    );
    assert_eq!(graph.successors("vertex.a"), vec!["vertex.b"]);
    assert!(graph.reachable("vertex.a", "vertex.c"));
    assert!(!graph.reachable("vertex.c", "vertex.a"));
    assert_eq!(
        graph.define_edge("edge.invalid", "vertex.a", "vertex.missing"),
        Err("edge target vertex.missing is not a vertex of example.graph".to_string())
    );
}

#[test]
fn executes_finite_relational_algebra_as_typed_links() {
    let mut relation = FiniteRelation::new(
        "relation.r",
        &["domain.a", "domain.b"],
        &["middle.x", "middle.y"],
    )
    .unwrap();
    relation.define("pair.ax", "domain.a", "middle.x").unwrap();
    relation.define("pair.by", "domain.b", "middle.y").unwrap();
    assert_eq!(
        relation.pair_type("pair.ax"),
        Some("(Pair relation.r.domain relation.r.codomain)")
    );

    let mut extra = FiniteRelation::new(
        "relation.extra",
        &["domain.a", "domain.b"],
        &["middle.x", "middle.y"],
    )
    .unwrap();
    extra.define("pair.ay", "domain.a", "middle.y").unwrap();
    extra
        .define("pair.by.again", "domain.b", "middle.y")
        .unwrap();

    assert_eq!(
        relation.converse("relation.converse").unwrap().pairs(),
        vec![("middle.x", "domain.a"), ("middle.y", "domain.b")]
    );
    assert_eq!(
        relation.union(&extra, "relation.union").unwrap().pairs(),
        vec![
            ("domain.a", "middle.x"),
            ("domain.a", "middle.y"),
            ("domain.b", "middle.y")
        ]
    );
    assert_eq!(
        relation
            .intersection(&extra, "relation.intersection")
            .unwrap()
            .pairs(),
        vec![("domain.b", "middle.y")]
    );

    let mut next = FiniteRelation::new(
        "relation.s",
        &["middle.x", "middle.y"],
        &["codomain.one", "codomain.two"],
    )
    .unwrap();
    next.define("pair.x1", "middle.x", "codomain.one").unwrap();
    next.define("pair.y2", "middle.y", "codomain.two").unwrap();
    assert_eq!(
        relation
            .compose(&next, "relation.composed")
            .unwrap()
            .pairs(),
        vec![("domain.a", "codomain.one"), ("domain.b", "codomain.two")]
    );
    assert_eq!(
        relation.define("pair.invalid", "domain.missing", "middle.x"),
        Err("relation left value domain.missing is outside the declared domain".to_string())
    );
}

#[test]
fn executes_independent_extensional_membership_set_interpretation() {
    let mut sets = MembershipSetStore::new();
    sets.define("membership.1", "concept.alpha", "set.left")
        .unwrap();
    sets.define("membership.2", "concept.beta", "set.left")
        .unwrap();
    sets.define("membership.3", "concept.beta", "set.right")
        .unwrap();
    sets.define("membership.4", "concept.alpha", "set.right")
        .unwrap();

    assert!(sets.has("set.left", "concept.alpha"));
    assert_eq!(
        sets.members("set.left"),
        vec!["concept.alpha", "concept.beta"]
    );
    assert!(sets.equals("set.left", "set.right"));
    assert!(sets.is_subset_of("set.left", "set.right"));
    assert_eq!(
        sets.pair("concept.beta", "concept.alpha").unwrap(),
        ["concept.alpha", "concept.beta"].map(str::to_string)
    );

    sets.define("membership.5", "set.left", "set.collection")
        .unwrap();
    sets.define("membership.6", "set.right", "set.collection")
        .unwrap();
    assert_eq!(
        sets.union("set.collection"),
        vec!["concept.alpha", "concept.beta"]
    );
    assert_eq!(
        sets.separation("set.left", |member| member.ends_with("beta")),
        vec!["concept.beta"]
    );
    assert_eq!(
        sets.replacement("set.left", |member| format!("{member}.image"))
            .unwrap(),
        ["concept.alpha.image", "concept.beta.image"].map(str::to_string)
    );
}

#[test]
fn encodes_balanced_left_and_right_sequence_trees_as_links() {
    let values = [
        "concept.alpha",
        "concept.beta",
        "concept.gamma",
        "concept.delta",
    ];

    let mut balanced = DoubletSequenceStore::new();
    let balanced_head = balanced
        .encode_sequence(&values, "balanced", SequenceLayout::Balanced)
        .expect("balanced tree must encode");
    assert_eq!(balanced_head, "balanced.cell.0");
    assert_eq!(
        balanced.doublet("balanced.cell.0"),
        Some(("balanced.cell.1", "balanced.cell.2"))
    );
    assert_eq!(
        balanced.doublet("balanced.cell.1"),
        Some(("concept.alpha", "concept.beta"))
    );
    assert_eq!(
        balanced.doublet("balanced.cell.2"),
        Some(("concept.gamma", "concept.delta"))
    );
    assert_eq!(
        balanced.decode_sequence(&balanced_head),
        Ok(values.map(str::to_string).to_vec())
    );

    let mut left = DoubletSequenceStore::new();
    let left_head = left
        .encode_sequence(&values, "left", SequenceLayout::Left)
        .expect("left staircase must encode");
    assert_eq!(
        left.decode_sequence(&left_head),
        Ok(values.map(str::to_string).to_vec())
    );
    assert_eq!(
        left.doublet(&left_head),
        Some(("left.cell.1", "concept.delta"))
    );

    let mut right = DoubletSequenceStore::new();
    let right_head = right
        .encode_sequence(&values, "right", SequenceLayout::Right)
        .expect("right staircase must encode");
    assert_eq!(
        right.decode_sequence(&right_head),
        Ok(values.map(str::to_string).to_vec())
    );
    assert_eq!(
        right.doublet(&right_head),
        Some(("concept.alpha", "right.cell.1"))
    );
}

#[test]
fn round_trips_ordered_set_as_nested_doublets_without_duplicates() {
    let mut store = DoubletSequenceStore::new();
    let head = store
        .encode_ordered_set(
            &["concept.alpha", "concept.beta", "concept.gamma"],
            "example.set",
        )
        .expect("unique set must encode");

    assert_eq!(
        store.decode_ordered_set(&head),
        Ok(["concept.alpha", "concept.beta", "concept.gamma"]
            .map(str::to_string)
            .to_vec())
    );
    assert_eq!(
        store.encode_ordered_set(&["concept.alpha", "concept.alpha"], "duplicate.set"),
        Err("ordered set contains duplicate concept.alpha".to_string())
    );
    assert_eq!(
        store.encode_ordered_set(&["concept.alpha"], ""),
        Err("ordered set address must be a non-empty reference".to_string())
    );
}

#[test]
fn canonicalizes_extensional_set_to_one_sorted_unique_link_tree() {
    let mut store = DoubletSequenceStore::new();
    let head = store
        .encode_set(
            &[
                "concept.gamma",
                "concept.alpha",
                "concept.beta",
                "concept.alpha",
            ],
            "example.canonical-set",
        )
        .expect("set must encode");

    assert_eq!(
        store.decode_set(&head),
        Ok(["concept.alpha", "concept.beta", "concept.gamma"]
            .map(str::to_string)
            .to_vec())
    );
    assert_eq!(
        store.doublet(&head),
        Some(("concept.alpha", "example.canonical-set.cell.1"))
    );
}

#[test]
fn unfolds_direct_self_reference_only_to_requested_finite_prefix() {
    let mut store = DoubletSequenceStore::new();
    store
        .define("repeat.alpha", "concept.alpha", "repeat.alpha")
        .expect("new address must be accepted");

    let shortest_walk = store
        .walk("repeat.alpha", 1)
        .expect("sequence must resolve");
    assert_eq!(shortest_walk.values, vec!["concept.alpha"]);
    assert!(shortest_walk.cyclic);
    assert_eq!(shortest_walk.cycle_at, Some(0));

    let walk = store
        .walk("repeat.alpha", 4)
        .expect("sequence must resolve");
    assert_eq!(
        walk.values,
        vec![
            "concept.alpha",
            "concept.alpha",
            "concept.alpha",
            "concept.alpha"
        ]
    );
    assert!(!walk.complete);
    assert!(walk.cyclic);
    assert_eq!(walk.cycle_at, Some(0));
}

#[test]
fn unfolds_indirect_self_reference_and_reports_its_cycle() {
    let mut store = DoubletSequenceStore::new();
    store
        .define("alternating.a", "concept.alpha", "alternating.b")
        .expect("new address must be accepted");
    store
        .define("alternating.b", "concept.beta", "alternating.a")
        .expect("new address must be accepted");

    assert!(
        store
            .walk("alternating.a", 2)
            .expect("sequence must resolve")
            .cyclic
    );
    let walk = store
        .walk("alternating.a", 5)
        .expect("sequence must resolve");
    assert_eq!(
        walk.values,
        vec![
            "concept.alpha",
            "concept.beta",
            "concept.alpha",
            "concept.beta",
            "concept.alpha",
        ]
    );
    assert!(!walk.complete);
    assert!(walk.cyclic);
    assert_eq!(walk.cycle_at, Some(0));
    assert_eq!(
        store.decode_ordered_set("alternating.a"),
        Err("ordered set must be finite; alternating.a is cyclic".to_string())
    );
}

#[test]
fn keeps_nested_membership_set_addresses_distinct_and_rejects_extensional_non_members() {
    let mut sets = MembershipSetStore::new();
    sets.define("inner.a", "a", "inner").unwrap();
    sets.define("inner.b", "b", "inner").unwrap();
    sets.define("outer.inner", "inner", "outer").unwrap();
    assert_eq!(sets.members("outer"), vec!["inner"]);
    assert_eq!(sets.members("inner"), vec!["a", "b"]);
    assert!(!sets.has("outer", "a"));
    assert!(!sets.equals("inner", "outer"));
    assert!(!sets.is_subset_of("inner", "outer"));
    assert_eq!(sets.union("outer"), vec!["a", "b"]);
    assert!(sets.members("missing").is_empty());
    assert!(sets
        .define("inner.a", "other", "inner")
        .unwrap_err()
        .contains("already defined"));
    assert_eq!(sets.members("inner"), vec!["a", "b"]);
}

#[test]
fn round_trips_empty_singleton_and_repeated_finite_leaves_in_every_sequence_layout() {
    for layout in [
        SequenceLayout::Balanced,
        SequenceLayout::Left,
        SequenceLayout::Right,
    ] {
        for values in [vec![], vec!["only"], vec!["a", "a", "b", "a", "c"]] {
            let mut store = DoubletSequenceStore::new();
            let head = store.encode_sequence(&values, "sequence", layout).unwrap();
            assert_eq!(store.decode_sequence(&head).unwrap(), values);
        }
    }
}

#[test]
fn rejects_cyclic_finite_decoding_and_colliding_sequence_addresses_without_partial_writes() {
    for layout in [
        SequenceLayout::Balanced,
        SequenceLayout::Left,
        SequenceLayout::Right,
    ] {
        let mut store = DoubletSequenceStore::new();
        assert!(store
            .encode_sequence(&["sequence.cell.0", "a"], "sequence", layout)
            .unwrap_err()
            .contains("collides with an internal link"));
        assert_eq!(store.doublet("sequence.cell.0"), None);
        store.define("sequence.cell.0", "existing", "leaf").unwrap();
        let before = store.clone();
        assert!(store
            .encode_sequence(&["a", "b", "c"], "sequence", layout)
            .unwrap_err()
            .contains("already defined"));
        assert_eq!(store, before);
    }
    let mut cyclic = DoubletSequenceStore::new();
    cyclic.define("self", "a", "self").unwrap();
    cyclic.define("first", "b", "second").unwrap();
    cyclic.define("second", "c", "first").unwrap();
    assert_eq!(
        cyclic.decode_sequence("self"),
        Err("sequence self is cyclic".to_string())
    );
    assert_eq!(
        cyclic.decode_sequence("first"),
        Err("sequence first is cyclic".to_string())
    );
}

#[test]
fn rejects_non_vertex_graph_endpoints_without_creating_edges_or_reachability() {
    let mut graph = LinkGraph::new("graph").unwrap();
    graph.add_vertex("a").unwrap();
    graph.add_vertex("b").unwrap();
    assert!(graph
        .define_edge("bad.source", "missing", "b")
        .unwrap_err()
        .contains("edge source missing is not a vertex"));
    assert!(graph
        .define_edge("bad.target", "a", "missing")
        .unwrap_err()
        .contains("edge target missing is not a vertex"));
    assert_eq!(graph.edge("bad.source"), None);
    assert_eq!(graph.edge("bad.target"), None);
    assert_eq!(graph.edge_type("bad.target"), None);
    assert!(!graph.reachable("a", "b"));
    assert!(!graph.reachable("missing", "missing"));
    assert!(graph.successors("a").is_empty());
    graph.define_edge("valid", "a", "b").unwrap();
    assert!(graph.reachable("a", "b"));
}

#[test]
fn rejects_relational_signature_mismatches_and_out_of_carrier_pairs_without_mutation() {
    let mut relation = FiniteRelation::new("r", &["a"], &["b"]).unwrap();
    relation.define("ab", "a", "b").unwrap();
    assert!(relation
        .define("bad.left", "missing", "b")
        .unwrap_err()
        .contains("outside the declared domain"));
    assert!(relation
        .define("bad.right", "a", "missing")
        .unwrap_err()
        .contains("outside the declared codomain"));
    assert!(relation
        .define("duplicate", "a", "b")
        .unwrap_err()
        .contains("already contains"));
    assert!(relation
        .union(
            &FiniteRelation::new("other", &["a"], &["c"]).unwrap(),
            "union"
        )
        .unwrap_err()
        .contains("equal domains and codomains"));
    assert!(relation
        .intersection(
            &FiniteRelation::new("other", &["c"], &["b"]).unwrap(),
            "intersection"
        )
        .unwrap_err()
        .contains("equal domains and codomains"));
    assert!(relation
        .compose(
            &FiniteRelation::new("other", &["c"], &["d"]).unwrap(),
            "composition"
        )
        .unwrap_err()
        .contains("first codomain to equal the next domain"));
    assert_eq!(relation.pairs(), vec![("a", "b")]);
    for address in ["bad.left", "bad.right", "duplicate"] {
        assert_eq!(relation.pair_type(address), None);
    }
}

#[test]
fn keeps_typing_and_validation_invariant_when_the_derived_index_is_deleted_and_rebuilt() {
    let mut outcomes = Vec::new();
    for mode in ["present", "deleted", "rebuilt"] {
        let mut links = TypedLinkNetwork::with_default_ontology();
        let before = links.snapshot();
        if mode != "present" {
            links.clear_type_index();
        }
        if mode == "rebuilt" {
            links.rebuild_type_index();
        }
        assert_eq!(links.snapshot(), before);
        assert_eq!(links.types_of("Value"), vec!["SubType"]);
        assert!(links.validate_closure().closed);
        assert!(links
            .define("invalid", "Value", "Type", "Type", "Type")
            .unwrap_err()
            .contains("expected Type"));
        assert_eq!(links.doublet("invalid"), None);
        links
            .define("valid", "Value", "Type", "SubType", "Type")
            .unwrap();
        assert_eq!(links.type_of("valid"), Some("(Pair SubType Type)"));
        links.declare("Value", "Type").unwrap();
        assert_eq!(links.types_of("Value"), vec!["SubType", "Type"]);
        outcomes.push(links.snapshot());
    }
    assert_eq!(outcomes[1], outcomes[0]);
    assert_eq!(outcomes[2], outcomes[0]);
}

#[test]
fn does_not_authorize_a_typed_link_after_its_authoritative_type_fact_is_removed() {
    let mut snapshot = TypedLinkNetwork::with_default_ontology().snapshot();
    snapshot
        .type_facts
        .retain(|(_, subject, _)| subject != "Value");
    let mut links = TypedLinkNetwork::from_snapshot(&snapshot, true).unwrap();
    for mode in ["present", "deleted", "rebuilt"] {
        if mode == "deleted" {
            links.clear_type_index();
        }
        if mode == "rebuilt" {
            links.rebuild_type_index();
        }
        assert!(links.types_of("Value").is_empty());
        assert!(links
            .define("forged", "Value", "Type", "SubType", "Type")
            .unwrap_err()
            .contains("has no declared type"));
        assert_eq!(links.doublet("forged"), None);
        assert_eq!(links.snapshot(), snapshot);
    }
}

#[test]
fn rejects_default_ontology_closure_when_a_canonical_classifier_link_is_missing() {
    for address in ["Type", "SubType", "Value"] {
        let mut snapshot = TypedLinkNetwork::with_default_ontology().snapshot();
        snapshot.links.retain(|(name, _, _)| name != address);
        let open = TypedLinkNetwork::from_snapshot(&snapshot, false).unwrap();
        assert!(!open.validate_closure().closed);
        assert_eq!(
            open.validate_closure().missing_references,
            vec![address.to_string()]
        );
        assert!(TypedLinkNetwork::from_snapshot(&snapshot, true)
            .unwrap_err()
            .contains("dangling references"));
    }
}

#[test]
fn does_not_report_missing_or_reversed_ontology_links_as_exact_link_cli_pinned_types() {
    let absent = TypedLinkNetwork::new().link_cli_interop_profile();
    assert!(absent
        .pinned_types
        .iter()
        .all(|mapping| mapping.mapped_rml_shape.is_none() && !mapping.exact_shape));
    let mut snapshot = TypedLinkNetwork::with_default_ontology().snapshot();
    let subtype = snapshot
        .links
        .iter_mut()
        .find(|(address, _, _)| address == "SubType")
        .unwrap();
    std::mem::swap(&mut subtype.1, &mut subtype.2);
    let profile = TypedLinkNetwork::from_snapshot(&snapshot, true)
        .unwrap()
        .link_cli_interop_profile();
    assert_eq!(profile.pinned_types[1].mapped_rml_shape, Some((2, 2, 1)));
    assert!(!profile.pinned_types[1].exact_shape);
    assert!(profile.pinned_types[0].exact_shape);
    assert!(!profile.pinned_types[2].exact_shape);
}

fn reference_sequence_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/reference-sequences/v1.json"
    ))
    .unwrap()
}

fn reference_sequence_triples(value: &serde_json::Value) -> Vec<(String, String, String)> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row[0].as_str().unwrap().to_string(),
                row[1].as_str().unwrap().to_string(),
                row[2].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn restore_reference_sequence(triples: &[(String, String, String)]) -> DoubletSequenceStore {
    let mut store = DoubletSequenceStore::new();
    for (address, source, target) in triples {
        store.define(address, source, target).unwrap();
    }
    store
}

#[test]
fn preserves_nested_shared_and_cyclic_element_identities_in_every_versioned_layout_after_linked_transport(
) {
    let fixture = reference_sequence_fixture();
    let links = reference_sequence_triples(&fixture["links"]);
    let values: Vec<&str> = fixture["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect();
    for layout in [
        SequenceLayout::Balanced,
        SequenceLayout::Left,
        SequenceLayout::Right,
    ] {
        let mut store = restore_reference_sequence(&links);
        for (name, values) in [
            ("empty", vec![]),
            ("singleton", vec!["inner"]),
            ("sequence", values.clone()),
        ] {
            let head = store
                .encode_reference_sequence(&values, name, layout)
                .unwrap();
            assert_eq!(store.decode_reference_sequence(&head).unwrap(), values);
            assert_eq!(
                restore_reference_sequence(&store.entries())
                    .decode_reference_sequence(&head)
                    .unwrap(),
                values
            );
        }
        let pair = store
            .encode_reference_sequence(&["inner", "direct-cycle"], "example", layout)
            .unwrap();
        assert_eq!(pair, "example.cell.0");
        let encoded: Vec<_> = store
            .entries()
            .into_iter()
            .filter(|(address, _, _)| address.starts_with("example."))
            .collect();
        assert_eq!(
            encoded,
            reference_sequence_triples(&fixture["twoElementEncoding"])
        );
        for (address, source, target) in &links {
            assert_eq!(
                store.doublet(address),
                Some((source.as_str(), target.as_str()))
            );
        }
    }
    let mut supplied_links = links;
    supplied_links.extend(reference_sequence_triples(
        &fixture["nonGeneratedStructure"],
    ));
    let supplied = restore_reference_sequence(&supplied_links);
    assert_eq!(
        supplied.decode_reference_sequence("root").unwrap(),
        vec!["direct-cycle", "direct-cycle"]
    );
    assert_eq!(supplied.decode_sequence("inner").unwrap(), vec!["a", "b"]);
}

#[test]
fn rejects_malformed_or_cyclic_versioned_structure_and_generated_address_collisions_atomically() {
    let links = reference_sequence_triples(&reference_sequence_fixture()["links"]);
    for layout in [
        SequenceLayout::Balanced,
        SequenceLayout::Left,
        SequenceLayout::Right,
    ] {
        for collision in ["reserved.cell.0", "reserved.children.0"] {
            let mut store = restore_reference_sequence(&links);
            let before = store.entries();
            assert!(store
                .encode_reference_sequence(&[collision, "inner"], "reserved", layout)
                .unwrap_err()
                .contains("collides with an internal link"));
            assert_eq!(store.entries(), before);
            store.define(collision, "original", "value").unwrap();
            let occupied = store.entries();
            assert!(store
                .encode_reference_sequence(&["inner", "direct-cycle"], "reserved", layout)
                .unwrap_err()
                .contains("already defined"));
            assert_eq!(store.entries(), occupied);
        }
    }
    let mut store = restore_reference_sequence(&links);
    assert!(store
        .decode_reference_sequence("missing")
        .unwrap_err()
        .contains("unknown reference sequence address"));
    assert!(store
        .decode_reference_sequence("inner")
        .unwrap_err()
        .contains("invalid reference sequence constructor"));
    store
        .define(
            "broken",
            "rml.reference-sequence.v1.branch",
            "absent-children",
        )
        .unwrap();
    assert!(store
        .decode_reference_sequence("broken")
        .unwrap_err()
        .contains("unknown reference sequence children"));
    store
        .define(
            "cycle",
            "rml.reference-sequence.v1.branch",
            "cycle-children",
        )
        .unwrap();
    store.define("cycle-children", "cycle", "cycle").unwrap();
    assert_eq!(
        store.decode_reference_sequence("cycle"),
        Err("reference sequence cycle is cyclic".to_string())
    );
    assert!(store
        .encode_reference_sequence(&[""], "invalid", SequenceLayout::Balanced)
        .unwrap_err()
        .contains("non-empty reference"));
}

#[test]
fn represents_nested_ordered_and_extensional_sets_without_flattening_their_member_links() {
    let mut store = restore_reference_sequence(&reference_sequence_triples(
        &reference_sequence_fixture()["links"],
    ));
    let inner = store
        .encode_reference_set(&["b", "a", "b"], "set.inner")
        .unwrap();
    let outer = store.encode_reference_set(&[&inner], "set.outer").unwrap();
    assert_ne!(outer, inner);
    assert_eq!(store.decode_reference_set(&inner).unwrap(), vec!["a", "b"]);
    assert_eq!(
        store.decode_reference_set(&outer).unwrap(),
        vec![inner.clone()]
    );
    let ordered = store
        .encode_reference_ordered_set(&["indirect-a", &inner, "direct-cycle"], "ordered")
        .unwrap();
    assert_eq!(
        store.decode_reference_ordered_set(&ordered).unwrap(),
        vec!["indirect-a", &inner, "direct-cycle"]
    );
    let canonical = store
        .encode_reference_set(&["indirect-a", &inner, "direct-cycle", &inner], "canonical")
        .unwrap();
    assert_eq!(
        store.decode_reference_set(&canonical).unwrap(),
        vec!["direct-cycle", "indirect-a", &inner]
    );
    let restored = restore_reference_sequence(&store.entries());
    assert_eq!(
        restored.decode_reference_set(&outer).unwrap(),
        vec![inner.clone()]
    );
    assert_eq!(
        restored.decode_reference_ordered_set(&ordered).unwrap(),
        vec!["indirect-a", &inner, "direct-cycle"]
    );
}

#[test]
fn rejects_duplicate_reference_set_members_and_noncanonical_linked_order() {
    let mut store = restore_reference_sequence(&reference_sequence_triples(
        &reference_sequence_fixture()["links"],
    ));
    let before = store.entries();
    assert_eq!(
        store.encode_reference_ordered_set(&["inner", "inner"], "duplicate"),
        Err("ordered set contains duplicate inner".to_string())
    );
    assert_eq!(store.entries(), before);
    let duplicate = store
        .encode_reference_sequence(&["inner", "inner"], "duplicate", SequenceLayout::Balanced)
        .unwrap();
    assert_eq!(
        store.decode_reference_ordered_set(&duplicate),
        Err("ordered set contains duplicate inner".to_string())
    );
    assert!(store
        .decode_reference_set(&duplicate)
        .unwrap_err()
        .contains("strict canonical order"));
    let unordered = store
        .encode_reference_ordered_set(&["inner", "direct-cycle"], "unordered")
        .unwrap();
    assert!(store
        .decode_reference_set(&unordered)
        .unwrap_err()
        .contains("strict canonical order"));
}

#[test]
fn handles_large_versioned_left_and_right_sequences_without_host_recursion() {
    let values: Vec<String> = (0..20_000).map(|index| format!("item.{index}")).collect();
    let references: Vec<&str> = values.iter().map(String::as_str).collect();
    for layout in [
        SequenceLayout::Balanced,
        SequenceLayout::Left,
        SequenceLayout::Right,
    ] {
        let mut store = DoubletSequenceStore::new();
        let head = store
            .encode_reference_sequence(&references, "large", layout)
            .unwrap();
        assert_eq!(head, "large.cell.0");
        assert_eq!(store.decode_reference_sequence(&head).unwrap(), values);
        assert_eq!(store.entries().len(), 3 * values.len() - 2);
    }
}

#[test]
fn bounds_deep_and_shared_versioned_structure_by_expanded_visits_and_output_count() {
    let mut store = DoubletSequenceStore::new();
    let element = "rml.reference-sequence.v1.element";
    let branch = "rml.reference-sequence.v1.branch";
    let empty = "rml.sequence.empty";
    store.define("opaque", "opaque", "opaque").unwrap();
    store.define("leaf", element, "opaque").unwrap();
    let mut root = "leaf".to_string();
    for index in 0..20_000 {
        let address = format!("deep.{index}");
        let children = format!("deep.children.{index}");
        store.define(&address, branch, &children).unwrap();
        store.define(&children, &root, empty).unwrap();
        root = address;
    }
    assert_eq!(
        store.decode_reference_sequence(&root).unwrap(),
        vec!["opaque"]
    );
    assert!(store
        .decode_reference_sequence_with_limits(&root, 100, 1_000_000)
        .unwrap_err()
        .contains("visit limit exceeded"));
    assert!(store
        .decode_reference_sequence_with_limits(&root, 1_000_000, 0)
        .unwrap_err()
        .contains("value limit exceeded"));
    store.define("shared", branch, "shared.children").unwrap();
    store.define("shared.children", "leaf", "leaf").unwrap();
    assert_eq!(
        store
            .decode_reference_sequence_with_limits("shared", 3, 2)
            .unwrap(),
        vec!["opaque", "opaque"]
    );
    assert!(store
        .decode_reference_sequence_with_limits("shared", 2, 1_000_000)
        .unwrap_err()
        .contains("visit limit exceeded"));
    assert!(store
        .decode_reference_sequence_with_limits("shared", 1_000_000, 1)
        .unwrap_err()
        .contains("value limit exceeded"));
    assert!(store
        .decode_reference_ordered_set_with_limits("shared", 2, 1_000_000)
        .unwrap_err()
        .contains("visit limit exceeded"));
    assert!(store
        .decode_reference_set_with_limits("shared", 1_000_000, 1)
        .unwrap_err()
        .contains("value limit exceeded"));
    let mut shared_root = "leaf".to_string();
    for index in 0..40 {
        let address = format!("dag.{index}");
        let children = format!("dag.children.{index}");
        store.define(&address, branch, &children).unwrap();
        store.define(&children, &shared_root, &shared_root).unwrap();
        shared_root = address;
    }
    // Revisited shared nodes spend budget: 81 structural links describe 2^40 values.
    assert!(store
        .decode_reference_sequence_with_limits(&shared_root, 1000, 1000)
        .unwrap_err()
        .contains("visit limit exceeded"));
    assert!(store
        .decode_reference_sequence_with_limits(&shared_root, 1000, 3)
        .unwrap_err()
        .contains("value limit exceeded"));
    assert!(store
        .decode_reference_sequence_with_limits(empty, 1, 0)
        .unwrap()
        .is_empty());
    assert!(store
        .decode_reference_sequence_with_limits(empty, 0, 1_000_000)
        .unwrap_err()
        .contains("visit limit exceeded"));
}
