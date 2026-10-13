-- rml-certified-item js/src/rml-meta-structure.mjs#isProfileLink@6882 target-sha256=780a20f3bddd031898a969626890227950b3e86f6b24e80c53834b80517a4ed2
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def isProfileLink (metadata : ((Option (Option String)))) : Bool :=
  (String.startsWith (match metadata with | some (some ml_value) => ml_value | _ => "") "language-profile")

def main : IO Unit := do
  pure ()
