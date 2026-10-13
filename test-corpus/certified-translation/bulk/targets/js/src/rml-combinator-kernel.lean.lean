-- rml-certified-item js/src/rml-combinator-kernel.mjs#app@472 target-sha256=8fd7b7c813b5507da6f7da2b82b5aa4bffbf53c309dbc2ef23445b521a4dc1c0
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def app (left : Float) (right : Float) : (Array Float) :=
  (#[left, right] : (Array Float))

def main : IO Unit := do
  pure ()
