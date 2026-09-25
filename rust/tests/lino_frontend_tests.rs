// Tests for the shared LiNo front end (issue #183).
//
// Both runtimes read RML source through the same front end, and both test
// suites check the cases in `test-corpus/lino-frontend/cases.json`, so a
// document yields the same forms, positions, and parse errors in each. The
// JavaScript mirror of this file is `js/tests/lino-frontend.test.mjs`.

use rml::{
    normalize_lino_source, parse_lino_document, prepare_lino_source, LinoForm, LinoParseError,
    MAX_LINO_NESTING_DEPTH, MAX_LINO_SOURCE_UNITS,
};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::thread;

fn cases() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("test-corpus")
        .join("lino-frontend")
        .join("cases.json");
    let text = fs::read_to_string(&path).expect("the front-end cases exist");
    let fixture: Value = serde_json::from_str(&text).expect("the front-end cases are JSON");
    fixture["cases"]
        .as_array()
        .expect("the front-end cases hold a list")
        .clone()
}

/// A source is a string, or a list of strings and `{repeat, times}` parts.
fn expand_source(source: &Value) -> String {
    match source {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .map(|part| match part {
                Value::String(text) => text.clone(),
                _ => {
                    let text = part["repeat"].as_str().expect("a part repeats a string");
                    let times = part["times"].as_u64().expect("a part repeats a count");
                    text.repeat(usize::try_from(times).expect("the count fits"))
                }
            })
            .collect(),
        _ => panic!("a source is a string or a list of parts, not {source}"),
    }
}

fn form_json(form: &LinoForm) -> Value {
    json!({ "text": form.text, "line": form.line, "col": form.col, "length": form.length })
}

fn error_json(error: &LinoParseError) -> Value {
    json!({
        "message": error.message(),
        "line": error.line,
        "col": error.col,
        "length": error.length,
    })
}

/// What reading `source` gives: its forms, or the error.
fn read(source: &str) -> Value {
    match parse_lino_document(source) {
        Ok(forms) => json!({ "forms": forms.iter().map(form_json).collect::<Vec<_>>() }),
        Err(error) => json!({ "error": error_json(&error) }),
    }
}

/// What preparing `source` gives: the prepared text and logical lines, or
/// the error.
fn prepare(source: &str) -> Value {
    match prepare_lino_source(source) {
        Ok(prepared) => json!({
            "prepared": prepared.prepared,
            "lines": prepared
                .lines
                .iter()
                .map(|line| json!([line.line, line.col]))
                .collect::<Vec<_>>(),
        }),
        Err(error) => json!({ "error": error_json(&error) }),
    }
}

/// Run `check` on a thread with a 2 MiB stack, the stack the nesting limit
/// is meant to keep the parser within.
fn on_small_stack(check: impl FnOnce() + Send + 'static) {
    thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(check)
        .expect("a thread with a 2 MiB stack starts")
        .join()
        .expect("the check passes within a 2 MiB stack");
}

/// `count` lines of `a`, each one space deeper than the line before it.
fn indented_lines(count: usize) -> Vec<String> {
    (0..count)
        .map(|level| format!("{}a", " ".repeat(level)))
        .collect()
}

fn nesting_error(line: usize, col: usize) -> LinoParseError {
    LinoParseError {
        detail: format!("nesting deeper than {MAX_LINO_NESTING_DEPTH} levels"),
        line,
        col,
        length: 1,
    }
}

#[test]
fn every_shared_case_reads_the_same_way() {
    let cases = cases();
    assert!(!cases.is_empty(), "the front-end cases are not empty");
    let mut mismatches = Vec::new();
    for case in &cases {
        let name = case["name"].as_str().expect("a case has a name");
        let source = expand_source(&case["source"]);
        let expected = match case.get("error") {
            Some(error) => json!({ "error": error }),
            None => json!({ "forms": case["forms"] }),
        };
        let actual = read(&source);
        if actual != expected {
            mismatches.push(format!("{name}: read {actual}, expected {expected}"));
        }
        let expected = match case.get("prepared") {
            Some(prepared) => json!({ "prepared": prepared, "lines": case["lines"] }),
            None => json!({ "error": case["error"] }),
        };
        let actual = prepare(&source);
        if actual != expected {
            mismatches.push(format!("{name}: prepared {actual}, expected {expected}"));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {} cases differ:\n{}",
        mismatches.len(),
        cases.len(),
        mismatches.join("\n")
    );
}

#[test]
fn reads_the_deepest_indentation_the_nesting_limit_allows() {
    on_small_stack(|| {
        let lines = indented_lines(MAX_LINO_NESTING_DEPTH + 1);
        let forms = parse_lino_document(&lines.join("\n")).expect("the limit is allowed");
        assert_eq!(forms.len(), lines.len());
        let last = forms.last().expect("a last form");
        assert_eq!(
            (last.line, last.col, last.length),
            (MAX_LINO_NESTING_DEPTH + 1, MAX_LINO_NESTING_DEPTH + 1, 1)
        );
        assert_eq!(last.text.matches('a').count(), lines.len());
    });
}

#[test]
fn refuses_one_indentation_level_more_than_the_limit() {
    on_small_stack(|| {
        let lines = indented_lines(MAX_LINO_NESTING_DEPTH + 2);
        assert_eq!(
            parse_lino_document(&lines.join("\n")),
            Err(nesting_error(
                MAX_LINO_NESTING_DEPTH + 2,
                MAX_LINO_NESTING_DEPTH + 2
            ))
        );
    });
}

#[test]
fn counts_parentheses_and_indentation_levels_together() {
    on_small_stack(|| {
        let levels = MAX_LINO_NESTING_DEPTH - 2;
        let mut within = indented_lines(levels);
        within.push(format!("{}((a))", " ".repeat(levels)));
        let forms = parse_lino_document(&within.join("\n")).expect("the limit is allowed");
        assert_eq!(forms.len(), within.len());
        let mut beyond = indented_lines(levels + 1);
        beyond.push(format!("{}((a))", " ".repeat(levels + 1)));
        assert_eq!(
            parse_lino_document(&beyond.join("\n")),
            Err(nesting_error(levels + 2, levels + 3))
        );
    });
}

#[test]
fn measures_the_source_length_in_utf16_code_units() {
    // `é` is one UTF-16 code unit and two UTF-8 bytes.
    let longest = "é".repeat(MAX_LINO_SOURCE_UNITS);
    let prepared = prepare_lino_source(&longest).expect("the longest source is allowed");
    assert_eq!(prepared.lines.len(), 1);
    let error = prepare_lino_source(&"é".repeat(MAX_LINO_SOURCE_UNITS + 1))
        .expect_err("a longer source is refused");
    assert_eq!(
        error_json(&error),
        json!({
            "message": format!(
                "LiNo parse failure: source longer than {MAX_LINO_SOURCE_UNITS} UTF-16 code units"
            ),
            "line": 1,
            "col": 1,
            "length": 0,
        })
    );
    assert_eq!(error.to_diagnostic(None).code, LinoParseError::CODE);
    assert_eq!(LinoParseError::CODE, "E006");
}

#[test]
fn normalizes_a_leading_byte_order_mark_and_every_line_ending() {
    assert_eq!(normalize_lino_source("\u{feff}a\r\nb\rc\nd"), "a\nb\nc\nd");
    assert_eq!(normalize_lino_source("a\u{feff}b"), "a\u{feff}b");
}

#[test]
fn blanks_a_comment_one_byte_at_a_time() {
    // `é` takes two bytes and `😀` four, so the comment `# é😀` takes eight.
    let source = "(a) # é😀\n(b)";
    let prepared = prepare_lino_source(source).expect("the source is valid");
    assert_eq!(prepared.prepared, format!("(a) {}\n(b)", " ".repeat(8)));
    assert_eq!(prepared.prepared.len(), prepared.source.len());
    assert_eq!(
        read(source),
        json!({ "forms": [
            { "text": "(a)", "line": 1, "col": 1, "length": 1 },
            { "text": "(b)", "line": 2, "col": 1, "length": 1 },
        ] })
    );
}
