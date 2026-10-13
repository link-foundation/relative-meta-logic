-- rml-certified-item rust/src/linked_proof.rs#LINKED_PROOF_PROGRAM@401 target-sha256=17f41b10c8c2c5dd2c2573096572ae103ee11f13a5790b551548ea1cca49b474
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def LINKED_PROOF_PROGRAM : String :=
  "linked-proof-verifier"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_proof.rs#LINKED_PROOF_SCHEMA@465 target-sha256=1802c9e257e5f1abe44ddcdf9a89ba7f928b5fca4a9cd16e43e33698c0e617a9
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def LINKED_PROOF_SCHEMA : String :=
  "rml-linked-proof-replay/v1"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_proof.rs#MAX_LINKED_PROOF_DEPTH@746 target-sha256=d19d6b972171c72e4fc69827c6504edf3bb33d83d8bdee8f9f90228908e456f2
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def MAX_LINKED_PROOF_DEPTH : Nat :=
  (256 : Nat)

def main : IO Unit := do
  pure ()
