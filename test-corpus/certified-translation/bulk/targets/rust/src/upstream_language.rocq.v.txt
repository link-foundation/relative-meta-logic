(* rml-certified-item rust/src/upstream_language.rs#META_LANGUAGE_SOURCE_REVISION@835 target-sha256=34e13ff06c964004c60d99de910b54ad5fc869310c2a3f2889a4fb24f639f3bb *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition META_LANGUAGE_SOURCE_REVISION : string :=
  "a79782093cae3b33606483ac9f3e1d05faf36de0"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
