//! Print what the shared LiNo front end reads from each source in a JSON list
//! (issue #183).
//!
//! Run with:
//!
//!     cargo run --example lino_forms --manifest-path rust/Cargo.toml -- sources.json
//!
//! For each source it prints one JSON line: the forms, or the E006 error, and
//! what the prepare step returns. `experiments/lino-frontend/differential.mjs`
//! compares these lines with what the JavaScript front end reads.

use rml::{parse_lino_document, prepare_lino_source, LinoParseError};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::process::ExitCode;

fn error_json(error: &LinoParseError) -> Value {
    json!({
        "message": error.message(),
        "line": error.line,
        "col": error.col,
        "length": error.length,
    })
}

fn read(source: &str) -> Value {
    let mut result = match parse_lino_document(source) {
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
        }
        Err(error) => result["prepareError"] = error_json(&error),
    }
    result
}

fn main() -> ExitCode {
    let Some(path) = env::args().nth(1) else {
        eprintln!("Usage: lino_forms <sources.json>");
        return ExitCode::from(2);
    };
    let sources: Vec<String> = match fs::read_to_string(&path)
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
        println!("{}", read(source));
    }
    ExitCode::SUCCESS
}
