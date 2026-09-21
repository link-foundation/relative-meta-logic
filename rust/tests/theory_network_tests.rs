// Executable meta-theory acceptance tests for issue #183.
// Mirrors js/tests/theory-network.test.mjs so both runtimes expose the same
// theory network, unified-address, and self-referential sequence semantics.

use rml::formal_corpus::FormalCorpus;
use rml::theory_network::{
    DoubletSequenceStore, FiniteRelation, LinkGraph, LinkNetwork, MembershipSetStore,
    SequenceLayout, TheoryNetwork, TypedLinkNetwork,
};
use rml::{evaluate, RunResult};
use std::collections::BTreeSet;
use std::path::PathBuf;

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
