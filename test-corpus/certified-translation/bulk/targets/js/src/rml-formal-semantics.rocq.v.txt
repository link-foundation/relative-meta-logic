(* rml-certified-item js/src/rml-formal-semantics.mjs#text@723 target-sha256=ac08a226491be5a756ed3f03ad69af8cb025e02f66e1ab77cd4eafdc53ef594e *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition text (tokens : (list (float)%type)) : (list float) :=
  (let ml_values := tokens in let ml_callback := (fun (token : (float)%type) => token) in  List.map (fun ml_pair => (ml_callback (fst ml_pair))) (List.combine ml_values (List.seq 0 (List.length ml_values)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
