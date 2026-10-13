(* rml-certified-item rust/src/linked_proof.rs#LINKED_PROOF_PROGRAM@401 target-sha256=c947a538f49624713112e35ae854d8fcf49d883fab006cf4124eed6612dcd5b1 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition LINKED_PROOF_PROGRAM : string :=
  "linked-proof-verifier"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_proof.rs#LINKED_PROOF_SCHEMA@465 target-sha256=18df2d29b379255aff7e43a43b6d18fb72e3cc5d666b7d63ad75d94d48c69d4f *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition LINKED_PROOF_SCHEMA : string :=
  "rml-linked-proof-replay/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_proof.rs#MAX_LINKED_PROOF_DEPTH@746 target-sha256=e3e07d98542da0d66780971a1b3b80de58fa95dbbe3ce6a228afc5c4825d34a1 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition MAX_LINKED_PROOF_DEPTH : N :=
  256%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
