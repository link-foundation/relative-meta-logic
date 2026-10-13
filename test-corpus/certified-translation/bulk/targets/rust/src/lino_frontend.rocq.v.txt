(* rml-certified-item rust/src/lino_frontend.rs#MAX_LINO_NESTING_DEPTH@4785 target-sha256=cf2de8fa5e6047c3f1e7e9c08bde254f8e2308deefdcb5d44fa071cf03d754e0 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition MAX_LINO_NESTING_DEPTH : N :=
  64%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lino_frontend.rs#MAX_LINO_SOURCE_UNITS@4909 target-sha256=7fd9d4ec8f4e175d2b37b6f3c57d2caebca83a33493dcd665a31ebd5f2cb45ec *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

(* The lines a step of main prints, before the lines the rest of main prints
   and the message of the abort that stops it, if one does. *)
Definition ml_emit (lines : list string) (rest : list string * option string) : list string * option string :=
  (app lines (fst rest), snd rest).

Inductive ml_io1 : Type :=
| ml_io1_mk : list string -> N -> ml_io1
| ml_io1_abort : list string -> string -> ml_io1.

Definition MAX_LINO_SOURCE_UNITS (ml_out : list string) : ml_io1 :=
  (let ml_scrutinee := (let ml_w1 := (N.mul 10%N 1024%N) in (if (N.ltb 18446744073709551615%N ml_w1) then (ml_io1_abort ml_out "attempt to multiply with overflow"%string) else (ml_io1_mk ml_out ml_w1))) in (match ml_scrutinee with | ml_io1_mk ml_o2 ml_v3 => (let ml_w4 := (N.mul ml_v3 1024%N) in (if (N.ltb 18446744073709551615%N ml_w4) then (ml_io1_abort ml_o2 "attempt to multiply with overflow"%string) else (ml_io1_mk ml_o2 ml_w4))) | ml_io1_abort ml_o5 ml_m6 => (ml_io1_abort ml_o5 ml_m6) end)).

Definition main : list string * option string :=
  (nil, None).

Eval vm_compute in main.
(* rml-certified-item rust/src/lino_frontend.rs#LINO_PIECE_DEPTH@5117 target-sha256=832c8eeaab3b0ce1322270c01240f33ee9a1c709706cf25536267e0c52b1df08 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition LINO_PIECE_DEPTH : N :=
  2%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lino_frontend.rs#DROPPED_LINE@31975 target-sha256=9733c288502c974a91a2d0a954e549ee0bec29fcc7b0c189bb51d0c82b673430 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition DROPPED_LINE : string :=
  "unexpected indentation under a value of an indented id"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/lino_frontend.rs#PRIVATE_USE_COUNT@35678 target-sha256=a90ef02cf06a554b56b4b278f0ef5a5e977e11cc1d6daa600847f6ad76b0924e *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition PRIVATE_USE_COUNT : N :=
  6400%N.

Definition main : list string :=
  nil.

Eval vm_compute in main.
