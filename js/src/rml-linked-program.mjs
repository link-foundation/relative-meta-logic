import {
  isStructurallySame,
  keyOf,
  parseLino,
  parseOne,
  tokenizeOne,
} from './rml-links.mjs';

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

function matchTerm(pattern, candidate, substitution = new Map(), observe = () => {}) {
  observe('compare-link-structure');
  observe('bind-pattern-variables');
  const variable = variableName(pattern);
  if (variable !== null) {
    const previous = substitution.get(variable);
    if (previous !== undefined) {
      return isStructurallySame(previous, candidate) ? substitution : null;
    }
    substitution.set(variable, cloneTerm(candidate));
    return substitution;
  }
  if (!Array.isArray(pattern) || !Array.isArray(candidate)) {
    return isStructurallySame(pattern, candidate) ? substitution : null;
  }
  if (pattern.length !== candidate.length) return null;
  for (let index = 0; index < pattern.length; index += 1) {
    if (matchTerm(pattern[index], candidate[index], substitution, observe) === null) return null;
  }
  return substitution;
}

function instantiate(term, substitution, observe = () => {}) {
  observe('substitute-bound-structures');
  const variable = variableName(term);
  if (variable !== null) {
    if (!substitution.has(variable)) throw new Error(`unbound variable ${variable}`);
    return cloneTerm(substitution.get(variable));
  }
  return Array.isArray(term)
    ? term.map(child => instantiate(child, substitution, observe))
    : term;
}

function rebindTerm(term, rebindings) {
  if (Array.isArray(term)) return term.map(child => rebindTerm(child, rebindings));
  return rebindings.get(term) ?? term;
}

function applyRebindings(term, rebindings) {
  let result = cloneTerm(term);
  for (const bindings of rebindings) result = rebindTerm(result, bindings);
  return result;
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
    id: 'parse-linked-forms',
    layer: 'bootstrap',
    dependsOn: [],
    primitiveReason: 'Text is outside the links substrate; one ingress operation must expose its leaf/list structure before any linked rule can run.',
  }),
  Object.freeze({
    id: 'compare-link-structure',
    layer: 'bootstrap',
    dependsOn: [],
    primitiveReason: 'Rule activation and cycle observation require an initial decision about exact leaf/list identity; an encoded equality rule still needs this decision to activate.',
  }),
  Object.freeze({
    id: 'bind-pattern-variables',
    layer: 'bootstrap',
    dependsOn: ['compare-link-structure'],
    primitiveReason: 'A parameterized linked rule cannot activate until sublinks are associated with its variables; the K1 matcher is itself activated by this association.',
  }),
  Object.freeze({
    id: 'substitute-bound-structures',
    layer: 'bootstrap',
    dependsOn: ['bind-pattern-variables'],
    primitiveReason: 'An activated rule needs one operation that constructs its next linked state from the bindings; the K1 substitution relation is executed by that same transition.',
  }),
  Object.freeze({
    id: 'select-and-traverse-rewrite-rules',
    layer: 'bootstrap',
    dependsOn: ['bind-pattern-variables', 'substitute-bound-structures'],
    primitiveReason: 'Links do not execute themselves; a deterministic transition clock must select a rule and a sublink at which to attempt activation.',
  }),
  Object.freeze({
    id: 'enforce-cycle-and-resource-bounds',
    layer: 'bootstrap',
    dependsOn: ['compare-link-structure'],
    primitiveReason: 'Arbitrary user rules may diverge, so an observer outside those rules must bound execution and report repeated states without assigning object meaning.',
  }),
]);

const DERIVED_HOST_SERVICES = Object.freeze([
  Object.freeze({
    id: 'resolve-and-rebind-program-imports',
    layer: 'derived-host-service',
    dependsOn: ['compare-link-structure', 'substitute-bound-structures'],
  }),
  Object.freeze({
    id: 'saturate-inference-rules',
    layer: 'derived-host-service',
    dependsOn: [
      'bind-pattern-variables',
      'substitute-bound-structures',
      'select-and-traverse-rewrite-rules',
      'enforce-cycle-and-resource-bounds',
    ],
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
      'resolve-and-rebind-program-imports',
      'select-and-traverse-rewrite-rules',
      'enforce-cycle-and-resource-bounds',
    ],
  }),
  Object.freeze({
    id: 'prove-linked-judgement',
    layer: 'semantic-path',
    dependsOn: ['saturate-inference-rules', 'reduce-linked-program'],
  }),
  Object.freeze({
    id: 'execute-links-meta-foundation',
    layer: 'links-defined',
    dependsOn: ['reduce-linked-program'],
  }),
]);

const MINIMIZATION_EXPERIMENTS = Object.freeze([
  Object.freeze({
    operation: 'parse-linked-forms',
    classification: 'UNKNOWN',
    outcome: 'retained-at-text-ingress',
    evidence: 'fromForms bypasses parsing for pre-linked input, while fromRml demonstrates that textual LiNo still needs one explicit decoder.',
  }),
  Object.freeze({
    operation: 'compare-link-structure',
    classification: 'UNKNOWN',
    outcome: 'retained-at-bootstrap-fixed-point',
    evidence: 'K1 defines object equality through repeated variables, but activating that K1 rule still requires K0 structural identity.',
  }),
  Object.freeze({
    operation: 'bind-pattern-variables',
    classification: 'UNKNOWN',
    outcome: 'retained-at-bootstrap-fixed-point',
    evidence: 'K1 self-interprets its repeated-variable matcher, but the outer K1 rewrite still requires generic K0 binding.',
  }),
  Object.freeze({
    operation: 'substitute-bound-structures',
    classification: 'UNKNOWN',
    outcome: 'retained-at-bootstrap-fixed-point',
    evidence: 'K1 self-interprets substitution, but producing the next K1 state still requires generic K0 template instantiation.',
  }),
  Object.freeze({
    operation: 'select-and-traverse-rewrite-rules',
    classification: 'UNKNOWN',
    outcome: 'retained-at-bootstrap-fixed-point',
    evidence: 'K1 defines object-rule selection, while K0 remains the transition clock that makes any linked rule active.',
  }),
  Object.freeze({
    operation: 'enforce-cycle-and-resource-bounds',
    classification: 'UNKNOWN',
    outcome: 'retained-as-external-observer',
    evidence: 'A user program cannot reliably bound its own divergence; mirrored cycle and step/fact-limit tests require an outside observer.',
  }),
  Object.freeze({
    operation: 'resolve-and-rebind-program-imports',
    classification: 'UNKNOWN',
    outcome: 'retained-host-implementation',
    evidence: 'The service is composed from structural operations, but disabling its host implementation breaks the import/rebind probe; no links-defined replacement has yet preserved the baseline.',
  }),
  Object.freeze({
    operation: 'saturate-inference-rules',
    classification: 'UNKNOWN',
    outcome: 'retained-host-implementation',
    evidence: 'The service is composed from matching, substitution, reduction, and bounds, but disabling its host implementation breaks the inference probe; no links-defined replacement has yet preserved the baseline.',
  }),
]);

const IMPLEMENTED_HOST_SEMANTIC_OPERATIONS = Object.freeze([
  'parse-linked-forms',
  'compare-link-structure',
  'bind-pattern-variables',
  'substitute-bound-structures',
  'select-and-traverse-rewrite-rules',
  'enforce-cycle-and-resource-bounds',
  'resolve-and-rebind-program-imports',
  'saturate-inference-rules',
]);

const REMOVAL_CLASSIFICATIONS = Object.freeze([
  'INDEPENDENT',
  'DERIVABLE',
  'EQUIVALENT_REENCODING',
  'UNKNOWN',
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
      'compare-link-structure',
      'bind-pattern-variables',
      'substitute-bound-structures',
      'select-and-traverse-rewrite-rules',
    ]),
  }),
  Object.freeze({
    layer: 'derived-host-semantics',
    operations: Object.freeze([
      'resolve-and-rebind-program-imports',
      'saturate-inference-rules',
    ]),
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

const PREVIOUS_METRIC_REVISION = 'e2e9f7b2a87d4b128bb736d693d5512509974860';

function cloneReportValue(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A registry of executable semantics represented entirely by LiNo links.
 *
 * The host supplies only structural matching, substitution, deterministic
 * rewriting, and finite rule saturation. It has no branches for lambda
 * calculus, sets, types, graphs, relations, or any other object theory.
 */
class LinkedProgramRegistry {
  #disabledOperations;
  #observedOperations;
  #observedPaths;
  #observedPathSegments;

  constructor({ disabledOperations = [] } = {}) {
    this.programs = new Map();
    this.#disabledOperations = new Set(disabledOperations);
    this.#observedOperations = new Set();
    this.#observedPaths = new Set();
    this.#observedPathSegments = new Set();
  }

  static fromRml(source, { disabledOperations = [] } = {}) {
    const disabled = new Set(disabledOperations);
    const forms = parseForms(source, operation => {
      if (disabled.has(operation)) {
        throw new Error(`disabled host semantic operation ${operation}`);
      }
    });
    const registry = LinkedProgramRegistry.fromForms(forms, { disabledOperations });
    registry.#observe(['load-linked-program'], 'parse-linked-forms');
    return registry;
  }

  static fromForms(forms, { disabledOperations = [] } = {}) {
    const registry = new LinkedProgramRegistry({ disabledOperations });
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

  runtimeSemanticTrace() {
    return {
      schema: 'rml-bootstrap-runtime-trace/v1',
      observedPaths: [...this.#observedPaths].sort(),
      observedOperations: [...this.#observedOperations].sort(),
      observedPathSegments: [...this.#observedPathSegments]
        .sort()
        .map(segment => {
          const [path, operation] = segment.split('\0');
          return { path, operation };
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

    const removalExperiments = IMPLEMENTED_HOST_SEMANTIC_OPERATIONS.map(operation => {
      try {
        LinkedProgramRegistry.#runBootstrapMetricProbe(source, [operation]);
        return {
          operation,
          classification: 'DERIVABLE',
          baselinePreserved: true,
          observedFailure: '',
        };
      } catch (error) {
        return {
          operation,
          classification: 'UNKNOWN',
          baselinePreserved: false,
          observedFailure: String(error.message),
        };
      }
    });

    const rules = selfHosting.trace.map(step => step.rule);
    const linkedCapabilities = [
      {
        capability: 'matching',
        evidenceRules: rules.filter(rule => rule.startsWith('match-')),
      },
      {
        capability: 'substitution',
        evidenceRules: rules.filter(rule => rule.startsWith('substitute-')),
      },
      {
        capability: 'rule-selection',
        evidenceRules: rules.filter(rule => rule.startsWith('select-')),
      },
      {
        capability: 'result-verification',
        evidenceRules: rules.filter(rule => rule === 'verify-object-result'),
      },
    ].filter(capability => capability.evidenceRules.length > 0);
    const executeOperations = new Set(trace.observedPathSegments
      .filter(segment => [
        'load-linked-program',
        'execute-links-meta-foundation',
      ].includes(segment.path))
      .map(segment => segment.operation));
    const duplicationCandidates = [
      {
        capability: 'matching',
        hostOperations: ['compare-link-structure', 'bind-pattern-variables'],
      },
      {
        capability: 'substitution',
        hostOperations: ['substitute-bound-structures'],
      },
      {
        capability: 'rule-selection',
        hostOperations: ['select-and-traverse-rewrite-rules'],
      },
    ];
    const hostLinkedDuplications = duplicationCandidates
      .filter(candidate =>
        candidate.hostOperations.every(operation => executeOperations.has(operation)) &&
        linkedCapabilities.some(linked => linked.capability === candidate.capability))
      .map(candidate => ({
        ...candidate,
        linkedEvidenceRules: linkedCapabilities
          .find(linked => linked.capability === candidate.capability).evidenceRules,
      }));
    const linkedCapabilityNames = linkedCapabilities
      .map(capability => capability.capability);
    const hostCapabilityNames = [...executeOperations].sort();
    const linkedCount = linkedCapabilityNames.length;
    const hostCount = hostCapabilityNames.length;
    const unknownCount = removalExperiments
      .filter(experiment => experiment.classification === 'UNKNOWN').length;
    const confirmedIndependentCount = removalExperiments
      .filter(experiment => experiment.classification === 'INDEPENDENT').length;
    const removableCount = removalExperiments
      .filter(experiment => experiment.baselinePreserved).length;
    const totalOperations = IMPLEMENTED_HOST_SEMANTIC_OPERATIONS.length;
    const smallestSufficient = totalOperations - removableCount;
    const selfHostingClosure = {
      task: 'textual-load-through-links-meta-foundation-verification',
      linkedCapabilities: linkedCount,
      linkedCapabilityNames,
      hostCapabilities: hostCount,
      hostCapabilityNames,
      totalCapabilities: linkedCount + hostCount,
      numerator: linkedCount,
      denominator: linkedCount + hostCount,
    };
    const sufficientOperations = removalExperiments
      .filter(experiment => !experiment.baselinePreserved)
      .map(experiment => experiment.operation);
    const foundationCompression = {
      basis: 'host-operation fault injection over the declared acceptance probe',
      smallestSufficientHostOperations: smallestSufficient,
      originalHostOperations: totalOperations,
      candidateOperations: IMPLEMENTED_HOST_SEMANTIC_OPERATIONS,
      sufficientOperations,
      numerator: smallestSufficient,
      denominator: totalOperations,
    };
    const current = {
      totalHostSemanticOperations: totalOperations,
      independentHostPrimitives: {
        confirmed: confirmedIndependentCount,
        unknown: unknownCount,
      },
      derivedHostSemanticServices: DERIVED_HOST_SERVICES.length,
      duplicatedSemanticCapabilities: hostLinkedDuplications.length,
      objectSpecificHostSemantics: 0,
      undocumentedSemanticPaths:
        undocumentedPaths.length +
        undocumentedOperations.length +
        undocumentedPathSegments.length,
      selfHostingClosure,
      foundationCompression,
    };
    return cloneReportValue({
      schema: 'rml-bootstrap-metrics/v1',
      previousRevision: PREVIOUS_METRIC_REVISION,
      measurementScope: 'The executable probe covers textual load, import/rebind reduction, inference saturation, and links-meta-foundation result verification. UNKNOWN means removal failed but no exhaustive proof of independence exists.',
      removalClassifications: REMOVAL_CLASSIFICATIONS,
      current,
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
          previous: 8,
          current: current.totalHostSemanticOperations,
          delta: current.totalHostSemanticOperations - 8,
        },
        {
          metric: 'independent-host-primitives',
          previous: null,
          current: `${confirmedIndependentCount} confirmed; ${unknownCount} unknown`,
          delta: null,
        },
        {
          metric: 'derived-host-semantic-services',
          previous: 2,
          current: current.derivedHostSemanticServices,
          delta: current.derivedHostSemanticServices - 2,
        },
        {
          metric: 'host-linked-duplicated-semantics',
          previous: null,
          current: current.duplicatedSemanticCapabilities,
          delta: null,
        },
        {
          metric: 'object-specific-host-semantics',
          previous: 0,
          current: 0,
          delta: 0,
        },
        {
          metric: 'undocumented-semantic-paths',
          previous: null,
          current: current.undocumentedSemanticPaths,
          delta: null,
        },
        {
          metric: 'self-hosting-closure',
          previous: null,
          current: `${selfHostingClosure.numerator}/${selfHostingClosure.denominator}`,
          delta: null,
        },
        {
          metric: 'foundation-compression-ratio',
          previous: null,
          current: `${foundationCompression.numerator}/${foundationCompression.denominator}`,
          delta: null,
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
      minimizationExperiments: MINIMIZATION_EXPERIMENTS,
      trustGraph: {
        schema: 'rml-bootstrap-trust-graph/v1',
        nodes: [
          ...BOOTSTRAP_OPERATIONS,
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
    implementedOperations = IMPLEMENTED_HOST_SEMANTIC_OPERATIONS,
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
      if (node.layer === 'bootstrap') return true;
      if (visiting.has(id)) throw new Error(`trust graph dependency cycle at ${id}`);
      const nested = new Set(visiting);
      nested.add(id);
      return node.dependsOn.length > 0 &&
        node.dependsOn.every(dependency => reachesBootstrap(dependency, nested));
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

  #effective(name, field, semanticPaths, seen = new Set(), rebindings = []) {
    this.#observe(semanticPaths, 'resolve-and-rebind-program-imports');
    const program = this.#program(name, 'execution');
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
      result.push(...this.#effective(
        dependency.program,
        field,
        semanticPaths,
        seen,
        nestedRebindings,
      ));
    }
    return result;
  }

  #rewriteOnce(term, rules, semanticPaths) {
    this.#observe(semanticPaths, 'select-and-traverse-rewrite-rules');
    for (const rule of rules) {
      const substitution = matchTerm(
        rule.pattern,
        term,
        new Map(),
        operation => this.#observe(semanticPaths, operation),
      );
      if (substitution !== null) {
        return {
          term: instantiate(
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
      const rewritten = this.#rewriteOnce(term[index], rules, semanticPaths);
      if (rewritten !== null) {
        const result = term.map(cloneTerm);
        result[index] = rewritten.term;
        return { term: result, rule: rewritten.rule };
      }
    }
    return null;
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
    const rules = this.#effective(name, 'rewrites', semanticPaths);
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
    this.#observe(semanticPaths, 'saturate-inference-rules');
    this.#observe(semanticPaths, 'enforce-cycle-and-resource-bounds');
    if (!Number.isSafeInteger(maxRounds) || maxRounds <= 0 ||
        !Number.isSafeInteger(maxFacts) || maxFacts <= 0) {
      throw new Error('proof bounds must be positive safe integers');
    }
    const normalizedGoal = this.reduce(name, goal).term;
    const known = new Map();
    const add = (judgement, proof) => {
      const normalized = this.reduce(name, judgement).term;
      const key = keyOf(normalized);
      if (known.has(key)) return false;
      known.set(key, { judgement: normalized, proof });
      if (known.size > maxFacts) throw new Error(`proof fact limit ${maxFacts} exceeded`);
      return true;
    };
    for (const fact of this.#effective(name, 'facts', semanticPaths)) {
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

    const rules = this.#effective(name, 'inferences', semanticPaths);
    for (let round = 0; round < maxRounds; round += 1) {
      let changed = false;
      for (const rule of rules) {
        let candidates = [{ substitution: new Map(), premises: [] }];
        for (const premise of rule.premises) {
          const next = [];
          for (const candidate of candidates) {
            for (const entry of known.values()) {
              const substitution = new Map(candidate.substitution);
              if (matchTerm(
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
          const judgement = instantiate(
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
          if (add(judgement, proof)) {
            changed = true;
            if (known.has(goalKey)) return { ok: true, proof: known.get(goalKey).proof };
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
  instantiate,
  matchTerm,
  variablesIn,
};
