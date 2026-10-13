-- rml-certified-item js/src/rml-formal-semantics.mjs#text@723 target-sha256=c1704bae88a58c4ecd6f2c8fcfbf83433b38ccd997c15bd2356989e623b28c04
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def text (tokens : (Array (Float))) : (Array Float) :=
  (let ml_values := tokens; let ml_callback := (fun (token : (Float)) => token);  (ml_values.toList.zipIdx.map (fun ml_pair => (ml_callback ml_pair.1))).toArray)

def main : IO Unit := do
  pure ()
