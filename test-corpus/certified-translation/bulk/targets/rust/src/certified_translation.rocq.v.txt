(* rml-certified-item rust/src/certified_translation.rs#CERTIFIED_TRANSLATION_SCHEMA@873 target-sha256=e78c37426f8088005780959ed6505fe7485295a0ac3961db70d739aaa61d959b *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition CERTIFIED_TRANSLATION_SCHEMA : string :=
  "rml:translation-certificate:1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/certified_translation.rs#TRANSLATION_REFUSAL_SCHEMA@953 target-sha256=3ac51c75183e64f30d4ead54c4852e10c8dd384ae1bc2e3c76004ead0397d67c *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition TRANSLATION_REFUSAL_SCHEMA : string :=
  "rml:translation-refusal:1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
