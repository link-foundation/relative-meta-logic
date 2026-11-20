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

inductive Point where
  | Point (field0 : Int) (field1 : Int) : Point
  deriving Repr, DecidableEq, Inhabited

def rml_point_x (rml_value : Point) : Int :=
  (match rml_value with
    | Point.Point rml_field ml_f1 => rml_field)

def rml_point_y (rml_value : Point) : Int :=
  (match rml_value with
    | Point.Point ml_f2 rml_field => rml_field)

inductive Pair where
  | Pair (field0 : Int) (field1 : Int) : Pair
  deriving Repr, DecidableEq, Inhabited

def rml_pair_0 (rml_value : Pair) : Int :=
  (match rml_value with
    | Pair.Pair rml_field ml_f3 => rml_field)

inductive Shape where
  | Circle (field0 : Int) : Shape
  | Rect (field0 : Point) (field1 : Int) (field2 : Int) : Shape
  deriving Repr, DecidableEq, Inhabited

def manhattan (point : Point) (ml_out : List String) : ml_io1 :=
  (let ml_a1 := (rml_point_x point);
    (let ml_a2 := (rml_point_y point);
      (let ml_w3 := (ml_a1 + ml_a2);
        (if ((decide (ml_w3 < (-9223372036854775808 : Int))) || (decide (ml_w3 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_out "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_out ml_w3)))))

def swap (pair : Pair) : Pair :=
  (match pair with
    | Pair.Pair first second => (Pair.Pair second first))

def area (shape : Shape) (ml_out : List String) : ml_io1 :=
  (match shape with
    | Shape.Circle radius => (match (let ml_w4 := ((3 : Int) * radius);
        (if ((decide (ml_w4 < (-9223372036854775808 : Int))) || (decide (ml_w4 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_out "attempt to multiply with overflow") else (ml_io1.ml_io1_mk ml_out ml_w4))) with
        | ml_io1.ml_io1_mk ml_o5 ml_v6 => (let ml_w7 := (ml_v6 * radius);
            (if ((decide (ml_w7 < (-9223372036854775808 : Int))) || (decide (ml_w7 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_o5 "attempt to multiply with overflow") else (ml_io1.ml_io1_mk ml_o5 ml_w7)))
        | ml_io1.ml_io1_abort ml_o8 ml_m9 => (ml_io1.ml_io1_abort ml_o8 ml_m9))
    | Shape.Rect ml_f4 width height => (let ml_w10 := (width * height);
        (if ((decide (ml_w10 < (-9223372036854775808 : Int))) || (decide (ml_w10 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_out "attempt to multiply with overflow") else (ml_io1.ml_io1_mk ml_out ml_w10))))

def corner_sum (shape : Shape) (ml_out : List String) : ml_io1 :=
  (match shape with
    | Shape.Circle ml_f5 => (ml_io1.ml_io1_mk ml_out (0 : Int))
    | Shape.Rect ml_f6 ml_f7 ml_f8 => (match ml_f6 with
        | Point.Point x y => (let ml_w11 := (x + y);
            (if ((decide (ml_w11 < (-9223372036854775808 : Int))) || (decide (ml_w11 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_out "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_out ml_w11)))))

theorem ml_assertion_1 : (let corner := (Point.Point (3 : Int) (4 : Int)); let ml_run12 := (match (manhattan corner ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o13 ml_v14 => (ml_io2.ml_io2_mk ml_o13 (toString ml_v14))
    | ml_io1.ml_io1_abort ml_o15 ml_m16 => (ml_io2.ml_io2_abort ml_o15 ml_m16)); (match ml_run12 with | ml_io2.ml_io2_mk _ ml_val21 => let x := (rml_point_x corner); let pair := (swap (Pair.Pair (1 : Int) (2 : Int))); let ml_run22 := (match (area (Shape.Rect (Point.Point (1 : Int) (2 : Int)) (5 : Int) (6 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o23 ml_v24 => (ml_io2.ml_io2_mk ml_o23 (toString ml_v24))
    | ml_io1.ml_io1_abort ml_o25 ml_m26 => (ml_io2.ml_io2_abort ml_o25 ml_m26)); (match ml_run22 with | ml_io2.ml_io2_mk _ ml_val31 => let ml_run32 := (match (area (Shape.Circle (2 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o33 ml_v34 => (ml_io2.ml_io2_mk ml_o33 (toString ml_v34))
    | ml_io1.ml_io1_abort ml_o35 ml_m36 => (ml_io2.ml_io2_abort ml_o35 ml_m36)); (match ml_run32 with | ml_io2.ml_io2_mk _ ml_val41 => let ml_run42 := (match (corner_sum (Shape.Rect corner (1 : Int) (1 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o43 ml_v44 => (ml_io2.ml_io2_mk ml_o43 (toString ml_v44))
    | ml_io1.ml_io1_abort ml_o45 ml_m46 => (ml_io2.ml_io2_abort ml_o45 ml_m46)); (match ml_run42 with | ml_io2.ml_io2_mk _ ml_val51 => let ml_run52 := (manhattan (Point.Point (-2 : Int) (2 : Int)) ([] : List String)); (match ml_run52 with | ml_io1.ml_io1_mk _ ml_val57 => decide ((ml_val57 = (0 : Int))) | ml_io1.ml_io1_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true) | ml_io2.ml_io2_abort _ _ => true)) = true := by
  try rfl
  try decide

def main : IO Unit := do
  let corner := (Point.Point (3 : Int) (4 : Int))
  let ml_run12 := (match (manhattan corner ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o13 ml_v14 => (ml_io2.ml_io2_mk ml_o13 (toString ml_v14))
    | ml_io1.ml_io1_abort ml_o15 ml_m16 => (ml_io2.ml_io2_abort ml_o15 ml_m16))
  for ml_line in (match ml_run12 with
    | ml_io2.ml_io2_mk ml_o17 ml_v18 => ml_o17
    | ml_io2.ml_io2_abort ml_o19 ml_m20 => ml_o19).reverse do IO.println ml_line
  let ml_val21 ← (match ml_run12 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val21
  let x := (rml_point_x corner)
  IO.println (toString x)
  let pair := (swap (Pair.Pair (1 : Int) (2 : Int)))
  IO.println (toString (rml_pair_0 pair))
  let ml_run22 := (match (area (Shape.Rect (Point.Point (1 : Int) (2 : Int)) (5 : Int) (6 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o23 ml_v24 => (ml_io2.ml_io2_mk ml_o23 (toString ml_v24))
    | ml_io1.ml_io1_abort ml_o25 ml_m26 => (ml_io2.ml_io2_abort ml_o25 ml_m26))
  for ml_line in (match ml_run22 with
    | ml_io2.ml_io2_mk ml_o27 ml_v28 => ml_o27
    | ml_io2.ml_io2_abort ml_o29 ml_m30 => ml_o29).reverse do IO.println ml_line
  let ml_val31 ← (match ml_run22 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val31
  let ml_run32 := (match (area (Shape.Circle (2 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o33 ml_v34 => (ml_io2.ml_io2_mk ml_o33 (toString ml_v34))
    | ml_io1.ml_io1_abort ml_o35 ml_m36 => (ml_io2.ml_io2_abort ml_o35 ml_m36))
  for ml_line in (match ml_run32 with
    | ml_io2.ml_io2_mk ml_o37 ml_v38 => ml_o37
    | ml_io2.ml_io2_abort ml_o39 ml_m40 => ml_o39).reverse do IO.println ml_line
  let ml_val41 ← (match ml_run32 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val41
  let ml_run42 := (match (corner_sum (Shape.Rect corner (1 : Int) (1 : Int)) ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o43 ml_v44 => (ml_io2.ml_io2_mk ml_o43 (toString ml_v44))
    | ml_io1.ml_io1_abort ml_o45 ml_m46 => (ml_io2.ml_io2_abort ml_o45 ml_m46))
  for ml_line in (match ml_run42 with
    | ml_io2.ml_io2_mk ml_o47 ml_v48 => ml_o47
    | ml_io2.ml_io2_abort ml_o49 ml_m50 => ml_o49).reverse do IO.println ml_line
  let ml_val51 ← (match ml_run42 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val51
  let ml_run52 := (manhattan (Point.Point (-2 : Int) (2 : Int)) ([] : List String))
  for ml_line in (match ml_run52 with
    | ml_io1.ml_io1_mk ml_o53 ml_v54 => ml_o53
    | ml_io1.ml_io1_abort ml_o55 ml_m56 => ml_o55).reverse do IO.println ml_line
  let ml_val57 ← (match ml_run52 with
    | ml_io1.ml_io1_mk _ ml_v => pure ml_v
    | ml_io1.ml_io1_abort _ ml_m => throw (IO.userError ml_m))
