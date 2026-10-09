// Tests for `lib/self/metatheorem.lino` (issue #88).
//
// Mirrors js/tests/self-metatheorem.test.mjs so both runtimes keep the
// encoded metatheorem checker importable and tied to host checker behavior.

use rml::{evaluate_file, key_of, parse_lino, parse_one, tokenize_one, EvaluateOptions, Node};
use rml::meta::{check_metatheorems, format_report, CheckKind};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

const REQUIRED_RULES: &[&str] = &[
    "(mode name flags)",
    "(inductive type-name constructors)",
    "(relation name clauses)",
    "(define name cases)",
    "(totality-check name env)",
    "(coverage-check name env)",
    "(termination-check name env)",
    "(check-metatheorems program)",
    "(check-relation env name)",
    "(check-definition env name)",
    "(format-report report)",
];

const REQUIRED_DIAGNOSTICS: &[&str] = &["E030", "E031", "E032", "E035", "E037"];

const REQUIRED_CHECK_KINDS: &[&str] = &["totality", "coverage", "termination"];

const NATURAL_DECL: &str = "(inductive Natural\n\
                            (constructor zero)\n\
                            (constructor (succ (Pi (Natural n) Natural))))\n";

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn metatheorem_path() -> PathBuf {
    repo_root().join("lib").join("self").join("metatheorem.lino")
}

fn parse_forms() -> Vec<Node> {
    let path = metatheorem_path();
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

fn rule_subjects(forms: &[Node]) -> HashSet<String> {
    let mut subjects = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::List(_)) = (&children[0], &children[1]) {
                if head == "rule" {
                    subjects.insert(key_of(&children[1]));
                }
            }
        }
    }
    subjects
}

fn diagnostic_codes(forms: &[Node]) -> HashSet<String> {
    let mut codes = HashSet::new();
    for form in forms {
        collect_emits_codes(form, &mut codes);
    }
    codes
}

fn collect_emits_codes(node: &Node, codes: &mut HashSet<String>) {
    let Node::List(children) = node else {
        return;
    };
    if children.len() >= 2 {
        if let (Node::Leaf(head), Node::Leaf(code)) = (&children[0], &children[1]) {
            if head == "emits" {
                codes.insert(code.clone());
            }
        }
    }
    for child in children {
        collect_emits_codes(child, codes);
    }
}

fn check_kinds(forms: &[Node]) -> HashSet<String> {
    let mut kinds = HashSet::new();
    for form in forms {
        let Node::List(children) = form else {
            continue;
        };
        if children.len() >= 2 {
            if let (Node::Leaf(head), Node::Leaf(kind)) = (&children[0], &children[1]) {
                if head == "check-kind" {
                    kinds.insert(kind.clone());
                }
            }
        }
    }
    kinds
}

#[test]
fn self_metatheorem_is_importable() {
    let path = metatheorem_path();
    let out = evaluate_file(path.to_str().unwrap(), EvaluateOptions::default());
    assert!(
        out.diagnostics.is_empty(),
        "unexpected diagnostics: {:?}",
        out.diagnostics
    );
}

#[test]
fn self_metatheorem_declares_required_rules() {
    let forms = parse_forms();
    let subjects = rule_subjects(&forms);
    for rule in REQUIRED_RULES {
        assert!(
            subjects.contains(*rule),
            "missing encoded rule {}",
            rule
        );
    }
}

#[test]
fn self_metatheorem_encodes_required_diagnostics() {
    let forms = parse_forms();
    let codes = diagnostic_codes(&forms);
    for code in REQUIRED_DIAGNOSTICS {
        assert!(codes.contains(*code), "missing diagnostic code {}", code);
    }
}

#[test]
fn self_metatheorem_declares_check_kinds() {
    let forms = parse_forms();
    let kinds = check_kinds(&forms);
    for kind in REQUIRED_CHECK_KINDS {
        assert!(
            kinds.contains(*kind),
            "missing check-kind declaration for {}",
            kind
        );
    }
}

#[test]
fn self_metatheorem_declares_master_entity() {
    let forms = parse_forms();
    let entity_decl = forms.iter().find(|form| {
        let Node::List(children) = form else {
            return false;
        };
        if children.len() < 3 {
            return false;
        }
        matches!((&children[0], &children[1], &children[2]),
            (Node::Leaf(head), Node::Leaf(name), Node::Leaf(verb))
            if head == "metatheorem-checker"
                && name == "rml-metatheorem-checker"
                && verb == "matches")
    });
    assert!(entity_decl.is_some(), "missing metatheorem-checker entity declaration");
    let Node::List(children) = entity_decl.unwrap() else {
        panic!("entity decl is not a list");
    };
    let Node::Leaf(system) = &children[3] else {
        panic!("entity decl system is not a leaf");
    };
    assert!(
        system.starts_with("relative-meta-logic"),
        "entity declaration must name relative-meta-logic, got {}",
        system
    );
}

#[test]
fn self_metatheorem_declares_presentation_rule() {
    let forms = parse_forms();
    let presentation = forms.iter().find(|form| {
        let Node::List(children) = form else {
            return false;
        };
        if children.len() < 2 {
            return false;
        }
        if let (Node::Leaf(head), Node::List(pattern)) = (&children[0], &children[1]) {
            if head == "rule" {
                if let Some(Node::Leaf(p0)) = pattern.first() {
                    return p0 == "host-metatheorem-checker-presentation";
                }
            }
        }
        false
    });
    assert!(
        presentation.is_some(),
        "missing host-metatheorem-checker-presentation rule"
    );
}

// Verify the encoded surface stays consistent with the host checker by
// running the same pass/fail cases through the host check_metatheorems API.

#[test]
fn host_certifies_plus_as_total_and_covered() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode plus +input +input -output)\n\
         (relation plus\n\
           (plus zero n n)\n\
           (plus (succ m) n (succ (plus m n))))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(report.ok, "report should pass: {}", format_report(&report));
    let plus = report.relations.iter().find(|r| r.name == "plus").expect("plus");
    assert!(plus.ok);
    let mut kinds: Vec<&str> = plus.checks.iter().map(|c| c.kind.as_str()).collect();
    kinds.sort();
    assert_eq!(kinds, vec!["coverage", "totality"]);
}

#[test]
fn host_flags_missing_constructor_case_with_e037() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode f +input -output)\n\
         (relation f\n\
           (f zero zero))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(!report.ok);
    let f = report.relations.iter().find(|r| r.name == "f").expect("f");
    let coverage = f.checks.iter().find(|c| c.kind == CheckKind::Coverage).expect("coverage");
    assert!(!coverage.ok);
    assert!(coverage.diagnostics[0].message.contains("missing case"));
}

#[test]
fn host_flags_non_structural_recursion_with_e032() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode loop +input -output)\n\
         (relation loop\n\
           (loop zero zero)\n\
           (loop (succ n) (loop (succ n))))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(!report.ok);
    let loop_rel = report.relations.iter().find(|r| r.name == "loop").expect("loop");
    let totality = loop_rel.checks.iter().find(|c| c.kind == CheckKind::Totality).expect("totality");
    assert!(!totality.ok);
    assert!(totality.diagnostics[0].message.contains("does not structurally decrease"));
}

#[test]
fn host_certifies_terminating_definition() {
    let report = check_metatheorems(
        "(define plus\n\
           (case (zero n) n)\n\
           (case ((succ m) n) (succ (plus m n))))\n",
        None,
    );
    assert!(report.ok, "report should pass: {}", format_report(&report));
    let plus = report.definitions.iter().find(|d| d.name == "plus").expect("plus def");
    assert!(plus.ok);
    assert_eq!(plus.checks[0].kind, CheckKind::Termination);
}

#[test]
fn host_flags_non_terminating_definition_with_e035() {
    let report = check_metatheorems(
        "(define loop\n\
           (case (zero) zero)\n\
           (case ((succ n)) (loop (succ n))))\n",
        None,
    );
    assert!(!report.ok);
    let loop_def = report.definitions.iter().find(|d| d.name == "loop").expect("loop def");
    assert!(!loop_def.ok);
    assert!(loop_def.checks[0].diagnostics[0].message.contains("does not structurally decrease"));
}
