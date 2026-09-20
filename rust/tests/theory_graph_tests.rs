// Executable meta-theory acceptance tests for issue #183.
// Mirrors js/tests/theory-graph.test.mjs so both runtimes expose the same
// theory graph, unified-address, and self-referential sequence semantics.

use rml::theory_graph::{DoubletSequenceStore, TheoryGraph};
use rml::{evaluate, RunResult};
use std::path::PathBuf;

const CORE: &str = include_str!("../../lib/meta-theory/core.lino");

fn bundled_graph() -> TheoryGraph {
    TheoryGraph::from_rml(CORE).expect("bundled meta-theory must be valid")
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
    let graph = bundled_graph();

    assert!(graph.meta_language_round_trip_ok());
    assert_eq!(
        graph.theory_names(),
        vec![
            "links-theory",
            "relative-meta-logic",
            "set-theory",
            "type-theory",
        ]
    );
}

#[test]
fn makes_rml_depend_on_links_theory_and_closes_set_type_self_cycle() {
    let graph = bundled_graph();

    assert_eq!(
        graph.definition_path("relative-meta-logic", "set-theory"),
        Some(
            ["relative-meta-logic", "links-theory", "set-theory"]
                .map(str::to_string)
                .to_vec()
        )
    );
    assert_eq!(
        graph.definition_path("relative-meta-logic", "type-theory"),
        Some(
            ["relative-meta-logic", "links-theory", "type-theory"]
                .map(str::to_string)
                .to_vec()
        )
    );
    assert!(graph
        .definitions_for("links-theory")
        .iter()
        .any(|definition| definition.using == "links-theory"));
    assert_eq!(
        graph
            .definitions_for("set-theory")
            .iter()
            .filter(|definition| definition.using == "links-theory")
            .count(),
        2
    );
}

#[test]
fn maps_terms_from_every_theory_into_a_shared_concept_address() {
    let graph = bundled_graph();
    let address = "rml.concept.addressable-link";

    assert_eq!(graph.resolve_term("links-theory", "link"), Some(address));
    assert_eq!(
        graph.resolve_term("relative-meta-logic", "expression"),
        Some(address)
    );
    assert_eq!(graph.resolve_term("set-theory", "reference"), Some(address));
    assert_eq!(graph.resolve_term("type-theory", "term"), Some(address));
    assert_eq!(
        graph.terms_at(address),
        vec![
            ("links-theory", "link"),
            ("relative-meta-logic", "expression"),
            ("set-theory", "reference"),
            ("type-theory", "term"),
        ]
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
(definition user-by-rml
  (subject user-theory)
  (using relative-meta-logic)
  (witness user.definition.rml))
"#
    );
    let graph = TheoryGraph::from_rml(&source).expect("user theory must be valid");

    assert_eq!(
        graph.resolve_term("user-theory", "entity"),
        Some("rml.concept.addressable-link")
    );
    assert_eq!(
        graph.definition_path("user-theory", "type-theory"),
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
    let error = TheoryGraph::from_rml(
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
