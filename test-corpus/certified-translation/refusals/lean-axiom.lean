-- An axiom must never be erased or turned into a definition.
axiom magic : Nat

def useMagic (n : Nat) : Nat := n + magic

def main : IO Unit := do
  IO.println (useMagic 1)
