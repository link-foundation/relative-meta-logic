(* rml-certified-item js/src/rml-relational-kernel.mjs#cons@190 target-sha256=9bb865fa49cf2d7be7791a78337fbef2abb6b4ea01f78c98d8546ccdb13d2eaf *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition cons_ (head : string) (tail : string) : (list string) :=
  ("cons"%string :: head :: tail :: @nil string).

Definition main : list string :=
  nil.

Eval vm_compute in main.
