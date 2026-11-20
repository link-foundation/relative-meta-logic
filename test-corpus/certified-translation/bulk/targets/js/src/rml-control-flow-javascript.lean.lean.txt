-- rml-certified-item js/src/rml-control-flow-javascript.mjs#typeOf@764 target-sha256=2ecbb8361a084d1376398aebcb09361405fa7158e19a52845d2528ae04219b18
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def typeOf (value : (Option Float)) : String :=
  (if (match (value, none) with | (some ml_left, some ml_right) => false | (none, none) => true | _ => false) then "unit" else (if ((match value with | some ml_present => "number" | none => "object") == "boolean") then "bool" else "int"))

def main : IO Unit := do
  pure ()
