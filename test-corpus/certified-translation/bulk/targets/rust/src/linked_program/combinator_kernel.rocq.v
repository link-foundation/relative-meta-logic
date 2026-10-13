(* rml-certified-item rust/src/linked_program/combinator_kernel.rs#DEFAULT_MAX_CONTRACTIONS@436 target-sha256=a6085cf1e26752f4765baedbe118a83a1047061d5d542345caac24f70fbcaa69 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DEFAULT_MAX_CONTRACTIONS : N :=
  100000000%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program/combinator_kernel.rs#CONTRACTION_LIMIT_PREFIX@500 target-sha256=23d64f25281b22cf8f634343b36f5e59779b0a391ce8b808bafb86ab809360ea *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition CONTRACTION_LIMIT_PREFIX : string :=
  "combinator contraction limit "%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/linked_program/combinator_kernel.rs#is_contraction_limit@805 target-sha256=e7ae234ef85b6f5966a63b44e32af85a7fba47be1c3f21f038e18b9fdbeb977c *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

(* String.prototype.startsWith: the string begins with the search. *)
Definition ml_string_starts_with (string search : string) : bool := String.prefix search string.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition CONTRACTION_LIMIT_PREFIX : string :=
  "combinator contraction limit "%string.

Definition is_contraction_limit (message : string) : bool :=
  (ml_string_starts_with message CONTRACTION_LIMIT_PREFIX).

Definition main : list string :=
  nil.

Eval vm_compute in main.
