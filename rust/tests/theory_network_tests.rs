// Executable meta-theory acceptance tests for issue #183.
// Mirrors js/tests/theory-network.test.mjs so both runtimes expose the same
// theory network, unified-address, and self-referential sequence semantics.

use rml::theory_network::{
    DoubletSequenceStore, FiniteRelation, LinkGraph, LinkNetwork, MembershipSetStore,
    SequenceLayout, TheoryNetwork,
};
use rml::{evaluate, RunResult};
use std::collections::BTreeSet;
use std::path::PathBuf;

const CORE: &str = include_str!("../../lib/meta-theory/core.lino");

fn bundled_network() -> TheoryNetwork {
    TheoryNetwork::from_rml(CORE).expect("bundled meta-theory must be valid")
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
    assert!(verification.verified);
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
(witness user.definition.rml
  (kind link-network-composition)
  (implementation theory-network)
  (proof user.proof.rml))
(proof-object user.proof.rml
  (applies verified-theory-definition)
  (premise-by rml.capability.theory-network)
  (conclusion
    (user-by-rml defines user-theory using relative-meta-logic
      via theory-network as link-network-composition)))
(definition user-by-rml
  (subject user-theory)
  (using relative-meta-logic)
  (witness user.definition.rml))
"#
    );
    let network = TheoryNetwork::from_rml(&source).expect("user theory must be valid");

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
fn rejects_ambiguous_term_addresses() {
    let error = TheoryNetwork::from_rml(
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
    let error = TheoryNetwork::from_rml(
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
    let error = TheoryNetwork::from_rml(&source).expect_err("unknown implementation must fail");
    assert_eq!(
        error,
        "witness rml.definition.relative-meta-logic.links uses unknown implementation DOES_NOT_EXIST"
    );
}

#[test]
fn rejects_missing_or_mismatched_witness_proof() {
    let missing = CORE.replacen(
        "(proof rml.proof.links.set-function)",
        "(proof DOES_NOT_EXIST)",
        1,
    );
    let error = TheoryNetwork::from_rml(&missing).expect_err("missing proof must fail");
    assert_eq!(
        error,
        "witness rml.definition.links.set-function has invalid proof DOES_NOT_EXIST: unknown proof-object DOES_NOT_EXIST"
    );

    let mismatched = CORE.replacen(
        "(links-by-sets defines links-theory using set-theory",
        "(links-by-sets defines type-theory using set-theory",
        1,
    );
    let error = TheoryNetwork::from_rml(&mismatched).expect_err("mismatched proof must fail");
    assert_eq!(
        error,
        "proof rml.proof.links.set-function does not establish definition links-by-sets"
    );
}

#[test]
fn rejects_definition_proof_after_one_capability_premise_is_corrupted() {
    let corrupted = CORE.replacen(
        "(addressed-doublet-network implements set-theoretic-function)",
        "(addressed-doublet-network implements WRONG-KIND)",
        1,
    );
    let error = TheoryNetwork::from_rml(&corrupted).expect_err("corrupted premise must fail");
    assert_eq!(
        error,
        "witness rml.definition.links.set-function has invalid proof rml.proof.links.set-function: proof-object rml.proof.links.set-function: conclusion does not match rule verified-theory-definition"
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
