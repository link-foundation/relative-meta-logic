-- Translated from Rocq by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive point where
  | mkPoint (field0 : Nat) (field1 : Nat) : point
  deriving Repr, DecidableEq, Inhabited

def px (ml_record : point) : Nat :=
  (match ml_record with
    | point.mkPoint ml_field ml_f1 => ml_field)

def py (ml_record : point) : Nat :=
  (match ml_record with
    | point.mkPoint ml_f2 ml_field => ml_field)

inductive bag_nat where
  | none_nat : bag_nat
  | some_nat (field0 : Nat) (field1 : bag_nat) : bag_nat
  deriving Repr, DecidableEq, Inhabited

def size_nat (b : bag_nat) : Nat :=
  (match b with
    | bag_nat.none_nat => (0 : Nat)
    | bag_nat.some_nat ml_f3 rest => ((size_nat rest) + (1 : Nat)))

def norm (p : point) : Nat :=
  ((px p) + (py p))

def main : IO Unit := do
  IO.println (toString (norm (point.mkPoint (3 : Nat) (4 : Nat))))
  IO.println (toString (py (point.mkPoint (1 : Nat) (9 : Nat))))
  IO.println (toString (size_nat (bag_nat.some_nat (1 : Nat) (bag_nat.some_nat (2 : Nat) bag_nat.none_nat))))
