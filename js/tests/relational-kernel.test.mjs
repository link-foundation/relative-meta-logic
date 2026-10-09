import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HornResolution, HORN_OPERATIONS } from '../src/rml-horn-resolution.mjs';
import { RelationalKernel, encodeRelationalNode, encodeRelationalBits, encodeRelationalList, decodeRelationalNode } from '../src/rml-relational-kernel.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { source, workload, cases, replacementSource, comparison } from '../../experiments/relational-kernel/compare.mjs';

const kernel = () => new RelationalKernel(source);
const program = () => LinkedProgramRegistry.fromRml(workload);

test('Horn source preserves shared reductions imports judgements inference fixed point and proof trees', () => {
  const report = comparison();
  assert.ok(report.reductions.every(item => item.preserved));
  assert.deepEqual(report.reductions.map(item => item.output), cases.reductions.map(item => item.output));
  assert.equal(report.proofPreserved, true);
  assert.deepEqual(report.proof, cases.proof);
  assert.equal(report.absentProof, null);
  assert.equal(report.derivations.length, 2);
  assert.deepEqual(report.replacement, ['done',['value','nested'],'pair']);
  assert.equal(report.completeMinimalPeerEstablished, false);
});

test('Horn source substitution replacement leaves generic resolver and concurrent baseline unchanged', () => {
  const original = kernel(), changed = new RelationalKernel(replacementSource());
  const rules = program().programs.get('rules').rewrites;
  const before = original.rewriteOnce(['input','value'], rules);
  const after = changed.rewriteOnce(['input','value'], rules);
  assert.deepEqual(before.step.term,['pair',['nested','value'],'done']);
  assert.deepEqual(after.step.term,['done',['value','nested'],'pair']);
  assert.deepEqual(original.rewriteOnce(['input','value'], rules).step,before.step);
  assert.deepEqual(before.observedOperations,after.observedOperations);
  assert.equal(changed.resolver.replay(after.query,after.proof).accepted,true);
  assert.equal(original.resolver.replay(after.query,after.proof).accepted,false);
});

test('generic first-order unification freshens scopes rejects occurs cycles and backtracks honestly', () => {
  const resolver = HornResolution.fromSource(`
(horn-clause first (edge a b))
(horn-clause second (edge b c))
(horn-clause path (path ?x ?z) (edge ?x ?y) (edge ?y ?z))
(horn-clause repeat (repeated ?x ?x))
(horn-clause impossible (cycle ?x (f ?x)))`);
  assert.deepEqual(resolver.query(['path','a','?out']).answers[0].goal,['path','a','c']);
  assert.equal(resolver.query(['repeated','a','b']).answers.length,0);
  assert.equal(resolver.query(['cycle','?x','?x']).answers.length,0);
  const answers=resolver.query(['edge','?x','?y'],{maxAnswers:3});
  assert.equal(answers.exhausted,true);assert.equal(answers.answers.length,2);
  for(const answer of answers.answers)assert.equal(resolver.replay(['edge','?x','?y'],answer.proof).accepted,true);
});

test('independent Horn replay rejects forged goals clauses premises context and substitution evidence', () => {
  const k=kernel(), result=k.rewriteOnce(['input','value'],program().programs.get('rules').rewrites);
  assert.equal(k.resolver.replay(result.query,result.proof).accepted,true);
  const mutations=[
    proof=>{proof.clause='forged';},
    proof=>{proof.goal[0]='wrong-query';},
    proof=>{proof.premises.pop();},
    proof=>{proof.premises[0].goal=['forged'];},
  ];
  for(const mutate of mutations){const proof=structuredClone(result.proof);mutate(proof);assert.equal(k.resolver.replay(result.query,proof).accepted,false);}
  assert.equal(k.resolver.replay(['nodes-equal',encodeRelationalNode('wrong'),encodeRelationalNode('goal'),'?result'],result.proof).accepted,false);
});

test('Horn source imports detect missing dependencies and cycles without host graph resolution', () => {
  const k=kernel();
  const base={name:'a',rewrites:[],facts:[],inferences:[],uses:[{program:'missing',rebindings:new Map()}]};
  assert.throws(()=>k.resolve([base],'a'),/missing/);
  assert.throws(()=>k.resolve([{...base,uses:[{program:'a',rebindings:new Map()}]}],'a'),/cycle/);
});

test('every declared Horn host operation is removable and no minimality is inferred from removal', () => {
  const k=kernel();
  for(const operation of HORN_OPERATIONS)assert.throws(()=>k.call('nodes-equal',[encodeRelationalNode('x'),encodeRelationalNode('x')],{disabledOperations:[operation]}),error=>error.message===`disabled host semantic operation ${operation}`);
  assert.equal(k.resolver.trustReport().independentPrimitiveMinimalityEstablished,false);
  assert.equal(k.resolver.trustReport().intrinsicLinksAuthorityEstablished,false);
  assert.equal(k.resolver.trustReport().fullImplementationClosure,false);
});

test('quoted Horn interpreter executes its actual source image with linked unification and freshening', () => {
  const k=kernel(),goal=['bits-equal',['zero','end'],['zero','end'],'?out'];
  const direct=k.resolver.query(goal).answers[0].goal;
  assert.deepEqual(k.selfQuery(goal).goal,direct);
  assert.ok(k.resolver.clauses().some(clause=>clause.name==='meta-unify'));
  assert.ok(k.resolver.clauses().some(clause=>clause.name==='meta-bind-cycle'));
});

test('linked meta unification performs an occurs check and source replacement changes it', () => {
  const k=kernel(),key=['key','end',encodeRelationalBits('x')],variable=['meta-variable',key];
  const cyclic=['meta-list',encodeRelationalList([variable])];
  assert.equal(k.call('meta-unify',[variable,cyclic,'end']).value,'failed');
  const changed=new RelationalKernel(source.replace('(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment failed))',
    '(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment (unified ?environment)))'));
  assert.deepEqual(changed.call('meta-unify',[variable,cyclic,'end']).value,['unified','end']);
  assert.equal(k.call('meta-unify',[variable,cyclic,'end']).value,'failed');
});

test('source descriptions and generated clause images preserve the actual declared program', () => {
  const k=kernel(),image=k.describeProgram();
  const described=k.call('describe-program',[image],{captureProof:false}).value;
  const generated=k.call('generate-program',[described],{captureProof:false}).value;
  assert.deepEqual(generated,image);
  const query=encodeRelationalNode(['bits-equal','end','end','?out'],true);
  const result=k.call('self-query',[generated,query],{captureProof:false,maxSteps:10000000}).value;
  assert.deepEqual(decodeRelationalNode(result[1]),['bits-equal','end','end','yes']);
});

test('Horn source and execution validation fails closed instead of claiming exhausted success', () => {
  assert.throws(()=>HornResolution.fromSource(''),/count/);
  assert.throws(()=>HornResolution.fromSource('(not-a-clause x)'),/horn-clause/);
  assert.throws(()=>HornResolution.fromSource('(horn-clause x (p a))\n(horn-clause x (q a))'),/duplicate/);
  const k=kernel();
  assert.throws(()=>k.call('nodes-equal',[encodeRelationalNode('x'),encodeRelationalNode('x')],{maxSteps:1}),/bound/);
  assert.throws(()=>k.resolver.query(['p'],{maxAnswers:0}),/positive/);
  const divergent=HornResolution.fromSource('(horn-clause loop (loop unit) (loop unit))');
  assert.throws(()=>divergent.query(['loop','unit'],{maxDepth:10}),/depth bound/);
  const cyclic=[];cyclic.push(cyclic);assert.throws(()=>k.resolver.query(cyclic),/finite/);
});

test('immutable ground-term shortcut follows bound aliases and rolls back branches without stale groundness', () => {
  const resolver=HornResolution.fromSource(`
(horn-clause alias-cycle (cycle ?a ?b (f ?a)))
(horn-clause trial (picked ?x) (same ?x bad) (missing ?x))
(horn-clause success (picked good))
(horn-clause same (same ?v ?v))
(horn-clause owned (owned (f a)))`);
  assert.equal(resolver.query(['cycle','?x','?x','?x']).answers.length,0);
  assert.deepEqual(resolver.query(['picked','?out']).answers[0].goal,['picked','good']);
  const query=['owned',['f','a']];const answer=resolver.query(query).answers[0];
  query[1][1]='b';assert.equal(resolver.query(query).answers.length,0);
  assert.deepEqual(answer.goal,['owned',['f','a']]);
  assert.equal(resolver.replay(['owned',['f','a']],answer.proof).accepted,true);
  assert.equal(resolver.replay(query,answer.proof).accepted,false);
  const head=['stable',['f','a']];const source=[{name:'owned',head,body:[]}];const owned=new HornResolution(source);
  head[1][1]='b';const exposed=owned.clauses();exposed[0].head[1][1]='c';
  assert.equal(owned.query(['stable',['f','a']]).answers.length,1);
  assert.equal(owned.query(['stable',['f','b']]).answers.length,0);
});

test('source-defined replay binds interned proof codes to the expected source and atom dictionary', () => {
  const k=kernel(),goal=['bits-equal',['zero','end'],['zero','end'],'?out'];
  const result=k.selfQuery(goal,{includeSourceProof:true});
  assert.equal(k.selfReplay(goal,result.sourceProof).accepted,true);
  const wrongHash=structuredClone(result.sourceProof);wrongHash[1]='forged';assert.equal(k.selfReplay(goal,wrongHash).accepted,false);
  const wrongNames=structuredClone(result.sourceProof);wrongNames[2][0]='forged';assert.equal(k.selfReplay(goal,wrongNames).accepted,false);
  const wrongProof=structuredClone(result.sourceProof);wrongProof[3]='end';assert.equal(k.selfReplay(goal,wrongProof).accepted,false);
  assert.equal(k.selfReplay(['bits-equal','end',['zero','end'],'?out'],result.sourceProof).accepted,false);
});

test('conditional trailing and constructor discrimination preserve all finite branch answers', async () => {
  const {readFileSync}=await import('node:fs');
  const cases=JSON.parse(readFileSync(new URL('../../test-corpus/relational-kernel/branch-cases.json',import.meta.url),'utf8')).cases;
  for(const item of cases){
    const resolver=HornResolution.fromSource(item.source);
    for(const captureProof of [false,true]){
      const result=resolver.query(item.query,{maxAnswers:100,captureProof});
      assert.equal(result.exhausted,true,item.name);
      assert.deepEqual(result.answers.map(answer=>answer.goal),item.answers,item.name);
      if(captureProof)for(const answer of result.answers)assert.equal(resolver.replay(item.query,answer.proof).accepted,true);
    }
  }
});
