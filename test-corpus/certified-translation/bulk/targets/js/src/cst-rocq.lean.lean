-- rml-certified-item js/src/cst-rocq.mjs#scanBlockComment@2899 target-sha256=2ca51ca865297779b9948412f279ba22ef2ed73c737f3c55b1f357be59e91666
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

partial def ml_scanBlockComment_loop1 (src : (Array String)) (j : Float) (depth : Float) : Float :=
  (if ((decide (j < (Float.ofNat src.size))) && (decide (depth > (0 : Float)))) then (if ((match ((let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "(") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) && (match ((let ml_index := (j + (1 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "*") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (let depth_2 := (depth + (1 : Float));
    (let j_2 := (j + (2 : Float));
      (ml_scanBlockComment_loop1 src j_2 depth_2))) else (if ((match ((let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "*") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) && (match ((let ml_index := (j + (1 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), ")") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (let depth_3 := (depth - (1 : Float));
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
-- rml-certified-item js/src/cst-rocq.mjs#scanRocqString@3181 target-sha256=9ea01ccaa22e435006a7456db4fc032ec71f47dd561a1333cb64c8d455f210d9
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

inductive ml_scanRocqString_loop1_result where
  | ml_scanRocqString_loop1_done (j : Float) : ml_scanRocqString_loop1_result
  | ml_scanRocqString_loop1_return (ml_result1 : Float) : ml_scanRocqString_loop1_result
  deriving Repr, Inhabited

partial def ml_scanRocqString_loop1 (src : (Array String)) (j : Float) : ml_scanRocqString_loop1_result :=
  (if (decide (j < (Float.ofNat src.size))) then (if (match ((let ml_index := j; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "\"") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) then (if (match ((let ml_index := (j + (1 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then src[ml_index.toUInt64.toNat]? else none), "\"") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false) then (let j_2 := (j + (2 : Float));
    (ml_scanRocqString_loop1 src j_2)) else (ml_scanRocqString_loop1_result.ml_scanRocqString_loop1_return (j + (1 : Float)))) else (let j_3 := (j + (1 : Float));
    (ml_scanRocqString_loop1 src j_3))) else (ml_scanRocqString_loop1_result.ml_scanRocqString_loop1_done j))

def scanRocqString (src : (Array String)) (j : Float) : Float :=
  (let ml_s1 := (ml_scanRocqString_loop1 src j);
    (match ml_s1 with
      | ml_scanRocqString_loop1_result.ml_scanRocqString_loop1_done j_2 => j_2
      | ml_scanRocqString_loop1_result.ml_scanRocqString_loop1_return ml_result1 => ml_result1))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/cst-rocq.mjs#isRocqPunctChar@4371 target-sha256=c40f2ce1089da06ee5e9ae0bd59d2c4f6aa8a175df9c249912121474cb945f45
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

/-- String.prototype.includes: the search occurs at some position of the string. -/
def ml_string_includes (string search : String) : Bool :=
  (List.range (string.length + 1)).any fun index => (string.drop index).startsWith search

def isRocqPunctChar (c : String) : Bool :=
  (ml_string_includes "→←⟨⟩∀∃∧∨¬" c)

def main : IO Unit := do
  pure ()
