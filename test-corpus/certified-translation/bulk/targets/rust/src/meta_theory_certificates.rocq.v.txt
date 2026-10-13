(* rml-certified-item rust/src/meta_theory_certificates.rs#META_THEORY_CERTIFICATE_SCHEMA@1085 target-sha256=073855f960fd8cdd37e989ee87503f905484e4d63294ec1889c6be4898ca8195 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition META_THEORY_CERTIFICATE_SCHEMA : string :=
  "rml-meta-theory-certificate/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/meta_theory_certificates.rs#VERIFIER_STEPS@1168 target-sha256=dc530798f1216165141f4bb264fe2cf70a9eb37ee8055d1e29fbc9da70349bdf *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition VERIFIER_STEPS : N :=
  2000000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
