//! Print what `links-notation` reads by itself, with no front end in between,
//! from each source in a JSON list (issue #183).
//!
//! Run with:
//!
//!     cargo run --release --example links_notation_alone --manifest-path rust/Cargo.toml -- [--format] [--parse-only] [--stack-kib N] sources.json
//!
//! For each source it prints one JSON line: the links `parse_lino_to_links`
//! returns, each reference as a string and each link as `{"id", "values"}`, or
//! the error it fails with; and `micros`, the microseconds the read took.
//! `--format` adds `formatted`, what `format_links` writes the links back as.
//! `--parse-only` times only what `parse_lino_to_links` does before it
//! flattens the parsed links, stripping comments and parsing, and prints how
//! many links the parser returned as `parsed`. `--stack-kib N` reads on a
//! thread with a stack of N KiB instead of on the main thread.
//! `experiments/lino-frontend/upstream.mjs` compares these lines with what the
//! JavaScript `links-notation` reads.

use links_notation::comments::strip_comments;
use links_notation::parser::parse_document_with_diagnostics;
use links_notation::{format_links, parse_lino_to_links, LiNo, ParseError};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::process::ExitCode;
use std::thread;
use std::time::Instant;

const USAGE: &str =
    "usage: links_notation_alone [--format] [--parse-only] [--stack-kib N] sources.json";

#[derive(Default)]
struct Options {
    format: bool,
    parse_only: bool,
    stack_kib: Option<usize>,
    path: Option<String>,
}

fn options() -> Option<Options> {
    let mut options = Options::default();
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--format" => options.format = true,
            "--parse-only" => options.parse_only = true,
            "--stack-kib" => options.stack_kib = Some(args.next()?.parse().ok()?),
            _ if options.path.is_none() && !arg.starts_with("--") => options.path = Some(arg),
            _ => return None,
        }
    }
    options.path.is_some().then_some(options)
}

fn link_json(link: &LiNo<String>) -> Value {
    match link {
        LiNo::Ref(name) => json!(name),
        LiNo::Link { id, values } => json!({
            "id": id,
            "values": values.iter().map(link_json).collect::<Vec<_>>(),
        }),
    }
}

fn read(source: &str, format: bool) -> Value {
    let started = Instant::now();
    let links = parse_lino_to_links(source);
    let micros = started.elapsed().as_micros();
    match links {
        Ok(links) if format => json!({
            "links": links.iter().map(link_json).collect::<Vec<_>>(),
            "formatted": format_links(&links),
            "micros": micros,
        }),
        Ok(links) => json!({
            "links": links.iter().map(link_json).collect::<Vec<_>>(),
            "micros": micros,
        }),
        Err(ParseError::SyntaxError(error)) => {
            json!({ "error": error.summary(), "micros": micros })
        }
        Err(error) => json!({ "error": error.to_string(), "micros": micros }),
    }
}

fn parse(source: &str) -> Value {
    let started = Instant::now();
    let parsed = parse_document_with_diagnostics(&strip_comments(source));
    let micros = started.elapsed().as_micros();
    match parsed {
        Ok(links) => json!({ "parsed": links.len(), "micros": micros }),
        Err(failure) => {
            json!({ "error": format!("stopped at byte {}", failure.offset), "micros": micros })
        }
    }
}

fn read_all(sources: &[String], options: &Options) {
    for source in sources {
        let line = if options.parse_only {
            parse(source)
        } else {
            read(source, options.format)
        };
        println!("{line}");
    }
}

fn main() -> ExitCode {
    let Some(options) = options() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let path = options.path.as_deref().unwrap_or_default();
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };
    let sources: Vec<String> = match serde_json::from_str(&text) {
        Ok(sources) => sources,
        Err(error) => {
            eprintln!("{path} is not a JSON list of strings: {error}");
            return ExitCode::from(2);
        }
    };
    match options.stack_kib {
        Some(kib) => thread::scope(|scope| {
            thread::Builder::new()
                .stack_size(kib * 1024)
                .spawn_scoped(scope, || read_all(&sources, &options))
                .expect("cannot start the reading thread")
                .join()
                .expect("the reading thread panicked");
        }),
        None => read_all(&sources, &options),
    }
    ExitCode::SUCCESS
}
