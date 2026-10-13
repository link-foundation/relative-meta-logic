-- rml-certified-item js/src/cst-js.mjs#scanString@4808 target-sha256=0bc86597bbc5f0ecad9ec8e18644b17275d67bd5c8f93d81cd864ebcfbbd416b
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ml_scanString_loop1_result where
  | ml_scanString_loop1_done (j : Float) : ml_scanString_loop1_result
  | ml_scanString_loop1_return (ml_result1 : Float) : ml_scanString_loop1_result
  deriving Repr, Inhabited

partial def ml_scanString_loop1 (src : (Array String)) (j : Float) (quote : String) : ml_scanString_loop1_result :=
  (if (decide (j < (Float.ofNat src.size))) then (let c := (let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none);
    (if (match (c, "\\") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) then (let j_2 := (j + (2 : Float));
      (ml_scanString_loop1 src j_2 quote)) else (if ((match (c, "\n") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) && ((quote == "\"") || (quote == "'"))) then (ml_scanString_loop1_result.ml_scanString_loop1_return j) else (if (match (c, quote) with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) then (ml_scanString_loop1_result.ml_scanString_loop1_return (j + (1 : Float))) else (let j_3 := (j + (1 : Float));
      (ml_scanString_loop1 src j_3 quote)))))) else (ml_scanString_loop1_result.ml_scanString_loop1_done j))

def scanString (src : (Array String)) (j : Float) (quote : String) : Float :=
  (let ml_s1 := (ml_scanString_loop1 src j quote);
    (match ml_s1 with
      | ml_scanString_loop1_result.ml_scanString_loop1_done j_2 => j_2
      | ml_scanString_loop1_result.ml_scanString_loop1_return ml_result1 => ml_result1))

def main : IO Unit := do
  pure ()
