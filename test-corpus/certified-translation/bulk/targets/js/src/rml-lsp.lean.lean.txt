-- rml-certified-item js/src/rml-lsp.mjs#lspRange@2712 target-sha256=4578ac1d445d58b5569097d78090095f677ac76fb5043872635dd53c0bcf13b7
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

/-- Math.trunc: towards zero, a zero result keeping the sign of the argument. -/
def ml_trunc (x : Float) : Float := if x < 0 then x.ceil else x.floor
/-- Math.round: the nearest integer, the one towards +Infinity on a tie, and -0 from -0.5 up to 0. -/
def ml_round (x : Float) : Float :=
  if x.isNaN || x.isInf || x == 0 then x
  else if x > 0 ∧ x < 0.5 then 0
  else if x < 0 ∧ x ≥ -0.5 then -0.0
  else if x - x.floor ≥ 0.5 then x.floor + 1 else x.floor
/-- Math.sign: 1 or -1, and -0, 0 and NaN as they are. -/
def ml_sign (x : Float) : Float := if x > 0 then 1 else if x < 0 then -1 else x
/-- Math.max of two Numbers: NaN when either is, and 0 above -0. -/
def ml_max (a b : Float) : Float :=
  if a > b then a else if b > a then b else if a == b then (if 1 / a < 0 then b else a) else 0.0 / 0.0
/-- Math.min of two Numbers: NaN when either is, and -0 below 0. -/
def ml_min (a b : Float) : Float :=
  if a < b then a else if b < a then b else if a == b then (if 1 / a < 0 then a else b) else 0.0 / 0.0
def ml_is_integer (x : Float) : Bool := x.isFinite && ml_trunc x == x
def ml_is_safe_integer (x : Float) : Bool := ml_is_integer x && decide (x.abs ≤ 9007199254740991)

def lspRange (line : Float) (character : Float) (length : Float) : ((Float × Float) × (Float × Float)) :=
  (let start := (let ml_field1 := (ml_max (0 : Float) line);
    (let ml_field2 := (ml_max (0 : Float) character);
      (ml_field2, ml_field1)));
    (let ml_field3 := start;
      (let ml_field6 := (let ml_field4 := (start).2;
        (let ml_field5 := ((start).1 + (ml_max (1 : Float) length));
          (ml_field5, ml_field4)));
        (ml_field6, ml_field3))))

def main : IO Unit := do
  pure ()
