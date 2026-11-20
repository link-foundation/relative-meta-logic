(* rml-certified-item rust/src/cst.rs#dialects@436 target-sha256=011ef2833b1e655281890ee991d3f46d32c715784bc3a8a310f9a3e092b67511 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Module dialects.

Definition RUST : string :=
  "lino-cst.rust"%string.

Definition JS : string :=
  "lino-cst.js"%string.

Definition LEAN : string :=
  "lino-cst.lean"%string.

Definition ROCQ : string :=
  "lino-cst.rocq"%string.

Definition SHARED : string :=
  "lino-cst.shared"%string.

End dialects.

Definition main : list string :=
  nil.

Eval vm_compute in main.
