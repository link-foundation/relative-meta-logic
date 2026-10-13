(* rml-certified-item rust/src/meta_language_structure.rs#RML_STRUCTURE_SCHEMA@902 target-sha256=a45165c928b3bf6445f4f6c1e1e5e3c2dc75021bc7c73f9f64962bae87d88460 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition RML_STRUCTURE_SCHEMA : string :=
  "rml:structure:1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
