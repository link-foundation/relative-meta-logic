/**
 * Fixed-point bootstrap for linked programs.
 *
 * The host contracts only the two local equations of the S/K binary-link
 * basis. Matching, repeated-variable binding, substitution, ordered rule
 * selection, and nested traversal are closed combinator terms. Input/output
 * conversion is deliberately kept outside the semantic basis.
 */

import KERNEL_ARTIFACT, {
  KERNEL_SOURCE_METADATA,
} from './rml-combinator-kernel-data.mjs';

const S = 'S';
const K = 'K';
const app = (left, right) => [left, right];
const applyMany = (head, ...arguments_) => arguments_.reduce(app, head);

// The runtime parses the checked-in addressed-link artifact; source compilation
// is generation-only and lives in scripts/combinator-source.mjs.
function parseCombinatorKernel(serialized) {
  const lines = serialized.split('\n');
  if (lines.shift() !== 'rml-addressed-link-dag-v1') {
    throw new Error('invalid fixed-point kernel header');
  }
  const counts = lines.shift()?.split('\t').map(Number);
  if (counts?.length !== 2 || counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('invalid fixed-point kernel counts');
  }
  const [nodeCount, rootCount] = counts;
  const nodes = [];
  const reference = value => {
    if (value === S || value === K) return value;
    if (!/^n\d+$/.test(value)) throw new Error(`invalid fixed-point reference ${value}`);
    const index = Number(value.slice(1));
    if (index >= nodes.length) throw new Error(`unknown fixed-point node ${value}`);
    return nodes[index];
  };
  for (let expected = 0; expected < nodeCount; expected += 1) {
    const fields = lines.shift()?.split('\t');
    if (fields?.length !== 3 || Number(fields[0]) !== expected) {
      throw new Error(`invalid fixed-point node ${expected}`);
    }
    nodes.push(app(reference(fields[1]), reference(fields[2])));
  }
  const roots = {};
  for (let index = 0; index < rootCount; index += 1) {
    const fields = lines.shift()?.split('\t');
    if (fields?.length !== 2 || Object.hasOwn(roots, fields[0])) {
      throw new Error('invalid fixed-point root');
    }
    roots[fields[0]] = reference(fields[1]);
  }
  if (lines.some(line => line.length > 0)) {
    throw new Error('unexpected fixed-point kernel content');
  }
  return { nodeCount, rootCount, roots };
}

const parsedKernel = parseCombinatorKernel(KERNEL_ARTIFACT);
const {
  TRUE,
  FALSE,
  NIL,
  CONS,
  ATOM,
  LIST,
  PATTERN_VARIABLE,
  PATTERN_ATOM,
  PATTERN_LIST,
  NAMED_RULE,
  FACT,
  INFERENCE,
  REBINDING,
  PROGRAM_IMPORT,
  PROGRAM,
  PROOF,
  KNOWN,
  APPEND,
  RESOLVE_REWRITES,
  RESOLVE_FACTS,
  RESOLVE_INFERENCES,
  REWRITE_ONCE,
  ADD_FACTS,
  INFER_ONCE,
  FIND_KNOWN_PROOF,
} = parsedKernel.roots;

const KERNEL_SOURCE_REPORT = Object.freeze({
  ...KERNEL_SOURCE_METADATA,
  runtimeNodes: parsedKernel.nodeCount,
  roots: parsedKernel.rootCount,
});

/** Report the provenance and sizes of the authoritative link source. */
function combinatorKernelSourceReport() {
  return { ...KERNEL_SOURCE_REPORT };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function encodeBits(value) {
  return [...encoder.encode(value)]
    .flatMap(byte => Array.from(
      { length: 8 },
      (_, index) => (byte & (128 >> index)) !== 0,
    ))
    .reduceRight(
      (tail, bit) => applyMany(CONS, bit ? TRUE : FALSE, tail),
      NIL,
    );
}

function encodeNode(term) {
  if (!Array.isArray(term)) return app(ATOM, encodeBits(String(term)));
  return app(LIST, term.reduceRight(
    (tail, child) => applyMany(CONS, encodeNode(child), tail),
    NIL,
  ));
}

function encodePattern(term) {
  if (!Array.isArray(term)) {
    const value = String(term);
    return value.startsWith('?') && value.length > 1
      ? app(PATTERN_VARIABLE, encodeBits(value.slice(1)))
      : app(PATTERN_ATOM, encodeBits(value));
  }
  return app(PATTERN_LIST, term.reduceRight(
    (tail, child) => applyMany(CONS, encodePattern(child), tail),
    NIL,
  ));
}

function encodeRules(rules) {
  return rules.reduceRight(
    (tail, rule) => applyMany(
      CONS,
      applyMany(
        NAMED_RULE,
        encodeBits(`${rule.program}\0${rule.name}`),
        encodePattern(rule.pattern),
        encodePattern(rule.replacement),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeFacts(facts) {
  return facts.reduceRight(
    (tail, fact) => applyMany(
      CONS,
      applyMany(
        FACT,
        encodeBits(`${fact.program}\0${fact.name}`),
        encodeNode(fact.judgement),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeInputFacts(facts) {
  return encodeFacts(facts.map((judgement, index) => ({
    program: '<input>',
    name: `input-${index + 1}`,
    judgement,
  })));
}

function encodeInferences(inferences) {
  return inferences.reduceRight(
    (tail, inference) => applyMany(
      CONS,
      applyMany(
        INFERENCE,
        encodeBits(`${inference.program}\0${inference.name}`),
        inference.premises.reduceRight(
          (premiseTail, premise) => applyMany(
            CONS,
            encodePattern(premise),
            premiseTail,
          ),
          NIL,
        ),
        encodePattern(inference.conclusion),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeRebindings(rebindings) {
  return [...rebindings.entries()].reduceRight(
    (tail, [from, to]) => applyMany(
      CONS,
      applyMany(REBINDING, encodeBits(from), encodeBits(to)),
      tail,
    ),
    NIL,
  );
}

function encodeImports(imports) {
  return imports.reduceRight(
    (tail, dependency) => applyMany(
      CONS,
      applyMany(
        PROGRAM_IMPORT,
        encodeBits(dependency.program),
        encodeRebindings(dependency.rebindings),
      ),
      tail,
    ),
    NIL,
  );
}

function encodeProgram(program) {
  return applyMany(
    PROGRAM,
    encodeBits(program.name),
    encodeRules(program.rewrites),
    encodeFacts(program.facts),
    encodeInferences(program.inferences),
    encodeImports(program.uses),
  );
}

function encodePrograms(programs) {
  const values = programs instanceof Map ? [...programs.values()] : [...programs];
  return values.reduceRight(
    (tail, program) => applyMany(CONS, encodeProgram(program), tail),
    NIL,
  );
}

// Contractions one kernel call may perform unless its caller sets a budget.
const DEFAULT_MAX_CONTRACTIONS = 100_000_000;

class CombinatorRunner {
  constructor({
    disabledOperations = [],
    maxContractions = DEFAULT_MAX_CONTRACTIONS,
  } = {}) {
    this.disabledOperations = new Set(disabledOperations);
    this.maxContractions = maxContractions;
    this.contractions = 0;
    this.observedOperations = new Set();
  }

  #observe(operation) {
    if (this.disabledOperations.has(operation)) {
      throw new Error(`disabled host semantic operation ${operation}`);
    }
    this.observedOperations.add(operation);
    this.contractions += 1;
    if (this.contractions > this.maxContractions) {
      // Tagged like a reduction without a normal form, so that callers can
      // report a spent budget as a bounded outcome instead of rethrowing it.
      const error = new Error(`combinator contraction limit ${this.maxContractions} exceeded`);
      error.reductionFailure = 'contraction-limit';
      throw error;
    }
  }

  headNormalize(term) {
    let current = term;
    const arguments_ = [];
    while (true) {
      while (Array.isArray(current)) {
        arguments_.push(current[1]);
        current = current[0];
      }
      if (current === K && arguments_.length >= 2) {
        this.#observe('contract-k-link');
        current = arguments_.pop();
        arguments_.pop();
        continue;
      }
      if (current === S && arguments_.length >= 3) {
        this.#observe('contract-s-link');
        const left = arguments_.pop();
        const right = arguments_.pop();
        const argument = arguments_.pop();
        current = app(app(left, argument), app(right, argument));
        continue;
      }
      while (arguments_.length > 0) current = app(current, arguments_.pop());
      return current;
    }
  }

  decodeBoolean(term) {
    const observed = this.headNormalize(applyMany(term, 'decoded-true', 'decoded-false'));
    if (observed === 'decoded-true') return true;
    if (observed === 'decoded-false') return false;
    throw new Error('combinator output is not a boolean');
  }

  decodeBits(term) {
    const bits = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') break;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a bit list');
      }
      bits.push(this.decodeBoolean(observed[0][1]));
      current = observed[1];
    }
    if (bits.length % 8 !== 0) throw new Error('combinator atom is not byte-aligned');
    const bytes = new Uint8Array(bits.length / 8);
    for (let byte = 0; byte < bytes.length; byte += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        if (bits[byte * 8 + bit]) bytes[byte] |= 128 >> bit;
      }
    }
    return decoder.decode(bytes);
  }

  decodeList(term) {
    const output = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') return output;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a list');
      }
      output.push(this.decodeNode(observed[0][1]));
      current = observed[1];
    }
  }

  materializeList(term) {
    const output = [];
    let current = term;
    while (true) {
      const observed = this.headNormalize(applyMany(
        current,
        'decoded-nil',
        'decoded-cons',
      ));
      if (observed === 'decoded-nil') return output;
      if (!Array.isArray(observed) ||
          !Array.isArray(observed[0]) ||
          observed[0][0] !== 'decoded-cons') {
        throw new Error('combinator output is not a list');
      }
      output.push(observed[0][1]);
      current = observed[1];
    }
  }

  decodeNode(term) {
    const observed = this.headNormalize(applyMany(
      term,
      'decoded-atom',
      'decoded-list',
    ));
    if (!Array.isArray(observed)) throw new Error('combinator output is not a node');
    if (observed[0] === 'decoded-atom') return this.decodeBits(observed[1]);
    if (observed[0] === 'decoded-list') return this.decodeList(observed[1]);
    throw new Error('combinator output has an unknown node constructor');
  }

  decodeStep(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional rewrite step');
    }
    const step = this.headNormalize(applyMany(
      observed[1],
      'decoded-step',
    ));
    if (!Array.isArray(step) ||
        !Array.isArray(step[0]) ||
        step[0][0] !== 'decoded-step') {
      throw new Error('combinator output is not a rewrite step');
    }
    const [program, name] = this.decodeBits(step[1]).split('\0');
    return {
      term: this.decodeNode(step[0][1]),
      rule: { program, name },
    };
  }

  decodeProof(term) {
    const observed = this.headNormalize(app(term, 'decoded-proof'));
    if (!Array.isArray(observed) ||
        !Array.isArray(observed[0]) ||
        !Array.isArray(observed[0][0]) ||
        observed[0][0][0] !== 'decoded-proof') {
      throw new Error('combinator output is not a proof');
    }
    const [program, rule] = this.decodeBits(observed[0][0][1]).split('\0');
    return {
      judgement: this.decodeNode(observed[0][1]),
      program,
      rule,
      premises: this.materializeList(observed[1])
        .map(premise => this.decodeProof(premise)),
    };
  }

  decodeOptionalProof(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional proof');
    }
    return this.decodeProof(observed[1]);
  }

  decodeDerivation(option) {
    const observed = this.headNormalize(applyMany(
      option,
      'decoded-none',
      'decoded-some',
    ));
    if (observed === 'decoded-none') return null;
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('combinator output is not an optional derivation');
    }
    const transition = this.headNormalize(app(observed[1], 'decoded-transition'));
    if (!Array.isArray(transition) ||
        !Array.isArray(transition[0]) ||
        transition[0][0] !== 'decoded-transition') {
      throw new Error('combinator output is not an inference transition');
    }
    const derivation = this.headNormalize(app(
      transition[0][1],
      'decoded-derivation',
    ));
    if (!Array.isArray(derivation) ||
        !Array.isArray(derivation[0]) ||
        derivation[0][0] !== 'decoded-derivation') {
      throw new Error('combinator output is not a derivation');
    }
    return {
      encodedJudgement: derivation[0][1],
      encodedProof: derivation[1],
      encodedInferences: transition[1],
      judgement: this.decodeNode(derivation[0][1]),
      proof: this.decodeProof(derivation[1]),
    };
  }
}

/**
 * Execute Barker's one-name iota encoding through the residual machine.
 *
 * Iota has one surface equation, but its meaning is `λf.f S K`. Reconstructing
 * I, K, and S from iota therefore provides an executable check of expressive
 * equivalence while the observed-operation set records whether any external
 * semantic information actually disappeared.
 */
function combinatorIotaEquivalenceReport() {
  const identity = applyMany(S, K, K);
  const iota = applyMany(
    S,
    applyMany(S, identity, app(K, S)),
    app(K, K),
  );
  const derivedIdentity = app(iota, iota);
  const derivedK = app(iota, app(iota, derivedIdentity));
  const derivedS = app(iota, derivedK);
  const runner = new CombinatorRunner();
  const witnesses = [
    ['identity', app(derivedIdentity, 'iota-identity-value'), 'iota-identity-value'],
    ['discard', applyMany(derivedK, 'iota-kept-value', 'iota-discarded-value'),
      'iota-kept-value'],
    ['duplicate', applyMany(derivedS, derivedK, derivedK, 'iota-duplicated-value'),
      'iota-duplicated-value'],
  ];
  for (const [name, term, expected] of witnesses) {
    const observed = runner.headNormalize(term);
    if (observed !== expected) {
      throw new Error(`iota ${name} witness changed its baseline result`);
    }
  }
  const observedExternalOperations = [...runner.observedOperations].sort();
  return {
    schema: 'rml-basis-equivalence-witness/v1',
    candidate: 'iota',
    surfaceLaw: 'ι f -> f S K',
    surfaceLawCount: 1,
    witnessCases: witnesses.map(([name]) => name),
    baselinePreserved: true,
    observedExternalOperations,
    semanticInformationReduced: observedExternalOperations.length < 2,
  };
}

/** Execute one ordered, leftmost linked rewrite above the S/K residual basis. */
function combinatorRewriteOnce(term, rules, options = {}) {
  const runner = new CombinatorRunner(options);
  const encodedRules = rules?.encodedRules ?? encodeRules(rules);
  const output = applyMany(REWRITE_ONCE, encodedRules, encodeNode(term));
  return {
    step: runner.decodeStep(output),
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'matching',
      'substitution',
      'rule-selection-and-traversal',
    ],
  };
}

function encodedList(items) {
  return items.reduceRight(
    (tail, item) => applyMany(CONS, item, tail),
    NIL,
  );
}

function unwrapOptionalItems(runner, option, context) {
  const observed = runner.headNormalize(applyMany(
    option,
    'decoded-none',
    'decoded-some',
  ));
  if (observed === 'decoded-none') {
    throw new Error(`combinator import resolver cannot find linked-program ${context}`);
  }
  if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
    throw new Error('combinator import resolver returned an invalid result');
  }
  return encodedList(runner.materializeList(observed[1]));
}

/** Resolve ordered imports and rebinding chains above the S/K residual basis. */
function combinatorResolveRewrites(programs, name, options = {}) {
  const runner = new CombinatorRunner(options);
  const output = applyMany(
    RESOLVE_REWRITES,
    encodePrograms(programs),
    encodeBits(name),
    NIL,
  );
  return {
    encodedRules: unwrapOptionalItems(runner, output, name),
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: ['import-and-rebinding'],
  };
}

/** Build normalized declared/input facts and resolved rules for linked inference. */
function combinatorCreateProofState(programs, name, inputFacts = [], options = {}) {
  const runner = new CombinatorRunner(options);
  const encodedPrograms = encodePrograms(programs);
  const resolve = operation => unwrapOptionalItems(
    runner,
    applyMany(operation, encodedPrograms, encodeBits(name), NIL),
    name,
  );
  const encodedRules = resolve(RESOLVE_REWRITES);
  const encodedFacts = resolve(RESOLVE_FACTS);
  const encodedInferences = resolve(RESOLVE_INFERENCES);
  const declaredKnown = applyMany(ADD_FACTS, encodedFacts, NIL, encodedRules);
  const allKnown = applyMany(
    ADD_FACTS,
    encodeInputFacts(inputFacts),
    declaredKnown,
    encodedRules,
  );
  const knownItems = runner.materializeList(allKnown);
  return {
    name,
    encodedRules,
    encodedInferences,
    encodedKnown: encodedList(knownItems),
    size: knownItems.length,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'import-and-rebinding',
      'matching',
      'substitution',
      'rule-selection-and-traversal',
    ],
  };
}

/** Execute one complete linked inference transition, or report fixed point. */
function combinatorInferOnce(state, options = {}) {
  const runner = new CombinatorRunner(options);
  const output = applyMany(
    INFER_ONCE,
    state.encodedInferences,
    state.encodedKnown,
    state.encodedRules,
  );
  const derivation = runner.decodeDerivation(output);
  const result = {
    derivation: derivation === null ? null : {
      judgement: derivation.judgement,
      proof: derivation.proof,
    },
    state,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: [
      'matching',
      'substitution',
      'rule-selection-and-traversal',
      'inference-saturation',
    ],
  };
  if (derivation !== null) {
    result.state = {
      ...state,
      encodedInferences: derivation.encodedInferences,
      encodedKnown: applyMany(
        APPEND,
        state.encodedKnown,
        applyMany(CONS, applyMany(
          KNOWN,
          derivation.encodedJudgement,
          derivation.encodedProof,
        ), NIL),
      ),
      size: state.size + 1,
    };
  }
  return result;
}

/** Find an exact normalized judgement in a linked proof state. */
function combinatorFindProof(state, judgement, options = {}) {
  const runner = new CombinatorRunner(options);
  const proof = runner.decodeOptionalProof(applyMany(
    FIND_KNOWN_PROOF,
    encodeNode(judgement),
    state.encodedKnown,
  ));
  return {
    proof,
    contractions: runner.contractions,
    observedOperations: [...runner.observedOperations].sort(),
    linkedCapabilities: ['result-verification'],
  };
}

export {
  CombinatorRunner,
  DEFAULT_MAX_CONTRACTIONS,
  combinatorCreateProofState,
  combinatorFindProof,
  combinatorInferOnce,
  combinatorIotaEquivalenceReport,
  combinatorKernelSourceReport,
  combinatorResolveRewrites,
  combinatorRewriteOnce,
};
