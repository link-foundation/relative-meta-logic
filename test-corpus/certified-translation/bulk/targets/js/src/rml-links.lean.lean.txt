-- rml-certified-item js/src/rml-links.mjs#clamp01@4365 target-sha256=908a1a8aa9352f5decc8950457cc5fa55ea5851414e5813e73360d1201e140d8
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

def clamp01 (x : Float) : Float :=
  (ml_max (0 : Float) (ml_min (1 : Float) x))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#quantize@7735 target-sha256=82ede8024a79bf940fb74ed25493f8b71070187b1c02449dc4aafc3ed0857689
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

def quantize (x : Float) (valence : Float) (lo : Float) (hi : Float) : Float :=
  (if (decide (valence < (2 : Float))) then x else (let step := ((hi - lo) / (valence - (1 : Float)));
    (let level := (ml_round ((x - lo) / step));
      (lo + ((ml_max (0 : Float) (ml_min (valence - (1 : Float)) level)) * step)))))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_isStrictlyOffendingStatus@114116 target-sha256=c5ca9c2efd2e22cdadb6cf2fc2ae8695da9dc8f8b15d736f31a429f491d150f8
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _isStrictlyOffendingStatus (status : String) : Bool :=
  ((status == "host-primitive") || (status == "host-derived"))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#tokenBaseName@122238 target-sha256=667bfc9fb41c6a1e79e51b63575fb23473ae5e35aa9cc2f9bec6f38cfe565f8e
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def tokenBaseName (token : (Option Float)) : (Option Float) :=
  (if ((match token with | some ml_present => "number" | none => "object") != "string") then none else token)

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_isTacticNode@143276 target-sha256=0d2d8e6910a1f2e16bd0fc47c6ab612115f3401f03216182c58c5f7e1712b820
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _isTacticNode (value : (Array Float)) : Bool :=
  (((let ml_array_test1 := value;
    true) && (decide ((Float.ofNat value.size) > (0 : Float)))) && ((match (let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then value[ml_index.toUInt64.toNat]? else none) with | some ml_present => "number" | none => "undefined") == "string"))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_asEquality@143966 target-sha256=906914ca85f8c5d6f6581b31480bc69baaece15c8d1cfa29e8eaec53e94d9ea8
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _asEquality (node : (Array String)) : (Option ((Option String) × (Option String))) :=
  (if (((let ml_array_test1 := node;
    true) && ((Float.ofNat node.size) == (3 : Float))) && (match ((let ml_index := (1 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "=") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (some (let ml_field2 := (let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none);
    (let ml_field3 := (let ml_index := (2 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none);
      (ml_field2, ml_field3)))) else none)

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_smtLeaf@147393 target-sha256=48691e7991ba2c88a303f1a8e085b967587fe203944279dbf4920c5b04b0f08d
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _smtLeaf (node : Float) (value : Float) : Bool :=
  (("number" == "string") && (node == value))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_typeAscription@166700 target-sha256=b53037ed0fef1bd60fe9b26d503bf0ec76eb9c85f897318d1153f85b4dd5e9e9
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _typeAscription (node : (Array String)) : (Option ((Option String) × (Option String))) :=
  (if (((let ml_array_test1 := node;
    true) && ((Float.ofNat node.size) == (3 : Float))) && (match ((let ml_index := (1 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "of") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) then (some (let ml_field2 := (let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none);
    (let ml_field3 := (let ml_index := (2 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none);
      (ml_field2, ml_field3)))) else none)

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_isPiSig@218989 target-sha256=821397c77941b725fd04218ce486f03c3d1a8f6f8c6c115627d5e55fe4e48d62
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _isPiSig (node : (Array String)) : Bool :=
  (((let ml_array_test1 := node;
    true) && ((Float.ofNat node.size) == (3 : Float))) && (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "Pi") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#decideAutomaticSequenceTheorem@235140 target-sha256=7ef0a0ed6394c252cabbd0ecfb389e9cafce46372059ff196e448630a109768f
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def decideAutomaticSequenceTheorem (name : String) : (Option ((Array String) × String × String × Bool)) :=
  (if (name == "thue-morse-cube-free") then (some (let ml_field1 := name;
    (let ml_field2 := true;
      (let ml_field3 := "built-in Buchi emptiness certificate";
        (let ml_field4 := (#["buchi-emptiness", "thue-morse", "cube-free"] : (Array String));
          (ml_field4, ml_field3, ml_field1, ml_field2)))))) else none)

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#_isForallNode@268074 target-sha256=90c4f31896ea50938cebbe15269bf54bc71b0440e282fc0cc5335ac9baffb040
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def _isForallNode (node : (Array String)) : Bool :=
  ((((let ml_array_test1 := node;
    true) && ((Float.ofNat node.size) == (3 : Float))) && (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "forall") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) && ((match (let ml_index := (1 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none) with | some ml_present => "string" | none => "undefined") == "string"))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#isProbabilityAssignment@328782 target-sha256=54be432c115cf60cb97a1cf0acb1bee299b8f4e9eb13d6f5c47cb674cd677bbb
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def isProbabilityAssignment (node : (Array String)) : Bool :=
  ((((let ml_array_test1 := node;
    true) && ((Float.ofNat node.size) == (4 : Float))) && (match ((let ml_index := (1 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "has") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false)) && (match ((let ml_index := (2 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "probability") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false))

def main : IO Unit := do
  pure ()
-- rml-certified-item js/src/rml-links.mjs#isQueryForm@328939 target-sha256=99305b4fe63cee829fed8ee7be4dd75c3e5a5f058afa201a1fb97101690aabab
-- Translated from JavaScript by meta-language: portable core, Lean target.
-- Source binders are kept even where unused or named like a constructor, and proof hints are shared by every closing tactic.
set_option linter.unusedVariables false
set_option linter.unusedSimpArgs false
set_option linter.constructorNameAsVariable false

def isQueryForm (node : (Array String)) : Bool :=
  ((let ml_array_test1 := node;
    true) && (match ((let ml_index := (0 : Float); if ml_index ≥ 0 && ml_index.floor == ml_index && ml_index < 9007199254740992 then node[ml_index.toUInt64.toNat]? else none), "?") with | (some ml_left, ml_right) => (ml_left == ml_right) | _ => false))

def main : IO Unit := do
  pure ()
