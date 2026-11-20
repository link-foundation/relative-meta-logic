/**
 * One comparison contract for two meta-foundations below the same linked
 * upper layer: the closed S/K basis and first-order Horn resolution.
 * Every field below is computed by execution. Nothing ranks the foundations
 * and no global minimality is claimed.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCombinatorKernel } from '../../js/src/rml-combinator-kernel.mjs';
import { HornResolution, HORN_LAWS, HORN_OPERATIONS } from '../../js/src/rml-horn-resolution.mjs';
import { createHornLinkSubstitutionKernel, HORN_LINK_SUBSTITUTION_SOURCE } from '../../js/src/rml-horn-link-substitution.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';
import { RelationalKernel } from '../../js/src/rml-relational-kernel.mjs';
import { runWorkload } from '../lambda-kernel/compare.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
export const upperSource = read('../../lib/meta-theory/fixed-point-source.lino');
export const workload = read('../../test-corpus/lambda-kernel/workload.lino');
export const cases = JSON.parse(read('../../test-corpus/lambda-kernel/cases.json'));
export const skLaws = read('../../test-corpus/foundation-comparison/sk-laws.lino');
const relationalSource = read('../../lib/meta-theory/relational-kernel.lino');
const shared = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-observations.json'));

// A removal run may use at most this multiple of the resolution steps that the
// same query needs with every law present; more search cannot be what the
// baseline relied on.
export const REMOVAL_MARGIN = 1.1;
export const SK_PRIMITIVES = Object.freeze(['contract-s-link', 'contract-k-link']);
export const SK_SELF_CASES = Object.freeze([
  { name: 'identity from S K K', input: [[['S', 'K'], 'K'], 'a'], baseline: 'a', replacement: ['K', 'a'] },
  { name: 'nested constant', input: [['K', ['K', 'a']], 'b'], baseline: ['K', 'a'], replacement: 'b' },
  { name: 'distribution', input: [[['S', 'K'], 'a'], 'b'], baseline: 'b', replacement: ['a', 'b'] },
]);
export const SK_LAW_REPLACEMENT = Object.freeze({
  before: '(linked-rewrite sk k (from ((K ?x) ?y)) (to ?x))',
  after: '(linked-rewrite sk k (from ((K ?x) ?y)) (to ?y))',
});

function classify(run, baseline) {
  try {
    return JSON.stringify(run()) === JSON.stringify(baseline) ? 'PRESERVED' : 'CHANGED';
  } catch (error) {
    if (/disabled host semantic operation/.test(error.message)) return 'FAILED_DISABLED_OPERATION';
    if (/step bound|contraction limit|transition limit/.test(error.message)) return 'FAILED_SEARCH_BOUND';
    if (/depth bound/.test(error.message)) return 'FAILED_DEPTH_BOUND';
    return 'FAILED_NO_ANSWER';
  }
}

/** The shared workload observations through the Horn link-substitution kernel. */
export function hornWorkload(kernel, options = {}, bounds = null, steps = null) {
  const programs = LinkedProgramRegistry.fromRml(workload).programs;
  const reductions = cases.reductions.map((item, index) => {
    const result = kernel.reduce(programs, item.program, item.input,
      { ...options, ...(bounds ? { maxSteps: bounds.reduce[index] } : {}) });
    steps?.reduce.push(result.steps);
    return { name: item.name, term: result.term, trace: result.trace };
  });
  const proved = kernel.prove(programs, cases.program, cases.goal, cases.absentGoal,
    { ...options, ...(bounds ? { maxSteps: bounds.prove } : {}) });
  if (steps) steps.prove = proved.steps;
  return { reductions, derivations: proved.derivations, proof: proved.proof,
    absentProof: proved.absentProof, known: proved.known, fixedPoint: proved.fixedPoint };
}
/** Per-query removal bounds derived from the complete-law baseline. */
export function removalBounds(kernel) {
  const steps = { reduce: [], prove: 0 };
  hornWorkload(kernel, {}, null, steps);
  const bound = count => Math.ceil(count * REMOVAL_MARGIN);
  return { baselineSteps: steps, reduce: steps.reduce.map(bound), prove: bound(steps.prove) };
}
export function skWorkload(options = {}) {
  return runWorkload(createCombinatorKernel(), 'combinator', options).observations;
}

/** Remove every primitive law singly, then each remaining law from the reduced basis. */
export function lawRemoval() {
  const baseline = shared.baseline;
  const kernel = createHornLinkSubstitutionKernel(upperSource);
  const bounds = removalBounds(kernel);
  const horn = laws => classify(() => hornWorkload(kernel, { ablatedLaws: laws }, bounds), baseline);
  const single = Object.fromEntries(HORN_LAWS.map(law => [law, horn([law])]));
  const projection = classify(() => hornWorkload(kernel, { disabledOperations: ['horn-project-answer'] }, bounds), baseline);
  const removable = HORN_LAWS.filter(law => single[law] === 'PRESERVED');
  const jointRemoval = horn(removable);
  const reduced = HORN_LAWS.filter(law => !removable.includes(law));
  const reducedRemoval = Object.fromEntries(reduced.map(law => [law, horn([...removable, law])]));
  const sk = Object.fromEntries(SK_PRIMITIVES.map(operation =>
    [operation, classify(() => skWorkload({ disabledOperations: [operation] }), baseline)]));
  return {
    'closed-s-k': {
      declaredLaws: [...SK_PRIMITIVES], singleRemoval: sk,
      removable: SK_PRIMITIVES.filter(law => sk[law] === 'PRESERVED'),
      reducedBasis: SK_PRIMITIVES.filter(law => sk[law] !== 'PRESERVED'),
      reducedBasisRemovalMinimal: SK_PRIMITIVES.every(law => sk[law] !== 'PRESERVED'),
    },
    'horn-resolution': {
      declaredLaws: [...HORN_LAWS, 'answer-projection'],
      removalMargin: REMOVAL_MARGIN, removalBaselineSteps: bounds.baselineSteps,
      singleRemoval: { ...single, 'answer-projection': projection },
      removable, jointRemoval,
      reducedBasis: [...reduced, 'answer-projection'],
      reducedBasisRemoval: { ...reducedRemoval, 'answer-projection': projection },
      reducedBasisRemovalMinimal: jointRemoval === 'PRESERVED' &&
        Object.values(reducedRemoval).every(result => result !== 'PRESERVED') && projection !== 'PRESERVED',
    },
  };
}

/** The S/K laws as linked rules, interpreted above both foundations, under D and D'. */
export function skSelfInterpretation() {
  const changedLaws = skLaws.replace(SK_LAW_REPLACEMENT.before, SK_LAW_REPLACEMENT.after);
  if (changedLaws === skLaws) throw new Error('the linked K law has changed; inspect this witness');
  const run = (laws, foundation) => {
    if (foundation === 'closed-s-k') {
      const registry = LinkedProgramRegistry.fromRml(laws);
      return SK_SELF_CASES.map(item => registry.reduce('sk', item.input).term);
    }
    const kernel = createHornLinkSubstitutionKernel(upperSource);
    const programs = LinkedProgramRegistry.fromRml(laws).programs;
    return SK_SELF_CASES.map(item => kernel.reduce(programs, 'sk', item.input).term);
  };
  return Object.fromEntries(['closed-s-k', 'horn-resolution'].map(foundation => [foundation, {
    baseline: run(skLaws, foundation), replacement: run(changedLaws, foundation),
  }]));
}

/** F_C's quoted linked Horn interpreter runs F_C's linked Link-as-substitution clauses. */
export const HORN_SELF_CASES = Object.freeze([
  { name: 'equal binder codes', goal: ['code-equal', ['zero', 'end'], ['zero', 'end'], '?out'], output: 'yes' },
  { name: 'distinct binder codes', goal: ['code-equal', ['zero', 'end'], ['one', 'end'], '?out'], output: 'no' },
  { name: 'lexical capture', goal: ['evaluate-term', ['application', ['application',
    ['lambda', ['zero', 'end'], ['lambda', ['one', 'end'], ['variable', ['zero', 'end']]]],
    ['marker', 'outer']], ['marker', 'inner']], '?out'], output: ['marked', 'outer', 'end'] },
  { name: 'shadowed binder', goal: ['evaluate-term', ['application', ['application',
    ['lambda', ['zero', 'end'], ['lambda', ['zero', 'end'], ['variable', ['zero', 'end']]]],
    ['marker', 'outer']], ['marker', 'inner']], '?out'], output: ['marked', 'inner', 'end'] },
]);
export function hornSelfInterpretation() {
  const kernel = new RelationalKernel(`${relationalSource}\n${HORN_LINK_SUBSTITUTION_SOURCE}`);
  const image = kernel.describeProgram();
  const described = kernel.call('describe-program', [image], { captureProof: false }).value;
  const generated = kernel.call('generate-program', [described], { captureProof: false }).value;
  return {
    interpreted: HORN_SELF_CASES.map(item => ({
      name: item.name,
      direct: kernel.runQuery(item.goal, { captureProof: false, maxSteps: 10_000_000, maxDepth: 1_000_000 }).answers[0].goal.at(-1),
      interpreted: kernel.selfQuery(item.goal, { maxSteps: 100_000_000, maxDepth: 10_000_000 }).goal.at(-1),
    })),
    describedClauses: kernel.resolver.clauses().length,
    regeneratedImageEqual: JSON.stringify(generated) === JSON.stringify(image),
  };
}

// --- Executable non-equivalence criterion -------------------------------
// A lock-step (strong) bisimulation that preserves terminal observations
// preserves the number of distinct terminal observations reachable from a
// state. Every explored S/K state reaches at most one normal form (as the
// Church-Rosser theorem guarantees for all S/K terms), while one Horn state
// reaches two distinct answers and another reaches finite failure. So no
// observation-preserving lock-step encoding maps that Horn state to an S/K
// state. This does not exclude weaker mutual simulations: both are universal.
function* skTerms(leaves, size) {
  if (size === 1) { yield* leaves; return; }
  for (let left = 1; left < size; left += 1) {
    for (const f of skTerms(leaves, left)) for (const a of skTerms(leaves, size - left)) yield [f, a];
  }
}
// Every contraction at every redex position, each position once.
function skSuccessors(term, names) {
  if (!Array.isArray(term)) return [];
  const [f, a] = term;
  const results = [];
  if (Array.isArray(f) && f[0] === names.K) results.push(f[1]);
  if (Array.isArray(f) && Array.isArray(f[0]) && f[0][0] === names.S) results.push([[f[0][1], a], [f[1], a]]);
  for (const left of skSuccessors(f, names)) results.push([left, a]);
  for (const right of skSuccessors(a, names)) results.push([f, right]);
  return results;
}
export function exploreCombinatorBasis(names = { S: 'S', K: 'K' }, { maxLeaves = 6, maxStates = 256 } = {}) {
  const leaves = [names.S, names.K, 'x'];
  let terms = 0, explored = 0, branching = 0, maxNormalForms = 0;
  for (let size = 1; size <= maxLeaves; size += 1) {
    for (const term of skTerms(leaves, size)) {
      terms += 1;
      const seen = new Map([[JSON.stringify(term), term]]);
      const pending = [term]; const normal = new Set(); let complete = true;
      while (pending.length) {
        const state = pending.pop();
        const next = skSuccessors(state, names);
        if (next.length > 1) branching += 1;
        if (next.length === 0) normal.add(JSON.stringify(state));
        for (const successor of next) {
          const key = JSON.stringify(successor);
          if (seen.has(key)) continue;
          if (seen.size >= maxStates) { complete = false; break; }
          seen.set(key, successor); pending.push(successor);
        }
        if (!complete) break;
      }
      if (!complete) continue;
      explored += 1;
      maxNormalForms = Math.max(maxNormalForms, normal.size);
    }
  }
  // A state without a successor has no redex, so it is a normal form: the
  // combinator step relation has no terminal state that is not an answer.
  return { leaves: maxLeaves, terms, explored, branchingStates: branching, maxNormalForms, failureStates: false };
}
export const HORN_WITNESS = Object.freeze({
  clauses: [
    { name: 'left', head: ['choice', 'left'], body: [] },
    { name: 'right', head: ['choice', 'right'], body: [] },
  ],
  branching: ['choice', '?x'],
  failing: ['choice', 'middle'],
});
export function hornWitness() {
  const resolver = new HornResolution(HORN_WITNESS.clauses);
  const branching = resolver.query(HORN_WITNESS.branching, { maxAnswers: 8, captureProof: false });
  const failing = resolver.query(HORN_WITNESS.failing, { maxAnswers: 8, captureProof: false });
  return {
    distinctAnswers: [...new Set(branching.answers.map(answer => JSON.stringify(answer.goal)))].length,
    answers: branching.answers.map(answer => answer.goal),
    failingAnswers: failing.answers.length, failingExhausted: failing.exhausted,
  };
}
export function nonEquivalence() {
  const sk = exploreCombinatorBasis();
  const renamed = exploreCombinatorBasis({ S: 'S-renamed', K: 'K-renamed' });
  const horn = hornWitness();
  const signature = basis => ({ maxTerminalObservations: basis.maxNormalForms, failureStates: basis.failureStates });
  const hornSignature = { maxTerminalObservations: horn.distinctAnswers, failureStates: horn.failingAnswers === 0 && horn.failingExhausted };
  const separated = (left, right) => left.maxTerminalObservations !== right.maxTerminalObservations || left.failureStates !== right.failureStates;
  return {
    criterion: 'LOCKSTEP_BISIMULATION_PRESERVES_REACHABLE_TERMINAL_OBSERVATION_COUNT_AND_FAILURE',
    sk, renamed, horn,
    pairs: [
      { left: 'closed-s-k', right: 'horn-resolution', separated: separated(signature(sk), hornSignature),
        classification: separated(signature(sk), hornSignature) ? 'NOT_A_LOCKSTEP_RE_ENCODING' : 'RE_ENCODING_NOT_EXCLUDED' },
      { left: 'closed-s-k', right: 'renamed-s-k-control', separated: separated(signature(sk), signature(renamed)),
        classification: separated(signature(sk), signature(renamed)) ? 'NOT_A_LOCKSTEP_RE_ENCODING' : 'RE_ENCODING_NOT_EXCLUDED' },
    ],
    scope: 'Finite exhaustive exploration of S/K terms over {S, K, x} up to the stated leaf count; the all-terms statement is the classical Church-Rosser theorem, cited rather than re-proved. Weaker simulations are not excluded.',
  };
}

export function comparisonReport() {
  const horn = createHornLinkSubstitutionKernel(upperSource);
  const skObservations = skWorkload();
  const hornObservations = hornWorkload(horn);
  const removal = lawRemoval();
  const selfInterpretation = skSelfInterpretation();
  const hornSelf = hornSelfInterpretation();
  return {
    schema: 'rml-meta-foundation-comparison/v1',
    upperLayer: {
      source: 'lib/meta-theory/fixed-point-source.lino', sha256: sha256(upperSource),
      sharedByteIdenticalByBothFoundations: true, rewrittenForEitherFoundation: false,
    },
    workload: { program: 'test-corpus/lambda-kernel/workload.lino', cases: 'test-corpus/lambda-kernel/cases.json' },
    preservation: {
      sameReductionsJudgementsAndProofs: JSON.stringify(skObservations) === JSON.stringify(hornObservations),
      matchesSharedFixture: JSON.stringify(hornObservations) === JSON.stringify(shared.baseline),
      mechanismReplacementRows: shared.rows.length,
    },
    foundations: {
      'closed-s-k': {
        primitive: 'leftmost S/K contraction on addressed doublet links',
        linkSubstitution: { path: 'scripts/combinator-source.mjs', authority: 'HOST_BRACKET_ABSTRACTION_COMPILER', linked: false },
        removal: removal['closed-s-k'],
        selfInterpretation: { program: 'test-corpus/foundation-comparison/sk-laws.lino', ...selfInterpretation['closed-s-k'] },
        selfDescription: 'SOURCE_AS_ADDRESSED_LINKS',
        selfGeneration: 'NOT_ESTABLISHED_HOST_COMPILER_GENERATES_ARTIFACT',
        trustBoundary: [
          'S and K contraction equations and leftmost head reduction order',
          'host bracket-abstraction compiler (binder elimination) producing the closed artifact',
          'artifact parsing, Scott/UTF-8 input encoding and output decoding, public-call orchestration',
          'LiNo parsing and leading-? pattern elaboration of RML programs',
          'contraction budgets, allocation, JavaScript/Rust runtimes, operating system and processor',
        ],
      },
      'horn-resolution': {
        primitive: 'first-order unification and SLD resolution over finite link trees',
        linkSubstitution: { path: 'lib/meta-theory/horn-link-substitution.lino', authority: 'LINKED_HORN_CLAUSES', linked: true },
        removal: removal['horn-resolution'],
        selfInterpretation: { program: 'test-corpus/foundation-comparison/sk-laws.lino', ...selfInterpretation['horn-resolution'],
          quotedLinkSubstitution: hornSelf.interpreted },
        selfDescription: 'CLAUSE_IMAGE_DESCRIBED_BY_LINKED_RELATION',
        selfGeneration: hornSelf.regeneratedImageEqual ? 'CLAUSE_IMAGE_REGENERATED_BY_LINKED_RELATION' : 'FAILED',
        trustBoundary: [
          ...removal['horn-resolution'].reducedBasis.map(law => `resolution law: ${law}`),
          'predicate/arity indexing and conservative head discrimination',
          'lambda-source LiNo parsing and validation, injective binder-name interning, caching of linked binder resolution as root facts',
          'first-order RML input encoding, UTF-8 bit decoding and rule-name splitting',
          'generic LiNo parsing; this workload passes host-elaborated programs, while reduceSource/proveSource take keyword, sigil and validity decisions from horn-rml-elaboration.lino',
          'step/depth bounds, allocation, JavaScript/Rust runtimes, operating system and processor',
        ],
      },
    },
    nonEquivalence: nonEquivalence(),
    hostOperationGroups: { 'closed-s-k': [...SK_PRIMITIVES], 'horn-resolution': [...HORN_OPERATIONS] },
    gate: {
      genuinelyDifferentFoundations: 2,
      r149Satisfied: false,
      openReasons: [
        'The S/K foundation still compiles its Link-as-substitution layer with a host bracket-abstraction compiler.',
        'Both foundations keep host LiNo parsing and data codecs above the primitive laws; ? elaboration is linked only on the Horn source workflows, and the S/K path and this comparison workload use host elaboration.',
        'Self-generation of the S/K artifact by linked definitions is not established.',
        'Removal minimality is relative to this one workload and these law decompositions, not global.',
      ],
    },
    globalMinimalityClaimed: false,
    rankingClaimed: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(comparisonReport(), null, 2));
}
