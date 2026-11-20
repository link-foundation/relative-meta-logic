def rml_square (x : Nat) : Nat := (x * x)
def rml_mix (x : Nat) (y : Nat) : Nat := (if (x <= y) then ((rml_square (x)) + y) else ((rml_square (y)) + x))
def rml_guard (x : Nat) (y : Nat) : Nat := (if (x = y) then 0 else (if (x < y) then ((rml_mix (x) (y)) + 1) else ((rml_mix (y) (x)) * 2)))
