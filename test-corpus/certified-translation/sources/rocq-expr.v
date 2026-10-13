(* An arithmetic expression language, its structural evaluator and a closed theorem. *)
From Stdlib Require Import String Arith DecimalString.
Open Scope string_scope.

Module Arith.

Inductive expr : Type :=
  | Num : nat -> expr
  | Plus : expr -> expr -> expr
  | Times : expr -> expr -> expr.

Definition larger (a : nat) (b : nat) : nat := if Nat.leb a b then b else a.

Fixpoint eval (e : expr) : nat :=
  match e with
  | Num n => n
  | Plus a b => eval a + eval b
  | Times a b => eval a * eval b
  end.

Fixpoint depth (e : expr) : nat :=
  match e with
  | Num _ => 1
  | Plus a b => 1 + larger (depth a) (depth b)
  | Times a b => 1 + larger (depth a) (depth b)
  end.

End Arith.

Definition sample : Arith.expr := Arith.Plus (Arith.Num 2) (Arith.Times (Arith.Num 3) (Arith.Num 4)).

Theorem eval_sample : Arith.eval sample = 14.
Proof. reflexivity. Qed.

Definition main : list string :=
  (NilEmpty.string_of_uint (Nat.to_uint (Arith.eval sample))) ::
  (NilEmpty.string_of_uint (Nat.to_uint (Arith.depth sample))) ::
  nil.

Eval vm_compute in main.
