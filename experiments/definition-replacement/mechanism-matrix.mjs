import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeCombinatorSource } from '../../scripts/combinator-source.mjs';
import { createCombinatorKernel } from '../../js/src/rml-combinator-kernel.mjs';
import { createLambdaKernel } from '../../js/src/rml-lambda-kernel.mjs';
import { createHornLinkSubstitutionKernel } from '../../js/src/rml-horn-link-substitution.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';
import { runWorkload } from '../lambda-kernel/compare.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
export const source = read('../../lib/meta-theory/fixed-point-source.lino');
export const matrix = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-replacements.json'));
export const workload = read('../../test-corpus/lambda-kernel/workload.lino');
const cases = JSON.parse(read('../../test-corpus/lambda-kernel/cases.json'));

/** Apply one declared D to D' edit to the authoritative linked source text. */
export function applyLinkedSourceReplacement(text, replacement) {
  const declared = text.match(/\(node-count (\d+)\)/);
  if (declared === null || text.split(declared[0]).length !== 2) throw new Error('linked source lacks one node-count declaration');
  let changed = text;
  for (const [node, before, after] of replacement.replace) {
    const original = `(bootstrap-source-node ${node} ${before})`;
    if (changed.split(original).length !== 2) throw new Error(`replacement ${replacement.id} no longer matches ${node}`);
    changed = changed.replace(original, `(bootstrap-source-node ${node} ${after})`);
  }
  const count = Number(declared[1]) + replacement.add.length;
  changed = changed.replace(declared[0], `(node-count ${count})`);
  return changed + replacement.add.map(([node, form]) => `(bootstrap-source-node ${node} ${form})\n`).join('');
}

/** Every observed workload result of a linked execution, including a failure. */
function observe(run) {
  try {
    return run();
  } catch (error) {
    return { error: error.message };
  }
}
export function lambdaObservations(text) {
  return observe(() => runWorkload(createLambdaKernel(text), 'lambda').observations);
}
export function compiledSkObservations(text) {
  return observe(() => runWorkload(createCombinatorKernel(serializeCombinatorSource(text)), 'combinator').observations);
}
export function hornObservations(text, options = {}) {
  return observe(() => {
    const kernel = createHornLinkSubstitutionKernel(text, options);
    const programs = LinkedProgramRegistry.fromRml(workload).programs;
    const reductions = cases.reductions.map(item => {
      const result = kernel.reduce(programs, item.program, item.input);
      return { name: item.name, term: result.term, trace: result.trace };
    });
    const proved = kernel.prove(programs, cases.program, cases.goal, cases.absentGoal);
    return { reductions, derivations: proved.derivations, proof: proved.proof,
      absentProof: proved.absentProof, known: proved.known, fixedPoint: proved.fixedPoint };
  });
}

/**
 * The same observations through the linked source workflows: the document is
 * elaborated by horn-rml-elaboration.lino, not by the host registry.
 */
export function hornSourceObservations(text, { document = workload, ...options } = {}) {
  return observe(() => {
    const kernel = createHornLinkSubstitutionKernel(text, options);
    const reductions = cases.reductions.map(item => {
      const result = kernel.reduceSource(document, item.program, item.input);
      return { name: item.name, term: result.term, trace: result.trace };
    });
    const proved = kernel.proveSource(document, cases.program, cases.goal, cases.absentGoal);
    return { reductions, derivations: proved.derivations, proof: proved.proof,
      absentProof: proved.absentProof, known: proved.known, fixedPoint: proved.fixedPoint };
  });
}

/** Apply one declared D to D' edit of the linked elaboration source, and its document spelling. */
export function applyElaborationReplacement(elaborationSource, document, replacement) {
  let changed = elaborationSource;
  for (const [before, after] of replacement.replace) {
    if (changed.split(before).length !== 2) throw new Error(`elaboration replacement ${replacement.id} no longer matches`);
    changed = changed.replace(before, after);
  }
  let spelled = document;
  for (const [before, after] of replacement.workloadEdit) spelled = spelled.split(before).join(after);
  return { elaborationSource: changed, document: spelled };
}

/** Changed observation paths, so a test can show exactly what each D' changed. */
export function changedObservations(before, after) {
  if (before.error || after.error) return before.error === after.error ? [] : ['error'];
  const changed = [];
  before.reductions.forEach((item, index) => {
    if (JSON.stringify(item) !== JSON.stringify(after.reductions[index])) changed.push(`reduction:${item.name}`);
  });
  for (const key of ['derivations', 'proof', 'absentProof', 'known', 'fixedPoint']) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

export function mechanismMatrix({ executions = ['lambda', 'compiled-sk', 'horn'] } = {}) {
  const runners = { lambda: lambdaObservations, 'compiled-sk': compiledSkObservations, horn: hornObservations };
  const run = text => Object.fromEntries(executions.map(name => [name, runners[name](text)]));
  const baseline = run(source);
  const rows = matrix.replacements.map(replacement => {
    const observations = run(applyLinkedSourceReplacement(source, replacement));
    const reference = observations[executions[0]];
    return {
      id: replacement.id, level: replacement.level,
      agreeAcrossExecutions: executions.every(name => JSON.stringify(observations[name]) === JSON.stringify(reference)),
      changed: changedObservations(baseline[executions[0]], reference),
      observations: reference,
    };
  });
  return {
    schema: 'rml-linked-mechanism-replacement-matrix/v1',
    executions,
    baselineAgrees: executions.every(name => JSON.stringify(baseline[name]) === JSON.stringify(baseline[executions[0]])),
    baseline: baseline[executions[0]],
    rows,
    unchangedHosts: ['js/src/rml-lambda-kernel.mjs', 'js/src/rml-combinator-kernel.mjs',
      'js/src/rml-horn-resolution.mjs', 'scripts/combinator-source.mjs'],
    claimsFullImplementationClosure: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(mechanismMatrix(), null, 2));
}
