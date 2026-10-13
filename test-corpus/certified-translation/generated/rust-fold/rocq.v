(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Fixpoint ml_digits (fuel : nat) (n : N) (acc : string) : string :=
  match fuel with
  | O => acc
  | S rest =>
      let acc' := String (ascii_of_N (48 + N.modulo n 10)) acc in
      if N.ltb n 10 then acc' else ml_digits rest (N.div n 10) acc'
  end.
Definition ml_N_to_string (n : N) : string := ml_digits (S (N.size_nat n)) n EmptyString.

Definition ml_Z_to_string (z : Z) : string :=
  if Z.ltb z 0 then String.append "-" (ml_N_to_string (Z.to_N (Z.opp z))) else ml_N_to_string (Z.to_N z).

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

Ltac ml_prove := first
  [ reflexivity | discriminate | exact I | lia
  | split; ml_prove
  | left; ml_prove
  | right; ml_prove
  | let H := fresh "H" in intro H; first [ml_prove | ml_refute H] ]
with ml_refute H := first
  [ discriminate H | exact H | lia
  | let A := fresh "H" in let B := fresh "H" in destruct H as [A B]; first [ml_refute A | ml_refute B]
  | let A := fresh "H" in let B := fresh "H" in destruct H as [A | B]; [ml_refute A | ml_refute B]
  | apply H; ml_prove ].
Ltac ml_decide := vm_compute; ml_prove.

(* The lines a step of main prints, before the lines the rest of main prints
   and the message of the abort that stops it, if one does. *)
Definition ml_emit (lines : list string) (rest : list string * option string) : list string * option string :=
  (app lines (fst rest), snd rest).

Inductive ml_io1 : Type :=
| ml_io1_mk : list string -> Z -> ml_io1
| ml_io1_abort : list string -> string -> ml_io1.

Inductive ml_io2 : Type :=
| ml_io2_mk : list string -> string -> ml_io2
| ml_io2_abort : list string -> string -> ml_io2.

Definition gcd (a : Z) (b : Z) (ml_out : list string) : ml_io1 :=
  ml_fix 64 (fun (ml_rec : Z * Z * list string -> ml_io1) (ml_args : Z * Z * list string) =>
    let '(a, b, ml_out) := ml_args in (if (Z.eqb b 0%Z) then (ml_io1_mk ml_out a) else (let ml_scrutinee := (if (Z.eqb b 0%Z) then (ml_io1_abort ml_out "attempt to calculate the remainder with a divisor of zero"%string) else (if (andb (Z.eqb a (-9223372036854775808)%Z) (Z.eqb b (-1)%Z)) then (ml_io1_abort ml_out "attempt to calculate the remainder with overflow"%string) else (ml_io1_mk ml_out (Z.rem a b)))) in (match ml_scrutinee with | ml_io1_mk ml_o1 ml_v2 => (ml_rec (b, ml_v2, ml_o1)) | ml_io1_abort ml_o3 ml_m4 => (ml_io1_abort ml_o3 ml_m4) end))))
    (fun _ => (ml_io1_mk (@nil string) 0%Z)) (a, b, ml_out).

Definition triangle (n : Z) (ml_out : list string) : ml_io1 :=
  ml_fix 64 (fun (ml_rec : Z * list string -> ml_io1) (ml_args : Z * list string) =>
    let '(n, ml_out) := ml_args in (if (Z.eqb n 0%Z) then (ml_io1_mk ml_out 0%Z) else (let ml_scrutinee := (let ml_scrutinee := (let ml_w5 := (Z.sub n 1%Z) in (if (orb (Z.ltb ml_w5 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w5)) then (ml_io1_abort ml_out "attempt to subtract with overflow"%string) else (ml_io1_mk ml_out ml_w5))) in (match ml_scrutinee with | ml_io1_mk ml_o6 ml_v7 => (ml_rec (ml_v7, ml_o6)) | ml_io1_abort ml_o8 ml_m9 => (ml_io1_abort ml_o8 ml_m9) end)) in (match ml_scrutinee with | ml_io1_mk ml_o10 ml_v11 => (let ml_w12 := (Z.add n ml_v11) in (if (orb (Z.ltb ml_w12 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w12)) then (ml_io1_abort ml_o10 "attempt to add with overflow"%string) else (ml_io1_mk ml_o10 ml_w12))) | ml_io1_abort ml_o13 ml_m14 => (ml_io1_abort ml_o13 ml_m14) end))))
    (fun _ => (ml_io1_mk (@nil string) 0%Z)) (n, ml_out).

Definition sign (value : Z) : Z :=
  (if (Z.eqb value 0%Z) then 0%Z else (if (Z.ltb 0%Z value) then 1%Z else (-1)%Z)).

Theorem ml_assertion_1 : let ml_run15 := (gcd 84%Z 36%Z (@nil string)) in (match ml_run15 with ml_io1_mk _ ml_val20 => let a := ml_val20 in let ml_run21 := (let ml_scrutinee := (triangle 10%Z (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o22 ml_v23 => (ml_io2_mk ml_o22 (ml_Z_to_string ml_v23)) | ml_io1_abort ml_o24 ml_m25 => (ml_io2_abort ml_o24 ml_m25) end)) in (match ml_run21 with ml_io2_mk _ ml_val30 => let ml_run31 := (triangle 4%Z (@nil string)) in (match ml_run31 with ml_io1_mk _ ml_val36 => (ml_val36 = 10%Z) | ml_io1_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io1_abort _ _ => True end).
Proof. ml_decide. Qed.

Definition main : list string * option string :=
  let ml_run15 := (gcd 84%Z 36%Z (@nil string)) in
  ml_emit (List.rev (match ml_run15 with | ml_io1_mk ml_o16 ml_v17 => ml_o16 | ml_io1_abort ml_o18 ml_m19 => ml_o18 end))
  ((match ml_run15 with ml_io1_mk _ ml_val20 => let a := ml_val20 in
  ml_emit ((ml_Z_to_string a) :: nil)
  (let ml_run21 := (let ml_scrutinee := (triangle 10%Z (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o22 ml_v23 => (ml_io2_mk ml_o22 (ml_Z_to_string ml_v23)) | ml_io1_abort ml_o24 ml_m25 => (ml_io2_abort ml_o24 ml_m25) end)) in
  ml_emit (List.rev (match ml_run21 with | ml_io2_mk ml_o26 ml_v27 => ml_o26 | ml_io2_abort ml_o28 ml_m29 => ml_o28 end))
  ((match ml_run21 with ml_io2_mk _ ml_val30 => ml_emit (ml_val30 :: nil)
  (ml_emit ((String.append (String.append (ml_Z_to_string (sign (-7)%Z)) " "%string) (ml_Z_to_string (sign a))) :: nil)
  (let ml_run31 := (triangle 4%Z (@nil string)) in
  ml_emit (List.rev (match ml_run31 with | ml_io1_mk ml_o32 ml_v33 => ml_o32 | ml_io1_abort ml_o34 ml_m35 => ml_o34 end))
  ((match ml_run31 with ml_io1_mk _ ml_val36 => (nil, None) | ml_io1_abort _ ml_m => (nil, Some ml_m) end)))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io1_abort _ ml_m => (nil, Some ml_m) end)).

Eval vm_compute in main.
