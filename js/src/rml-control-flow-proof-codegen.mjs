/** Explicit executable encodings into proof languages. They expose bounded
 * observations; no termination claim or source theorem is manufactured. */
const leanScalar=v=>v===null?'.unit':typeof v==='boolean'?`(.bool ${v})`:`(.int (${v}))`;
const rocqScalar=v=>v===null?'VUnit':typeof v==='boolean'?`(VBool ${v})`:`(VInt (${v})%Z)`;
const list=(values,language)=>`[${values.join(language==='Lean'?', ':'; ')}]`;
export function emitProofControlFlow(table,language){
 const lean=language==='Lean',scalar=lean?leanScalar:rocqScalar;
 const instruction=i=>{
  const[op,d,a,b,...rest]=i;
  if(op==='const')return lean?`(.constant ${d} ${scalar(a)})`:`(IConst ${d} ${scalar(a)})`;
  if(op==='call')return `(${lean?'.call':'ICall'} ${d} ${a} ${list([b,...rest].filter(x=>x!==undefined),language)})`;
  if(['return','jump','emit'].includes(op))return`(${lean?{return:'.ret',jump:'.jump',emit:'.emit'}[op]:{return:'IReturn',jump:'IJump',emit:'IEmit'}[op]} ${d})`;
  if(op==='branch')return`(${lean?'.branch':'IBranch'} ${d} ${a} ${b})`;
  if(op==='copy'||op==='not')return`(${lean?(op==='copy'?'.copy':'.negate'):(op==='copy'?'ICopy':'INot')} ${d} ${a})`;
  return`(${lean?'.binary':'IBinary'} ${lean?'.'+op:'B'+op[0].toUpperCase()+op.slice(1)} ${d} ${a} ${b})`;
 };
 const functions=list(table.functions.map(f=>lean?`⟨${list(f.parameters.map(t=>'.'+t),language)}, ${f.registers}, ${f.entry}, ${list(f.code.map(instruction),language)}⟩`:`(mkFunction ${list(f.parameters.map(t=>({int:'TInt',bool:'TBool',unit:'TUnit'})[t]),language)} ${f.registers} ${f.entry} ${list(f.code.map(instruction),language)})`),language);
 return(lean?LEAN_RUNTIME:ROCQ_RUNTIME).replace('__FUNCTIONS__',functions).replace('__ENTRY__',String(table.entry));
}
const LEAN_RUNTIME=`import Std
namespace RmlControlFlow
inductive Scalar where
 | int : Int → Scalar
 | bool : Bool → Scalar
 | unit : Scalar
 deriving Repr, BEq, DecidableEq
inductive Ty where | int | bool | unit
 deriving BEq, DecidableEq
inductive Bin where | add | sub | mul | div | mod | lt | le | eq | and | or
inductive Instruction where
 | constant : Nat → Scalar → Instruction
 | copy : Nat → Nat → Instruction
 | binary : Bin → Nat → Nat → Nat → Instruction
 | negate : Nat → Nat → Instruction
 | call : Nat → Nat → List Nat → Instruction
 | emit : Nat → Instruction
 | jump : Nat → Instruction
 | branch : Nat → Nat → Nat → Instruction
 | ret : Nat → Instruction
structure Function where
 parameters : List Ty
 registers : Nat
 entry : Nat
 code : List Instruction
structure Frame where
 functionId : Nat
 pc : Nat
 registers : List Scalar
 destination : Nat
structure Outcome where
 status : String
 value : Scalar
 effects : List Scalar
 steps : Nat
 diagnostic : Option String
 deriving Repr, DecidableEq
structure State where
 stack : List Frame
 effects : List Scalar
 steps : Nat
private def functions : List Function := __FUNCTIONS__
private def entry : Nat := __ENTRY__
private def function (n : Nat) : Function := functions.getD n ⟨[],0,0,[]⟩
private def get (f : Frame) (n : Nat) : Scalar := f.registers.getD n .unit
private def set (f : Frame) (n : Nat) (v : Scalar) : Frame := {f with registers := f.registers.set n v}
private def frame (n : Nat) (args : List Scalar) (dest : Nat) : Frame :=
 let f := function n
 ⟨n, f.entry, args ++ List.replicate (f.registers - args.length) .unit, dest⟩
private def integer : Scalar → Int | .int n => n | _ => 0
private def boolean : Scalar → Bool | .bool b => b | _ => false
private def kind : Scalar → Ty | .int _ => .int | .bool _ => .bool | .unit => .unit
private def checked (n : Int) : Except String Scalar :=
 if n < -9007199254740991 ∨ 9007199254740991 < n then .error "INTEGER_OVERFLOW" else .ok (.int n)
private def operate (op : Bin) (x y : Scalar) : Except String Scalar :=
 match op with
 | .eq => .ok (.bool (x == y))
 | .lt => .ok (.bool (integer x < integer y))
 | .le => .ok (.bool (integer x ≤ integer y))
 | .and => .ok (.bool (boolean x && boolean y))
 | .or => .ok (.bool (boolean x || boolean y))
 | .add => checked (integer x + integer y)
 | .sub => checked (integer x - integer y)
 | .mul => checked (integer x * integer y)
 | .div => if integer y == 0 then .error "DIVISION_BY_ZERO" else checked (Int.tdiv (integer x) (integer y))
 | .mod => if integer y == 0 then .error "DIVISION_BY_ZERO" else checked (Int.tmod (integer x) (integer y))
private def step (s : State) : Sum Outcome State :=
 let steps := s.steps + 1
 match s.stack with
 | [] => .inl ⟨"invalid-machine", .unit, s.effects, steps, none⟩
 | f :: rest =>
   let instruction := (function f.functionId).code.getD f.pc (.ret 0)
   let next := {f with pc := f.pc + 1}
   let continueWith := fun frame => Sum.inr ({s with stack := frame :: rest, steps := steps} : State)
   match instruction with
   | .constant d v => continueWith (set next d v)
   | .copy d a => continueWith (set next d (get f a))
   | .negate d a => continueWith (set next d (.bool (!boolean (get f a))))
   | .binary op d a b => match operate op (get f a) (get f b) with
       | .ok value => continueWith (set next d value)
       | .error diagnostic => .inl ⟨"domain-error", .unit, s.effects, steps, some diagnostic⟩
   | .emit a => .inr {s with stack := next :: rest, effects := s.effects ++ [get f a], steps := steps}
   | .jump pc => continueWith {next with pc := pc}
   | .branch c yes no => continueWith {next with pc := if boolean (get f c) then yes else no}
   | .call d target args => .inr {s with stack := frame target (args.map (get f)) d :: next :: rest, steps := steps}
   | .ret a => match rest with
       | [] => .inl ⟨"returned", get f a, s.effects, steps, none⟩
       | parent :: tail => .inr {s with stack := set parent f.destination (get f a) :: tail, steps := steps}
private def runSteps : Nat → State → Outcome
 | 0, s => ⟨"fuel-exhausted", .unit, s.effects, s.steps, none⟩
 | fuel + 1, s => match step s with | .inl outcome => outcome | .inr next => runSteps fuel next
def run (fuel : Nat) (args : List Scalar) : Outcome :=
 let expected := (function entry).parameters
 let valid := args.length == expected.length && (args.zip expected).all (fun (v,t) => kind v == t && (integer v).natAbs ≤ 9007199254740991)
 if fuel > 1000000 ∨ !valid then ⟨"invalid-arguments", .unit, [], 0, none⟩
 else runSteps fuel ⟨[frame entry args 0], [], 0⟩
end RmlControlFlow
`;
const ROCQ_RUNTIME=`From Stdlib Require Import List Bool ZArith String.
Import ListNotations.
Open Scope string_scope.
Inductive Scalar := VInt (n:Z) | VBool (b:bool) | VUnit.
Inductive Ty := TInt | TBool | TUnit.
Inductive Bin := BAdd | BSub | BMul | BDiv | BMod | BLt | BLe | BEq | BAnd | BOr.
Inductive Instruction :=
 | IConst (d:nat) (v:Scalar) | ICopy (d a:nat)
 | IBinary (op:Bin) (d a b:nat) | INot (d a:nat)
 | ICall (d target:nat) (args:list nat) | IEmit (a:nat)
 | IJump (pc:nat) | IBranch (c yes no:nat) | IReturn (a:nat).
Record Function := mkFunction { parameters:list Ty; registers:nat; entryPc:nat; code:list Instruction }.
Record Frame := mkFrame { functionId:nat; pc:nat; values:list Scalar; destination:nat }.
Record Outcome := mkOutcome { status:string; value:Scalar; effects:list Scalar; steps:nat; diagnostic:option string }.
Record State := mkState { stack:list Frame; events:list Scalar; stepCount:nat }.
Definition functions : list Function := __FUNCTIONS__.
Definition entry : nat := __ENTRY__.
Definition function (n:nat) := nth n functions (mkFunction [] 0 0 []).
Definition get (f:Frame) (n:nat) := nth n (values f) VUnit.
Fixpoint replace (n:nat) (v:Scalar) (xs:list Scalar) : list Scalar :=
 match n,xs with | O,_::tail => v::tail | S k,x::tail => x::replace k v tail | _,[] => [] end.
Definition put (f:Frame) (n:nat) (v:Scalar) := mkFrame (functionId f) (pc f) (replace n v (values f)) (destination f).
Definition atPc (f:Frame) (n:nat) := mkFrame (functionId f) n (values f) (destination f).
Definition frame (n:nat) (args:list Scalar) (dest:nat) :=
 let f:=function n in mkFrame n (entryPc f) (List.app args (repeat VUnit (registers f - List.length args))) dest.
Definition integer (v:Scalar) : Z := match v with VInt n=>n | _=>0%Z end.
Definition boolean (v:Scalar) := match v with VBool b=>b | _=>false end.
Definition scalarEq (x y:Scalar) := match x,y with VInt a,VInt b=>Z.eqb a b | VBool a,VBool b=>Bool.eqb a b | VUnit,VUnit=>true | _,_=>false end.
Definition kind (v:Scalar) := match v with VInt _=>TInt | VBool _=>TBool | VUnit=>TUnit end.
Definition typeEq (x y:Ty) := match x,y with TInt,TInt | TBool,TBool | TUnit,TUnit=>true | _,_=>false end.
Definition checked (n:Z) : string + Scalar := if Z.ltb n (-9007199254740991) || Z.ltb 9007199254740991 n then inl "INTEGER_OVERFLOW" else inr (VInt n).
Definition operate (op:Bin) (x y:Scalar) : string + Scalar :=
 match op with
 | BEq=>inr (VBool (scalarEq x y)) | BLt=>inr (VBool (Z.ltb (integer x) (integer y))) | BLe=>inr (VBool (Z.leb (integer x) (integer y)))
 | BAnd=>inr (VBool (boolean x && boolean y)) | BOr=>inr (VBool (boolean x || boolean y))
 | BAdd=>checked (integer x + integer y) | BSub=>checked (integer x - integer y) | BMul=>checked (integer x * integer y)
 | BDiv=>if Z.eqb (integer y) 0 then inl "DIVISION_BY_ZERO" else checked (Z.quot (integer x) (integer y))
 | BMod=>if Z.eqb (integer y) 0 then inl "DIVISION_BY_ZERO" else checked (Z.rem (integer x) (integer y))
 end.
Definition step (s:State) : Outcome + State :=
 let count:=S (stepCount s) in
 match stack s with
 | []=>inl (mkOutcome "invalid-machine" VUnit (events s) count None)
 | f::rest=>
  let instruction:=nth (pc f) (code (function (functionId f))) (IReturn 0) in
  let next:=atPc f (S (pc f)) in
  let continueWith:=fun f=>inr (mkState (f::rest) (events s) count) in
  match instruction with
  | IConst d v=>continueWith (put next d v) | ICopy d a=>continueWith (put next d (get f a))
  | INot d a=>continueWith (put next d (VBool (negb (boolean (get f a)))))
  | IBinary op d a b=>match operate op (get f a) (get f b) with inr v=>continueWith (put next d v) | inl diagnostic=>inl (mkOutcome "domain-error" VUnit (events s) count (Some diagnostic)) end
  | IEmit a=>inr (mkState (next::rest) (List.app (events s) [get f a]) count)
  | IJump target=>continueWith (atPc next target)
  | IBranch c yes no=>continueWith (atPc next (if boolean (get f c) then yes else no))
  | ICall d target args=>inr (mkState (frame target (map (get f) args) d::next::rest) (events s) count)
  | IReturn a=>match rest with []=>inl (mkOutcome "returned" (get f a) (events s) count None) | parent::tail=>inr (mkState (put parent (destination f) (get f a)::tail) (events s) count) end
  end
 end.
Fixpoint runSteps (fuel:nat) (s:State) : Outcome :=
 match fuel with O=>mkOutcome "fuel-exhausted" VUnit (events s) (stepCount s) None
 | S rest=>match step s with inl outcome=>outcome | inr next=>runSteps rest next end end.
Definition run (fuel:nat) (args:list Scalar) : Outcome :=
 let expected:=parameters (function entry) in
 let valid:=Nat.eqb (List.length args) (List.length expected) && forallb (fun pair=>let '(v,t):=pair in typeEq (kind v) t && Z.leb (Z.abs (integer v)) 9007199254740991) (combine args expected) in
 if (1000000 <? fuel)%nat || negb valid then mkOutcome "invalid-arguments" VUnit [] 0 None
 else runSteps fuel (mkState [frame entry args 0] [] 0).
`;
