import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONTROL_FLOW_SCHEMA, validateControlFlow, executeControlFlow, controlFlowToNetwork, controlFlowFromNetwork, controlFlowToRml } from '../src/rml-control-flow.mjs';
import { compileControlFlowTable, runControlFlowTable, emitControlFlow } from '../src/rml-control-flow-codegen.mjs';
const corpus=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/cases.json',import.meta.url)));
for(const fixture of corpus.cases) test(`typed control flow, linked reload and generated JavaScript: ${fixture.name}`,async()=>{
 const program=controlFlowFromNetwork(controlFlowToNetwork(fixture.program));
 assert.deepEqual(program,fixture.program);assert.equal(controlFlowToRml(program),fixture.rml);
 assert.deepEqual(executeControlFlow(program,fixture.arguments,{fuel:fixture.fuel}),fixture.expected);
 assert.deepEqual(runControlFlowTable(compileControlFlowTable(program),fixture.arguments,fixture.fuel),fixture.expected);
 const target=await import(`data:text/javascript;base64,${Buffer.from(emitControlFlow(program,'JavaScript')).toString('base64')}`);
 assert.deepEqual(target.run(fixture.arguments,fixture.fuel),fixture.expected);
});
const base=()=>({schema:CONTROL_FLOW_SCHEMA,modules:[{id:'m',imports:[],exports:['f']}],entry:'m.f',functions:[{module:'m',name:'f',parameters:[['n','int']],result:'int',effects:[],locals:[['v','int']],entry:'entry',blocks:[{id:'entry',instructions:[['copy','v','n']],terminator:['return','v']}]}]});
const mutations=[
 ['duplicate-register','BINDING',p=>p.functions[0].locals.push(['n','int'])],
 ['unresolved-call','BINDING',p=>p.functions[0].blocks[0].instructions=[['call','v','m.missing','n']]],
 ['uninitialized','UNINITIALIZED',p=>p.functions[0].blocks[0].instructions=[]],
 ['type-confusion','TYPE',p=>p.functions[0].blocks[0].instructions=[['const','v',true]]],
 ['unresolved-branch','BINDING',p=>p.functions[0].blocks[0].terminator=['jump','missing']],
 ['undeclared-output','EFFECT',p=>p.functions[0].blocks[0].instructions.push(['emit','v'])],
 ['unknown-operation','UNSUPPORTED',p=>p.functions[0].blocks[0].instructions=[['delete','v','n']]],
 ['hidden-field','SCHEMA',p=>p.proof='trusted'],
 ['dangling-export','BINDING',p=>p.modules[0].exports=['missing']],
 ['unknown-type','TYPE',p=>p.functions[0].result='proof'],
 ['out-of-domain-constant','TYPE',p=>p.functions[0].blocks[0].instructions=[['const','v',9007199254740992]]],
 ['negative-zero','TYPE',p=>p.functions[0].blocks[0].instructions=[['const','v',-0]]],
];
for(const[name,code,mutate]of mutations)test(`control-flow rejection: ${name}`,()=>{const p=base();mutate(p);assert.throws(()=>validateControlFlow(p),e=>e.code===code);});
test('definite assignment intersects both branch paths, including loops',()=>{
 const p=base(),f=p.functions[0];f.parameters.push(['condition','bool']);
 f.blocks=[{id:'entry',instructions:[],terminator:['branch','condition','yes','no']},{id:'yes',instructions:[['copy','v','n']],terminator:['jump','merge']},{id:'no',instructions:[],terminator:['jump','merge']},{id:'merge',instructions:[],terminator:['return','v']}];
 assert.throws(()=>validateControlFlow(p),e=>e.code==='UNINITIALIZED');
 f.blocks[2].instructions=[['const','v',0]];validateControlFlow(p);
 f.blocks[2].instructions=[];f.blocks[2].terminator=['branch','condition','no','merge'];assert.throws(()=>validateControlFlow(p),e=>e.code==='UNINITIALIZED');
});
test('calls propagate effects through recursion and cannot reach private modules',()=>{
 const p=structuredClone(corpus.cases.find(c=>c.name==='module-alias-and-effects').program);
 p.functions.find(f=>f.module==='main').effects=[];assert.throws(()=>validateControlFlow(p),e=>e.code==='EFFECT');
 p.functions.find(f=>f.module==='main').effects=['output'];p.modules.find(m=>m.id==='math').exports=[];assert.throws(()=>validateControlFlow(p),e=>e.code==='BINDING');
});
test('numeric failures, fuel exhaustion and argument rejection remain distinct',()=>{
 const p=base();p.functions[0].locals.push(['z','int']);p.functions[0].blocks[0].instructions=[['const','z',0],['div','v','n','z']];
 assert.equal(executeControlFlow(p,[5]).diagnostic,'DIVISION_BY_ZERO');
 assert.equal(executeControlFlow(p,[5],{fuel:0}).status,'fuel-exhausted');
 assert.throws(()=>executeControlFlow(p,[true]),e=>e.code==='TYPE');
 p.functions[0].blocks[0].instructions=[['const','z',2],['div','v','n','z']];assert.equal(executeControlFlow(p,[-7]).value,-3);
 p.functions[0].blocks[0].instructions[1][0]='mod';assert.equal(executeControlFlow(p,[-7]).value,-1);
});
for(const fixture of corpus.negativeCases)test(`shared control-flow negative: ${fixture.name}`,()=>assert.throws(()=>validateControlFlow(fixture.program),error=>error.code===fixture.code));
test('linked instruction replacement changes execution and native target output',async()=>{
 const {LinkMetadata,LinkType,SubstitutionRule}=await import('#meta-language');
 const p=base();p.functions[0].blocks[0].instructions=[['const','v',17]];
 const network=controlFlowToNetwork(p);
 const old=network.links().find(link=>link.metadata().definition==='rml:structure:1:reference'&&link.metadata().term==='17');
 const parent=network.links().find(link=>link.references().some(id=>Number(id)===Number(old.id())));
 const replacement=network.insertLink([],LinkMetadata.new().withLinkType(LinkType.Syntax).withLanguage('RML').withDefinition('rml:structure:1:reference').withTerm('23'));
 network.applySubstitution(new SubstitutionRule(parent.references(),parent.references().map(id=>Number(id)===Number(old.id())?replacement:id)));
 const changed=controlFlowFromNetwork(network);assert.equal(executeControlFlow(changed,[0]).value,23);
 const target=await import('data:text/javascript;base64,'+Buffer.from(emitControlFlow(changed,'JavaScript')).toString('base64'));
 assert.equal(target.run([0]).value,23);
});
const operations=JSON.parse(readFileSync(new URL('../../test-corpus/control-flow/operations.json',import.meta.url)));
for(const fixture of operations.cases)test(`scalar operation contract: ${fixture.name}`,async()=>{
 assert.deepEqual(executeControlFlow(fixture.program,fixture.arguments,{fuel:fixture.fuel}),fixture.expected);
 const target=await import('data:text/javascript;base64,'+Buffer.from(emitControlFlow(fixture.program,'JavaScript')).toString('base64'));
 assert.deepEqual(target.run(fixture.arguments,fixture.fuel),fixture.expected);
});
