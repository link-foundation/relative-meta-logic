(* rml-certified-item rust/src/address_sequence.rs#SCHEMA@168 target-sha256=65b520c92cf10aba0f7e53d82b4cbb8af411ca75cbd5673249f27d6d5278d788 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition SCHEMA : string :=
  "rml-address-sequence/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/address_sequence.rs#DEFAULT_NAMESPACE@216 target-sha256=c1fb6626244fd79a590aeb7150734684e9c4afeb0a5e0edb56cd3c461bdd546a *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_NAMESPACE : string :=
  "rml:address-sequence:1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/address_sequence.rs#MAX_ELEMENTS@274 target-sha256=f709d48df1f048e26da00e48d3e26d6a17496dd4be5e4f5c7e0b629191675a95 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition MAX_ELEMENTS : N :=
  10000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/address_sequence.rs#MAX_LINKS@310 target-sha256=a2de75aa613eea134e0f54c6c2e22febb61f530a4d6e3657a45a3fb4974ea407 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition MAX_LINKS : N :=
  100000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/address_sequence.rs#MAX_TEXT@344 target-sha256=a2d610ce6444eaa0780939b9b145d39361c72e02410bfa4d47314d286453bc26 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition MAX_TEXT : N :=
  1048576%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
