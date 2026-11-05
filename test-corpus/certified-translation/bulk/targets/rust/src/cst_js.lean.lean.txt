-- rml-certified-item rust/src/cst_js.rs#LastKind@620 target-sha256=372c5ea2276b361455d095c7127fd65832f7fa5e7ab4a42111e0b0bed401334e
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive LastKind where
  | None : LastKind
  | Trivia : LastKind
  | Ident : LastKind
  | Punct : LastKind
  | Other : LastKind
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
