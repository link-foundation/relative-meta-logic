-- rml-certified-item rust/src/theory_network.rs#EMPTY_SEQUENCE@716 target-sha256=5e731301ab77f6c7f2b5c125639e923884424efdb332c11ac77a4e2014c07582
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def EMPTY_SEQUENCE : String :=
  "rml.sequence.empty"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/theory_network.rs#SequenceLayout@48851 target-sha256=a1d00a553881cb1b755613d3b8ab1d0c3e7fa134578df0286553d3cbbff334eb
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive SequenceLayout where
  | Balanced : SequenceLayout
  | Left : SequenceLayout
  | Right : SequenceLayout
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/theory_network.rs#SequenceTree@48960 target-sha256=b0330977a08099141eebe9bcb17615c18329f41281dd87aabf137252b753b668
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive SequenceTree where
  | Leaf (field0 : String) : SequenceTree
  | Branch (field0 : SequenceTree) (field1 : SequenceTree) : SequenceTree
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
