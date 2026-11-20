-- rml-certified-item js/src/rml-meta-theory-native.mjs#compare@1497 target-sha256=22a894df07236fcbab8a556d909b776a19788dd8e4d7d0e103564eb983bd53a9
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def compare (left : Float) (right : Float) : Float :=
  (if (decide (left < right)) then (-1 : Float) else (if (decide (left > right)) then (1 : Float) else (0 : Float)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-meta-theory-native.mjs#value@17336 target-sha256=05688faf0db24e7087203ad46dfdd5709cfd83b1cfe5d39d9ef6954003645741
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def value (raw : String) : (Array String) :=
  (#["mt-v", raw] : (Array String))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-meta-theory-native.mjs#fixed@18133 target-sha256=6d6ebd541a8c1153e5b58138fa31a9365fb684fef6c73091f9b965d808f2a1ba
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def fixed (arity : Float) (build : Float) : (Float × Float) :=
  (let ml_field1 := arity;
    (let ml_field2 := build;
      (ml_field1, ml_field2)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-meta-theory-native.mjs#tag@18185 target-sha256=3104bd1d261b4e5ff68d4eff261721267e674cab4cbf7c9f93525cf441c0b012
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def value (raw : String) : (Array String) :=
  (#["mt-v", raw] : (Array String))

def fixed (arity : Float) (build : ((Array String) → (Array String))) : (Float × ((Array String) → (Array String))) :=
  (let ml_field1 := arity;
    (let ml_field2 := build;
      (ml_field1, ml_field2)))

def tag (name : String) (arity : Float) : (Float × ((Array String) → (Array String))) :=
  (fixed arity (fun (args : (Array String)) => (if (arity == (0 : Float)) then (value name) else ((#[name] : (Array String)) ++ args))))

def main : IO Unit := do
  pure ()
