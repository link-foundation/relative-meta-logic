// Tests for `lib/self/types.lino` (issue #86).
//
// Mirrors the data-shape checks from js/tests/self-types.test.mjs so both
// runtimes keep the encoded type layer importable and parseable.

use rml::{evaluate_file, key_of, parse_lino, parse_one, tokenize_one, EvaluateOptions, Node};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

const REQUIRED_SYNTH_RULES: &[&str] = &[
    "(synth symbol)",
    "(synth numeric-literal)",
    "(synth (Type level))",
    "(synth (Prop))",
    "(synth (Pi binding body))",
    "(synth (forall type-variable body))",
    "(synth (lambda binding body))",
    "(synth (apply function argument))",
    "(synth (subst term variable replacement))",
    "(synth (type of expression))",
    "(synth (expression of expected-type))",
    "(synth recorded-expression)",
];

const REQUIRED_CHECK_RULES: &[&str] = &[
    "(check expression expected-type)",
    "(check numeric-literal expected-type)",
    "(check (lambda (T x) body) (Pi (T x) U))",
    "(check (lambda (domain variable) body) (Pi (expected-domain expected-variable) codomain))",
    "(check (lambda binding body) non-pi-type)",
    "(check expression expected-type by-synthesis)",
];

const REQUIRED_DIAGNOSTICS: &[&str] = &["E020", "E021", "E022", "E023", "E024"];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn types_path() -> PathBuf {
    repo_root().join("lib").join("self").join("types.lino")
}

fn parse_forms() -> Vec<Node> {
    let path = types_path();
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    parse_lino(&text)
        .unwrap_or_else(|e| panic!("{} is not valid LiNo: {}", path.display(), e))
        .into_iter()
        .map(|link| {
            parse_one(&tokenize_one(&link))
                .unwrap_or_else(|e| panic!("failed to parse link {}: {}", link, e))
        })
        .collect()
}

fn rule_patterns(forms: &[Node], kind: &str) -> HashSet<String> {
    let mut patterns = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::List(pattern)) = (&children[0], &children[1]) {
                if head == "rule"
                    && matches!(pattern.first(), Some(Node::Leaf(pattern_head)) if pattern_head == kind)
                {
                    patterns.insert(key_of(&children[1]));
                }
            }
        }
    }
    patterns
}

fn diagnostic_codes(forms: &[Node]) -> HashSet<String> {
    let mut codes = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() < 3 {
            continue;
        }
        let Node::Leaf(rule_head) = &children[0] else {
            continue;
        };
        let Node::List(pattern) = &children[1] else {
            continue;
        };
        if rule_head != "rule"
            || !matches!(pattern.first(), Some(Node::Leaf(pattern_head)) if pattern_head == "diagnostic")
        {
            continue;
        }
        for child in &children[2..] {
            if let Node::List(items) = child {
                if items.len() == 2 {
                    if let (Node::Leaf(head), Node::Leaf(code)) = (&items[0], &items[1]) {
                        if head == "emits" {
                            codes.insert(code.clone());
                        }
                    }
                }
            }
        }
    }
    codes
}

#[test]
fn self_types_is_importable() {
    let path = types_path();
    let out = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
}

#[test]
fn self_types_declares_required_rules() {
    let forms = parse_forms();

    let synth_rules = rule_patterns(&forms, "synth");
    for pattern in REQUIRED_SYNTH_RULES {
        assert!(
            synth_rules.contains(*pattern),
            "missing synth rule {}; got {:?}",
            pattern,
            synth_rules
        );
    }

    let check_rules = rule_patterns(&forms, "check");
    for pattern in REQUIRED_CHECK_RULES {
        assert!(
            check_rules.contains(*pattern),
            "missing check rule {}; got {:?}",
            pattern,
            check_rules
        );
    }

    let diagnostics = diagnostic_codes(&forms);
    for code in REQUIRED_DIAGNOSTICS {
        assert!(
            diagnostics.contains(*code),
            "missing diagnostic {}; got {:?}",
            code,
            diagnostics
        );
    }
}
