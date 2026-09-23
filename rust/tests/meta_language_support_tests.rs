use rml::meta_language_support::{
    meta_language_feature_report, meta_language_substitution_smoke, meta_language_truth_smoke,
    parse_rml_links_via_meta_language, parse_rml_to_meta_language,
    reconstruct_rml_from_meta_language, render_meta_language_translation_smoke,
    rewrite_javascript_identifier_via_meta_language, rml_meta_language_parity_report,
};

const RML_SAMPLE: &str = "(a: a is a)\n((a = a) has probability 1)\n(? (a = a))\n";

#[test]
fn represents_rml_source_losslessly_through_meta_language() {
    let network = parse_rml_to_meta_language(RML_SAMPLE);

    assert!(network.len() >= RML_SAMPLE.len());
    assert_eq!(reconstruct_rml_from_meta_language(&network), RML_SAMPLE);
    assert_eq!(
        parse_rml_links_via_meta_language(RML_SAMPLE),
        vec![
            "(a: a is a)".to_string(),
            "((a = a) has probability 1)".to_string(),
            "(? (a = a))".to_string(),
        ]
    );
}

#[test]
fn keeps_rml_parser_and_evaluator_results_identical_after_meta_language_round_trip() {
    let report = rml_meta_language_parity_report(RML_SAMPLE);

    assert_eq!(report.language, "RML");
    assert!(report.round_trip_ok);
    assert!(report.link_parity_ok);
    assert!(report.evaluation_parity_ok);
    assert_eq!(report.direct_results, report.meta_results);
    assert_eq!(report.direct_diagnostics, report.meta_diagnostics);
}

#[test]
fn rewrites_javascript_identifiers_through_meta_language_query_and_replace() {
    let rewritten = rewrite_javascript_identifier_via_meta_language(
        "const oldName = call(oldName);\n",
        "oldName",
        "newName",
    )
    .expect("valid identifier rewrite should succeed");

    assert_eq!(rewritten.match_count, 2);
    assert!(rewritten.changed);
    assert_eq!(rewritten.source, "const newName = call(newName);\n");
}

#[test]
fn does_not_rewrite_identifier_spellings_inside_javascript_strings_or_comments() {
    let rewritten = rewrite_javascript_identifier_via_meta_language(
        "const x = 1; const s = \"x\"; // x\n",
        "x",
        "y",
    )
    .expect("valid identifier rewrite should succeed");

    assert_eq!(rewritten.match_count, 1);
    assert!(rewritten.changed);
    assert_eq!(rewritten.source, "const y = 1; const s = \"x\"; // x\n");
}

#[test]
fn exposes_structural_substitution_support_from_meta_language() {
    let report = meta_language_substitution_smoke();

    assert!(report.updated >= 1);
    assert!(report.changed);
}

#[test]
fn renders_through_meta_language_translation_rules() {
    assert_eq!(
        render_meta_language_translation_smoke("(namespace self)"),
        "translated"
    );
}

#[test]
fn exposes_meta_language_truth_semantics_used_by_rml_planning() {
    let report = meta_language_truth_smoke();

    assert_eq!(report.conjunction, "Unknown");
    assert_eq!(report.probability_basis_points, 2500);
    assert_eq!(report.probabilistic_and_basis_points, 2500);
}

#[test]
fn summarizes_available_meta_language_features_for_issue_181() {
    let report = meta_language_feature_report(RML_SAMPLE);

    assert_eq!(report.package_name, "meta-language");
    assert!(report.rml.round_trip_ok);
    assert!(report.rml.evaluation_parity_ok);
    assert!(report.substitution.changed);
    assert_eq!(report.translation, "translated");
    assert_eq!(report.truth.probabilistic_and_basis_points, 2500);
}
