(* rml-certified-item rust/src/lib.rs#DECIMAL_PRECISION@20894 target-sha256=6cbd4544870e67e1010a5046a371251d81ed3300cfbdbd0846e9bfc56723030d *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DECIMAL_PRECISION : Z :=
  12%Z.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#Aggregator@21819 target-sha256=5aa1762741e245d61c9bcd06987c8a9feb19041b1b9640a884695d7f8401ce42 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive Aggregator : Type :=
| Avg : Aggregator
| Min : Aggregator
| Max : Aggregator
| Prod : Aggregator
| Ps : Aggregator.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#ModeFlag@49434 target-sha256=ba39138f99809b97a5780885fbd9d43e8139d09bb936dbf5f2992304be6f251d *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive ModeFlag : Type :=
| In : ModeFlag
| Out : ModeFlag
| Either : ModeFlag.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#token_base_name@108454 target-sha256=cf79794b1110ae4b7d6e67829dc8487a1434def948488921d4f86bb7b65b7713 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition token_base_name (token : string) : string :=
  token.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#DEFAULT_SIMPLIFY_MAX_STEPS@279286 target-sha256=69591937721741bdc3b61dc2dcb22489d01b80d33a30124716f16ba34f739697 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_SIMPLIFY_MAX_STEPS : N :=
  100%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#DEFAULT_ATP_TIMEOUT_MS@279333 target-sha256=207054a3fb6205f123256d5f7e3c4d138c2747f70553c374109a0dc193e386d4 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_ATP_TIMEOUT_MS : N :=
  5000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#DEFAULT_SMT_TIMEOUT_MS@279375 target-sha256=819631e3d6ac68c011f084fcd2591747ef00e9987cb06a6f9a10693e6f721306 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_SMT_TIMEOUT_MS : N :=
  5000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#RewriteDirection@279691 target-sha256=7e72956a91d1d2ee6f451b51090677d129e3c27349b70dff54fd24b1539512ce *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive RewriteDirection : Type :=
| Forward : RewriteDirection
| Backward : RewriteDirection.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#RewriteOccurrence@279849 target-sha256=99123db84383fdecf057f8a1a0ab3b04995b610c66819867910ec88f9294ba29 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive RewriteOccurrence : Type :=
| All : RewriteOccurrence
| Index : N -> RewriteOccurrence.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#AtpStatusKind@281521 target-sha256=bd79b4c479751e5960b2ba3aaeba9a4b4421f974beda4b8c9d22d0fca801d410 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive AtpStatusKind : Type :=
| Proved : AtpStatusKind
| Unknown : AtpStatusKind
| Timeout : AtpStatusKind
| Failure : AtpStatusKind.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#SmtSort@284722 target-sha256=7fc51210be0d0cd81359b0ac61e6ab2a3256f7c57e53b45836069928482036ea *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive SmtSort : Type :=
| Bool_ : SmtSort
| Real : SmtSort.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#SmtStatus@285066 target-sha256=71977829fa1002b3f0f0b4742664838a4d8f66e53a6578e99e7ff6e5bb211d48 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive SmtStatus : Type :=
| Unsat : SmtStatus
| Sat : SmtStatus
| Unknown : SmtStatus
| Timeout : SmtStatus
| Error : SmtStatus.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#FormalizationResultValue@438408 target-sha256=930c9577f623eb1fdf91ded0263dcf4ab6c06c2751ed6404f230b8338e8ff4a1 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive FormalizationResultValue : Type :=
| Number : float -> FormalizationResultValue
| TruthValue : float -> FormalizationResultValue
| Type_ : string -> FormalizationResultValue
| Partial : string -> FormalizationResultValue.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lib.rs#ExtractTarget@447128 target-sha256=cb4aedee9543c08c80b7439a3b8bc4c4d7589267e7e9dae483306d0b75e724c4 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive ExtractTarget : Type :=
| JavaScript : ExtractTarget
| Rust : ExtractTarget.

Definition main : list string :=
  nil.

Eval vm_compute in main.
