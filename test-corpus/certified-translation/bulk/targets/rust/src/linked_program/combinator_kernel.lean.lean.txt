-- rml-certified-item rust/src/linked_program/combinator_kernel.rs#DEFAULT_MAX_CONTRACTIONS@436 target-sha256=0302e0e668ef0070e6180bfc4a96ea36bd164c884cc5342243b9878f938dc6fd
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DEFAULT_MAX_CONTRACTIONS : Nat :=
  (100000000 : Nat)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program/combinator_kernel.rs#CONTRACTION_LIMIT_PREFIX@500 target-sha256=26a6ffff589cee00dbe6d0fe8554fa343aedd6e4f4a5d08c6a7996a58ae6ea07
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def CONTRACTION_LIMIT_PREFIX : String :=
  "combinator contraction limit "

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program/combinator_kernel.rs#is_contraction_limit@805 target-sha256=719bd8cd26a1732eb393b7a0a9269bf02432ae7c532e78b5c26e7e12bfa22a79
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def CONTRACTION_LIMIT_PREFIX : String :=
  "combinator contraction limit "

def is_contraction_limit (message : String) : Bool :=
  (String.startsWith message CONTRACTION_LIMIT_PREFIX)

def main : IO Unit := do
  pure ()
