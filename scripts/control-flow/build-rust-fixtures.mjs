import {writeFileSync} from 'node:fs';
import {rustAstTool}from'../generate-linked-rust-runtime.mjs';
import {lowerRustControlFlow}from'../../js/src/rml-control-flow-rust.mjs';
import {executeControlFlow}from'../../js/src/rml-control-flow.mjs';
if(!process.env.RML_RUST_AST_HELPER)throw new Error('Set RML_RUST_AST_HELPER to the shared compiled Syn helper');
const examples=[
 {name:'rust-loop-output',source:'pub fn sum(n: i64) -> i64 { let mut s = 0; for i in 0..n { if i == 2 { continue; } s += i; } println!("{}", s); s }',entry:'sum',arguments:[6],effects:['output']},
 {name:'rust-same-scope-shadowing',source:'pub fn choose(n: i64) -> i64 { let n = n + 1; let n = n * 2; n }',entry:'choose',arguments:[5]},
 {name:'rust-range-snapshot',source:'pub fn sum(mut n: i64) -> i64 { let mut s = 0; for i in 0..n { n = 0; s += i; } s }',entry:'sum',arguments:[5]},
 {name:'rust-mutual-recursion',source:'pub fn even(n: i64) -> bool { if n == 0 { return true; } odd(n - 1) } fn odd(n: i64) -> bool { if n == 0 { return false; } even(n - 1) }',entry:'even',arguments:[31]},
 {name:'rust-conditional',source:'pub fn sign(n: i64) -> i64 { let x = if n < 0 { -1 } else { 1 }; x }',entry:'sign',arguments:[-4]},
 {name:'rust-immutable-assignment',source:'pub fn wrong(n: i64) -> i64 { let x = n; x = 4; x }',entry:'wrong',arguments:[0],code:'BINDING'},
 {name:'rust-immutable-parameter',source:'pub fn wrong(n: i64) -> i64 { n = 4; n }',entry:'wrong',arguments:[0],code:'BINDING'},
 {name:'rust-immutable-loop-binding',source:'pub fn wrong(n: i64) -> i64 { for i in 0..n { i = 0; } n }',entry:'wrong',arguments:[0],code:'BINDING'},
 {name:'rust-borrow-obligation',source:'pub fn wrong(n: &i64) -> i64 { *n }',entry:'wrong',arguments:[],code:'OWNERSHIP_OBLIGATION'},
 {name:'rust-unsafe-obligation',source:'pub unsafe fn wrong(n: i64) -> i64 { n }',entry:'wrong',arguments:[0],code:'UNSUPPORTED'},
 {name:'rust-async-obligation',source:'pub async fn wrong(n: i64) -> i64 { n }',entry:'wrong',arguments:[0],code:'UNSUPPORTED'},
 {name:'rust-generic-obligation',source:'pub fn wrong<T>(n: i64) -> i64 { n }',entry:'wrong',arguments:[0],code:'UNSUPPORTED'},
 {name:'rust-const-obligation',source:'pub const fn wrong(n: i64) -> i64 { n }',entry:'wrong',arguments:[0],code:'UNSUPPORTED'},
 {name:'rust-abi-obligation',source:'pub extern "C" fn wrong(n: i64) -> i64 { n }',entry:'wrong',arguments:[0],code:'UNSUPPORTED'},
 {name:'rust-macro-obligation',source:'pub fn wrong(n: i64) -> i64 { assert!(n == 0); n }',entry:'wrong',arguments:[0],code:'EFFECT_OBLIGATION'},
 {name:'rust-undeclared-output',source:'pub fn wrong(n: i64) -> i64 { println!("{}", n); n }',entry:'wrong',arguments:[0],code:'EFFECT'},
];
const cases=examples.map(f=>{
 const ast=rustAstTool('parse',f.source,process.env.RML_RUST_AST_HELPER),project={modules:[{id:'main',ast}],entry:`main.${f.entry}`,effects:{[`main.${f.entry}`]:f.effects??[]}};
 if(f.code){let code;try{lowerRustControlFlow(project)}catch(e){code=e.code}if(code!==f.code)throw new Error(`${f.name}: expected ${f.code}, got ${code}`);return{...f,project};}
 const parsed=lowerRustControlFlow(project);return{...f,project,program:parsed.program,expected:executeControlFlow(parsed.program,f.arguments,{fuel:10000})};
});
writeFileSync(new URL('../../test-corpus/control-flow/rust-syntax.json',import.meta.url),JSON.stringify({schema:'rml-control-flow-rust-syntax/v1',ast:'Syn 3.0.6 / Syn-serde 0.3.2+rml.syn3 owned syntax',cases},null,2)+'\n');
