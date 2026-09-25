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
use std::panic;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

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

/// The 1-based line and code-point column of a byte offset in `source`.
fn position(source: &str, offset: usize) -> (usize, usize) {
    let before = &source[..offset];
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    (
        before.matches('\n').count() + 1,
        before[line_start..].chars().count() + 1,
    )
}

/// What preparing `source` gives: the prepared text, the logical lines, and
/// the `[line, column, text, value]` of every reference that starts with a
/// quote, or the error.
fn prepare(source: &str) -> Value {
    match prepare_lino_source(source) {
        Ok(prepared) => json!({
            "prepared": prepared.prepared,
            "lines": prepared
                .lines
                .iter()
                .map(|line| json!([line.line, line.col]))
                .collect::<Vec<_>>(),
            "quotes": prepared
                .quotes
                .iter()
                .map(|quote| {
                    let (line, col) = position(&prepared.source, quote.start);
                    json!([line, col, &prepared.source[quote.start..quote.end], quote.value])
                })
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

/// How long reading any of the sources built to be slow to read may take.
const READ_LIMIT: Duration = Duration::from_secs(5);

/// What reading `source` gives, read on a thread with a 2 MiB stack that is
/// waited for no longer than `READ_LIMIT`, so a reader that takes too long
/// fails the test instead of holding it up.
fn read_within_limit(source: String) -> Result<Value, String> {
    let (sender, receiver) = mpsc::channel();
    let reader = thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || {
            // Nobody listens any more once the limit has passed.
            let _ = sender.send(read(&source));
        })
        .expect("a thread with a 2 MiB stack starts");
    match receiver.recv_timeout(READ_LIMIT) {
        Ok(result) => Ok(result),
        Err(RecvTimeoutError::Timeout) => Err(format!(
            "reading took longer than {} ms",
            READ_LIMIT.as_millis()
        )),
        Err(RecvTimeoutError::Disconnected) => {
            panic::resume_unwind(reader.join().expect_err("the reader panicked"))
        }
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
            Some(prepared) => json!({
                "prepared": prepared,
                "lines": case["lines"],
                "quotes": case["quotes"],
            }),
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

/// Each source built to be slow to read, and what it reads as.
/// links-notation 0.20 alone takes time that grows exponentially with how
/// deeply the groups nest where a group is left unclosed, fails, or has a
/// value after it, with the square of the length on the wide quote, and with
/// the length to the power 1.5 on the quotes of ever smaller widths. The last
/// source has fifty thousand quoted references for the front end to stand
/// tokens in for.
fn slow_sources() -> Vec<(&'static str, String, Value)> {
    let depth = MAX_LINO_NESTING_DEPTH;
    let (open, close) = ("(".repeat(depth), ")".repeat(depth));
    let quotes = |count: usize| "'".repeat(count);
    // Odd widths from 315 down to 1, and even widths from 316 down to 2.
    let odd_widths: Vec<usize> = (0..158).map(|index| 315 - 2 * index).collect();
    let even_widths: Vec<usize> = odd_widths.iter().map(|width| width + 1).collect();
    let wide = 300_000;
    let words = 100_000;
    let references = 50_000;
    let failure = |detail: &str, col: usize| {
        json!({ "error": {
            "message": format!("LiNo parse failure: {detail}"),
            "line": 1,
            "col": col,
            "length": 1,
        } })
    };
    let form =
        |text: String| json!({ "forms": [{ "text": text, "line": 1, "col": 1, "length": 1 }] });
    let joined = |parts: Vec<String>| parts.join(" ");

    let nested = format!("{open}a{close}");
    let values = format!("{}b{close}", "(a ".repeat(depth));
    let names = format!("{}b{close}", "(a: ".repeat(depth));
    let quoted = format!("{}\"c d\"{close}", "(\"a b\" ".repeat(depth));
    let narrowing_even = format!(
        "{} ( {}{}",
        joined(even_widths.iter().map(|&width| quotes(width)).collect()),
        "x ".repeat(words),
        joined(
            even_widths
                .iter()
                .rev()
                .map(|&width| quotes(width))
                .collect()
        ),
    );
    let narrowing_even_end = narrowing_even.chars().count() + 1;
    vec![
        ("groups nested to the limit", nested.clone(), form(nested)),
        (
            "a value in each group nested to the limit",
            values.clone(),
            form(values),
        ),
        (
            "a name on each group nested to the limit",
            names.clone(),
            form(names),
        ),
        (
            "a quoted reference in each group nested to the limit",
            quoted.clone(),
            form(quoted.replace('"', "'")),
        ),
        (
            "a value after each group nested to the limit",
            format!("{open}{}", "a) b".repeat(depth)),
            form(format!("({open}a){} b)", " ba)".repeat(depth - 1))),
        ),
        (
            "groups nested to the limit left unclosed",
            format!("{open}a"),
            failure("unexpected end of input", depth + 2),
        ),
        (
            "a second name inside groups nested to the limit",
            format!("{open}a: b: c{close}"),
            failure("unexpected \":\"", depth + 5),
        ),
        (
            "a colon without a name inside groups nested to the limit",
            format!("{open}:{close}"),
            failure("unexpected \":\"", depth + 1),
        ),
        (
            "a wide unclosed quote before a long run of quotes",
            format!(
                "{} a {} {}",
                quotes(wide + 1),
                quotes(wide - 4),
                "x".repeat(2 * wide)
            ),
            form(format!(
                "(\"{}\" a \"\" {})",
                quotes(wide + 1),
                "x".repeat(2 * wide)
            )),
        ),
        (
            "unclosed quotes of ever smaller widths",
            format!(
                "{} {}",
                joined(
                    odd_widths
                        .iter()
                        .map(|&width| format!("{}x", quotes(width)))
                        .collect()
                ),
                "a' ".repeat(words)
            ),
            form(format!(
                "({} 'x a' {})",
                joined(
                    odd_widths[..odd_widths.len() - 1]
                        .iter()
                        .map(|&width| format!("\"{}x\"", quotes(width)))
                        .collect()
                ),
                vec!["\"a'\""; words - 1].join(" ")
            )),
        ),
        (
            "even quotes of ever smaller widths around an unclosed parenthesis",
            narrowing_even,
            failure("unexpected end of input", narrowing_even_end),
        ),
        (
            "many quoted references on one line",
            "'a' ".repeat(references),
            form(format!("({})", vec!["a"; references].join(" "))),
        ),
    ]
}

#[test]
fn reads_every_source_built_to_be_slow_within_the_limit() {
    let sources = slow_sources();
    let mut failures = Vec::new();
    for (name, source, expected) in sources.iter().cloned() {
        match read_within_limit(source) {
            Ok(actual) if actual == expected => {}
            Ok(actual) => failures.push(format!("{name}: read {actual}, expected {expected}")),
            Err(failure) => failures.push(format!("{name}: {failure}")),
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} sources fail:\n{}",
        failures.len(),
        sources.len(),
        failures.join("\n")
    );
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

#[test]
fn keeps_references_of_private_use_characters_apart_from_the_names_it_makes() {
    // The front end names quoted references and groups with two private-use
    // characters that never stand side by side in the source: the first one
    // the source holds fewer than 6400 times, then the first one that never
    // follows it. Here U+E000 stands more than 6400 times, and U+E001 6399
    // times, before every private-use character but U+F8FF, so the names start
    // with U+E001 U+F8FF, and the references that start with U+E000 U+E000 or
    // with U+E001 U+E000 are read as they are.
    let private_use: Vec<char> = ('\u{e000}'..='\u{f8ff}').collect();
    // References of `first` before each of `characters`.
    let after = |first: char, characters: &[char]| {
        characters
            .iter()
            .map(|character| format!("{first}{character}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let all_but_e001: Vec<char> = private_use
        .iter()
        .copied()
        .filter(|&character| character != '\u{e001}')
        .collect();
    let lines = [
        format!(
            "({} \u{e000}\u{e000}q0 \u{e000}\u{e000}g0)",
            after('\u{e000}', &all_but_e001)
        ),
        format!(
            "({} \u{e001}\u{e001}\u{e002} \u{e001}\u{e000}q0)",
            after('\u{e001}', &private_use[3..private_use.len() - 1])
        ),
        "('a b' (c (d 'e f')))".to_string(),
    ];
    let forms: Vec<Value> = lines
        .iter()
        .enumerate()
        .map(|(index, text)| json!({ "text": text, "line": index + 1, "col": 1, "length": 1 }))
        .collect();
    assert_eq!(read(&lines.join("\n")), json!({ "forms": forms }));
}
