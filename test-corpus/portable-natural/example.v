Require Import Arith.
Definition rml_square (x : nat) : nat := (x * x).
Definition rml_mix (x : nat) (y : nat) : nat := (if (x <=? y) then ((rml_square (x)) + y) else ((rml_square (y)) + x)).
Definition rml_guard (x : nat) (y : nat) : nat := (if (x =? y) then 0 else (if (x <? y) then ((rml_mix (x) (y)) + 1) else ((rml_mix (y) (x)) * 2))).
