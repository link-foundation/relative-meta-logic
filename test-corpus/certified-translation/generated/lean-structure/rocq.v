(* Translated from Lean by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Fixpoint ml_digits (fuel : nat) (n : N) (acc : string) : string :=
  match fuel with
  | O => acc
  | S rest =>
      let acc' := String (ascii_of_N (48 + N.modulo n 10)) acc in
      if N.ltb n 10 then acc' else ml_digits rest (N.div n 10) acc'
  end.
Definition ml_N_to_string (n : N) : string := ml_digits (S (N.size_nat n)) n EmptyString.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive Point : Type :=
| mk : N -> N -> Point.

Module Point.

Definition x (ml_arg0 : Point) : N :=
  (match ml_arg0 with | mk ml_field ml_f1 => ml_field end).

Definition y (ml_arg0 : Point) : N :=
  (match ml_arg0 with | mk ml_f2 ml_field => ml_field end).

End Point.

Inductive Segment : Type :=
| mk_2 : Point -> Point -> Segment.

Module Segment.

Definition start (ml_arg0 : Segment) : Point :=
  (match ml_arg0 with | mk_2 ml_field ml_f3 => ml_field end).

Definition stop (ml_arg0 : Segment) : Point :=
  (match ml_arg0 with | mk_2 ml_f4 ml_field => ml_field end).

End Segment.

Inductive Pairs_Nat : Type :=
| done : Pairs_Nat
| more : N -> N -> Pairs_Nat -> Pairs_Nat.

Inductive Pairs_String : Type :=
| done_2 : Pairs_String
| more_2 : string -> string -> Pairs_String -> Pairs_String.

Fixpoint count_Nat (ml_arg0 : Pairs_Nat) {struct ml_arg0} : N :=
  (match ml_arg0 with | done => 0%N | more ml_f5 ml_f6 rest => (N.add 1%N (count_Nat rest)) end).

Fixpoint count_String (ml_arg0 : Pairs_String) {struct ml_arg0} : N :=
  (match ml_arg0 with | done_2 => 0%N | more_2 ml_f7 ml_f8 rest => (N.add 1%N (count_String rest)) end).

Definition norm (p : Point) : N :=
  (N.add (Point.x p) (Point.y p)).

Definition span (s : Segment) : N :=
  (N.sub (Point.x (Segment.stop s)) (Point.x (Segment.start s))).

Definition main : list string :=
  (ml_N_to_string (norm (mk 3%N 4%N))) ::
  (ml_N_to_string (span (mk_2 (mk 1%N 0%N) (mk 6%N 9%N)))) ::
  (ml_N_to_string (Point.y (mk 2%N 5%N))) ::
  (ml_N_to_string (count_Nat (more 1%N 2%N done))) ::
  (ml_N_to_string (count_String done_2)) ::
  nil.

Eval vm_compute in main.
