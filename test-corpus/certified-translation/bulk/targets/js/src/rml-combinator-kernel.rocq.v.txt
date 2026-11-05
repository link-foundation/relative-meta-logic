(* rml-certified-item js/src/rml-combinator-kernel.mjs#app@472 target-sha256=e96acbb5f38c1c8c66bd00e0cbe7c9dd7be3af54a99ae24e7ea76dbc2e370c5d *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition app (left_ : float) (right_ : float) : (list float) :=
  (left_ :: right_ :: @nil float).

Definition main : list string :=
  nil.

Eval vm_compute in main.
