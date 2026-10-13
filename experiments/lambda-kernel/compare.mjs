import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLambdaKernel, LAMBDA_MACHINE_OPERATIONS } from '../../js/src/rml-lambda-kernel.mjs';
import { createCombinatorKernel } from '../../js/src/rml-combinator-kernel.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
export const source = read('../../lib/meta-theory/fixed-point-source.lino');
export const replacement = read('../../test-corpus/lambda-kernel/mirror-substitution.lino');
export const workload = read('../../test-corpus/lambda-kernel/workload.lino');
export const cases = JSON.parse(read('../../test-corpus/lambda-kernel/cases.json'));

// Orchestration/codec control only. Every rewrite, import, match, substitution,
// inference, proof construction and lookup executes the same linked roots.
export function runWorkload(kernel, prefix, options = {}) {
  const programs = LinkedProgramRegistry.fromRml(workload).programs;
  const operations = new Set();
  const capabilities = new Set();
  let transitions = 0;
  const call = (name, ...args) => {
    const result = kernel[`${prefix}${name}`](...args, options);
    transitions += result.transitions ?? result.contractions;
    for (const operation of result.observedOperations) operations.add(operation);
    for (const capability of result.linkedCapabilities) capabilities.add(capability);
    return result;
  };
  const reductions = cases.reductions.map(item => {
    const rules = call('ResolveRewrites', programs, item.program);
    let term = item.input;
    const trace = [];
    for (let step = 0; step < 16; step += 1) {
      const result = call('RewriteOnce', term, rules);
      if (result.step === null) return { name: item.name, term, trace };
      term = result.step.term;
      trace.push(result.step.rule);
    }
    throw new Error('workload reduction bound exceeded');
  });
  let state = call('CreateProofState', programs, cases.program, []);
  const derivations = [];
  let fixedPoint = false;
  for (let round = 0; round < 8; round += 1) {
    const result = call('InferOnce', state);
    if (result.derivation === null) { fixedPoint = true; break; }
    derivations.push(result.derivation);
    state = result.state;
  }
  if (!fixedPoint) throw new Error('workload inference bound exceeded');
  const proof = call('FindProof', state, cases.goal).proof;
  const absentProof = call('FindProof', state, cases.absentGoal).proof;
  return {
    observations: { reductions, derivations, proof, absentProof, known: state.size, fixedPoint },
    observedOperations: [...operations].sort(), linkedCapabilities: [...capabilities].sort(),
    transitionCount: transitions,
  };
}

export function comparisonReport() {
  const direct = createLambdaKernel(source);
  const lambda = runWorkload(direct, 'lambda');
  const sk = runWorkload(createCombinatorKernel(), 'combinator');
  const programs = LinkedProgramRegistry.fromRml(workload).programs;
  const substitute = kernel => kernel.lambdaRewriteOnce(['input', 'value'], programs.get('rules').rewrites).step.term;
  return {
    schema: 'rml-lambda-source-control-comparison/v1',
    runtime: { language: 'JavaScript', node: process.version },
    inputs: Object.fromEntries([
      '../../lib/meta-theory/fixed-point-source.lino',
      '../../test-corpus/lambda-kernel/mirror-substitution.lino',
      '../../test-corpus/lambda-kernel/workload.lino',
      '../../test-corpus/lambda-kernel/cases.json',
      '../../js/src/rml-lambda-kernel.mjs',
      '../../js/src/rml-combinator-kernel.mjs',
      '../../rust/src/lambda_kernel.rs',
    ].map(path => [path.replace('../../', ''), createHash('sha256').update(read(path)).digest('hex')])),
    classification: 'LAMBDA_SEMANTICS_IMPLEMENTATION_CONTROL',
    sameObservations: JSON.stringify(lambda.observations) === JSON.stringify(sk.observations),
    lambda, sk,
    replacement: { baseline: substitute(direct), changed: substitute(createLambdaKernel(replacement)),
      executionInvokesBracketCompiler: false, hostMachineChanged: false },
    removals: LAMBDA_MACHINE_OPERATIONS.map(operation => {
      try {
        runWorkload(direct, 'lambda', { disabledOperations: [operation] });
        return { operation, failed: false };
      } catch (error) {
        return { operation, failed: error.message === `disabled host semantic operation ${operation}`,
          reason: error.message, classification: 'NECESSARY_IMPLEMENTATION_BRANCH_NOT_PROVED_INDEPENDENT_PRIMITIVE' };
      }
    }),
    trust: direct.lambdaTrustReport(),
    comparisonLimits: [
      'Lambda transition counts and S/K contraction counts measure different machine steps and cannot rank semantic minimality.',
      'The upper program and lambda calculus semantics are shared; this is not the genuinely different foundation required by R130/R149.',
      'Self-description/interpretation/generation, language coverage, and compiler-to-CPU closure are not established by this control.',
    ],
    requirementsCompleted: [],
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(comparisonReport(), null, 2));
}
