-- Translated from Rocq by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive priority where
  | Low : priority
  | High : priority
  deriving Repr, DecidableEq, Inhabited

inductive queue where
  | Empty : queue
  | Push (field0 : priority) (field1 : Nat) (field2 : queue) : queue
  deriving Repr, DecidableEq, Inhabited

def weight (p : priority) : Nat :=
  (match p with
    | priority.Low => (1 : Nat)
    | priority.High => (10 : Nat))

def score (q : queue) : Nat :=
  (match q with
    | queue.Empty => (0 : Nat)
    | queue.Push p n rest => (((weight p) * n) + (score rest)))

def urgent (q : queue) : Nat :=
  (match q with
    | queue.Empty => (0 : Nat)
    | queue.Push ml_f1 ml_f2 rest => (match ml_f1 with
        | priority.Low => (urgent rest)
        | priority.High => ((1 : Nat) + (urgent rest))))

def label (n : Nat) : String :=
  (if (decide (n < (50 : Nat))) then "calm" else "busy")

theorem score_empty_plus (n : Nat) : (((score queue.Empty) + n) = n) := by
  try rfl
  try decide
  try simp only [score] <;> done
  try simp_all only [score] <;> omega
  try simp [score] <;> done
  try simp_all [score] <;> omega
  try simp_all [score, Nat.mul_add, Nat.add_mul, Int.mul_add, Int.add_mul] <;> omega

def main : IO Unit := do
  IO.println (toString (score (queue.Push priority.High (3 : Nat) (queue.Push priority.Low (7 : Nat) queue.Empty))))
  IO.println (toString (urgent (queue.Push priority.High (3 : Nat) (queue.Push priority.Low (7 : Nat) (queue.Push priority.High (1 : Nat) queue.Empty)))))
  IO.println (label (score (queue.Push priority.High (3 : Nat) (queue.Push priority.Low (7 : Nat) queue.Empty))))
  IO.println (label (score (queue.Push priority.Low (2 : Nat) queue.Empty)))
