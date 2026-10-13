(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

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

(* ECMAScript Number::toString for binary64: the shortest decimal that rounds
   back to the value (the nearest one, the even one on a tie), laid out as
   JavaScript prints it. Exact Z arithmetic on the decomposed float. *)
Fixpoint ml_js_zeros (n : nat) : string :=
  match n with O => EmptyString | S k => String "0"%char (ml_js_zeros k) end.
Fixpoint ml_js_trim (s : string) : string :=
  match s with
  | EmptyString => EmptyString
  | String c rest =>
      let r := ml_js_trim rest in
      if andb (Ascii.eqb c "0"%char) (String.eqb r EmptyString) then EmptyString else String c r
  end.
Definition ml_js_layout (digits : string) (n : Z) : string :=
  let len := String.length digits in
  let k := Z.of_nat len in
  if andb (Z.leb k n) (Z.leb n 21) then (digits ++ ml_js_zeros (Z.to_nat (n - k)))%string
  else if andb (Z.ltb 0 n) (Z.leb n 21) then
    (substring 0 (Z.to_nat n) digits ++ "." ++ substring (Z.to_nat n) len digits)%string
  else if andb (Z.ltb (-6) n) (Z.leb n 0) then ("0." ++ ml_js_zeros (Z.to_nat (- n)) ++ digits)%string
  else
    let e := (n - 1)%Z in
    let exp := ((if Z.ltb e 0 then "e-" else "e+") ++ ml_N_to_string (Z.abs_N e))%string in
    if Z.eqb k 1 then (digits ++ exp)%string
    else (substring 0 1 digits ++ "." ++ substring 1 len digits ++ exp)%string.
(* The value is v * 2^sh for a scaled mantissa v. c * 10^q compared with
   x * 2^sh, and floor (v * 2^sh / 10^q), with shifts for the powers of 2. *)
Definition ml_js_cmp (c q x sh : Z) : comparison :=
  Z.compare (Z.shiftl (c * 10 ^ Z.max q 0) (Z.max (- sh) 0))
            (Z.shiftl (x * 10 ^ Z.max (- q) 0) (Z.max sh 0)).
Definition ml_js_floor (v q sh : Z) : Z :=
  Z.div (Z.shiftl (v * 10 ^ Z.max (- q) 0) (Z.max sh 0))
        (Z.shiftl (10 ^ Z.max q 0) (Z.max (- sh) 0)).
(* With p significant digits: the candidate in the rounding interval nearest
   to the value (the even one on a tie), as (digits, exponent). *)
Definition ml_js_candidate (p e10 v lo hi sh : Z) (inclusive : bool) : option (Z * Z) :=
  let q := (e10 - p + 1)%Z in
  let c := ml_js_floor v q sh in
  let inside (c : Z) :=
    andb (match ml_js_cmp c q lo sh with Gt => true | Eq => inclusive | Lt => false end)
         (match ml_js_cmp c q hi sh with Lt => true | Eq => inclusive | Gt => false end) in
  let low := inside c in
  let high := inside (c + 1)%Z in
  if andb low high then
    match ml_js_cmp (2 * c + 1) q (2 * v) sh with
    | Gt => Some (c, q) | Lt => Some ((c + 1)%Z, q) | Eq => Some (if Z.even c then c else (c + 1)%Z, q)
    end
  else if low then Some (c, q) else if high then Some ((c + 1)%Z, q) else None.
(* A candidate with p digits is one with p + 1 digits too, so the fewest
   digits are found by bisection over [first, last]; 17 always suffice. *)
Fixpoint ml_js_fewest (fuel : nat) (first last e10 v lo hi sh : Z) (inclusive : bool) : Z * Z :=
  match fuel with
  | S fuel =>
      if Z.ltb first last then
        let middle := Z.div (first + last) 2 in
        match ml_js_candidate middle e10 v lo hi sh inclusive with
        | Some _ => ml_js_fewest fuel first middle e10 v lo hi sh inclusive
        | None => ml_js_fewest fuel (middle + 1) last e10 v lo hi sh inclusive
        end
      else match ml_js_candidate last e10 v lo hi sh inclusive with Some r => r | None => (0, 0)%Z end
  | O => match ml_js_candidate last e10 v lo hi sh inclusive with Some r => r | None => (0, 0)%Z end
  end.
Definition ml_js_shortest (m e : Z) (lowerCloser : bool) : string :=
  let sh := (e - 2)%Z in
  let v := (4 * m)%Z in
  let lo := if lowerCloser then (v - 1)%Z else (v - 2)%Z in
  let guess := Z.div ((Z.log2 m + e) * 78913) 262144 in
  let e10 :=
    match ml_js_cmp 1 (guess + 1) v sh with
    | Gt => match ml_js_cmp 1 guess v sh with Gt => (guess - 1)%Z | _ => guess end
    | _ => (guess + 1)%Z
    end in
  let (pick, q) := ml_js_fewest 5 1 17 e10 v lo (v + 2) sh (Z.even m) in
  let text := ml_N_to_string (Z.to_N pick) in
  ml_js_layout (ml_js_trim text) (q + Z.of_nat (String.length text)).
Definition ml_js_number (x : float) : string :=
  match Prim2SF x with
  | S754_zero _ => "0"
  | S754_infinity negative => if negative then "-Infinity" else "Infinity"
  | S754_nan => "NaN"
  | S754_finite negative m e =>
      let body := ml_js_shortest (Zpos m) e (andb (Pos.eqb m (2 ^ 52)) (Z.ltb (-1074) e)) in
      if negative then ("-" ++ body)%string else body
  end.

(* What console.log prints: -0 as "-0", where String(-0) is "0". *)
Definition ml_js_console (x : float) : string :=
  if andb (PrimFloat.is_zero x) (PrimFloat.get_sign x) then "-0" else ml_js_number x.

(* SameValue: NaN equals NaN, and 0 and -0 differ. *)
Definition ml_float_same (a b : float) : bool :=
  if PrimFloat.is_nan a then PrimFloat.is_nan b
  else andb (PrimFloat.eqb a b) (Bool.eqb (PrimFloat.get_sign a) (PrimFloat.get_sign b)).

(* The least fixed point of a one-step unfolding F, unfolded lazily: level k
   nests 2^k calls of F before it would reach the fallback. *)
Fixpoint ml_fix {A B : Type} (k : nat) (F : (A -> B) -> A -> B) (fallback : A -> B) : A -> B :=
  match k with
  | O => F fallback
  | S k => fun a => ml_fix k F (ml_fix k F fallback) a
  end.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Ltac ml_prove := first
  [ reflexivity | discriminate | exact I | lia
  | split; ml_prove
  | left; ml_prove
  | right; ml_prove
  | let H := fresh "H" in intro H; first [ml_prove | ml_refute H] ]
with ml_refute H := first
  [ discriminate H | exact H | lia
  | let A := fresh "H" in let B := fresh "H" in destruct H as [A B]; first [ml_refute A | ml_refute B]
  | let A := fresh "H" in let B := fresh "H" in destruct H as [A | B]; [ml_refute A | ml_refute B]
  | apply H; ml_prove ].
Ltac ml_decide := vm_compute; ml_prove.

Module numeric.

Definition factorial (n : Z) : Z :=
  ml_fix 64 (fun (ml_rec : Z -> Z) (n : Z) =>
    (if (Z.leb n 0%Z) then 1%Z else (Z.mul n (ml_rec (Z.sub n 1%Z)))))
    (fun _ => 0%Z) n.

Definition half (x : float) : float :=
  (PrimFloat.div x 2%float).

End numeric.

Definition power (a : Z) (b : Z) : Z :=
  ml_fix 64 (fun (ml_rec : Z * Z -> Z) (ml_args : Z * Z) =>
    let '(a, b) := ml_args in (if (Z.eqb b 0%Z) then 1%Z else (Z.mul a (ml_rec (a, (Z.sub b 1%Z))))))
    (fun _ => 0%Z) (a, b).

Theorem ml_assertion_1 : (ml_float_same (numeric.half 10%float) 5%float = true).
Proof. ml_decide. Qed.

Definition main : list string :=
  (ml_Z_to_string (numeric.factorial 20%Z)) ::
  (ml_js_console (numeric.half 7%float)) ::
  (ml_Z_to_string (power 2%Z 64%Z)) ::
  nil.

Eval vm_compute in main.
