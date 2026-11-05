(* A record whose field type depends on an earlier field has no constructor-application lowering; RML refuses it with the span. *)
From Stdlib Require Import Arith String.

Record bounded : Type := mkBounded { limit : nat; within : limit = limit }.

Definition main : list string := nil.
