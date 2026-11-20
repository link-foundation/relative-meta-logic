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

Inductive Point : Type :=
| Point_2 : Z -> Z -> Point.

Definition rml_point_x (rml_value : Point) : Z :=
  (match rml_value with | Point_2 rml_field ml_f1 => rml_field end).

Definition rml_point_y (rml_value : Point) : Z :=
  (match rml_value with | Point_2 ml_f2 rml_field => rml_field end).

Inductive Pair : Type :=
| Pair_2 : Z -> Z -> Pair.

Definition rml_pair_0 (rml_value : Pair) : Z :=
  (match rml_value with | Pair_2 rml_field ml_f3 => rml_field end).

Inductive Shape : Type :=
| Circle : Z -> Shape
| Rect : Point -> Z -> Z -> Shape.

Definition manhattan (point : Point) (ml_out : list string) : ml_io1 :=
  (let ml_a1 := (rml_point_x point) in (let ml_a2 := (rml_point_y point) in (let ml_w3 := (Z.add ml_a1 ml_a2) in (if (orb (Z.ltb ml_w3 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w3)) then (ml_io1_abort ml_out "attempt to add with overflow"%string) else (ml_io1_mk ml_out ml_w3))))).

Definition swap (pair_ : Pair) : Pair :=
  (match pair_ with | Pair_2 first second => (Pair_2 second first) end).

Definition area (shape : Shape) (ml_out : list string) : ml_io1 :=
  (match shape with | Circle radius => (let ml_scrutinee := (let ml_w4 := (Z.mul 3%Z radius) in (if (orb (Z.ltb ml_w4 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w4)) then (ml_io1_abort ml_out "attempt to multiply with overflow"%string) else (ml_io1_mk ml_out ml_w4))) in (match ml_scrutinee with | ml_io1_mk ml_o5 ml_v6 => (let ml_w7 := (Z.mul ml_v6 radius) in (if (orb (Z.ltb ml_w7 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w7)) then (ml_io1_abort ml_o5 "attempt to multiply with overflow"%string) else (ml_io1_mk ml_o5 ml_w7))) | ml_io1_abort ml_o8 ml_m9 => (ml_io1_abort ml_o8 ml_m9) end)) | Rect ml_f4 width height => (let ml_w10 := (Z.mul width height) in (if (orb (Z.ltb ml_w10 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w10)) then (ml_io1_abort ml_out "attempt to multiply with overflow"%string) else (ml_io1_mk ml_out ml_w10))) end).

Definition corner_sum (shape : Shape) (ml_out : list string) : ml_io1 :=
  (match shape with | Circle ml_f5 => (ml_io1_mk ml_out 0%Z) | Rect ml_f6 ml_f7 ml_f8 => (match ml_f6 with | Point_2 x y => (let ml_w11 := (Z.add x y) in (if (orb (Z.ltb ml_w11 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w11)) then (ml_io1_abort ml_out "attempt to add with overflow"%string) else (ml_io1_mk ml_out ml_w11))) end) end).

Theorem ml_assertion_1 : let corner := (Point_2 3%Z 4%Z) in let ml_run12 := (let ml_scrutinee := (manhattan corner (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o13 ml_v14 => (ml_io2_mk ml_o13 (ml_Z_to_string ml_v14)) | ml_io1_abort ml_o15 ml_m16 => (ml_io2_abort ml_o15 ml_m16) end)) in (match ml_run12 with ml_io2_mk _ ml_val21 => let x := (rml_point_x corner) in let pair_ := (swap (Pair_2 1%Z 2%Z)) in let ml_run22 := (let ml_scrutinee := (area (Rect (Point_2 1%Z 2%Z) 5%Z 6%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o23 ml_v24 => (ml_io2_mk ml_o23 (ml_Z_to_string ml_v24)) | ml_io1_abort ml_o25 ml_m26 => (ml_io2_abort ml_o25 ml_m26) end)) in (match ml_run22 with ml_io2_mk _ ml_val31 => let ml_run32 := (let ml_scrutinee := (area (Circle 2%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o33 ml_v34 => (ml_io2_mk ml_o33 (ml_Z_to_string ml_v34)) | ml_io1_abort ml_o35 ml_m36 => (ml_io2_abort ml_o35 ml_m36) end)) in (match ml_run32 with ml_io2_mk _ ml_val41 => let ml_run42 := (let ml_scrutinee := (corner_sum (Rect corner 1%Z 1%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o43 ml_v44 => (ml_io2_mk ml_o43 (ml_Z_to_string ml_v44)) | ml_io1_abort ml_o45 ml_m46 => (ml_io2_abort ml_o45 ml_m46) end)) in (match ml_run42 with ml_io2_mk _ ml_val51 => let ml_run52 := (manhattan (Point_2 (-2)%Z 2%Z) (@nil string)) in (match ml_run52 with ml_io1_mk _ ml_val57 => (ml_val57 = 0%Z) | ml_io1_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io2_abort _ _ => True end).
Proof. ml_decide. Qed.

Definition main : list string * option string :=
  let corner := (Point_2 3%Z 4%Z) in
  let ml_run12 := (let ml_scrutinee := (manhattan corner (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o13 ml_v14 => (ml_io2_mk ml_o13 (ml_Z_to_string ml_v14)) | ml_io1_abort ml_o15 ml_m16 => (ml_io2_abort ml_o15 ml_m16) end)) in
  ml_emit (List.rev (match ml_run12 with | ml_io2_mk ml_o17 ml_v18 => ml_o17 | ml_io2_abort ml_o19 ml_m20 => ml_o19 end))
  ((match ml_run12 with ml_io2_mk _ ml_val21 => ml_emit (ml_val21 :: nil)
  (let x := (rml_point_x corner) in
  ml_emit ((ml_Z_to_string x) :: nil)
  (let pair_ := (swap (Pair_2 1%Z 2%Z)) in
  ml_emit ((ml_Z_to_string (rml_pair_0 pair_)) :: nil)
  (let ml_run22 := (let ml_scrutinee := (area (Rect (Point_2 1%Z 2%Z) 5%Z 6%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o23 ml_v24 => (ml_io2_mk ml_o23 (ml_Z_to_string ml_v24)) | ml_io1_abort ml_o25 ml_m26 => (ml_io2_abort ml_o25 ml_m26) end)) in
  ml_emit (List.rev (match ml_run22 with | ml_io2_mk ml_o27 ml_v28 => ml_o27 | ml_io2_abort ml_o29 ml_m30 => ml_o29 end))
  ((match ml_run22 with ml_io2_mk _ ml_val31 => ml_emit (ml_val31 :: nil)
  (let ml_run32 := (let ml_scrutinee := (area (Circle 2%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o33 ml_v34 => (ml_io2_mk ml_o33 (ml_Z_to_string ml_v34)) | ml_io1_abort ml_o35 ml_m36 => (ml_io2_abort ml_o35 ml_m36) end)) in
  ml_emit (List.rev (match ml_run32 with | ml_io2_mk ml_o37 ml_v38 => ml_o37 | ml_io2_abort ml_o39 ml_m40 => ml_o39 end))
  ((match ml_run32 with ml_io2_mk _ ml_val41 => ml_emit (ml_val41 :: nil)
  (let ml_run42 := (let ml_scrutinee := (corner_sum (Rect corner 1%Z 1%Z) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o43 ml_v44 => (ml_io2_mk ml_o43 (ml_Z_to_string ml_v44)) | ml_io1_abort ml_o45 ml_m46 => (ml_io2_abort ml_o45 ml_m46) end)) in
  ml_emit (List.rev (match ml_run42 with | ml_io2_mk ml_o47 ml_v48 => ml_o47 | ml_io2_abort ml_o49 ml_m50 => ml_o49 end))
  ((match ml_run42 with ml_io2_mk _ ml_val51 => ml_emit (ml_val51 :: nil)
  (let ml_run52 := (manhattan (Point_2 (-2)%Z 2%Z) (@nil string)) in
  ml_emit (List.rev (match ml_run52 with | ml_io1_mk ml_o53 ml_v54 => ml_o53 | ml_io1_abort ml_o55 ml_m56 => ml_o55 end))
  ((match ml_run52 with ml_io1_mk _ ml_val57 => (nil, None) | ml_io1_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end)).

Eval vm_compute in main.
