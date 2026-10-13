import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {test}from'node:test';
import {parseJavaScriptAst}from'../../scripts/generate-linked-runtime.mjs';
import {lowerJavaScriptControlFlow}from'../src/rml-control-flow-javascript.mjs';
import {lowerRustControlFlow}from'../src/rml-control-flow-rust.mjs';
import {executeControlFlow}from'../src/rml-control-flow.mjs';
const corpus=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/cases.json',import.meta.url)));
for(const fixture of corpus.cases)test(`elaborate owned JavaScript AST: ${fixture.name}`,()=>{
 const source={modules:Object.entries(fixture.sources).map(([id,source])=>({id,ast:parseJavaScriptAst(source),dependencies:fixture.dependencies?.[id]})),signatures:fixture.signatures,entry:fixture.entry};
 const result=lowerJavaScriptControlFlow(source);assert.deepEqual(result.program,fixture.program);assert.ok(result.obligations.length>0);assert.deepEqual(executeControlFlow(result.program,fixture.arguments,{fuel:fixture.fuel}),fixture.expected);
});
const negative=[
 ['temporal-dead-zone','function f(n) { { let n = n + 1; } return n; }','UNINITIALIZED'],
 ['outer-binding-is-shadowed-for-whole-block','function f(n) { { console.log(n); let n = 4; } return n; }','UNINITIALIZED'],
 ['constant-assignment','function f(n) { const x = n; x = 2; return x; }','BINDING'],
 ['null-is-not-undefined','function f(n) { return null; }','TYPE_OBLIGATION'],
 ['fractional-division','function f(n) { return n / 2; }','UNSUPPORTED'],
 ['dynamic-coercion','function f(n) { return n + "1"; }','UNSUPPORTED'],
 ['heap-reference','function f(n) { let o = { n }; return o.n; }','UNSUPPORTED'],
 ['closure','function f(n) { const g = () => n; return g(); }','UNSUPPORTED'],
 ['async','async function f(n) { return n; }','UNSUPPORTED'],
 ['exception','function f(n) { throw n; }','UNSUPPORTED'],
 ['shadowed-console','function f(console) { console.log(3); return 1; }','BINDING'],
 ['undeclared-effect','function f(n) { console.log(n); return n; }','EFFECT'],
 ['unknown-call','function f(n) { return missing(n); }','BINDING'],
 ['unsafe-literal','function f(n) { return 9007199254740992; }','NUMERIC_OBLIGATION'],
 ['fallthrough','function f(n) { if (n < 0) { return n; } }','TYPE'],
];
for(const[name,source,code]of negative)test(`JavaScript semantic obligation: ${name}`,()=>{
 const ast=parseJavaScriptAst(source),snapshot=JSON.stringify(ast);
 assert.throws(()=>lowerJavaScriptControlFlow({modules:[{id:'main',ast}],entry:'main.f',signatures:{'main.f':{parameters:['int'],result:'int',effects:[]}}}),e=>e.code===code);
 assert.equal(JSON.stringify(ast),snapshot,'unsupported source syntax must stay intact');
});
const rust=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/rust-syntax.json',import.meta.url)));
for(const fixture of rust.cases)test(`elaborate owned Rust AST: ${fixture.name}`,()=>{
 const snapshot=JSON.stringify(fixture.project);
 if(fixture.code)assert.throws(()=>lowerRustControlFlow(fixture.project),e=>e.code===fixture.code);
 else{const result=lowerRustControlFlow(fixture.project);assert.deepEqual(result.program,fixture.program);assert.deepEqual(executeControlFlow(result.program,fixture.arguments,{fuel:10000}),fixture.expected);}
 assert.equal(JSON.stringify(fixture.project),snapshot);
});
test('official source ingress distinguishes preservation from checked scalar semantics',async()=>{
 const{elaborateControlFlowSource}=await import('../../scripts/control-flow/elaborate-source.mjs');
 const result=elaborateControlFlowSource({language:'JavaScript',modules:[{id:'main',source:'export function increment(n) { return n + 1; }'}],signatures:{'main.increment':{parameters:['int'],result:'int',effects:[]}},entry:'main.increment'});
 assert.equal(result.representations[0].program.emit(),'export function increment(n) { return n + 1; }');
 assert.equal(result.stages.verification,'not-proved');assert.equal(executeControlFlow(result.program,[4]).value,5);
});
test('owned syntax rejects cycles and excessive depth before recursive lowering',()=>{
 const ast={type:'Program',body:[]};ast.body.push(ast);
 assert.throws(()=>lowerJavaScriptControlFlow({modules:[{id:'main',ast}],signatures:{},entry:'main.f'}),e=>e.code==='AST_SCHEMA');
 let deep={};for(let i=0;i<300;i++)deep={nested:deep};
 assert.throws(()=>lowerRustControlFlow({modules:[{id:'main',ast:deep}],entry:'main.f'}),e=>e.code==='AST_LIMIT');
});
test('the AST-reconstructed generator emits a correct standalone JavaScript machine',async()=>{
 const{generateJavaScript}=await import('../../scripts/linked-runtime-codegen.mjs');
 const location=new URL('../src/rml-control-flow-codegen.mjs',import.meta.url);
 const ast=parseJavaScriptAst(readFileSync(location,'utf8'));
 // A data-URL module has no relative-import base. Preserve dependency identity
 // while testing the generator implementation reconstructed from owned syntax.
 for(const item of ast.program.body)if(item.type==='ImportDeclaration')item.source.value=new URL(item.source.value,location).href;
 const reconstructed=await import('data:text/javascript;base64,'+Buffer.from(generateJavaScript(ast)).toString('base64'));
 for(const fixture of corpus.cases){const target=await import('data:text/javascript;base64,'+Buffer.from(reconstructed.emitControlFlow(fixture.program,'JavaScript')).toString('base64'));assert.deepEqual(target.run(fixture.arguments,fixture.fuel),fixture.expected);}
});

test('Syn 3 safety and modifier fields cannot silently bypass scalar obligations', () => {
 const ordinary = rust.cases.find(fixture => fixture.name === 'rust-same-scope-shadowing').project;
 for (const edit of [
  ast => { ast.items[0].fn.safety = 'unsafe'; },
  ast => { ast.items[0].fn.safety = 'safe'; },
  ast => { ast.items[0].fn.modifiers = { default: true }; },
  ast => { ast.items[0].fn.modifiers = { future_modifier: true }; },
  ast => { ast.items[0].fn.stmts[0].let.modifiers = { future_modifier: true }; },
  ast => { ast.frontmatter = {}; },
 ]) {
  const project = structuredClone(ordinary); edit(project.modules[0].ast);
  const snapshot = JSON.stringify(project);
  assert.throws(() => lowerRustControlFlow(project), error => error.code === 'UNSUPPORTED');
  assert.equal(JSON.stringify(project), snapshot, 'unsupported Syn 3 syntax remains intact');
 }
});
