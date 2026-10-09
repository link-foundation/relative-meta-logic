import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelationalKernel } from '../src/rml-relational-kernel.mjs';
const emptyState={rules:'end',inferences:'end',known:'end',size:0};
test('relational rewrite codec checks every output constructor and arity',()=>{
  for(const value of ['(other (step (atom end) (origin end end)))','(some (other (atom end) (origin end end)))','(some (step (atom end) (other end end)))','(some (step (atom end) (origin end end extra)))']){
    const kernel=new RelationalKernel(`(horn-clause malformed (rewrite-once ?rules ?term ${value}))`);
    assert.throws(()=>kernel.rewriteOnce('x',[]),/invalid relational/);
  }
});
test('relational import inference and proof codecs reject malformed source outputs',()=>{
  assert.throws(()=>new RelationalKernel('(horn-clause malformed (resolve ?programs ?name ?kind ?seen (resolved end extra)))').resolve([],'p'),/invalid relational resolved/);
  const inference=new RelationalKernel('(horn-clause malformed (infer-step ?inferences ?known ?rules ?fuel (other (atom end) (proof (origin end end) (atom end) end))))');
  assert.throws(()=>inference.inferOnce(emptyState),/invalid relational transition/);
  const proof=new RelationalKernel('(horn-clause malformed (known-proof ?goal ?known (other (proof (origin end end) (atom end) end))))');
  assert.throws(()=>proof.findProof(emptyState,'x'),/invalid relational some/);
  const origin=new RelationalKernel('(horn-clause malformed (known-proof ?goal ?known (some (proof (origin end end extra) (atom end) end))))');
  assert.throws(()=>origin.findProof(emptyState,'x'),/invalid relational origin/);
});
test('quoted result codec rejects wrong tags and noncanonical atom codes',()=>{
  for(const value of ['(other (atom (zero end)))','(answer (atom end))','(answer (atom (zero (zero end))))']){
    const kernel=new RelationalKernel(`(horn-clause malformed (self-query-value ?program ?goal ${value}))`);
    assert.throws(()=>kernel.selfQuery(['x','?out']),/invalid relational answer|noncanonical interpreted atom code/);
  }
});
