use rml::meta_language_support::rewrite_javascript_identifier_via_meta_language;
use serde_json::Value;
#[test]
fn shared_capture_and_shadowing_aware_conservative_rename_corpus() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../test-corpus/meta-language/identifier-rewrites.json"
    ))
    .unwrap();
    for item in corpus["cases"].as_array().unwrap() {
        let result = rewrite_javascript_identifier_via_meta_language(
            item["source"].as_str().unwrap(),
            item["from"].as_str().unwrap(),
            item["to"].as_str().unwrap(),
        );
        if let Some(code) = item["error"].as_str() {
            assert!(result.unwrap_err().starts_with(code), "{}", item["name"]);
            continue;
        }
        let result = result.unwrap_or_else(|error| panic!("{}: {error}", item["name"]));
        assert_eq!(
            result.source,
            item["expected"].as_str().unwrap(),
            "{}",
            item["name"]
        );
        assert_eq!(result.match_count, item["count"].as_u64().unwrap() as usize);
        assert_eq!(result.changed, result.match_count > 0);
        assert!(!result.syntax_validated);
        if let Some(expected) = item["starts"].as_array() {
            let actual: Vec<_> = result.matches.iter().map(|replacement| serde_json::json!({
                "offset": replacement.start.offset, "line": replacement.start.line, "column": replacement.start.column,
            })).collect();
            assert_eq!(&actual, expected, "{}", item["name"]);
        }
    }
}
#[test]
fn rejects_a_reserved_word_as_the_new_binding_name() {
    assert!(
        rewrite_javascript_identifier_via_meta_language("let x = 1;", "x", "class")
            .unwrap_err()
            .contains("must be a JavaScript identifier")
    );
}
