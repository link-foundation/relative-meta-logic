-- rml-certified-item js/src/rml-certified-translation.mjs#section@34417 target-sha256=73ac88a5c66b427cc547ea4765db091b4d9dc8d584b6ab582031f26e0d3a9ea8
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def «section» (form : (Array (Array Float))) (name : (Option Float)) : (Option (Array Float)) :=
  (let ml_values := form; let ml_callback := (fun (item : (Array Float)) => ((let ml_array_test1 := item;
    true) && (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then item[ml_index.toUInt64.toNat]? else none), name) with | (some ml_left, some ml_right) => (ml_left == ml_right) | (none, none) => true | _ => false)));  (ml_values.toList.zipIdx.find? (fun ml_pair => (ml_callback ml_pair.1))).map (fun ml_pair => ml_pair.1))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-certified-translation.mjs#sections@34517 target-sha256=cab6d844d72ec99092dea38887c39acb0f753d4348e94a5767b9e166389cb72e
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def sections (form : (Array (Array Float))) (name : (Option Float)) : (Array (Array Float)) :=
  (let ml_values := form; let ml_callback := (fun (item : (Array Float)) => ((let ml_array_test1 := item;
    true) && (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then item[ml_index.toUInt64.toNat]? else none), name) with | (some ml_left, some ml_right) => (ml_left == ml_right) | (none, none) => true | _ => false)));  ((ml_values.toList.zipIdx.filter (fun ml_pair => (ml_callback ml_pair.1))).map (fun ml_pair => ml_pair.1)).toArray)

def main : IO Unit := do
  pure ()
