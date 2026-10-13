-- rml-certified-item js/src/cst-rust.mjs#scanBlockComment@5954 target-sha256=a9d9d3971b9ba1f45717861383db416aee2bce60fcde6a41e2f6c79f5a495023
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

partial def ml_scanBlockComment_loop1 (src : (Array String)) (j : Float) (depth : Float) : Float :=
  (if ((decide (j < (Float.ofNat src.size))) && (decide (depth > (0 : Float)))) then (if ((match ((let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "/") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) && (match ((let ml_index := (j + (1 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "*") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (let depth_2 := (depth + (1 : Float));
    (let j_2 := (j + (2 : Float));
      (ml_scanBlockComment_loop1 src j_2 depth_2))) else (if ((match ((let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "*") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) && (match ((let ml_index := (j + (1 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "/") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (let depth_3 := (depth - (1 : Float));
    (let j_3 := (j + (2 : Float));
      (ml_scanBlockComment_loop1 src j_3 depth_3))) else (let j_4 := (j + (1 : Float));
    (ml_scanBlockComment_loop1 src j_4 depth)))) else j)

def scanBlockComment (src : (Array String)) (i : Float) : Float :=
  (let j := (i + (2 : Float));
    (let depth := (1 : Float);
      (let j_2 := (ml_scanBlockComment_loop1 src j depth);
        j_2)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/cst-rust.mjs#scanString@6274 target-sha256=23e86e581f70d6a34f08d4898a6c5934989e67d23c380e5e690ce7f91361b24b
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
      (ml_scanString_loop1 src j_2 quote)) else (if (match (c, quote) with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) then (ml_scanString_loop1_result.ml_scanString_loop1_return (j + (1 : Float))) else (let j_3 := (j + (1 : Float));
      (ml_scanString_loop1 src j_3 quote))))) else (ml_scanString_loop1_result.ml_scanString_loop1_done j))

def scanString (src : (Array String)) (j : Float) (quote : String) : Float :=
  (let ml_s1 := (ml_scanString_loop1 src j quote);
    (match ml_s1 with
      | ml_scanString_loop1_result.ml_scanString_loop1_done j_2 => j_2
      | ml_scanString_loop1_result.ml_scanString_loop1_return ml_result1 => ml_result1))

def main : IO Unit := do
  pure ()
