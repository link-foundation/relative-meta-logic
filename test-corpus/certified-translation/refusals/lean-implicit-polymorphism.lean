def ident {α : Type} (x : α) : α := x

def main : IO Unit := do
  IO.println (ident 3)
