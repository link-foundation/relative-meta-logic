-- Translated from Rust by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ml_io1 where
  | ml_io1_mk (output : List String) (value : Nat) : ml_io1
  | ml_io1_abort (output : List String) (message : String) : ml_io1
  deriving Inhabited

inductive ml_io2 where
  | ml_io2_mk (output : List String) (value : String) : ml_io2
  | ml_io2_abort (output : List String) (message : String) : ml_io2
  deriving Inhabited

namespace geometry

inductive Shape where
  | Square (field0 : Nat) : Shape
  | Rect (field0 : Nat) (field1 : Nat) : Shape
  | Group (field0 : geometry.Shape) (field1 : geometry.Shape) : Shape
  deriving Repr, DecidableEq, Inhabited

def area (shape : geometry.Shape) (ml_out : List String) : ml_io1 :=
  (match shape with
    | geometry.Shape.Square side => (let ml_w1 := (side * side);
        (if (decide (ml_w1 > (18446744073709551615 : Nat))) then (ml_io1.ml_io1_abort ml_out "attempt to multiply with overflow") else (ml_io1.ml_io1_mk ml_out ml_w1)))
    | geometry.Shape.Rect width height => (let ml_w2 := (width * height);
        (if (decide (ml_w2 > (18446744073709551615 : Nat))) then (ml_io1.ml_io1_abort ml_out "attempt to multiply with overflow") else (ml_io1.ml_io1_mk ml_out ml_w2)))
    | geometry.Shape.Group first second => (match (geometry.area first ml_out) with
        | ml_io1.ml_io1_mk ml_o3 ml_v4 => (match (geometry.area second ml_o3) with
            | ml_io1.ml_io1_mk ml_o5 ml_v6 => (let ml_w7 := (ml_v4 + ml_v6);
                (if (decide (ml_w7 > (18446744073709551615 : Nat))) then (ml_io1.ml_io1_abort ml_o5 "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_o5 ml_w7)))
            | ml_io1.ml_io1_abort ml_o8 ml_m9 => (ml_io1.ml_io1_abort ml_o8 ml_m9))
        | ml_io1.ml_io1_abort ml_o10 ml_m11 => (ml_io1.ml_io1_abort ml_o10 ml_m11)))

def count (shape : geometry.Shape) (ml_out : List String) : ml_io1 :=
  (match shape with
    | geometry.Shape.Square ml_f1 => (ml_io1.ml_io1_mk ml_out (1 : Nat))
    | geometry.Shape.Rect ml_f2 ml_f3 => (ml_io1.ml_io1_mk ml_out (1 : Nat))
    | geometry.Shape.Group first second => (match (geometry.count first ml_out) with
        | ml_io1.ml_io1_mk ml_o12 ml_v13 => (match (geometry.count second ml_o12) with
            | ml_io1.ml_io1_mk ml_o14 ml_v15 => (let ml_w16 := (ml_v13 + ml_v15);
                (if (decide (ml_w16 > (18446744073709551615 : Nat))) then (ml_io1.ml_io1_abort ml_o14 "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_o14 ml_w16)))
            | ml_io1.ml_io1_abort ml_o17 ml_m18 => (ml_io1.ml_io1_abort ml_o17 ml_m18))
        | ml_io1.ml_io1_abort ml_o19 ml_m20 => (ml_io1.ml_io1_abort ml_o19 ml_m20)))

end geometry

def describe (total : Nat) : String :=
  (if (decide (total > (100 : Nat))) then "large" else "small")

theorem ml_assertion_1 : (let first := (geometry.Shape.Group (geometry.Shape.Square (3 : Nat)) (geometry.Shape.Rect (4 : Nat) (5 : Nat))); let ml_run21 := (match (geometry.area first ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o22 ml_v23 => (ml_io2.ml_io2_mk ml_o22 (toString ml_v23))
    | ml_io1.ml_io1_abort ml_o24 ml_m25 => (ml_io2.ml_io2_abort ml_o24 ml_m25)); (match ml_run21 with | ml_io2.ml_io2_mk _ ml_val30 => let ml_run31 := (match (geometry.count (geometry.Shape.Group (geometry.Shape.Square (1 : Nat)) (geometry.Shape.Group (geometry.Shape.Square (2 : Nat)) (geometry.Shape.Rect (2 : Nat) (3 : Nat)))) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o32 ml_v33 => (ml_io2.ml_io2_mk ml_o32 (toString ml_v33))
    | ml_io1.ml_io1_abort ml_o34 ml_m35 => (ml_io2.ml_io2_abort ml_o34 ml_m35)); (match ml_run31 with | ml_io2.ml_io2_mk _ ml_val40 => let ml_run41 := (match (geometry.area (geometry.Shape.Rect (20 : Nat) (6 : Nat)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o42 ml_v43 => (ml_io2.ml_io2_mk ml_o42 (describe ml_v43))
    | ml_io1.ml_io1_abort ml_o44 ml_m45 => (ml_io2.ml_io2_abort ml_o44 ml_m45)); (match ml_run41 with | ml_io2.ml_io2_mk _ ml_val50 => let ml_run51 := (geometry.area (geometry.Shape.Square (4 : Nat)) ([] : List String)); (match ml_run51 with | ml_io1.ml_io1_mk _ ml_val56 => decide ((ml_val56 = (16 : Nat))) | ml_io1.ml_io1_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true)) = true := by
  try rfl
  try decide

def main : IO Unit := do
  let first := (geometry.Shape.Group (geometry.Shape.Square (3 : Nat)) (geometry.Shape.Rect (4 : Nat) (5 : Nat)))
  let ml_run21 := (match (geometry.area first ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o22 ml_v23 => (ml_io2.ml_io2_mk ml_o22 (toString ml_v23))
    | ml_io1.ml_io1_abort ml_o24 ml_m25 => (ml_io2.ml_io2_abort ml_o24 ml_m25))
  for ml_line in (match ml_run21 with
    | ml_io2.ml_io2_mk ml_o26 ml_v27 => ml_o26
    | ml_io2.ml_io2_abort ml_o28 ml_m29 => ml_o28).reverse do IO.println ml_line
  let ml_val30 ← (match ml_run21 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val30
  let ml_run31 := (match (geometry.count (geometry.Shape.Group (geometry.Shape.Square (1 : Nat)) (geometry.Shape.Group (geometry.Shape.Square (2 : Nat)) (geometry.Shape.Rect (2 : Nat) (3 : Nat)))) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o32 ml_v33 => (ml_io2.ml_io2_mk ml_o32 (toString ml_v33))
    | ml_io1.ml_io1_abort ml_o34 ml_m35 => (ml_io2.ml_io2_abort ml_o34 ml_m35))
  for ml_line in (match ml_run31 with
    | ml_io2.ml_io2_mk ml_o36 ml_v37 => ml_o36
    | ml_io2.ml_io2_abort ml_o38 ml_m39 => ml_o38).reverse do IO.println ml_line
  let ml_val40 ← (match ml_run31 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val40
  let ml_run41 := (match (geometry.area (geometry.Shape.Rect (20 : Nat) (6 : Nat)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o42 ml_v43 => (ml_io2.ml_io2_mk ml_o42 (describe ml_v43))
    | ml_io1.ml_io1_abort ml_o44 ml_m45 => (ml_io2.ml_io2_abort ml_o44 ml_m45))
  for ml_line in (match ml_run41 with
    | ml_io2.ml_io2_mk ml_o46 ml_v47 => ml_o46
    | ml_io2.ml_io2_abort ml_o48 ml_m49 => ml_o48).reverse do IO.println ml_line
  let ml_val50 ← (match ml_run41 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val50
  let ml_run51 := (geometry.area (geometry.Shape.Square (4 : Nat)) ([] : List String))
  for ml_line in (match ml_run51 with
    | ml_io1.ml_io1_mk ml_o52 ml_v53 => ml_o52
    | ml_io1.ml_io1_abort ml_o54 ml_m55 => ml_o54).reverse do IO.println ml_line
  let ml_val56 ← (match ml_run51 with
    | ml_io1.ml_io1_mk _ ml_v => pure ml_v
    | ml_io1.ml_io1_abort _ ml_m => throw (IO.userError ml_m))
