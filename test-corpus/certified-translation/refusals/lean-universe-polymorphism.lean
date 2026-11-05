-- A type parameter in an arbitrary universe cannot be monomorphized to the lowest universe.
universe u

def ident (α : Type u) (x : α) : α := x

def main : IO Unit := do
  IO.println (ident Nat 3)
