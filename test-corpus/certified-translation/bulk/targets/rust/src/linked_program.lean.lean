-- rml-certified-item rust/src/linked_program.rs#PREVIOUS_METRIC_REVISION@2287 target-sha256=d7f384cdaaae3a7a8470c28cf469b542aa22e934237aa0cf174fd26fe3f0ade7
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def PREVIOUS_METRIC_REVISION : String :=
  "8b39df510a083e5cbe2a56a72e6595aae7b48146"

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#SearchEnd@4435 target-sha256=c50ffc6167691605caa54e2ae0dc26e4299094c3fe6aee0eaae46a654f3c0814
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive SearchEnd where
  | Found : SearchEnd
  | Saturated : SearchEnd
  | InferenceLimit : SearchEnd
  | FactLimit : SearchEnd
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#GoalNormalization@5136 target-sha256=cf778ffab69191acef96715290c650c9d481a0a1d50cddc3eadb338ac28d8808
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive GoalNormalization where
  | Normal : GoalNormalization
  | RewriteLimit : GoalNormalization
  | RewriteCycle : GoalNormalization
  | RewriteStalled : GoalNormalization
  | ContractionLimit : GoalNormalization
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#ReduceFailure@6988 target-sha256=e02f9e0be70691ee8acc6c095d30f4e662c51746f2ee9e29fae1d07e03375f69
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ReduceFailure where
  | Limit (field0 : String) : ReduceFailure
  | Cycle (field0 : String) : ReduceFailure
  | Stalled (field0 : String) : ReduceFailure
  | ContractionLimit (field0 : String) : ReduceFailure
  | Other (field0 : String) : ReduceFailure
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#AddedFact@8379 target-sha256=024de6feda7855e1bd9ba132266bbdf7a7fd4ac4b93585e0f422679d48f3a167
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive AddedFact where
  | Duplicate : AddedFact
  | New : AddedFact
  | OverLimit : AddedFact
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#OrientationContract@124214 target-sha256=ece9f8ffe188d0ffea4776e5c5f664ae60817b4c39aac7b2fb0d281fbc8ff6d2
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive OrientationContract where
  | Named : OrientationContract
  | Anonymous : OrientationContract
  | Unordered : OrientationContract
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/linked_program.rs#orientation_contract_id@124713 target-sha256=c6ae1ab87cce7483ae8c45d5601b1f32e735c78bde5fd677d05deec0b6a42e73
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive OrientationContract where
  | Named : OrientationContract
  | Anonymous : OrientationContract
  | Unordered : OrientationContract
  deriving Repr, DecidableEq, Inhabited

def orientation_contract_id (contract : OrientationContract) : String :=
  (match contract with
    | OrientationContract.Named => "named-ordered-slots"
    | OrientationContract.Anonymous => "anonymous-ordered-slots"
    | OrientationContract.Unordered => "unordered-slots")

def main : IO Unit := do
  pure ()
