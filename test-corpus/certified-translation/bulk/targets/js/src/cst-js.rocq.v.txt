(* rml-certified-item js/src/cst-js.mjs#scanString@4808 target-sha256=127a4202223698651d5f55281efcc2d42619abaff3823abb5711bd5407f256ad *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

(* The index a Number names, exactly from its binary form; -1 when it names none. *)
Definition ml_float_index (x : float) : Z :=
  match Prim2SF x with
  | S754_zero _ => 0%Z
  | S754_finite false m e =>
      if Z.leb 0 e then Z.shiftl (Z.pos m) e
      else if Z.eqb (Z.modulo (Z.pos m) (2 ^ (- e))) 0 then Z.div (Z.pos m) (2 ^ (- e)) else (-1)%Z
  | _ => (-1)%Z
  end.

(* The least fixed point of a one-step unfolding F, unfolded lazily: level k
   nests 2^k calls of F before it would reach the fallback. *)
Fixpoint ml_fix {A B : Type} (k : nat) (F : (A -> B) -> A -> B) (fallback : A -> B) : A -> B :=
  match k with
  | O => F fallback
  | S k => fun a => ml_fix k F (ml_fix k F fallback) a
  end.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive ml_scanString_loop1_result : Type :=
| ml_scanString_loop1_done : float -> ml_scanString_loop1_result
| ml_scanString_loop1_return : float -> ml_scanString_loop1_result.

Definition ml_scanString_loop1 (src : (list string)) (j : float) (quote : string) : ml_scanString_loop1_result :=
  ml_fix 64 (fun (ml_rec : (list string) * float * string -> ml_scanString_loop1_result) (ml_args : (list string) * float * string) =>
    let '(src, j, quote) := ml_args in (if (PrimFloat.ltb j (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length src))))) then (let c := (let ml_index := (ml_float_index j) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)) in (if (match (c, "\"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) then (let j_2 := (PrimFloat.add j 2%float) in (ml_rec (src, j_2, quote))) else (if (andb (match (c, "
"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) (orb (String.eqb quote """"%string) (String.eqb quote "'"%string))) then (ml_scanString_loop1_return j) else (if (match (c, quote) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) then (ml_scanString_loop1_return (PrimFloat.add j 1%float)) else (let j_3 := (PrimFloat.add j 1%float) in (ml_rec (src, j_3, quote))))))) else (ml_scanString_loop1_done j)))
    (fun _ => (ml_scanString_loop1_done 0%float)) (src, j, quote).

Definition scanString (src : (list string)) (j : float) (quote : string) : float :=
  (let ml_s1 := (ml_scanString_loop1 src j quote) in (match ml_s1 with | ml_scanString_loop1_done j_2 => j_2 | ml_scanString_loop1_return ml_result1 => ml_result1 end)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
