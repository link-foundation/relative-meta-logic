/**
 * The unchanged lambda-link meta-semantics executed on the Horn foundation.
 * `horn-link-substitution.lino` defines binder resolution, environment-based
 * substitution, value construction/observation and workflow orchestration as
 * Horn clauses. This module only transcribes the validated lambda source,
 * interns binder names injectively, caches the linked binder-resolution
 * result as root facts, and converts first-order inputs and outputs.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HornResolution } from './rml-horn-resolution.mjs';
import { parseLambdaSource } from './rml-lambda-kernel.mjs';
import {
  decodeRelationalBits,
  decodeRelationalList,
  decodeRelationalNode,
  encodeRelationalBits,
  encodeRelationalList,
  encodeRelationalNode,
  encodeRelationalPrograms,
} from './rml-relational-kernel.mjs';

export const HORN_LINK_SUBSTITUTION_SOURCE = readFileSync(
  new URL('../../lib/meta-theory/horn-link-substitution.lino', import.meta.url),
  'utf8',
);
const DEFAULT_STEPS = 400_000_000;
const DEFAULT_DEPTH = 1_000_000_000;

const parts = (value, tag, length) => {
  if (!Array.isArray(value) || value.length !== length || value[0] !== tag) {
    throw new Error(`invalid Horn link-substitution ${tag}`);
  }
  return value;
};
const unary = count => {
  if (!Number.isSafeInteger(count) || count < 0 || count > 4096) {
    throw new Error('Horn link-substitution fuel must be an integer from 0 to 4096');
  }
  let value = 'zero';
  while (count-- > 0) value = ['successor', value];
  return value;
};
function countUnary(value) {
  let count = 0;
  while (Array.isArray(value) && value.length === 2 && value[0] === 'successor') { count += 1; value = value[1]; }
  if (value !== 'zero') throw new Error('invalid Horn link-substitution count');
  return count;
}

/** Lambda terms as Horn data; binder names become injective binary codes. */
function lambdaTranscriber() {
  const codes = new Map();
  const code = name => {
    if (!codes.has(name)) {
      let value = codes.size;
      let bits = 'end';
      do { bits = [value & 1 ? 'one' : 'zero', bits]; value = Math.floor(value / 2); } while (value);
      codes.set(name, bits);
    }
    return codes.get(name);
  };
  const memo = new WeakMap();
  const transcribe = term => {
    if (typeof term === 'string') return ['marker', term];
    if (memo.has(term)) return memo.get(term);
    let result;
    if (term?.variable !== undefined) result = ['variable', code(term.variable)];
    else if (term?.lambda !== undefined) result = ['lambda', code(term.lambda), transcribe(term.body)];
    else if (Array.isArray(term) && term.length === 2) result = ['application', transcribe(term[0]), transcribe(term[1])];
    else throw new Error('invalid lambda term');
    memo.set(term, result);
    return result;
  };
  return { transcribe, names: () => codes.size };
}

/** Transcribe a validated lambda source DAG for linked binder resolution. */
export function transcribeLambdaSource(source) {
  const parsed = parseLambdaSource(source);
  const { transcribe, names } = lambdaTranscriber();
  const roots = encodeRelationalList(Object.entries(parsed.roots)
    .map(([name, term]) => ['root-source', name, transcribe(term)]));
  return { roots, nodeCount: parsed.nodeCount, rootCount: parsed.rootCount, names: names() };
}

function splitOrigin(bits) {
  const text = decodeRelationalBits(bits);
  const separator = text.indexOf('\0');
  if (separator < 0) throw new Error('linked rule name lacks its program separator');
  return { program: text.slice(0, separator), name: text.slice(separator + 1) };
}
function decodeProof(value) {
  const [, label, judgement, premises] = parts(value, 'proof', 4);
  const { program, name } = splitOrigin(label);
  return { judgement: decodeRelationalNode(judgement), program, rule: name,
    premises: decodeRelationalList(premises).map(decodeProof) };
}
function optionalProof(value) {
  if (value === 'none') return null;
  return decodeProof(parts(value, 'some', 2)[1]);
}

export function createHornLinkSubstitutionKernel(lambdaSource, {
  hornSource = HORN_LINK_SUBSTITUTION_SOURCE,
} = {}) {
  const transcription = transcribeLambdaSource(lambdaSource);
  const base = HornResolution.fromSource(hornSource);
  const conversion = base.query(['convert-roots', transcription.roots, '?table'],
    { captureProof: false, maxSteps: DEFAULT_STEPS, maxDepth: DEFAULT_DEPTH });
  if (conversion.answers.length !== 1) throw new Error('linked binder resolution rejected the lambda source');
  const rootFacts = decodeRelationalList(conversion.answers[0].goal[2]).map(entry => {
    const [, name, term] = parts(entry, 'root-term', 3);
    return { name: `root-term-${name}`, head: ['root-term', name, term], body: [] };
  });
  const resolver = new HornResolution([...base.clauses(), ...rootFacts]);
  const sourceHash = createHash('sha256').update(lambdaSource).digest('hex');
  const hornHash = createHash('sha256').update(hornSource).digest('hex');
  const run = (goal, options) => {
    const result = resolver.query(goal, {
      captureProof: false, maxSteps: DEFAULT_STEPS, maxDepth: DEFAULT_DEPTH, ...options,
    });
    if (result.answers.length !== 1) throw new Error('linked Horn workflow has no answer within the declared search');
    return { value: result.answers[0].goal.at(-1), steps: result.steps, observedOperations: result.observedOperations };
  };

  /** Reduce to normal form with the linked one-step rewrite root; fuel bounds the loop. */
  function reduce(programs, name, input, { fuel = 16, ...options } = {}) {
    const execution = run(['rml-reduce', encodeRelationalPrograms(programs), encodeRelationalBits(name),
      encodeRelationalNode(input), unary(fuel), '?result'], options);
    if (execution.value === 'missing-program') throw new Error(`linked-program ${name} is missing`);
    if (execution.value === 'bound-exceeded') throw new Error('Horn link-substitution reduction fuel exhausted');
    const [, term, trace] = parts(execution.value, 'reduced', 3);
    return { term: decodeRelationalNode(term), trace: decodeRelationalList(trace).map(splitOrigin),
      steps: execution.steps, observedOperations: execution.observedOperations };
  }

  /** Saturate inference and look up an exact proof and an absent judgement. */
  function prove(programs, name, goal, absentGoal, { fuel = 8, ...options } = {}) {
    const execution = run(['rml-prove', encodeRelationalPrograms(programs), encodeRelationalBits(name),
      encodeRelationalNode(goal), encodeRelationalNode(absentGoal), unary(fuel), '?result'], options);
    if (execution.value === 'missing-program') throw new Error(`linked-program ${name} is missing`);
    const [, count, derivations, proof, absent] = parts(execution.value, 'proved', 5);
    const derived = decodeRelationalList(derivations).map(item => {
      const [, judgement, evidence] = parts(item, 'derived', 3);
      return { judgement: decodeRelationalNode(judgement), proof: decodeProof(evidence) };
    });
    return { derivations: derived, proof: optionalProof(proof), absentProof: optionalProof(absent),
      known: countUnary(count) + derived.length, fixedPoint: true,
      steps: execution.steps, observedOperations: execution.observedOperations };
  }

  /** Evaluate a closed probe term (strings are opaque markers) to weak head form. */
  function evaluate(term, options = {}) {
    const execution = run(['evaluate-term', lambdaTranscriber().transcribe(term), '?result'], options);
    if (Array.isArray(execution.value) && execution.value[0] === 'marked' && execution.value[2] === 'end') {
      return { head: execution.value[1], steps: execution.steps };
    }
    return { head: null, value: execution.value, steps: execution.steps };
  }

  function trustReport() {
    return {
      schema: 'rml-horn-link-substitution-trust/v1',
      foundation: 'first-order-horn-resolution',
      upperSemantics: 'unchanged lambda-link meta-semantics (fixed-point-source.lino schema)',
      lambdaSourceSha256: sourceHash,
      linkSubstitutionSourceSha256: hornHash,
      linkedMechanisms: [
        'binder resolution (named lambda links to positional environment links)',
        'substitution by environment extension and closure entry',
        'variable lookup by positional environment links',
        'Scott value construction from linked roots',
        'observation of values by marker application',
        'reduce/prove workflow orchestration and fuel',
      ],
      externalFoundationLaws: resolver.trustReport().externalSemanticAuthority,
      externalBoundaryServices: [
        'lambda-source LiNo parsing, addressed-DAG validation and closed-root check',
        'injective per-source binder-name interning (equality preserving)',
        'caching of the linked binder-resolution answer as root facts',
        'first-order RML input encoding, UTF-8 bit decoding and program/rule-name splitting',
        'step/depth bounds, allocation, JavaScript runtime and processor',
      ],
      roots: transcription.rootCount,
      sourceNodes: transcription.nodeCount,
      internedNames: transcription.names,
      bracketAbstraction: false,
      combinatorContraction: false,
      lambdaMachineHostBranches: false,
      fullImplementationClosure: false,
    };
  }
  return Object.freeze({ evaluate, reduce, prove, trustReport, resolver });
}
