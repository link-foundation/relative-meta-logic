// rml-meta — metatheorem checker over encoded systems (issue #47, C3).
//
// Composes the existing D12 totality, D14 coverage, D15 modes, and D13
// termination checkers into a single Twelf-style guarantee: a relation is
// total on its declared input domain iff every input pattern is covered
// and every recursive call structurally decreases on a `+input` slot.
//
// Used as a library from `check_metatheorems(text, file)` and as a CLI via
// the `rml-meta` binary in `src/bin/rml-meta.rs`.

use crate::{
    evaluate_with_env, format_diagnostic, is_covered, is_terminating, is_total,
    CoverageDiagnostic, Diagnostic, Env, TerminationDiagnostic, TotalityDiagnostic,
};

/// Generic per-check diagnostic produced by the metatheorem checker. We
/// flatten the per-checker diagnostic types ([`TotalityDiagnostic`] etc.)
/// into a single shape so the report consumer does not have to know which
/// underlying checker emitted the message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaDiagnostic {
    pub code: String,
    pub message: String,
}

impl From<TotalityDiagnostic> for MetaDiagnostic {
    fn from(d: TotalityDiagnostic) -> Self {
        MetaDiagnostic {
            code: d.code,
            message: d.message,
        }
    }
}

impl From<CoverageDiagnostic> for MetaDiagnostic {
    fn from(d: CoverageDiagnostic) -> Self {
        MetaDiagnostic {
            code: d.code,
            message: d.message,
        }
    }
}

impl From<TerminationDiagnostic> for MetaDiagnostic {
    fn from(d: TerminationDiagnostic) -> Self {
        MetaDiagnostic {
            code: d.code,
            message: d.message,
        }
    }
}

/// Which checker produced this entry. `Totality` and `Coverage` are
/// reported per relation; `Termination` is reported per definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckKind {
    Totality,
    Coverage,
    Termination,
}

impl CheckKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CheckKind::Totality => "totality",
            CheckKind::Coverage => "coverage",
            CheckKind::Termination => "termination",
        }
    }
}

/// One entry in a [`MetatheoremResult`]: which sub-check ran, whether it
/// passed, and which diagnostics it emitted on failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetatheoremCheck {
    pub kind: CheckKind,
    pub ok: bool,
    pub diagnostics: Vec<MetaDiagnostic>,
}

/// Per-relation (or per-definition) outcome — combines every sub-check
/// run for that name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetatheoremResult {
    pub name: String,
    pub ok: bool,
    pub checks: Vec<MetatheoremCheck>,
}

/// Top-level structured report returned by [`check_metatheorems`]. The
/// CLI uses [`format_report`] to render it; library consumers can read
/// the structured fields directly.
#[derive(Debug, Clone, PartialEq)]
pub struct MetatheoremReport {
    pub ok: bool,
    pub evaluation_diagnostics: Vec<Diagnostic>,
    pub relations: Vec<MetatheoremResult>,
    pub definitions: Vec<MetatheoremResult>,
}

fn check_relation(env: &Env, name: &str) -> MetatheoremResult {
    let totality = is_total(env, name);
    let coverage = is_covered(env, name);
    let totality_check = MetatheoremCheck {
        kind: CheckKind::Totality,
        ok: totality.ok,
        diagnostics: totality.diagnostics.into_iter().map(Into::into).collect(),
    };
    let coverage_check = MetatheoremCheck {
        kind: CheckKind::Coverage,
        ok: coverage.ok,
        diagnostics: coverage.diagnostics.into_iter().map(Into::into).collect(),
    };
    let ok = totality_check.ok && coverage_check.ok;
    MetatheoremResult {
        name: name.to_string(),
        ok,
        checks: vec![totality_check, coverage_check],
    }
}

fn check_definition(env: &Env, name: &str) -> MetatheoremResult {
    let term = is_terminating(env, name);
    let check = MetatheoremCheck {
        kind: CheckKind::Termination,
        ok: term.ok,
        diagnostics: term.diagnostics.into_iter().map(Into::into).collect(),
    };
    let ok = check.ok;
    MetatheoremResult {
        name: name.to_string(),
        ok,
        checks: vec![check],
    }
}

/// Public API: evaluate `text`, then enumerate every relation that has a
/// `(mode ...)` declaration plus matching `(relation ...)` clauses, and
/// every definition that has a `(define ...)` declaration. Each candidate
/// becomes a metatheorem result.
///
/// `file` is the source path used in evaluation diagnostics; it is
/// optional and only affects the rendered span.
pub fn check_metatheorems(text: &str, file: Option<&str>) -> MetatheoremReport {
    let mut env = Env::new(None);
    let evaluation = evaluate_with_env(text, file, &mut env);

    let mut relation_names: Vec<String> = env.modes.keys().cloned().collect();
    relation_names.sort();
    let mut relations: Vec<MetatheoremResult> = Vec::new();
    for name in &relation_names {
        let clauses = env.relations.get(name);
        // A `(mode ...)` declaration with no matching `(relation ...)` body
        // is not a metatheorem candidate — surface it through the existing
        // E032 path rather than fabricating a result.
        if clauses.map_or(true, |c| c.is_empty()) {
            continue;
        }
        relations.push(check_relation(&env, name));
    }

    let mut definition_names: Vec<String> = env.definitions.keys().cloned().collect();
    definition_names.sort();
    let mut definitions: Vec<MetatheoremResult> = Vec::new();
    for name in &definition_names {
        definitions.push(check_definition(&env, name));
    }

    let ok = evaluation.diagnostics.is_empty()
        && relations.iter().all(|r| r.ok)
        && definitions.iter().all(|d| d.ok);
    MetatheoremReport {
        ok,
        evaluation_diagnostics: evaluation.diagnostics,
        relations,
        definitions,
    }
}

fn format_check(check: &MetatheoremCheck) -> Vec<String> {
    let status = if check.ok { "pass" } else { "fail" };
    let mut lines = vec![format!("  - {}: {}", check.kind.as_str(), status)];
    for diag in &check.diagnostics {
        lines.push(format!("      {} {}", diag.code, diag.message).trim_end().to_string());
    }
    lines
}

/// Render a [`MetatheoremReport`] as the same human-readable text the CLI
/// prints. Useful in tests that want to assert on the rendered output as
/// well as the structured shape.
pub fn format_report(report: &MetatheoremReport) -> String {
    let mut lines: Vec<String> = Vec::new();
    for diag in &report.evaluation_diagnostics {
        lines.push(format_diagnostic(diag, None));
    }
    if report.relations.is_empty() && report.definitions.is_empty() {
        lines.push(
            "No metatheorem candidates found (no `(mode ...)` or `(define ...)` declarations)."
                .to_string(),
        );
        return lines.join("\n");
    }
    if !report.relations.is_empty() {
        lines.push("Relations:".to_string());
        for rel in &report.relations {
            let status = if rel.ok { "OK" } else { "FAIL" };
            lines.push(format!("  {}: {}", status, rel.name));
            for check in &rel.checks {
                lines.extend(format_check(check));
            }
        }
    }
    if !report.definitions.is_empty() {
        lines.push("Definitions:".to_string());
        for def in &report.definitions {
            let status = if def.ok { "OK" } else { "FAIL" };
            lines.push(format!("  {}: {}", status, def.name));
            for check in &def.checks {
                lines.extend(format_check(check));
            }
        }
    }
    lines.push(
        if report.ok {
            "All metatheorems hold."
        } else {
            "One or more metatheorems failed."
        }
        .to_string(),
    );
    lines.join("\n")
}
