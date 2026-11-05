// Repository-wide runtime parity. Mirrors scripts/runtime-parity.test.mjs.
//
// test-corpus/runtime-parity/observations.json records what the JavaScript
// command line prints (exit status, stdout and stderr) for every repository
// RML source in five modes: plain evaluation, `--trace`, `extract js`,
// `extract rust` and `export rocq`. These tests run the Rust `rml` binary
// over the same sources and modes and require byte-identical results, so
// both runtimes are held to the one recorded behaviour.

use rml::certified_translation::sha256_hex;
use rml::evaluate;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const PARITY_SCHEMA: &str = "rml-runtime-parity/v1";
const PARITY_ROOTS: &[&str] = &["examples", "experiments", "lib", "test-corpus"];
const EXCLUDED_DIRECTORIES: &[&str] = &["test-corpus/certified-translation"];
const ROOT_TOKEN: &str = "<root>";
const MODES: &[(&str, &[&str])] = &[
    ("run", &[]),
    ("trace", &["--trace"]),
    ("extract-js", &["extract", "js"]),
    ("extract-rust", &["extract", "rust"]),
    ("export-rocq", &["export", "rocq"]),
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repository root")
        .to_path_buf()
}

fn record() -> Value {
    let path = repo_root().join("test-corpus/runtime-parity/observations.json");
    serde_json::from_str(&fs::read_to_string(&path).expect("read parity record"))
        .expect("parse parity record")
}

fn walk(root: &Path, directory: &str, inputs: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(root.join(directory)) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = format!("{directory}/{name}");
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if !EXCLUDED_DIRECTORIES.contains(&path.as_str()) {
                walk(root, &path, inputs);
            }
        } else if kind.is_file() && name.ends_with(".lino") && name != "expected.lino" {
            inputs.push(path);
        }
    }
}

/// Every repository RML source the parity record covers (scripts/runtime-parity.mjs `parityInputs`).
fn parity_inputs(root: &Path) -> Vec<String> {
    let mut inputs = Vec::new();
    for directory in PARITY_ROOTS {
        walk(root, directory, &mut inputs);
    }
    inputs.sort();
    inputs
}

fn mode_args(mode: &str) -> &'static [&'static str] {
    MODES
        .iter()
        .find(|(id, _)| *id == mode)
        .map(|(_, args)| *args)
        .unwrap_or_else(|| panic!("unknown parity mode {mode}"))
}

fn normalize(bytes: &[u8], root: &Path) -> String {
    String::from_utf8_lossy(bytes)
        .replace("\r\n", "\n")
        .replace(&*root.to_string_lossy(), ROOT_TOKEN)
}

struct Observation {
    status: Value,
    stdout: String,
    stderr: String,
}

fn observe_rust(input: &str, mode: &str, root: &Path) -> Observation {
    let output = Command::new(env!("CARGO_BIN_EXE_rml"))
        .args(mode_args(mode))
        .arg(input)
        .current_dir(root)
        .output()
        .expect("run the rml binary");
    let status = match output.status.code() {
        Some(code) => json!(code),
        None => json!("signal"),
    };
    Observation {
        status,
        stdout: normalize(&output.stdout, root),
        stderr: normalize(&output.stderr, root),
    }
}

fn first_difference(expected: &[char], actual: &[char]) -> usize {
    expected
        .iter()
        .zip(actual.iter())
        .take_while(|(left, right)| left == right)
        .count()
}

fn describe_stream(name: &str, expected: &Value, actual: &str) -> String {
    match expected["text"].as_str() {
        Some(text) => {
            let expected_chars: Vec<char> = text.chars().collect();
            let actual_chars: Vec<char> = actual.chars().collect();
            let at = first_difference(&expected_chars, &actual_chars);
            let window =
                |chars: &[char]| -> String { chars.iter().skip(at).take(160).collect::<String>() };
            format!(
                "{name} differs at character {at}: expected {:?}, got {:?}",
                window(&expected_chars),
                window(&actual_chars)
            )
        }
        None => format!(
            "{name} differs: expected {} bytes with sha256 {}, got {} bytes with sha256 {}",
            expected["bytes"],
            expected["sha256"].as_str().unwrap_or(""),
            actual.len(),
            sha256_hex(actual.as_bytes())
        ),
    }
}

/// Problems between one recorded observation and one live Rust observation.
fn compare_observation(expected: &Value, actual: &Observation) -> Vec<String> {
    let mut problems = Vec::new();
    if expected["status"] != actual.status {
        problems.push(format!(
            "exit status differs: expected {}, got {}",
            expected["status"], actual.status
        ));
    }
    for (name, text) in [("stdout", &actual.stdout), ("stderr", &actual.stderr)] {
        let recorded = &expected[name];
        if recorded["sha256"].as_str() != Some(sha256_hex(text.as_bytes()).as_str()) {
            problems.push(describe_stream(name, recorded, text));
        }
    }
    problems
}

fn observation<'a>(record: &'a Value, input: &str, mode: &str) -> &'a Value {
    record["observations"]
        .as_array()
        .expect("observations")
        .iter()
        .find(|item| item["input"] == input && item["mode"] == mode)
        .unwrap_or_else(|| panic!("no observation for {input} [{mode}]"))
}

fn parity_input(name: &str) -> String {
    format!("test-corpus/runtime-parity/inputs/{name}.lino")
}

#[test]
fn parity_record_covers_every_repository_source_in_every_mode() {
    let root = repo_root();
    let record = record();
    assert_eq!(record["schema"], PARITY_SCHEMA);
    let inputs = parity_inputs(&root);
    let recorded: Vec<String> = record["inputs"]
        .as_array()
        .expect("inputs")
        .iter()
        .map(|item| item["path"].as_str().expect("path").to_string())
        .collect();
    assert_eq!(recorded, inputs, "the record lists every parity source");
    for item in record["inputs"].as_array().expect("inputs") {
        let path = item["path"].as_str().expect("path");
        let text = fs::read_to_string(root.join(path)).expect("read parity source");
        assert_eq!(
            item["sha256"].as_str(),
            Some(sha256_hex(text.as_bytes()).as_str()),
            "{path} changed since it was recorded; run node scripts/runtime-parity.mjs --write"
        );
    }
    let modes: Vec<(String, Vec<String>)> = record["modes"]
        .as_array()
        .expect("modes")
        .iter()
        .map(|mode| {
            let args = mode["args"]
                .as_array()
                .expect("args")
                .iter()
                .map(|arg| arg.as_str().expect("arg").to_string())
                .collect();
            (mode["id"].as_str().expect("id").to_string(), args)
        })
        .collect();
    let expected_modes: Vec<(String, Vec<String>)> = MODES
        .iter()
        .map(|(id, args)| {
            (
                id.to_string(),
                args.iter().map(|arg| arg.to_string()).collect(),
            )
        })
        .collect();
    assert_eq!(modes, expected_modes);
    let observations = record["observations"].as_array().expect("observations");
    assert_eq!(observations.len(), inputs.len() * MODES.len());
    for input in &inputs {
        for (mode, _) in MODES {
            let count = observations
                .iter()
                .filter(|item| item["input"] == input.as_str() && item["mode"] == *mode)
                .count();
            assert_eq!(count, 1, "{input} [{mode}] is recorded exactly once");
        }
    }
    let inline_limit = record["inlineLimit"].as_u64().expect("inline limit");
    for item in observations {
        for name in ["stdout", "stderr"] {
            let stream = &item[name];
            let bytes = stream["bytes"].as_u64().expect("bytes");
            match stream["text"].as_str() {
                Some(text) => {
                    assert!(bytes <= inline_limit);
                    assert_eq!(
                        stream["sha256"].as_str(),
                        Some(sha256_hex(text.as_bytes()).as_str())
                    );
                }
                None => assert!(bytes > inline_limit),
            }
        }
    }
    let json = serde_json::to_string(&record).expect("serialize record");
    assert!(
        !json.contains(&*root.to_string_lossy()),
        "the record carries no machine path"
    );
    assert!(inputs
        .iter()
        .any(|path| path.starts_with("test-corpus/runtime-parity/inputs/")));
    assert!(inputs
        .iter()
        .any(|path| path.starts_with("lib/meta-theory/")));
}

#[test]
fn rust_command_line_prints_the_recorded_javascript_observations() {
    let root = repo_root();
    let record = record();
    let observations: Vec<Value> = record["observations"]
        .as_array()
        .expect("observations")
        .clone();
    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2)
        .clamp(1, 8);
    let chunk = observations.len().div_ceil(workers).max(1);
    let mut problems: Vec<String> = std::thread::scope(|scope| {
        let handles: Vec<_> = observations
            .chunks(chunk)
            .map(|items| {
                let root = root.clone();
                scope.spawn(move || {
                    let mut found = Vec::new();
                    for expected in items {
                        let input = expected["input"].as_str().expect("input");
                        let mode = expected["mode"].as_str().expect("mode");
                        let actual = observe_rust(input, mode, &root);
                        for problem in compare_observation(expected, &actual) {
                            found.push(format!("{input} [{mode}]: {problem}"));
                        }
                    }
                    found
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("parity worker"))
            .collect()
    });
    problems.sort();
    assert!(
        problems.is_empty(),
        "Rust diverges from the recorded JavaScript behaviour in {} observation(s):\n{}",
        problems.len(),
        problems
            .iter()
            .take(60)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn parity_comparison_rejects_drifted_rust_output() {
    let record = record();
    let expected = observation(&record, &parity_input("eval-nat-terms"), "run");
    let exact = Observation {
        status: expected["status"].clone(),
        stdout: expected["stdout"]["text"]
            .as_str()
            .expect("inline stdout")
            .to_string(),
        stderr: expected["stderr"]["text"]
            .as_str()
            .expect("inline stderr")
            .to_string(),
    };
    assert!(compare_observation(expected, &exact).is_empty());
    let status = Observation {
        status: json!(1),
        ..exact_copy(&exact)
    };
    assert!(compare_observation(expected, &status)[0]
        .starts_with("exit status differs: expected 0, got 1"));
    let stdout = Observation {
        stdout: "0\n1\n2\n3\n".to_string(),
        ..exact_copy(&exact)
    };
    let problems = compare_observation(expected, &stdout);
    assert_eq!(problems.len(), 1);
    assert!(
        problems[0].starts_with("stdout differs at character 6:"),
        "{}",
        problems[0]
    );
    let stderr = Observation {
        stderr: "injected\n".to_string(),
        ..exact_copy(&exact)
    };
    assert!(compare_observation(expected, &stderr)[0].starts_with("stderr differs at character 0:"));
    let long = record["observations"]
        .as_array()
        .expect("observations")
        .iter()
        .find(|item| item["stderr"]["text"].is_null())
        .expect("a digest-only stream");
    let drifted = Observation {
        status: long["status"].clone(),
        stdout: long["stdout"]["text"].as_str().unwrap_or("").to_string(),
        stderr: "drifted".to_string(),
    };
    assert!(compare_observation(long, &drifted)
        .iter()
        .any(|problem| problem.starts_with("stderr differs: expected ")
            && problem.contains("bytes with sha256")));
}

fn exact_copy(observation: &Observation) -> Observation {
    Observation {
        status: observation.status.clone(),
        stdout: observation.stdout.clone(),
        stderr: observation.stderr.clone(),
    }
}

#[test]
fn rust_runtime_reports_the_divergences_the_comparison_found_as_javascript_does() {
    let root = repo_root();
    let shape = observe_rust(&parity_input("e003-bad-operator-shape"), "run", &root);
    assert_eq!(shape.status, json!(1));
    assert!(
        shape
            .stderr
            .contains(": E003: Unsupported operator definition for \"=\"\n"),
        "{}",
        shape.stderr
    );
    let alias = observe_rust(&parity_input("e003-alias-of-unknown"), "run", &root);
    assert!(
        alias
            .stderr
            .contains(": E003: Unsupported operator definition for \"not\"\n"),
        "{}",
        alias.stderr
    );
    let import = observe_rust(&parity_input("e007-missing-import"), "run", &root);
    assert!(
        import
            .stderr
            .contains("Failed to read import \"does-not-exist.lino\": file not found\n"),
        "{}",
        import.stderr
    );
    for (name, text) in [
        (
            "e030-bad-mode",
            ": E030: Mode declaration for \"plus\": unknown flag",
        ),
        (
            "e032-bad-relation",
            ": E032: Relation declaration for \"plus\" must list",
        ),
        (
            "e033-bad-inductive",
            ": E033: Inductive declaration for \"nat\": type name",
        ),
        (
            "e036-unproductive",
            ": E036: Coinductive declaration for \"Stream\" is non-productive",
        ),
    ] {
        let run = observe_rust(&parity_input(name), "run", &root);
        assert!(run.stderr.contains(text), "{name}: {}", run.stderr);
    }
    let rocq = observe_rust(&parity_input("e033-bad-inductive"), "export-rocq", &root);
    assert_eq!(rocq.status, json!(1));
    assert_eq!(
        rocq.stderr,
        "Rocq export error: Inductive declaration for \"nat\": type name must start with an uppercase letter\n"
    );
    let layers = observe_rust(&parity_input("equality-layers"), "trace", &root);
    let found: Vec<String> = layers
        .stderr
        .lines()
        .filter(|line| line.contains("] equality-layer "))
        .map(|line| {
            let line_number = line.split(':').nth(1).unwrap_or("");
            format!("{line_number} {}", line.rsplit(' ').next().unwrap_or(""))
        })
        .collect();
    assert_eq!(
        found,
        vec![
            "3 definitional-equality",
            "4 definitional-equality",
            "5 numeric-equality",
            "6 definitional-equality",
            "7 numeric-inequality",
            "8 structural-equality",
            "9 numeric-equality",
        ]
    );
    let named = evaluate(
        "(identity: lambda (Natural x) x)\n(? ((apply identity 0.42) = 0.42))",
        None,
        None,
    );
    assert!(named.diagnostics.is_empty());
    assert_eq!(
        named.provenance,
        vec![Some("definitional-equality".to_string())]
    );
}
