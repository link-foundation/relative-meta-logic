//! RML — Interactive REPL (issue #29)
//!
//! Maintains a persistent [`Env`] between user inputs and prints diagnostics
//! inline.  Meta-commands start with `:`:
//!
//! ```text
//!   :help           show this help message
//!   :reset          discard all state and start a fresh Env
//!   :env            print declared terms / assignments / types / lambdas
//!   :load <file>    evaluate a `.lino` file in the current Env
//!   :save <file>    write the session transcript (as `.lino`) to <file>
//!   :quit           exit the REPL (also :exit, Ctrl-D)
//! ```
//!
//! Tab-completion is best-effort: the [`Repl::completion_candidates`] helper
//! returns known meta-commands plus declared terms, operators, and lambda
//! names.  The CLI driver (`main.rs`) wires it into the line-editor.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use crate::{evaluate_with_env, format_diagnostic, Env, EnvOptions, RunResult};

/// Outcome of feeding a single line into the REPL.  Output and error are
/// stringified for the driver to emit; `exit` requests termination.
#[derive(Debug, Clone, Default)]
pub struct ReplStep {
    pub output: String,
    pub error: String,
    pub exit: bool,
}

/// Built-in keywords always offered by the completer.
const BUILTIN_KEYWORDS: &[&str] = &[
    "and", "or", "not", "both", "neither", "is", "has", "probability", "range", "valence", "true",
    "counter-model", "false", "unknown", "undefined", "lambda", "apply", "Pi", "Type", "Prop",
    "of", "type",
];

/// Meta-commands offered by the completer.
const META_COMMANDS: &[&str] = &[
    ":help", ":reset", ":env", ":load", ":save", ":quit", ":exit",
];

const HELP_TEXT: &str = "RML REPL — meta-commands:\n  :help           show this help message\n  :reset          discard all state and start a fresh Env\n  :env            print declared terms / assignments / types / lambdas\n  :load <file>    evaluate a .lino file in the current Env\n  :save <file>    write the session transcript (as .lino) to <file>\n  :quit           exit the REPL (also :exit, Ctrl-D)\n\nLiNo input is evaluated form-by-form.  Query results are printed; errors\nare reported as diagnostics with source spans.";

fn format_number(n: f64) -> String {
    let formatted = format!("{:.6}", n);
    let formatted = formatted.trim_end_matches('0').trim_end_matches('.');
    formatted.to_string()
}

fn format_run_result(r: &RunResult) -> String {
    match r {
        RunResult::Num(n) => format_number(*n),
        RunResult::Type(s) => s.clone(),
    }
}

/// REPL state.  Owns the persistent [`Env`] and the running transcript so
/// `:save` can replay the session.
pub struct Repl {
    pub env: Env,
    pub transcript: Vec<String>,
    env_options: EnvOptions,
    cwd: PathBuf,
}

impl Repl {
    pub fn new(env_options: EnvOptions, cwd: Option<PathBuf>) -> Self {
        let env = Env::new(Some(env_options.clone()));
        Self {
            env,
            transcript: Vec::new(),
            env_options,
            cwd: cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        }
    }

    /// Reset the env to a fresh copy of the original options and clear the
    /// transcript.
    pub fn reset(&mut self) {
        self.env = Env::new(Some(self.env_options.clone()));
        self.transcript.clear();
    }

    /// Evaluate a chunk of LiNo source against the persistent env.
    pub fn evaluate_source(&mut self, source: &str, file: Option<&str>) -> (String, String) {
        let res = evaluate_with_env(source, file, &mut self.env);
        let mut out_parts: Vec<String> = Vec::new();
        for r in &res.results {
            out_parts.push(format_run_result(r));
        }
        let mut err_parts: Vec<String> = Vec::new();
        for d in &res.diagnostics {
            err_parts.push(format_diagnostic(d, Some(source)));
        }
        (out_parts.join("\n"), err_parts.join("\n"))
    }

    /// Process a single REPL line (LiNo form or meta-command).
    pub fn feed(&mut self, line: &str) -> ReplStep {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return ReplStep::default();
        }
        if trimmed.starts_with(':') {
            return self.handle_meta(trimmed);
        }
        self.transcript.push(line.to_string());
        let (output, error) = self.evaluate_source(line, Some("<repl>"));
        ReplStep {
            output,
            error,
            exit: false,
        }
    }

    fn handle_meta(&mut self, line: &str) -> ReplStep {
        let mut parts = line.splitn(2, char::is_whitespace);
        let cmd = parts.next().unwrap_or("").trim();
        let arg = parts.next().unwrap_or("").trim();
        match cmd {
            ":help" | ":?" => ReplStep {
                output: HELP_TEXT.to_string(),
                ..Default::default()
            },
            ":quit" | ":exit" => ReplStep {
                exit: true,
                ..Default::default()
            },
            ":reset" => {
                self.reset();
                ReplStep {
                    output: "Env reset.".to_string(),
                    ..Default::default()
                }
            }
            ":env" => ReplStep {
                output: format_env(&self.env),
                ..Default::default()
            },
            ":load" => {
                if arg.is_empty() {
                    return ReplStep {
                        error: ":load requires a file path".to_string(),
                        ..Default::default()
                    };
                }
                let path = self.resolve(arg);
                let text = match fs::read_to_string(&path) {
                    Ok(t) => t,
                    Err(e) => {
                        return ReplStep {
                            error: format!(":load failed: {}", e),
                            ..Default::default()
                        };
                    }
                };
                self.transcript.push(format!("# :load {}", arg));
                self.transcript.push(text.clone());
                let (output, error) = self.evaluate_source(&text, Some(arg));
                ReplStep {
                    output,
                    error,
                    exit: false,
                }
            }
            ":save" => {
                if arg.is_empty() {
                    return ReplStep {
                        error: ":save requires a file path".to_string(),
                        ..Default::default()
                    };
                }
                let path = self.resolve(arg);
                let mut body = self.transcript.join("\n");
                if !body.ends_with('\n') {
                    body.push('\n');
                }
                if let Err(e) = fs::write(&path, body) {
                    return ReplStep {
                        error: format!(":save failed: {}", e),
                        ..Default::default()
                    };
                }
                ReplStep {
                    output: format!(
                        "Saved {} entries to {}.",
                        self.transcript.len(),
                        arg
                    ),
                    ..Default::default()
                }
            }
            other => ReplStep {
                error: format!("Unknown meta-command: {}.  Try :help.", other),
                ..Default::default()
            },
        }
    }

    fn resolve(&self, p: &str) -> PathBuf {
        let pb = Path::new(p);
        if pb.is_absolute() || p.starts_with('~') {
            pb.to_path_buf()
        } else {
            self.cwd.join(p)
        }
    }

    /// Best-effort tab-completion candidates for `prefix`.  Returns names
    /// from the env (terms, ops, symbols, lambdas), built-in keywords, and
    /// meta-commands when `prefix` starts with `:`.
    pub fn completion_candidates(&self, prefix: &str) -> Vec<String> {
        if prefix.starts_with(':') {
            let mut hits: Vec<String> = META_COMMANDS
                .iter()
                .filter(|c| c.starts_with(prefix))
                .map(|s| s.to_string())
                .collect();
            hits.sort();
            return hits;
        }
        let mut all: Vec<String> = Vec::new();
        for k in BUILTIN_KEYWORDS {
            all.push((*k).to_string());
        }
        for t in &self.env.terms {
            all.push(t.clone());
        }
        for k in self.env.ops.keys() {
            all.push(k.clone());
        }
        for k in self.env.symbol_prob.keys() {
            all.push(k.clone());
        }
        for k in self.env.lambdas.keys() {
            all.push(k.clone());
        }
        all.sort();
        all.dedup();
        if prefix.is_empty() {
            all
        } else {
            all.into_iter().filter(|c| c.starts_with(prefix)).collect()
        }
    }
}

/// Render a snapshot of the env's user-visible state for `:env`.
pub fn format_env(env: &Env) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("range:    [{}, {}]", env.lo, env.hi));
    let valence_str = if env.valence == 0 {
        "continuous".to_string()
    } else {
        env.valence.to_string()
    };
    lines.push(format!("valence:  {}", valence_str));
    if !env.terms.is_empty() {
        let mut terms: Vec<&String> = env.terms.iter().collect();
        terms.sort();
        let names: Vec<String> = terms.iter().map(|s| (*s).clone()).collect();
        lines.push(format!("terms:    {}", names.join(", ")));
    }
    if !env.lambdas.is_empty() {
        let mut keys: Vec<&String> = env.lambdas.keys().collect();
        keys.sort();
        let names: Vec<String> = keys.iter().map(|s| (*s).clone()).collect();
        lines.push(format!("lambdas:  {}", names.join(", ")));
    }
    if !env.types.is_empty() {
        lines.push("types:".to_string());
        let mut entries: Vec<(&String, &String)> = env.types.iter().collect();
        entries.sort();
        for (k, v) in entries {
            lines.push(format!("  {} : {}", k, v));
        }
    }
    if !env.assign.is_empty() {
        lines.push("assignments:".to_string());
        let mut entries: Vec<(&String, &f64)> = env.assign.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (k, v) in entries {
            lines.push(format!("  {} = {}", k, format_number(*v)));
        }
    }
    // Skip default truth constants unless the user redefined them.
    let mid = env.mid();
    let mut user_priors: Vec<(&String, &f64)> = env
        .symbol_prob
        .iter()
        .filter(|(k, v)| {
            let kk = k.as_str();
            if kk == "true" {
                **v != env.hi
            } else if kk == "false" {
                **v != env.lo
            } else if kk == "unknown" || kk == "undefined" {
                **v != mid
            } else {
                true
            }
        })
        .collect();
    if !user_priors.is_empty() {
        user_priors.sort_by(|a, b| a.0.cmp(b.0));
        lines.push("symbol priors:".to_string());
        for (k, v) in user_priors {
            lines.push(format!("  {} = {}", k, format_number(*v)));
        }
    }
    lines.join("\n")
}

/// Drive the REPL on the given input/output streams.  Used by `main.rs`.
/// Suppresses prompts when stdin is not a TTY so piped input stays clean.
pub fn run_repl(
    env_options: EnvOptions,
    show_prompt: bool,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    err_output: &mut dyn Write,
) -> io::Result<()> {
    let mut repl = Repl::new(env_options, None);
    if show_prompt {
        writeln!(output, "RML REPL.  Type :help for commands, :quit to exit.")?;
    }
    loop {
        if show_prompt {
            write!(output, "rml> ")?;
            output.flush()?;
        }
        let mut line = String::new();
        let n = input.read_line(&mut line)?;
        if n == 0 {
            // EOF
            if show_prompt {
                writeln!(output)?;
            }
            break;
        }
        // Strip trailing newline only — preserve interior whitespace.
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }
        let step = repl.feed(&line);
        if !step.output.is_empty() {
            writeln!(output, "{}", step.output)?;
        }
        if !step.error.is_empty() {
            writeln!(err_output, "{}", step.error)?;
        }
        if step.exit {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_state_across_feeds() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        repl.feed("(a: a is a)");
        repl.feed("((a = a) has probability 1)");
        let step = repl.feed("(? (a = a))");
        assert_eq!(step.output, "1");
        assert!(step.error.is_empty(), "errors: {}", step.error);
    }

    #[test]
    fn reset_clears_state() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        repl.feed("(a: a is a)");
        assert!(repl.env.terms.contains("a"));
        repl.feed(":reset");
        assert!(!repl.env.terms.contains("a"));
        assert!(repl.transcript.is_empty());
    }

    #[test]
    fn help_emits_help_text() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        let step = repl.feed(":help");
        assert!(step.output.contains(":load"), "got: {}", step.output);
    }

    #[test]
    fn unknown_meta_command_reports_error() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        let step = repl.feed(":nope");
        assert!(step.error.contains("Unknown meta-command"));
    }

    #[test]
    fn quit_requests_exit() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        let step = repl.feed(":quit");
        assert!(step.exit);
    }

    #[test]
    fn completion_offers_terms_after_declaration() {
        let mut repl = Repl::new(EnvOptions::default(), None);
        repl.feed("(apple: apple is apple)");
        let hits = repl.completion_candidates("app");
        assert!(hits.iter().any(|s| s == "apple"), "hits: {:?}", hits);
    }

    #[test]
    fn completion_offers_meta_commands_for_colon_prefix() {
        let repl = Repl::new(EnvOptions::default(), None);
        let hits = repl.completion_candidates(":lo");
        assert!(hits.iter().any(|s| s == ":load"), "hits: {:?}", hits);
    }
}
