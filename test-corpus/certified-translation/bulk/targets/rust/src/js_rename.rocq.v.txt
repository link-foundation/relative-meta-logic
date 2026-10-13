(* rml-certified-item rust/src/js_rename.rs#RESERVED@205 target-sha256=f2e1ba66b19baf3b0d2aa4bddaa296f6b186c872d9a15ddb327f15b787f53fdd *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition RESERVED : string :=
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await async"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/js_rename.rs#UNSUPPORTED@531 target-sha256=3ef490f4eb545afe54957062b615a69e1babccc10a4977fd4591861c732c556d *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition UNSUPPORTED : string :=
  "break case catch class continue debugger default delete do else enum export extends finally for function if implements import in interface package private protected public return static super switch throw try var while with yield await async eval"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/js_rename.rs#fail@1901 target-sha256=3837d28aebc4189db7ee5b1397d82d5de8e7c780fddd9484cdbb05b900854232 *)
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

Definition fail (code : string) (detail : string) (offset : N) : string :=
  (String.append (String.append (String.append (String.append code ": "%string) detail) " at UTF-16 offset "%string) (ml_N_to_string offset)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
