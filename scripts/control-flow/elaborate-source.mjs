/** Source ingress keeps official upstream preservation/grammar evidence distinct
 * from the downstream scalar semantic obligations and owned AST capture. */
import { constructProgram } from '../../js/src/rml-upstream-language.mjs';
import { lowerJavaScriptControlFlow } from '../../js/src/rml-control-flow-javascript.mjs';
import { lowerRustControlFlow } from '../../js/src/rml-control-flow-rust.mjs';
import { parseJavaScriptAst } from '../generate-linked-runtime.mjs';
import { rustAstTool } from '../generate-linked-rust-runtime.mjs';

export function elaborateControlFlowSource(project,{rustAstHelper}={}) {
  const language=project.language;
  if(!['JavaScript','Rust'].includes(language))throw new TypeError('Semantic source ingress currently supports JavaScript and Rust owned ASTs; Lean/Rocq source elaboration remains open');
  const representations=project.modules.map(module=>({id:module.id,program:constructProgram(module.source,language)}));
  const modules=project.modules.map(module=>({...module,ast:language==='JavaScript'?parseJavaScriptAst(module.source):rustAstTool('parse',module.source,rustAstHelper)}));
  const result=language==='JavaScript'?lowerJavaScriptControlFlow({...project,modules}):lowerRustControlFlow({...project,modules});
  return{...result,sourceLanguage:language,representations,stages:{preservation:'official-upstream-source-network',parsing:'official-grammar-and-owned-ast',resolution:'explicit-scalar-project',elaboration:'typed-control-flow-fragment',execution:'not-run',verification:'not-proved'}};
}
