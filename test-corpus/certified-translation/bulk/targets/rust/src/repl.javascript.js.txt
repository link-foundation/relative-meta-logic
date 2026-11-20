// rml-certified-item rust/src/repl.rs#HELP_TEXT@1708 target-sha256=fa01f192b2644d85963dd5f5638b01b8bb4577271131c15048849ca25f9b6931
// Translated from Rust by meta-language: portable core, JavaScript target.
'use strict';

function HELP_TEXT() {
  return "RML REPL — meta-commands:\n  :help           show this help message\n  :reset          discard all state and start a fresh Env\n  :env            print declared terms / assignments / types / lambdas\n  :load <file>    evaluate a .lino file in the current Env\n  :save <file>    write the session transcript (as .lino) to <file>\n  :quit           exit the REPL (also :exit, Ctrl-D)\n\nLiNo input is evaluated form-by-form.  Query results are printed; errors\nare reported as diagnostics with source spans.";
}

function main() {

}

main();
