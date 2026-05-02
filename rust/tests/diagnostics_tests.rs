// Tests for structured diagnostics (issue #28).
// Mirrors js/tests/diagnostics.test.mjs so any drift between the two
// implementations fails both test suites.

use rml::{compute_form_spans, evaluate, format_diagnostic, Diagnostic, RunResult, Span};

#[test]
fn evaluate_clean_input_returns_results_and_no_diagnostics() {
    let out = evaluate("(valence: 2)\n(p has probability 1)\n(? p)", None, None);
    assert_eq!(out.diagnostics.len(), 0);
    assert_eq!(out.results.len(), 1);
    match &out.results[0] {
        RunResult::Num(n) => assert!((*n - 1.0).abs() < 1e-9),
        other => panic!("expected numeric result, got {:?}", other),
    }
}

#[test]
fn evaluate_does_not_panic_on_unknown_op() {
    let out = evaluate("(=: missing_op identity)", Some("inline.lino"), None);
    assert!(out.diagnostics.len() >= 1);
}

#[test]
fn unknown_op_surfaces_as_e001_with_span() {
    let out = evaluate("(=: missing_op identity)", Some("inline.lino"), None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E001");
    assert!(d.message.contains("Unknown op"), "msg was: {}", d.message);
    assert_eq!(d.span.file.as_deref(), Some("inline.lino"));
    assert_eq!(d.span.line, 1);
    assert_eq!(d.span.col, 1);
}

#[test]
fn unknown_aggregator_surfaces_as_e004() {
    let out = evaluate("(and: bogus_agg)", Some("agg.lino"), None);
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E004");
    assert!(
        d.message.to_lowercase().contains("aggregator"),
        "msg was: {}",
        d.message
    );
    assert_eq!(d.span.line, 1);
}

#[test]
fn fresh_variable_collision_surfaces_as_e010() {
    let out = evaluate(
        "(Natural: (Type 0) Natural)\n(x: Natural x)\n(? (fresh x in x))",
        Some("fresh.lino"),
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    let d = &out.diagnostics[0];
    assert_eq!(d.code, "E010");
    assert!(
        d.message
            .contains("fresh variable \"x\" already appears in context"),
        "msg was: {}",
        d.message
    );
    assert_eq!(d.span.file.as_deref(), Some("fresh.lino"));
    assert_eq!(d.span.line, 3);
}

#[test]
fn fresh_variable_is_restored_when_body_reports_a_diagnostic() {
    let out = evaluate(
        "(? (fresh z in (=: missing identity)))\n(? (fresh z in z))",
        Some("fresh-error.lino"),
        None,
    );
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E001");
    assert_eq!(out.diagnostics[0].span.line, 1);
    assert_eq!(out.results.len(), 1);
}

#[test]
fn span_tracks_line_for_form_after_blank_lines() {
    let src = "(valence: 2)\n\n(=: missing identity)";
    let out = evaluate(src, Some("multi.lino"), None);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E001");
    assert_eq!(out.diagnostics[0].span.line, 3);
    assert_eq!(out.diagnostics[0].span.col, 1);
}

#[test]
fn good_results_are_kept_when_a_later_form_errors() {
    let src = "(valence: 2)\n(p has probability 1)\n(? p)\n(=: missing identity)";
    let out = evaluate(src, Some("mix.lino"), None);
    assert_eq!(out.results.len(), 1);
    match &out.results[0] {
        RunResult::Num(n) => assert!((*n - 1.0).abs() < 1e-9),
        other => panic!("expected numeric result, got {:?}", other),
    }
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].code, "E001");
    assert_eq!(out.diagnostics[0].span.line, 4);
}

#[test]
fn format_diagnostic_renders_caret_under_offending_token() {
    let src = "(=: missing_op identity)";
    let out = evaluate(src, Some("demo.lino"), None);
    assert_eq!(out.diagnostics.len(), 1);
    let text = format_diagnostic(&out.diagnostics[0], Some(src));
    let lines: Vec<&str> = text.split('\n').collect();
    assert!(
        lines[0].starts_with("demo.lino:1:1: E001:"),
        "line[0] was: {}",
        lines[0]
    );
    assert_eq!(lines[1], "(=: missing_op identity)");
    assert_eq!(lines[2], "^");
}

#[test]
fn format_diagnostic_for_second_line() {
    let src = "(valence: 2)\n(=: missing_op identity)";
    let out = evaluate(src, Some("caret.lino"), None);
    assert_eq!(out.diagnostics.len(), 1);
    let text = format_diagnostic(&out.diagnostics[0], Some(src));
    let lines: Vec<&str> = text.split('\n').collect();
    assert!(
        lines[0].starts_with("caret.lino:2:1:"),
        "line[0] was: {}",
        lines[0]
    );
    assert_eq!(lines[1], "(=: missing_op identity)");
    assert_eq!(lines[2], "^");
}

#[test]
fn diagnostic_struct_carries_code_message_span() {
    let span = Span::new(Some("x.lino".to_string()), 2, 3, 1);
    let diag = Diagnostic::new("E001", "Unknown op: foo", span.clone());
    assert_eq!(diag.code, "E001");
    assert_eq!(diag.message, "Unknown op: foo");
    assert_eq!(diag.span, span);
}

#[test]
fn compute_form_spans_returns_one_span_per_top_level_form() {
    let text = "(a)\n  (b)\n\n(c)";
    let spans = compute_form_spans(text, Some("spans.lino"));
    assert_eq!(spans.len(), 3);
    let lc: Vec<(usize, usize)> = spans.iter().map(|s| (s.line, s.col)).collect();
    assert_eq!(lc, vec![(1, 1), (2, 3), (4, 1)]);
    for s in &spans {
        assert_eq!(s.file.as_deref(), Some("spans.lino"));
    }
}
