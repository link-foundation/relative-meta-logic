// rml-meta — metatheorem checker over encoded systems (issue #47, C3).
//
// CLI front-end for `rml::meta::check_metatheorems`. Reads a program file,
// composes D12 totality, D14 coverage, D15 modes, and D13 termination, and
// prints a per-relation / per-definition pass/fail report. Exits non-zero
// when any metatheorem fails.

use rml::meta::{check_metatheorems, format_report};
use std::env;
use std::fs;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 || args[1] == "-h" || args[1] == "--help" {
        eprintln!("Usage: rml-meta <program.lino>");
        return if args.get(1).map(|s| s.as_str()) == Some("-h")
            || args.get(1).map(|s| s.as_str()) == Some("--help")
        {
            ExitCode::SUCCESS
        } else {
            ExitCode::from(2)
        };
    }
    let file = &args[1];
    let text = match fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Error reading {}: {}", file, e);
            return ExitCode::from(1);
        }
    };
    let report = check_metatheorems(&text, Some(file));
    let formatted = format_report(&report);
    if report.ok {
        println!("{}", formatted);
        ExitCode::SUCCESS
    } else {
        eprintln!("{}", formatted);
        ExitCode::from(1)
    }
}
