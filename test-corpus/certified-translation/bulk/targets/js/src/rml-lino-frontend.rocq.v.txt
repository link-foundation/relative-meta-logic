(* rml-certified-item js/src/rml-lino-frontend.mjs#isIndentedIdItem@18157 target-sha256=0d8c256617e429f23ce568f98eb9023a92515495d066ef398ff074f1f5d6604a *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition isIndentedIdItem (item : ((option (option float)) * (list float))%type) : bool :=
  (andb (andb (negb (match ((fst item), (@None unit)) with | (Some (Some ml_left), Some ml_right) => false | (None, None) => false | (Some None, None) => true | _ => false end)) (negb (match ((fst item), (@None unit)) with | (Some (Some ml_left), Some ml_right) => false | (None, None) => true | (Some None, None) => false | _ => false end))) (orb (negb (let ml_ignored := (snd item) in true)) (PrimFloat.eqb (PrimFloat.of_uint63 (Uint63.of_Z (Z.of_nat (List.length (snd item))))) 0%float))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
