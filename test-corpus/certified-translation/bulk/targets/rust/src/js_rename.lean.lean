-- rml-certified-item rust/src/js_rename.rs#RESERVED@205 target-sha256=6a1d92260ab228118147d2c2973f7408e289044510c82818cbe3578d3b2f7529
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def RESERVED : String :=
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await async"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/js_rename.rs#UNSUPPORTED@531 target-sha256=65db4a93e2d1025e143259acfb1fe198615708806f56d5359237aefe7bbd6f6b
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def UNSUPPORTED : String :=
  "break case catch class continue debugger default delete do else enum export extends finally for function if implements import in interface package private protected public return static super switch throw try var while with yield await async eval"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/js_rename.rs#fail@1901 target-sha256=aef714b9686bcf0e69353c8e662730355eaa2302237dbb8c68019e32fd1ce434
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def fail (code : String) (detail : String) (offset : Nat) : String :=
  ((((code ++ ": ") ++ detail) ++ " at UTF-16 offset ") ++ (toString offset))

def main : IO Unit := do
  pure ()
