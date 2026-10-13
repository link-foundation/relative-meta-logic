use meta_language::LinkType;
use rml::lino_frontend::parse_lino_document;
use rml::meta_language_support::{
    check_rml_planes, compute_rml_semantics, deserialize_rml_structure, emit_rml_exact_source,
    emit_rml_from_structure, parse_rml_to_meta_language, rename_rml_binding, rml_provenance,
    rml_representation_stages, rml_semantic_identities, rml_stage_report, rml_structure_only,
    rml_structured_forms, serialize_rml_structure, RmlPlaneCheck,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn corpus(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

#[test]
fn shared_semantic_corpus_carries_checked_identities_and_exact_source_without_a_buffer() {
    let corpus = corpus(include_str!("../../test-corpus/meta-language/rml-semantics.json"));
    for item in corpus["cases"].as_array().unwrap() {
        let name = item["name"].as_str().unwrap();
        let source = item["source"].as_str().unwrap();
        let network = parse_rml_to_meta_language(source);
        let stages = rml_representation_stages(&network);
        assert_eq!(stages.resolution, item["resolution"], "{name}");
        assert_eq!(stages.exact_source, item["exactSource"], "{name}");
        for stage in [stages.elaboration, stages.execution, stages.verification] {
            assert_eq!(stage, "not-run", "{name}");
        }
        if let Some(error) = item["error"].as_str() {
            assert_eq!(stages.parsing, "rejected", "{name}");
            assert_eq!(stages.diagnostic.as_deref(), Some(error), "{name}");
            assert_eq!(rml_semantic_identities(&network).unwrap(), None, "{name}");
            continue;
        }
        let semantics = rml_semantic_identities(&network).unwrap().unwrap();
        assert_eq!(semantics.to_json(), item["semantics"], "{name}");
        let stripped = rml_structure_only(&network).unwrap();
        let restored =
            deserialize_rml_structure(&serialize_rml_structure(&stripped).unwrap()).unwrap();
        assert!(restored
            .links()
            .all(|link| link.metadata().link_type() != Some(LinkType::Token)));
        assert_eq!(restored.reconstruct_text(), "", "{name}");
        assert_eq!(emit_rml_exact_source(&restored).unwrap(), source, "{name}");
        assert_eq!(
            rml_semantic_identities(&restored).unwrap().unwrap().to_json(),
            item["semantics"],
            "{name}"
        );
        let restored_stages = rml_representation_stages(&restored);
        assert_eq!(restored_stages.preservation, "exact-source-structure", "{name}");
        assert_eq!(restored_stages.exact_source, "verified", "{name}");
        assert_eq!(restored_stages.resolution, item["resolution"], "{name}");
        assert_eq!(
            rml_provenance(&restored).unwrap().unwrap().utf8_bytes,
            source.len(),
            "{name}"
        );
        assert_eq!(
            rml_structured_forms(&restored).unwrap(),
            parse_lino_document(source)
                .unwrap()
                .into_iter()
                .map(|form| form.text)
                .collect::<Vec<_>>(),
            "{name}"
        );
    }
}

#[test]
fn whole_shared_frontend_corpus_round_trips_byte_exactly_from_layout_links() {
    let corpus = corpus(include_str!("../../test-corpus/lino-frontend/cases.json"));
    let mut exact = 0;
    for item in corpus["cases"].as_array().unwrap() {
        if item.get("error").is_some() {
            continue;
        }
        let source = if let Some(text) = item["source"].as_str() {
            text.to_string()
        } else {
            item["source"]
                .as_array()
                .unwrap()
                .iter()
                .map(|part| {
                    part.as_str().map(str::to_string).unwrap_or_else(|| {
                        part["repeat"]
                            .as_str()
                            .unwrap()
                            .repeat(part["times"].as_u64().unwrap() as usize)
                    })
                })
                .collect::<String>()
        };
        if source.encode_utf16().count() > 100_000 {
            continue;
        }
        let restored = deserialize_rml_structure(
            &serialize_rml_structure(&parse_rml_to_meta_language(&source)).unwrap(),
        )
        .unwrap();
        assert_eq!(emit_rml_exact_source(&restored).unwrap(), source, "{}", item["name"]);
        assert_eq!(
            rml_representation_stages(&restored).exact_source,
            "verified",
            "{}",
            item["name"]
        );
        exact += 1;
    }
    assert!(exact > 60);
}

#[test]
fn parsing_resolution_elaboration_execution_and_verification_stay_separate() {
    let network =
        parse_rml_to_meta_language("(a: a is a)\n(? (a = a))\n(lambda (Natural x) (+ x y))\n");
    let parsed = rml_stage_report(&network, false);
    assert_eq!(parsed.stages.parsing, "parsed");
    assert_eq!(parsed.stages.resolution, "resolved-with-open-references");
    assert_eq!(parsed.execution, "not-run");
    let executed = rml_stage_report(&network, true);
    assert_eq!(executed.execution, "executed");
    assert_eq!(executed.execution_input, Some("exact-source"));
    assert_eq!(executed.execution_results, 1);
    assert_eq!(executed.stages.elaboration, "not-run");
    assert_eq!(executed.stages.verification, "not-run");
    let rejected = rml_stage_report(&parse_rml_to_meta_language("(a"), true);
    assert_eq!(rejected.stages.parsing, "rejected");
    assert_eq!(rejected.stages.resolution, "not-run");
    assert_eq!(rejected.execution, "not-run");
}

#[test]
fn identities_are_computed_from_syntax_alone_without_writing_links() {
    let network = rml_structure_only(&parse_rml_to_meta_language("(lambda (Natural x) x)\n")).unwrap();
    let before = network.len();
    assert_eq!(
        compute_rml_semantics(&network).unwrap().to_json()["references"],
        json!([
            { "address": "0.1.0", "name": "Natural", "status": "free", "targets": [] },
            { "address": "0.2", "name": "x", "status": "bound", "targets": ["0.1.1"] },
        ])
    );
    assert_eq!(network.len(), before);
    assert_eq!(
        check_rml_planes(&network).unwrap(),
        RmlPlaneCheck {
            occurrences: Some(6),
            layout: Some("exact")
        }
    );
}

fn addresses(snapshot: &Value) -> (BTreeMap<String, u64>, u64) {
    let links = snapshot["links"].as_array().unwrap();
    let by_id: BTreeMap<u64, &Value> = links
        .iter()
        .map(|record| (record["id"].as_u64().unwrap(), record))
        .collect();
    let document = links
        .iter()
        .find(|record| {
            record["metadata"]["linkType"] == "Syntax"
                && record["metadata"]["definition"] == "rml:structure:1:document"
        })
        .unwrap();
    fn walk(id: u64, address: String, by_id: &BTreeMap<u64, &Value>, out: &mut BTreeMap<String, u64>) {
        out.insert(address.clone(), id);
        for (index, child) in by_id[&id]["references"].as_array().unwrap().iter().enumerate() {
            walk(child.as_u64().unwrap(), format!("{address}.{index}"), by_id, out);
        }
    }
    let mut out = BTreeMap::new();
    for (index, form) in document["references"].as_array().unwrap().iter().enumerate() {
        let root = by_id[&form.as_u64().unwrap()]["references"][0].as_u64().unwrap();
        walk(root, index.to_string(), &by_id, &mut out);
    }
    (out, document["id"].as_u64().unwrap())
}

fn record_ids(snapshot: &Value, kind: &str) -> Vec<usize> {
    let definition = format!("rml:structure:1:{kind}");
    snapshot["links"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .filter(|(_, record)| {
            record["metadata"]["definition"] == definition.as_str()
                && !record["metadata"]["term"]
                    .as_str()
                    .unwrap_or_default()
                    .starts_with("language-profile")
        })
        .map(|(index, _)| index)
        .collect()
}

fn mutate_snapshot(snapshot: &mut Value, mutation: &Value) {
    let (at, document) = addresses(snapshot);
    let address = |key: &str| at[mutation[key].as_str().unwrap()];
    let links_id = |snapshot: &Value, index: usize| snapshot["links"][index]["id"].clone();
    let resolution = record_ids(snapshot, "resolution")
        .into_iter()
        .find(|index| {
            mutation.get("address").is_some()
                && snapshot["links"][*index]["references"][0] == address("address")
        });
    let next_id = snapshot["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| record["id"].as_u64().unwrap())
        .max()
        .unwrap()
        + 1;
    match mutation["kind"].as_str().unwrap() {
        "retarget" => {
            let binder = record_ids(snapshot, "binder")
                .into_iter()
                .find(|index| snapshot["links"][*index]["references"][0] == address("site"))
                .unwrap();
            let id = links_id(snapshot, binder);
            snapshot["links"][resolution.unwrap()]["references"][1] = id;
        }
        "retarget-record" => {
            let other = record_ids(snapshot, "resolution")
                .into_iter()
                .find(|index| Some(*index) != resolution)
                .unwrap();
            let id = links_id(snapshot, other);
            snapshot["links"][resolution.unwrap()]["references"][1] = id;
        }
        "forge-occurrence" => {
            let layout = record_ids(snapshot, "layout")[0];
            let id = links_id(snapshot, layout);
            snapshot["links"][resolution.unwrap()]["references"][0] = id;
        }
        "dangling" => {
            snapshot["links"][resolution.unwrap()]["references"][1] = json!(999_999);
        }
        "status" => {
            snapshot["links"][resolution.unwrap()]["metadata"]["term"] = mutation["status"].clone();
        }
        "unaccounted" => {
            let root = at["0"];
            snapshot["links"].as_array_mut().unwrap().push(json!({ "id": next_id, "references": [root],
                "metadata": { "linkType": "Semantic", "language": "RML", "definition": "rml:structure:1:resolution", "term": "free" } }));
        }
        "layout-swap" => {
            let bound: Vec<usize> = record_ids(snapshot, "token")
                .into_iter()
                .filter(|index| snapshot["links"][*index]["references"].as_array().unwrap().len() == 2)
                .collect();
            let first = snapshot["links"][bound[0]]["references"][1].clone();
            let second = snapshot["links"][bound[1]]["references"][1].clone();
            snapshot["links"][bound[0]]["references"][1] = second;
            snapshot["links"][bound[1]]["references"][1] = first;
        }
        "refusal" => {
            let links = snapshot["links"].as_array_mut().unwrap();
            links.retain(|record| {
                !(record["metadata"]["linkType"] == "Trivia"
                    && ["layout", "trivia", "token", "token-value"].iter().any(|kind| {
                        record["metadata"]["definition"] == format!("rml:structure:1:{kind}").as_str()
                    }))
            });
            links.push(json!({ "id": next_id, "references": [document],
                "metadata": { "linkType": "Semantic", "language": "RML", "definition": "rml:structure:1:layout-refusal", "term": mutation["reason"] } }));
        }
        "provenance" => {
            let record = record_ids(snapshot, "provenance")[0];
            let term = snapshot["links"][record]["metadata"]["term"].as_str().unwrap().to_string();
            let digit = &term["source-sha256:".len().."source-sha256:".len() + 1];
            let replaced = format!(
                "source-sha256:{}{}",
                if digit == "0" { "1" } else { "0" },
                &term["source-sha256:".len() + 1..]
            );
            snapshot["links"][record]["metadata"]["term"] = json!(replaced);
        }
        other => panic!("unknown mutation {other}"),
    }
}

#[test]
fn forged_dangling_and_wrong_binder_identities_are_rejected_never_trusted() {
    let corpus = corpus(include_str!("../../test-corpus/meta-language/rml-semantics.json"));
    for mutation in corpus["mutations"].as_array().unwrap() {
        let name = mutation["name"].as_str().unwrap();
        let source = mutation["source"].as_str().unwrap();
        let mut snapshot: Value =
            serde_json::from_str(&serialize_rml_structure(&parse_rml_to_meta_language(source)).unwrap())
                .unwrap();
        mutate_snapshot(&mut snapshot, mutation);
        let mutated = snapshot.to_string();
        if let Some(state) = mutation["exactSource"].as_str() {
            let network = deserialize_rml_structure(&mutated).unwrap();
            assert_eq!(rml_representation_stages(&network).exact_source, state, "{name}");
            assert_eq!(
                emit_rml_from_structure(&network).unwrap(),
                emit_rml_from_structure(&parse_rml_to_meta_language(source)).unwrap(),
                "{name}"
            );
            if let Some(error) = mutation["error"].as_str() {
                assert_eq!(emit_rml_exact_source(&network).unwrap_err(), error, "{name}");
            }
            continue;
        }
        let error = deserialize_rml_structure(&mutated).unwrap_err();
        assert!(
            error.contains(mutation["error"].as_str().unwrap()),
            "{name}: {error}"
        );
    }
}

#[test]
fn capture_checked_rml_binding_rewrites_share_the_javascript_corpus() {
    let corpus = corpus(include_str!(
        "../../test-corpus/meta-language/rml-binding-rewrites.json"
    ));
    for item in corpus["cases"].as_array().unwrap() {
        let name = item["name"].as_str().unwrap();
        let network = parse_rml_to_meta_language(item["source"].as_str().unwrap());
        let site = item["site"].as_str().unwrap();
        let to = item["to"].as_str().unwrap();
        if let Some(code) = item["error"].as_str() {
            assert_eq!(rename_rml_binding(&network, site, to).unwrap_err().code, code, "{name}");
            continue;
        }
        let result = rename_rml_binding(&network, site, to).unwrap();
        let expected = item["expected"].as_str().unwrap();
        assert_eq!(result.source.as_deref(), Some(expected), "{name}");
        assert_eq!(result.canonical, item["canonical"].as_str().unwrap(), "{name}");
        let edits: Vec<Value> = result
            .edits
            .iter()
            .map(|edit| {
                json!({ "address": edit.address, "from": edit.from, "to": edit.to,
                    "line": edit.line, "col": edit.col })
            })
            .collect();
        assert_eq!(Value::Array(edits), item["edits"], "{name}");
        let restored =
            deserialize_rml_structure(&serialize_rml_structure(&result.network).unwrap()).unwrap();
        assert_eq!(emit_rml_exact_source(&restored).unwrap(), expected, "{name}");
        assert_eq!(rml_representation_stages(&restored).exact_source, "verified", "{name}");
        assert_eq!(
            rml_provenance(&restored).unwrap().unwrap().derived_from,
            Some(rml_provenance(&network).unwrap().unwrap().source_sha256),
            "{name}"
        );
        assert_eq!(rml_semantic_identities(&restored).unwrap(), Some(result.semantics.clone()), "{name}");
        assert_eq!(
            rml_semantic_identities(&parse_rml_to_meta_language(expected)).unwrap(),
            Some(result.semantics),
            "{name}"
        );
    }
}
