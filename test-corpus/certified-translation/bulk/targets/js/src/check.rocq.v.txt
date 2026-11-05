(* rml-certified-item js/src/check.mjs#prefixMarker@6432 target-sha256=1b6b6cdf7330b15e8fd35616e2ddc269a62c970d9fe4c8bd217d6d5081b40cbc *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition prefixMarker (name : string) : string :=
  (let ml_switch1 := name in (if (String.eqb ml_switch1 "not"%string) then "not"%string else (if (String.eqb ml_switch1 "and"%string) then "and"%string else (if (String.eqb ml_switch1 "or"%string) then "or"%string else (if (String.eqb ml_switch1 "+"%string) then "sum"%string else (if (String.eqb ml_switch1 "-"%string) then "difference"%string else (if (String.eqb ml_switch1 "*"%string) then "product"%string else (if (String.eqb ml_switch1 "/"%string) then "quotient"%string else "reduce"%string)))))))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/check.mjs#isOk@18029 target-sha256=2e3abfeab28ddac25c5dffbc12e3f94fa36343ccbc96c10c4abf3d00e2e99a24 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition isOk (result : ((list float))%type) : bool :=
  (PrimFloat.eqb (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length result)))) 0%float).

Definition main : list string :=
  nil.

Eval vm_compute in main.
