(* rml-certified-item rust/src/theory_network.rs#EMPTY_SEQUENCE@716 target-sha256=ebc5b64348827969e290b9a7fe91b69b50182c89cb0abc2fe4f610dac69af273 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition EMPTY_SEQUENCE : string :=
  "rml.sequence.empty"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/theory_network.rs#SequenceLayout@48851 target-sha256=783ce3c6aa76398a2c1484844432a999bedbca4a6f0c56865fd50fd269d92f61 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive SequenceLayout : Type :=
| Balanced : SequenceLayout
| Left : SequenceLayout
| Right : SequenceLayout.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/theory_network.rs#SequenceTree@48960 target-sha256=5e5a2205d66b3b0a6b68a660fe52af9729f8671f457887edb37074d0e9b1c2be *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Inductive SequenceTree : Type :=
| Leaf : string -> SequenceTree
| Branch : SequenceTree -> SequenceTree -> SequenceTree.

Definition main : list string :=
  nil.

Eval vm_compute in main.
