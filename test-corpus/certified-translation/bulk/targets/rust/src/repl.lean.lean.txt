-- rml-certified-item rust/src/repl.rs#HELP_TEXT@1708 target-sha256=2e3ac3f72d45c86e4bb79442dea154fa79aed50720d988c59c3655878e5f5b5d
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def HELP_TEXT : String :=
  "RML REPL — meta-commands:\n  :help           show this help message\n  :reset          discard all state and start a fresh Env\n  :env            print declared terms / assignments / types / lambdas\n  :load <file>    evaluate a .lino file in the current Env\n  :save <file>    write the session transcript (as .lino) to <file>\n  :quit           exit the REPL (also :exit, Ctrl-D)\n\nLiNo input is evaluated form-by-form.  Query results are printed; errors\nare reported as diagnostics with source spans."

def main : IO Unit := do
  pure ()
