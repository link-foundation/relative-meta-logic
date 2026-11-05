(* rml-certified-item js/src/rml-control-flow-rust.mjs#id@1000 target-sha256=8149deb0513b3d52fb4217561517554678ace3efa68ab511bd3e0eef012f2378 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition id (name : float) : (float * string)%type :=
  (let ml_field1 := "Identifier"%string in (let ml_field2 := name in (ml_field2, ml_field1))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-control-flow-rust.mjs#literal@1043 target-sha256=60d63a44d79179ef55fadb306c7324ccba76d5c81bebc6e9140ac01ed827e493 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition literal (value : float) : (string * float)%type :=
  (let ml_field1 := (if (String.eqb "number"%string "boolean"%string) then "BooleanLiteral"%string else "NumericLiteral"%string) in (let ml_field2 := value in (ml_field1, ml_field2))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-control-flow-rust.mjs#block@1139 target-sha256=05d2e8e0271b80419b8c80a4caa069818b978273213aed23236a7aff0f1e3447 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition block (body : float) : (float * (list float) * string)%type :=
  (let ml_field1 := "BlockStatement"%string in (let ml_field2 := body in (let ml_field3 := (@nil float) in (ml_field2, ml_field3, ml_field1)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-control-flow-rust.mjs#expressionStatement@1203 target-sha256=a7f728295168961a7b18c41687ac8ae7251aead9566f37a6d6729e755e819bc5 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition expressionStatement (expression : float) : (float * string)%type :=
  (let ml_field1 := "ExpressionStatement"%string in (let ml_field2 := expression in (ml_field2, ml_field1))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-control-flow-rust.mjs#binary@1448 target-sha256=a5a5c8f7a3799f6c5c5b3a56a993489f7cf1666c13729fa3069045240daba0ec *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition binary (operator : float) (left_ : float) (right_ : float) : (float * float * float * string)%type :=
  (let ml_field1 := "BinaryExpression"%string in (let ml_field2 := operator in (let ml_field3 := left_ in (let ml_field4 := right_ in (ml_field3, ml_field2, ml_field4, ml_field1))))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
