(* rml-certified-item rust/src/meta_theory_native.rs#META_THEORY_NATIVE_PROGRAM@722 target-sha256=33d142660855bba43c0feedd8475dc3c767ec659066c4a909b42b2fe0cd2593a *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition META_THEORY_NATIVE_PROGRAM : string :=
  "upstream-0.0.3-native"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/meta_theory_native.rs#META_THEORY_CONVERSION_PROGRAM@792 target-sha256=db0cf01afc5febf84c8e55260b4874a00bc9f2591841898dae59d5c85bf7f53c *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition META_THEORY_CONVERSION_PROGRAM : string :=
  "upstream-0.0.3-native-conversion"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/meta_theory_native.rs#NATIVE_COMMAND_SECTION@877 target-sha256=660170d475c973d3ade03f3e09bf9ad6c8eb523e91d30492b388f9fb8ca36e7d *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition NATIVE_COMMAND_SECTION : string :=
  "commands"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/meta_theory_native.rs#NATIVE_MAX_STEPS@930 target-sha256=a1b88f10ecfcbc4fb394e4c51e1e02735283ad8d776ff4bfef923257dba41e9f *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition NATIVE_MAX_STEPS : N :=
  200000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
