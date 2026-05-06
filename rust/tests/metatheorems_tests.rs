// Tests for the C3 metatheorem checker (issue #47).
// The checker composes D12 totality, D14 coverage, D15 modes, and D13
// termination into a single Twelf-style guarantee that a relation is
// total on its declared input domain. These cases mirror the JS suite in
// js/tests/metatheorems.test.mjs to keep the two runtimes in lock-step.

use rml::meta::{check_metatheorems, format_report, CheckKind};

const NATURAL_DECL: &str = "(inductive Natural\n\
                            (constructor zero)\n\
                            (constructor (succ (Pi (Natural n) Natural))))\n";

const LIST_DECL: &str = "(A: (Type 0) A)\n\
                         (inductive List\n\
                         (constructor nil)\n\
                         (constructor (cons (Pi (A x) (Pi (List xs) List)))))\n";

const BOOLEAN_DECL: &str = "(inductive Boolean\n\
                            (constructor true)\n\
                            (constructor false))\n";

#[test]
fn certifies_plus_on_natural_as_total_and_covered() {
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
    assert_eq!(report.relations.len(), 1);
    let plus = &report.relations[0];
    assert_eq!(plus.name, "plus");
    assert!(plus.ok);
    let mut kinds: Vec<&str> = plus.checks.iter().map(|c| c.kind.as_str()).collect();
    kinds.sort();
    assert_eq!(kinds, vec!["coverage", "totality"]);
}

#[test]
fn certifies_le_on_natural() {
    let program = format!(
        "{}{}{}",
        NATURAL_DECL,
        BOOLEAN_DECL,
        "(mode le +input +input -output)\n\
         (relation le\n\
           (le zero n true)\n\
           (le (succ m) zero false)\n\
           (le (succ m) (succ n) (le m n)))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(report.ok, "report should pass: {}", format_report(&report));
    let le = report
        .relations
        .iter()
        .find(|r| r.name == "le")
        .expect("le should be reported");
    assert!(le.ok);
}

#[test]
fn certifies_append_on_list() {
    let program = format!(
        "{}{}",
        LIST_DECL,
        "(mode append +input +input -output)\n\
         (relation append\n\
           (append nil ys ys)\n\
           (append (cons x xs) ys (cons x (append xs ys))))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(report.ok, "report should pass: {}", format_report(&report));
    let append = report
        .relations
        .iter()
        .find(|r| r.name == "append")
        .expect("append should be reported");
    assert!(append.ok);
}

#[test]
fn flags_relation_missing_constructor_case() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode f +input -output)\n\
         (relation f\n\
           (f zero zero))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(!report.ok);
    let f = report
        .relations
        .iter()
        .find(|r| r.name == "f")
        .expect("f should be reported");
    assert!(!f.ok);
    let coverage = f
        .checks
        .iter()
        .find(|c| c.kind == CheckKind::Coverage)
        .expect("coverage check");
    assert!(!coverage.ok);
    assert!(coverage.diagnostics[0].message.contains("missing case"));
    assert!(coverage.diagnostics[0].message.contains("(succ"));
}

#[test]
fn flags_relation_without_structural_decrease() {
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
    let loop_rel = report
        .relations
        .iter()
        .find(|r| r.name == "loop")
        .expect("loop should be reported");
    let totality = loop_rel
        .checks
        .iter()
        .find(|c| c.kind == CheckKind::Totality)
        .expect("totality check");
    assert!(!totality.ok);
    assert!(totality.diagnostics[0]
        .message
        .contains("does not structurally decrease"));
}

#[test]
fn reports_both_checks_when_relation_fails_both() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode bad +input -output)\n\
         (relation bad\n\
           (bad (succ n) (bad (succ n))))\n",
    );
    let report = check_metatheorems(&program, None);
    assert!(!report.ok);
    let bad = report
        .relations
        .iter()
        .find(|r| r.name == "bad")
        .expect("bad should be reported");
    let totality = bad
        .checks
        .iter()
        .find(|c| c.kind == CheckKind::Totality)
        .unwrap();
    let coverage = bad
        .checks
        .iter()
        .find(|c| c.kind == CheckKind::Coverage)
        .unwrap();
    assert!(!totality.ok);
    assert!(!coverage.ok);
}

#[test]
fn certifies_termination_for_definition_form() {
    let report = check_metatheorems(
        "(define plus\n\
           (case (zero n) n)\n\
           (case ((succ m) n) (succ (plus m n))))\n",
        None,
    );
    assert!(report.ok, "report should pass: {}", format_report(&report));
    let plus = report
        .definitions
        .iter()
        .find(|d| d.name == "plus")
        .expect("plus definition");
    assert!(plus.ok);
    assert_eq!(plus.checks[0].kind, CheckKind::Termination);
}

#[test]
fn reports_counter_witness_for_non_terminating_definition() {
    let report = check_metatheorems(
        "(define loop\n\
           (case (zero) zero)\n\
           (case ((succ n)) (loop (succ n))))\n",
        None,
    );
    assert!(!report.ok);
    let loop_def = report
        .definitions
        .iter()
        .find(|d| d.name == "loop")
        .expect("loop definition");
    assert!(!loop_def.ok);
    assert!(loop_def.checks[0].diagnostics[0]
        .message
        .contains("does not structurally decrease"));
}

#[test]
fn format_report_marks_passing_run() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode plus +input +input -output)\n\
         (relation plus\n\
           (plus zero n n)\n\
           (plus (succ m) n (succ (plus m n))))\n",
    );
    let report = check_metatheorems(&program, None);
    let text = format_report(&report);
    assert!(text.contains("OK: plus"), "expected OK line, got:\n{}", text);
    assert!(
        text.contains("All metatheorems hold."),
        "expected pass marker, got:\n{}",
        text,
    );
}

#[test]
fn format_report_marks_failing_run() {
    let program = format!(
        "{}{}",
        NATURAL_DECL,
        "(mode f +input -output)\n\
         (relation f\n\
           (f zero zero))\n",
    );
    let report = check_metatheorems(&program, None);
    let text = format_report(&report);
    assert!(text.contains("FAIL: f"), "expected FAIL line, got:\n{}", text);
    assert!(
        text.contains("One or more metatheorems failed."),
        "expected fail marker, got:\n{}",
        text,
    );
}

#[test]
fn format_report_handles_empty_program() {
    let report = check_metatheorems("", None);
    let text = format_report(&report);
    assert!(
        text.contains("No metatheorem candidates"),
        "expected placeholder line, got:\n{}",
        text,
    );
}
