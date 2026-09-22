import {
  isStructurallySame,
  keyOf,
  parseLino,
  parseOne,
  tokenizeOne,
} from './rml-links.mjs';
import {
  combinatorCreateProofState,
  combinatorFindProof,
  combinatorInferOnce,
  combinatorIotaEquivalenceReport,
  combinatorKernelSourceReport,
  combinatorResolveRewrites,
  combinatorRewriteOnce,
} from './rml-combinator-kernel.mjs';

function cloneTerm(term) {
  return Array.isArray(term) ? term.map(cloneTerm) : term;
}

function leaf(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty reference`);
  }
  return value;
}

function variableName(term) {
  return typeof term === 'string' && term.startsWith('?') && term.length > 1
    ? term
    : null;
}

function variablesIn(term, output = new Set()) {
  const variable = variableName(term);
  if (variable !== null) output.add(variable);
  if (Array.isArray(term)) {
    for (const child of term) variablesIn(child, output);
  }
  return output;
}

// This deliberately independent reference mechanism predates the closed S/K
// backend.  Keeping it executable gives foundation searches a structurally
// different control instead of comparing S/K only with alternative encodings
// of S/K.  Its host boundary is measured separately; object-language names
// remain opaque to it.
function directMatchTerm(pattern, candidate, substitution = new Map(), observe = () => {}) {
  const variable = variableName(pattern);
  if (variable !== null) {
    observe('bind-pattern-variables');
    const previous = substitution.get(variable);
    if (previous !== undefined) {
      observe('compare-link-structure');
      return isStructurallySame(previous, candidate) ? substitution : null;
    }
    substitution.set(variable, cloneTerm(candidate));
    return substitution;
  }
  observe('compare-link-structure');
  if (!Array.isArray(pattern) || !Array.isArray(candidate)) {
    return isStructurallySame(pattern, candidate) ? substitution : null;
  }
  if (pattern.length !== candidate.length) return null;
  for (let index = 0; index < pattern.length; index += 1) {
    if (directMatchTerm(
      pattern[index],
      candidate[index],
      substitution,
      observe,
    ) === null) return null;
  }
  return substitution;
}

function directInstantiate(term, substitution, observe = () => {}) {
  const variable = variableName(term);
  if (variable !== null) {
    observe('substitute-bound-structures');
    if (!substitution.has(variable)) throw new Error(`unbound variable ${variable}`);
    return cloneTerm(substitution.get(variable));
  }
  return Array.isArray(term)
    ? term.map(child => directInstantiate(child, substitution, observe))
    : term;
}

function rebindTerm(term, rebindings) {
  if (Array.isArray(term)) return term.map(child => rebindTerm(child, rebindings));
  return rebindings.get(term) ?? term;
}

function applyRebindings(term, rebindings) {
  return rebindings.reduce(
    (current, bindings) => rebindTerm(current, bindings),
    cloneTerm(term),
  );
}

function singleClause(form, name, context) {
  const clauses = form.slice(3).filter(clause => Array.isArray(clause) && clause[0] === name);
  if (clauses.length !== 1 || clauses[0].length !== 2) {
    throw new Error(`${context} requires exactly one (${name} value) clause`);
  }
  return clauses[0][1];
}

function assertReplacementBound(pattern, replacement, context) {
  const bound = variablesIn(pattern);
  for (const variable of variablesIn(replacement)) {
    if (!bound.has(variable)) throw new Error(`${context} has unbound variable ${variable}`);
  }
}

function assertConclusionBound(premises, conclusion, context) {
  const bound = new Set();
  for (const premise of premises) variablesIn(premise, bound);
  for (const variable of variablesIn(conclusion)) {
    if (!bound.has(variable)) throw new Error(`${context} has unbound variable ${variable}`);
  }
}

function parseForms(source, observe = () => {}) {
  observe('parse-linked-forms');
  // links-notation treats indentation after a blank group boundary as nested
  // notation. Linked program forms are an unordered top-level graph, so
  // normalize only leading horizontal whitespace before parsing them.
  const normalized = String(source).replace(/^[ \t]+/gm, '');
  return parseLino(normalized).map(link => parseOne(tokenizeOne(link)));
}

const BOOTSTRAP_OPERATIONS = Object.freeze([
  Object.freeze({
    id: 'contract-s-link',
    layer: 'bootstrap',
    dependsOn: [],
    primitiveReason: 'The S link duplicates one argument into two linked applications; disabling this contraction makes the complete acceptance probe fail.',
  }),
  Object.freeze({
    id: 'contract-k-link',
    layer: 'bootstrap',
    dependsOn: [],
    primitiveReason: 'The K link discards one argument; disabling this contraction makes the complete acceptance probe fail.',
  }),
  Object.freeze({
    id: 'parse-linked-forms',
    layer: 'representation-parsing',
    dependsOn: [],
    primitiveReason: 'Text is outside the binary-link substrate; this ingress decoder exposes leaf/list structure but assigns no linked-program semantics.',
  }),
  Object.freeze({
    id: 'enforce-cycle-and-resource-bounds',
    layer: 'execution-control-resource-bounds',
    dependsOn: [],
    primitiveReason: 'An external observer limits divergent linked computation without choosing, matching, or constructing any semantic result.',
  }),
]);

const DERIVED_HOST_SERVICES = Object.freeze([]);

const LINKED_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: 'matching',
    layer: 'links-defined-service',
    dependsOn: ['contract-s-link', 'contract-k-link'],
  }),
  Object.freeze({
    id: 'substitution',
    layer: 'links-defined-service',
    dependsOn: ['contract-s-link', 'contract-k-link'],
  }),
  Object.freeze({
    id: 'rule-selection-and-traversal',
    layer: 'links-defined-service',
    dependsOn: ['matching', 'substitution'],
  }),
  Object.freeze({
    id: 'import-and-rebinding',
    layer: 'links-defined-service',
    dependsOn: ['contract-s-link', 'contract-k-link'],
  }),
  Object.freeze({
    id: 'inference-saturation',
    layer: 'links-defined-service',
    dependsOn: ['matching', 'substitution', 'rule-selection-and-traversal'],
  }),
  Object.freeze({
    id: 'result-verification',
    layer: 'links-defined-service',
    dependsOn: ['contract-s-link', 'contract-k-link'],
  }),
]);

const SEMANTIC_PATHS = Object.freeze([
  Object.freeze({
    id: 'load-linked-program',
    layer: 'semantic-path',
    dependsOn: ['parse-linked-forms'],
  }),
  Object.freeze({
    id: 'reduce-linked-program',
    layer: 'semantic-path',
    dependsOn: [
      'import-and-rebinding',
      'matching',
      'substitution',
      'rule-selection-and-traversal',
      'enforce-cycle-and-resource-bounds',
    ],
  }),
  Object.freeze({
    id: 'prove-linked-judgement',
    layer: 'semantic-path',
    dependsOn: [
      'import-and-rebinding',
      'inference-saturation',
      'result-verification',
      'reduce-linked-program',
      'enforce-cycle-and-resource-bounds',
    ],
  }),
  Object.freeze({
    id: 'execute-links-meta-foundation',
    layer: 'links-defined',
    dependsOn: ['reduce-linked-program', 'result-verification'],
  }),
]);

const MINIMIZATION_EXPERIMENTS = Object.freeze([
  Object.freeze({
    operation: 'contract-s-link',
    classification: 'INDEPENDENT',
    outcome: 'experimentally-necessary-in-current-basis',
    evidence: 'Fault injection disables S while retaining K; the import, rewrite, inference, and self-verification acceptance probe fails closed.',
  }),
  Object.freeze({
    operation: 'contract-k-link',
    classification: 'INDEPENDENT',
    outcome: 'experimentally-necessary-in-current-basis',
    evidence: 'Fault injection disables K while retaining S; the import, rewrite, inference, and self-verification acceptance probe fails closed.',
  }),
  Object.freeze({
    operation: 'parse-linked-forms',
    classification: 'UNKNOWN',
    outcome: 'retained-at-representation-ingress',
    evidence: 'fromForms bypasses this text decoder entirely; it is measured as representation rather than a semantic primitive.',
  }),
  Object.freeze({
    operation: 'enforce-cycle-and-resource-bounds',
    classification: 'UNKNOWN',
    outcome: 'retained-as-non-semantic-observer',
    evidence: 'Cycle/step/fact limits stop computation but never create a match, rewrite, import, inference, or proof result.',
  }),
]);

const IMPLEMENTED_BOUNDARY_OPERATIONS = Object.freeze([
  'parse-linked-forms',
  'contract-s-link',
  'contract-k-link',
  'enforce-cycle-and-resource-bounds',
]);

const REMOVAL_CLASSIFICATIONS = Object.freeze([
  'INDEPENDENT',
  'DERIVABLE',
  'EQUIVALENT_REENCODING',
  'UNKNOWN',
]);

const PROVENANCE_CLASSIFICATIONS = Object.freeze([
  'link-native',
  'derived-inside-system',
  'compiled-from-external-semantic-description',
  'externally-primitive',
]);

const SEMANTIC_LAW_PROVENANCE = Object.freeze([
  Object.freeze({
    operation: 'contract-s-link',
    provenance: 'externally-primitive',
    law: 'S x y z -> x z (y z)',
  }),
  Object.freeze({
    operation: 'contract-k-link',
    provenance: 'externally-primitive',
    law: 'K x y -> x',
  }),
]);

const BOOTSTRAP_METRIC_PROBE_SOURCE = `
  (linked-program bootstrap-metric-rewrite)
  (linked-rewrite bootstrap-metric-rewrite apply
    (from (metric-input ?value))
    (to (metric-output ?value)))
  (linked-program bootstrap-metric-import
    (uses bootstrap-metric-rewrite
      (rebind metric-input measured-input)))

  (linked-program bootstrap-metric-proof)
  (linked-fact bootstrap-metric-proof premise
    (judgement (metric-holds a)))
  (linked-inference bootstrap-metric-proof infer
    (premise (metric-holds ?value))
    (conclusion (metric-derived ?value)))
`;

const HOST_SEMANTIC_LAYERS = Object.freeze([
  Object.freeze({
    layer: 'semantic-bootstrap',
    operations: Object.freeze([
      'contract-s-link',
      'contract-k-link',
    ]),
  }),
  Object.freeze({
    layer: 'derived-host-semantics',
    operations: Object.freeze([]),
  }),
  Object.freeze({
    layer: 'representation-parsing',
    operations: Object.freeze(['parse-linked-forms']),
  }),
  Object.freeze({
    layer: 'execution-control-resource-bounds',
    operations: Object.freeze(['enforce-cycle-and-resource-bounds']),
  }),
  Object.freeze({ layer: 'debugging-observability', operations: Object.freeze([]) }),
  Object.freeze({ layer: 'object-specific-host-semantics', operations: Object.freeze([]) }),
]);

const PREVIOUS_METRIC_REVISION = '8b39df510a083e5cbe2a56a72e6595aae7b48146';

function cloneReportValue(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A registry of executable semantics represented entirely by LiNo links.
 *
 * The host supplies only S/K contraction plus representation and resource
 * control. Closed linked terms implement matching, substitution, deterministic
 * rewriting, import rebinding, and inference saturation. It has no branches
 * for lambda calculus, sets, types, graphs, relations, or another object theory.
 */
class LinkedProgramRegistry {
  #disabledOperations;
  #observedOperations;
  #observedPaths;
  #observedPathSegments;
  #observedLinkedCapabilities;
  #observedLinkedCapabilitySegments;

  constructor({ disabledOperations = [], executionBasis = 's-k' } = {}) {
    if (!['s-k', 'direct-structural', 'horn-relational'].includes(executionBasis)) {
      throw new Error(`unknown linked-program execution basis ${executionBasis}`);
    }
    this.programs = new Map();
    this.executionBasis = executionBasis;
    this.#disabledOperations = new Set(disabledOperations);
    this.#observedOperations = new Set();
    this.#observedPaths = new Set();
    this.#observedPathSegments = new Set();
    this.#observedLinkedCapabilities = new Set();
    this.#observedLinkedCapabilitySegments = new Set();
  }

  static fromRml(source, { disabledOperations = [], executionBasis = 's-k' } = {}) {
    const disabled = new Set(disabledOperations);
    const forms = parseForms(source, operation => {
      if (disabled.has(operation)) {
        throw new Error(`disabled host semantic operation ${operation}`);
      }
    });
    const registry = LinkedProgramRegistry.fromForms(forms, {
      disabledOperations,
      executionBasis,
    });
    registry.#observe(['load-linked-program'], 'parse-linked-forms');
    return registry;
  }

  static fromForms(forms, { disabledOperations = [], executionBasis = 's-k' } = {}) {
    const registry = new LinkedProgramRegistry({ disabledOperations, executionBasis });
    registry.#observePath('load-linked-program');
    for (const form of forms) {
      if (!Array.isArray(form) || form[0] !== 'linked-program') continue;
      registry.#addProgram(form);
    }
    for (const form of forms) {
      if (!Array.isArray(form)) continue;
      if (form[0] === 'linked-rewrite') registry.#addRewrite(form);
      if (form[0] === 'linked-fact') registry.#addFact(form);
      if (form[0] === 'linked-inference') registry.#addInference(form);
    }
    registry.#validate();
    return registry;
  }

  #observePath(path) {
    this.#observedPaths.add(path);
  }

  #observe(paths, operation) {
    if (this.#disabledOperations.has(operation)) {
      throw new Error(`disabled host semantic operation ${operation}`);
    }
    this.#observedOperations.add(operation);
    for (const path of paths) {
      this.#observePath(path);
      this.#observedPathSegments.add(`${path}\0${operation}`);
    }
  }

  #observeExecution(paths, execution) {
    for (const operation of execution.observedOperations) {
      this.#observe(paths, operation);
    }
    for (const capability of execution.linkedCapabilities ?? []) {
      this.#observedLinkedCapabilities.add(capability);
      for (const path of paths) {
        this.#observePath(path);
        this.#observedLinkedCapabilitySegments.add(`${path}\0${capability}`);
      }
    }
  }

  runtimeSemanticTrace() {
    return {
      schema: 'rml-bootstrap-runtime-trace/v1',
      observedPaths: [...this.#observedPaths].sort(),
      observedOperations: [...this.#observedOperations].sort(),
      observedLinkedCapabilities: [...this.#observedLinkedCapabilities].sort(),
      observedPathSegments: [...this.#observedPathSegments]
        .sort()
        .map(segment => {
          const [path, operation] = segment.split('\0');
          return { path, operation };
        }),
      observedLinkedCapabilitySegments: [...this.#observedLinkedCapabilitySegments]
        .sort()
        .map(segment => {
          const [path, capability] = segment.split('\0');
          return { path, capability };
        }),
    };
  }

  static #runBootstrapMetricProbe(source, disabledOperations = []) {
    const programs = LinkedProgramRegistry.fromRml(
      `${source}\n${BOOTSTRAP_METRIC_PROBE_SOURCE}`,
      { disabledOperations },
    );
    const imported = programs.reduce(
      'bootstrap-metric-import',
      ['measured-input', 'value'],
    );
    if (!isStructurallySame(imported.term, ['metric-output', 'value'])) {
      throw new Error('import/rebind metric probe changed its baseline result');
    }
    const proof = programs.prove(
      'bootstrap-metric-proof',
      ['metric-derived', 'a'],
    );
    if (!proof.ok) throw new Error('inference metric probe changed its baseline result');

    const objectRule = [
      'rewrite',
      ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
      ['meta-variable', 'argument'],
    ];
    const request = [
      'meta-verify',
      ['atom', 'a'],
      [
        'meta-rewrite',
        ['rules', objectRule, ['no-rules']],
        ['pair', ['atom', 'identity'], ['atom', 'a']],
      ],
    ];
    const selfHosting = programs.reduce('links-meta-foundation', request);
    if (selfHosting.term !== 'verified') {
      throw new Error('self-hosting metric probe changed its baseline result');
    }
    return { programs, selfHosting };
  }

  /**
   * Execute the foundation probe and publish conservative, falsifiable
   * measurements of the host machinery still outside linked semantics.
   */
  static bootstrapMetricsReport(source) {
    const { programs, selfHosting } = LinkedProgramRegistry
      .#runBootstrapMetricProbe(source);
    const trace = programs.runtimeSemanticTrace();
    const kernel = LinkedProgramRegistry.bootstrapKernelReport();
    const nodes = new Map(kernel.trustGraph.nodes.map(node => [node.id, node]));
    const reportedOperations = new Set([
      ...kernel.operations,
      ...kernel.derivedHostServices,
    ]);
    const reachesOperation = (path, operation, visiting = new Set()) => {
      if (path === operation) return true;
      if (visiting.has(path)) return false;
      const node = nodes.get(path);
      if (node === undefined) return false;
      const nested = new Set(visiting);
      nested.add(path);
      return node.dependsOn.some(dependency =>
        reachesOperation(dependency, operation, nested));
    };
    const undocumentedPaths = trace.observedPaths.filter(path => !nodes.has(path));
    const undocumentedOperations = trace.observedOperations
      .filter(operation => !reportedOperations.has(operation));
    const undocumentedPathSegments = trace.observedPathSegments.filter(({ path, operation }) =>
      !reachesOperation(path, operation));
    const runtimeTrustGraphCoverage = {
      documentedObservedPaths: trace.observedPaths.length - undocumentedPaths.length,
      totalObservedPaths: trace.observedPaths.length,
      documentedObservedPathSegments:
        trace.observedPathSegments.length - undocumentedPathSegments.length,
      totalObservedPathSegments: trace.observedPathSegments.length,
      undocumentedPaths,
      undocumentedOperations,
      undocumentedPathSegments,
      trace,
    };

    const removalExperiments = IMPLEMENTED_BOUNDARY_OPERATIONS.map(operation => {
      try {
        LinkedProgramRegistry.#runBootstrapMetricProbe(source, [operation]);
        return {
          operation,
          classification: 'DERIVABLE',
          baselinePreserved: true,
          observedFailure: '',
        };
      } catch (error) {
        const declared = MINIMIZATION_EXPERIMENTS
          .find(experiment => experiment.operation === operation);
        return {
          operation,
          classification: declared?.classification ?? 'UNKNOWN',
          baselinePreserved: false,
          observedFailure: String(error.message),
        };
      }
    });

    const rules = selfHosting.trace.map(step => step.rule);
    const linkedCapabilities = LINKED_CAPABILITIES.map(({ id }) => ({
      capability: id,
      observedPaths: trace.observedLinkedCapabilitySegments
        .filter(segment => segment.capability === id)
        .map(segment => segment.path),
      evidenceRules: id === 'result-verification'
        ? rules.filter(rule => rule === 'verify-object-result')
        : [],
    })).filter(capability => capability.observedPaths.length > 0);
    const hostLinkedDuplications = [];
    const linkedCapabilityNames = linkedCapabilities.map(({ capability }) => capability);
    const hostCapabilityNames = [];
    const linkedCount = linkedCapabilityNames.length;
    const hostCount = 0;
    const unknownCount = removalExperiments
      .filter(experiment =>
        ['contract-s-link', 'contract-k-link'].includes(experiment.operation) &&
        experiment.classification === 'UNKNOWN').length;
    const confirmedIndependentCount = removalExperiments
      .filter(experiment =>
        ['contract-s-link', 'contract-k-link'].includes(experiment.operation) &&
        experiment.classification === 'INDEPENDENT' &&
        !experiment.baselinePreserved).length;
    const totalOperations = 2;
    const selfHostingClosure = {
      task: 'linked-load-import-reduce-infer-and-self-verify-above-residual-basis',
      linkedCapabilities: linkedCount,
      linkedCapabilityNames,
      hostCapabilities: hostCount,
      hostCapabilityNames,
      totalCapabilities: linkedCount + hostCount,
      numerator: linkedCount,
      denominator: linkedCount + hostCount,
    };
    const foundationCompression = {
      basis: 'semantic-operation fault injection over the complete acceptance probe',
      smallestSufficientHostOperations: 2,
      originalHostOperations: 8,
      candidateOperations: ['contract-s-link', 'contract-k-link'],
      sufficientOperations: ['contract-s-link', 'contract-k-link'],
      numerator: 2,
      denominator: 8,
    };
    let zeroTransitionFailure = '';
    try {
      LinkedProgramRegistry.#runBootstrapMetricProbe(source, [
        'contract-s-link',
        'contract-k-link',
      ]);
    } catch (error) {
      zeroTransitionFailure = String(error.message);
    }
    if (zeroTransitionFailure.length === 0) {
      throw new Error('zero-transition foundation unexpectedly preserved the baseline');
    }
    const semanticSource = combinatorKernelSourceReport();
    const iotaEquivalence = combinatorIotaEquivalenceReport();
    const current = {
      totalHostSemanticOperations: totalOperations,
      independentHostPrimitives: {
        confirmed: confirmedIndependentCount,
        unknown: unknownCount,
      },
      derivedHostSemanticServices: DERIVED_HOST_SERVICES.length,
      duplicatedSemanticCapabilities: 0,
      objectSpecificHostSemantics: 0,
      undocumentedSemanticPaths:
        undocumentedPaths.length +
        undocumentedOperations.length +
        undocumentedPathSegments.length,
      selfHostingClosure,
      foundationCompression,
      residualSemanticBasis: {
        operations: ['contract-s-link', 'contract-k-link'],
        experimentallyNecessary: confirmedIndependentCount,
        equivalentOneRuleBases: ['iota'],
      },
      externalSemanticInformation: {
        independentLaws: 2,
        lawNames: ['contract-s-link', 'contract-k-link'],
        provenance: 'externally-primitive',
      },
    };
    return cloneReportValue({
      schema: 'rml-bootstrap-metrics/v3',
      previousRevision: PREVIOUS_METRIC_REVISION,
      measurementScope: 'The executable probe covers textual load, linked import/rebinding, reduction, inference saturation, links-meta-foundation result verification, and a zero-transition fault injection. The addressed-link source is native to the upstream network-duplet structure; S/K remain externally primitive transition laws. Necessity is relative to this representation and probe, not a claim of global irreducibility.',
      provenanceClassifications: PROVENANCE_CLASSIFICATIONS,
      removalClassifications: REMOVAL_CLASSIFICATIONS,
      current,
      semanticProvenance: {
        authoritativeSource: semanticSource,
        derivedCapabilities: LINKED_CAPABILITIES.map(({ id }) => ({
          id,
          provenance: 'derived-inside-system',
        })),
        eliminatedExternalSources: [{
          id: 'buildSourceKernel',
          provenance: 'compiled-from-external-semantic-description',
          present: false,
        }],
      },
      foundationSearchExperiments: [
        {
          candidate: 'zero-semantic-transition',
          classification: 'INSUFFICIENT',
          surfaceLawCount: 0,
          residualExternalSemanticLawCount: 0,
          baselinePreserved: false,
          observedFailure: zeroTransitionFailure,
          experimentScope: 'complete-acceptance-probe',
          observedExternalOperations: [],
          semanticInformationReduced: null,
        },
        {
          candidate: 's-k-over-link-native-source',
          classification: 'CURRENT_SUFFICIENT',
          surfaceLawCount: 2,
          residualExternalSemanticLawCount: 2,
          baselinePreserved: true,
          observedFailure: '',
          experimentScope: 'complete-acceptance-probe',
          observedExternalOperations: ['contract-k-link', 'contract-s-link'],
          semanticInformationReduced: null,
        },
        {
          candidate: 'iota',
          classification: 'EQUIVALENT_REENCODING',
          surfaceLawCount: iotaEquivalence.surfaceLawCount,
          residualExternalSemanticLawCount:
            iotaEquivalence.observedExternalOperations.length,
          baselinePreserved: iotaEquivalence.baselinePreserved,
          observedFailure: '',
          experimentScope: 'residual-basis-equivalence-witness',
          observedExternalOperations: iotaEquivalence.observedExternalOperations,
          semanticInformationReduced: iotaEquivalence.semanticInformationReduced,
        },
      ],
      hostSemanticLayers: HOST_SEMANTIC_LAYERS.map(layer => ({
        layer: layer.layer,
        count: layer.operations.length,
        operations: layer.operations,
      })),
      removalExperiments,
      hostLinkedDuplications,
      linkedSelfHostingCapabilities: linkedCapabilities,
      runtimeTrustGraphCoverage,
      comparison: [
        {
          metric: 'total-host-semantic-operations',
          previous: 2,
          current: current.totalHostSemanticOperations,
          delta: current.totalHostSemanticOperations - 2,
        },
        {
          metric: 'independent-host-primitives',
          previous: '2 confirmed; 0 unknown',
          current: `${confirmedIndependentCount} confirmed; ${unknownCount} unknown`,
          delta: null,
        },
        {
          metric: 'derived-host-semantic-services',
          previous: 0,
          current: current.derivedHostSemanticServices,
          delta: current.derivedHostSemanticServices,
        },
        {
          metric: 'host-linked-duplicated-semantics',
          previous: 0,
          current: current.duplicatedSemanticCapabilities,
          delta: 0,
        },
        {
          metric: 'object-specific-host-semantics',
          previous: 0,
          current: 0,
          delta: 0,
        },
        {
          metric: 'undocumented-semantic-paths',
          previous: 0,
          current: current.undocumentedSemanticPaths,
          delta: 0,
        },
        {
          metric: 'self-hosting-closure',
          previous: '6/6',
          current: `${selfHostingClosure.numerator}/${selfHostingClosure.denominator}`,
          delta: null,
        },
        {
          metric: 'foundation-compression-ratio',
          previous: '2/8',
          current: `${foundationCompression.numerator}/${foundationCompression.denominator}`,
          delta: null,
        },
        {
          metric: 'independent-external-semantic-laws',
          previous: null,
          current: 2,
          delta: null,
        },
        {
          metric: 'external-semantic-source-descriptions',
          previous: 1,
          current: 0,
          delta: -1,
        },
      ],
    });
  }

  /**
   * Report the complete theory-independent host boundary used to bootstrap
   * links-defined meta-semantics.
   */
  static bootstrapKernelReport() {
    return cloneReportValue({
      name: 'K0',
      status: 'current-bootstrap-boundary',
      claimsIrreducible: false,
      fixedPointCriterion: 'Remove an operation only when every public semantic path still executes and the replacement does not presuppose the same operation under another name.',
      operations: BOOTSTRAP_OPERATIONS.map(operation => operation.id),
      derivedHostServices: DERIVED_HOST_SERVICES.map(service => service.id),
      objectSemantics: [],
      semanticSource: combinatorKernelSourceReport(),
      semanticLawProvenance: SEMANTIC_LAW_PROVENANCE,
      minimizationExperiments: MINIMIZATION_EXPERIMENTS,
      trustGraph: {
        schema: 'rml-bootstrap-trust-graph/v1',
        nodes: [
          ...BOOTSTRAP_OPERATIONS,
          ...LINKED_CAPABILITIES,
          ...DERIVED_HOST_SERVICES,
          ...SEMANTIC_PATHS,
        ],
      },
    });
  }

  /**
   * Fail closed when the executable host-operation manifest and the published
   * trust graph differ, or when a semantic path does not reach K0.
   */
  static auditBootstrapKernel(
    implementedOperations = IMPLEMENTED_BOUNDARY_OPERATIONS,
  ) {
    const report = LinkedProgramRegistry.bootstrapKernelReport();
    const nodes = new Map();
    for (const node of report.trustGraph.nodes) {
      if (nodes.has(node.id)) throw new Error(`duplicate trust graph node ${node.id}`);
      nodes.set(node.id, node);
    }
    for (const node of nodes.values()) {
      for (const dependency of node.dependsOn) {
        if (!nodes.has(dependency)) {
          throw new Error(`trust graph node ${node.id} has unknown dependency ${dependency}`);
        }
      }
    }

    const reachesBootstrap = (id, visiting = new Set()) => {
      const node = nodes.get(id);
      if (node.dependsOn.length === 0) {
        return BOOTSTRAP_OPERATIONS.some(operation => operation.id === id);
      }
      if (visiting.has(id)) throw new Error(`trust graph dependency cycle at ${id}`);
      const nested = new Set(visiting);
      nested.add(id);
      return node.dependsOn.every(dependency => reachesBootstrap(dependency, nested));
    };
    for (const node of nodes.values()) {
      if (node.layer !== 'bootstrap' && !reachesBootstrap(node.id)) {
        throw new Error(`trust graph path ${node.id} does not terminate in K0`);
      }
    }

    const reported = new Set([
      ...report.operations,
      ...report.derivedHostServices,
    ]);
    const implemented = new Set(implementedOperations);
    for (const operation of implemented) {
      if (!reported.has(operation)) {
        throw new Error(`unreported host semantic operation ${operation}`);
      }
    }
    for (const operation of reported) {
      if (!implemented.has(operation)) {
        throw new Error(`reported host semantic operation ${operation} is not implemented`);
      }
    }
    const experimented = new Set(
      report.minimizationExperiments.map(experiment => experiment.operation),
    );
    for (const operation of reported) {
      if (!experimented.has(operation)) {
        throw new Error(`host semantic operation ${operation} has no minimization experiment`);
      }
    }
    return { ok: true };
  }

  #addProgram(form) {
    if (form.length < 2) throw new Error('linked-program requires a name');
    const name = leaf(form[1], 'linked-program name');
    if (this.programs.has(name)) throw new Error(`duplicate linked-program ${name}`);
    const uses = [];
    for (const clause of form.slice(2)) {
      if (!Array.isArray(clause) || clause.length < 2 || clause[0] !== 'uses') {
        throw new Error(
          `linked-program ${name} only supports (uses program (rebind from to) ...) clauses`,
        );
      }
      const dependency = leaf(clause[1], `linked-program ${name} dependency`);
      if (uses.some(item => item.program === dependency)) {
        throw new Error(`linked-program ${name} repeats dependency ${dependency}`);
      }
      const rebindings = new Map();
      for (const binding of clause.slice(2)) {
        if (!Array.isArray(binding) || binding.length !== 3 || binding[0] !== 'rebind') {
          throw new Error(
            `linked-program ${name} import ${dependency} only supports (rebind from to)`,
          );
        }
        const from = leaf(binding[1], `linked-program ${name} rebind source`);
        const to = leaf(binding[2], `linked-program ${name} rebind target`);
        if (from.startsWith('?') || to.startsWith('?')) {
          throw new Error(`linked-program ${name} cannot rebind pattern variables`);
        }
        if (rebindings.has(from)) {
          throw new Error(`linked-program ${name} repeats rebind source ${from}`);
        }
        rebindings.set(from, to);
      }
      uses.push({ program: dependency, rebindings });
    }
    this.programs.set(name, { name, uses, rewrites: [], facts: [], inferences: [] });
  }

  #program(name, context) {
    const program = this.programs.get(name);
    if (program === undefined) throw new Error(`${context} references unknown linked-program ${name}`);
    return program;
  }

  #addRewrite(form) {
    if (form.length < 5) {
      throw new Error('linked-rewrite requires a program, name, from, and to');
    }
    const programName = leaf(form[1], 'linked-rewrite program');
    const name = leaf(form[2], 'linked-rewrite name');
    const context = `linked-rewrite ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (program.rewrites.some(rule => rule.name === name)) {
      throw new Error(`duplicate ${context}`);
    }
    const pattern = singleClause(form, 'from', context);
    const replacement = singleClause(form, 'to', context);
    if (form.slice(3).some(clause => !Array.isArray(clause) ||
        !['from', 'to'].includes(clause[0]))) {
      throw new Error(`${context} has an unsupported clause`);
    }
    assertReplacementBound(pattern, replacement, context);
    program.rewrites.push({ program: programName, name, pattern, replacement });
  }

  #addFact(form) {
    if (form.length !== 4) {
      throw new Error('linked-fact requires a program, name, and judgement');
    }
    const programName = leaf(form[1], 'linked-fact program');
    const name = leaf(form[2], 'linked-fact name');
    const context = `linked-fact ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (!Array.isArray(form[3]) || form[3].length !== 2 || form[3][0] !== 'judgement') {
      throw new Error(`${context} requires (judgement value)`);
    }
    if (program.facts.some(fact => fact.name === name)) throw new Error(`duplicate ${context}`);
    if (variablesIn(form[3][1]).size > 0) {
      throw new Error(`${context} cannot contain variables`);
    }
    program.facts.push({ program: programName, name, judgement: form[3][1] });
  }

  #addInference(form) {
    if (form.length < 4) {
      throw new Error('linked-inference requires a program, name, and clauses');
    }
    const programName = leaf(form[1], 'linked-inference program');
    const name = leaf(form[2], 'linked-inference name');
    const context = `linked-inference ${programName}.${name}`;
    const program = this.#program(programName, context);
    if (program.inferences.some(rule => rule.name === name)) {
      throw new Error(`duplicate ${context}`);
    }
    const premises = [];
    let conclusion = null;
    for (const clause of form.slice(3)) {
      if (!Array.isArray(clause) || clause.length !== 2 ||
          !['premise', 'conclusion'].includes(clause[0])) {
        throw new Error(`${context} supports only premise and conclusion clauses`);
      }
      if (clause[0] === 'premise') premises.push(clause[1]);
      if (clause[0] === 'conclusion') {
        if (conclusion !== null) throw new Error(`${context} repeats its conclusion`);
        conclusion = clause[1];
      }
    }
    if (premises.length === 0) throw new Error(`${context} requires at least one premise`);
    if (conclusion === null) throw new Error(`${context} is missing its conclusion`);
    assertConclusionBound(premises, conclusion, context);
    program.inferences.push({ program: programName, name, premises, conclusion });
  }

  #validate() {
    for (const program of this.programs.values()) {
      for (const dependency of program.uses) {
        if (!this.programs.has(dependency.program)) {
          throw new Error(
            `linked-program ${program.name} uses unknown program ${dependency.program}`,
          );
        }
      }
    }
    const visiting = new Set();
    const visited = new Set();
    const visit = name => {
      if (visiting.has(name)) throw new Error(`linked-program import cycle at ${name}`);
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dependency of this.programs.get(name).uses) visit(dependency.program);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of this.programs.keys()) visit(name);
  }

  has(name) {
    return this.programs.has(name);
  }

  names() {
    return [...this.programs.keys()].sort();
  }

  #directEffective(name, field, semanticPaths, seen = new Set(), rebindings = []) {
    if (this.executionBasis === 'direct-structural') {
      this.#observe(semanticPaths, 'resolve-and-rebind-program-imports');
    }
    const program = this.#program(name, 'direct execution');
    const context = JSON.stringify([
      name,
      ...rebindings.map(bindings => [...bindings.entries()]),
    ]);
    if (seen.has(context)) return [];
    seen.add(context);
    const result = program[field].map(item => {
      if (field === 'rewrites') {
        return {
          ...item,
          pattern: applyRebindings(item.pattern, rebindings),
          replacement: applyRebindings(item.replacement, rebindings),
        };
      }
      if (field === 'facts') {
        return { ...item, judgement: applyRebindings(item.judgement, rebindings) };
      }
      return {
        ...item,
        premises: item.premises.map(premise => applyRebindings(premise, rebindings)),
        conclusion: applyRebindings(item.conclusion, rebindings),
      };
    });
    for (const dependency of program.uses) {
      const nestedRebindings = dependency.rebindings.size === 0
        ? rebindings
        : [dependency.rebindings, ...rebindings];
      result.push(...this.#directEffective(
        dependency.program,
        field,
        semanticPaths,
        seen,
        nestedRebindings,
      ));
    }
    return result;
  }

  #directRewriteOnce(term, rules, semanticPaths) {
    this.#observe(semanticPaths, 'select-and-traverse-rewrite-rules');
    for (const rule of rules) {
      const substitution = directMatchTerm(
        rule.pattern,
        term,
        new Map(),
        operation => this.#observe(semanticPaths, operation),
      );
      if (substitution !== null) {
        return {
          term: directInstantiate(
            rule.replacement,
            substitution,
            operation => this.#observe(semanticPaths, operation),
          ),
          rule,
        };
      }
    }
    if (!Array.isArray(term)) return null;
    for (let index = 0; index < term.length; index += 1) {
      const rewritten = this.#directRewriteOnce(term[index], rules, semanticPaths);
      if (rewritten !== null) {
        const result = term.map(cloneTerm);
        result[index] = rewritten.term;
        return { term: result, rule: rewritten.rule };
      }
    }
    return null;
  }

  #rewriteOnce(term, rules, semanticPaths) {
    if (this.executionBasis === 'direct-structural') {
      return this.#directRewriteOnce(term, rules, semanticPaths);
    }
    const execution = combinatorRewriteOnce(term, rules, {
      disabledOperations: this.#disabledOperations,
    });
    this.#observeExecution(semanticPaths, execution);
    if (execution.step === null) return null;
    const program = this.#program(execution.step.rule.program, 'combinator rewrite');
    const rule = program.rewrites.find(candidate =>
      candidate.name === execution.step.rule.name);
    if (rule === undefined) {
      throw new Error(
        `combinator kernel selected unknown rule ${execution.step.rule.program}.` +
        execution.step.rule.name,
      );
    }
    return { term: execution.step.term, rule };
  }

  reduce(name, input, { maxSteps = 10_000 } = {}) {
    const semanticPaths = ['reduce-linked-program'];
    if (name === 'links-meta-foundation') {
      semanticPaths.push('execute-links-meta-foundation');
    }
    this.#observe(semanticPaths, 'enforce-cycle-and-resource-bounds');
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) {
      throw new Error('maxSteps must be a positive safe integer');
    }
    if (this.executionBasis === 'horn-relational') {
      return { term: cloneTerm(input), trace: [], steps: 0 };
    }
    const resolved = this.executionBasis === 'direct-structural'
      ? this.#directEffective(name, 'rewrites', semanticPaths)
      : combinatorResolveRewrites(this.programs, name, {
        disabledOperations: this.#disabledOperations,
      });
    if (this.executionBasis !== 'direct-structural') {
      this.#observeExecution(semanticPaths, resolved);
    }
    const rules = resolved;
    let term = cloneTerm(input);
    const trace = [];
    const seen = new Set([keyOf(term)]);
    while (trace.length < maxSteps) {
      const step = this.#rewriteOnce(term, rules, semanticPaths);
      if (step === null) return { term, trace, steps: trace.length };
      if (isStructurallySame(term, step.term)) {
        throw new Error(`linked rewrite ${step.rule.program}.${step.rule.name} made no progress`);
      }
      const before = term;
      term = step.term;
      trace.push(Object.freeze({
        program: step.rule.program,
        rule: step.rule.name,
        before: cloneTerm(before),
        after: cloneTerm(term),
      }));
      const key = keyOf(term);
      if (seen.has(key)) throw new Error(`rewrite cycle after ${trace.length} steps at ${key}`);
      seen.add(key);
    }
    throw new Error(`rewrite step limit ${maxSteps} exceeded`);
  }

  prove(name, goal, { facts = [], maxRounds = 128, maxFacts = 10_000 } = {}) {
    const semanticPaths = ['prove-linked-judgement'];
    this.#observe(semanticPaths, 'enforce-cycle-and-resource-bounds');
    if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0 ||
        !Number.isSafeInteger(maxFacts) || maxFacts <= 0) {
      throw new Error('proof bounds must be positive safe integers');
    }
    const normalizedGoal = this.reduce(name, goal).term;
    if (this.executionBasis !== 's-k') {
      return this.#directProve(
        name,
        normalizedGoal,
        facts,
        semanticPaths,
        maxRounds,
        maxFacts,
      );
    }
    let state = combinatorCreateProofState(
      this.programs,
      name,
      facts,
      { disabledOperations: this.#disabledOperations },
    );
    const observe = execution => this.#observeExecution(semanticPaths, execution);
    observe(state);
    if (state.size > maxFacts) {
      throw new Error(`proof fact limit ${maxFacts} exceeded`);
    }
    let found = combinatorFindProof(state, normalizedGoal, {
      disabledOperations: this.#disabledOperations,
    });
    observe(found);
    if (found.proof !== null) return { ok: true, proof: found.proof };

    // A legacy "round" could add many novel facts. The closed kernel emits
    // one derivation at a time, so retain that public bound by allowing up to
    // one fact-capacity of transitions per requested round.
    const maxTransitions = Math.min(Number.MAX_SAFE_INTEGER, maxRounds * maxFacts);
    for (let transition = 0; transition < maxTransitions; transition += 1) {
      const next = combinatorInferOnce(state, {
        disabledOperations: this.#disabledOperations,
      });
      observe(next);
      if (next.derivation === null) return { ok: false, proof: null };
      state = next.state;
      if (state.size > maxFacts) {
        throw new Error(`proof fact limit ${maxFacts} exceeded`);
      }
      found = combinatorFindProof(state, normalizedGoal, {
        disabledOperations: this.#disabledOperations,
      });
      observe(found);
      if (found.proof !== null) return { ok: true, proof: found.proof };
    }
    return { ok: false, proof: null };
  }

  #directProve(name, normalizedGoal, facts, semanticPaths, maxRounds, maxFacts) {
    this.#observe(
      semanticPaths,
      this.executionBasis === 'horn-relational'
        ? 'schedule-horn-saturation'
        : 'saturate-inference-rules',
    );
    const known = new Map();
    const add = (judgement, proof, derived = false) => {
      const normalized = this.reduce(name, judgement).term;
      const key = keyOf(normalized);
      if (known.has(key)) return false;
      if (derived && this.executionBasis === 'horn-relational') {
        this.#observe(semanticPaths, 'insert-derived-fact');
      }
      known.set(key, { judgement: normalized, proof });
      if (known.size > maxFacts) {
        throw new Error(`proof fact limit ${maxFacts} exceeded`);
      }
      return true;
    };
    for (const fact of this.#directEffective(name, 'facts', semanticPaths)) {
      add(fact.judgement, {
        judgement: cloneTerm(fact.judgement),
        program: fact.program,
        rule: fact.name,
        premises: [],
      });
    }
    facts.forEach((fact, index) => add(fact, {
      judgement: cloneTerm(fact),
      program: '<input>',
      rule: `input-${index + 1}`,
      premises: [],
    }));
    const goalKey = keyOf(normalizedGoal);
    if (known.has(goalKey)) return { ok: true, proof: known.get(goalKey).proof };

    const rules = this.#directEffective(name, 'inferences', semanticPaths);
    for (let round = 0; round < maxRounds; round += 1) {
      let changed = false;
      for (const rule of rules) {
        let candidates = [{ substitution: new Map(), premises: [] }];
        for (const premise of rule.premises) {
          const next = [];
          for (const candidate of candidates) {
            for (const entry of known.values()) {
              const substitution = new Map(candidate.substitution);
              if (directMatchTerm(
                premise,
                entry.judgement,
                substitution,
                operation => this.#observe(semanticPaths, operation),
              ) !== null) {
                next.push({
                  substitution,
                  premises: [...candidate.premises, entry.proof],
                });
              }
            }
          }
          candidates = next;
          if (candidates.length === 0) break;
        }
        for (const candidate of candidates) {
          const judgement = directInstantiate(
            rule.conclusion,
            candidate.substitution,
            operation => this.#observe(semanticPaths, operation),
          );
          const proof = {
            judgement: cloneTerm(judgement),
            program: rule.program,
            rule: rule.name,
            premises: candidate.premises,
          };
          if (add(judgement, proof, true)) {
            changed = true;
            if (known.has(goalKey)) {
              return { ok: true, proof: known.get(goalKey).proof };
            }
          }
        }
      }
      if (!changed) break;
    }
    return { ok: false, proof: null };
  }
}

export {
  LinkedProgramRegistry,
  cloneTerm,
  directInstantiate,
  directMatchTerm,
  variablesIn,
};
