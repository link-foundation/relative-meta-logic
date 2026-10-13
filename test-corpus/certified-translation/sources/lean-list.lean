-- A natural-number list datatype, structural recursion and an open universal theorem.
inductive NatList where
  | nil : NatList
  | cons : Nat → NatList → NatList

def length : NatList → Nat
  | NatList.nil => 0
  | NatList.cons _ rest => 1 + length rest

def total : NatList → Nat
  | NatList.nil => 0
  | NatList.cons head rest => head + total rest

def append (left : NatList) (right : NatList) : NatList :=
  match left with
  | NatList.nil => right
  | NatList.cons head rest => NatList.cons head (append rest right)

def classify (n : Nat) : String :=
  if n == 0 then "empty" else if n < 3 then "short" else "long"

theorem add_zero_right (n : Nat) : n + 0 = n := by simp

def main : IO Unit := do
  IO.println (length (append (NatList.cons 1 (NatList.cons 2 NatList.nil)) (NatList.cons 3 NatList.nil)))
  IO.println (total (NatList.cons 10 (NatList.cons 20 (NatList.cons 12 NatList.nil))))
  IO.println (classify (length NatList.nil))
  IO.println (classify (length (NatList.cons 4 (NatList.cons 5 (NatList.cons 6 NatList.nil)))))
