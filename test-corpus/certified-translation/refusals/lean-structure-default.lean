-- A structure field with a default value is elaborated by Lean at every instance; RML refuses it.
structure Config where
  width : Nat
  height : Nat := 10

def main : IO Unit := do
  IO.println ({ width := 3 } : Config).width
