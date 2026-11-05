-- Type classes and instances are implicit resolution authority; they are refused.
class Sized (α : Type) where
  size : α → Nat

instance : Sized Nat where
  size n := n

def main : IO Unit := do
  IO.println (Sized.size (5 : Nat))
