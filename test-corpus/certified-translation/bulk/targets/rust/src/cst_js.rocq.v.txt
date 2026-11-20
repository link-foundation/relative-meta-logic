(* rml-certified-item rust/src/cst_js.rs#LastKind@620 target-sha256=4fe88d40039de7d214220e4b805412367365ba87acdd9e48e6eb51bffdd6e22c *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive LastKind : Type :=
| None_ : LastKind
| Trivia : LastKind
| Ident : LastKind
| Punct : LastKind
| Other : LastKind.

Definition main : list string :=
  nil.

Eval vm_compute in main.
