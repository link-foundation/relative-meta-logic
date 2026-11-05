(* rml-certified-item js/src/rml-foundation-search.mjs#permutations@3045 target-sha256=6afea381cb09e8b43e5c1c14cafd902d79f8e22b4c7dbe804bae86aba747f302 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

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

Definition permutations (values : (list float)) : (list (list float)) :=
  ml_fix 64 (fun (ml_rec : (list float) -> (list (list float))) (values : (list float)) =>
    (if (PrimFloat.eqb (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length values)))) 0%float) then ((@nil float) :: @nil (list float)) else (let ml_values := values in let ml_callback := (fun (value : float) (index : float) => (let rest := (let ml_values := values in let ml_callback := (fun (_ : float) (candidate : float) => (negb (PrimFloat.eqb candidate index))) in  List.map (@fst float nat) (List.filter (fun ml_pair => (ml_callback (fst ml_pair) (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (snd ml_pair)))))) (List.combine ml_values (List.seq 0 (List.length ml_values))))) in (let ml_values := (ml_rec rest) in let ml_callback := (fun (permutation : (list float)) => (List.app (value :: @nil float) permutation)) in  List.map (fun ml_pair => (ml_callback (fst ml_pair))) (List.combine ml_values (List.seq 0 (List.length ml_values)))))) in  List.flat_map (fun ml_pair => (ml_callback (fst ml_pair) (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (snd ml_pair)))))) (List.combine ml_values (List.seq 0 (List.length ml_values))))))
    (fun _ => (@nil (list float))) values.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-foundation-search.mjs#applyObservationAction@4217 target-sha256=0abad182bd87d713ded0685a2c3eb38f7079eca1dd7ef2ba66e860a95908fbff *)
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

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition applyObservationAction (assignment : (list float)) (action : ((list float) * (list float))%type) : (list (option float)) :=
  (let ml_values := (fst action) in let ml_callback := (fun (occurrence : float) => (let ml_index := (ml_float_index (match (let ml_index := (ml_float_index occurrence) in if Z.ltb ml_index 0 then None else List.nth_error assignment (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end)) in if Z.ltb ml_index 0 then None else List.nth_error (snd action) (Z.to_nat ml_index))) in  List.map (fun ml_pair => (ml_callback (fst ml_pair))) (List.combine ml_values (List.seq 0 (List.length ml_values)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-foundation-search.mjs#observationSignature@5435 target-sha256=88bd7daf86f2fa5b1f2ce915409094c3d0829fb9b9994c44c4a8849e71a8a3d8 *)
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

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition observationSignature (assignment : (list float)) : string :=
  (if (match ((let ml_index := (ml_float_index 0%float) in if Z.ltb ml_index 0 then None else List.nth_error assignment (Z.to_nat ml_index)), (let ml_index := (ml_float_index 1%float) in if Z.ltb ml_index 0 then None else List.nth_error assignment (Z.to_nat ml_index))) with | (Some ml_left, Some ml_right) => (PrimFloat.eqb ml_left ml_right) | (None, None) => true | _ => false end) then "same-reference"%string else "distinct-references"%string).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-foundation-search.mjs#mapsCommute@6051 target-sha256=816ba4bb86251a0a132dddd22a62156efa07e0b961a142db026b838fb934ff19 *)
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

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition mapsCommute (left_ : (list float)) (right_ : (list float)) : bool :=
  (let ml_values := left_ in let ml_callback := (fun (_ : float) (index : float) => (match ((let ml_index := (ml_float_index (match (let ml_index := (ml_float_index index) in if Z.ltb ml_index 0 then None else List.nth_error right_ (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end)) in if Z.ltb ml_index 0 then None else List.nth_error left_ (Z.to_nat ml_index)), (let ml_index := (ml_float_index (match (let ml_index := (ml_float_index index) in if Z.ltb ml_index 0 then None else List.nth_error left_ (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end)) in if Z.ltb ml_index 0 then None else List.nth_error right_ (Z.to_nat ml_index))) with | (Some ml_left, Some ml_right) => (PrimFloat.eqb ml_left ml_right) | (None, None) => true | _ => false end)) in  List.forallb (fun ml_pair => (ml_callback (fst ml_pair) (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (snd ml_pair)))))) (List.combine ml_values (List.seq 0 (List.length ml_values)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-foundation-search.mjs#hasRecord@29269 target-sha256=d1affcccea4ef2eaa5314c660ef9ff8db16368a44fef83572b701e0cc54ce74d *)
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

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition hasRecord (records : (list (list (option float)))) (expected : (list float)) : bool :=
  (let ml_values := records in let ml_callback := (fun (record : (list (option float))) => (andb (PrimFloat.eqb (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length record)))) (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length expected))))) (let ml_values := record in let ml_callback := (fun (value : (option float)) (index : float) => (match (value, (let ml_index := (ml_float_index index) in if Z.ltb ml_index 0 then None else List.nth_error expected (Z.to_nat ml_index))) with | (Some ml_left, Some ml_right) => (PrimFloat.eqb ml_left ml_right) | (None, None) => true | _ => false end)) in  List.forallb (fun ml_pair => (ml_callback (fst ml_pair) (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (snd ml_pair)))))) (List.combine ml_values (List.seq 0 (List.length ml_values)))))) in  List.existsb (fun ml_pair => (ml_callback (fst ml_pair))) (List.combine ml_values (List.seq 0 (List.length ml_values)))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
