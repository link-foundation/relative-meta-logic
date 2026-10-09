import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelationalKernel } from '../src/rml-relational-kernel.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { createCombinatorKernel } from '../src/rml-combinator-kernel.mjs';
import { source } from '../../experiments/relational-kernel/compare.mjs';
const fairness=readFileSync(new URL('../../test-corpus/relational-kernel/fairness.lino',import.meta.url),'utf8');
test('linked Horn scheduling preserves S/K rotation even when the first rule stays productive',()=>{
  const programs=LinkedProgramRegistry.fromRml(fairness).programs,baseline=createCombinatorKernel();
  let expectedState=baseline.combinatorCreateProofState(programs,'fair');const expected=[];
  for(let n=0;n<4;n++){const next=baseline.combinatorInferOnce(expectedState);expected.push(next.derivation);expectedState=next.state;}
  assert.deepEqual(expected.map(item=>item.judgement),[['n',['s','z']],['m','z'],['n',['s',['s','z']]],['m',['s','z']]]);
  for(const selfInterpret of [false,true]){
    const kernel=new RelationalKernel(source),options={selfInterpret,maxSteps:100_000_000};let state=kernel.createProofState(programs,'fair',[],options),actual=[];
    for(let n=0;n<4;n++){const next=kernel.inferOnce(state,options);actual.push(next.derivation);state=next.state;}
    assert.deepEqual(actual,expected);
  }
});
test('an unfinished conclusion normalization is blocked rather than reported as saturation',()=>{
  const text='(linked-program bounded)\n(linked-fact bounded seed (judgement (ready z)))\n(linked-inference bounded derive (premise (ready ?x)) (conclusion (loop ?x)))\n(linked-rewrite bounded loop (from (loop ?x)) (to (loop ?x)))';
  const programs=LinkedProgramRegistry.fromRml(text).programs;
  for(const selfInterpret of [false,true]){
    const kernel=new RelationalKernel(source),options={selfInterpret,maxSteps:100_000_000,normalizationFuel:2};
    const state=kernel.createProofState(programs,'bounded',[],options);
    assert.throws(()=>kernel.inferOnce(state,options),/blocked: normalization-limit/);
  }
  assert.throws(()=>new RelationalKernel(source).createProofState(programs,'bounded',[],{normalizationFuel:257}),/normalizationFuel/);
});
