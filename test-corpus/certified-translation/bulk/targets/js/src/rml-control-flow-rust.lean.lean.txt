-- rml-certified-item js/src/rml-control-flow-rust.mjs#id@1000 target-sha256=12c09365199c89c3527f9e93c58a175957c810ae9a13e217bf0ea23ba0702f4c
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def id_2 (name : Float) : (Float × String) :=
  (let ml_field1 := "Identifier";
    (let ml_field2 := name;
      (ml_field2, ml_field1)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-control-flow-rust.mjs#literal@1043 target-sha256=2aefa0e2fd4ba169941a934b1294778e19b2394d49418e7c81aaabe768284462
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def literal (value : Float) : (String × Float) :=
  (let ml_field1 := (if ("number" == "boolean") then "BooleanLiteral" else "NumericLiteral");
    (let ml_field2 := value;
      (ml_field1, ml_field2)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-control-flow-rust.mjs#block@1139 target-sha256=6ee1694f4a64da7d84b9097af3c1a8242930fa6f715691ed2bb9badf0bc3e817
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def block (body : Float) : (Float × (Array Float) × String) :=
  (let ml_field1 := "BlockStatement";
    (let ml_field2 := body;
      (let ml_field3 := (#[] : (Array Float));
        (ml_field2, ml_field3, ml_field1))))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-control-flow-rust.mjs#expressionStatement@1203 target-sha256=571c6a1fe58a94eade326841fa354ec5a169d7a89dd3fc172ee9999a792d220a
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def expressionStatement (expression : Float) : (Float × String) :=
  (let ml_field1 := "ExpressionStatement";
    (let ml_field2 := expression;
      (ml_field2, ml_field1)))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-control-flow-rust.mjs#binary@1448 target-sha256=1d3885d46e69de893b05e98dd69205b7f245801f8a10320e97115da655df214b
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def binary (operator : Float) (left : Float) (right : Float) : (Float × Float × Float × String) :=
  (let ml_field1 := "BinaryExpression";
    (let ml_field2 := operator;
      (let ml_field3 := left;
        (let ml_field4 := right;
          (ml_field3, ml_field2, ml_field4, ml_field1)))))

def main : IO Unit := do
  pure ()
