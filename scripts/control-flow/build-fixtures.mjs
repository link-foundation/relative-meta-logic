import { writeFileSync } from 'node:fs';
import { parseJavaScriptAst } from '../generate-linked-runtime.mjs';
import { lowerJavaScriptControlFlow } from '../../js/src/rml-control-flow-javascript.mjs';
import { executeControlFlow, controlFlowToRml } from '../../js/src/rml-control-flow.mjs';
const definitions = [
  {name:'loop-state-output',sources:{main:'export function sum(n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 2) { continue; } s += i; } console.log(s); return s; }'},entry:'main.sum',signatures:{'main.sum':{parameters:['int'],result:'int',effects:['output']}},arguments:[6]},
  {name:'mutual-recursion',sources:{main:'export function even(n) { if (n === 0) { return true; } return odd(n - 1); } function odd(n) { if (n === 0) { return false; } return even(n - 1); }'},entry:'main.even',signatures:{'main.even':{parameters:['int'],result:'bool',effects:[]},'main.odd':{parameters:['int'],result:'bool',effects:[]}},arguments:[127]},
  {name:'module-alias-and-effects',sources:{math:'export function increment(x) { console.log(x); return x + 1; }',main:'import { increment as step } from "./math.js"; export function calculate(n) { return step(step(n)); }'},dependencies:{main:{'./math.js':'math'}},entry:'main.calculate',signatures:{'main.calculate':{parameters:['int'],result:'int',effects:['output']},'math.increment':{parameters:['int'],result:'int',effects:['output']}},arguments:[40]},
  {name:'lexical-shadowing',sources:{main:'export function pick(n) { let x = n; { const x = 9; console.log(x); } return x; }'},entry:'main.pick',signatures:{'main.pick':{parameters:['int'],result:'int',effects:['output']}},arguments:[5]},
  {name:'short-circuit-effects',sources:{main:'function positive(n) { console.log(n); return 0 < n; } export function choose(n) { return (n < 0) && positive(n); }'},entry:'main.choose',signatures:{'main.positive':{parameters:['int'],result:'bool',effects:['output']},'main.choose':{parameters:['int'],result:'bool',effects:['output']}},arguments:[1]},
  {name:'evaluation-order',sources:{main:'export function order(n) { let x = n; return x + (x = 7); }'},entry:'main.order',signatures:{'main.order':{parameters:['int'],result:'int',effects:[]}},arguments:[2]},
  {name:'assignment-result-snapshot',sources:{main:'export function order(n) { let x = n; return (x = 4) + (x = 7); }'},entry:'main.order',signatures:{'main.order':{parameters:['int'],result:'int',effects:[]}},arguments:[2]},
  {name:'break-and-reassignment',sources:{main:'export function loop(n) { let x = 0; while (x < n) { x++; if (x === 3) { break; } } return x; }'},entry:'main.loop',signatures:{'main.loop':{parameters:['int'],result:'int',effects:[]}},arguments:[100]},
  {name:'negative-and-conditional',sources:{main:'export function choose(n) { return (n < 0) ? n * -2 : n - 3; }'},entry:'main.choose',signatures:{'main.choose':{parameters:['int'],result:'int',effects:[]}},arguments:[-17]},
  {name:'recursive-output-trace',sources:{main:'export function down(n) { console.log(n); if (n === 0) { return 0; } return down(n - 1); }'},entry:'main.down',signatures:{'main.down':{parameters:['int'],result:'int',effects:['output']}},arguments:[4]},
  {name:'fuel-is-not-divergence',sources:{main:'export function forever(n) { return forever(n + 1); }'},entry:'main.forever',signatures:{'main.forever':{parameters:['int'],result:'int',effects:[]}},arguments:[0],fuel:31},
  {name:'checked-overflow',sources:{main:'export function large(n) { return n * n; }'},entry:'main.large',signatures:{'main.large':{parameters:['int'],result:'int',effects:[]}},arguments:[9007199254740991]},
];
const cases=definitions.map(f=>{
 const project={modules:Object.entries(f.sources).map(([id,source])=>({id,ast:parseJavaScriptAst(source),dependencies:f.dependencies?.[id]})),signatures:f.signatures,entry:f.entry};
 const parsed=lowerJavaScriptControlFlow(project),fuel=f.fuel??10000;
 return {...f,fuel,program:parsed.program,rml:controlFlowToRml(parsed.program),expected:executeControlFlow(parsed.program,f.arguments,{fuel})};
});
const base=()=>({schema:'rml-control-flow/v1',modules:[{id:'m',imports:[],exports:['f']}],entry:'m.f',functions:[{module:'m',name:'f',parameters:[['n','int']],result:'int',effects:[],locals:[['v','int']],entry:'entry',blocks:[{id:'entry',instructions:[['copy','v','n']],terminator:['return','v']}]}]});
const mutations=[
 ['duplicate-register','BINDING',p=>p.functions[0].locals.push(['n','int'])],
 ['unresolved-call','BINDING',p=>p.functions[0].blocks[0].instructions=[['call','v','m.missing','n']]],
 ['uninitialized','UNINITIALIZED',p=>p.functions[0].blocks[0].instructions=[]],
 ['type-confusion','TYPE',p=>p.functions[0].blocks[0].instructions=[['const','v',true]]],
 ['unresolved-branch','BINDING',p=>p.functions[0].blocks[0].terminator=['jump','missing']],
 ['undeclared-output','EFFECT',p=>p.functions[0].blocks[0].instructions.push(['emit','v'])],
 ['unknown-operation','UNSUPPORTED',p=>p.functions[0].blocks[0].instructions=[['delete','v','n']]],
 ['hidden-proof-field','SCHEMA',p=>p.proof='trusted'],
 ['dangling-export','BINDING',p=>p.modules[0].exports=['missing']],
 ['unknown-result-type','TYPE',p=>p.functions[0].result='proof'],
 ['overflowing-literal','TYPE',p=>p.functions[0].blocks[0].instructions=[['const','v',9007199254740992]]],
 ['unreachable-block','UNREACHABLE',p=>p.functions[0].blocks.push({id:'dead',instructions:[],terminator:['return','n']})],
 ['undeclared-branch-type','TYPE',p=>p.functions[0].blocks[0].terminator=['branch','n','entry','entry']],
 ['missing-parameter-types','BINDING',p=>p.functions[0].parameters=[['n']]],
 ['missing-call-arguments','BINDING',p=>p.functions[0].blocks[0].instructions=[['call','v','m.f']]],
 ['duplicate-exports','BINDING',p=>p.modules[0].exports.push('f')],
 ['unsupported-effect','EFFECT',p=>p.functions[0].effects=['filesystem']],
 ['oversized-name','BINDING',p=>p.functions[0].locals=[['x'.repeat(257),'int']]],
];
const negativeCases=mutations.map(([name,code,mutate])=>{const program=base();mutate(program);return{name,code,program};});
writeFileSync(new URL('../../test-corpus/control-flow/cases.json',import.meta.url),JSON.stringify({schema:'rml-control-flow-corpus/v1',cases,negativeCases},null,2)+'\n');
