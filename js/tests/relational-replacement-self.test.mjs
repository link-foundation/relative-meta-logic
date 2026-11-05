import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelationalKernel, encodeRelationalBits, encodeRelationalList } from '../src/rml-relational-kernel.mjs';
import { source, replacementSource } from '../../experiments/relational-kernel/compare.mjs';
const options={selfInterpret:true,maxSteps:100_000_000};
test('recursive substitution replacement changes execution through the actual quoted source image',()=>{
  const original=new RelationalKernel(source),changed=new RelationalKernel(replacementSource());
  const rules=[{program:'p',name:'r',pattern:['i','?x'],replacement:['pair',['nested','?x'],'done']}];
  assert.deepEqual(original.rewriteOnce(['i','v'],rules,options).step.term,['pair',['nested','v'],'done']);
  assert.deepEqual(changed.rewriteOnce(['i','v'],rules,options).step.term,['done',['v','nested'],'pair']);
});
test('the quoted interpreter obeys a replaced linked occurs-check definition',()=>{
  const changedSource=source.replace('(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment failed))',
    '(horn-clause meta-bind-cycle (meta-bind-choice yes ?key ?value ?environment (unified ?environment)))');
  const original=new RelationalKernel(source),changed=new RelationalKernel(changedSource);
  const key=['key','end',encodeRelationalBits('x')],variable=['meta-variable',key];
  const query=['meta-unify',variable,['meta-list',encodeRelationalList([variable])],'end','?out'];
  assert.equal(original.selfQuery(query,options).goal.at(-1),'failed');
  assert.deepEqual(changed.selfQuery(query,options).goal.at(-1),['unified','end']);
});
test('replacing the linked interpreter unifier blocks quoted execution while direct Horn execution still works',()=>{
  const changedSource=source.replace('(horn-clause meta-unify-yes (meta-unify-decision yes ?environment (unified ?environment)))',
    '(horn-clause meta-unify-yes (meta-unify-decision yes ?environment failed))');
  assert.notEqual(changedSource,source);
  const kernel=new RelationalKernel(changedSource),rules=[{program:'p',name:'r',pattern:['i','?x'],replacement:['o','?x']}];
  assert.deepEqual(kernel.rewriteOnce(['i','v'],rules).step.term,['o','v']);
  assert.throws(()=>kernel.rewriteOnce(['i','v'],rules,options),/has no answer/);
});
