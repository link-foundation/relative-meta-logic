(* rml-certified-item rust/src/lambda_kernel.rs#DEFAULT_MAX_TRANSITIONS@721 target-sha256=c5f16187fedb429058ab712e1b3f5e67d569dc2301c1ad35cc16cd32fc109c9b *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_MAX_TRANSITIONS : N :=
  100000000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lambda_kernel.rs#CONTRACTION_LIMIT_PREFIX@777 target-sha256=73ec3c273ac704f0d9188c5aaa64bf03e728a875d005aca758d173ccbd19c598 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition CONTRACTION_LIMIT_PREFIX : string :=
  "lambda transition limit "%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
