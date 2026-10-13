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
| ml_io1_mk : list string -> N -> ml_io1
| ml_io1_abort : list string -> string -> ml_io1.

Inductive ml_io2 : Type :=
| ml_io2_mk : list string -> string -> ml_io2
| ml_io2_abort : list string -> string -> ml_io2.

Module geometry.

Inductive Shape : Type :=
| Square : N -> Shape
| Rect : N -> N -> Shape
| Group : geometry.Shape -> geometry.Shape -> Shape.

Fixpoint area (shape : geometry.Shape) (ml_out : list string) {struct shape} : ml_io1 :=
  (match shape with | geometry.Square side => (let ml_w1 := (N.mul side side) in (if (N.ltb 18446744073709551615%N ml_w1) then (ml_io1_abort ml_out "attempt to multiply with overflow"%string) else (ml_io1_mk ml_out ml_w1))) | geometry.Rect width height => (let ml_w2 := (N.mul width height) in (if (N.ltb 18446744073709551615%N ml_w2) then (ml_io1_abort ml_out "attempt to multiply with overflow"%string) else (ml_io1_mk ml_out ml_w2))) | geometry.Group first second => (let ml_scrutinee := (area first ml_out) in (match ml_scrutinee with | ml_io1_mk ml_o3 ml_v4 => (let ml_scrutinee := (area second ml_o3) in (match ml_scrutinee with | ml_io1_mk ml_o5 ml_v6 => (let ml_w7 := (N.add ml_v4 ml_v6) in (if (N.ltb 18446744073709551615%N ml_w7) then (ml_io1_abort ml_o5 "attempt to add with overflow"%string) else (ml_io1_mk ml_o5 ml_w7))) | ml_io1_abort ml_o8 ml_m9 => (ml_io1_abort ml_o8 ml_m9) end)) | ml_io1_abort ml_o10 ml_m11 => (ml_io1_abort ml_o10 ml_m11) end)) end).

Fixpoint count (shape : geometry.Shape) (ml_out : list string) {struct shape} : ml_io1 :=
  (match shape with | geometry.Square ml_f1 => (ml_io1_mk ml_out 1%N) | geometry.Rect ml_f2 ml_f3 => (ml_io1_mk ml_out 1%N) | geometry.Group first second => (let ml_scrutinee := (count first ml_out) in (match ml_scrutinee with | ml_io1_mk ml_o12 ml_v13 => (let ml_scrutinee := (count second ml_o12) in (match ml_scrutinee with | ml_io1_mk ml_o14 ml_v15 => (let ml_w16 := (N.add ml_v13 ml_v15) in (if (N.ltb 18446744073709551615%N ml_w16) then (ml_io1_abort ml_o14 "attempt to add with overflow"%string) else (ml_io1_mk ml_o14 ml_w16))) | ml_io1_abort ml_o17 ml_m18 => (ml_io1_abort ml_o17 ml_m18) end)) | ml_io1_abort ml_o19 ml_m20 => (ml_io1_abort ml_o19 ml_m20) end)) end).

End geometry.

Definition describe (total : N) : string :=
  (if (N.ltb 100%N total) then "large"%string else "small"%string).

Theorem ml_assertion_1 : let first := (geometry.Group (geometry.Square 3%N) (geometry.Rect 4%N 5%N)) in let ml_run21 := (let ml_scrutinee := (geometry.area first (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o22 ml_v23 => (ml_io2_mk ml_o22 (ml_N_to_string ml_v23)) | ml_io1_abort ml_o24 ml_m25 => (ml_io2_abort ml_o24 ml_m25) end)) in (match ml_run21 with ml_io2_mk _ ml_val30 => let ml_run31 := (let ml_scrutinee := (geometry.count (geometry.Group (geometry.Square 1%N) (geometry.Group (geometry.Square 2%N) (geometry.Rect 2%N 3%N))) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o32 ml_v33 => (ml_io2_mk ml_o32 (ml_N_to_string ml_v33)) | ml_io1_abort ml_o34 ml_m35 => (ml_io2_abort ml_o34 ml_m35) end)) in (match ml_run31 with ml_io2_mk _ ml_val40 => let ml_run41 := (let ml_scrutinee := (geometry.area (geometry.Rect 20%N 6%N) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o42 ml_v43 => (ml_io2_mk ml_o42 (describe ml_v43)) | ml_io1_abort ml_o44 ml_m45 => (ml_io2_abort ml_o44 ml_m45) end)) in (match ml_run41 with ml_io2_mk _ ml_val50 => let ml_run51 := (geometry.area (geometry.Square 4%N) (@nil string)) in (match ml_run51 with ml_io1_mk _ ml_val56 => (ml_val56 = 16%N) | ml_io1_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io2_abort _ _ => True end) | ml_io2_abort _ _ => True end).
Proof. ml_decide. Qed.

Definition main : list string * option string :=
  let first := (geometry.Group (geometry.Square 3%N) (geometry.Rect 4%N 5%N)) in
  let ml_run21 := (let ml_scrutinee := (geometry.area first (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o22 ml_v23 => (ml_io2_mk ml_o22 (ml_N_to_string ml_v23)) | ml_io1_abort ml_o24 ml_m25 => (ml_io2_abort ml_o24 ml_m25) end)) in
  ml_emit (List.rev (match ml_run21 with | ml_io2_mk ml_o26 ml_v27 => ml_o26 | ml_io2_abort ml_o28 ml_m29 => ml_o28 end))
  ((match ml_run21 with ml_io2_mk _ ml_val30 => ml_emit (ml_val30 :: nil)
  (let ml_run31 := (let ml_scrutinee := (geometry.count (geometry.Group (geometry.Square 1%N) (geometry.Group (geometry.Square 2%N) (geometry.Rect 2%N 3%N))) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o32 ml_v33 => (ml_io2_mk ml_o32 (ml_N_to_string ml_v33)) | ml_io1_abort ml_o34 ml_m35 => (ml_io2_abort ml_o34 ml_m35) end)) in
  ml_emit (List.rev (match ml_run31 with | ml_io2_mk ml_o36 ml_v37 => ml_o36 | ml_io2_abort ml_o38 ml_m39 => ml_o38 end))
  ((match ml_run31 with ml_io2_mk _ ml_val40 => ml_emit (ml_val40 :: nil)
  (let ml_run41 := (let ml_scrutinee := (geometry.area (geometry.Rect 20%N 6%N) (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o42 ml_v43 => (ml_io2_mk ml_o42 (describe ml_v43)) | ml_io1_abort ml_o44 ml_m45 => (ml_io2_abort ml_o44 ml_m45) end)) in
  ml_emit (List.rev (match ml_run41 with | ml_io2_mk ml_o46 ml_v47 => ml_o46 | ml_io2_abort ml_o48 ml_m49 => ml_o48 end))
  ((match ml_run41 with ml_io2_mk _ ml_val50 => ml_emit (ml_val50 :: nil)
  (let ml_run51 := (geometry.area (geometry.Square 4%N) (@nil string)) in
  ml_emit (List.rev (match ml_run51 with | ml_io1_mk ml_o52 ml_v53 => ml_o52 | ml_io1_abort ml_o54 ml_m55 => ml_o54 end))
  ((match ml_run51 with ml_io1_mk _ ml_val56 => (nil, None) | ml_io1_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end)).

Eval vm_compute in main.
