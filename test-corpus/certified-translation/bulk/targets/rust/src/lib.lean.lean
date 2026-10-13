-- rml-certified-item rust/src/lib.rs#DECIMAL_PRECISION@20894 target-sha256=eecc5a1a35a6144068fddd716f6dc4d89585a49a1284f25de46a765757dc8429
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DECIMAL_PRECISION : Int :=
  (12 : Int)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#Aggregator@21819 target-sha256=0d08e6876bb10679446927387c955ea8eaa0c8f26d7b5e77f2492ff2e0bcaffd
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive Aggregator where
  | Avg : Aggregator
  | Min : Aggregator
  | Max : Aggregator
  | Prod : Aggregator
  | Ps : Aggregator
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#ModeFlag@49434 target-sha256=fdcb5380d2587d322e20c75cdac834a88f6fae2614e4faa6acc2745a651d0200
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ModeFlag where
  | In : ModeFlag
  | Out : ModeFlag
  | Either : ModeFlag
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#token_base_name@108454 target-sha256=9a7f121dd137eadae53ec273ee11ca0195db91e6d1f5be01409f7ab86248eebf
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def token_base_name (token : String) : String :=
  token

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#DEFAULT_SIMPLIFY_MAX_STEPS@279286 target-sha256=ebd1a89224c48a1127610a6d85325e19337e8f7815ace97eec6864c4bf6b62dc
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DEFAULT_SIMPLIFY_MAX_STEPS : Nat :=
  (100 : Nat)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#DEFAULT_ATP_TIMEOUT_MS@279333 target-sha256=5b7653c602ae78dfeeb4984afe3d72cf346a141e089393bfc161e30c0b1add06
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DEFAULT_ATP_TIMEOUT_MS : Nat :=
  (5000 : Nat)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#DEFAULT_SMT_TIMEOUT_MS@279375 target-sha256=b669b4c7acdc4d4a715805f2f93e42bb125c72c6b38b78c3938001b4094caa68
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def DEFAULT_SMT_TIMEOUT_MS : Nat :=
  (5000 : Nat)

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#RewriteDirection@279691 target-sha256=7817f5e47f64b82c91754790b2e77bf95ff4ea1654062400a4f0e656183a29cc
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive RewriteDirection where
  | Forward : RewriteDirection
  | Backward : RewriteDirection
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#RewriteOccurrence@279849 target-sha256=e119fdb5cdfddd90aaa99de2c0ae20dea763e47740fe59528d9ca9302266c66e
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive RewriteOccurrence where
  | All : RewriteOccurrence
  | Index (field0 : Nat) : RewriteOccurrence
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#AtpStatusKind@281521 target-sha256=5c5987125798bab9a30d81897e3f9deda512ce6bfc60584aa8daaa336ae391de
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive AtpStatusKind where
  | Proved : AtpStatusKind
  | Unknown : AtpStatusKind
  | Timeout : AtpStatusKind
  | Failure : AtpStatusKind
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#SmtSort@284722 target-sha256=24ab54c6c8f123bfe678f2d1920462746a359bc77dbdb2ae73521dfe4d7a964e
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive SmtSort where
  | «Bool» : SmtSort
  | Real : SmtSort
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#SmtStatus@285066 target-sha256=18c48e5b88290cd08f7753608b7b9565821cb777a7bfcc8d786bf5cb175c5f42
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive SmtStatus where
  | Unsat : SmtStatus
  | Sat : SmtStatus
  | Unknown : SmtStatus
  | Timeout : SmtStatus
  | Error : SmtStatus
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#FormalizationResultValue@438408 target-sha256=3bbc03b998dbe42a5b4f7b5fa46e987e398047b4460275c1816fbbec948d1228
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive FormalizationResultValue where
  | Number (field0 : Float) : FormalizationResultValue
  | TruthValue (field0 : Float) : FormalizationResultValue
  | «Type» (field0 : String) : FormalizationResultValue
  | Partial (field0 : String) : FormalizationResultValue
  deriving Repr, Inhabited

def main : IO Unit := do
  pure ()
-- rml-certified-item rust/src/lib.rs#ExtractTarget@447128 target-sha256=302831114294fa6acd8eb43d34a963795243cc95b0132ef941068bfb39408d7e
-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ExtractTarget where
  | JavaScript : ExtractTarget
  | Rust : ExtractTarget
  deriving Repr, DecidableEq, Inhabited

def main : IO Unit := do
  pure ()
