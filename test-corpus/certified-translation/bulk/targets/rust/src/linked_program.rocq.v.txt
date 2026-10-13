(* rml-certified-item rust/src/linked_program.rs#PREVIOUS_METRIC_REVISION@2287 target-sha256=ec5283cd37d9a09b1c727cadf0b6a07254edeb981bf77d59e66d5e37715a3a5b *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition PREVIOUS_METRIC_REVISION : string :=
  "8b39df510a083e5cbe2a56a72e6595aae7b48146"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#SearchEnd@4435 target-sha256=3d42dfda94d4df5431ce996f7801df3cbb862e50d06bc7c5bdff675e28470ee9 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive SearchEnd : Type :=
| Found : SearchEnd
| Saturated : SearchEnd
| InferenceLimit : SearchEnd
| FactLimit : SearchEnd.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#GoalNormalization@5136 target-sha256=7a2b418e3c8fc52b2c11664ade41aef014813851fe66b96d176f21c47fbfbbfe *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive GoalNormalization : Type :=
| Normal : GoalNormalization
| RewriteLimit : GoalNormalization
| RewriteCycle : GoalNormalization
| RewriteStalled : GoalNormalization
| ContractionLimit : GoalNormalization.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#ReduceFailure@6988 target-sha256=345ee82d658540df2df94827cdacb8c93d22314b2c06405a3b71495c1cb5e13e *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive ReduceFailure : Type :=
| Limit : string -> ReduceFailure
| Cycle : string -> ReduceFailure
| Stalled : string -> ReduceFailure
| ContractionLimit : string -> ReduceFailure
| Other : string -> ReduceFailure.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#AddedFact@8379 target-sha256=48683429632e82d165b4cb7bb7fba32c93de3c6fb72fbd0b036e0a2b03e876c7 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive AddedFact : Type :=
| Duplicate : AddedFact
| New : AddedFact
| OverLimit : AddedFact.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#OrientationContract@124214 target-sha256=5d68445fda61eb72b50fbd52015c3ae29f6330766f37ad52f30508689e75b8bc *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive OrientationContract : Type :=
| Named : OrientationContract
| Anonymous : OrientationContract
| Unordered : OrientationContract.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program.rs#orientation_contract_id@124713 target-sha256=202fbbafda5d9b36d16ce0e025e1b66367249776e64a609c76b92d8663d68d4d *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive OrientationContract : Type :=
| Named : OrientationContract
| Anonymous : OrientationContract
| Unordered : OrientationContract.

Definition orientation_contract_id (contract : OrientationContract) : string :=
  (match contract with | Named => "named-ordered-slots"%string | Anonymous => "anonymous-ordered-slots"%string | Unordered => "unordered-slots"%string end).

Definition main : list string :=
  nil.

Eval vm_compute in main.
