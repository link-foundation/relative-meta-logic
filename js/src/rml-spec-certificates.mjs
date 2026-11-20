/**
 * Native execution and replayable proof certificates for the source
 * specifications of types, graphs and relational algebra
 * (lib/meta-theory/type-specification.lino, graph-specification.lino and
 * relational-algebra-specification.lino).
 *
 * Each specification is an ordinary linked program. It names its theorems
 * with (spec-theorems) -> (spec-list NAME ...), computes the statement of each
 * with (spec-theorem NAME) -> (spec-statement GOAL), and states its proof rules
 * with (spec-proof-rules) -> (spec-rules (rule ID PREMISES CONCLUSION) ...).
 * A premise (evaluates (spec-call F ARGUMENTS...) VALUE) is a fact: the
 * native result of (F ARGUMENTS...) in the specification program.
 *
 * A certificate is { schema, program, theorem, goal, facts, candidate }. The
 * trusted checker recomputes the statement from the specification, takes the
 * proof rules from the specification, re-executes every recorded fact and
 * turns each into a premise-free rule (fact:N), and then runs the
 * natural-deduction linked proof verifier (lib/meta-theory/proof-verifier.lino
 * with proof-verifier-natural.lino) over that exact context. Nothing else in
 * the certificate is trusted, so a changed definition changes the statement
 * or a fact value and the old certificate is rejected.
 *
 * The producer below is untrusted: it builds derivations from native results
 * (typing derivations by syntax, reachability by breadth-first search over the
 * edge list, relational-algebra laws by evaluating both sides) and whatever it
 * emits must pass the checker.
 */
import { LINKED_PROOF_NATURAL_PROGRAM, encodeLinkedProofData } from './rml-linked-proof.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

export const SPEC_CERTIFICATE_SCHEMA = 'rml-spec-certificate/v1';
export const SPEC_PROGRAMS = Object.freeze({
  'type-specification': 'lib/meta-theory/type-specification.lino',
  'graph-specification': 'lib/meta-theory/graph-specification.lino',
  'relational-algebra-specification': 'lib/meta-theory/relational-algebra-specification.lino',
});
export const SPEC_MAX_STEPS = 5_000_000;
const VERIFIER_STEPS = 2_000_000;
const PROOF_LIMITS = Object.freeze({ maxDepth: 256, maxNodes: 1_000_000, maxTextBytes: 16_777_216 });
const FACT_ID = /^fact:[1-9][0-9]*$/;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** LiNo text of a term: atoms as they are, links as (a b c). */
export function renderLink(term) {
  return typeof term === 'string' ? term : `(${term.map(renderLink).join(' ')})`;
}

/**
 * One registry per specification program, and the linked proof verifier.
 * `specs` maps program names to their sources.
 */
export function specRegistries({ specs, universal, verifier, natural }) {
  if (typeof natural !== 'string') throw new TypeError('specification registries need the natural-deduction verifier source');
  const programs = {};
  for (const [program, source] of Object.entries(specs)) {
    programs[program] = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
  }
  return {
    programs,
    verifier: LinkedProgramRegistry.fromRml(`${universal}\n${verifier}\n${natural}`, { executionBasis: 'direct-structural' }),
  };
}

function registryOf(registries, program) {
  const registry = registries.programs[program];
  if (!registry) throw new Error(`unknown specification program ${program}`);
  return registry;
}

/** Execute a request natively in a specification program: { term, steps }. */
export function specEvaluate(registries, program, request, { maxSteps = SPEC_MAX_STEPS } = {}) {
  return registryOf(registries, program).reduceResult(program, request, { maxSteps });
}

const evaluate = (registries, program, request) => specEvaluate(registries, program, request).term;

/** The theorem names a specification states. */
export function specTheorems(registries, program) {
  const listed = evaluate(registries, program, ['spec-theorems']);
  if (!Array.isArray(listed) || listed[0] !== 'spec-list' || listed.slice(1).some(name => typeof name !== 'string')) {
    throw new Error(`${program} does not list its theorems`);
  }
  return listed.slice(1);
}

/** The goal a specification computes for one of its theorems, or undefined. */
export function specStatement(registries, program, theorem) {
  const statement = evaluate(registries, program, ['spec-theorem', theorem]);
  return Array.isArray(statement) && statement.length === 2 && statement[0] === 'spec-statement' ? statement[1] : undefined;
}

/** The proof rules a specification states, in order. */
export function specProofRules(registries, program) {
  const stated = evaluate(registries, program, ['spec-proof-rules']);
  if (!Array.isArray(stated) || stated[0] !== 'spec-rules') throw new Error(`${program} does not state proof rules`);
  const rules = stated.slice(1);
  for (const rule of rules) {
    if (!Array.isArray(rule) || rule.length !== 4 || rule[0] !== 'rule' || typeof rule[1] !== 'string' ||
        FACT_ID.test(rule[1]) || !Array.isArray(rule[2])) {
      throw new Error(`${program} states a malformed proof rule ${renderLink(rule)}`);
    }
  }
  return rules;
}

function hasVariable(term) {
  if (typeof term === 'string') return false;
  if (term.length === 2 && term[0] === 'variable') return true;
  return term.some(hasVariable);
}

const isTerm = term => typeof term === 'string' || (Array.isArray(term) && term.every(isTerm));

/** The premise-free rule a re-executed fact becomes. */
export const factRule = fact => ['rule', fact.id, [], ['evaluates', ['spec-call', ...fact.expression], fact.value]];

/**
 * Re-execute recorded facts. Returns problems; every fact must be a ground
 * call whose native value is exactly the recorded value.
 */
export function checkSpecFacts(registries, program, facts) {
  if (!Array.isArray(facts)) return ['facts must be a list'];
  const problems = [];
  const ids = new Set();
  for (const fact of facts) {
    const { id, expression, value } = fact ?? {};
    if (typeof id !== 'string' || !FACT_ID.test(id)) { problems.push(`malformed fact id ${id}`); continue; }
    if (ids.has(id)) problems.push(`duplicate fact ${id}`);
    ids.add(id);
    if (!Array.isArray(expression) || typeof expression[0] !== 'string' || !isTerm(expression) || !isTerm(value)) {
      problems.push(`${id}: malformed fact`);
      continue;
    }
    if (hasVariable(expression) || hasVariable(value)) { problems.push(`${id}: facts must be ground`); continue; }
    let actual;
    try {
      actual = evaluate(registries, program, expression);
    } catch (error) {
      problems.push(`${id}: ${error.message}`);
      continue;
    }
    if (!same(actual, value)) problems.push(`${id}: ${renderLink(expression)} evaluates to ${renderLink(actual)}, not ${renderLink(value)}`);
  }
  return problems;
}

/** The exact context the checker trusts: the specification's rules, then the re-executed facts. */
export function specContext(registries, program, identity, facts) {
  return ['proof-context', identity, [...specProofRules(registries, program), ...facts.map(factRule)]];
}

/**
 * Check a derivation of an arbitrary goal against a specification: facts are
 * re-executed, then the linked verifier checks the candidate in the context
 * built from the specification's own rules.
 */
export function checkSpecDerivation(registries, program, { identity, goal, facts, candidate }) {
  const problems = checkSpecFacts(registries, program, facts);
  if (problems.length) return { accepted: false, problems };
  const context = specContext(registries, program, identity, facts);
  const request = ['verify-linked-proof', encodeLinkedProofData(context, PROOF_LIMITS),
    encodeLinkedProofData(goal, PROOF_LIMITS), encodeLinkedProofData(candidate, PROOF_LIMITS)];
  const reduced = registries.verifier.reduceResult(LINKED_PROOF_NATURAL_PROGRAM, request, { maxSteps: VERIFIER_STEPS });
  const accepted = Array.isArray(reduced.term) && reduced.term[0] === 'proof-accepted';
  return {
    accepted,
    problems: accepted ? [] : ['linked proof verifier rejected the derivation'],
    result: reduced.term,
    steps: reduced.steps,
  };
}

/** Independently check a theorem certificate of a specification. */
export function checkSpecCertificate(registries, certificate) {
  if (certificate?.schema !== SPEC_CERTIFICATE_SCHEMA) return { accepted: false, problems: ['unsupported certificate schema'] };
  const { program, theorem } = certificate;
  if (!Object.hasOwn(registries.programs, program)) return { accepted: false, problems: [`unknown specification program ${program}`] };
  if (!specTheorems(registries, program).includes(theorem)) return { accepted: false, problems: [`${program} states no theorem ${theorem}`] };
  const goal = specStatement(registries, program, theorem);
  if (goal === undefined) return { accepted: false, problems: [`${theorem} has no statement`] };
  if (!same(goal, certificate.goal)) return { accepted: false, problems: ['goal differs from the statement the specification computes'] };
  return checkSpecDerivation(registries, program, {
    identity: ['spec', program, theorem], goal, facts: certificate.facts, candidate: certificate.candidate,
  });
}

// ---------------------------------------------------------------------------
// Producer: derivations from native results (untrusted)

class Unsupported extends Error {}

function listItems(term, cons, nil) {
  const items = [];
  let tail = term;
  while (Array.isArray(tail) && tail.length === 3 && tail[0] === cons) {
    items.push(tail[1]);
    tail = tail[2];
  }
  if (tail !== nil) throw new Unsupported(`${renderLink(term)} is not a finite list`);
  return items;
}

function matchPattern(pattern, term, assignment) {
  if (Array.isArray(pattern) && pattern.length === 2 && pattern[0] === 'variable') {
    if (assignment.has(pattern[1])) return same(assignment.get(pattern[1]), term);
    assignment.set(pattern[1], term);
    return true;
  }
  if (typeof pattern === 'string' || typeof term === 'string') return pattern === term;
  return pattern.length === term.length && pattern.every((item, index) => matchPattern(item, term[index], assignment));
}

function substitute(term, assignment) {
  if (typeof term === 'string') return term;
  if (term.length === 2 && term[0] === 'variable') {
    if (!assignment.has(term[1])) throw new Unsupported(`rule conclusion variable ${term[1]} is not bound by a premise`);
    return assignment.get(term[1]);
  }
  return term.map(item => substitute(item, assignment));
}

class SpecProducer {
  constructor(registries, program) {
    this.registries = registries;
    this.program = program;
    this.rules = new Map(specProofRules(registries, program).map(rule => [rule[1], rule]));
    this.facts = [];
    this.factNodes = new Map();
    this.nodes = 0;
  }

  evaluate(request) {
    return evaluate(this.registries, this.program, request);
  }

  node(rule, conclusion, premises, bindings) {
    this.nodes += 1;
    return { id: `n${this.nodes}`, rule, conclusion, premises, bindings };
  }

  /** A re-executable fact, shared by every node that cites it. */
  fact(expression) {
    const key = JSON.stringify(expression);
    if (this.factNodes.has(key)) return this.factNodes.get(key);
    const value = this.evaluate(expression);
    const fact = { id: `fact:${this.facts.length + 1}`, expression, value };
    this.facts.push(fact);
    const node = this.node(fact.id, ['evaluates', ['spec-call', ...expression], value], [], []);
    this.factNodes.set(key, node);
    return node;
  }

  /** Apply a specification rule to premise nodes; bindings follow the verifier's matching order. */
  derive(ruleId, premises) {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Unsupported(`${this.program} has no rule ${ruleId}`);
    const [, , patterns, conclusion] = rule;
    if (patterns.length !== premises.length) throw new Unsupported(`${ruleId} takes ${patterns.length} premises`);
    const assignment = new Map();
    patterns.forEach((pattern, index) => {
      if (!matchPattern(pattern, premises[index].conclusion, assignment)) {
        throw new Unsupported(`${ruleId}: premise ${renderLink(premises[index].conclusion)} does not match ${renderLink(pattern)}`);
      }
    });
    return this.node(ruleId, substitute(conclusion, assignment), premises, [...assignment].reverse());
  }

  // Types --------------------------------------------------------------------

  infer(context, term) {
    const inferred = this.evaluate(['ty-infer', context, term]);
    if (!Array.isArray(inferred) || inferred[0] !== 'ty-ok') throw new Unsupported(`${renderLink(term)} is ill-typed: ${renderLink(inferred)}`);
    return inferred[1];
  }

  typing(context, term, type) {
    if (this.evaluate(['ty-check', context, term, type]) !== 'ty-yes') {
      throw new Unsupported(`${renderLink(term)} does not have type ${renderLink(type)}`);
    }
    return this.typed(context, term, type);
  }

  typed(context, term, type) {
    const constants = { 'tm-zero': 't-zero', 'tm-true': 't-true', 'tm-false': 't-false', 'tm-unit': 't-unit' };
    if (typeof term === 'string') {
      if (!constants[term]) throw new Unsupported(`unknown constant ${term}`);
      return this.derive(constants[term], [this.fact(['ty-context-ok', context])]);
    }
    const [head, ...parts] = term;
    switch (head) {
      case 'tm-var':
        return this.derive('t-var', [this.fact(['ty-context-ok', context]), this.fact(['ty-lookup', context, parts[0]])]);
      case 'tm-lam': {
        const [name, domain, body] = parts;
        return this.derive('t-lam', [this.fact(['ty-is-type', domain]),
          this.typed(['ty-extend', name, domain, context], body, type[2])]);
      }
      case 'tm-app': {
        const argument = this.infer(context, parts[1]);
        return this.derive('t-app', [this.typed(context, parts[0], ['ty-arrow', argument, type]), this.typed(context, parts[1], argument)]);
      }
      case 'tm-pair':
        return this.derive('t-pair', [this.typed(context, parts[0], type[1]), this.typed(context, parts[1], type[2])]);
      case 'tm-fst':
      case 'tm-snd':
        return this.derive(head === 'tm-fst' ? 't-fst' : 't-snd', [this.typed(context, parts[0], this.infer(context, parts[0]))]);
      case 'tm-succ':
        return this.derive('t-succ', [this.typed(context, parts[0], 'ty-nat')]);
      case 'tm-iszero':
        return this.derive('t-iszero', [this.typed(context, parts[0], 'ty-nat')]);
      case 'tm-if':
        return this.derive('t-if', [this.typed(context, parts[0], 'ty-bool'), this.typed(context, parts[1], type),
          this.typed(context, parts[2], type)]);
      default:
        throw new Unsupported(`unknown term ${renderLink(term)}`);
    }
  }

  // Graphs -------------------------------------------------------------------

  edges(graph) {
    if (!Array.isArray(graph) || graph[0] !== 'gr-graph') throw new Unsupported('not a graph');
    return listItems(graph[2], 'gr-cons', 'gr-nil').map(edge => {
      if (!Array.isArray(edge) || edge.length !== 3 || edge[0] !== 'gr-edge') throw new Unsupported('malformed edge');
      return [edge[1], edge[2]];
    });
  }

  /** A shortest nonempty edge path from source to target, by breadth-first search. */
  path(graph, source, target) {
    const edges = this.edges(graph);
    const previous = new Map();
    const queue = [];
    for (const [from, to] of edges) {
      if (same(from, source) && !previous.has(JSON.stringify(to))) {
        previous.set(JSON.stringify(to), null);
        queue.push(to);
      }
    }
    for (let index = 0; index < queue.length; index += 1) {
      const vertex = queue[index];
      if (same(vertex, target)) {
        const path = [vertex];
        for (let at = previous.get(JSON.stringify(vertex)); at !== null; at = previous.get(JSON.stringify(at))) path.unshift(at);
        return [source, ...path];
      }
      for (const [from, to] of edges) {
        if (same(from, vertex) && !previous.has(JSON.stringify(to))) {
          previous.set(JSON.stringify(to), vertex);
          queue.push(to);
        }
      }
    }
    throw new Unsupported(`${renderLink(target)} is not reachable from ${renderLink(source)}`);
  }

  along(graph, path) {
    if (path.length < 2) throw new Unsupported('a reachability path needs an edge');
    const last = path.length - 1;
    let node = this.derive('reach-edge', [this.fact(['gr-has-edge', graph, path[last - 1], path[last]])]);
    for (let index = last - 2; index >= 0; index -= 1) {
      node = this.derive('reach-step', [this.fact(['gr-has-edge', graph, path[index], path[index + 1]]), node]);
    }
    return node;
  }

  reach(graph, source, target) {
    return this.along(graph, this.path(graph, source, target));
  }

  // Goals --------------------------------------------------------------------

  prove(goal) {
    if (!Array.isArray(goal)) throw new Unsupported(`no producer for ${renderLink(goal)}`);
    const [head, ...parts] = goal;
    switch (head) {
      case 'has-type':
        return this.typing(...parts);
      case 'ty-preserved': {
        const [term, next, type] = parts;
        return this.derive('preservation', [this.typing('ty-empty', term, type), this.fact(['ty-step', term]),
          this.typing('ty-empty', next, type)]);
      }
      case 'ty-eval-preserved': {
        const [term, value, type] = parts;
        return this.derive('evaluation-preservation', [this.typing('ty-empty', term, type), this.fact(['ty-eval', term]),
          this.typing('ty-empty', value, type)]);
      }
      case 'ty-progress': {
        const [term, type] = parts;
        const step = this.evaluate(['ty-step', term]);
        const rule = step === 'ty-normal' ? 'progress-value' : 'progress-step';
        return this.derive(rule, [this.typing('ty-empty', term, type), this.fact(['ty-step', term])]);
      }
      case 'gr-reach':
        return this.reach(...parts);
      case 'gr-transitive-at': {
        const [graph, x, y, z] = parts;
        return this.derive('transitive-at', [this.reach(graph, x, y), this.reach(graph, y, z), this.reach(graph, x, z)]);
      }
      case 'gr-closure-fixed':
        return this.derive('closure-fixed', [this.fact(['gr-closure-is-fixed', parts[0]])]);
      case 'gr-closure-below':
        return this.derive('closure-below', [this.fact(['gr-is-prefixed-point', ...parts]), this.fact(['gr-closure-within', ...parts])]);
      case 'gr-path-reaches': {
        const [graph, path] = parts;
        return this.derive('path-reaches', [this.fact(['gr-is-path', graph, path]), this.fact(['gr-path-ends', path]),
          this.along(graph, listItems(path, 'gr-cons', 'gr-nil'))]);
      }
      case 'gr-reach-computed': {
        const [graph, x, y] = parts;
        return this.derive('reach-computed', [this.reach(graph, x, y), this.fact(['gr-reachable', graph, x, y])]);
      }
      case 'gr-dag':
        return this.derive('dag', [this.fact(['gr-well-formed', parts[0]]), this.fact(['gr-acyclic', parts[0]])]);
      case 'ra-equal-relations': {
        const [left, right] = parts;
        const leftNode = this.fact(['ra-eval', left]);
        const rightNode = this.fact(['ra-eval', right]);
        const values = [leftNode, rightNode].map(node => node.conclusion[2]);
        if (values.some(value => !Array.isArray(value) || value[0] !== 'ra-ok')) {
          throw new Unsupported(`a side does not evaluate: ${values.map(renderLink).join(', ')}`);
        }
        return this.derive('extensional', [leftNode, rightNode, this.fact(['ra-same-relation', values[0][1], values[1][1]])]);
      }
      default:
        throw new Unsupported(`no producer for ${head}`);
    }
  }

  candidate(root, context, goal) {
    const dependencies = new Map();
    const reachable = [];
    const visit = node => {
      if (dependencies.has(node.id)) return dependencies.get(node.id);
      const list = [node.rule];
      for (const premise of node.premises) for (const item of visit(premise)) if (!list.includes(item)) list.push(item);
      dependencies.set(node.id, list);
      reachable.push(node);
      return list;
    };
    visit(root);
    const nodes = reachable.map(node => ['node', node.id, node.rule, node.conclusion, node.bindings,
      node.premises.map(premise => premise.id), dependencies.get(node.id)]);
    return ['proof', context, goal, root.id, nodes, dependencies.get(root.id)];
  }
}

/**
 * Build a derivation of `goal` in a specification program: { facts, candidate }.
 * Throws when the goal is not derivable (an ill-typed term, an unreachable
 * vertex, a failed fact) instead of emitting a certificate the checker rejects.
 */
export function buildSpecCandidate(registries, program, goal, identity) {
  const producer = new SpecProducer(registries, program);
  const root = producer.prove(goal);
  if (!same(root.conclusion, goal)) throw new Unsupported(`derived ${renderLink(root.conclusion)} instead of the goal`);
  const context = specContext(registries, program, identity, producer.facts);
  return { facts: producer.facts, candidate: producer.candidate(root, context, goal) };
}

/** Produce a certificate for a specification theorem, or the reason there is none. */
export function produceSpecCertificate(registries, program, theorem) {
  const goal = specStatement(registries, program, theorem);
  if (goal === undefined) return { program, theorem, status: 'no-statement' };
  try {
    const { facts, candidate } = buildSpecCandidate(registries, program, goal, ['spec', program, theorem]);
    return { program, theorem, status: 'produced', certificate: { schema: SPEC_CERTIFICATE_SCHEMA, program, theorem, goal, facts, candidate } };
  } catch (error) {
    if (error instanceof Unsupported) return { program, theorem, status: 'not-derivable', reason: error.message };
    throw error;
  }
}
