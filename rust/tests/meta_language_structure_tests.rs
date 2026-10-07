use meta_language::{LinkMetadata, LinkNetwork, LinkType, SubstitutionRule};
use rml::lino_frontend::parse_lino_document;
use rml::meta_language_support::{
    attach_rml_structure, deserialize_rml_structure, emit_rml_from_structure,
    parse_rml_to_meta_language, reconstruct_rml_from_meta_language, rml_representation_stages,
    rml_structure_only, rml_structured_document, rml_structured_forms, serialize_rml_structure,
};
use serde_json::Value;

#[test]
fn shared_structure_corpus_discards_source_without_claiming_semantics() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../test-corpus/meta-language/rml-structure.json"
    ))
    .unwrap();
    for item in corpus["cases"].as_array().unwrap() {
        let source = item["source"].as_str().unwrap();
        let network = parse_rml_to_meta_language(source);
        assert_eq!(
            reconstruct_rml_from_meta_language(&network),
            source,
            "{}",
            item["name"]
        );
        let stages = rml_representation_stages(&network);
        for stage in [
            stages.resolution,
            stages.elaboration,
            stages.execution,
            stages.verification,
        ] {
            assert_eq!(stage, "not-run");
        }
        if let Some(error) = item["error"].as_str() {
            assert_eq!(stages.parsing, "rejected");
            assert_eq!(stages.diagnostic.as_deref(), Some(error));
            assert!(rml_structure_only(&network).is_err());
            continue;
        }
        assert_eq!(stages.parsing, "parsed");
        let categories: Vec<_> = network
            .links()
            .filter(|link| {
                link.metadata().link_type() == Some(LinkType::Syntax)
                    && link.metadata().definition() == Some("rml:structure:1:form")
            })
            .map(|link| link.metadata().term().unwrap())
            .collect();
        let expected: Vec<_> = item["categories"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(categories, expected);
        let stripped = rml_structure_only(&network).unwrap();
        assert!(stripped
            .links()
            .all(|link| link.metadata().link_type() != Some(LinkType::Token)));
        assert_eq!(stripped.reconstruct_text(), "");
        let restored =
            deserialize_rml_structure(&serialize_rml_structure(&stripped).unwrap()).unwrap();
        let actual: Vec<_> = rml_structured_document(&restored)
            .unwrap()
            .into_iter()
            .map(|(form, _)| form)
            .collect();
        assert_eq!(actual, parse_lino_document(source).unwrap());
        let canonical = emit_rml_from_structure(&restored).unwrap();
        assert_eq!(
            parse_lino_document(&canonical)
                .unwrap()
                .into_iter()
                .map(|form| form.text)
                .collect::<Vec<_>>(),
            rml_structured_forms(&restored).unwrap()
        );
    }
}

#[test]
fn consumes_the_javascript_snapshot_without_any_source_buffer() {
    let network = deserialize_rml_structure(include_str!(
        "../../test-corpus/meta-language/structured-snapshot.json"
    ))
    .unwrap();
    assert_eq!(network.reconstruct_text(), "");
    assert_eq!(
        emit_rml_from_structure(&network).unwrap(),
        "(namespace shared)\n(proof p (premise α) (conclusion α))\n"
    );
    let restored = deserialize_rml_structure(&serialize_rml_structure(&network).unwrap()).unwrap();
    assert_eq!(
        rml_structured_forms(&network).unwrap(),
        rml_structured_forms(&restored).unwrap()
    );
}

#[test]
fn structured_graph_edits_change_emission_without_inventing_a_proof() {
    let mut network = rml_structure_only(&parse_rml_to_meta_language(
        "(proof p (premise α) (conclusion α))\n",
    ))
    .unwrap();
    let old = network
        .links()
        .find(|link| {
            link.metadata().term() == Some("α")
                && link.metadata().definition() == Some("rml:structure:1:reference")
        })
        .unwrap()
        .id();
    let references = network
        .links()
        .find(|link| link.references().contains(&old))
        .unwrap()
        .references()
        .to_vec();
    let replacement = network.insert_link(
        [],
        LinkMetadata::new()
            .with_link_type(LinkType::Syntax)
            .with_language("RML")
            .with_definition("rml:structure:1:reference")
            .with_term("β"),
    );
    let replaced: Vec<_> = references
        .iter()
        .map(|id| if *id == old { replacement } else { *id })
        .collect();
    let rule = SubstitutionRule::new([references[0], references[1]], [replaced[0], replaced[1]]);
    let report = network.apply_substitution(&rule);
    assert!(!report.updated().is_empty());
    assert_eq!(
        emit_rml_from_structure(&network).unwrap(),
        "(proof p (premise β) (conclusion α))\n"
    );
    assert_eq!(rml_representation_stages(&network).verification, "not-run");
}

#[test]
fn rejects_cyclic_dangling_duplicate_and_unknown_snapshots() {
    let valid = serialize_rml_structure(&parse_rml_to_meta_language("(a (b c))")).unwrap();
    for (target, reference) in [("cycle", None), ("dangling", Some(999_999_u64))] {
        let mut value: Value = serde_json::from_str(&valid).unwrap();
        let record = value["links"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|record| {
                record["metadata"]["linkType"] == "Syntax"
                    && record["metadata"]["definition"] == "rml:structure:1:link"
            })
            .unwrap();
        let id = reference.unwrap_or_else(|| record["id"].as_u64().unwrap());
        record["references"] = serde_json::json!([id]);
        assert!(
            deserialize_rml_structure(&value.to_string()).is_err(),
            "{target}"
        );
    }
    let mut duplicate: Value = serde_json::from_str(&valid).unwrap();
    let record = duplicate["links"][0].clone();
    duplicate["links"].as_array_mut().unwrap().push(record);
    assert!(deserialize_rml_structure(&duplicate.to_string()).is_err());
    assert!(deserialize_rml_structure("{\"schema\":\"future\"}").is_err());
}

#[test]
fn shared_frontend_cases_use_the_same_structure_and_diagnostics() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../test-corpus/lino-frontend/cases.json")).unwrap();
    for item in corpus["cases"].as_array().unwrap() {
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
        let mut network = LinkNetwork::new();
        attach_rml_structure(&mut network, &source);
        match parse_lino_document(&source) {
            Ok(forms) => assert_eq!(
                rml_structured_document(&network)
                    .unwrap()
                    .into_iter()
                    .map(|(form, _)| form)
                    .collect::<Vec<_>>(),
                forms,
                "{}",
                item["name"]
            ),
            Err(error) => assert_eq!(
                rml_structured_document(&network).unwrap_err(),
                error,
                "{}",
                item["name"]
            ),
        }
    }
}

#[test]
fn all_twelve_unsupported_paths_retain_source_without_fabricating_target_code_or_proofs() {
    let languages = ["JavaScript", "Rust", "Rocq", "Lean"];
    let source = "original effects, axioms, proof obligations, and unknown constructs";
    let mut checked = 0;
    for from in languages {
        for to in languages {
            if from == to {
                continue;
            }
            let result =
                rml::meta_language_support::language_translation_obligation(source, from, to)
                    .unwrap();
            assert_eq!(result["status"], "unsupported");
            assert_eq!(result["preservedSource"], source);
            assert!(result["targetSource"].is_null());
            assert_eq!(
                result["obligations"][0]["code"],
                "RML_TRANSLATION_UNIMPLEMENTED"
            );
            checked += 1;
        }
    }
    assert_eq!(checked, 12);
}

#[test]
fn shared_dag_reconstruction_has_graph_proportional_node_and_text_budgets() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../test-corpus/meta-language/expansion-cases.json"
    ))
    .unwrap();
    for item in corpus["cases"].as_array().unwrap() {
        fn add(records: &mut Vec<Value>, kind: &str, refs: Vec<u64>, term: Option<&str>) -> u64 {
            let id = records.len() as u64 + 1;
            let mut record = serde_json::json!({ "id": id, "references": refs, "metadata": {
                "linkType": "Syntax", "language": "RML", "definition": format!("rml:structure:1:{kind}"),
            } });
            if let Some(term) = term {
                record["metadata"]["term"] = term.into();
            }
            records.push(record);
            id
        }
        let mut records = Vec::new();
        let text = item["text"]
            .as_str()
            .unwrap()
            .repeat(item["repeat"].as_u64().unwrap() as usize);
        let mut tree = add(&mut records, "reference", vec![], Some(&text));
        for _ in 0..item["depth"].as_u64().unwrap() {
            tree = add(
                &mut records,
                "link",
                vec![tree; item["fanout"].as_u64().unwrap() as usize],
                None,
            );
        }
        let location = add(&mut records, "location", vec![], Some("1:1:1"));
        let form = add(&mut records, "form", vec![tree, location], Some("form"));
        add(
            &mut records,
            "document",
            vec![form],
            Some("rml:structure:1"),
        );
        let snapshot =
            serde_json::json!({ "schema": "rml:structure:1", "language": "RML", "links": records })
                .to_string();
        let result = deserialize_rml_structure(&snapshot);
        if item["accepted"].as_bool().unwrap() {
            let network = result.unwrap();
            assert!(emit_rml_from_structure(&network)
                .unwrap()
                .contains(item["text"].as_str().unwrap()));
            let branch = network
                .links()
                .find(|link| link.metadata().definition() == Some("rml:structure:1:link"))
                .unwrap();
            assert_eq!(branch.references()[0], branch.references()[1]);
        } else {
            assert!(
                result
                    .unwrap_err()
                    .contains("RML syntax expansion limit exceeded"),
                "{}",
                item["name"]
            );
        }
    }
}
