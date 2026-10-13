(* rml-certified-item rust/src/foundation_workspace.rs#PACKAGE_SCHEMA@2121 target-sha256=94137c97971b301cdb148ec3119eedbb913ed66efb918432c422409e76b18550 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition PACKAGE_SCHEMA : string :=
  "rml-foundation-package/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#RESULT_SCHEMA@2183 target-sha256=ab70fc8dc485bc9293a085ce06fa8843cfbfe3686844aedf3bf2198bafbcbc01 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition RESULT_SCHEMA : string :=
  "rml-foundation-result/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#EXECUTION_SCHEMA@2243 target-sha256=ed5e6b4b913add27e562f81b37325d4b0343dbe33293097576d9104c26bac131 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition EXECUTION_SCHEMA : string :=
  "rml-foundation-execution/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#REFUTATION_HEAD@3087 target-sha256=245e67fbf1486b96599f43ce3966318face209ca3346ced0644aebad81ad9c00 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition REFUTATION_HEAD : string :=
  "refutation-of"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#ADMITTED@3134 target-sha256=41ead026d13c6b711d2f7abe277478904da8687e9b833bc0968ac876439d57d9 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition ADMITTED : string :=
  "admitted"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#INDUCTIVE@3169 target-sha256=5d52bb9725efb37c0c9b5f715cb115d89d505e1a9ed92734691d4d7b6cacaa58 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition INDUCTIVE : string :=
  "inductive"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#GUARDED_COINDUCTIVE@3206 target-sha256=4546ff2e731f09d4d1ade171160c7d4ec04c2d6b873f26ca7b4cf8336c65e880 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition GUARDED_COINDUCTIVE : string :=
  "guarded-coinductive"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#THEORY_ROLE@3263 target-sha256=869f254b4749fc940c913c5e031f91525a9a1ae4e8e9cf364739ac0f5f88d644 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition THEORY_ROLE : string :=
  "theory"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#INPUT_PROGRAM@3299 target-sha256=2da030b3837567647b99237b7048147c68d4b37bf489ed58128d84b0c44c0f92 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition INPUT_PROGRAM : string :=
  "<input>"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#ASSUMPTION_PROGRAM@3338 target-sha256=18af8d31951f4384b976cb7485148ee1e75aa5a185850b6f60cc4cc10936f43b *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition ASSUMPTION_PROGRAM : string :=
  "<assumption>"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#HYPOTHESIS_PROGRAM@3387 target-sha256=29a0165a34cf314ca193982cd0d12844b39ad60508aec0b7083adc59cfd0b5a2 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition HYPOTHESIS_PROGRAM : string :=
  "<hypothesis>"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/foundation_workspace.rs#rule_key@18216 target-sha256=76c8c0ae0d374e622a825696093299b494bc159c65e3956f23a2efbd6153104c *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition rule_key (kind : string) (program : string) (rule : string) : string :=
  (String.append (String.append (String.append (String.append kind " "%string) program) " "%string) rule).

Definition main : list string :=
  nil.

Eval vm_compute in main.
