-- Translated from Rocq by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

namespace Arith

inductive expr where
  | Num (field0 : Nat) : expr
  | Plus (field0 : Arith.expr) (field1 : Arith.expr) : expr
  | Times (field0 : Arith.expr) (field1 : Arith.expr) : expr
  deriving Repr, DecidableEq, Inhabited

def larger (a : Nat) (b : Nat) : Nat :=
  (if (decide (a ≤ b)) then b else a)

def eval (e : Arith.expr) : Nat :=
  (match e with
    | Arith.expr.Num n => n
    | Arith.expr.Plus a b => ((Arith.eval a) + (Arith.eval b))
    | Arith.expr.Times a_2 b_2 => ((Arith.eval a_2) * (Arith.eval b_2)))

def depth (e : Arith.expr) : Nat :=
  (match e with
    | Arith.expr.Num ml_f1 => (1 : Nat)
    | Arith.expr.Plus a b => ((1 : Nat) + (Arith.larger (Arith.depth a) (Arith.depth b)))
    | Arith.expr.Times a_2 b_2 => ((1 : Nat) + (Arith.larger (Arith.depth a_2) (Arith.depth b_2))))

end Arith

def sample : Arith.expr :=
  (Arith.expr.Plus (Arith.expr.Num (2 : Nat)) (Arith.expr.Times (Arith.expr.Num (3 : Nat)) (Arith.expr.Num (4 : Nat))))

theorem eval_sample : ((Arith.eval sample) = (14 : Nat)) := by
  try rfl
  try decide
  try simp only [Arith.eval, sample] <;> done
  try simp_all only [Arith.eval, sample] <;> omega
  try simp [Arith.eval, sample] <;> done
  try simp_all [Arith.eval, sample] <;> omega
  try simp_all [Arith.eval, sample, Nat.mul_add, Nat.add_mul, Int.mul_add, Int.add_mul] <;> omega

def main : IO Unit := do
  IO.println (toString (Arith.eval sample))
  IO.println (toString (Arith.depth sample))
