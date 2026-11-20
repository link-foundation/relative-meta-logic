(* rml-certified-item js/src/rml-meta-structure.mjs#isProfileLink@6882 target-sha256=791fd0f7e319553d264d10a9e878528bc25aa035c40fbe52abb4d70ee8494ae4 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

(* String.prototype.startsWith: the string begins with the search. *)
Definition ml_string_starts_with (string search : string) : bool := String.prefix search string.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition isProfileLink (metadata : ((option (option string)))%type) : bool :=
  (ml_string_starts_with (match metadata with | Some (Some ml_value) => ml_value | _ => ""%string end) "language-profile"%string).

Definition main : list string :=
  nil.

Eval vm_compute in main.
