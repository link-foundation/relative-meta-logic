(* Records are outside the admitted core; the refusal keeps the source and its span. *)
From Stdlib Require Import Arith String.

Record point : Type := { px : nat; py : nat }.

Definition origin : point := {| px := 0; py := 0 |}.

Definition main : list string := nil.
