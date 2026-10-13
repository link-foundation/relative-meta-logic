-- rml-certified-item rust/src/cst.rs#dialects@436 target-sha256=12680a422a9a6eaafa97d4978763818412880251615fc4304f527857b98ef7d8
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

namespace dialects

def RUST : String :=
  "lino-cst.rust"

def JS : String :=
  "lino-cst.js"

def LEAN : String :=
  "lino-cst.lean"

def ROCQ : String :=
  "lino-cst.rocq"

def SHARED : String :=
  "lino-cst.shared"

end dialects

def main : IO Unit := do
  pure ()
