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

Inductive NatList : Type :=
| nil_ : NatList
| cons_ : N -> NatList -> NatList.

Fixpoint length (ml_arg0 : NatList) {struct ml_arg0} : N :=
  (match ml_arg0 with | nil_ => 0%N | cons_ ml_f1 rest => (N.add 1%N (length rest)) end).

Fixpoint total (ml_arg0 : NatList) {struct ml_arg0} : N :=
  (match ml_arg0 with | nil_ => 0%N | cons_ head rest => (N.add head (total rest)) end).

Fixpoint append (left_ : NatList) (right_ : NatList) {struct left_} : NatList :=
  (match left_ with | nil_ => right_ | cons_ head rest => (cons_ head (append rest right_)) end).

Definition classify (n : N) : string :=
  (if (N.eqb n 0%N) then "empty"%string else (if (N.ltb n 3%N) then "short"%string else "long"%string)).

Theorem add_zero_right (n : N) : ((N.add n 0%N) = n).
Proof.
  ml_N_norm; cbv beta iota zeta; first [ml_close].
Qed.

Definition main : list string :=
  (ml_N_to_string (length (append (cons_ 1%N (cons_ 2%N nil_)) (cons_ 3%N nil_)))) ::
  (ml_N_to_string (total (cons_ 10%N (cons_ 20%N (cons_ 12%N nil_))))) ::
  (classify (length nil_)) ::
  (classify (length (cons_ 4%N (cons_ 5%N (cons_ 6%N nil_))))) ::
  nil.

Eval vm_compute in main.
