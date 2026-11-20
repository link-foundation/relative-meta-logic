use rml::foundation_workspace::{FoundationBounds, FoundationChange, FoundationWorkspace};
use rml::linked_program::ExecutionBasis;
use rml::semantic_archive::{ArchiveLimits, TypedSemanticArchive};
use rml::theory_network::{TypedLinkNetwork, TypedLinkNetworkSnapshot};
use rml::{parse_one, tokenize_one, Node};

fn fixture() -> (TypedLinkNetworkSnapshot, Vec<String>) {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../test-corpus/semantic-archive/graph.json"
    ))
    .unwrap();
    let rows = |table: &str, left: &str, right: &str| {
        value["snapshot"][table]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                (
                    row["address"].as_str().unwrap().to_string(),
                    row[left].as_str().unwrap().to_string(),
                    row[right].as_str().unwrap().to_string(),
                )
            })
            .collect()
    };
    let snapshot = TypedLinkNetworkSnapshot {
        links: rows("links", "source", "target"),
        type_facts: rows("typeFacts", "subject", "type"),
    };
    let roots = value["roots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_string())
        .collect();
    (snapshot, roots)
}
fn archive() -> TypedSemanticArchive {
    let (snapshot, roots) = fixture();
    TypedSemanticArchive::from_snapshot(&snapshot, &roots).unwrap()
}
fn node(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}

#[test]
fn round_trips_linked_semantic_categories_sharing_identity_and_cycles_without_host_caches() {
    let before = archive();
    let bytes = before.serialize().unwrap();
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    assert_eq!(
        hex,
        include_str!("../../test-corpus/semantic-archive/expected.hex").trim()
    );
    let after = TypedSemanticArchive::deserialize(&bytes).unwrap();
    assert_eq!(after.snapshot(), before.snapshot());
    assert_eq!(after.roots(), before.roots());
    assert_eq!(after.serialize().unwrap(), bytes);
    assert_eq!(after.doublet("proof"), Some(("rule", "judgement")));
    assert_eq!(after.doublet("judgement"), Some(("term", "proof")));
    assert_eq!(after.doublet("类型\n:🌍"), Some(("类型\n:🌍", "类型\n:🌍")));
    for address in ["\u{feff}leading", "nul\0id"] {
        assert_eq!(after.doublet(address), Some((address, address)));
    }
    let mut restored = after.to_typed_network().unwrap();
    assert!(restored.validate_closure().closed);
    assert_eq!(restored.types_of("tf.rule"), vec!["type"]);
    assert_eq!(restored.type_of("missing"), None);
    restored.clear_type_index();
    assert_eq!(restored.types_of("proof"), vec!["type"]);
    restored.rebuild_type_index();
    assert_eq!(
        restored.snapshot(),
        before.to_typed_network().unwrap().snapshot()
    );
}

#[test]
fn rejects_duplicate_roles_and_dangling_metadata_instead_of_false_closure() {
    let mut duplicate = TypedLinkNetwork::with_default_ontology().snapshot();
    duplicate.links.push((
        "rml.type-fact.0".to_string(),
        "Value".to_string(),
        "Value".to_string(),
    ));
    assert!(TypedSemanticArchive::from_snapshot(&duplicate, &[])
        .unwrap_err()
        .contains("conflicting roles"));
    let (mut missing, roots) = fixture();
    missing.links.retain(|row| row.0 != "term");
    assert!(TypedSemanticArchive::from_snapshot(&missing, &roots)
        .unwrap_err()
        .contains("dangling references: term"));
    assert!(
        TypedSemanticArchive::from_snapshot(&fixture().0, &["missing".to_string()])
            .unwrap_err()
            .contains("root missing is undefined")
    );
    assert!(TypedSemanticArchive::from_snapshot(
        &fixture().0,
        &["proof".to_string(), "proof".to_string()]
    )
    .unwrap_err()
    .contains("repeats a root"));
}

#[test]
fn preserves_open_boundaries_without_inventing_textual_pair_type_definitions() {
    let mut open = TypedLinkNetwork::new();
    open.declare("left", "A").unwrap();
    open.declare("right", "B").unwrap();
    open.define("pair", "left", "right", "A", "B").unwrap();
    assert!(open
        .validate_closure()
        .missing_references
        .contains(&"(Pair A B)".to_string()));
    let restored = TypedLinkNetwork::from_snapshot(&open.snapshot(), false).unwrap();
    assert_eq!(restored.snapshot(), open.snapshot());
    assert!(TypedSemanticArchive::from_network(&open, &[])
        .unwrap_err()
        .contains("dangling references"));
    let blank = TypedSemanticArchive::from_network(&TypedLinkNetwork::new(), &[]).unwrap();
    assert_eq!(blank.doublet("Type"), None);
    assert_eq!(blank.to_typed_network().unwrap().type_of("Type"), None);
}

#[test]
fn reserves_generated_type_fact_identities_and_rejects_colliding_definitions_atomically() {
    let mut snapshot = TypedLinkNetwork::with_default_ontology().snapshot();
    snapshot.links.push((
        "rml.type-fact.3".to_string(),
        "Type".to_string(),
        "Type".to_string(),
    ));
    let mut graph = TypedLinkNetwork::from_snapshot(&snapshot, true).unwrap();
    graph.declare("Value", "Type").unwrap();
    assert_eq!(graph.type_facts().last().unwrap().0, "rml.type-fact.4");
    let before = graph.snapshot();
    assert!(graph
        .define("rml.type-fact.0", "Type", "Type", "Type", "Type")
        .unwrap_err()
        .contains("conflicting roles"));
    assert_eq!(graph.snapshot(), before);
    assert!(graph.identity_conflicts().is_empty());
}

#[test]
fn bounds_decoding_rejecting_truncation_malformed_lengths_utf8_and_trailing_content() {
    let bytes = archive().serialize().unwrap();
    for cut in [0, 1, 20, bytes.len() - 1] {
        assert!(TypedSemanticArchive::deserialize(&bytes[..cut]).is_err());
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(TypedSemanticArchive::deserialize(&trailing)
        .unwrap_err()
        .contains("trailing bytes"));
    for limits in [
        ArchiveLimits {
            max_bytes: 16,
            ..ArchiveLimits::default()
        },
        ArchiveLimits {
            max_links: 2,
            ..ArchiveLimits::default()
        },
        ArchiveLimits {
            max_field_bytes: 3,
            ..ArchiveLimits::default()
        },
    ] {
        assert!(TypedSemanticArchive::deserialize_with_limits(&bytes, limits).is_err());
    }
    assert!(
        TypedSemanticArchive::deserialize(b"RML-TYPED-LINKS/1\n01\n")
            .unwrap_err()
            .contains("non-canonical")
    );
    assert!(
        TypedSemanticArchive::deserialize(b"RML-TYPED-LINKS/1\n99999999999999999999\n")
            .unwrap_err()
            .contains("invalid archive length")
    );
    let mut invalid = b"RML-TYPED-LINKS/1\n1\n1:".to_vec();
    invalid.extend([255, 10]);
    assert!(TypedSemanticArchive::deserialize(&invalid)
        .unwrap_err()
        .contains("UTF-8"));
}

#[test]
fn selected_graph_ontology_does_not_impose_foundation_universe_or_soundness_rules() {
    let ontology = TypedSemanticArchive::from_network(
        &TypedLinkNetwork::with_default_ontology(),
        &["Type".to_string()],
    )
    .unwrap();
    assert_eq!(ontology.doublet("Type"), Some(("Type", "Type")));
    let source = include_str!("../../test-corpus/semantic-archive/universe-contracts.lino");
    for basis in [ExecutionBasis::DirectStructural, ExecutionBasis::ClosedSk] {
        let workspace = FoundationWorkspace::from_rml_with_basis(source, basis, &[]).unwrap();
        let ask = |instance: &str, query: &str| {
            workspace
                .ask(instance, &node(query), &[], FoundationBounds::default())
                .unwrap()
        };
        assert_eq!(
            ask("stratified-universes", "(has-type Type Type)").status,
            "unknown"
        );
        assert_eq!(
            ask("stratified-universes", "(has-type Type U1)").status,
            "proved"
        );
        assert_eq!(
            ask("recursive-universes", "(has-type Type Type)").status,
            "proved"
        );
        assert_eq!(
            ask(
                "recursive-universes",
                "(soundness-obligation consistency-unestablished)"
            )
            .status,
            "proved"
        );
        for instance in ["stratified-universes", "recursive-universes"] {
            assert_eq!(ask(instance, "(soundness certified)").status, "unknown");
        }
        let recursive = ask("recursive-universes", "(has-type Type Type)");
        let changed = workspace
            .revise(
                &[recursive],
                &FoundationChange::RemoveRule {
                    program: "recursive-contract".to_string(),
                    rule: "explicit-self-universe".to_string(),
                },
            )
            .unwrap();
        assert_eq!(changed.revisions[0].after.status, "unknown");
        assert_eq!(ontology.doublet("Type"), Some(("Type", "Type")));
    }
}
