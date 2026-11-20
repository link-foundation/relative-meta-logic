-- rml-certified-item js/src/rml-semantic-closure.mjs#atomAddress@2605 target-sha256=fd33346aec66111d6a48acc058d792f812d8e01205405c6aa035a5d0ded95e1b
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

/-- ECMAScript Number::toString: the shortest decimal that reads back as the
value, the nearer one and then the even one on a tie, laid out as JavaScript
prints it; exact Nat arithmetic on the bits. -/
def ml_js_layout (digits : List Char) (n : Int) : String :=
  let k : Int := digits.length
  let text := String.ofList
  let zeros (count : Int) := List.replicate count.toNat '0'
  if k ≤ n ∧ n ≤ 21 then text (digits ++ zeros (n - k))
  else if 0 < n ∧ n ≤ 21 then text (digits.take n.toNat ++ '.' :: digits.drop n.toNat)
  else if -6 < n ∧ n ≤ 0 then text ('0' :: '.' :: zeros (-n) ++ digits)
  else
    let e := n - 1
    let exp := (if e < 0 then "e-" else "e+") ++ toString e.natAbs
    if k == 1 then text digits ++ exp
    else text (digits.take 1 ++ '.' :: digits.drop 1) ++ exp

/-- `c · 10^q` compared with `x · s / d`. -/
def ml_js_cmp (c : Nat) (q : Int) (x s d : Nat) : Ordering :=
  if 0 ≤ q then compare (c * 10 ^ q.toNat * d) (x * s)
  else compare (c * d) (x * s * 10 ^ (-q).toNat)

def ml_js_shortest (m : Nat) (e : Int) (lowerCloser : Bool) : String :=
  -- The value is 4m and the rounding interval [lo, hi], in units of 2^(e-2) = s / d.
  let s := 2 ^ (e - 2).toNat
  let d := 2 ^ (2 - e).toNat
  let v := 4 * m
  let lo := if lowerCloser then v - 1 else v - 2
  let hi := v + 2
  let inclusive := m % 2 == 0
  let above (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q lo s d with
    | .gt => true | .eq => inclusive | .lt => false
  let below (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q hi s d with
    | .lt => true | .eq => inclusive | .gt => false
  -- floor (log10 value) from the bit length, then corrected exactly
  let bits : Int := (Nat.log2 m : Int) + 1 + e
  let guess : Int := Int.fdiv ((bits - 1) * 78913) 262144
  let e10 :=
    if ml_js_cmp 1 (guess + 1) v s d != .gt then guess + 1
    else if ml_js_cmp 1 guess v s d == .gt then guess - 1
    else guess
  let rec search (fuel : Nat) (p : Nat) : String :=
    match fuel with
    | 0 => ""
    | fuel + 1 =>
      let q : Int := e10 - p + 1
      let c :=
        if 0 ≤ q then v * s / (d * 10 ^ q.toNat)
        else v * s * 10 ^ (-q).toNat / d
      let lowOk := above c q ∧ below c q
      let highOk := above (c + 1) q ∧ below (c + 1) q
      if lowOk ∨ highOk then
        let pick :=
          if lowOk ∧ highOk then
            match ml_js_cmp (2 * c + 1) q (2 * v) s d with
            | .gt => c | .lt => c + 1 | .eq => if c % 2 == 0 then c else c + 1
          else if lowOk then c else c + 1
        let text := (toString pick).toList
        let n : Int := q + text.length
        ml_js_layout (text.reverse.dropWhile (· == '0')).reverse n
      else search fuel (p + 1)
  search 17 1

def ml_js_number (x : Float) : String :=
  let bits : Nat := x.toBits.toNat
  let negative := bits ≥ 2 ^ 63
  let exponent : Nat := (bits / 2 ^ 52) % 2048
  let fraction : Nat := bits % 2 ^ 52
  if exponent == 2047 then
    if fraction != 0 then "NaN" else if negative then "-Infinity" else "Infinity"
  else if exponent == 0 ∧ fraction == 0 then "0"
  else
    let body :=
      if exponent == 0 then ml_js_shortest fraction (-1074) false
      else ml_js_shortest (fraction + 2 ^ 52) ((exponent : Int) - 1075) (fraction == 0 ∧ exponent > 1)
    if negative then "-" ++ body else body

def atomAddress (text : Float) : String :=
  ("rml.atom/" ++ (ml_js_number text))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-semantic-closure.mjs#tagAddress@2653 target-sha256=d9dd2f8081da2e930f5bcb0962c2b39fadf707093933d4e6a19718bbca72768a
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

/-- ECMAScript Number::toString: the shortest decimal that reads back as the
value, the nearer one and then the even one on a tie, laid out as JavaScript
prints it; exact Nat arithmetic on the bits. -/
def ml_js_layout (digits : List Char) (n : Int) : String :=
  let k : Int := digits.length
  let text := String.ofList
  let zeros (count : Int) := List.replicate count.toNat '0'
  if k ≤ n ∧ n ≤ 21 then text (digits ++ zeros (n - k))
  else if 0 < n ∧ n ≤ 21 then text (digits.take n.toNat ++ '.' :: digits.drop n.toNat)
  else if -6 < n ∧ n ≤ 0 then text ('0' :: '.' :: zeros (-n) ++ digits)
  else
    let e := n - 1
    let exp := (if e < 0 then "e-" else "e+") ++ toString e.natAbs
    if k == 1 then text digits ++ exp
    else text (digits.take 1 ++ '.' :: digits.drop 1) ++ exp

/-- `c · 10^q` compared with `x · s / d`. -/
def ml_js_cmp (c : Nat) (q : Int) (x s d : Nat) : Ordering :=
  if 0 ≤ q then compare (c * 10 ^ q.toNat * d) (x * s)
  else compare (c * d) (x * s * 10 ^ (-q).toNat)

def ml_js_shortest (m : Nat) (e : Int) (lowerCloser : Bool) : String :=
  -- The value is 4m and the rounding interval [lo, hi], in units of 2^(e-2) = s / d.
  let s := 2 ^ (e - 2).toNat
  let d := 2 ^ (2 - e).toNat
  let v := 4 * m
  let lo := if lowerCloser then v - 1 else v - 2
  let hi := v + 2
  let inclusive := m % 2 == 0
  let above (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q lo s d with
    | .gt => true | .eq => inclusive | .lt => false
  let below (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q hi s d with
    | .lt => true | .eq => inclusive | .gt => false
  -- floor (log10 value) from the bit length, then corrected exactly
  let bits : Int := (Nat.log2 m : Int) + 1 + e
  let guess : Int := Int.fdiv ((bits - 1) * 78913) 262144
  let e10 :=
    if ml_js_cmp 1 (guess + 1) v s d != .gt then guess + 1
    else if ml_js_cmp 1 guess v s d == .gt then guess - 1
    else guess
  let rec search (fuel : Nat) (p : Nat) : String :=
    match fuel with
    | 0 => ""
    | fuel + 1 =>
      let q : Int := e10 - p + 1
      let c :=
        if 0 ≤ q then v * s / (d * 10 ^ q.toNat)
        else v * s * 10 ^ (-q).toNat / d
      let lowOk := above c q ∧ below c q
      let highOk := above (c + 1) q ∧ below (c + 1) q
      if lowOk ∨ highOk then
        let pick :=
          if lowOk ∧ highOk then
            match ml_js_cmp (2 * c + 1) q (2 * v) s d with
            | .gt => c | .lt => c + 1 | .eq => if c % 2 == 0 then c else c + 1
          else if lowOk then c else c + 1
        let text := (toString pick).toList
        let n : Int := q + text.length
        ml_js_layout (text.reverse.dropWhile (· == '0')).reverse n
      else search fuel (p + 1)
  search 17 1

def ml_js_number (x : Float) : String :=
  let bits : Nat := x.toBits.toNat
  let negative := bits ≥ 2 ^ 63
  let exponent : Nat := (bits / 2 ^ 52) % 2048
  let fraction : Nat := bits % 2 ^ 52
  if exponent == 2047 then
    if fraction != 0 then "NaN" else if negative then "-Infinity" else "Infinity"
  else if exponent == 0 ∧ fraction == 0 then "0"
  else
    let body :=
      if exponent == 0 then ml_js_shortest fraction (-1074) false
      else ml_js_shortest (fraction + 2 ^ 52) ((exponent : Int) - 1075) (fraction == 0 ∧ exponent > 1)
    if negative then "-" ++ body else body

def atomAddress (text : String) : String :=
  ("rml.atom/" ++ text)

def tagAddress (kind : Float) : String :=
  (atomAddress ("rml." ++ (ml_js_number kind)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-semantic-closure.mjs#programAddress@2768 target-sha256=ae4d8a0f4e7ae60585490b00aba65efa1786fc9daa9b0b8cd96bd99a6522712d
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

/-- ECMAScript Number::toString: the shortest decimal that reads back as the
value, the nearer one and then the even one on a tie, laid out as JavaScript
prints it; exact Nat arithmetic on the bits. -/
def ml_js_layout (digits : List Char) (n : Int) : String :=
  let k : Int := digits.length
  let text := String.ofList
  let zeros (count : Int) := List.replicate count.toNat '0'
  if k ≤ n ∧ n ≤ 21 then text (digits ++ zeros (n - k))
  else if 0 < n ∧ n ≤ 21 then text (digits.take n.toNat ++ '.' :: digits.drop n.toNat)
  else if -6 < n ∧ n ≤ 0 then text ('0' :: '.' :: zeros (-n) ++ digits)
  else
    let e := n - 1
    let exp := (if e < 0 then "e-" else "e+") ++ toString e.natAbs
    if k == 1 then text digits ++ exp
    else text (digits.take 1 ++ '.' :: digits.drop 1) ++ exp

/-- `c · 10^q` compared with `x · s / d`. -/
def ml_js_cmp (c : Nat) (q : Int) (x s d : Nat) : Ordering :=
  if 0 ≤ q then compare (c * 10 ^ q.toNat * d) (x * s)
  else compare (c * d) (x * s * 10 ^ (-q).toNat)

def ml_js_shortest (m : Nat) (e : Int) (lowerCloser : Bool) : String :=
  -- The value is 4m and the rounding interval [lo, hi], in units of 2^(e-2) = s / d.
  let s := 2 ^ (e - 2).toNat
  let d := 2 ^ (2 - e).toNat
  let v := 4 * m
  let lo := if lowerCloser then v - 1 else v - 2
  let hi := v + 2
  let inclusive := m % 2 == 0
  let above (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q lo s d with
    | .gt => true | .eq => inclusive | .lt => false
  let below (c : Nat) (q : Int) : Bool :=
    match ml_js_cmp c q hi s d with
    | .lt => true | .eq => inclusive | .gt => false
  -- floor (log10 value) from the bit length, then corrected exactly
  let bits : Int := (Nat.log2 m : Int) + 1 + e
  let guess : Int := Int.fdiv ((bits - 1) * 78913) 262144
  let e10 :=
    if ml_js_cmp 1 (guess + 1) v s d != .gt then guess + 1
    else if ml_js_cmp 1 guess v s d == .gt then guess - 1
    else guess
  let rec search (fuel : Nat) (p : Nat) : String :=
    match fuel with
    | 0 => ""
    | fuel + 1 =>
      let q : Int := e10 - p + 1
      let c :=
        if 0 ≤ q then v * s / (d * 10 ^ q.toNat)
        else v * s * 10 ^ (-q).toNat / d
      let lowOk := above c q ∧ below c q
      let highOk := above (c + 1) q ∧ below (c + 1) q
      if lowOk ∨ highOk then
        let pick :=
          if lowOk ∧ highOk then
            match ml_js_cmp (2 * c + 1) q (2 * v) s d with
            | .gt => c | .lt => c + 1 | .eq => if c % 2 == 0 then c else c + 1
          else if lowOk then c else c + 1
        let text := (toString pick).toList
        let n : Int := q + text.length
        ml_js_layout (text.reverse.dropWhile (· == '0')).reverse n
      else search fuel (p + 1)
  search 17 1

def ml_js_number (x : Float) : String :=
  let bits : Nat := x.toBits.toNat
  let negative := bits ≥ 2 ^ 63
  let exponent : Nat := (bits / 2 ^ 52) % 2048
  let fraction : Nat := bits % 2 ^ 52
  if exponent == 2047 then
    if fraction != 0 then "NaN" else if negative then "-Infinity" else "Infinity"
  else if exponent == 0 ∧ fraction == 0 then "0"
  else
    let body :=
      if exponent == 0 then ml_js_shortest fraction (-1074) false
      else ml_js_shortest (fraction + 2 ^ 52) ((exponent : Int) - 1075) (fraction == 0 ∧ exponent > 1)
    if negative then "-" ++ body else body

def programAddress (name : Float) : String :=
  ("rml.program/" ++ (ml_js_number name))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-semantic-closure.mjs#proofRuleKind@7289 target-sha256=6de0d4712b713da16275659a0ff0cf481e52df8b53428a2cf90edf6801ebbfe5
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def proofRuleKind (proof : ((Array Float))) : String :=
  (if ((Float.ofNat proof.size) == (0 : Float)) then "fact" else "inference")

def main : IO Unit := do
  pure ()
