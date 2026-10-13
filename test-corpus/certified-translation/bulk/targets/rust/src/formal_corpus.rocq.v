(* rml-certified-item rust/src/formal_corpus.rs#SCHEMA@327 target-sha256=1c781b65493f78a29f48e03b71df552fba07e0612f72277f07af8337d5ad2004 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition SCHEMA : string :=
  "linked-source-v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
