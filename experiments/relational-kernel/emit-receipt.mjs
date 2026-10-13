import { RelationalKernel, encodeRelationalNode } from '../../js/src/rml-relational-kernel.mjs';
import { source } from './compare.mjs';
const kernel=new RelationalKernel(source);
const direct=kernel.call('nodes-equal',[encodeRelationalNode('λ'),encodeRelationalNode('λ')]);
const query=['bits-equal',['zero','end'],['zero','end'],'?out'];
const interpreted=kernel.selfQuery(query,{includeSourceProof:true});
console.log(JSON.stringify({schema:'rml-relational-cross-runtime-receipt/v1',producer:'javascript',trust:kernel.resolver.trustReport(),
  direct:{query:direct.query,value:direct.value,proof:direct.proof},
  interpreted:{query,goal:interpreted.goal,certificate:interpreted.sourceProof}},null,2));
