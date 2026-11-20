/** Native source generation from checked control-flow meanings, never source text.
 * Target runtime dependencies and proof obligations remain explicit. */
import { emitProofControlFlow } from './rml-control-flow-proof-codegen.mjs';
import { validateControlFlow, ControlFlowError } from './rml-control-flow.mjs';

export function compileControlFlowTable(program) {
  validateControlFlow(program);
  const names = new Map(program.functions.map((f, i) => [`${f.module}.${f.name}`, i]));
  const functions = program.functions.map(fn => {
    const registers = new Map([...fn.parameters, ...fn.locals].map(([id], i) => [id, i]));
    const blocks = new Map(); let pc = 0;
    for (const block of fn.blocks) { blocks.set(block.id, pc); pc += block.instructions.length + 1; }
    const code = [];
    for (const block of fn.blocks) {
      for (const instruction of block.instructions) {
        const [op, dest, ...args] = instruction;
        code.push(op === 'const' ? [op, registers.get(dest), args[0]] : op === 'call' ? [op, registers.get(dest), names.get(args[0]), ...args.slice(1).map(id => registers.get(id))] : [op, registers.get(dest), ...args.map(id => registers.get(id))]);
      }
      const [op, arg, yes, no] = block.terminator;
      code.push(op === 'jump' ? [op, blocks.get(arg)] : op === 'return' ? [op, registers.get(arg)] : [op, registers.get(arg), blocks.get(yes), blocks.get(no)]);
    }
    return { parameters: fn.parameters.map(([, type]) => type), registers: registers.size, entry: blocks.get(fn.entry), code };
  });
  return { functions, entry: names.get(program.entry) };
}

/** This runtime is emitted as ordinary target source and depends on no RML API. */
export function runControlFlowTable(table, args, fuel) {
  if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > 1000000) throw new TypeError('Invalid fuel');
  const type = value => value === null ? 'unit' : typeof value === 'boolean' ? 'bool' : Number.isSafeInteger(value) && !Object.is(value, -0) ? 'int' : '';
  const entry = table.functions[table.entry];
  if (!Array.isArray(args) || args.length !== entry.parameters.length || !args.every((v, i) => type(v) === entry.parameters[i])) throw new TypeError('Invalid entry arguments');
  const frame = (id, args, dest) => ({ id, pc: table.functions[id].entry, registers: [...args, ...Array(table.functions[id].registers - args.length).fill(null)], dest });
  const stack = [frame(table.entry, args, 0)], effects = []; let steps = 0;
  const outcome = (status, value = null, diagnostic = null) => ({ status, value, effects, steps, diagnostic });
  while (true) {
    if (steps === fuel) return outcome('fuel-exhausted'); steps++;
    const current = stack.at(-1), registers = current.registers, [op, dest, a, b, ...rest] = table.functions[current.id].code[current.pc++];
    if (op === 'return') { const value = registers[dest]; stack.pop(); if (!stack.length) return outcome('returned', value); stack.at(-1).registers[current.dest] = value; continue; }
    if (op === 'jump') { current.pc = dest; continue; }
    if (op === 'branch') { current.pc = registers[dest] ? a : b; continue; }
    if (op === 'emit') { effects.push(registers[dest]); continue; }
    if (op === 'const') { registers[dest] = a; continue; }
    if (op === 'call') { const args = [b, ...rest].filter(index => index !== undefined).map(index => registers[index]); stack.push(frame(a, args, dest)); continue; }
    const left = registers[a], right = registers[b];
    if (op === 'copy') registers[dest] = left;
    else if (op === 'eq') registers[dest] = left === right;
    else if (op === 'lt') registers[dest] = left < right;
    else if (op === 'le') registers[dest] = left <= right;
    else if (op === 'not') registers[dest] = !left;
    else if (op === 'and') registers[dest] = left && right;
    else if (op === 'or') registers[dest] = left || right;
    else {
      const x = BigInt(left), y = BigInt(right);
      if ((op === 'div' || op === 'mod') && y === 0n) return outcome('domain-error', null, 'DIVISION_BY_ZERO');
      const value = op === 'add' ? x + y : op === 'sub' ? x - y : op === 'mul' ? x * y : op === 'div' ? x / y : x % y;
      if (value < -9007199254740991n || value > 9007199254740991n) return outcome('domain-error', null, 'INTEGER_OVERFLOW');
      registers[dest] = Number(value);
    }
  }
}

const rustScalar = value => value === null ? 'Scalar::Unit' : typeof value === 'boolean' ? `Scalar::Bool(${value})` : `Scalar::Int(${value})`;
const rustList = values => `vec![${values.join(',')}]`;
export function emitControlFlow(program, language) {
  const table = compileControlFlowTable(program);
  if (language === 'JavaScript') return `// Checked scalar control-flow runtime. No original source is retained.\nconst table = ${JSON.stringify(table)};\n${runControlFlowTable.toString()}\nexport function run(args, fuel = 100000) { return runControlFlowTable(table, args, fuel); }\n`;
  if (language === 'Lean' || language === 'Rocq') return emitProofControlFlow(table, language);
  if (language === 'Rust') {
    const instruction = i => {
      const [op, dest, a, b, ...rest] = i;
      if (op === 'const') return `Instruction::Const(${dest},${rustScalar(a)})`;
      if (op === 'call') return `Instruction::Call(${dest},${a},${rustList([b, ...rest].filter(v => v !== undefined))})`;
      if (['return', 'jump', 'emit'].includes(op)) return `Instruction::${{return:'Return',jump:'Jump',emit:'Emit'}[op]}(${dest})`;
      if (op === 'branch') return `Instruction::Branch(${dest},${a},${b})`;
      if (op === 'copy' || op === 'not') return `Instruction::${op === 'copy' ? 'Copy' : 'Not'}(${dest},${a})`;
      return `Instruction::Binary("${op}",${dest},${a},${b})`;
    };
    const functions = rustList(table.functions.map(f => `Function{parameters:${rustList(f.parameters.map(t => JSON.stringify(t)))},registers:${f.registers},entry:${f.entry},code:${rustList(f.code.map(instruction))}}`));
    return RUST_RUNTIME.replace('__FUNCTIONS__', functions).replace('__ENTRY__', String(table.entry));
  }
  throw new ControlFlowError('TARGET_OBLIGATION', `Control-flow target ${language} still needs a checked runtime encoding`, language);
}

const RUST_RUNTIME = `// Generated checked scalar control-flow runtime; no RML crate dependency.
#[derive(Clone, Debug, PartialEq)]
pub enum Scalar { Int(i64), Bool(bool), Unit }
impl Scalar {
  fn integer(&self) -> i128 { if let Self::Int(n)=self { i128::from(*n) } else { unreachable!() } }
  fn boolean(&self) -> bool { if let Self::Bool(b)=self { *b } else { unreachable!() } }
  fn kind(&self) -> &'static str { match self { Self::Int(_)=>"int",Self::Bool(_)=>"bool",Self::Unit=>"unit" } }
  pub fn json(&self) -> String { match self { Self::Int(n)=>n.to_string(),Self::Bool(b)=>b.to_string(),Self::Unit=>"null".to_owned() } }
}
#[derive(Clone)]
enum Instruction { Const(usize,Scalar), Copy(usize,usize), Binary(&'static str,usize,usize,usize), Not(usize,usize), Call(usize,usize,Vec<usize>), Emit(usize), Jump(usize), Branch(usize,usize,usize), Return(usize) }
struct Function { parameters:Vec<&'static str>,registers:usize,entry:usize,code:Vec<Instruction> }
struct Frame { id:usize,pc:usize,registers:Vec<Scalar>,dest:usize }
#[derive(Debug,PartialEq)]
pub struct Outcome { pub status:&'static str,pub value:Scalar,pub effects:Vec<Scalar>,pub steps:u64,pub diagnostic:Option<&'static str> }
impl Outcome { pub fn json(&self)->String { format!("{{\\\"status\\\":\\\"{}\\\",\\\"value\\\":{},\\\"effects\\\":[{}],\\\"steps\\\":{},\\\"diagnostic\\\":{}}}",self.status,self.value.json(),self.effects.iter().map(Scalar::json).collect::<Vec<_>>().join(","),self.steps,self.diagnostic.map(|s|format!("\\\"{s}\\\"")).unwrap_or_else(||"null".to_owned())) } }
pub fn run(args:Vec<Scalar>,fuel:u64)->Result<Outcome,String> {
  if fuel>1000000 {return Err("Invalid fuel".to_owned())}
  let functions=__FUNCTIONS__; let entry=__ENTRY__;
  if args.len()!=functions[entry].parameters.len() || !args.iter().zip(&functions[entry].parameters).all(|(v,t)|v.kind()==*t && (v.kind()!="int" || v.integer().abs()<=9007199254740991)) {return Err("Invalid entry arguments".to_owned())}
  let frame=|id:usize,mut args:Vec<Scalar>,dest:usize| {args.resize(functions[id].registers,Scalar::Unit);Frame{id,pc:functions[id].entry,registers:args,dest}};
  let mut stack=vec![frame(entry,args,0)]; let mut effects=Vec::new(); let mut steps=0;
  macro_rules! done {($status:expr,$value:expr,$diagnostic:expr)=>{return Ok(Outcome{status:$status,value:$value,effects,steps,diagnostic:$diagnostic})};}
  loop {
    if steps==fuel {done!("fuel-exhausted",Scalar::Unit,None)} steps+=1;
    let current=stack.last_mut().unwrap(); let instruction=functions[current.id].code[current.pc].clone(); current.pc+=1;
    match instruction {
      Instruction::Const(d,v)=>current.registers[d]=v,
      Instruction::Copy(d,a)=>current.registers[d]=current.registers[a].clone(),
      Instruction::Not(d,a)=>current.registers[d]=Scalar::Bool(!current.registers[a].boolean()),
      Instruction::Emit(a)=>effects.push(current.registers[a].clone()),
      Instruction::Jump(pc)=>current.pc=pc,
      Instruction::Branch(c,yes,no)=>current.pc=if current.registers[c].boolean(){yes}else{no},
      Instruction::Call(d,f,args)=>{let values=args.iter().map(|i|current.registers[*i].clone()).collect();stack.push(frame(f,values,d));},
      Instruction::Return(r)=>{let value=current.registers[r].clone();let dest=current.dest;stack.pop();if let Some(parent)=stack.last_mut(){parent.registers[dest]=value}else{done!("returned",value,None)}},
      Instruction::Binary(op,d,a,b)=>{
        let x=&current.registers[a];let y=&current.registers[b];
        let value=match op {
          "eq"=>Scalar::Bool(x==y),"lt"=>Scalar::Bool(x.integer()<y.integer()),"le"=>Scalar::Bool(x.integer()<=y.integer()),
          "and"=>Scalar::Bool(x.boolean()&&y.boolean()),"or"=>Scalar::Bool(x.boolean()||y.boolean()),
          _=>{let x=x.integer();let y=y.integer();if (op=="div"||op=="mod")&&y==0{done!("domain-error",Scalar::Unit,Some("DIVISION_BY_ZERO"))}
            let v=match op{"add"=>x+y,"sub"=>x-y,"mul"=>x*y,"div"=>x/y,"mod"=>x%y,_=>unreachable!()};
            if v.abs()>9007199254740991{done!("domain-error",Scalar::Unit,Some("INTEGER_OVERFLOW"))}Scalar::Int(v as i64)}
        }; current.registers[d]=value;
      }
    }
  }
}
`;
