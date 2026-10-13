-- rml-certified-item rust/src/lambda_kernel.rs#DEFAULT_MAX_TRANSITIONS@721 target-sha256=5a01dd301a5db6b6ee5b297b70f6c486f7030711f60ea87b38479dc90051a33c
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DEFAULT_MAX_TRANSITIONS : Nat :=
  (100000000 : Nat)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lambda_kernel.rs#CONTRACTION_LIMIT_PREFIX@777 target-sha256=c12c53fb1841ea83fd5624d10fde7c44db4a630e56357eb591d8e47184aa9fe0
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def CONTRACTION_LIMIT_PREFIX : String :=
  "lambda transition limit "

def main : IO Unit := do
  pure ()
