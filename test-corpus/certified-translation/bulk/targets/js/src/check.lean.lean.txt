-- rml-certified-item js/src/check.mjs#prefixMarker@6432 target-sha256=70a242f0451bd3185e6d9d445bf0c1a3714e2fb3ab88d4b26acf4aaa9c29a3f6
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def prefixMarker (name : String) : String :=
  (let ml_switch1 := name;
    (if (ml_switch1 == "not") then "not" else (if (ml_switch1 == "and") then "and" else (if (ml_switch1 == "or") then "or" else (if (ml_switch1 == "+") then "sum" else (if (ml_switch1 == "-") then "difference" else (if (ml_switch1 == "*") then "product" else (if (ml_switch1 == "/") then "quotient" else "reduce"))))))))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/check.mjs#isOk@18029 target-sha256=14a1b17bef29c1cfb51dcf7fa250ecf250b8aebec2e216a25f98f5ef21c6f5a5
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def isOk (result : ((Array Float))) : Bool :=
  ((Float.ofNat result.size) == (0 : Float))

def main : IO Unit := do
  pure ()
