/**
 * Direct, call-by-name lambda-link control for the same upper bootstrap source.
 * No bracket abstraction, S/K contraction, or object-theory host callback.
 * This is a different abstract machine, not evidence for a genuinely different
 * minimal foundation: binding/environment laws remain external authority.
 */
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';

const app = (left, right) => [left, right];
const applyMany = (head, ...arguments_) => arguments_.reduce(app, head);
const DEFAULT_MAX_TRANSITIONS = 100_000_000;
const REQUIRED_ROOTS = [
  'TRUE', 'FALSE', 'NIL', 'CONS', 'ATOM', 'LIST', 'PATTERN_VARIABLE',
  'PATTERN_ATOM', 'PATTERN_LIST', 'NAMED_RULE', 'FACT', 'INFERENCE',
  'REBINDING', 'PROGRAM_IMPORT', 'PROGRAM', 'PROOF', 'KNOWN', 'APPEND',
  'RESOLVE_REWRITES', 'RESOLVE_FACTS', 'RESOLVE_INFERENCES', 'REWRITE_ONCE',
  'ADD_FACTS', 'INFER_ONCE', 'FIND_KNOWN_PROOF',
];
export const LAMBDA_MACHINE_OPERATIONS = Object.freeze([
  'lambda-push-argument', 'lambda-bind-argument', 'lambda-resolve-variable',
  'lambda-enter-closure', 'lambda-reify-head',
]);

/** Validate an addressed source DAG. Root aliases must name earlier closed roots. */
export function parseLambdaSource(source) {
  if (typeof source !== 'string' || source.length > 16 * 1024 * 1024) {
    throw new Error('lambda source must be text of at most 16 MiB');
  }
  const forms = parseLino(source.replace(/^[ \t]+/gm, ''))
    .map(link => parseOne(tokenizeOne(link)));
  const declarations = forms.filter(form => Array.isArray(form) && form[0] === 'bootstrap-source');
  if (declarations.length !== 1 || declarations[0][1] !== 'rml.bootstrap.fixed-point') {
    throw new Error('missing or duplicate fixed-point lambda source declaration');
  }
  const clause = name => {
    const matches = declarations[0].slice(2).filter(value => Array.isArray(value) && value[0] === name);
    if (matches.length !== 1 || matches[0].length !== 2) throw new Error(`invalid lambda source ${name}`);
    return matches[0][1];
  };
  if (clause('schema') !== 'rml-lambda-link-dag-v1' ||
      clause('representation') !== 'addressed-doublet-network' ||
      clause('upstream-model') !== 'network-duplet-function') throw new Error('invalid lambda source metadata');
  const nodeCount = Number(clause('node-count'));
  const rootCount = Number(clause('root-count'));
  if (![nodeCount, rootCount].every(value => Number.isSafeInteger(value) && value > 0) ||
      nodeCount > 100_000 || rootCount > 256) throw new Error('lambda source counts exceed resource bounds');
  const descriptors = new Map();
  const rootForms = [];
  for (const form of forms) {
    if (!Array.isArray(form)) throw new Error('invalid lambda source form');
    if (form[0] === 'bootstrap-source') continue;
    if (form.length !== 3 || typeof form[1] !== 'string') throw new Error('invalid lambda source form');
    if (form[0] === 'bootstrap-source-node' && Array.isArray(form[2])) {
      if (descriptors.has(form[1])) throw new Error('duplicate lambda source node');
      descriptors.set(form[1], form[2]);
    } else if (form[0] === 'bootstrap-source-root' && typeof form[2] === 'string') rootForms.push(form);
    else throw new Error('unknown lambda source form');
  }
  if (descriptors.size !== nodeCount || rootForms.length !== rootCount) throw new Error('lambda source counts do not match');
  const nodes = new Map();
  const roots = Object.create(null);
  const free = new WeakMap();
  const materialize = (reference, visiting = new Set()) => {
    if (reference.startsWith('r')) {
      if (!Object.hasOwn(roots, reference.slice(1))) throw new Error(`unknown earlier lambda root ${reference}`);
      return roots[reference.slice(1)];
    }
    if (nodes.has(reference)) return nodes.get(reference);
    if (visiting.has(reference)) throw new Error('cyclic lambda source node');
    if (visiting.size >= 512) throw new Error('lambda source DAG depth exceeds resource bounds');
    const descriptor = descriptors.get(reference);
    if (descriptor === undefined) throw new Error(`unknown lambda source node ${reference}`);
    const nested = new Set(visiting).add(reference);
    let term;
    let variables;
    if (descriptor.length === 2 && descriptor[0] === 'variable' && typeof descriptor[1] === 'string') {
      term = { variable: descriptor[1] };
      variables = new Set([descriptor[1]]);
    } else if (descriptor.length === 3 && descriptor.every(value => typeof value === 'string') && descriptor[0] === 'lambda') {
      term = { lambda: descriptor[1], body: materialize(descriptor[2], nested) };
      variables = new Set(free.get(term.body));
      variables.delete(term.lambda);
    } else if (descriptor.length === 3 && descriptor.every(value => typeof value === 'string') && descriptor[0] === 'application') {
      term = app(materialize(descriptor[1], nested), materialize(descriptor[2], nested));
      variables = new Set([...free.get(term[0]), ...free.get(term[1])]);
    } else throw new Error('invalid lambda source expression');
    nodes.set(reference, term);
    free.set(term, variables);
    return term;
  };
  for (const [, name, reference] of rootForms) {
    if (Object.hasOwn(roots, name)) throw new Error('duplicate lambda source root');
    const term = materialize(reference);
    if (free.get(term).size !== 0) throw new Error(`unbound lambda source root ${name}`);
    roots[name] = term;
  }
  // Reject malformed unreachable nodes too, rather than hiding them in the count.
  for (const reference of descriptors.keys()) materialize(reference);
  for (const name of REQUIRED_ROOTS) if (!Object.hasOwn(roots, name)) throw new Error(`missing lambda source root ${name}`);
  return { nodeCount, rootCount, roots };
}

export function createLambdaKernel(source) {
  const parsedKernel = parseLambdaSource(source);
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

  function lambdaKernelSourceReport() {
    return {
      artifact: 'runtime-lambda-link-source', schema: 'rml-lambda-link-dag-v1',
      representation: 'addressed-doublet-network', runtimeNodes: parsedKernel.nodeCount,
      roots: parsedKernel.rootCount, bracketAbstraction: false,
    };
  }
  function lambdaTrustReport() {
    return {
      schema: 'rml-lambda-machine-trust/v1',
      classification: 'LAMBDA_SEMANTICS_IMPLEMENTATION_CONTROL',
      genuinelyDifferentFoundationEstablished: false,
      minimalityEstablished: false,
      fullImplementationClosure: false,
      machineOperations: [...LAMBDA_MACHINE_OPERATIONS],
      externalSemanticServices: [
        'call-by-name left-head application order and argument closure capture',
        'lexical lambda binding by persistent environment extension',
        'nearest-binding variable-name equality and environment lookup',
        'restoration of captured lexical environments',
        'weak-head result reification and neutral marker application',
      ],
      externalBoundaryServices: [
        'LiNo parsing, addressed DAG resolution, closed-root validation and source limits',
        'program validation and pattern-variable elaboration (leading question mark)',
        'Scott/UTF-8 input encoding and checked output/proof decoding',
        'host public-call orchestration, stopping policy and resource limits',
        'host memory allocation, JavaScript runtime/compiler and physical processor',
      ],
      linkedCapabilities: ['matching', 'substitution', 'rule-selection-and-traversal',
        'import-and-rebinding', 'inference-saturation', 'result-verification'],
      caveat: 'Necessary machine branches are not proved independent primitives. The same lambda semantics underlie the S/K compiler; no foundation ranking follows.',
    };
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

  class LambdaRunner {
    constructor({
      disabledOperations = [],
      maxTransitions = DEFAULT_MAX_TRANSITIONS,
    } = {}) {
      if (!Number.isSafeInteger(maxTransitions) || maxTransitions <= 0) {
        throw new Error('maxTransitions must be a positive safe integer');
      }
      this.disabledOperations = new Set(disabledOperations);
      this.maxTransitions = maxTransitions;
      this.transitions = 0;
      this.observedOperations = new Set();
    }

    #observe(operation) {
      if (this.disabledOperations.has(operation)) {
        throw new Error(`disabled host semantic operation ${operation}`);
      }
      this.observedOperations.add(operation);
      this.transitions += 1;
      if (this.transitions > this.maxTransitions) {
        // Tagged like a reduction without a normal form, so that callers can
        // report a spent budget as a bounded outcome instead of rethrowing it.
        const error = new Error(`lambda transition limit ${this.maxTransitions} exceeded`);
        error.reductionFailure = 'transition-limit';
        throw error;
      }
    }

    headNormalize(term) {
      let current = term;
      let environment = null;
      const arguments_ = [];
      while (true) {
        if (current?.closure !== undefined) {
          this.#observe('lambda-enter-closure');
          environment = current.environment;
          current = current.closure;
        } else if (Array.isArray(current)) {
          this.#observe('lambda-push-argument');
          arguments_.push({ closure: current[1], environment });
          current = current[0];
        } else if (current?.variable !== undefined) {
          this.#observe('lambda-resolve-variable');
          let binding = environment;
          while (binding !== null && binding.name !== current.variable) binding = binding.parent;
          if (binding === null) throw new Error(`unbound lambda variable ${current.variable}`);
          current = binding.value;
        } else if (current?.lambda !== undefined && arguments_.length > 0) {
          this.#observe('lambda-bind-argument');
          environment = { name: current.lambda, value: arguments_.pop(), parent: environment };
          current = current.body;
        } else {
          this.#observe('lambda-reify-head');
          if (current?.lambda !== undefined) current = { closure: current, environment };
          while (arguments_.length > 0) current = app(current, arguments_.pop());
          return current;
        }
      }
    }

    decodeBoolean(term) {
      const observed = this.headNormalize(applyMany(term, 'decoded-true', 'decoded-false'));
      if (observed === 'decoded-true') return true;
      if (observed === 'decoded-false') return false;
      throw new Error('lambda output is not a boolean');
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
          throw new Error('lambda output is not a bit list');
        }
        bits.push(this.decodeBoolean(observed[0][1]));
        current = observed[1];
      }
      if (bits.length % 8 !== 0) throw new Error('lambda atom is not byte-aligned');
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
          throw new Error('lambda output is not a list');
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
          throw new Error('lambda output is not a list');
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
      if (!Array.isArray(observed)) throw new Error('lambda output is not a node');
      if (observed[0] === 'decoded-atom') return this.decodeBits(observed[1]);
      if (observed[0] === 'decoded-list') return this.decodeList(observed[1]);
      throw new Error('lambda output has an unknown node constructor');
    }

    decodeStep(option) {
      const observed = this.headNormalize(applyMany(
        option,
        'decoded-none',
        'decoded-some',
      ));
      if (observed === 'decoded-none') return null;
      if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
        throw new Error('lambda output is not an optional rewrite step');
      }
      const step = this.headNormalize(applyMany(
        observed[1],
        'decoded-step',
      ));
      if (!Array.isArray(step) ||
          !Array.isArray(step[0]) ||
          step[0][0] !== 'decoded-step') {
        throw new Error('lambda output is not a rewrite step');
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
        throw new Error('lambda output is not a proof');
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
        throw new Error('lambda output is not an optional proof');
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
        throw new Error('lambda output is not an optional derivation');
      }
      const transition = this.headNormalize(app(observed[1], 'decoded-transition'));
      if (!Array.isArray(transition) ||
          !Array.isArray(transition[0]) ||
          transition[0][0] !== 'decoded-transition') {
        throw new Error('lambda output is not an inference transition');
      }
      const derivation = this.headNormalize(app(
        transition[0][1],
        'decoded-derivation',
      ));
      if (!Array.isArray(derivation) ||
          !Array.isArray(derivation[0]) ||
          derivation[0][0] !== 'decoded-derivation') {
        throw new Error('lambda output is not a derivation');
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

  /** Execute one ordered, leftmost linked rewrite on the external lambda machine. */
  function lambdaRewriteOnce(term, rules, options = {}) {
    const runner = new LambdaRunner(options);
    const encodedRules = rules?.encodedRules ?? encodeRules(rules);
    const output = applyMany(REWRITE_ONCE, encodedRules, encodeNode(term));
    return {
      step: runner.decodeStep(output),
      transitions: runner.transitions,
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
      throw new Error(`lambda import resolver cannot find linked-program ${context}`);
    }
    if (!Array.isArray(observed) || observed[0] !== 'decoded-some') {
      throw new Error('lambda import resolver returned an invalid result');
    }
    return encodedList(runner.materializeList(observed[1]));
  }

  /** Resolve ordered imports and rebinding chains on the external lambda machine. */
  function lambdaResolveRewrites(programs, name, options = {}) {
    const runner = new LambdaRunner(options);
    const output = applyMany(
      RESOLVE_REWRITES,
      encodePrograms(programs),
      encodeBits(name),
      NIL,
    );
    return {
      encodedRules: unwrapOptionalItems(runner, output, name),
      transitions: runner.transitions,
      observedOperations: [...runner.observedOperations].sort(),
      linkedCapabilities: ['import-and-rebinding'],
    };
  }

  /** Build normalized declared/input facts and resolved rules for linked inference. */
  function lambdaCreateProofState(programs, name, inputFacts = [], options = {}) {
    const runner = new LambdaRunner(options);
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
      transitions: runner.transitions,
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
  function lambdaInferOnce(state, options = {}) {
    const runner = new LambdaRunner(options);
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
      transitions: runner.transitions,
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
  function lambdaFindProof(state, judgement, options = {}) {
    const runner = new LambdaRunner(options);
    const proof = runner.decodeOptionalProof(applyMany(
      FIND_KNOWN_PROOF,
      encodeNode(judgement),
      state.encodedKnown,
    ));
    return {
      proof,
      transitions: runner.transitions,
      observedOperations: [...runner.observedOperations].sort(),
      linkedCapabilities: ['result-verification'],
    };
  }
  const result = Object.freeze({
    LambdaRunner,
    lambdaCreateProofState,
    lambdaFindProof,
    lambdaInferOnce,
    lambdaKernelSourceReport,
    lambdaTrustReport,
    lambdaResolveRewrites,
    lambdaRewriteOnce,
  });
  return result;
}

