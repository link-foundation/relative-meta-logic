-- rml-certified-item js/src/rml-lino-frontend.mjs#isIndentedIdItem@18157 target-sha256=4f54376d38c6950b1f790616cd5594b7a22f565842f99c7d9964b91509c0464d
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def isIndentedIdItem (item : ((Option (Option Float)) × (Array Float))) : Bool :=
  (((!(match ((item).1, none) with | (some (some ml_left), some ml_right) => false | (none, none) => false | (some none, none) => true | _ => false)) && (!(match ((item).1, none) with | (some (some ml_left), some ml_right) => false | (none, none) => true | (some none, none) => false | _ => false))) && ((!(let ml_ignored := (item).2; true)) || ((Float.ofNat (item).2.size) == (0 : Float))))

def main : IO Unit := do
  pure ()
