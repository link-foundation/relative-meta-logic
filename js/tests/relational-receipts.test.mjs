import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RelationalKernel } from '../src/rml-relational-kernel.mjs';
const source=readFileSync(new URL('../../lib/meta-theory/relational-kernel.lino',import.meta.url),'utf8');
for(const producer of ['js','rust'])test(`independently replays ${producer} generic and linked-interpreter certificates`,()=>{
  const receipt=JSON.parse(readFileSync(new URL(`../../test-corpus/relational-kernel/${producer}-receipt.json`,import.meta.url),'utf8'));
  const kernel=new RelationalKernel(source);
  assert.deepEqual(receipt.trust,kernel.resolver.trustReport());
  const direct=kernel.resolver.replay(receipt.direct.query,receipt.direct.proof);
  assert.equal(direct.accepted,true);assert.equal(direct.goal.at(-1),receipt.direct.value);
  const interpreted=kernel.selfReplay(receipt.interpreted.query,receipt.interpreted.certificate);
  assert.equal(interpreted.accepted,true);assert.deepEqual(interpreted.goal,receipt.interpreted.goal);
  assert.throws(()=>{kernel.sourceHash='forged';},TypeError);
  assert.throws(()=>{kernel.resolver=null;},TypeError);
});
