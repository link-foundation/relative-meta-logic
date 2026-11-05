(* An enumeration, a recursive list of naturals, boolean guards and a universal theorem. *)
From Stdlib Require Import String Arith Lia DecimalString.
Open Scope string_scope.

Inductive priority : Type :=
  | Low : priority
  | High : priority.

Inductive queue : Type :=
  | Empty : queue
  | Push : priority -> nat -> queue -> queue.

Definition weight (p : priority) : nat :=
  match p with
  | Low => 1
  | High => 10
  end.

Fixpoint score (q : queue) : nat :=
  match q with
  | Empty => 0
  | Push p n rest => weight p * n + score rest
  end.

Fixpoint urgent (q : queue) : nat :=
  match q with
  | Empty => 0
  | Push High _ rest => 1 + urgent rest
  | Push Low _ rest => urgent rest
  end.

Definition label (n : nat) : string := if Nat.ltb n 50 then "calm" else "busy".

Theorem score_empty_plus : forall n : nat, score Empty + n = n.
Proof. intros n. simpl. lia. Qed.

Definition main : list string :=
  (NilEmpty.string_of_uint (Nat.to_uint (score (Push High 3 (Push Low 7 Empty))))) ::
  (NilEmpty.string_of_uint (Nat.to_uint (urgent (Push High 3 (Push Low 7 (Push High 1 Empty)))))) ::
  (label (score (Push High 3 (Push Low 7 Empty)))) ::
  (label (score (Push Low 2 Empty))) ::
  nil.

Eval vm_compute in main.
