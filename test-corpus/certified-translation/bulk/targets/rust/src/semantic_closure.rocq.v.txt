(* rml-certified-item rust/src/semantic_closure.rs#SEMANTIC_CLOSURE_SCHEMA@1963 target-sha256=01302f675e300df99391dca40b9b5d0382687cd03cb3abd9cefcf388aa034523 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition SEMANTIC_CLOSURE_SCHEMA : string :=
  "rml-semantic-closure/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#UNIVERSE_CONTRACT_SCHEMA@2032 target-sha256=15a1631f27a8bafc7860ffeeabfb788e41b01839b9093f8a6c37e16349ffd1e5 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition UNIVERSE_CONTRACT_SCHEMA : string :=
  "rml-universe-contract/v1"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#ROOT@2323 target-sha256=e2d651e9718a126757f5792a908427b060432081c3080497b2f2515a9e902704 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition ROOT : string :=
  "rml.closure"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#NIL@2357 target-sha256=3d9508b6f9bee5c4dc5f720ded10590e0ccdc3f91e62c38ff6e82f305a159555 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition NIL : string :=
  "rml.nil"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#ONTOLOGY@2386 target-sha256=41f67d2a4a84535ec34cae098ac5b9c0f1b6e500efb3df348a7acf377a85d7db *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition ONTOLOGY : string :=
  "rml.ontology"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#CATEGORY_ROOT@2425 target-sha256=11cb982a65cfb37adeac220e949ae792a5e38ba3070dd0fae14289eceee33756 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition CATEGORY_ROOT : string :=
  "rml.category"%string.

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#labelled_role@2548 target-sha256=15612f4ea5ee6e561e716bb7d9f2c9dca9bdb5ef5cea8d577829cb97159da88f *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition labelled_role (role : string) : bool :=
  (orb (String.eqb role "assumption"%string) (String.eqb role "hypothesis"%string)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#atom_address@3041 target-sha256=f935abd0adb33ec51c7a42fa60ffe35d150e8ad66a4241ce3449bd1f6d467a84 *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition atom_address (text : string) : string :=
  (String.append "rml.atom/"%string text).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#tag_address@3114 target-sha256=741a7443b2a09d1388076d623823d0c4afa6cf385abc1e1730d2978e0d001d1e *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition atom_address (text : string) : string :=
  (String.append "rml.atom/"%string text).

Definition tag_address (kind : string) : string :=
  (atom_address (String.append "rml."%string kind)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item rust/src/semantic_closure.rs#program_address@3280 target-sha256=dc77174fc8403979dab93e57069d7cedf14b012592579fa0344b3894e16033de *)
(* Translated from Rust by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition program_address (name : string) : string :=
  (String.append "rml.program/"%string name).

Definition main : list string :=
  nil.

Eval vm_compute in main.
