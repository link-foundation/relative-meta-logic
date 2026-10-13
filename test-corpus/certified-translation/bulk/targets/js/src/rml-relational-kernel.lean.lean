-- rml-certified-item js/src/rml-relational-kernel.mjs#cons@190 target-sha256=fd22fc5e9762d296a8a050a938249eb6b0e8849822169746526e1c9ee352f0f7
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def cons (head : String) (tail : String) : (Array String) :=
  (#["cons", head, tail] : (Array String))

def main : IO Unit := do
  pure ()
