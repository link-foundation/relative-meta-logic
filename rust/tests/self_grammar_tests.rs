// Tests for `lib/self/grammar.lino` (issue #84).
//
// Mirrors js/tests/self-grammar.test.mjs so the self-bootstrap grammar data
// stays parseable and tied to the shared example corpus in both runtimes.

use rml::{evaluate_file, parse_lino, parse_one, tokenize_one, EvaluateOptions, Node};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const REQUIRED_RULES: &[&str] = &[
    "document",
    "source-for-evaluation",
    "links",
    "first-line",
    "line",
    "element",
    "any-link",
    "parenthesized-link",
    "id-link",
    "value-link",
    "indented-id-link",
    "reference",
    "simple-reference",
    "quoted-reference",
    "whitespace",
    "end-of-line",
    "host-parser-presentation",
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn grammar_path() -> PathBuf {
    repo_root().join("lib").join("self").join("grammar.lino")
}

fn examples_dir() -> PathBuf {
    repo_root().join("examples")
}

fn grammar_forms() -> Vec<Node> {
    let path = grammar_path();
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
    parse_lino(&text)
        .unwrap_or_else(|e| panic!("{} is not valid LiNo: {}", path.display(), e))
        .into_iter()
        .map(|link| {
            parse_one(&tokenize_one(&link))
                .unwrap_or_else(|e| panic!("failed to parse grammar link {}: {}", link, e))
        })
        .collect()
}

fn rule_names(forms: &[Node]) -> HashSet<String> {
    let mut names = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::Leaf(name)) = (&children[0], &children[1]) {
                if head == "rule" {
                    names.insert(name.clone());
                }
            }
        }
    }
    names
}

fn inline_comment_index(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut last_close = None;
    for (i, byte) in bytes.iter().enumerate() {
        match *byte {
            b')' => last_close = Some(i),
            b'#' => {
                if let Some(close_idx) = last_close {
                    let between = &line[close_idx + 1..i];
                    if !between.is_empty() && between.chars().all(|c| c == ' ' || c == '\t') {
                        return Some(i);
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn strip_rml_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| {
            if line.trim_start().starts_with('#') {
                String::new()
            } else if let Some(idx) = inline_comment_index(line) {
                line[..idx].trim_end().to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

struct SelfParser {
    chars: Vec<char>,
    index: usize,
}

impl SelfParser {
    fn new(source: &str) -> Self {
        Self {
            chars: strip_rml_comments(source).chars().collect(),
            index: 0,
        }
    }

    fn skip_whitespace(&mut self) {
        while self.index < self.chars.len() && self.chars[self.index].is_whitespace() {
            self.index += 1;
        }
    }

    fn parse_atom(&mut self) -> Node {
        let start = self.index;
        while self.index < self.chars.len()
            && !self.chars[self.index].is_whitespace()
            && self.chars[self.index] != '('
            && self.chars[self.index] != ')'
        {
            self.index += 1;
        }
        assert!(start != self.index, "expected reference at char {}", self.index);
        Node::Leaf(self.chars[start..self.index].iter().collect())
    }

    fn parse_list(&mut self) -> Node {
        assert_eq!(
            self.chars.get(self.index),
            Some(&'('),
            "expected `(` at char {}",
            self.index
        );
        self.index += 1;
        let mut children = Vec::new();
        loop {
            self.skip_whitespace();
            assert!(self.index < self.chars.len(), "expected `)` at end of input");
            if self.chars[self.index] == ')' {
                self.index += 1;
                return Node::List(children);
            }
            if self.chars[self.index] == '(' {
                children.push(self.parse_list());
            } else {
                children.push(self.parse_atom());
            }
        }
    }

    fn parse_forms(&mut self) -> Vec<Node> {
        let mut forms = Vec::new();
        loop {
            self.skip_whitespace();
            if self.index >= self.chars.len() {
                return forms;
            }
            forms.push(self.parse_list());
        }
    }
}

fn parse_self_presentation(source: &str, rules: &HashSet<String>) -> Vec<Node> {
    assert!(rules.contains("host-parser-presentation"));
    assert!(rules.contains("parenthesized-link"));
    assert!(rules.contains("simple-reference"));
    SelfParser::new(source).parse_forms()
}

fn host_ast(source: &str) -> Vec<Node> {
    parse_lino(source)
        .unwrap_or_else(|e| panic!("host source is not valid LiNo: {}", e))
        .into_iter()
        .map(|link| {
            parse_one(&tokenize_one(&link))
                .unwrap_or_else(|e| panic!("failed to parse host link {}: {}", link, e))
        })
        .collect()
}

fn lino_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("could not read {}: {}", dir.display(), e))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("lino"))
        .collect();
    files.sort();
    files
}

#[test]
fn self_grammar_is_importable() {
    let path = grammar_path();
    let out = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);
}

#[test]
fn self_grammar_declares_required_rules() {
    let rules = rule_names(&grammar_forms());
    for name in REQUIRED_RULES {
        assert!(rules.contains(*name), "missing rule {}", name);
    }
}

#[test]
fn self_grammar_parses_examples_like_host_parser() {
    let rules = rule_names(&grammar_forms());
    for path in lino_files(&examples_dir()) {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("could not read {}: {}", path.display(), e));
        assert_eq!(
            parse_self_presentation(&source, &rules),
            host_ast(&source),
            "AST mismatch for {}",
            path.display()
        );
    }
}
