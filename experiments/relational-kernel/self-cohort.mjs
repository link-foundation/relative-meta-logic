import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { RelationalKernel } from '../../js/src/rml-relational-kernel.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';
import { source, workload, cases } from './compare.mjs';
export function selfCohort({onProgress=()=>{}}={}) {
  const kernel=new RelationalKernel(source),programs=LinkedProgramRegistry.fromRml(workload).programs;
  const options={selfInterpret:true,maxSteps:100_000_000};
  const resolved=new Map(),reductions=[];let operations=0;
  for(const item of cases.reductions){
    if(!resolved.has(item.program)){const rules=kernel.resolve(programs,item.program,'rewrites',options);resolved.set(item.program,{encodedRules:rules.value[1]});operations+=rules.steps;onProgress(`resolved ${item.program}`);}
    let output=item.input;let finished=false;
    for(let step=0;step<16;step++){
      const result=kernel.rewriteOnce(output,resolved.get(item.program),options);operations+=result.steps;
      if(!result.step){finished=true;break;}output=result.step.term;
    }
    if(!finished||!isDeepStrictEqual(output,item.output))throw new Error(`self interpreted reduction mismatch: ${item.name}`);
    reductions.push({name:item.name,output});onProgress(`preserved ${item.name}`);
  }
  let state=kernel.createProofState(programs,cases.program,[],options);onProgress('created imported facts');
  const derivations=[];let fixedPoint=false;
  for(let step=0;step<8;step++){
    const result=kernel.inferOnce(state,options);operations+=result.execution.steps;
    if(!result.derivation){fixedPoint=result.execution.exhausted;break;}
    derivations.push(result.derivation);state=result.state;onProgress(`derived ${JSON.stringify(result.derivation.judgement)}`);
  }
  const proof=kernel.findProof(state,cases.goal,options).proof;
  const absentProof=kernel.findProof(state,cases.absentGoal,options).proof;
  if(!fixedPoint||!isDeepStrictEqual(proof,cases.proof)||absentProof!==null)throw new Error('self interpreted proof/fixed-point mismatch');
  return {schema:'rml-relational-self-cohort/v1',capabilities:['matching','substitution','rule-selection-and-traversal','import-and-rebinding','inference-saturation','result-verification'],
    reductions,derivations,proof,absentProof,fixedPoint,known:state.size,partialOperationCount:operations,
    countingScope:'reduction resolution/rewrite calls and inference calls; excludes proof-state setup and final lookup',
    sourcePredicateDispatch:true,sourceUnificationAndFreshening:true,
    certificateScope:'Full engine certificates are optional; RML proof trees above are included in the observations.',
    independentPrimitiveMinimalityEstablished:false,fullImplementationClosure:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) console.log(JSON.stringify(selfCohort({onProgress:message=>console.error(message)}),null,2));
