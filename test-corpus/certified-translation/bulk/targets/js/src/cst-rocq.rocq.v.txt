(* rml-certified-item js/src/cst-rocq.mjs#scanBlockComment@2899 target-sha256=80355ebc0018bc83686ed7fa4a409f343fc6827da23d2c02f1d89d206b3fe656 *)
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

Definition ml_scanBlockComment_loop1 (src : (list string)) (j : float) (depth : float) : float :=
  ml_fix 64 (fun (ml_rec : (list string) * float * float -> float) (ml_args : (list string) * float * float) =>
    let '(src, j, depth) := ml_args in (if (andb (PrimFloat.ltb j (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length src))))) (PrimFloat.ltb 0%float depth)) then (if (andb (match ((let ml_index := (ml_float_index j) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), "("%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) (match ((let ml_index := (ml_float_index (PrimFloat.add j 1%float)) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), "*"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end)) then (let depth_2 := (PrimFloat.add depth 1%float) in (let j_2 := (PrimFloat.add j 2%float) in (ml_rec (src, j_2, depth_2)))) else (if (andb (match ((let ml_index := (ml_float_index j) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), "*"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) (match ((let ml_index := (ml_float_index (PrimFloat.add j 1%float)) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), ")"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end)) then (let depth_3 := (PrimFloat.sub depth 1%float) in (let j_3 := (PrimFloat.add j 2%float) in (ml_rec (src, j_3, depth_3)))) else (let j_4 := (PrimFloat.add j 1%float) in (ml_rec (src, j_4, depth))))) else j))
    (fun _ => 0%float) (src, j, depth).

Definition scanBlockComment (src : (list string)) (i : float) : float :=
  (let j := (PrimFloat.add i 2%float) in (let depth := 1%float in (let j_2 := (ml_scanBlockComment_loop1 src j depth) in j_2))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/cst-rocq.mjs#scanRocqString@3181 target-sha256=b91563e659fa3f9ce9a1c148e6c152a187b82dbce86720645f68345e5b67f9a1 *)
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

Inductive ml_scanRocqString_loop1_result : Type :=
| ml_scanRocqString_loop1_done : float -> ml_scanRocqString_loop1_result
| ml_scanRocqString_loop1_return : float -> ml_scanRocqString_loop1_result.

Definition ml_scanRocqString_loop1 (src : (list string)) (j : float) : ml_scanRocqString_loop1_result :=
  ml_fix 64 (fun (ml_rec : (list string) * float -> ml_scanRocqString_loop1_result) (ml_args : (list string) * float) =>
    let '(src, j) := ml_args in (if (PrimFloat.ltb j (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length src))))) then (if (match ((let ml_index := (ml_float_index j) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), """"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) then (if (match ((let ml_index := (ml_float_index (PrimFloat.add j 1%float)) in if Z.ltb ml_index 0 then None else List.nth_error src (Z.to_nat ml_index)), """"%string) with | (Some ml_left, ml_right) => (String.eqb ml_left ml_right) | _ => false end) then (let j_2 := (PrimFloat.add j 2%float) in (ml_rec (src, j_2))) else (ml_scanRocqString_loop1_return (PrimFloat.add j 1%float))) else (let j_3 := (PrimFloat.add j 1%float) in (ml_rec (src, j_3)))) else (ml_scanRocqString_loop1_done j)))
    (fun _ => (ml_scanRocqString_loop1_done 0%float)) (src, j).

Definition scanRocqString (src : (list string)) (j : float) : float :=
  (let ml_s1 := (ml_scanRocqString_loop1 src j) in (match ml_s1 with | ml_scanRocqString_loop1_done j_2 => j_2 | ml_scanRocqString_loop1_return ml_result1 => ml_result1 end)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/cst-rocq.mjs#isRocqPunctChar@4371 target-sha256=54c3cf4546071328d7bef72a4b6471ca4b16211d03f7c84cf3ebb514e419e4d7 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

(* String.prototype.includes: the search occurs at some position of the string. *)
Definition ml_string_includes (string search : string) : bool :=
  match String.index 0 search string with Some _ => true | None => false end.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition isRocqPunctChar (c : string) : bool :=
  (ml_string_includes "→←⟨⟩∀∃∧∨¬"%string c).

Definition main : list string :=
  nil.

Eval vm_compute in main.
