//! Rust mirror of js/tests/four-language-binding-rewrites.test.mjs. Upstream ranges are UTF-8
//! byte offsets here and UTF-16 offsets in JavaScript; the shared corpus stores one-based line,
//! Unicode code-point column and code-point length, with CRLF counted once.
use rml::upstream_language::{
    analyze_program, ProgramBinding, ProgramProjectContext, ProgramRange, ProgramRepresentation,
    ProgramRepresentationError,
};
use serde_json::Value;
use std::collections::BTreeSet;

fn corpus() -> Value {
    serde_json::from_str(include_str!(
        "../../test-corpus/meta-language/four-language-binding-rewrites.json"
    ))
    .unwrap()
}

fn text<'a>(item: &'a Value, key: &str) -> &'a str {
    item[key]
        .as_str()
        .unwrap_or_else(|| panic!("missing {key}"))
}

fn location(source: &str, range: ProgramRange) -> Vec<u64> {
    let before = &source[..range.start()];
    let line_start = before.rfind(['\n', '\r']).map_or(0, |index| index + 1);
    // `\r\n`, `\r` and `\n` each end one line.
    let mut lines = 1;
    let mut characters = before.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\r' {
            if characters.peek() == Some(&'\n') {
                characters.next();
            }
            lines += 1;
        } else if character == '\n' {
            lines += 1;
        }
    }
    vec![
        lines,
        before[line_start..].chars().count() as u64 + 1,
        source[range.start()..range.end()].chars().count() as u64,
    ]
}

fn expected(value: &Value) -> Vec<u64> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item.as_u64().unwrap())
        .collect()
}

fn analyze(source: &str, language: &str) -> ProgramRepresentation {
    analyze_program(source, language, ProgramProjectContext::default()).unwrap()
}

fn binding<'a>(program: &'a ProgramRepresentation, item: &Value) -> &'a ProgramBinding {
    program
        .bindings()
        .iter()
        .filter(|binding| binding.name() == text(item, "binding"))
        .nth(item["declarationOccurrence"].as_u64().unwrap() as usize)
        .unwrap_or_else(|| panic!("{}: binding not found", text(item, "name")))
}

#[test]
fn shared_four_language_binding_rewrites_agree_on_locations_edits_and_capture_refusals() {
    let corpus = corpus();
    let cases = corpus["cases"].as_array().unwrap();
    let languages: BTreeSet<&str> = cases.iter().map(|item| text(item, "language")).collect();
    assert_eq!(
        languages.into_iter().collect::<Vec<_>>(),
        vec!["JavaScript", "Lean", "Rocq", "Rust"]
    );
    for item in cases {
        let name = text(item, "name");
        let source = text(item, "source");
        let language = text(item, "language");
        let replacement = text(item, "to");
        let program = analyze(source, language);
        let found = binding(&program, item);
        assert_eq!(found.kind(), text(item, "kind"), "{name}");
        assert_eq!(
            location(source, found.declaration()),
            expected(&item["declaration"]),
            "{name}"
        );
        let references: Vec<Vec<u64>> = found
            .references()
            .iter()
            .map(|range| location(source, *range))
            .collect();
        let stored: Vec<Vec<u64>> = item["references"]
            .as_array()
            .unwrap()
            .iter()
            .map(expected)
            .collect();
        assert_eq!(references, stored, "{name}");
        let renamed = program.rename_binding(found.id(), replacement);
        if item["refused"].as_bool() == Some(true) {
            assert!(
                matches!(
                    renamed,
                    Err(ProgramRepresentationError::CaptureConflict { .. })
                ),
                "{name}: expected a capture refusal"
            );
            continue;
        }
        let output = renamed
            .unwrap_or_else(|error| panic!("{name}: {error}"))
            .emit();
        assert_eq!(output, text(item, "expected"), "{name}");
        // Re-check the edit from the emitted text alone.
        let declaration = expected(&item["declaration"]);
        let reparsed = analyze(&output, language);
        let at_site: Vec<&ProgramBinding> = reparsed
            .bindings()
            .iter()
            .filter(|other| location(&output, other.declaration())[..2] == declaration[..2])
            .collect();
        assert_eq!(at_site.len(), 1, "{name}");
        assert_eq!(at_site[0].name(), replacement, "{name}");
        assert_eq!(
            location(&output, at_site[0].declaration())[2],
            replacement.chars().count() as u64,
            "{name}"
        );
        assert_eq!(at_site[0].references().len(), stored.len(), "{name}");
    }
}

#[test]
fn invalid_replacement_names_and_unknown_bindings_are_refused_in_every_language() {
    let corpus = corpus();
    let invalid: Vec<&str> = corpus["invalidReplacements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap())
        .collect();
    for item in corpus["cases"].as_array().unwrap() {
        if item["refused"].as_bool() == Some(true) {
            continue;
        }
        let name = text(item, "name");
        let source = text(item, "source");
        let program = analyze(source, text(item, "language"));
        let found = binding(&program, item);
        for replacement in &invalid {
            assert!(
                matches!(
                    program.rename_binding(found.id(), replacement),
                    Err(ProgramRepresentationError::InvalidIdentifier { .. })
                ),
                "{name}: {replacement:?}"
            );
        }
        let forged = format!("{}-forged", found.id());
        assert!(matches!(
            program.rename_binding(&forged, text(item, "to")),
            Err(ProgramRepresentationError::UnknownBinding(_))
        ));
        assert_eq!(
            program
                .rename_binding(found.id(), text(item, "binding"))
                .unwrap()
                .emit(),
            source,
            "{name}"
        );
    }
}
