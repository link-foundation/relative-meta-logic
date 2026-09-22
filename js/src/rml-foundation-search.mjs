import { isStructurallySame } from './rml-links.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

const ACCEPTANCE_OPERATIONS = Object.freeze([
  'load',
  'import',
  'rebind',
  'match',
  'substitute',
  'rewrite',
  'infer',
  'verify',
  'self-interpret',
]);

const DIRECT_SEMANTIC_OPERATIONS = Object.freeze([
  'compare-link-structure',
  'bind-pattern-variables',
  'substitute-bound-structures',
  'select-and-traverse-rewrite-rules',
  'resolve-and-rebind-program-imports',
  'saturate-inference-rules',
]);

const HORN_SEMANTIC_OPERATIONS = Object.freeze([
  'compare-link-structure',
  'bind-pattern-variables',
  'substitute-bound-structures',
  'insert-derived-fact',
  'schedule-horn-saturation',
]);

const NON_SEMANTIC_OPERATIONS = Object.freeze([
  'parse-linked-forms',
  'enforce-cycle-and-resource-bounds',
]);

function counterProgram() {
  return [
    ['instruction', 'q0', 'decrement-left', 'failed', 'q1'],
    ['instruction', 'q1', 'increment-left', 'q2', 'unused'],
    ['instruction', 'q2', 'decrement-left', 'q3', 'failed'],
    ['instruction', 'q3', 'decrement-right', 'failed', 'q4'],
    ['instruction', 'q4', 'increment-right', 'q5', 'unused'],
    ['instruction', 'q5', 'decrement-right', 'halt', 'failed'],
  ].reduceRight(
    (tail, instruction) => ['instructions', instruction, tail],
    ['no-instructions'],
  );
}

function expectTerm(actual, expected, context) {
  if (!isStructurallySame(actual, expected)) {
    throw new Error(
      `${context} changed: expected ${JSON.stringify(expected)}, ` +
      `received ${JSON.stringify(actual)}`,
    );
  }
}

function expectProof(result, context) {
  if (!result.ok) throw new Error(`${context} was not derivable`);
  return result.proof;
}

function runRewriteFoundation(source, executionBasis, disabledOperations = []) {
  const registry = LinkedProgramRegistry.fromRml(source, {
    executionBasis,
    disabledOperations,
  });
  const acceptance = Object.fromEntries(
    ACCEPTANCE_OPERATIONS.map(operation => [operation, false]),
  );
  acceptance.load = registry.has('foundation-search-import');

  const imported = registry.reduce(
    'foundation-search-import',
    ['measured-input', 'alpha'],
  );
  expectTerm(imported.term, ['foundation-output', 'alpha'], 'import/rebind/rewrite');
  acceptance.import = true;
  acceptance.rebind = true;
  acceptance.rewrite = true;

  const objectRule = [
    'rewrite',
    ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
    ['meta-variable', 'argument'],
  ];
  const interpreted = registry.reduce('links-meta-foundation', [
    'meta-verify',
    ['atom', 'alpha'],
    [
      'meta-rewrite',
      ['rules', objectRule, ['no-rules']],
      ['pair', ['atom', 'identity'], ['atom', 'alpha']],
    ],
  ]);
  expectTerm(interpreted.term, 'verified', 'self-interpretation');
  const metaRules = new Set(interpreted.trace.map(step => step.rule));
  for (const rule of [
    'match-variable-reference',
    'substitute-variable-reference',
    'apply-object-rule',
    'verify-object-result',
  ]) {
    if (!metaRules.has(rule)) {
      throw new Error(`self-interpretation did not execute ${rule}`);
    }
  }
  acceptance.match = true;
  acceptance.substitute = true;
  acceptance.verify = true;
  acceptance['self-interpret'] = true;

  const proof = registry.prove(
    'foundation-search-proof',
    ['foundation-derived', 'alpha'],
  );
  expectProof(proof, 'foundation inference');
  acceptance.infer = true;

  const referential = registry.reduce('guarded-referential-links', [
    'observe',
    ['guarded-link', 'proof-knot', 'pulse', 'proof-knot'],
  ]);
  expectTerm(referential.term, [
    'observation',
    'proof-knot',
    'pulse',
    ['resume', 'proof-knot'],
  ], 'guarded referential observation');
  const unguarded = registry.reduce('guarded-referential-links', [
    'observe',
    ['guarded-link', 'left-address', 'pulse', 'right-address'],
  ]);
  expectTerm(unguarded.term, [
    'observe',
    ['guarded-link', 'left-address', 'pulse', 'right-address'],
  ], 'non-referential link must not satisfy the repeated-address guard');

  const described = registry.reduce('links-meta-foundation', [
    'meta-describe',
    objectRule,
  ]);
  expectTerm(described.term, [
    'rule-description',
    ['pattern', objectRule[1]],
    ['replacement', objectRule[2]],
  ], 'self-description');

  const generated = registry.reduce('links-meta-foundation', [
    'meta-generate-and-apply',
    objectRule,
    ['pair', ['atom', 'identity'], ['atom', 'generated']],
  ]);
  expectTerm(
    generated.term,
    ['rewrite-result', ['atom', 'generated']],
    'self-generation',
  );

  const program = counterProgram();
  const machine = registry.reduce('link-register-machine', [
    'machine-start',
    program,
    'q0',
    'zero',
    'zero',
  ]);
  if (!Array.isArray(machine.term) || machine.term[0] !== 'machine-halted') {
    throw new Error('link register machine did not halt');
  }
  expectTerm(machine.term.slice(0, 3), ['machine-halted', 'zero', 'zero'],
    'two-counter simulation');
  const machineRules = new Set(machine.trace.map(step => step.rule));
  for (const instruction of [
    'execute-increment-left',
    'execute-increment-right',
    'execute-decrement-left-nonzero',
    'execute-decrement-left-zero',
    'execute-decrement-right-nonzero',
    'execute-decrement-right-zero',
  ]) {
    if (!machineRules.has(instruction)) {
      throw new Error(`two-counter simulation did not execute ${instruction}`);
    }
  }

  const javascript = registry.reduce('javascript-core', [
    'javascript-execute',
    ['counter-program', program, 'q0'],
  ]);
  const rust = registry.reduce('rust-core', [
    'rust-execute',
    ['counter-program', program, 'q0'],
  ]);
  for (const [language, result] of [['JavaScript', javascript], ['Rust', rust]]) {
    expectTerm(result.term.slice(0, 3), ['machine-halted', 'zero', 'zero'],
      `${language} counter core`);
  }
  expectProof(registry.prove('lean-dependent-core', [
    'lean-has-type',
    ['lean-lambda', 'lean-Type', ['lean-bound', 'zero']],
    ['lean-pi', 'lean-Type', 'lean-Type'],
  ]), 'Lean dependent core');
  expectProof(registry.prove('rocq-dependent-core', [
    'rocq-has-type',
    ['rocq-fun', 'rocq-Type', ['rocq-rel', 'zero']],
    ['rocq-prod', 'rocq-Type', 'rocq-Type'],
  ]), 'Rocq dependent core');

  return {
    acceptance,
    selfDescription: true,
    selfGeneration: true,
    referentialWitness: {
      technique: 'guarded proof knot',
      result: referential.term,
      safetyBoundary: 'emits one finite observation and an opaque continuation; it does not authorize circular proof evidence',
    },
    turingCompleteness: {
      model: 'two-counter Minsky machine',
      completeInstructionBasis: [
        'increment-left',
        'increment-right',
        'decrement-left-with-zero-branch',
        'decrement-right-with-zero-branch',
      ],
      executableCertificate: {
        finalCounters: ['zero', 'zero'],
        linkedTransitionSteps: machine.steps,
        exercisedInstructionFamilies: 4,
        exercisedTransitionCases: 6,
      },
      proofMethod: 'configuration encoding plus instruction-by-instruction simulation; induction on machine steps transfers every finite two-counter run to linked transitions',
      externalTheorem: 'unbounded deterministic two-counter machines are Turing complete',
    },
    languageCores: {
      javascript: 'counter-machine operational core executed',
      rust: 'counter-machine operational core executed',
      lean: 'dependent identity proof checked',
      rocq: 'dependent identity proof checked',
    },
    trace: registry.runtimeSemanticTrace(),
  };
}

const HORN_GOALS = Object.freeze({
  load: ['accepted', 'load'],
  import: ['effective-rewrite', 'foundation-horn', 'measured-input', 'foundation-output'],
  rebind: ['effective-rewrite', 'foundation-horn', 'measured-input', 'foundation-output'],
  match: ['matched', 'foundation-horn', 'foundation-output', 'alpha'],
  substitute: ['substituted', 'foundation-horn', ['foundation-output', 'alpha']],
  rewrite: ['rewritten', 'foundation-horn', ['foundation-output', 'alpha']],
  infer: ['foundation-derived', 'alpha'],
  verify: ['verified', 'foundation-horn', 'alpha'],
  'self-interpret': [
    'self-interpreted',
    'horn-self-rule',
    ['encoded-derived', 'alpha'],
  ],
});

function runHornFoundation(source, disabledOperations = []) {
  const registry = LinkedProgramRegistry.fromRml(source, {
    executionBasis: 'horn-relational',
    disabledOperations,
  });
  const acceptance = {};
  for (const operation of ACCEPTANCE_OPERATIONS) {
    expectProof(
      registry.prove('horn-link-foundation', HORN_GOALS[operation]),
      `Horn ${operation}`,
    );
    acceptance[operation] = true;
  }
  expectProof(registry.prove('horn-link-foundation', [
    'encoded-clause',
    'horn-self-rule',
    ['premise', ['encoded-known', ['meta-variable', 'value']]],
    ['conclusion', ['encoded-derived', ['meta-variable', 'value']]],
  ]), 'Horn self-description');
  expectProof(registry.prove('horn-link-foundation', [
    'generated-clause',
    'copied-clause',
    ['premise', ['encoded-known', ['meta-variable', 'value']]],
    ['conclusion', ['encoded-copied', ['meta-variable', 'value']]],
  ]), 'Horn self-generation');
  const machineProof = expectProof(registry.prove('horn-link-foundation', [
    'turing-completeness-witness',
    'two-counter-machine',
    'zero',
    'zero',
  ]), 'Horn two-counter simulation');
  const machineProofRules = proofRules(machineProof);
  for (const transition of [
    'execute-counter-increment-left',
    'execute-counter-increment-right',
    'execute-counter-decrement-left',
    'execute-counter-decrement-left-zero',
    'execute-counter-decrement-right',
    'execute-counter-decrement-right-zero',
  ]) {
    if (!machineProofRules.has(transition)) {
      throw new Error(`Horn two-counter witness missed ${transition}`);
    }
  }
  const referentialProof = expectProof(registry.prove('horn-link-foundation', [
    'guarded-observation',
    'proof-knot',
    'pulse',
    ['resume', 'proof-knot'],
  ]), 'Horn guarded referential observation');
  if (registry.prove('horn-link-foundation', [
    'guarded-observation',
    'left-address',
    'pulse',
    ['resume', 'right-address'],
  ]).ok) {
    throw new Error('Horn repeated-address guard accepted unequal addresses');
  }
  for (const language of ['javascript', 'rust']) {
    expectProof(registry.prove('horn-link-foundation', [
      'language-core-executes',
      language,
      'two-counter-machine',
    ]), `Horn ${language} counter core`);
  }
  expectProof(registry.prove('horn-link-foundation', [
    'dependent-identity-checks',
    'lean',
    ['lean-lambda', 'lean-Type', ['lean-bound', 'zero']],
    ['lean-pi', 'lean-Type', 'lean-Type'],
  ]), 'Horn Lean dependent core');
  expectProof(registry.prove('horn-link-foundation', [
    'dependent-identity-checks',
    'rocq',
    ['rocq-fun', 'rocq-Type', ['rocq-rel', 'zero']],
    ['rocq-prod', 'rocq-Type', 'rocq-Type'],
  ]), 'Horn Rocq dependent core');

  return {
    acceptance,
    selfDescription: true,
    selfGeneration: true,
    referentialWitness: {
      technique: 'guarded proof knot',
      result: referentialProof.judgement,
      safetyBoundary: 'the repeated address is unified before a finite observation is derived; circular proof evidence remains invalid',
    },
    turingCompleteness: {
      model: 'two-counter Minsky machine encoded as Horn facts',
      completeInstructionBasis: [
        'increment-left',
        'increment-right',
        'decrement-left-with-zero-branch',
        'decrement-right-with-zero-branch',
      ],
      executableCertificate: {
        finalCounters: ['zero', 'zero'],
        proofRule: machineProof.rule,
        proofDepth: proofDepth(machineProof),
        exercisedInstructionFamilies: 4,
        exercisedTransitionCases: 6,
      },
      proofMethod: 'each instruction fact and configuration fact entails exactly the corresponding successor relation; induction on derivation length simulates the machine run',
      externalTheorem: 'unbounded deterministic two-counter machines are Turing complete',
    },
    languageCores: {
      javascript: 'counter-machine operational core checked relationally',
      rust: 'counter-machine operational core checked relationally',
      lean: 'dependent identity proof derived relationally',
      rocq: 'dependent identity proof derived relationally',
    },
    trace: registry.runtimeSemanticTrace(),
  };
}

function proofDepth(proof) {
  return 1 + Math.max(0, ...proof.premises.map(proofDepth));
}

function proofRules(proof, output = new Set()) {
  output.add(proof.rule);
  for (const premise of proof.premises) proofRules(premise, output);
  return output;
}

function removalExperiments(source, mechanism, operations) {
  return operations.map(operation => {
    try {
      if (mechanism === 'horn-relational') {
        runHornFoundation(source, [operation]);
      } else {
        runRewriteFoundation(source, mechanism, [operation]);
      }
      return {
        operation,
        classification: 'DERIVABLE',
        baselinePreserved: true,
        observedFailure: '',
      };
    } catch (error) {
      return {
        operation,
        classification: 'INDEPENDENT_FOR_CANDIDATE_WORKLOAD',
        baselinePreserved: false,
        observedFailure: String(error.message),
      };
    }
  });
}

function assertCompleteAcceptance(result, candidate) {
  const missing = ACCEPTANCE_OPERATIONS.filter(operation => !result.acceptance[operation]);
  if (missing.length > 0) {
    throw new Error(`${candidate} missed acceptance operations: ${missing.join(', ')}`);
  }
}

function trustCoverage(trace, semanticOperations) {
  const documented = new Set([...semanticOperations, ...NON_SEMANTIC_OPERATIONS]);
  const undocumentedOperations = trace.observedOperations
    .filter(operation => !documented.has(operation));
  return {
    observedPaths: trace.observedPaths.length,
    observedOperations: trace.observedOperations.length,
    undocumentedAuthorityPaths: undocumentedOperations,
    complete: undocumentedOperations.length === 0,
  };
}

function candidateRecord({
  id,
  title,
  semanticMechanism,
  representation,
  primitiveLaws,
  transitionMechanism,
  authority,
  provenance,
  hostBoundary,
  formationBoundary,
  controlBoundary,
  selfDescription,
  selfInterpretation,
  selfGeneration,
  run,
  removal,
  hostSelfDuplication,
  externalSemanticSources,
}) {
  assertCompleteAcceptance(run, id);
  const coverage = trustCoverage(run.trace, primitiveLaws.map(law => law.id));
  if (!coverage.complete) {
    throw new Error(`${id} has undocumented authority: ${coverage.undocumentedAuthorityPaths}`);
  }
  const linkedCapabilities = ACCEPTANCE_OPERATIONS.length;
  const hostCapabilities = hostSelfDuplication;
  return {
    candidate: id,
    title,
    classification: 'ACCEPTED_FOR_EXECUTABLE_SCOPE',
    semanticMechanism,
    representation,
    primitiveSemanticLaws: primitiveLaws,
    transitionMechanism,
    transitionAuthority: authority,
    sourceProvenance: provenance,
    hostRuntimeBoundary: hostBoundary,
    formationAdmissibilityBoundary: formationBoundary,
    executionControlBoundary: controlBoundary,
    selfDescriptionMechanism: selfDescription,
    selfInterpretationMechanism: selfInterpretation,
    selfGenerationMechanism: selfGeneration,
    referentialWitness: run.referentialWitness,
    externalSemanticInformation: primitiveLaws.length,
    derivedSemanticInformation: ACCEPTANCE_OPERATIONS,
    objectSpecificHostKnowledge: [],
    acceptanceWorkload: run.acceptance,
    turingCompleteness: run.turingCompleteness,
    languageCores: run.languageCores ?? null,
    measurements: {
      independentExternalSemanticInformation: removal
        .filter(experiment => !experiment.baselinePreserved).length,
      hostSemanticOperations: primitiveLaws.length,
      externalSemanticSourceDescriptions: externalSemanticSources,
      hostSelfSemanticDuplication: hostSelfDuplication,
      selfHostingClosure: {
        linkedCapabilities,
        hostCapabilities,
        ratio: `${linkedCapabilities}/${linkedCapabilities + hostCapabilities}`,
      },
      foundationCompression: `${primitiveLaws.length}/8`,
      runtimeTrustCoverage: coverage,
      objectSpecificHostSemantics: 0,
      undocumentedAuthorityPaths: coverage.undocumentedAuthorityPaths,
    },
    eliminationExperiments: removal,
    equivalentTo: null,
    equivalenceStatus: 'NOT_CLAIMED_WITHOUT_EXECUTABLE_BISIMULATION',
    rejectedBecause: null,
  };
}

/**
 * Execute three independently sourced semantic mechanisms and return their
 * architecture-neutral comparison.  Success establishes the finite workload
 * and universal-machine simulation, not global minimality or implementation
 * of complete production language ecosystems.
 */
function foundationSearchReport(universalSource, alternativeSource) {
  const source = `${universalSource}\n${alternativeSource}`;
  const candidateA = runRewriteFoundation(source, 's-k');
  const candidateB = runRewriteFoundation(source, 'direct-structural');
  const candidateC = runHornFoundation(source);
  const aOperations = [
    { id: 'contract-s-link', law: 'S x y z -> x z (y z)' },
    { id: 'contract-k-link', law: 'K x y -> x' },
  ];
  const bOperations = DIRECT_SEMANTIC_OPERATIONS.map(id => ({
    id,
    law: `direct structural ${id}`,
  }));
  const cOperations = HORN_SEMANTIC_OPERATIONS.map(id => ({
    id,
    law: `monotone Horn ${id}`,
  }));
  const candidates = [
    candidateRecord({
      id: 'candidate-a-closed-s-k',
      title: 'Closed linked terms over S/K contraction',
      semanticMechanism: 'normal-order contraction of closed binary-link terms',
      representation: 'addressed-doublet S/K DAG compiled from link source',
      primitiveLaws: aOperations,
      transitionMechanism: 'contract the leftmost S or K redex',
      authority: 'the two external contraction equations',
      provenance: 'externally primitive equations over a link-native addressed source',
      hostBoundary: 'S/K contraction only; linked terms define all acceptance services',
      formationBoundary: 'closed generated term plus checked source/artifact parity',
      controlBoundary: 'external contraction and resource bound',
      selfDescription: 'meta-describe linked rewrite relation',
      selfInterpretation: 'links-meta-foundation object matcher/substituter',
      selfGeneration: 'meta-generate-and-apply linked rewrite relation',
      run: candidateA,
      removal: removalExperiments(source, 's-k', aOperations.map(item => item.id)),
      hostSelfDuplication: 0,
      externalSemanticSources: 0,
    }),
    candidateRecord({
      id: 'candidate-b-direct-structural',
      title: 'Direct structural link rewriting',
      semanticMechanism: 'ordered structural pattern rewriting plus bounded saturation',
      representation: 'LiNo pattern, replacement, import, fact, and inference links',
      primitiveLaws: bOperations,
      transitionMechanism: 'match a rule at the leftmost sublink and instantiate its replacement',
      authority: 'ordered linked rules interpreted by the direct structural transition',
      provenance: 'independent pre-S/K reference mechanism retained as a falsifiable control',
      hostBoundary: 'matching, binding, instantiation, traversal, import resolution, and saturation',
      formationBoundary: 'well-bound replacement and conclusion variables; acyclic imports',
      controlBoundary: 'external leftmost order, cycle detection, and resource bounds',
      selfDescription: 'same meta-describe link rules, executed without combinators',
      selfInterpretation: 'same links-meta-foundation object interpreter, executed directly',
      selfGeneration: 'same meta-generate-and-apply link rules, executed directly',
      run: candidateB,
      removal: removalExperiments(
        source,
        'direct-structural',
        DIRECT_SEMANTIC_OPERATIONS,
      ),
      hostSelfDuplication: DIRECT_SEMANTIC_OPERATIONS.length,
      externalSemanticSources: 1,
    }),
    candidateRecord({
      id: 'candidate-c-horn-relational',
      title: 'Monotone Horn links',
      semanticMechanism: 'premise unification and monotone fixed-point fact derivation',
      representation: 'facts and Horn clauses whose predicates and terms are links',
      primitiveLaws: cOperations,
      transitionMechanism: 'insert every novel instantiated conclusion whose premises unify',
      authority: 'the clause set and monotone saturation schedule',
      provenance: 'independently designed relational semantics with no S/K transition or bracket-abstraction machinery',
      hostBoundary: 'unification, instantiation, novel-fact insertion, and fair finite saturation',
      formationBoundary: 'range-restricted Horn conclusions and explicit finite bounds',
      controlBoundary: 'external saturation rounds and fact bound',
      selfDescription: 'encoded-clause facts describe the active clause shape',
      selfInterpretation: 'interpret-encoded-clause derives an encoded conclusion',
      selfGeneration: 'clause-schema derives a new encoded clause description',
      run: candidateC,
      removal: removalExperiments(
        source,
        'horn-relational',
        HORN_SEMANTIC_OPERATIONS,
      ),
      hostSelfDuplication: HORN_SEMANTIC_OPERATIONS.length,
      externalSemanticSources: 1,
    }),
  ];
  const smallestMeasuredExternalLawCount = Math.min(
    ...candidates.map(candidate => candidate.externalSemanticInformation),
  );

  return {
    schema: 'rml-alternative-foundation-search/v1',
    question: 'What minimum semantic structure must be added to links before links can define, interpret, and execute their own meta-theory?',
    candidateDesignConstraint: 'Candidates B and C define no S/K transition or bracket-abstraction machinery and execute without the combinator source compiler; language terms remain opaque data.',
    acceptanceOperations: ACCEPTANCE_OPERATIONS,
    comparisonStatus: 'NO_GLOBAL_MINIMALITY_CLAIM',
    proofBoundary: 'The report proves the finite acceptance workload and an instruction-by-instruction simulation of the complete two-counter-machine basis. Turing completeness additionally uses the standard universality theorem for unbounded deterministic two-counter machines. It does not claim complete Lean, Rocq, Rust, or JavaScript production implementations.',
    candidates,
    conclusion: {
      smallestMeasuredExternalLawCount,
      smallestMeasuredCandidates: candidates
        .filter(candidate =>
          candidate.externalSemanticInformation === smallestMeasuredExternalLawCount)
        .map(candidate => candidate.candidate),
      globallyMinimal: false,
      pathDependenceResult: 'The same workload survives two independently sourced non-combinator mechanisms. S/K remains the smallest measured boundary in this experiment, but is not promoted to an axiom or global minimum.',
    },
  };
}

export {
  ACCEPTANCE_OPERATIONS,
  DIRECT_SEMANTIC_OPERATIONS,
  HORN_SEMANTIC_OPERATIONS,
  foundationSearchReport,
};
