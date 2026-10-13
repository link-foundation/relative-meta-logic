(* Records, record instances, projections and explicitly instantiated parameterised inductives. *)
From Stdlib Require Import String Arith DecimalString.
Open Scope string_scope.

Record point : Type := mkPoint { px : nat; py : nat }.

Inductive bag (A : Type) : Type :=
  | none : bag A
  | some : A -> bag A -> bag A.

Fixpoint size (A : Type) (b : bag A) : nat :=
  match b with
  | none _ => 0
  | some _ _ rest => S (size A rest)
  end.

Definition norm (p : point) : nat := px p + p.(py).

Definition main : list string :=
  (NilEmpty.string_of_uint (Nat.to_uint (norm {| px := 3; py := 4 |}))) ::
  (NilEmpty.string_of_uint (Nat.to_uint ({| py := 9; px := 1 |}.(py)))) ::
  (NilEmpty.string_of_uint (Nat.to_uint (size nat (some nat 1 (some nat 2 (none nat)))))) ::
  nil.

Eval vm_compute in main.
