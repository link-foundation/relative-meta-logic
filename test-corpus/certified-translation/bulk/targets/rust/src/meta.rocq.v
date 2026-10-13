(* rml-certified-item rust/src/meta.rs#CheckKind@1800 target-sha256=73ab4bbd76194fe5563a290ebcdce7e85a9d2e63fff7b4f46767207c67361318 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive CheckKind : Type :=
| Totality : CheckKind
| Coverage : CheckKind
| Termination : CheckKind.

Definition main : list string :=
  nil.

Eval vm_compute in main.
