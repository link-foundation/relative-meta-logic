use rml::upstream_language::{
    analyze_program, construct_program, decode_program_translation, language_support,
    translate_program, ProgramConstructStatus, ProgramProjectContext, ProgramRange,
    ProgramRepresentation, RepresentationLevel, TranslationSupport, META_LANGUAGE_SOURCE_REVISION,
};
use serde_json::Value;

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/upstream-meta-language/four-language-conformance.json"
    ))
    .unwrap()
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap()
}
fn array<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value[key].as_array().unwrap()
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_str().unwrap().to_string())
        .collect()
}
fn project(fixture: &Value) -> ProgramProjectContext {
    ProgramProjectContext::new(
        text(fixture, "root"),
        strings(&fixture["files"]),
        strings(&fixture["dependencies"]),
    )
}

#[test]
fn upstream_source_revision_matches_the_dependency_pin() {
    assert!(include_str!("../Cargo.toml").contains(META_LANGUAGE_SOURCE_REVISION));
    assert!(include_str!("../Cargo.lock").contains(META_LANGUAGE_SOURCE_REVISION));
}

#[test]
fn upstream_four_language_grammars_aliases_bindings_and_snapshots_are_available() {
    for fixture in array(&corpus(), "languages") {
        for language in std::iter::once(text(fixture, "name")).chain(
            array(fixture, "aliases")
                .iter()
                .map(|alias| alias.as_str().unwrap()),
        ) {
            let source = text(fixture, "source");
            let program =
                analyze_program(source, language, ProgramProjectContext::default()).unwrap();
            assert!(
                program.network().verify_full_match(None).is_clean(),
                "{language}"
            );
            assert_eq!(program.emit(), source);
            assert!(program
                .source_mappings()
                .iter()
                .any(|mapping| mapping.term() == text(fixture, "root")));
            assert!(program.source_mappings().len() > 3);
            assert!(!program.bindings().is_empty());
            let snapshot = program.serialize_snapshot();
            let value: Value = serde_json::from_str(&snapshot).unwrap();
            assert!(value.get("source").is_none());
            assert_eq!(
                ProgramRepresentation::from_snapshot(&snapshot)
                    .unwrap()
                    .emit(),
                source
            );
            assert_eq!(
                language_support(language).unwrap().type_elaboration,
                RepresentationLevel::Unavailable
            );
        }
    }
}

#[test]
fn upstream_invalid_programs_retain_source_and_report_diagnostics() {
    for fixture in array(&corpus(), "negativeCases") {
        let source = text(fixture, "source");
        let language = text(fixture, "language");
        let program = analyze_program(source, language, ProgramProjectContext::default()).unwrap();
        assert_eq!(program.emit(), source);
        assert!(!program.network().verify_full_match(None).is_clean());
        assert!(!program.diagnostics().is_empty());
        assert!(construct_program(source, language, ProgramProjectContext::default()).is_err());
    }
}

#[test]
fn upstream_project_construct_facts_do_not_claim_unavailable_elaboration() {
    for fixture in array(&corpus(), "semanticPrograms") {
        let program = analyze_program(
            text(fixture, "source"),
            text(fixture, "language"),
            project(&fixture["project"]),
        )
        .unwrap();
        assert_eq!(program.emit(), text(fixture, "source"));
        assert!(program.diagnostics().is_empty());
        for kind in array(fixture, "represented") {
            let fact = program
                .constructs()
                .iter()
                .find(|fact| fact.kind() == kind.as_str().unwrap())
                .unwrap();
            assert_eq!(fact.status(), ProgramConstructStatus::Represented);
            assert!(!fact.evidence().is_empty());
        }
        for kind in array(fixture, "unavailable") {
            let fact = program
                .constructs()
                .iter()
                .find(|fact| fact.kind() == kind.as_str().unwrap())
                .unwrap();
            assert_eq!(fact.status(), ProgramConstructStatus::Unavailable);
        }
    }
}

#[test]
fn upstream_binding_edits_preserve_shadowing_literals_and_reject_capture() {
    let corpus = corpus();
    for fixture in array(&corpus, "renameCases")
        .iter()
        .chain(array(&corpus, "bindingRenameCorpus"))
    {
        let program = analyze_program(
            text(fixture, "source"),
            text(fixture, "language"),
            ProgramProjectContext::default(),
        )
        .unwrap();
        let binding = program
            .bindings()
            .iter()
            .filter(|binding| binding.name() == text(fixture, "binding"))
            .nth(fixture["declarationOccurrence"].as_u64().unwrap() as usize)
            .unwrap();
        let renamed = program.rename_binding(binding.id(), text(fixture, "replacement"));
        if fixture["allowed"].as_bool() == Some(false) {
            assert!(renamed.is_err());
            continue;
        }
        assert_eq!(renamed.unwrap().emit(), text(fixture, "expected"));
        if let Some(capture) = fixture["capture"].as_str() {
            assert!(program.rename_binding(binding.id(), capture).is_err());
        }
    }
}

#[test]
fn upstream_structured_construction_and_edits_cover_all_four_languages() {
    for fixture in array(&corpus(), "transformationPrograms") {
        let source = text(fixture, "source");
        let program = construct_program(
            source,
            text(fixture, "language"),
            ProgramProjectContext::default(),
        )
        .unwrap();
        let first = ProgramRange::new(0, text(fixture, "first").len());
        let second = ProgramRange::new(first.end(), source.len());
        assert!(program.query_syntax("identifier").len() >= 2);
        assert_eq!(
            program
                .replace(first, text(fixture, "inserted"))
                .unwrap()
                .emit(),
            format!("{}{}", text(fixture, "inserted"), text(fixture, "second"))
        );
        assert_eq!(
            program
                .insert(second.end(), text(fixture, "inserted"))
                .unwrap()
                .emit(),
            format!("{source}{}", text(fixture, "inserted"))
        );
        assert_eq!(
            program.delete(second).unwrap().emit(),
            text(fixture, "first")
        );
        assert_eq!(
            program.clone_range(first, second.end()).unwrap().emit(),
            format!("{source}{}", text(fixture, "first"))
        );
        assert_eq!(
            program.move_range(second, 0).unwrap().emit(),
            format!("{}{}", text(fixture, "second"), text(fixture, "first"))
        );
        assert!(program.move_range(first, 1).is_err());
    }
}

#[test]
fn upstream_twelve_directed_translations_retain_their_semantic_contracts() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../test-corpus/upstream-meta-language/translation-programs.json"
    ))
    .unwrap();
    let sources = fixture["sources"].as_object().unwrap();
    let mut paths = 0;
    for (language, source) in sources {
        for target in sources.keys().filter(|target| *target != language) {
            let result = translate_program(source.as_str().unwrap(), language, target).unwrap();
            assert_eq!(
                result.contract().support,
                TranslationSupport::SemanticTranslation,
                "{language} to {target}"
            );
            assert!(result.semantics().is_some());
            assert!(result.diagnostic().is_none());
            assert!(!result.code().is_empty());
            paths += 1;
        }
    }
    assert_eq!(paths, 12);
}

#[test]
fn upstream_unsupported_translation_is_not_a_semantic_translation() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../test-corpus/upstream-meta-language/translation-programs.json"
    ))
    .unwrap();
    let source = text(&fixture, "unsupported");
    for target in ["Rust", "Lean", "Rocq"] {
        let result = translate_program(source, "JavaScript", target).unwrap();
        assert!(result.semantics().is_none());
        assert!(result.diagnostic().is_some());
        assert_eq!(
            result.contract().support,
            TranslationSupport::PortableEncoding
        );
        assert_eq!(
            decode_program_translation(result.code(), target)
                .unwrap()
                .source(),
            source
        );
    }
}

#[test]
fn upstream_multifile_projects_resolve_symbols_and_reject_missing_context() {
    use rml::upstream_language::ProgramProjectSource;
    for fixture in array(&corpus(), "projectPrograms") {
        let sources = array(fixture, "sources");
        let entry = text(fixture, "entry");
        let source = text(
            sources
                .iter()
                .find(|file| text(file, "path") == entry)
                .unwrap(),
            "source",
        );
        let project = ProgramProjectContext::new(
            text(fixture, "root"),
            sources
                .iter()
                .map(|file| text(file, "path").to_string())
                .collect(),
            strings(&fixture["dependencies"]),
        )
        .with_entry(
            entry,
            sources
                .iter()
                .map(|file| ProgramProjectSource::new(text(file, "path"), text(file, "source")))
                .collect(),
        );
        let program = analyze_program(source, text(fixture, "language"), project).unwrap();
        assert!(program.diagnostics().is_empty());
        let modules: Vec<Value> = program.project_modules().iter().map(|module| serde_json::json!({ "request": module.request(), "module": module.module(), "text": &source[module.range().start()..module.range().end()] })).collect();
        assert_eq!(modules, *array(fixture, "modules"));
        assert!(!program.project_references().is_empty());
        for (kind, expected) in fixture["constructs"].as_object().unwrap() {
            let construct = program
                .constructs()
                .iter()
                .find(|item| item.kind() == kind)
                .unwrap();
            assert_eq!(construct.status(), ProgramConstructStatus::Represented);
            let observed: Vec<Value> = construct.evidence().iter().filter_map(|item| item.file().map(|file| {
                let source = text(sources.iter().find(|item| text(item, "path") == file).unwrap(), "source");
                serde_json::json!({ "kind": item.kind(), "name": item.name(), "file": file, "text": &source[item.range().start()..item.range().end()] })
            })).collect();
            assert_eq!(observed, *expected.as_array().unwrap(), "{kind}");
        }
        let missing = analyze_program(
            source,
            text(fixture, "language"),
            ProgramProjectContext::new(
                text(fixture, "root"),
                vec![],
                strings(&fixture["dependencies"]),
            )
            .with_entry(entry, vec![]),
        )
        .unwrap();
        assert!(!missing.diagnostics().is_empty());
        assert!(missing.project_modules().is_empty());
        assert!(missing.project_references().is_empty());
        assert!(missing.expansions().is_empty());
    }
}
