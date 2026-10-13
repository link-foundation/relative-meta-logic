-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ml_io1 where
  | ml_io1_mk (output : List String) (value : Int) : ml_io1
  | ml_io1_abort (output : List String) (message : String) : ml_io1
  deriving Inhabited

inductive ml_io2 where
  | ml_io2_mk (output : List String) (value : String) : ml_io2
  | ml_io2_abort (output : List String) (message : String) : ml_io2
  deriving Inhabited

partial def gcd (a : Int) (b : Int) (ml_out : List String) : ml_io1 :=
  (if (b == (0 : Int)) then (ml_io1.ml_io1_mk ml_out a) else (match (if (b == (0 : Int)) then (ml_io1.ml_io1_abort ml_out "attempt to calculate the remainder with a divisor of zero") else (if ((a == (-9223372036854775808 : Int)) && (b == (-1 : Int))) then (ml_io1.ml_io1_abort ml_out "attempt to calculate the remainder with overflow") else (ml_io1.ml_io1_mk ml_out (Int.tmod a b)))) with
    | ml_io1.ml_io1_mk ml_o1 ml_v2 => (gcd b ml_v2 ml_o1)
    | ml_io1.ml_io1_abort ml_o3 ml_m4 => (ml_io1.ml_io1_abort ml_o3 ml_m4)))

partial def triangle (n : Int) (ml_out : List String) : ml_io1 :=
  (if (n == (0 : Int)) then (ml_io1.ml_io1_mk ml_out (0 : Int)) else (match (match (let ml_w5 := (n - (1 : Int));
    (if ((decide (ml_w5 < (-9223372036854775808 : Int))) || (decide (ml_w5 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_out "attempt to subtract with overflow") else (ml_io1.ml_io1_mk ml_out ml_w5))) with
    | ml_io1.ml_io1_mk ml_o6 ml_v7 => (triangle ml_v7 ml_o6)
    | ml_io1.ml_io1_abort ml_o8 ml_m9 => (ml_io1.ml_io1_abort ml_o8 ml_m9)) with
    | ml_io1.ml_io1_mk ml_o10 ml_v11 => (let ml_w12 := (n + ml_v11);
        (if ((decide (ml_w12 < (-9223372036854775808 : Int))) || (decide (ml_w12 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_o10 "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_o10 ml_w12)))
    | ml_io1.ml_io1_abort ml_o13 ml_m14 => (ml_io1.ml_io1_abort ml_o13 ml_m14)))

def sign (value : Int) : Int :=
  (if (value == (0 : Int)) then (0 : Int) else (if (decide (value > (0 : Int))) then (1 : Int) else (-1 : Int)))

def main : IO Unit := do
  let ml_run15 := (gcd (84 : Int) (36 : Int) ([] : List String))
  for ml_line in (match ml_run15 with
    | ml_io1.ml_io1_mk ml_o16 ml_v17 => ml_o16
    | ml_io1.ml_io1_abort ml_o18 ml_m19 => ml_o18).reverse do IO.println ml_line
  let ml_val20 ← (match ml_run15 with
    | ml_io1.ml_io1_mk _ ml_v => pure ml_v
    | ml_io1.ml_io1_abort _ ml_m => throw (IO.userError ml_m))
  let a := ml_val20
  IO.println (toString a)
  let ml_run21 := (match (triangle (10 : Int) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o22 ml_v23 => (ml_io2.ml_io2_mk ml_o22 (toString ml_v23))
    | ml_io1.ml_io1_abort ml_o24 ml_m25 => (ml_io2.ml_io2_abort ml_o24 ml_m25))
  for ml_line in (match ml_run21 with
    | ml_io2.ml_io2_mk ml_o26 ml_v27 => ml_o26
    | ml_io2.ml_io2_abort ml_o28 ml_m29 => ml_o28).reverse do IO.println ml_line
  let ml_val30 ← (match ml_run21 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val30
  IO.println (((toString (sign (-7 : Int))) ++ " ") ++ (toString (sign a)))
  let ml_run31 := (triangle (4 : Int) ([] : List String))
  for ml_line in (match ml_run31 with
    | ml_io1.ml_io1_mk ml_o32 ml_v33 => ml_o32
    | ml_io1.ml_io1_abort ml_o34 ml_m35 => ml_o34).reverse do IO.println ml_line
  let ml_val36 ← (match ml_run31 with
    | ml_io1.ml_io1_mk _ ml_v => pure ml_v
    | ml_io1.ml_io1_abort _ ml_m => throw (IO.userError ml_m))
  if !(ml_val36 == (10 : Int)) then throw (IO.userError "assertion 1 failed")
