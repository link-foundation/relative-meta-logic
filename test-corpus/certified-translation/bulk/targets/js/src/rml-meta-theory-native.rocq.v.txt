(* rml-certified-item js/src/rml-meta-theory-native.mjs#compare@1497 target-sha256=695c17b42fb14a332d85ec5522742ad36d11cf0895400d2984429e897e040924 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition compare (left_ : float) (right_ : float) : float :=
  (if (PrimFloat.ltb left_ right_) then (PrimFloat.opp 1%float) else (if (PrimFloat.ltb right_ left_) then 1%float else 0%float)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-meta-theory-native.mjs#value@17336 target-sha256=681ada0d185e04e7c3cfd33685f858b7bf95e2b388fea8a0a3592203d9012941 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition value (raw : string) : (list string) :=
  ("mt-v"%string :: raw :: @nil string).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-meta-theory-native.mjs#fixed@18133 target-sha256=c0730b1f9c7a16806904f6c03da11150a5ba1d0efbbdf5ae403fa95a95e5da5f *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition fixed (arity : float) (build : float) : (float * float)%type :=
  (let ml_field1 := arity in (let ml_field2 := build in (ml_field1, ml_field2))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-meta-theory-native.mjs#tag@18185 target-sha256=e1345446d3ccd347f5051b5e98ce26c2e9a014f551ef28cdabad1ffdca97e8ea *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition value (raw : string) : (list string) :=
  ("mt-v"%string :: raw :: @nil string).

Definition fixed (arity : float) (build : ((list string) -> (list string))) : (float * ((list string) -> (list string)))%type :=
  (let ml_field1 := arity in (let ml_field2 := build in (ml_field1, ml_field2))).

Definition tag (name : string) (arity : float) : (float * ((list string) -> (list string)))%type :=
  (fixed arity (fun (args : (list string)) => (if (PrimFloat.eqb arity 0%float) then (value name) else (List.app (name :: @nil string) args)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
