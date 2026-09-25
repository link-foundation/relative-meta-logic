// Tests for `lib/self/evaluator.lino` (issue #85).
//
// Mirrors the data-shape checks from js/tests/self-evaluator.test.mjs so both
// runtimes keep the encoded evaluator importable and parseable.

use rml::{evaluate_file, key_of, parse_lino, parse_one, tokenize_one, EvaluateOptions, Node};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const REQUIRED_EVAL_RULES: &[&str] = &[
    "(eval numeric-literal)",
    "(eval symbol)",
    "(eval (range low high))",
    "(eval (range: low high))",
    "(eval (valence levels))",
    "(eval (valence: levels))",
    "(eval (name: name is name))",
    "(eval (name: type-name name))",
    "(eval (name: type-expression name))",
    "(eval (name: type-expression))",
    "(eval (operator: aggregator))",
    "(eval (operator: outer inner))",
    "(eval (name: lambda binding body))",
    "(eval ((expression) has probability number))",
    "(eval (? expression))",
    "(eval (left + right))",
    "(eval (left - right))",
    "(eval (left * right))",
    "(eval (left / right))",
    "(eval (left < right))",
    "(eval (left <= right))",
    "(eval (not value))",
    "(eval (and a b))",
    "(eval (or a b))",
    "(eval (both a b))",
    "(eval (neither a b))",
    "(eval (a and b))",
    "(eval (a or b))",
    "(eval (both a and b))",
    "(eval (neither a nor b))",
    "(eval (= left right))",
    "(eval (!= left right))",
    "(eval (left = right))",
    "(eval (left != right))",
    "(eval (Type level))",
    "(eval (Prop))",
    "(eval (Pi binding body))",
    "(eval (lambda binding body))",
    "(eval (apply function argument))",
    "(eval (subst term variable replacement))",
    "(eval (fresh variable in body))",
    "(eval (whnf expression))",
    "(eval (nf expression))",
    "(eval (normal-form expression))",
    "(eval (type of expression))",
    "(eval (expression of type))",
    "(eval (domain name request))",
    "(eval (root-construct name details))",
    "(eval (foundation name details))",
    "(eval (with-foundation name body))",
    "(eval (foundation-report))",
    "(eval (strict-foundation pure-links))",
    "(eval (allow-host-primitive names))",
    "(eval (assumption name (judgement judgement)))",
    "(eval (axiom name (judgement judgement)))",
    "(eval (proof-object name clauses))",
    "(eval (check-proof name))",
    "(eval (encodeAnum node))",
    "(eval (decodeAnum payload))",
];

const REQUIRED_SURFACE_RULES: &[&str] = &[
    "(foundation-clause (description text))",
    "(foundation-clause (uses name))",
    "(foundation-clause (defines operator implementation))",
    "(foundation-clause (extends name))",
    "(foundation-clause (numeric-domain name))",
    "(foundation-clause (truth-domain name))",
    "(foundation-clause (carrier values))",
    "(foundation-clause strict-carrier)",
    "(foundation-clause (truth-table operator rows))",
    "(foundation-clause experimental)",
    "(foundation-clause (root symbol))",
    "(foundation-clause (abit symbol bits))",
    "(proof-object-clause (premise judgement))",
    "(proof-object-clause (premise-by name))",
    "(proof-object-clause (uses names))",
    "(equality-provenance left right)",
];

const REQUIRED_OPERATORS: &[&str] = &[
    "not", "and", "or", "both", "neither", "=", "!=", "+", "-", "*", "/", "<", "<=",
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn evaluator_path() -> PathBuf {
    repo_root().join("lib").join("self").join("evaluator.lino")
}

fn self_corpus_dir() -> PathBuf {
    repo_root().join("test-corpus")
}

fn parse_forms(path: &Path) -> Vec<Node> {
    let text = fs::read_to_string(path)
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

fn eval_rule_patterns(forms: &[Node]) -> HashSet<String> {
    let mut patterns = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::List(pattern)) = (&children[0], &children[1]) {
                if head == "rule"
                    && matches!(pattern.first(), Some(Node::Leaf(eval)) if eval == "eval")
                {
                    patterns.insert(key_of(&children[1]));
                }
            }
        }
    }
    patterns
}

fn rule_patterns(forms: &[Node]) -> HashSet<String> {
    let mut patterns = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let Node::Leaf(head) = &children[0] {
                if head == "rule" {
                    patterns.insert(key_of(&children[1]));
                }
            }
        }
    }
    patterns
}

fn built_in_operators(forms: &[Node]) -> HashSet<String> {
    let mut operators = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::Leaf(operator)) = (&children[0], &children[1]) {
                if head == "built-in-operator" {
                    operators.insert(operator.clone());
                }
            }
        }
    }
    operators
}

fn lino_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("could not read {}: {}", dir.display(), e))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("lino"))
        .filter(|path| path.file_name().and_then(|s| s.to_str()) != Some("expected.lino"))
        .collect();
    files.sort();
    files
}

#[test]
fn self_evaluator_is_importable() {
    let path = evaluator_path();
    let out = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
}

#[test]
fn self_evaluator_declares_required_builtin_rules() {
    let forms = parse_forms(&evaluator_path());
    let patterns = eval_rule_patterns(&forms);
    for pattern in REQUIRED_EVAL_RULES {
        assert!(
            patterns.contains(*pattern),
            "missing rule {}; got {:?}",
            pattern,
            patterns
        );
    }

    let operators = built_in_operators(&forms);
    for operator in REQUIRED_OPERATORS {
        assert!(
            operators.contains(*operator),
            "missing operator {}",
            operator
        );
    }
}

#[test]
fn self_evaluator_declares_phase_2_9_surface_rules() {
    let forms = parse_forms(&evaluator_path());
    let patterns = rule_patterns(&forms);
    for pattern in REQUIRED_SURFACE_RULES {
        assert!(
            patterns.contains(*pattern),
            "missing surface rule {}; got {:?}",
            pattern,
            patterns
        );
    }
}

#[test]
fn self_evaluator_corpus_is_host_parseable() {
    for path in lino_files(&self_corpus_dir()) {
        let out = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());
        assert!(
            out.diagnostics.is_empty(),
            "{} diagnostics: {:?}",
            path.display(),
            out.diagnostics
        );
    }
}
