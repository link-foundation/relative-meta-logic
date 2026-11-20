(* rml-certified-item rust/src/repl.rs#HELP_TEXT@1708 target-sha256=31c1cc2f766cb1cba020d46d5c4bf8fe93e477142744ab766af475d6647c063b *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition HELP_TEXT : string :=
  "RML REPL — meta-commands:
  :help           show this help message
  :reset          discard all state and start a fresh Env
  :env            print declared terms / assignments / types / lambdas
  :load <file>    evaluate a .lino file in the current Env
  :save <file>    write the session transcript (as .lino) to <file>
  :quit           exit the REPL (also :exit, Ctrl-D)

LiNo input is evaluated form-by-form.  Query results are printed; errors
are reported as diagnostics with source spans."%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
