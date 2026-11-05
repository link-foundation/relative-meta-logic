(* rml-certified-item js/src/rml-formal-corpus.mjs#rangeWithin@3689 target-sha256=e6b96ee8b1a2699ec9a9c90a80b6e24342a608fcafb42b465688cf43bf004b30 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

(* The index a Number names, exactly from its binary form; -1 when it names none. *)
Definition ml_float_index (x : float) : Z :=
  match Prim2SF x with
  | S754_zero _ => 0%Z
  | S754_finite false m e =>
      if Z.leb 0 e then Z.shiftl (Z.pos m) e
      else if Z.eqb (Z.modulo (Z.pos m) (2 ^ (- e))) 0 then Z.div (Z.pos m) (2 ^ (- e)) else (-1)%Z
  | _ => (-1)%Z
  end.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition rangeWithin (inner : (list float)) (outer : (list float)) : bool :=
  (andb (PrimFloat.leb (match (let ml_index := (ml_float_index 0%float) in if Z.ltb ml_index 0 then None else List.nth_error outer (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end) (match (let ml_index := (ml_float_index 0%float) in if Z.ltb ml_index 0 then None else List.nth_error inner (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end)) (PrimFloat.leb (match (let ml_index := (ml_float_index 1%float) in if Z.ltb ml_index 0 then None else List.nth_error inner (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end) (match (let ml_index := (ml_float_index 1%float) in if Z.ltb ml_index 0 then None else List.nth_error outer (Z.to_nat ml_index)) with | Some ml_present => ml_present | None => PrimFloat.nan end))).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-formal-corpus.mjs#canonicalDeclaration@4066 target-sha256=23c99862bf66dd6cfcd9b22fc71871d21c0aeaad0ad273e32fe897ecbc5af196 *)
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

(* The index a Number names, exactly from its binary form; -1 when it names none. *)
Definition ml_float_index (x : float) : Z :=
  match Prim2SF x with
  | S754_zero _ => 0%Z
  | S754_finite false m e =>
      if Z.leb 0 e then Z.shiftl (Z.pos m) e
      else if Z.eqb (Z.modulo (Z.pos m) (2 ^ (- e))) 0 then Z.div (Z.pos m) (2 ^ (- e)) else (-1)%Z
  | _ => (-1)%Z
  end.

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition canonicalDeclaration (declaration : ((list float) * (list float) * string * string * string * (list float) * string * bool * (list float) * string * (list float))%type) : string :=
  (let range := (fun (value : (list float)) => (String.append (String.append (match (let ml_index := (ml_float_index 0%float) in if Z.ltb ml_index 0 then None else List.nth_error value (Z.to_nat ml_index)) with | Some ml_present => (ml_js_number ml_present) | None => "undefined"%string end) ":"%string) (match (let ml_index := (ml_float_index 1%float) in if Z.ltb ml_index 0 then None else List.nth_error value (Z.to_nat ml_index)) with | Some ml_present => (ml_js_number ml_present) | None => "undefined"%string end))) in (let ml_values := ("declaration"%string :: (snd (fst (fst (fst (fst (fst (fst (fst declaration)))))))) :: (snd (fst (fst (fst (fst (fst (fst declaration))))))) :: (snd (fst (fst (fst (fst (fst (fst (fst (fst declaration))))))))) :: (snd (fst declaration)) :: (snd (fst (fst (fst (fst declaration))))) :: (if (snd (fst (fst (fst declaration)))) then "recursive"%string else "non-recursive"%string) :: (range (snd declaration)) :: (range (snd (fst (fst declaration)))) :: (range (fst (fst (fst (fst (fst (fst (fst (fst (fst (fst declaration))))))))))) :: (range (snd (fst (fst (fst (fst (fst declaration))))))) :: (let ml_values := (snd (fst (fst (fst (fst (fst (fst (fst (fst (fst declaration)))))))))) in let ml_separator := ","%string in match ml_values with nil => EmptyString | ml_first :: ml_rest => List.fold_left (fun ml_accumulator ml_value => String.append ml_accumulator (String.append ml_separator (ml_js_number ml_value))) ml_rest (ml_js_number ml_first) end) :: @nil string) in let ml_separator := "|"%string in match ml_values with nil => EmptyString | ml_first :: ml_rest => List.fold_left (fun ml_accumulator ml_value => String.append ml_accumulator (String.append ml_separator ml_value)) ml_rest ml_first end)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
(* rml-certified-item js/src/rml-formal-corpus.mjs#compareCodePoints@4579 target-sha256=31d3ef84127586e69bacf6bc19a40e5c05cdc44c93cd73bee93a598ab636c021 *)
(* Translated from JavaScript by meta-language: portable core, Rocq target. *)
From Stdlib Require Import NArith ZArith Lia Recdef String List Ascii Floats.
Set Warnings "-inexact-float".

Ltac ml_N_norm := repeat first
  [ rewrite N.pred_succ
  | rewrite (proj2 (N.eqb_neq (N.succ _) 0) (N.neq_succ_0 _))
  | rewrite N.eqb_refl ].
Ltac ml_obligation := intros; repeat match goal with H : N.eqb _ _ = false |- _ => apply N.eqb_neq in H end; lia.
Ltac ml_close := first [reflexivity | lia | nia | congruence].

Definition compareCodePoints (left_ : float) (right_ : float) : float :=
  (if (PrimFloat.ltb left_ right_) then (PrimFloat.opp 1%float) else (if (PrimFloat.ltb right_ left_) then 1%float else 0%float)).

Definition main : list string :=
  nil.

Eval vm_compute in main.
