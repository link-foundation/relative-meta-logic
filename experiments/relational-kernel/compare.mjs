import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RelationalKernel, encodeRelationalNode } from '../../js/src/rml-relational-kernel.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';
import { isDeepStrictEqual } from 'node:util';
import { HORN_OPERATIONS } from '../../js/src/rml-horn-resolution.mjs';
export const source = readFileSync(new URL('../../lib/meta-theory/relational-kernel.lino', import.meta.url), 'utf8');
export const workload = readFileSync(new URL('../../test-corpus/relational-kernel/workload.lino', import.meta.url), 'utf8');
export const cases = JSON.parse(readFileSync(new URL('../../test-corpus/relational-kernel/cases.json', import.meta.url), 'utf8'));
export function replacementSource(value = source) {
  const original = '(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment (cons ?result ?rest))\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest))';
  if (!value.includes(original)) throw new Error('inspect changed substitution witness');
  return value.replace(original, '(horn-clause substitute-head (substitute-items (cons ?head ?tail) ?environment ?output)\n  (substitute ?head ?environment ?result) (substitute-items ?tail ?environment ?rest)\n  (append ?rest (cons ?result end) ?output))');
}
export function comparison() {
  const kernel = new RelationalKernel(source);
  const baseline = LinkedProgramRegistry.fromRml(workload);
  const reductions = cases.reductions.map(test => {
    const rules = kernel.resolve(baseline.programs, test.program);
    let output = test.input; let steps = 0;
    for (; steps < 16; steps++) {
      const result = kernel.rewriteOnce(output, { encodedRules: rules.value[1] });
      if (!kernel.resolver.replay(result.query, result.proof).accepted) throw new Error('independent rewrite proof replay failed');
      if (!result.step) break;
      output = result.step.term;
    }
    const expected = baseline.reduce(test.program, test.input).term;
    return { name: test.name, output, expected, steps, preserved: JSON.stringify(output) === JSON.stringify(expected) };
  });
  let state = kernel.createProofState(baseline.programs, cases.program);
  const derivations = [];
  for (let step = 0; step < 8; step++) {
    const result = kernel.inferOnce(state);
    if (!result.derivation) break;
    derivations.push(result.derivation); state = result.state;
  }
  const proof = kernel.findProof(state, cases.goal).proof;
  const absentProof = kernel.findProof(state, cases.absentGoal).proof;
  const changed = new RelationalKernel(replacementSource());
  return { schema: 'rml-relational-source-comparison/v1', reductions, derivations, proof, absentProof,
    proofPreserved: isDeepStrictEqual(proof, cases.proof),
    replacement: changed.rewriteOnce(['input','value'], baseline.programs.get('rules').rewrites).step.term,
    removals: HORN_OPERATIONS.map(operation => { try { kernel.call('nodes-equal', [encodeRelationalNode('x'),encodeRelationalNode('x')],{ disabledOperations:[operation] }); return {operation,failed:false}; } catch(error){return {operation,failed:error.message===`disabled host semantic operation ${operation}`};} }),
    trust: kernel.resolver.trustReport(),
    completeMinimalPeerEstablished: false,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(comparison(),null,2));
