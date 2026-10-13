(* rml-certified-item js/src/rml-control-flow-javascript.mjs#typeOf@764 target-sha256=a1b6a2ba9b8389eaebec68410fddcdd60794eda13949aae0ee3020b27125c1f1 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition typeOf (value : (option float)) : string :=
  (if (match (value, (@None unit)) with | (Some ml_left, Some ml_right) => false | (None, None) => true | _ => false end) then "unit"%string else (if (String.eqb (match value with | Some ml_present => "number"%string | None => "object"%string end) "boolean"%string) then "bool"%string else "int"%string)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
