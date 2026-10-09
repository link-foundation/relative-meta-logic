import assert from 'node:assert/strict';
import {createHash}from'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {lowerJavaScriptControlFlow}from'../../js/src/rml-control-flow-javascript.mjs';
import {lowerRustControlFlow}from'../../js/src/rml-control-flow-rust.mjs';
import {parseJavaScriptAst}from'../generate-linked-runtime.mjs';
import { emitControlFlow } from '../../js/src/rml-control-flow-codegen.mjs';
import { controlFlowToNetwork, controlFlowFromNetwork } from '../../js/src/rml-control-flow.mjs';
const corpus=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/cases.json',import.meta.url)));
const rustCorpus=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/rust-syntax.json',import.meta.url)));
const operationCorpus=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/operations.json',import.meta.url)));
const root=resolve('.rml-cache/control-flow-native');mkdirSync(root,{recursive:true});
const execute=(command,args)=>{const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);return result.stdout;};
let observations=0;const targets={JavaScript:0,Rust:0,Lean:0,Rocq:0};
const fixtures=[...corpus.cases,...rustCorpus.cases.filter(f=>f.program).map(f=>({...f,fuel:10000,sourceLanguage:'Rust'})),...operationCorpus.cases.map(f=>({...f,sourceLanguage:'RML'}))];
for(const fixture of fixtures){
 const elaborated=fixture.sourceLanguage==='RML'?{program:fixture.program}:fixture.sourceLanguage==='Rust'?lowerRustControlFlow(fixture.project):lowerJavaScriptControlFlow({modules:Object.entries(fixture.sources).map(([id,source])=>({id,ast:parseJavaScriptAst(source),dependencies:fixture.dependencies?.[id]})),signatures:fixture.signatures,entry:fixture.entry});
 assert.deepEqual(elaborated.program,fixture.program,fixture.name+' source-to-CFG elaboration');
 const program=controlFlowFromNetwork(controlFlowToNetwork(fixture.program));
 const javascript=await import('data:text/javascript;base64,'+Buffer.from(emitControlFlow(program,'JavaScript')).toString('base64'));assert.deepEqual(javascript.run(fixture.arguments,fixture.fuel),fixture.expected);targets.JavaScript++;observations++;
 const rustSource=emitControlFlow(program,'Rust');
 const scalar=v=>v===null?'Scalar::Unit':typeof v==='boolean'?`Scalar::Bool(${v})`:`Scalar::Int(${v})`;
 const file=resolve(root,`${fixture.name}.rs`),binary=resolve(root,fixture.name);
 writeFileSync(file,rustSource+`\nfn main(){println!("{}",run(vec![${fixture.arguments.map(scalar).join(',')}],${fixture.fuel}).unwrap().json());}\n`);
 execute(process.env.RUSTC??'rustc',['--edition=2021','-Awarnings',file,'-o',binary]);
 assert.deepEqual(JSON.parse(execute(binary,[])),fixture.expected,fixture.name);observations++;targets.Rust++;
 for(const language of ['Lean','Rocq']){
  const scalar=v=>v===null?(language==='Lean'?'.unit':'VUnit'):typeof v==='boolean'?(language==='Lean'?`(.bool ${v})`:`(VBool ${v})`):(language==='Lean'?`(.int (${v}))`:`(VInt (${v})%Z)`);
  const list=values=>`[${values.map(scalar).join(language==='Lean'?',':';')}]`;
  const diagnostic=fixture.expected.diagnostic?(language==='Lean'?`some \"${fixture.expected.diagnostic}\"`:`Some \"${fixture.expected.diagnostic}\"`):(language==='Lean'?'none':'None');
  const expected=language==='Lean'?`⟨\"${fixture.expected.status}\",${scalar(fixture.expected.value)},${list(fixture.expected.effects)},${fixture.expected.steps},${diagnostic}⟩`:`(mkOutcome \"${fixture.expected.status}\" ${scalar(fixture.expected.value)} ${list(fixture.expected.effects)} ${fixture.expected.steps} (${diagnostic}))`;
  const assertion=language==='Lean'?`\nexample : RmlControlFlow.run ${fixture.fuel} ${list(fixture.arguments)} = ${expected} := by native_decide\n`:`\nExample observation : run ${fixture.fuel} ${list(fixture.arguments)} = ${expected}. Proof. vm_compute. reflexivity. Qed.\n`;
  const file=resolve(root,`case_${fixtures.indexOf(fixture)}.${language==='Lean'?'lean':'v'}`);
  writeFileSync(file,emitControlFlow(program,language)+assertion);
  execute(language==='Lean'?(process.env.LEAN??'lean'):(process.env.ROCQ??'rocq'),language==='Lean'?[file]:['compile',file]);targets[language]++;observations++;
 }
 if(fixture.sourceLanguage==='RML'){
  // These exercise the shared RML operation contract, not source-language ingress.
 }else if(fixture.sourceLanguage==='Rust'){
  const source=resolve(root,`original_${fixture.name}.rs`),binary=resolve(root,`original_${fixture.name}`);
  writeFileSync(source,fixture.source+`\nfn main(){let answer=${fixture.entry}(${fixture.arguments.join(',')});println!(\"RESULT:{}\",answer);}`);
  execute(process.env.RUSTC??'rustc',['--edition=2021','-Awarnings',source,'-o',binary]);
  const lines=execute(binary,[]).trim().split('\n');const value=JSON.parse(lines.pop().slice('RESULT:'.length));const effects=lines.map(s=>JSON.parse(s));
  assert.deepEqual({value,effects},{value:fixture.expected.value,effects:fixture.expected.effects},fixture.name+' original Rust');observations++;
 }else if(fixture.expected.status==='returned'){
  const directory=resolve(root,`source-${fixture.name}`);mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'package.json'),' {"type":"module"} ');
  for(const[module,source]of Object.entries(fixture.sources))writeFileSync(resolve(directory,`${module}.js`),source);
  const index=fixture.entry.lastIndexOf('.'),module=fixture.entry.slice(0,index),fn=fixture.entry.slice(index+1);
  const runner=resolve(directory,'observe.mjs');
  writeFileSync(runner,`const effects=[];console.log=value=>effects.push(value);const m=await import('./${module}.js');const value=m[${JSON.stringify(fn)}](...${JSON.stringify(fixture.arguments)});if(Object.is(value,-0)||effects.some(v=>Object.is(v,-0)))throw new Error('Original source is outside the no-negative-zero contract');process.stdout.write(JSON.stringify({value,effects}));`);
  const actual=JSON.parse(execute(process.execPath,[runner]));assert.deepEqual(actual,{value:fixture.expected.value,effects:fixture.expected.effects},`${fixture.name} original JavaScript`);observations++;
 }
}
let negativeProofControls=0;
for(const language of ['Lean','Rocq']){
 const extension=language==='Lean'?'lean':'v';
 const positive=readFileSync(resolve(root,`case_0.${extension}`),'utf8');
 const wrong=language==='Lean'?'\nexample : (RmlControlFlow.run 10000 [(.int 6)]).value = (.int 14) := by native_decide\n':'\nExample false_observation : value (run 10000 [(VInt 6%Z)]) = VInt 14%Z. Proof. vm_compute. reflexivity. Qed.\n';
 const file=resolve(root,`negative.${extension}`);writeFileSync(file,positive+wrong);
 const command=language==='Lean'?(process.env.LEAN??'lean'):(process.env.ROCQ??'rocq');
 const outcome=spawnSync(command,language==='Lean'?[file]:['compile',file],{encoding:'utf8',timeout:60000});
 assert.equal(outcome.error,undefined);assert.notEqual(outcome.status,0,`${language} accepted a deliberately false observation`);assert.match(outcome.stdout+outcome.stderr,language==='Lean'?/native_decide|evaluates to false/:/Unable to unify|not convertible/);negativeProofControls++;
}
const evidenceFiles=['js/src/rml-control-flow-ast.mjs','js/src/rml-control-flow.mjs','js/src/rml-control-flow-javascript.mjs','js/src/rml-control-flow-rust.mjs','js/src/rml-control-flow-codegen.mjs','js/src/rml-control-flow-proof-codegen.mjs','rust/control-flow/src/control_flow.rs','test-corpus/control-flow/cases.json','test-corpus/control-flow/rust-syntax.json','test-corpus/control-flow/operations.json'];
const sourceSha256=Object.fromEntries(evidenceFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const report={schema:'rml-control-flow-native-results/v1',node:process.version,lean:execute(process.env.LEAN??'lean',['--version']).trim(),rocq:execute(process.env.ROCQ??'rocq',['--version']).trim(),sourceSha256,rustc:execute(process.env.RUSTC??'rustc',['--version']).trim(),programs:fixtures.length,targets,observations,negativeProofControls,failed:0,scope:'checked scalar control-flow only; no full-language or proof-equivalence claim'};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
