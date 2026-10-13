(* rml-certified-item rust/src/meta_language_support.rs#RML_META_LANGUAGE@323 target-sha256=55ffbcb4ddd827f668d928d8420f5759874a1b12a3039677d39b8843937a570e *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition RML_META_LANGUAGE : string :=
  "RML"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/meta_language_support.rs#JAVA_SCRIPT_LANGUAGE@366 target-sha256=9814392d78ee797136cd98717507ef3ab253a697500111c3f6010ed5035c6bbe *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition JAVA_SCRIPT_LANGUAGE : string :=
  "JavaScript"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
