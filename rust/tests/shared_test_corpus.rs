// Walks the repository-root /test-corpus folder and runs every .lino file
// through the Rust implementation. Asserts the output matches the canonical
// fixtures in /test-corpus/expected.lino (Links Notation).
//
// The JavaScript test suite asserts against the same fixtures file, so
// regression inputs cannot drift between implementations.

use rml::{
    evaluate_file, is_num, key_of, parse_lino, parse_one, tokenize_one, EvaluateOptions, Node,
    RunResult,
};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
enum ExpectedValue {
    Num(f64),
    Type(String),
}

fn corpus_dir() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir).join("..").join("test-corpus")
}

fn list_lino_files(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = fs::read_dir(dir)
        .expect("test-corpus dir exists")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".lino") && name != "expected.lino")
        .collect();
    files.sort();
    files
}

// Parse expected.lino into pairs of (filename, expected results).
//
// Each link has the shape `(filename.lino: <result> <result> ...)`. A numeric
// result is a bare token (parsed with `is_num`); a structured result is stored
// as `(type <value>)` and compared against the runtime string representation.
fn load_expected() -> Vec<(String, Vec<ExpectedValue>)> {
    let path = corpus_dir().join("expected.lino");
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));

    let mut out = Vec::new();
    let links =
        parse_lino(&text).unwrap_or_else(|e| panic!("{} is not valid LiNo: {}", path.display(), e));
    for link_str in links {
        let toks = tokenize_one(&link_str);
        let ast = parse_one(&toks)
            .unwrap_or_else(|e| panic!("failed to parse expected.lino entry {}: {}", link_str, e));
        let children = match ast {
            Node::List(c) => c,
            Node::Leaf(_) => panic!("expected list at top of {}", link_str),
        };
        let mut iter = children.into_iter();
        let head = iter
            .next()
            .unwrap_or_else(|| panic!("empty link in expected.lino: {}", link_str));
        let filename = match head {
            Node::Leaf(s) if s.ends_with(':') => s[..s.len() - 1].to_string(),
            other => panic!(
                "expected.lino: first token of {} must be `<filename>:`, got {:?}",
                link_str, other
            ),
        };
        let mut values = Vec::new();
        for node in iter {
            match node {
                Node::Leaf(s) if is_num(&s) => {
                    values.push(ExpectedValue::Num(s.parse::<f64>().unwrap_or_else(|_| {
                        panic!("expected.lino: bad number {} in {}", s, filename)
                    })));
                }
                Node::List(ref children) if children.len() == 2 => {
                    if let Node::Leaf(k) = &children[0] {
                        if k == "type" {
                            let printed = match &children[1] {
                                Node::Leaf(v) => v.clone(),
                                inner => key_of(inner),
                            };
                            values.push(ExpectedValue::Type(printed));
                            continue;
                        }
                    }
                    panic!(
                        "expected.lino: unsupported result {:?} in {}",
                        node, filename
                    );
                }
                other => panic!(
                    "expected.lino: unsupported result {:?} in {}",
                    other, filename
                ),
            }
        }
        out.push((filename, values));
    }
    out
}

#[test]
fn every_corpus_file_is_in_expected_lino() {
    let on_disk = list_lino_files(&corpus_dir());
    let expected = load_expected();
    let expected_keys: Vec<String> = expected.iter().map(|(k, _)| k.clone()).collect();
    for file in &on_disk {
        assert!(
            expected_keys.contains(file),
            "{} is missing from test-corpus/expected.lino",
            file
        );
    }
    for key in &expected_keys {
        assert!(
            on_disk.contains(key),
            "test-corpus/expected.lino references missing file {}",
            key
        );
    }
}

#[test]
fn every_corpus_file_runs_and_matches_expected_outputs() {
    let expected = load_expected();
    let dir = corpus_dir();
    let mut failures: Vec<String> = Vec::new();

    for (file, expected_results) in &expected {
        let path = dir.join(file);
        let actual = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());

        if !actual.diagnostics.is_empty() {
            failures.push(format!("{} diagnostics: {:?}", file, actual.diagnostics));
            continue;
        }

        if actual.results.len() != expected_results.len() {
            failures.push(format!(
                "{}: expected {} results, got {}",
                file,
                expected_results.len(),
                actual.results.len()
            ));
            continue;
        }

        for (i, (got, exp)) in actual.results.iter().zip(expected_results.iter()).enumerate() {
            match (got, exp) {
                (RunResult::Num(n), ExpectedValue::Num(en)) => {
                    if (n - en).abs() >= 1e-9 {
                        failures.push(format!(
                            "{}[{}]: expected {}, got {} (diff {})",
                            file,
                            i,
                            en,
                            n,
                            (n - en).abs()
                        ));
                    }
                }
                (RunResult::Type(s), ExpectedValue::Type(es)) => {
                    if s != es {
                        failures.push(format!(
                            "{}[{}]: expected structured {:?}, got {:?}",
                            file, i, es, s
                        ));
                    }
                }
                (RunResult::Num(n), ExpectedValue::Type(es)) => failures.push(format!(
                    "{}[{}]: expected structured {:?}, got numeric {}",
                    file, i, es, n
                )),
                (RunResult::Type(s), ExpectedValue::Num(en)) => failures.push(format!(
                    "{}[{}]: expected numeric {}, got structured {:?}",
                    file, i, en, s
                )),
                (RunResult::Foundation(report), _) => failures.push(format!(
                    "{}[{}]: unexpected foundation report for {}",
                    file, i, report.active_foundation
                )),
                (RunResult::Proof(report), _) => failures.push(format!(
                    "{}[{}]: unexpected proof report for {}",
                    file, i, report.name
                )),
            }
        }
    }

    assert!(
        failures.is_empty(),
        "shared corpus mismatches:\n  {}",
        failures.join("\n  ")
    );
}
