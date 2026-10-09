use meta_language::{LinkMetadata, LinkType, SubstitutionRule};
use rml::meta_language_support::{
    deserialize_rml_structure, emit_rml_from_structure, serialize_rml_structure,
};
use rml::portable_natural::{
    emit_portable_natural, evaluate_portable_natural, parse_portable_natural,
    translate_portable_natural, PORTABLE_NATURAL_MAX,
};
use serde_json::Value;
fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/portable-natural/cases.json"
    ))
    .unwrap()
}

#[test]
fn all_twelve_paths_preserve_structured_programs_and_observations() {
    let corpus = corpus();
    let sources = corpus["sources"].as_object().unwrap();
    let mut count = 0;
    for (from, source) in sources {
        for to in sources.keys() {
            if from == to {
                continue;
            }
            let result = translate_portable_natural(source.as_str().unwrap(), from, to);
            assert_eq!(
                result.status, "translated-fragment",
                "{from} to {to}: {:?}",
                result.obligations
            );
            assert_eq!(result.preserved_source, source.as_str().unwrap());
            assert_eq!(result.contract, corpus["contract"]);
            assert_eq!(result.stages["verification"], "not-proved");
            assert_eq!(
                result.target_source.as_deref(),
                corpus["targets"][to].as_str(),
                "{from} to {to}: JS/Rust generated-source parity"
            );
            assert_eq!(result.obligations[0]["code"], "RML_PORTABLE_NUMERIC_DOMAIN");
            let network = result.network.as_ref().unwrap();
            let source_free =
                deserialize_rml_structure(&serialize_rml_structure(network).unwrap()).unwrap();
            assert_eq!(source_free.reconstruct_text(), "");
            assert_eq!(
                emit_portable_natural(&source_free, to).unwrap(),
                result.target_source.as_ref().unwrap().as_str()
            );
            let reimported =
                parse_portable_natural(result.target_source.as_ref().unwrap(), to).unwrap();
            assert_eq!(
                emit_rml_from_structure(&source_free).unwrap(),
                emit_rml_from_structure(&reimported).unwrap()
            );
            for vector in corpus["vectors"].as_array().unwrap() {
                let args: Vec<_> = vector["arguments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| value.as_u64().unwrap())
                    .collect();
                let result = evaluate_portable_natural(
                    &reimported,
                    vector["function"].as_str().unwrap(),
                    &args,
                )
                .unwrap();
                assert_eq!(
                    result.to_string(),
                    vector["expected"].as_str().unwrap(),
                    "{from} to {to}"
                );
            }
            count += 1;
        }
    }
    assert_eq!(count, 12);
}

#[test]
fn unsupported_effects_proofs_recursion_and_invalid_programs_retain_complete_source() {
    let corpus = corpus();
    for item in corpus["negatives"].as_array().unwrap() {
        for target in corpus["sources"].as_object().unwrap().keys() {
            let source = item["source"].as_str().unwrap();
            let from = item["language"].as_str().unwrap();
            if from == target {
                continue;
            }
            let report = translate_portable_natural(source, from, target);
            assert_eq!(report.status, "unsupported", "{} to {target}", item["name"]);
            assert_eq!(report.preserved_source, source);
            assert!(report.target_source.is_none());
            assert!(report.network.is_none());
            assert!(report.obligations[0]["code"]
                .as_str()
                .unwrap()
                .starts_with("RML_PORTABLE_"));
        }
    }
}

#[test]
fn domain_checks_and_lazy_conditionals_are_explicit() {
    let network = parse_portable_natural(
        "function bound(x) { return x === 0 ? 7 : 9007199254740991 + x; }",
        "JavaScript",
    )
    .unwrap();
    assert_eq!(
        evaluate_portable_natural(&network, "bound", &[0]).unwrap(),
        7
    );
    assert_eq!(
        evaluate_portable_natural(&network, "bound", &[1])
            .unwrap_err()
            .code,
        "RML_PORTABLE_DOMAIN"
    );
    assert_eq!(
        evaluate_portable_natural(&network, "bound", &[PORTABLE_NATURAL_MAX + 1])
            .unwrap_err()
            .code,
        "RML_PORTABLE_DOMAIN"
    );
}

#[test]
fn changing_the_graph_changes_target_source_and_execution_without_source_tokens() {
    let mut network =
        parse_portable_natural("function offset(x) { return x + 1; }", "JavaScript").unwrap();
    let old = network
        .links()
        .find(|link| {
            link.metadata().link_type() == Some(LinkType::Syntax)
                && link.metadata().definition() == Some("rml:structure:1:reference")
                && link.metadata().term() == Some("1")
        })
        .unwrap()
        .id();
    let parent = network
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
            .with_term("2"),
    );
    let updated: Vec<_> = parent
        .iter()
        .map(|id| if *id == old { replacement } else { *id })
        .collect();
    network.apply_substitution(&SubstitutionRule::new(
        [parent[0], parent[1]],
        [updated[0], updated[1]],
    ));
    assert_eq!(
        evaluate_portable_natural(&network, "offset", &[3]).unwrap(),
        5
    );
    assert!(emit_portable_natural(&network, "Rust")
        .unwrap()
        .contains("x + 2"));
}
