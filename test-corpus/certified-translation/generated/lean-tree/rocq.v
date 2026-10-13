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

Module Shapes.

Inductive Tree : Type :=
| leaf : N -> Tree
| node : Tree -> Tree -> Tree.

Fixpoint sum (ml_arg0 : Tree) {struct ml_arg0} : N :=
  (match ml_arg0 with | leaf value => value | node left_ right_ => (N.add (sum left_) (sum right_)) end).

Fixpoint size (tree : Tree) {struct tree} : N :=
  (match tree with | leaf ml_f1 => 1%N | node left_ right_ => (N.add (size left_) (size right_)) end).

End Shapes.

Definition double (n : N) : N :=
  (N.add n n).

Theorem double_two : ((double 2%N) = 4%N).
Proof.
  cbn [double]; ml_N_norm; cbv beta iota zeta; first [(vm_compute; reflexivity) | ml_close].
Qed.

Definition main : list string :=
  (ml_N_to_string (Shapes.sum (Shapes.node (Shapes.leaf 2%N) (Shapes.node (Shapes.leaf 3%N) (Shapes.leaf 4%N))))) ::
  (ml_N_to_string (Shapes.size (Shapes.node (Shapes.leaf 2%N) (Shapes.leaf 5%N)))) ::
  (ml_N_to_string (double 21%N)) ::
  nil.

Eval vm_compute in main.
