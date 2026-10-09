//! Print what the shared LiNo front end reads from each source in a JSON list
//! (issue #183).
//!
//! Run with:
//!
//!     cargo run --example lino_forms --manifest-path rust/Cargo.toml -- [--time] sources.json
//!
//! For each source it prints one JSON line: the forms, or the E006 error, and
//! what the prepare step returns, with every reference that starts with a
//! quote as `[line, column, text, value]`. With `--time`, each line also holds
//! `micros`, the microseconds reading the forms took.
//! `experiments/lino-frontend/differential.mjs` compares these lines with what
//! the JavaScript front end reads.

use rml::lino_frontend::PreparedLino;
use rml::{parse_lino_document, prepare_lino_source, LinoParseError};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::process::ExitCode;
use std::time::Instant;

fn error_json(error: &LinoParseError) -> Value {
    json!({
        "message": error.message(),
        "line": error.line,
        "col": error.col,
        "length": error.length,
    })
}

/// The `[line, column, text, value]` of every reference that starts with a
/// quote, with 1-based lines and code-point columns.
fn quotes_json(prepared: &PreparedLino) -> Vec<Value> {
    let source = &prepared.source;
    let (mut line, mut col, mut at) = (1, 1, 0);
    prepared
        .quotes
        .iter()
        .map(|quote| {
            for character in source[at..quote.start].chars() {
                if character == '\n' {
                    line += 1;
                    col = 1;
                } else {
                    col += 1;
                }
            }
            at = quote.start;
            json!([line, col, &source[quote.start..quote.end], quote.value])
        })
        .collect()
}

fn read(source: &str, timed: bool) -> Value {
    let started = Instant::now();
    let forms = parse_lino_document(source);
    let micros = started.elapsed().as_micros();
    let mut result = match forms {
        Ok(forms) => json!({
            "forms": forms
                .iter()
                .map(|form| json!({
                    "text": form.text,
                    "line": form.line,
                    "col": form.col,
                    "length": form.length,
                }))
                .collect::<Vec<_>>(),
        }),
        Err(error) => json!({ "error": error_json(&error) }),
    };
    match prepare_lino_source(source) {
        Ok(prepared) => {
            result["prepared"] = json!(prepared.prepared);
            result["lines"] = prepared
                .lines
                .iter()
                .map(|line| json!([line.line, line.col]))
                .collect();
            result["quotes"] = json!(quotes_json(&prepared));
        }
        Err(error) => result["prepareError"] = error_json(&error),
    }
    if timed {
        result["micros"] = json!(micros);
    }
    result
}

fn main() -> ExitCode {
    let mut args: Vec<String> = env::args().skip(1).collect();
    let timed = args.first().is_some_and(|arg| arg == "--time");
    if timed {
        args.remove(0);
    }
    let [path] = args.as_slice() else {
        eprintln!("Usage: lino_forms [--time] <sources.json>");
        return ExitCode::from(2);
    };
    let sources: Vec<String> = match fs::read_to_string(path)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str(&text).map_err(|error| error.to_string()))
    {
        Ok(sources) => sources,
        Err(error) => {
            eprintln!("Cannot read a JSON list of strings from {path}: {error}");
            return ExitCode::from(1);
        }
    };
    for source in &sources {
        println!("{}", read(source, timed));
    }
    ExitCode::SUCCESS
}
