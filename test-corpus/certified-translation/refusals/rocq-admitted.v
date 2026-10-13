(* An admitted proof is an unproved assumption; it must not be relabelled as a theorem. *)
From Stdlib Require Import Arith.

Definition double (n : nat) : nat := n + n.

Theorem double_spec : forall n : nat, double n = n + n.
Proof. Admitted.

Definition main : list string := nil.
