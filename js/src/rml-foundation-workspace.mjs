/**
 * Linked foundation workspace.
 *
 * A linked foundation is a named, versioned package of ordinary linked
 * programs.  It declares each program in one role (axioms, inference,
 * typing, reduction, equality, truth, or proof), may depend on other
 * foundations, may restrict its judgements with a signature, and declares
 * how proof cycles are treated.  A linked instance imports one unchanged
 * theory into one foundation, optionally renaming the theory's constants:
 *
 *   (linked-foundation NAME (version V)
 *     (depends-on OTHER (version W))
 *     (ROLE PROGRAM) ...
 *     (signature PATTERN ...)
 *     (cycle-policy inductive | guarded-coinductive (guard PROGRAM RULE) ...))
 *   (linked-instance NAME (theory PROGRAM (rebind FROM TO) ...)
 *     (foundation NAME (version V)))
 *
 * The workspace reads these declarations as data and runs them through the
 * linked-program registry, so a logic supplied only as links executes on the
 * same public path as every other one.  Nothing here names or branches on a
 * particular logic: the roles fix only which rule kind a program may hold,
 * and the two cycle policies fix only how a proof may close a cycle.
 *
 * Every answer carries its instance, theory, foundation version,
 * assumptions, cycle policy, bounds, the host operations it observed, and
 * the rules its evidence used, so a caller can tell which results a later
 * change of a rule or an assumption affects.  Statuses keep "not derived",
 * "stopped by a bound", and "outside what the foundation supports" apart;
 * none of them is a proof that the query is false.
 */
import {
  LinkedProgramRegistry,
  cloneTerm,
  variablesIn,
} from './rml-linked-program.mjs';
import { keyOf } from './rml-links.mjs';

const PACKAGE_SCHEMA = 'rml-foundation-package/v1';
const RESULT_SCHEMA = 'rml-foundation-result/v1';
const EXECUTION_SCHEMA = 'rml-foundation-execution/v1';

// Each role admits one rule kind, so a declared role is a checked
// classification of a program rather than a label.
const ROLE_KINDS = Object.freeze({
  axioms: 'fact',
  inference: 'inference',
  typing: 'inference',
  reduction: 'rewrite',
  equality: 'rewrite',
  truth: 'rewrite',
  proof: 'rewrite',
});
const ROLES = Object.freeze(Object.keys(ROLE_KINDS));
const RULE_HEADS = Object.freeze({
  'linked-rewrite': 'rewrite',
  'linked-fact': 'fact',
  'linked-inference': 'inference',
});
const KIND_FIELDS = Object.freeze({
  rewrite: 'rewrites',
  fact: 'facts',
  inference: 'inferences',
});
// A proof-role program rewrites (refutation-of goal) to the judgement that
// refutes the goal.  When nothing rewrites it, the refutation is undefined.
const REFUTATION_HEAD = 'refutation-of';
const ADMITTED = 'admitted';
const CONSTRUCT = Symbol('foundation workspace construction');

const RESULT_STATUSES = Object.freeze([
  {
    status: 'proved',
    meaning: 'The foundation derives the query, or at least one instance of a pattern query, from the theory and the assumptions.',
    provesQuery: true,
    provesRefutation: false,
  },
  {
    status: 'refuted',
    meaning: 'The foundation derives the judgement its proof role gives as the refutation of the query and does not derive the query.',
    provesQuery: false,
    provesRefutation: true,
  },
  {
    status: 'contradictory',
    meaning: 'The foundation derives both the query and its refutation. Both proofs are reported and the foundation decides what that entails.',
    provesQuery: true,
    provesRefutation: true,
  },
  {
    status: 'unknown',
    meaning: 'Saturation reached a fixed point without deriving the query or its refutation. This is not a proof of falsity.',
    provesQuery: false,
    provesRefutation: false,
  },
  {
    status: 'exhausted',
    meaning: 'A declared bound on rounds, facts, or rewrite steps, or the contraction budget of the closed S/K kernel, stopped the work first. Nothing is established.',
    provesQuery: false,
    provesRefutation: false,
  },
  {
    status: 'unsupported',
    meaning: 'The query or an assumption is outside the foundation signature, or a rewrite cycle or stall leaves it without a normal form. Nothing is established.',
    provesQuery: false,
    provesRefutation: false,
  },
]);

function describeTerm(value) {
  if (value === undefined) return 'nothing';
  try {
    return keyOf(value);
  } catch {
    return String(value);
  }
}

function isVariable(term) {
  return typeof term === 'string' && term.length > 1 && term.startsWith('?');
}

function nameLeaf(value, context) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('?')) {
    throw new Error(`${context} must be a name, not ${describeTerm(value)}`);
  }
  return value;
}

function assertTerm(value, context) {
  if (typeof value === 'string' && value.length > 0) return;
  if (Array.isArray(value) && value.length > 0) {
    for (const child of value) assertTerm(child, context);
    return;
  }
  throw new Error(`${context} must be a non-empty link term`);
}

function positiveBound(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function foundationKey(name, version) {
  return `${name}@${version}`;
}

function ruleKey(kind, program, rule) {
  return `${kind}\0${program}\0${rule}`;
}

function leavesOf(term, output = new Set()) {
  if (Array.isArray(term)) {
    for (const child of term) leavesOf(child, output);
  } else {
    output.add(term);
  }
  return output;
}

function sortedByKey(items, key) {
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// Program names reachable through `uses`, the root first, in preorder.
function usesClosure(programs, root) {
  const order = [];
  const seen = new Set();
  const visit = name => {
    if (seen.has(name)) return;
    seen.add(name);
    order.push(name);
    for (const dependency of programs.get(name).uses) visit(dependency.program);
  };
  visit(root);
  return order;
}

function versionClause(clause, context) {
  if (!Array.isArray(clause) || clause.length !== 2 || clause[0] !== 'version') {
    throw new Error(`${context} requires (version value)`);
  }
  return nameLeaf(clause[1], `${context} version`);
}

function parseCyclePolicy(values, context) {
  const [kind, ...guards] = values;
  if (kind === 'inductive') {
    if (guards.length > 0) throw new Error(`${context} inductive cycle policy takes no guards`);
    return { kind, guards: [] };
  }
  if (kind === 'guarded-coinductive') {
    if (guards.length === 0) {
      throw new Error(`${context} guarded-coinductive cycle policy needs (guard program rule)`);
    }
    const parsed = [];
    for (const guard of guards) {
      if (!Array.isArray(guard) || guard.length !== 3 || guard[0] !== 'guard') {
        throw new Error(`${context} cycle policy guards must be (guard program rule)`);
      }
      const program = nameLeaf(guard[1], `${context} guard program`);
      const rule = nameLeaf(guard[2], `${context} guard rule`);
      if (parsed.some(item => item.program === program && item.rule === rule)) {
        throw new Error(`${context} repeats guard ${program}.${rule}`);
      }
      parsed.push({ program, rule });
    }
    return { kind, guards: parsed };
  }
  throw new Error(`${context} has unknown cycle policy ${describeTerm(kind)}`);
}

function parseFoundation(form) {
  const name = nameLeaf(form[1], 'linked-foundation name');
  const context = `linked-foundation ${name}`;
  let version = null;
  let cyclePolicy = null;
  let signature = null;
  const dependsOn = [];
  const roles = new Map();
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || typeof clause[0] !== 'string') {
      throw new Error(`${context} has an unsupported clause ${describeTerm(clause)}`);
    }
    const [head, ...values] = clause;
    if (head === 'version') {
      if (version !== null) throw new Error(`${context} repeats its version`);
      version = versionClause(clause, context);
    } else if (head === 'depends-on') {
      if (values.length < 1 || values.length > 2) {
        throw new Error(`${context} dependencies must be (depends-on name (version value))`);
      }
      const dependency = nameLeaf(values[0], `${context} dependency`);
      if (dependsOn.some(item => item.name === dependency)) {
        throw new Error(`${context} repeats dependency ${dependency}`);
      }
      dependsOn.push({
        name: dependency,
        version: values.length === 2
          ? versionClause(values[1], `${context} dependency ${dependency}`)
          : null,
      });
    } else if (Object.hasOwn(ROLE_KINDS, head)) {
      if (values.length !== 1) throw new Error(`${context} role ${head} names exactly one program`);
      if (roles.has(head)) throw new Error(`${context} repeats role ${head}`);
      roles.set(head, nameLeaf(values[0], `${context} ${head} program`));
    } else if (head === 'signature') {
      if (signature !== null) throw new Error(`${context} repeats its signature`);
      if (values.length === 0) throw new Error(`${context} signature needs at least one pattern`);
      values.forEach(pattern => assertTerm(pattern, `${context} signature pattern`));
      signature = values.map(cloneTerm);
    } else if (head === 'cycle-policy') {
      if (cyclePolicy !== null) throw new Error(`${context} repeats its cycle policy`);
      cyclePolicy = parseCyclePolicy(values, context);
    } else {
      throw new Error(`${context} has an unsupported clause ${head}`);
    }
  }
  if (version === null) throw new Error(`${context} requires (version value)`);
  if (cyclePolicy === null) throw new Error(`${context} requires (cycle-policy ...)`);
  return { name, version, dependsOn, roles, signature: signature ?? [], cyclePolicy };
}

function parseInstance(form) {
  const name = nameLeaf(form[1], 'linked-instance name');
  const context = `linked-instance ${name}`;
  let theory = null;
  let foundation = null;
  for (const clause of form.slice(2)) {
    if (!Array.isArray(clause) || clause.length < 2) {
      throw new Error(`${context} has an unsupported clause ${describeTerm(clause)}`);
    }
    if (clause[0] === 'theory') {
      if (theory !== null) throw new Error(`${context} repeats its theory`);
      const rebind = [];
      for (const binding of clause.slice(2)) {
        if (!Array.isArray(binding) || binding.length !== 3 || binding[0] !== 'rebind') {
          throw new Error(`${context} theory only supports (rebind from to)`);
        }
        const from = nameLeaf(binding[1], `${context} rebind source`);
        const to = nameLeaf(binding[2], `${context} rebind target`);
        if (rebind.some(item => item.from === from)) {
          throw new Error(`${context} repeats rebind source ${from}`);
        }
        rebind.push({ from, to });
      }
      theory = { name: nameLeaf(clause[1], `${context} theory`), rebind };
    } else if (clause[0] === 'foundation') {
      if (foundation !== null) throw new Error(`${context} repeats its foundation`);
      if (clause.length > 3) {
        throw new Error(`${context} foundation must be (foundation name (version value))`);
      }
      foundation = {
        name: nameLeaf(clause[1], `${context} foundation`),
        version: clause.length === 3 ? versionClause(clause[2], `${context} foundation`) : null,
      };
    } else {
      throw new Error(`${context} has an unsupported clause ${clause[0]}`);
    }
  }
  if (theory === null) throw new Error(`${context} requires (theory program)`);
  if (foundation === null) throw new Error(`${context} requires (foundation name)`);
  return { name, theory, reference: foundation };
}

function inferenceClauses(form, context) {
  const premises = [];
  const conclusions = [];
  for (const clause of form.slice(3)) {
    if (Array.isArray(clause) && clause.length === 2 && clause[0] === 'premise') {
      premises.push(clause[1]);
    } else if (Array.isArray(clause) && clause.length === 2 && clause[0] === 'conclusion') {
      conclusions.push(clause[1]);
    } else {
      throw new Error(`${context} is not a well-formed linked-inference`);
    }
  }
  if (premises.length === 0 || conclusions.length !== 1) {
    throw new Error(`${context} is not a well-formed linked-inference`);
  }
  return { premises, conclusion: conclusions[0] };
}

// Read every foundation and instance declaration, resolve references, and
// synthesize the linked programs that run each instance.  Checks that need
// loaded programs (role kinds, reserved names) run after the registry loads.
function planWorkspace(forms) {
  const programs = new Set();
  const rulePrograms = new Set();
  const rules = new Map();
  const foundations = new Map();
  const versions = new Map();
  const instances = new Map();
  for (const form of forms) {
    if (!Array.isArray(form)) continue;
    const [head] = form;
    if (head === 'linked-program' && typeof form[1] === 'string') programs.add(form[1]);
    if (Object.hasOwn(RULE_HEADS, head) &&
        typeof form[1] === 'string' && typeof form[2] === 'string') {
      rules.set(ruleKey(RULE_HEADS[head], form[1], form[2]), form);
    }
    if (Object.hasOwn(RULE_HEADS, head) && typeof form[1] === 'string') {
      rulePrograms.add(form[1]);
    }
    if (head === 'linked-foundation') {
      const foundation = parseFoundation(form);
      const key = foundationKey(foundation.name, foundation.version);
      if (foundations.has(key)) {
        throw new Error(
          `duplicate linked-foundation ${foundation.name} version ${foundation.version}`,
        );
      }
      foundations.set(key, foundation);
      versions.set(foundation.name, [...(versions.get(foundation.name) ?? []), foundation.version]);
    }
    if (head === 'linked-instance') {
      const instance = parseInstance(form);
      if (instances.has(instance.name)) throw new Error(`duplicate linked-instance ${instance.name}`);
      instances.set(instance.name, instance);
    }
  }

  const resolve = (reference, context) => {
    const known = versions.get(reference.name);
    if (known === undefined) {
      throw new Error(`${context} references unknown linked-foundation ${reference.name}`);
    }
    if (reference.version !== null) {
      const found = foundations.get(foundationKey(reference.name, reference.version));
      if (found === undefined) {
        throw new Error(
          `${context} references unknown linked-foundation ${reference.name} ` +
          `version ${reference.version}`,
        );
      }
      return found;
    }
    if (known.length !== 1) {
      throw new Error(
        `${context} reference to linked-foundation ${reference.name} is ambiguous ` +
        `among versions ${known.join(', ')}`,
      );
    }
    return foundations.get(foundationKey(reference.name, known[0]));
  };

  for (const foundation of foundations.values()) {
    foundation.context = `linked-foundation ${foundation.name} version ${foundation.version}`;
    foundation.dependencies = foundation.dependsOn.map(reference =>
      resolve(reference, foundation.context));
  }
  for (const foundation of foundations.values()) {
    planFoundation(foundation, programs, rules);
  }

  const synthesizedOwners = new Map();
  const synthesized = [];
  for (const instance of instances.values()) {
    const context = `linked-instance ${instance.name}`;
    instance.foundation = resolve(instance.reference, context);
    const { theory, foundation } = instance;
    if (!programs.has(theory.name)) {
      throw new Error(`${context} theory ${theory.name} is not a linked-program`);
    }
    const role = foundation.declared.get(theory.name);
    if (role !== undefined) {
      throw new Error(
        `${context} theory ${theory.name} is the ${role} program of its foundation`,
      );
    }
    instance.names = {
      program: instance.name,
      guarded: `${instance.name}--guarded`,
      signature: `${instance.name}--signature`,
      answer: `${instance.name}--answer`,
    };
    for (const name of Object.values(instance.names)) {
      if (programs.has(name) || rulePrograms.has(name)) {
        throw new Error(`${context} needs the program name ${name}, which the source already uses`);
      }
      const owner = synthesizedOwners.get(name);
      if (owner !== undefined) {
        throw new Error(
          `${context} needs the program name ${name}, which linked-instance ${owner} also needs`,
        );
      }
      synthesizedOwners.set(name, instance.name);
    }
    instance.forms = synthesizeInstance(instance);
    synthesized.push(
      ...instance.forms.program,
      ...instance.forms.guarded,
      ...instance.forms.signature,
    );
  }
  return { foundations, instances, synthesized, resolve };
}

function planFoundation(foundation, programs, rules) {
  const { context } = foundation;
  const closure = [];
  const visiting = new Set();
  const seen = new Set();
  const visit = (member, path) => {
    const key = foundationKey(member.name, member.version);
    if (visiting.has(key)) {
      throw new Error(`linked-foundation dependency cycle ${[...path, key].join(' -> ')}`);
    }
    if (seen.has(key)) return;
    seen.add(key);
    visiting.add(key);
    closure.push(member);
    for (const dependency of member.dependencies) visit(dependency, [...path, key]);
    visiting.delete(key);
  };
  visit(foundation, []);
  const versionsByName = new Map();
  for (const member of closure) {
    const other = versionsByName.get(member.name);
    if (other !== undefined && other !== member.version) {
      throw new Error(
        `${context} depends on both versions ${other} and ${member.version} of ${member.name}`,
      );
    }
    versionsByName.set(member.name, member.version);
  }

  const declared = new Map();
  const roleEntries = [];
  for (const member of closure) {
    for (const role of ROLES) {
      const program = member.roles.get(role);
      if (program === undefined) continue;
      if (!programs.has(program)) {
        throw new Error(`${member.context} ${role} program ${program} is not a linked-program`);
      }
      const previous = declared.get(program);
      if (previous === role) continue;
      if (previous !== undefined) {
        throw new Error(`${context} declares linked-program ${program} as both ${previous} and ${role}`);
      }
      declared.set(program, role);
      roleEntries.push({
        role,
        program,
        declaredBy: { name: member.name, version: member.version },
      });
    }
  }

  const signature = [];
  const patterns = new Set();
  for (const member of closure) {
    for (const pattern of member.signature) {
      const key = keyOf(pattern);
      if (patterns.has(key)) continue;
      patterns.add(key);
      signature.push(pattern);
    }
  }

  for (const guard of foundation.cyclePolicy.guards) {
    const where = `${context} guard ${guard.program}.${guard.rule}`;
    const role = declared.get(guard.program);
    if (role === undefined || ROLE_KINDS[role] !== 'inference') {
      throw new Error(`${where} must name a rule of an inference or typing program of the foundation`);
    }
    const form = rules.get(ruleKey('inference', guard.program, guard.rule));
    if (form === undefined) throw new Error(`${where} is not a linked-inference`);
    guard.clauses = inferenceClauses(form, where);
  }
  Object.assign(foundation, { closure, declared, roleEntries, signature });
}

function synthesizeInstance(instance) {
  const { foundation, names, theory } = instance;
  const program = [[
    'linked-program',
    names.program,
    ...foundation.roleEntries.map(entry => ['uses', entry.program]),
    ['uses', theory.name, ...theory.rebind.map(({ from, to }) => ['rebind', from, to])],
  ]];
  // A guarded foundation closes a cycle only through a guard: the mirror
  // program copies each guard rule with its conclusion wrapped, so a
  // wrapped judgement proves that its last step was a guard.
  const guarded = foundation.cyclePolicy.kind !== 'guarded-coinductive' ? [] : [
    ['linked-program', names.guarded, ['uses', names.program]],
    ...foundation.cyclePolicy.guards.map((guard, index) => [
      'linked-inference',
      names.guarded,
      `guard-${index + 1}`,
      ...guard.clauses.premises.map(premise => ['premise', cloneTerm(premise)]),
      ['conclusion', [names.guarded, cloneTerm(guard.clauses.conclusion)]],
    ]),
  ];
  // The signature is a separate program whose rewrites admit exactly the
  // declared judgement shapes, so checking a query is one more reduction.
  const signature = foundation.signature.length === 0 ? [] : [
    ['linked-program', names.signature],
    ...foundation.signature.map((pattern, index) => [
      'linked-rewrite',
      names.signature,
      `admit-${index + 1}`,
      ['from', [names.signature, cloneTerm(pattern)]],
      ['to', ADMITTED],
    ]),
  ];
  return { program, guarded, signature };
}

function reductionOutcome(registry, program, term, maxSteps) {
  try {
    const reduced = registry.reduce(program, term, { maxSteps });
    return { term: reduced.term, trace: reduced.trace, failure: null };
  } catch (error) {
    if (error.reductionFailure === undefined) throw error;
    return { term: null, trace: [], failure: error };
  }
}

// A spent step or contraction budget stops the work; a rewrite cycle or stall
// leaves the term without a normal form under the foundation's rules.
const EXHAUSTING_FAILURES = new Set(['rewrite-limit', 'contraction-limit']);

function failureStatus(error) {
  return EXHAUSTING_FAILURES.has(error.reductionFailure) ? 'exhausted' : 'unsupported';
}

function outcomeOf(result) {
  return JSON.stringify([
    result.status,
    result.normalized === null ? null : keyOf(result.normalized),
    (result.answers ?? []).map(answer => keyOf(answer.judgement)),
  ]);
}

/**
 * Load linked foundations, theories, and instances and answer queries in
 * them.  Build one with `FoundationWorkspace.fromRml(source)` or
 * `FoundationWorkspace.fromForms(forms)`.
 */
class FoundationWorkspace {
  #forms;
  #plan;
  #registry;
  #options;
  #instanceData;

  constructor(token, forms, plan, registry, options) {
    if (token !== CONSTRUCT) {
      throw new Error('use FoundationWorkspace.fromRml or FoundationWorkspace.fromForms');
    }
    this.#forms = forms;
    this.#plan = plan;
    this.#registry = registry;
    this.#options = options;
    this.#instanceData = new Map();
    this.executionBasis = options.executionBasis;
    this.#checkRoleKinds();
    for (const instance of plan.instances.values()) this.#data(instance);
  }

  /**
   * Parse linked source through the linked-program front end and load every
   * foundation, theory, and instance in it. `maxContractions` bounds the S/K
   * contractions of each closed kernel call that a question makes; it
   * defaults to the registry's budget.
   */
  static fromRml(source, {
    executionBasis = 's-k',
    disabledOperations = [],
    maxContractions,
  } = {}) {
    FoundationWorkspace.#requireRewriting(executionBasis);
    let forms = null;
    let plan = null;
    const registry = LinkedProgramRegistry.fromRml(source, {
      executionBasis,
      disabledOperations,
      maxContractions,
      expandForms: parsed => {
        forms = parsed.map(cloneTerm);
        plan = planWorkspace(forms);
        return plan.synthesized;
      },
    });
    return new FoundationWorkspace(CONSTRUCT, forms, plan, registry, {
      executionBasis,
      disabledOperations: [...disabledOperations],
      maxContractions,
    });
  }

  /** Load already parsed top-level forms. */
  static fromForms(forms, {
    executionBasis = 's-k',
    disabledOperations = [],
    maxContractions,
  } = {}) {
    FoundationWorkspace.#requireRewriting(executionBasis);
    if (!Array.isArray(forms)) throw new Error('foundation workspace forms must be a list');
    const copied = forms.map(cloneTerm);
    const plan = planWorkspace(copied);
    const registry = LinkedProgramRegistry.fromForms([...copied, ...plan.synthesized], {
      executionBasis,
      disabledOperations,
      maxContractions,
    });
    return new FoundationWorkspace(CONSTRUCT, copied, plan, registry, {
      executionBasis,
      disabledOperations: [...disabledOperations],
      maxContractions,
    });
  }

  static #requireRewriting(executionBasis) {
    if (executionBasis === 'horn-relational') {
      throw new Error(
        'foundation workspaces normalize judgements by rewriting, which the ' +
        'horn-relational basis does not perform',
      );
    }
  }

  /** Describe every result status and what it establishes. */
  static resultStatuses() {
    return RESULT_STATUSES.map(status => ({ ...status }));
  }

  /** List the roles a foundation may declare and the rule kind each admits. */
  static roles() {
    return ROLES.map(role => ({ role, kind: ROLE_KINDS[role] }));
  }

  /** The S/K contractions each closed kernel call of a question may make. */
  get maxContractions() {
    return this.#registry.maxContractions;
  }

  /** List loaded foundations as `{name, version}`, sorted. */
  foundations() {
    return sortedByKey(
      [...this.#plan.foundations.values()].map(({ name, version }) => ({ name, version })),
      ({ name, version }) => foundationKey(name, version),
    );
  }

  /** List loaded instances with their theory and foundation, sorted. */
  instances() {
    return sortedByKey([...this.#plan.instances.values()], instance => instance.name)
      .map(instance => ({
        name: instance.name,
        theory: {
          name: instance.theory.name,
          rebind: instance.theory.rebind.map(binding => ({ ...binding })),
        },
        foundation: {
          name: instance.foundation.name,
          version: instance.foundation.version,
        },
      }));
  }

  /**
   * Describe one foundation as data: its dependencies, the programs of every
   * role in its closure, its signature, its cycle policy, every rule with its
   * role and kind, and the bootstrap kernel that executes it.
   */
  describe(name, version = null) {
    const foundation = this.#plan.resolve(
      { name: nameLeaf(name, 'described foundation'), version },
      'describe',
    );
    const roleOf = this.#foundationRoles(foundation);
    const rules = [];
    const seen = new Set();
    for (const entry of foundation.roleEntries) {
      for (const programName of usesClosure(this.#registry.programs, entry.program)) {
        if (seen.has(programName)) continue;
        seen.add(programName);
        rules.push(...this.#programRules(programName, roleOf.get(programName)));
      }
    }
    const kernel = LinkedProgramRegistry.bootstrapKernelReport();
    return {
      schema: PACKAGE_SCHEMA,
      name: foundation.name,
      version: foundation.version,
      dependsOn: foundation.dependencies.map(dependency => ({
        name: dependency.name,
        version: dependency.version,
      })),
      closure: foundation.closure.map(member => ({ name: member.name, version: member.version })),
      roles: foundation.roleEntries.map(entry => ({
        role: entry.role,
        kind: ROLE_KINDS[entry.role],
        program: entry.program,
        declaredBy: { ...entry.declaredBy },
      })),
      signature: foundation.signature.map(cloneTerm),
      cyclePolicy: this.#cyclePolicy(foundation),
      rules,
      bootstrap: {
        kernel: kernel.name,
        operations: kernel.operations,
        executionBasis: this.executionBasis,
      },
    };
  }

  /**
   * Ask a query of one instance.  A ground query is normalized, searched for
   * together with its refutation, and, under a guarded cycle policy, retried
   * as a guarded cycle.  A query with variables is a pattern: every derived
   * instance is an answer.  Assumptions are ground judgements added for this
   * ask only.
   */
  ask(instanceName, query, {
    assumptions = [],
    maxRounds = 128,
    maxFacts = 10_000,
    maxSteps = 10_000,
  } = {}) {
    const instance = this.#instance(instanceName);
    const data = this.#data(instance);
    assertTerm(query, 'foundation query');
    if (!Array.isArray(assumptions)) throw new Error('foundation assumptions must be a list');
    assumptions.forEach((assumption, index) => {
      assertTerm(assumption, `foundation assumption ${index + 1}`);
      if (variablesIn(assumption).size > 0) {
        throw new Error(`foundation assumption ${index + 1} must be ground`);
      }
    });
    this.#rejectReserved(instance, [query, ...assumptions]);
    const bounds = {
      maxRounds: positiveBound(maxRounds, 'maxRounds'),
      maxFacts: positiveBound(maxFacts, 'maxFacts'),
      maxSteps: positiveBound(maxSteps, 'maxSteps'),
    };
    const session = this.#session();
    const finish = outcome => this.#result(instance, data, {
      query,
      assumptions,
      bounds,
      session,
      outcome,
    });

    const outside = this.#outsideSignature(instance, [query, ...assumptions], session);
    if (outside !== null) return finish(outside);

    const registry = session.registry([...data.forms, ...instance.forms.program]);
    const normalizedAssumptions = [];
    const traces = [];
    for (const [index, assumption] of assumptions.entries()) {
      const reduced = reductionOutcome(registry, instance.name, assumption, bounds.maxSteps);
      if (reduced.failure !== null) {
        return finish(this.#failure(`assumption ${index + 1}`, reduced.failure, traces));
      }
      normalizedAssumptions.push(reduced.term);
      traces.push(...reduced.trace);
    }
    const context = { instance, data, bounds, session, registry, normalizedAssumptions, traces };
    return finish(variablesIn(query).size > 0
      ? this.#askPattern(context, query)
      : this.#askGround(context, query));
  }

  /**
   * Reduce a term with the instance's rewrites and report every step with the
   * role of the rule that made it.
   */
  execute(instanceName, term, { maxSteps = 10_000 } = {}) {
    const instance = this.#instance(instanceName);
    const data = this.#data(instance);
    assertTerm(term, 'executed term');
    this.#rejectReserved(instance, [term]);
    positiveBound(maxSteps, 'maxSteps');
    const session = this.#session();
    const registry = session.registry([...data.forms, ...instance.forms.program]);
    const reduced = reductionOutcome(registry, instance.name, term, maxSteps);
    const base = {
      schema: EXECUTION_SCHEMA,
      instance: instance.name,
      foundation: { name: instance.foundation.name, version: instance.foundation.version },
      executionBasis: this.executionBasis,
      input: cloneTerm(term),
    };
    if (reduced.failure !== null) {
      return {
        ...base,
        status: failureStatus(reduced.failure),
        reason: reduced.failure.reductionFailure,
        detail: reduced.failure.message,
        output: null,
        steps: null,
        trace: null,
        hostOperations: session.hostOperations(),
      };
    }
    return {
      ...base,
      status: 'normal',
      reason: 'normal-form',
      detail: null,
      output: reduced.term,
      steps: reduced.trace.length,
      trace: reduced.trace.map(step => ({
        program: step.program,
        rule: step.rule,
        role: data.roleOf.get(step.program) ?? 'theory',
        before: cloneTerm(step.before),
        after: cloneTerm(step.after),
      })),
      hostOperations: session.hostOperations(),
    };
  }

  /**
   * Tell whether `change` can alter `result`.  A change is one of
   * `{replaceAssumption: [from, to]}`, `{addRule: form}`,
   * `{replaceRule: form}`, or `{removeRule: [program, rule]}`.  A rewrite
   * change inside the instance closure affects every result, because every
   * judgement is normalized with the whole rewrite system.  Otherwise a
   * result whose evidence cannot be overturned by more derivations depends
   * only on the rules and assumptions its proofs use.
   */
  affectedBy(result, change) {
    const validated = this.#validateChange(change);
    const { dependencies } = result;
    if (validated.type === 'assumption') {
      if (!result.assumptions.some(item => keyOf(item) === validated.fromKey)) return false;
      if (dependencies.scope === 'evidence') {
        return dependencies.assumptions.some(item => keyOf(item) === validated.fromKey);
      }
      return true;
    }
    if (result.reason === 'outside-signature') return false;
    if (!dependencies.closure.some(entry => entry.program === validated.program)) return false;
    if (validated.kinds.has('rewrite')) return true;
    if (dependencies.scope === 'closure') return true;
    if (validated.action === 'add') return false;
    return dependencies.rules.some(rule =>
      rule.program === validated.program &&
      rule.rule === validated.rule &&
      validated.kinds.has(rule.kind));
  }

  /**
   * Apply `change` and recheck exactly the results it affects.  Returns the
   * workspace after the change and one revision per result, each either
   * `kept` or `rechecked`, with `changed` telling whether the outcome moved.
   */
  revise(results, change) {
    if (!Array.isArray(results)) throw new Error('revised results must be a list');
    const validated = this.#validateChange(change);
    const workspace = validated.type === 'assumption'
      ? this
      : FoundationWorkspace.fromForms(validated.forms, this.#options);
    const replaced = assumptions => validated.type !== 'assumption'
      ? assumptions
      : assumptions.map(item =>
        keyOf(item) === validated.fromKey ? cloneTerm(validated.to) : item);
    const revisions = results.map(before => {
      if (!this.affectedBy(before, change)) {
        const after = validated.type === 'assumption'
          ? { ...before, assumptions: replaced(before.assumptions) }
          : before;
        return { action: 'kept', before, after, changed: false };
      }
      const after = workspace.ask(before.instance, before.query, {
        ...before.bounds,
        assumptions: replaced(before.assumptions),
      });
      return {
        action: 'rechecked',
        before,
        after,
        changed: outcomeOf(before) !== outcomeOf(after),
      };
    });
    return { workspace, revisions };
  }

  #askGround(context, query) {
    const { instance, bounds, registry, normalizedAssumptions, traces } = context;
    const goal = reductionOutcome(registry, instance.name, query, bounds.maxSteps);
    if (goal.failure !== null) return this.#failure('goal', goal.failure, traces);
    traces.push(...goal.trace);
    const refutation = reductionOutcome(
      registry,
      instance.name,
      [REFUTATION_HEAD, goal.term],
      bounds.maxSteps,
    );
    if (refutation.failure !== null) {
      return { ...this.#failure('refutation', refutation.failure, traces), normalized: goal.term };
    }
    traces.push(...refutation.trace);
    const defined = !(Array.isArray(refutation.term) && refutation.term[0] === REFUTATION_HEAD);
    const goals = defined ? [goal.term, refutation.term] : [goal.term];
    let search;
    try {
      search = registry.search(instance.name, goals, {
        facts: normalizedAssumptions,
        maxRounds: bounds.maxRounds,
        maxFacts: bounds.maxFacts,
        maxSteps: bounds.maxSteps,
      });
    } catch (error) {
      if (error.reductionFailure === undefined) throw error;
      return { ...this.#failure('derivation', error, traces), normalized: goal.term };
    }
    const mapper = this.#proofMapper(context, null);
    const goalProof = search.goals[0].proof;
    const refutationProof = defined ? search.goals[1].proof : null;
    const bounded = !['found', 'saturated'].includes(search.ended);
    const outcome = {
      normalized: goal.term,
      proof: goalProof === null ? null : mapper(goalProof),
      refutation: {
        judgement: defined ? refutation.term : null,
        status: !defined ? 'undefined'
          : refutationProof !== null ? 'derived'
            : bounded ? 'not-derived-within-bounds' : 'not-derived',
        proof: refutationProof === null ? null : mapper(refutationProof),
      },
      search: { ended: search.ended, facts: search.facts },
      traces,
    };
    if (goalProof !== null && refutationProof !== null) {
      return { ...outcome, status: 'contradictory', reason: 'goal-and-refutation-derived' };
    }
    if (goalProof !== null) return { ...outcome, status: 'proved', reason: 'goal-derived' };
    if (refutationProof !== null) {
      return { ...outcome, status: 'refuted', reason: 'refutation-derived' };
    }
    if (bounded) return { ...outcome, status: 'exhausted', reason: search.ended };
    if (instance.foundation.cyclePolicy.kind === 'guarded-coinductive') {
      return this.#askGuarded(context, outcome);
    }
    return { ...outcome, status: 'unknown', reason: 'saturated-without-proof' };
  }

  // Retry an underived ground goal as a guarded cycle: assume the goal and
  // derive it again through a final guard step.  Every use of the
  // hypothesis then sits beneath a guard, so unfolding the cycle is
  // productive.  The guard must be the last step of the cycle.
  #askGuarded(context, outcome) {
    const { instance, data, bounds, session, normalizedAssumptions } = context;
    const { names } = instance;
    const open = this.#wrapperRewrite(data, 2);
    if (open !== null) {
      return {
        ...outcome,
        status: 'unsupported',
        reason: 'synthesized-link-rewritable',
        detail: `hypothesis: linked-rewrite ${open.program}.${open.rule} could rewrite ` +
          `the guard link ${names.guarded}`,
      };
    }
    const registry = session.registry([
      ...data.forms,
      ...instance.forms.program,
      ...instance.forms.guarded,
    ]);
    const hypothesis = outcome.normalized;
    let search;
    try {
      search = registry.search(names.guarded, [[names.guarded, hypothesis]], {
        facts: [...normalizedAssumptions, hypothesis],
        maxRounds: bounds.maxRounds,
        maxFacts: bounds.maxFacts,
        maxSteps: bounds.maxSteps,
      });
    } catch (error) {
      if (error.reductionFailure === undefined) throw error;
      return { ...outcome, ...this.#failure('hypothesis', error, outcome.traces) };
    }
    const proof = search.goals[0].proof;
    const bounded = !['found', 'saturated'].includes(search.ended);
    const coinduction = {
      hypothesis: cloneTerm(hypothesis),
      guards: instance.foundation.cyclePolicy.guards.map(({ program, rule }) => ({ program, rule })),
      status: proof !== null ? 'derived' : bounded ? 'not-derived-within-bounds' : 'not-derived',
      search: { ended: search.ended, facts: search.facts },
    };
    if (proof !== null) {
      const mapper = this.#proofMapper(context, normalizedAssumptions.length + 1);
      return {
        ...outcome,
        status: 'proved',
        reason: 'guarded-coinduction',
        proof: mapper(proof),
        coinduction,
      };
    }
    if (bounded) {
      return { ...outcome, status: 'exhausted', reason: `guarded-${search.ended}`, coinduction };
    }
    return { ...outcome, status: 'unknown', reason: 'saturated-without-proof', coinduction };
  }

  #askPattern(context, query) {
    const { instance, data, bounds, session, registry, normalizedAssumptions, traces } = context;
    const constantHead = term => Array.isArray(term) &&
      typeof term[0] === 'string' && !term[0].startsWith('?');
    if (!constantHead(query)) {
      return {
        status: 'unsupported',
        reason: 'pattern-without-constant-head',
        detail: 'pattern: a pattern query must be a link whose head is a name',
        traces,
      };
    }
    const pattern = reductionOutcome(registry, instance.name, query, bounds.maxSteps);
    if (pattern.failure !== null) return this.#failure('pattern', pattern.failure, traces);
    traces.push(...pattern.trace);
    if (!constantHead(pattern.term)) {
      return {
        status: 'unsupported',
        reason: 'pattern-without-constant-head',
        detail: `pattern: the pattern normalizes to ${keyOf(pattern.term)}`,
        normalized: pattern.term,
        traces,
      };
    }
    const variables = [...variablesIn(pattern.term)];
    const { answer } = instance.names;
    const open = this.#wrapperRewrite(data, variables.length + 2);
    if (open !== null) {
      return {
        status: 'unsupported',
        reason: 'synthesized-link-rewritable',
        detail: `pattern: linked-rewrite ${open.program}.${open.rule} could rewrite ` +
          `the answer link ${answer}`,
        normalized: pattern.term,
        traces,
      };
    }
    const answerRegistry = session.registry([
      ...data.forms,
      ...instance.forms.program,
      ['linked-program', answer, ['uses', instance.name]],
      [
        'linked-inference',
        answer,
        'answer',
        ['premise', cloneTerm(pattern.term)],
        ['conclusion', [answer, cloneTerm(pattern.term), ...variables]],
      ],
    ]);
    let search;
    try {
      search = answerRegistry.search(answer, [], {
        facts: normalizedAssumptions,
        maxRounds: bounds.maxRounds,
        maxFacts: bounds.maxFacts,
        maxSteps: bounds.maxSteps,
      });
    } catch (error) {
      if (error.reductionFailure === undefined) throw error;
      return { ...this.#failure('derivation', error, traces), normalized: pattern.term };
    }
    const mapper = this.#proofMapper(context, null);
    const answers = sortedByKey(
      search.derived
        .filter(item => Array.isArray(item.judgement) && item.judgement[0] === answer)
        .map(item => ({
          judgement: item.judgement[1],
          bindings: Object.fromEntries(
            variables.map((variable, index) => [variable, item.judgement[index + 2]]),
          ),
          proof: mapper(item.proof.premises[0]),
        })),
      item => keyOf(item.judgement),
    );
    // Answers come from saturation alone.  Under a guarded cycle policy a
    // ground query can also establish an instance through a guarded cycle,
    // so only an inductive foundation can report its answers complete.
    const outcome = {
      normalized: pattern.term,
      answers,
      complete: search.ended === 'saturated' &&
        instance.foundation.cyclePolicy.kind === 'inductive',
      search: { ended: search.ended, facts: search.facts },
      traces,
    };
    if (answers.length > 0) return { ...outcome, status: 'proved', reason: 'instances-derived' };
    if (search.ended === 'saturated') {
      return { ...outcome, status: 'unknown', reason: 'saturated-without-instances' };
    }
    return { ...outcome, status: 'exhausted', reason: search.ended };
  }

  #wrapperRewrite(data, length) {
    return data.openRewrites.find(rule => rule.length === null || rule.length === length) ?? null;
  }

  #failure(stage, error, traces) {
    return {
      status: failureStatus(error),
      reason: error.reductionFailure,
      detail: `${stage}: ${error.message}`,
      traces,
    };
  }

  // Map engine proofs to foundation proofs: assumptions and the coinductive
  // hypothesis become labelled leaves, guard mirror steps name the original
  // guard rule, and every step carries the role of its program.
  #proofMapper(context, hypothesisIndex) {
    const { instance, data } = context;
    const guards = instance.foundation.cyclePolicy.guards;
    const memo = new Map();
    const map = proof => {
      if (memo.has(proof)) return memo.get(proof);
      let mapped;
      if (proof.program === '<input>') {
        const index = Number(proof.rule.slice('input-'.length));
        mapped = index === hypothesisIndex
          ? {
            judgement: cloneTerm(proof.judgement),
            program: '<hypothesis>',
            rule: 'coinductive-hypothesis',
            role: 'hypothesis',
            premises: [],
          }
          : {
            judgement: cloneTerm(proof.judgement),
            program: '<assumption>',
            rule: `assumption-${index}`,
            role: 'assumption',
            premises: [],
          };
      } else if (proof.program === instance.names.guarded) {
        const guard = guards[Number(proof.rule.slice('guard-'.length)) - 1];
        mapped = {
          judgement: cloneTerm(proof.judgement[1]),
          program: guard.program,
          rule: guard.rule,
          role: data.roleOf.get(guard.program),
          premises: proof.premises.map(map),
        };
      } else {
        mapped = {
          judgement: cloneTerm(proof.judgement),
          program: proof.program,
          rule: proof.rule,
          role: data.roleOf.get(proof.program) ?? 'theory',
          premises: proof.premises.map(map),
        };
      }
      memo.set(proof, mapped);
      return mapped;
    };
    return map;
  }

  #result(instance, data, { query, assumptions, bounds, session, outcome }) {
    const refutation = outcome.refutation ?? null;
    const ground = outcome.answers === undefined;
    const evidenceScoped = ground && (
      outcome.status === 'contradictory' ||
      (outcome.status === 'proved' && refutation?.status === 'undefined'));
    const proofs = [
      outcome.proof,
      refutation?.proof,
      ...(outcome.answers ?? []).map(answer => answer.proof),
    ].filter(proof => proof !== null && proof !== undefined);
    const usedAssumptions = new Set();
    const rules = new Map();
    const seen = new Set();
    const collect = proof => {
      if (seen.has(proof)) return;
      seen.add(proof);
      if (proof.program === '<assumption>') {
        usedAssumptions.add(Number(proof.rule.slice('assumption-'.length)) - 1);
      } else if (proof.program !== '<hypothesis>') {
        const kind = proof.premises.length === 0 ? 'fact' : 'inference';
        rules.set(ruleKey(kind, proof.program, proof.rule), {
          program: proof.program,
          rule: proof.rule,
          role: proof.role,
          kind,
        });
      }
      proof.premises.forEach(collect);
    };
    proofs.forEach(collect);
    for (const step of outcome.traces ?? []) {
      rules.set(ruleKey('rewrite', step.program, step.rule), {
        program: step.program,
        rule: step.rule,
        role: data.roleOf.get(step.program) ?? 'theory',
        kind: 'rewrite',
      });
    }
    return {
      schema: RESULT_SCHEMA,
      instance: instance.name,
      theory: {
        name: instance.theory.name,
        rebind: instance.theory.rebind.map(binding => ({ ...binding })),
      },
      foundation: { name: instance.foundation.name, version: instance.foundation.version },
      executionBasis: this.executionBasis,
      query: cloneTerm(query),
      normalized: outcome.normalized ?? null,
      assumptions: assumptions.map(cloneTerm),
      status: outcome.status,
      reason: outcome.reason,
      detail: outcome.detail ?? null,
      proof: outcome.proof ?? null,
      answers: outcome.answers ?? null,
      complete: outcome.complete ?? null,
      refutation,
      coinduction: outcome.coinduction ?? null,
      cyclePolicy: this.#cyclePolicy(instance.foundation),
      dependencies: {
        scope: evidenceScoped ? 'evidence' : 'closure',
        assumptions: evidenceScoped
          ? [...usedAssumptions].sort((a, b) => a - b).map(index => cloneTerm(assumptions[index]))
          : assumptions.map(cloneTerm),
        rules: sortedByKey(
          [...rules.values()],
          rule => ruleKey(rule.kind, rule.program, rule.rule),
        ),
        closure: data.closure.map(program => ({
          program,
          role: data.roleOf.get(program) ?? 'theory',
        })),
      },
      search: outcome.search ?? null,
      bounds: { ...bounds },
      hostOperations: session.hostOperations(),
    };
  }

  #cyclePolicy(foundation) {
    return {
      kind: foundation.cyclePolicy.kind,
      guards: foundation.cyclePolicy.guards.map(({ program, rule }) => ({ program, rule })),
    };
  }

  // Check the query and assumptions against the signature in a registry
  // that holds only the signature program, so no theory rule can admit a
  // judgement.  One rewrite per position suffices.  Return the outcome of a
  // term outside the signature or of a check that spent its budget, or null.
  #outsideSignature(instance, terms, session) {
    if (instance.forms.signature.length === 0) return null;
    const { signature } = instance.names;
    const registry = session.registry(instance.forms.signature);
    const checked = reductionOutcome(
      registry,
      signature,
      ['checks', ...terms.map(term => [signature, cloneTerm(term)])],
      terms.length + 1,
    );
    if (checked.failure !== null) return this.#failure('signature', checked.failure, []);
    const outside = terms.filter((_, index) => checked.term[index + 1] !== ADMITTED);
    if (outside.length === 0) return null;
    return {
      status: 'unsupported',
      reason: 'outside-signature',
      detail: `signature: ${outside.map(keyOf).join(', ')} matches no signature pattern of ` +
        `${instance.foundation.name} version ${instance.foundation.version}`,
    };
  }

  #rejectReserved(instance, terms) {
    const reserved = new Set([
      instance.names.guarded,
      instance.names.signature,
      instance.names.answer,
    ]);
    for (const term of terms) {
      for (const leaf of leavesOf(term)) {
        if (reserved.has(leaf)) {
          throw new Error(`linked-instance ${instance.name} reserves ${leaf} for its own programs`);
        }
      }
    }
  }

  #session() {
    const registries = [];
    return {
      registry: forms => {
        const registry = LinkedProgramRegistry.fromForms(forms, this.#options);
        registries.push(registry);
        return registry;
      },
      hostOperations: () => [...new Set([this.#registry, ...registries].flatMap(registry =>
        registry.runtimeSemanticTrace().observedOperations))].sort(),
    };
  }

  #instance(name) {
    const instance = this.#plan.instances.get(name);
    if (instance === undefined) throw new Error(`unknown linked-instance ${describeTerm(name)}`);
    return instance;
  }

  // Direct role declarations win, then the first role whose program uses the
  // program; every other program of an instance belongs to its theory.
  #foundationRoles(foundation) {
    const roleOf = new Map(foundation.declared);
    for (const entry of foundation.roleEntries) {
      for (const name of usesClosure(this.#registry.programs, entry.program)) {
        if (!roleOf.has(name)) roleOf.set(name, entry.role);
      }
    }
    return roleOf;
  }

  #programRules(programName, role) {
    const program = this.#registry.programs.get(programName);
    return Object.entries(KIND_FIELDS).flatMap(([kind, field]) =>
      program[field].map(rule => ({ program: programName, rule: rule.name, role, kind })));
  }

  #checkRoleKinds() {
    for (const foundation of this.#plan.foundations.values()) {
      for (const entry of foundation.roleEntries) {
        const kind = ROLE_KINDS[entry.role];
        for (const name of usesClosure(this.#registry.programs, entry.program)) {
          const program = this.#registry.programs.get(name);
          for (const [other, field] of Object.entries(KIND_FIELDS)) {
            if (other === kind || program[field].length === 0) continue;
            throw new Error(
              `${foundation.context} declares ${entry.program} as ${entry.role}, which ` +
              `admits only ${kind} rules, but linked-program ${name} has ${other} ` +
              `${program[field][0].name}`,
            );
          }
        }
      }
    }
  }

  #data(instance) {
    const cached = this.#instanceData.get(instance.name);
    if (cached !== undefined) return cached;
    const programs = this.#registry.programs;
    const closure = usesClosure(programs, instance.name).slice(1);
    const members = new Set(closure);
    const roleOf = this.#foundationRoles(instance.foundation);
    const reserved = new Set([
      instance.names.guarded,
      instance.names.signature,
      instance.names.answer,
    ]);
    // The workspace wraps judgements in links headed by its reserved names.
    // No rule mentions those names, so only a rewrite whose pattern is a
    // variable or a link with a variable head could rewrite such a wrapper.
    const openRewrites = [];
    const scan = (term, where) => {
      for (const leaf of leavesOf(term)) {
        if (reserved.has(leaf)) {
          throw new Error(
            `linked-instance ${instance.name} reserves ${leaf} for its own programs, ` +
            `but ${where} mentions it`,
          );
        }
      }
    };
    for (const name of [instance.name, ...closure]) {
      const program = programs.get(name);
      for (const dependency of program.uses) {
        for (const [from, to] of dependency.rebindings) {
          scan([from, to], `linked-program ${name} rebinding`);
        }
      }
      for (const rule of program.rewrites) {
        scan([rule.pattern, rule.replacement], `linked-rewrite ${name}.${rule.name}`);
        const { pattern } = rule;
        if (isVariable(pattern) || (Array.isArray(pattern) && isVariable(pattern[0]))) {
          openRewrites.push({
            program: name,
            rule: rule.name,
            length: Array.isArray(pattern) ? pattern.length : null,
          });
        }
      }
      for (const fact of program.facts) scan(fact.judgement, `linked-fact ${name}.${fact.name}`);
      for (const rule of program.inferences) {
        scan([...rule.premises, rule.conclusion], `linked-inference ${name}.${rule.name}`);
      }
    }
    const forms = this.#forms.filter(form => Array.isArray(form) &&
      (form[0] === 'linked-program' || Object.hasOwn(RULE_HEADS, form[0])) &&
      members.has(form[1]));
    const data = { closure, roleOf, forms, openRewrites };
    this.#instanceData.set(instance.name, data);
    return data;
  }

  // Normalize a change into the program and rule kinds it touches and, for
  // rule changes, the forms of the workspace after it.
  #validateChange(change) {
    if (change === null || typeof change !== 'object' || Array.isArray(change)) {
      throw new Error('a foundation change must be an object');
    }
    const keys = Object.keys(change);
    if (keys.length !== 1) {
      throw new Error('a foundation change has exactly one of replaceAssumption, addRule, replaceRule, removeRule');
    }
    const [type] = keys;
    const value = change[type];
    if (type === 'replaceAssumption') {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('replaceAssumption must be [from, to]');
      }
      value.forEach((term, index) => {
        assertTerm(term, `replaceAssumption ${index === 0 ? 'from' : 'to'}`);
        if (variablesIn(term).size > 0) throw new Error('replaced assumptions must be ground');
      });
      return { type: 'assumption', fromKey: keyOf(value[0]), to: value[1] };
    }
    const ruleForms = this.#forms
      .map((form, index) => ({ form, index }))
      .filter(({ form }) => Array.isArray(form) && Object.hasOwn(RULE_HEADS, form[0]));
    const parsedPrograms = new Set(this.#forms
      .filter(form => Array.isArray(form) && form[0] === 'linked-program')
      .map(form => form[1]));
    const target = (program, rule) => {
      const matches = ruleForms.filter(({ form }) => form[1] === program && form[2] === rule);
      if (matches.length === 0) throw new Error(`no linked rule ${program}.${rule} to change`);
      if (matches.length > 1) {
        throw new Error(`linked rule ${program}.${rule} names rules of several kinds`);
      }
      return matches[0];
    };
    const ruleForm = form => {
      if (!Array.isArray(form) || !Object.hasOwn(RULE_HEADS, form[0])) {
        throw new Error(`${type} must be a linked-rewrite, linked-fact, or linked-inference form`);
      }
      const program = nameLeaf(form[1], `${type} program`);
      const rule = nameLeaf(form[2], `${type} rule`);
      if (!parsedPrograms.has(program)) {
        throw new Error(`${type} targets ${program}, which is not a loaded linked-program`);
      }
      return { program, rule, kind: RULE_HEADS[form[0]] };
    };
    if (type === 'addRule') {
      const added = ruleForm(value);
      if (ruleForms.some(({ form }) => form[1] === added.program && form[2] === added.rule &&
          RULE_HEADS[form[0]] === added.kind)) {
        throw new Error(`linked rule ${added.program}.${added.rule} already exists`);
      }
      return {
        type: 'rule',
        action: 'add',
        program: added.program,
        rule: added.rule,
        kinds: new Set([added.kind]),
        forms: [...this.#forms, cloneTerm(value)],
      };
    }
    if (type === 'replaceRule') {
      const replacement = ruleForm(value);
      const existing = target(replacement.program, replacement.rule);
      const forms = [...this.#forms];
      forms[existing.index] = cloneTerm(value);
      return {
        type: 'rule',
        action: 'replace',
        program: replacement.program,
        rule: replacement.rule,
        kinds: new Set([RULE_HEADS[existing.form[0]], replacement.kind]),
        forms,
      };
    }
    if (type === 'removeRule') {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('removeRule must be [program, rule]');
      }
      const program = nameLeaf(value[0], 'removeRule program');
      const rule = nameLeaf(value[1], 'removeRule rule');
      const existing = target(program, rule);
      return {
        type: 'rule',
        action: 'remove',
        program,
        rule,
        kinds: new Set([RULE_HEADS[existing.form[0]]]),
        forms: this.#forms.filter((_, index) => index !== existing.index),
      };
    }
    throw new Error(`unknown foundation change ${type}`);
  }
}

export { FoundationWorkspace };
