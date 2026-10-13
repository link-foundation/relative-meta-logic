use rml::address_sequence::AddressSequence;
use serde_json::{Value, json};

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/address-sequences/cases.json"
    ))
    .unwrap()
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}
fn values(input: &[&str]) -> Vec<String> {
    input.iter().map(|s| s.to_string()).collect()
}
fn network() -> AddressSequence {
    let mut result = AddressSequence::default();
    for node in corpus()["links"].as_array().unwrap() {
        result
            .define_link(
                node["address"].as_str().unwrap(),
                node["source"].as_str().unwrap(),
                node["target"].as_str().unwrap(),
            )
            .unwrap();
    }
    result
}
fn decode(store: &AddressSequence, head: &str) -> Vec<String> {
    store.decode(head, 10000, 100000).unwrap()
}
fn modified(
    store: &AddressSequence,
    edit: impl FnOnce(&mut Value),
) -> Result<AddressSequence, String> {
    let mut snapshot = store.snapshot();
    edit(&mut snapshot);
    AddressSequence::from_snapshot(&snapshot)
}
fn link<'a>(snapshot: &'a mut Value, address: &str) -> &'a mut Value {
    snapshot["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|n| n["address"] == address)
        .unwrap()
}

#[test]
fn preserves_opaque_link_values_and_cycles_in_every_finite_sequence_layout() {
    let c = corpus();
    let expected = strings(&c["values"]);
    for layout in strings(&c["layouts"]) {
        let mut store = network();
        let head = store.encode(&expected, "example", &layout).unwrap();
        assert_eq!(decode(&store, &head), expected);
        assert_eq!(
            decode(
                &AddressSequence::from_snapshot(&store.snapshot()).unwrap(),
                &head
            ),
            expected
        );
        let empty = store.encode(&[], "empty", &layout).unwrap();
        assert_eq!(decode(&store, &empty), Vec::<String>::new());
        let singleton = store
            .encode(&values(&["opaque.link"]), "singleton", &layout)
            .unwrap();
        assert_eq!(decode(&store, &singleton), values(&["opaque.link"]));
    }
}

#[test]
fn distinguishes_nested_singleton_sets_and_preserves_duplicate_elimination_and_unicode_order() {
    let mut store = network();
    let inner = store
        .encode_set(&values(&["a", "a"]), "inner", "balanced")
        .unwrap();
    let outer = store
        .encode_set(&[inner.clone(), inner.clone()], "outer", "balanced")
        .unwrap();
    assert_ne!(inner, outer);
    assert_eq!(
        store.decode_set(&inner, 10000, 100000).unwrap(),
        values(&["a"])
    );
    assert_eq!(
        store.decode_set(&outer, 10000, 100000).unwrap(),
        vec![inner.clone()]
    );
    let c = corpus();
    let mut input = strings(&c["setInput"]);
    let first = store.encode_set(&input, "first", "balanced").unwrap();
    input.reverse();
    let second = store.encode_set(&input, "second", "right").unwrap();
    assert_eq!(
        store.decode_set(&first, 10000, 100000).unwrap(),
        strings(&c["setExpected"])
    );
    assert_eq!(
        store.decode_set(&second, 10000, 100000).unwrap(),
        strings(&c["setExpected"])
    );
    assert_eq!(
        AddressSequence::from_snapshot(&store.snapshot())
            .unwrap()
            .decode_set(&outer, 10000, 100000)
            .unwrap(),
        vec![inner]
    );
}

#[test]
fn constructor_boundaries_survive_reconstruction_and_later_element_definitions() {
    let mut store = AddressSequence::default();
    let head = store
        .encode(&values(&["late.link"]), "stable", "balanced")
        .unwrap();
    store
        .define_link("late.link", "nested.a", "nested.b")
        .unwrap();
    assert_eq!(decode(&store, &head), values(&["late.link"]));
    let snapshot = store.snapshot();
    assert_eq!(snapshot.as_object().unwrap().len(), 3);
    assert!(
        snapshot["links"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n.as_object().unwrap().len() == 3)
    );
    let restored = AddressSequence::from_snapshot(
        &serde_json::from_str::<Value>(&snapshot.to_string()).unwrap(),
    )
    .unwrap();
    assert_eq!(decode(&restored, &head), values(&["late.link"]));
    assert_eq!(restored.snapshot(), snapshot);
}

#[test]
fn rejects_missing_corrupt_unknown_or_dangling_constructors_and_duplicate_identities() {
    let mut store = network();
    let head = store
        .encode(&values(&["a", "b"]), "guard", "balanced")
        .unwrap();
    assert!(
        modified(&store, |s| s["links"]
            .as_array_mut()
            .unwrap()
            .retain(|n| n["address"] != "rml:address-sequence:1:element"))
        .unwrap_err()
        .contains("constructor")
    );
    assert!(
        modified(
            &store,
            |s| link(s, "rml:address-sequence:1:element")["target"] = json!("other")
        )
        .unwrap_err()
        .contains("constructor")
    );
    assert!(
        modified(&store, |s| {
            let n = s["links"][0].clone();
            s["links"].as_array_mut().unwrap().push(n);
        })
        .unwrap_err()
        .contains("duplicate")
    );
    let unknown = modified(&store, |s| link(s, &head)["source"] = json!("unknown-tag")).unwrap();
    assert!(
        unknown
            .decode(&head, 10000, 100000)
            .unwrap_err()
            .contains("unknown sequence constructor")
    );
    for (address, error) in [
        ("guard.pair.0", "missing branch payload"),
        ("guard.element.0", "missing sequence link"),
    ] {
        let changed = modified(&store, |s| {
            s["links"]
                .as_array_mut()
                .unwrap()
                .retain(|n| n["address"] != address)
        })
        .unwrap();
        assert!(
            changed
                .decode(&head, 10000, 100000)
                .unwrap_err()
                .contains(error)
        );
    }
}

#[test]
fn rejects_structural_cycles_and_bounds_shared_syntax_without_traversing_element_cycles() {
    let mut store = network();
    let head = store
        .encode(
            &values(&["cycle.direct", "cycle.first"]),
            "guard",
            "balanced",
        )
        .unwrap();
    assert_eq!(
        decode(&store, &head),
        values(&["cycle.direct", "cycle.first"])
    );
    let changed = modified(&store, |s| link(s, "guard.pair.0")["source"] = json!(head)).unwrap();
    assert!(
        changed
            .decode(&head, 10000, 100000)
            .unwrap_err()
            .contains("cyclic")
    );
    let mut shared = AddressSequence::default();
    let mut current = shared.encode(&values(&["a"]), "leaf", "balanced").unwrap();
    for i in 0..24 {
        let payload = format!("payload.{i}");
        shared.define_link(&payload, &current, &current).unwrap();
        current = shared
            .define_link(
                &format!("tree.{i}"),
                "rml:address-sequence:1:branch",
                &payload,
            )
            .unwrap();
    }
    assert!(
        shared
            .decode(&current, 10000, 100)
            .unwrap_err()
            .contains("node bound")
    );
    assert!(
        shared
            .decode(&current, 10, 100000)
            .unwrap_err()
            .contains("element bound")
    );
}

#[test]
fn rejects_colliding_generated_references_atomically_and_invalid_set_views() {
    let mut store = network();
    let before = store.snapshot();
    assert!(
        store
            .encode(&values(&["collision.element.0"]), "collision", "balanced")
            .unwrap_err()
            .contains("collision")
    );
    assert_eq!(store.snapshot(), before);
    let head = store
        .encode(&values(&["b", "a"]), "unordered", "balanced")
        .unwrap();
    assert!(
        store
            .decode_set(&head, 10000, 100000)
            .unwrap_err()
            .contains("strict address order")
    );
    let dup = store
        .encode(&values(&["a", "a"]), "duplicates", "balanced")
        .unwrap();
    assert!(store.decode_set(&dup, 10000, 100000).is_err());
    assert!(store.decode_ordered_set(&dup, 10000, 100000).is_err());
    assert!(
        store
            .encode_ordered_set(&values(&["a", "a"]), "ordered", "balanced")
            .is_err()
    );
    let valid = store
        .encode_ordered_set(&values(&["b", "a"]), "valid", "balanced")
        .unwrap();
    assert_eq!(
        store.decode_ordered_set(&valid, 10000, 100000).unwrap(),
        values(&["b", "a"])
    );
    assert!(store.decode(&head, 10000, 0).is_err());
    assert!(store.encode(&values(&["a"]), "invalid", "unknown").is_err());
}

#[test]
fn bounds_input_and_decodes_deep_finite_doublet_layouts_without_host_recursion() {
    let mut store = AddressSequence::default();
    assert!(
        store
            .encode(&vec!["a".into(); 10001], "too-many", "balanced")
            .is_err()
    );
    assert!(
        store
            .encode_set(&vec!["a".into(); 10001], "too-many", "balanced")
            .is_err()
    );
    let expected: Vec<_> = (0..2000).map(|i| format!("value.{i}")).collect();
    let head = store.encode(&expected, "deep", "left").unwrap();
    assert_eq!(decode(&store, &head), expected);
}

#[test]
fn matches_shared_cross_runtime_doublet_snapshot_for_nested_singleton_sets() {
    let expected: Value = serde_json::from_str(include_str!(
        "../../test-corpus/address-sequences/snapshot.json"
    ))
    .unwrap();
    let mut store = AddressSequence::default();
    let inner = store
        .encode_set(&values(&["a"]), "single", "balanced")
        .unwrap();
    let outer = store
        .encode_set(&[inner.clone()], "nested", "balanced")
        .unwrap();
    assert_eq!(store.snapshot(), expected);
    assert_eq!(
        AddressSequence::from_snapshot(&expected)
            .unwrap()
            .decode_set(&outer, 10000, 100000)
            .unwrap(),
        vec![inner]
    );
}
