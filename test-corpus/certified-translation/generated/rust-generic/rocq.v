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

Inductive List_i64 : Type :=
| Nil : List_i64
| Cons : Z -> List_i64 -> List_i64.

Inductive List_bool : Type :=
| Nil_2 : List_bool
| Cons_2 : bool -> List_bool -> List_bool.

Inductive Tagged_i64 : Type :=
| Tagged_i64_2 : Z -> Z -> Tagged_i64.

Definition rml_tagged_i64_tag (rml_value : Tagged_i64) : Z :=
  (match rml_value with | Tagged_i64_2 rml_field ml_f1 => rml_field end).

Definition rml_tagged_i64_value (rml_value : Tagged_i64) : Z :=
  (match rml_value with | Tagged_i64_2 ml_f2 rml_field => rml_field end).

Fixpoint length_bool (list_ : List_bool) (ml_out : list string) {struct list_} : ml_io1 :=
  (match list_ with | Nil_2 => (ml_io1_mk ml_out 0%Z) | Cons_2 ml_f3 rest => (let ml_scrutinee := (length_bool rest ml_out) in (match ml_scrutinee with | ml_io1_mk ml_o1 ml_v2 => (let ml_w3 := (Z.add 1%Z ml_v2) in (if (orb (Z.ltb ml_w3 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w3)) then (ml_io1_abort ml_o1 "attempt to add with overflow"%string) else (ml_io1_mk ml_o1 ml_w3))) | ml_io1_abort ml_o4 ml_m5 => (ml_io1_abort ml_o4 ml_m5) end)) end).

Fixpoint sum (list_ : List_i64) (ml_out : list string) {struct list_} : ml_io1 :=
  (match list_ with | Nil => (ml_io1_mk ml_out 0%Z) | Cons head rest => (let ml_scrutinee := (sum rest ml_out) in (match ml_scrutinee with | ml_io1_mk ml_o6 ml_v7 => (let ml_w8 := (Z.add head ml_v7) in (if (orb (Z.ltb ml_w8 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w8)) then (ml_io1_abort ml_o6 "attempt to add with overflow"%string) else (ml_io1_mk ml_o6 ml_w8))) | ml_io1_abort ml_o9 ml_m10 => (ml_io1_abort ml_o9 ml_m10) end)) end).

Definition identity_i64 (value : Z) : Z :=
  value.

Definition identity_String (value : string) : string :=
  value.

Definition main : list string * option string :=
  let numbers := (Cons 1%Z (Cons 2%Z (Cons 3%Z Nil))) in
  let ml_run11 := (let ml_scrutinee := (sum numbers (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o12 ml_v13 => (ml_io2_mk ml_o12 (ml_Z_to_string ml_v13)) | ml_io1_abort ml_o14 ml_m15 => (ml_io2_abort ml_o14 ml_m15) end)) in
  ml_emit (List.rev (match ml_run11 with | ml_io2_mk ml_o16 ml_v17 => ml_o16 | ml_io2_abort ml_o18 ml_m19 => ml_o18 end))
  ((match ml_run11 with ml_io2_mk _ ml_val20 => ml_emit (ml_val20 :: nil)
  (let flags := (Cons_2 true Nil_2) in
  let ml_run21 := (let ml_scrutinee := (length_bool flags (@nil string)) in (match ml_scrutinee with | ml_io1_mk ml_o22 ml_v23 => (ml_io2_mk ml_o22 (ml_Z_to_string ml_v23)) | ml_io1_abort ml_o24 ml_m25 => (ml_io2_abort ml_o24 ml_m25) end)) in
  ml_emit (List.rev (match ml_run21 with | ml_io2_mk ml_o26 ml_v27 => ml_o26 | ml_io2_abort ml_o28 ml_m29 => ml_o28 end))
  ((match ml_run21 with ml_io2_mk _ ml_val30 => ml_emit (ml_val30 :: nil)
  (let tagged := (Tagged_i64_2 7%Z (identity_i64 35%Z)) in
  let ml_run31 := (let ml_scrutinee := (let ml_a32 := (rml_tagged_i64_tag tagged) in (let ml_a33 := (rml_tagged_i64_value tagged) in (let ml_w34 := (Z.add ml_a32 ml_a33) in (if (orb (Z.ltb ml_w34 (-9223372036854775808)%Z) (Z.ltb 9223372036854775807%Z ml_w34)) then (ml_io1_abort (@nil string) "attempt to add with overflow"%string) else (ml_io1_mk (@nil string) ml_w34))))) in (match ml_scrutinee with | ml_io1_mk ml_o35 ml_v36 => (ml_io2_mk ml_o35 (ml_Z_to_string ml_v36)) | ml_io1_abort ml_o37 ml_m38 => (ml_io2_abort ml_o37 ml_m38) end)) in
  ml_emit (List.rev (match ml_run31 with | ml_io2_mk ml_o39 ml_v40 => ml_o39 | ml_io2_abort ml_o41 ml_m42 => ml_o41 end))
  ((match ml_run31 with ml_io2_mk _ ml_val43 => ml_emit (ml_val43 :: nil)
  (ml_emit ((identity_String "generic"%string) :: nil)
  ((nil, None))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end))) | ml_io2_abort _ ml_m => (nil, Some ml_m) end)).

Eval vm_compute in main.
