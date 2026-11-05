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

inductive List_i64 where
  | Nil : List_i64
  | Cons (field0 : Int) (field1 : List_i64) : List_i64
  deriving Repr, DecidableEq, Inhabited

inductive List_bool where
  | Nil : List_bool
  | Cons (field0 : Bool) (field1 : List_bool) : List_bool
  deriving Repr, DecidableEq, Inhabited

inductive Tagged_i64 where
  | Tagged_i64 (field0 : Int) (field1 : Int) : Tagged_i64
  deriving Repr, DecidableEq, Inhabited

def rml_tagged_i64_tag (rml_value : Tagged_i64) : Int :=
  (match rml_value with
    | Tagged_i64.Tagged_i64 rml_field ml_f1 => rml_field)

def rml_tagged_i64_value (rml_value : Tagged_i64) : Int :=
  (match rml_value with
    | Tagged_i64.Tagged_i64 ml_f2 rml_field => rml_field)

def length_bool (list : List_bool) (ml_out : List String) : ml_io1 :=
  (match list with
    | List_bool.Nil => (ml_io1.ml_io1_mk ml_out (0 : Int))
    | List_bool.Cons ml_f3 rest => (match (length_bool rest ml_out) with
        | ml_io1.ml_io1_mk ml_o1 ml_v2 => (let ml_w3 := ((1 : Int) + ml_v2);
            (if ((decide (ml_w3 < (-9223372036854775808 : Int))) || (decide (ml_w3 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_o1 "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_o1 ml_w3)))
        | ml_io1.ml_io1_abort ml_o4 ml_m5 => (ml_io1.ml_io1_abort ml_o4 ml_m5)))

def sum (list : List_i64) (ml_out : List String) : ml_io1 :=
  (match list with
    | List_i64.Nil => (ml_io1.ml_io1_mk ml_out (0 : Int))
    | List_i64.Cons head rest => (match (sum rest ml_out) with
        | ml_io1.ml_io1_mk ml_o6 ml_v7 => (let ml_w8 := (head + ml_v7);
            (if ((decide (ml_w8 < (-9223372036854775808 : Int))) || (decide (ml_w8 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ml_o6 "attempt to add with overflow") else (ml_io1.ml_io1_mk ml_o6 ml_w8)))
        | ml_io1.ml_io1_abort ml_o9 ml_m10 => (ml_io1.ml_io1_abort ml_o9 ml_m10)))

def identity_i64 (value : Int) : Int :=
  value

def identity_String (value : String) : String :=
  value

def main : IO Unit := do
  let numbers := (List_i64.Cons (1 : Int) (List_i64.Cons (2 : Int) (List_i64.Cons (3 : Int) List_i64.Nil)))
  let ml_run11 := (match (sum numbers ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o12 ml_v13 => (ml_io2.ml_io2_mk ml_o12 (toString ml_v13))
    | ml_io1.ml_io1_abort ml_o14 ml_m15 => (ml_io2.ml_io2_abort ml_o14 ml_m15))
  for ml_line in (match ml_run11 with
    | ml_io2.ml_io2_mk ml_o16 ml_v17 => ml_o16
    | ml_io2.ml_io2_abort ml_o18 ml_m19 => ml_o18).reverse do IO.println ml_line
  let ml_val20 ← (match ml_run11 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val20
  let flags := (List_bool.Cons true List_bool.Nil)
  let ml_run21 := (match (length_bool flags ([] : List String)) with
    | ml_io1.ml_io1_mk ml_o22 ml_v23 => (ml_io2.ml_io2_mk ml_o22 (toString ml_v23))
    | ml_io1.ml_io1_abort ml_o24 ml_m25 => (ml_io2.ml_io2_abort ml_o24 ml_m25))
  for ml_line in (match ml_run21 with
    | ml_io2.ml_io2_mk ml_o26 ml_v27 => ml_o26
    | ml_io2.ml_io2_abort ml_o28 ml_m29 => ml_o28).reverse do IO.println ml_line
  let ml_val30 ← (match ml_run21 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val30
  let tagged := (Tagged_i64.Tagged_i64 (7 : Int) (identity_i64 (35 : Int)))
  let ml_run31 := (match (let ml_a32 := (rml_tagged_i64_tag tagged);
    (let ml_a33 := (rml_tagged_i64_value tagged);
      (let ml_w34 := (ml_a32 + ml_a33);
        (if ((decide (ml_w34 < (-9223372036854775808 : Int))) || (decide (ml_w34 > (9223372036854775807 : Int)))) then (ml_io1.ml_io1_abort ([] : List String) "attempt to add with overflow") else (ml_io1.ml_io1_mk ([] : List String) ml_w34))))) with
    | ml_io1.ml_io1_mk ml_o35 ml_v36 => (ml_io2.ml_io2_mk ml_o35 (toString ml_v36))
    | ml_io1.ml_io1_abort ml_o37 ml_m38 => (ml_io2.ml_io2_abort ml_o37 ml_m38))
  for ml_line in (match ml_run31 with
    | ml_io2.ml_io2_mk ml_o39 ml_v40 => ml_o39
    | ml_io2.ml_io2_abort ml_o41 ml_m42 => ml_o41).reverse do IO.println ml_line
  let ml_val43 ← (match ml_run31 with
    | ml_io2.ml_io2_mk _ ml_v => pure ml_v
    | ml_io2.ml_io2_abort _ ml_m => throw (IO.userError ml_m))
  IO.println ml_val43
  IO.println (identity_String "generic")
