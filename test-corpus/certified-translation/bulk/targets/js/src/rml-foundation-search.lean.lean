-- rml-certified-item js/src/rml-foundation-search.mjs#permutations@3045 target-sha256=67ccb5a73b8ca50632c6d04ae0cc05ece2d90fb07a136bde73868f54d81f77aa
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

partial def permutations (values : (Array Float)) : (Array (Array Float)) :=
  (if ((Float.ofNat values.size) == (0 : Float)) then (#[(#[] : (Array Float))] : (Array (Array Float))) else (let ml_values := values; let ml_callback := (fun (value : Float) (index : Float) => (let rest := (let ml_values := values; let ml_callback := (fun (_ : Float) (candidate : Float) => (candidate != index));  ((ml_values.toList.zipIdx.filter (fun ml_pair => (ml_callback ml_pair.1 (Float.ofNat ml_pair.2)))).map (fun ml_pair => ml_pair.1)).toArray);
    (let ml_values := (permutations rest); let ml_callback := (fun (permutation : (Array Float)) => ((#[value] : (Array Float)) ++ permutation));  (ml_values.toList.zipIdx.map (fun ml_pair => (ml_callback ml_pair.1))).toArray)));  (ml_values.toList.zipIdx.flatMap (fun ml_pair => (ml_callback ml_pair.1 (Float.ofNat ml_pair.2)).toList)).toArray))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-foundation-search.mjs#applyObservationAction@4217 target-sha256=3416638b7fb3f3fd12e8040fe9df204a9406c8e729e47ac9699c2408a24e2716
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def applyObservationAction (assignment : (Array Float)) (action : ((Array Float) × (Array Float))) : (Array (Option Float)) :=
  (let ml_values := (action).1; let ml_callback := (fun (occurrence : Float) => (let ml_index := (match (let ml_index := occurrence; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then assignment[ml_index.toUInt64.toNat]? else none) with | some ml_present => ml_present | none => (0 / 0 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then (action).2[ml_index.toUInt64.toNat]? else none));  (ml_values.toList.zipIdx.map (fun ml_pair => (ml_callback ml_pair.1))).toArray)

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-foundation-search.mjs#observationSignature@5435 target-sha256=ff755caabcde63acde1966cdc5506d27a5d18a7f5226027520934fb8918d682b
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def observationSignature (assignment : (Array Float)) : String :=
  (if (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then assignment[ml_index.toUInt64.toNat]? else none), (let ml_index := (1 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then assignment[ml_index.toUInt64.toNat]? else none)) with | (some ml_left, some ml_right) => (ml_left == ml_right) | (none, none) => true | _ => false) then "same-reference" else "distinct-references")

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-foundation-search.mjs#mapsCommute@6051 target-sha256=90ca685fed478c2917dcb50cb5ab4ec57a52139cc244ea5cfcb10b9117c71bee
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def mapsCommute (left : (Array Float)) (right : (Array Float)) : Bool :=
  (let ml_values := left; let ml_callback := (fun (_ : Float) (index : Float) => (match ((let ml_index := (match (let ml_index := index; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then right[ml_index.toUInt64.toNat]? else none) with | some ml_present => ml_present | none => (0 / 0 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then left[ml_index.toUInt64.toNat]? else none), (let ml_index := (match (let ml_index := index; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then left[ml_index.toUInt64.toNat]? else none) with | some ml_present => ml_present | none => (0 / 0 : Float)); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then right[ml_index.toUInt64.toNat]? else none)) with | (some ml_left, some ml_right) => (ml_left == ml_right) | (none, none) => true | _ => false));  ml_values.toList.zipIdx.all (fun ml_pair => (ml_callback ml_pair.1 (Float.ofNat ml_pair.2))))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-foundation-search.mjs#hasRecord@29269 target-sha256=1e1fe27a5712284de79c0d0b2d48aa2b449f8a68a26af27ccb6bb286026354af
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def hasRecord (records : (Array (Array (Option Float)))) (expected : (Array Float)) : Bool :=
  (let ml_values := records; let ml_callback := (fun (record : (Array (Option Float))) => (((Float.ofNat record.size) == (Float.ofNat expected.size)) && (let ml_values := record; let ml_callback := (fun (value : (Option Float)) (index : Float) => (match (value, (let ml_index := index; if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then expected[ml_index.toUInt64.toNat]? else none)) with | (some ml_left, some ml_right) => (ml_left == ml_right) | (none, none) => true | _ => false));  ml_values.toList.zipIdx.all (fun ml_pair => (ml_callback ml_pair.1 (Float.ofNat ml_pair.2))))));  ml_values.toList.zipIdx.any (fun ml_pair => (ml_callback ml_pair.1)))

def main : IO Unit := do
  pure ()
