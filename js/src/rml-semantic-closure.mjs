/**
 * Recursive semantic closure as one addressed links network, plus validation of
 * foundation-declared universe and soundness contracts.
 *
 * `projectSemanticClosure` lowers actual host objects -- linked programs and
 * their rules, foundation packages, workspace judgements with their proofs,
 * assumptions and pattern substitutions, reduction values and a selected
 * ontology -- into doublets stored by `TypedSemanticArchive`. Anonymous
 * structure is content-addressed, so equal subterms and shared subproofs keep
 * one identity; named programs, rules and foundations keep their declared
 * identity, so program/rule back references form cycles. Categories are links
 * and membership is stated by linked type facts.
 *
 * `validateSemanticClosure` checks closure, content addresses, named
 * identities, record schemas, back references, reachability and category
 * membership, then reconstructs the host-level records. The encoding is a
 * declared representation convention; it adds no inference rule, universe
 * axiom, proof admission or soundness claim.
 *
 * `validateUniverseContract` reads a foundation's universe policy, order,
 * typing judgement and soundness obligations through the public workspace and
 * checks them relative to that declaration. It is not a universal
 * well-foundedness or consistency checker.
 */
import { createHash } from 'node:crypto';
import { emitLinoTerm } from './rml-links.mjs';
import { TypedSemanticArchive } from './rml-semantic-archive.mjs';

const SCHEMA = 'rml-semantic-closure/v1';
const UNIVERSE_SCHEMA = 'rml-universe-contract/v1';
const ROOT = 'rml.closure';
const NIL = 'rml.nil';
const ONTOLOGY = 'rml.ontology';
const CATEGORY_ROOT = 'rml.category';
const CATEGORIES = Object.freeze([
  'term', 'address', 'type', 'value', 'rule', 'substitution',
  'judgement', 'proof', 'foundation', 'ontology', 'program',
]);
const ANONYMOUS = Object.freeze(['proof', 'substitution', 'judgement', 'value']);
const LABELLED_ROLES = new Set(['assumption', 'hypothesis']);
const encoder = new TextEncoder();

const order = (a, b) => {
  const left = [...a].map(c => c.codePointAt(0));
  const right = [...b].map(c => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
};
const framed = text => `${encoder.encode(text).length}:${text}`;

/** Injective content address of an ordered pair of addresses. */
function closureHash(left, right) {
  return createHash('sha256').update(framed(left) + framed(right), 'utf8').digest('hex');
}
const atomAddress = text => `rml.atom/${text}`;
const tagAddress = kind => atomAddress(`rml.${kind}`);
const categoryAddress = name => `${CATEGORY_ROOT}/${name}`;
const programAddress = name => `rml.program/${name}`;
const ruleAddress = (kind, program, name) => `rml.rule/${kind}/${framed(program)}/${name}`;
const foundationAddress = (name, version) => `rml.foundation/${framed(name)}/${version}`;
const factAddress = (subject, category) => `rml.typed/${closureHash(subject, category)}`;

/** Incremental doublet table with content-addressed structure. */
class SemanticClosureBuilder {
  constructor(snapshot = { links: [], typeFacts: [] }) {
    this.links = new Map(snapshot.links.map(row => [row.address, { source: row.source, target: row.target }]));
    this.facts = new Map(snapshot.typeFacts.map(row => [row.address, { subject: row.subject, type: row.type }]));
  }
  link(address, source, target) {
    const existing = this.links.get(address);
    if (existing && (existing.source !== source || existing.target !== target)) {
      throw new Error(`semantic closure identity ${address} has two definitions`);
    }
    this.links.set(address, { source, target });
    return address;
  }
  replace(address, source, target) { this.links.set(address, { source, target }); return address; }
  atom(text) {
    if (typeof text !== 'string' || text.length === 0) throw new Error('semantic closure atoms must be non-empty strings');
    const address = this.link(atomAddress(text), atomAddress(text), atomAddress(text));
    this.type(address, 'address');
    return address;
  }
  nil() { return this.link(NIL, NIL, NIL); }
  seq(addresses) {
    let tail = this.nil();
    for (let i = addresses.length - 1; i >= 0; i--) {
      tail = this.link(`rml.cons/${closureHash(addresses[i], tail)}`, addresses[i], tail);
    }
    return tail;
  }
  term(node, category = 'term') {
    const address = this.#term(node);
    if (category !== null) this.type(address, category);
    return address;
  }
  #term(node) {
    if (typeof node === 'string') return this.atom(node);
    if (!Array.isArray(node)) throw new Error('semantic closure terms must contain strings and lists');
    return this.seq(node.map(child => this.#term(child)));
  }
  anonymous(kind, payload) {
    const tag = this.atom(`rml.${kind}`);
    const address = this.link(`rml.${kind}/${closureHash(tag, payload)}`, tag, payload);
    this.type(address, kind === 'value' ? 'value' : kind);
    return address;
  }
  named(address, kind, payload, category = kind) {
    this.link(address, this.atom(`rml.${kind}`), payload);
    if (category !== null) this.type(address, category);
    return address;
  }
  category(name) {
    this.link(CATEGORY_ROOT, CATEGORY_ROOT, CATEGORY_ROOT);
    const address = this.link(categoryAddress(name), CATEGORY_ROOT, categoryAddress(name));
    if (name === 'type') this.facts.set(factAddress(address, address), { subject: address, type: address });
    else this.type(address, 'type');
    return address;
  }
  type(subject, category) {
    const type = this.category(category);
    this.facts.set(factAddress(subject, type), { subject, type });
    return subject;
  }
  /** Keep only rows reachable from the roots, as a strict archive requires. */
  snapshot(roots) {
    const reachable = reachableFrom(roots, this.links, this.facts);
    return {
      links: [...this.links].filter(([address]) => reachable.links.has(address))
        .map(([address, row]) => ({ address, ...row })).sort((a, b) => order(a.address, b.address)),
      typeFacts: [...this.facts].filter(([address]) => reachable.facts.has(address))
        .map(([address, row]) => ({ address, ...row })).sort((a, b) => order(a.address, b.address)),
    };
  }
}

function reachableFrom(roots, links, facts) {
  const seen = new Set();
  const seenFacts = new Set();
  const stack = [...roots];
  const visit = address => { if (!seen.has(address)) stack.push(address); };
  let changed = true;
  while (changed) {
    changed = false;
    while (stack.length > 0) {
      const address = stack.pop();
      if (seen.has(address)) continue;
      seen.add(address);
      const link = links.get(address);
      if (link) { visit(link.source); visit(link.target); }
      const fact = facts.get(address);
      if (fact) { visit(fact.subject); visit(fact.type); }
    }
    for (const [address, fact] of facts) {
      if (!seenFacts.has(address) && seen.has(fact.subject)) {
        seenFacts.add(address);
        if (!seen.has(address)) { stack.push(address); changed = true; }
      }
    }
  }
  return { links: new Set([...seen].filter(address => links.has(address))), facts: seenFacts, all: seen };
}

function proofRuleKind(proof) {
  return proof.premises.length === 0 ? 'fact' : 'inference';
}

/**
 * Project host objects into one closed archive rooted at `rml.closure`.
 * `registry` is a LinkedProgramRegistry, `foundations` are
 * `FoundationWorkspace.describe` packages, `judgements` are `ask` results and
 * `values` are `{ program, input, result }` with a `registry.reduce` result.
 */
function projectSemanticClosure({ ontology = null, registry, foundations = [], judgements = [], values = [] }) {
  const b = new SemanticClosureBuilder();
  const categories = CATEGORIES.map(name => b.category(name));
  let ontologyRef = b.nil();
  if (ontology !== null) {
    const snapshot = ontology.snapshot();
    for (const row of snapshot.links) {
      if (row.address.startsWith('rml.')) throw new Error(`ontology link ${row.address} uses a reserved closure address`);
      b.link(row.address, row.source, row.target);
      b.type(row.address, 'ontology');
    }
    for (const row of snapshot.typeFacts) {
      if (b.links.has(row.address)) throw new Error(`ontology type fact ${row.address} has conflicting roles`);
      b.facts.set(row.address, { subject: row.subject, type: row.type });
      b.type(row.type, 'type');
    }
    const payload = b.seq([
      b.seq(snapshot.links.map(row => row.address).sort(order)),
      b.seq(snapshot.typeFacts.map(row => row.address).sort(order)),
    ]);
    ontologyRef = b.named(ONTOLOGY, 'ontology', payload);
  }
  const programNames = [...registry.programs.keys()].sort(order);
  const programs = programNames.map(name => {
    const program = registry.programs.get(name);
    const ref = programAddress(name);
    const uses = program.uses.map(use => b.seq([
      programAddress(use.program),
      b.seq([...use.rebindings].sort((x, y) => order(x[0], y[0])).map(([from, to]) => b.seq([b.atom(from), b.atom(to)]))),
    ]));
    const rule = (kind, item, body) => b.named(
      ruleAddress(kind, name, item.name), 'rule', b.seq([ref, b.atom(kind), b.atom(item.name), body]),
    );
    const rules = [
      ...program.rewrites.map(item => rule('rewrite', item, b.seq([b.term(item.pattern), b.term(item.replacement)]))),
      ...program.facts.map(item => rule('fact', item, b.seq([b.term(item.judgement)]))),
      ...program.inferences.map(item => rule('inference', item, b.seq([
        b.seq(item.premises.map(premise => b.term(premise))), b.term(item.conclusion),
      ]))),
    ];
    return b.named(ref, 'program', b.seq([b.atom(name), b.seq(uses), b.seq(rules)]));
  });
  const foundationRefs = foundations.map(item => b.named(
    foundationAddress(item.name, item.version), 'foundation', b.seq([
      b.atom(item.name), b.atom(item.version),
      b.seq(item.dependsOn.map(dependency => foundationAddress(dependency.name, dependency.version))),
      b.seq(item.roles.map(role => b.seq([b.atom(role.role), programAddress(role.program)]))),
      b.seq(item.signature.map(term => b.term(term))),
      b.seq([b.atom(item.cyclePolicy.kind), b.seq(item.cyclePolicy.guards.map(guard =>
        ruleAddress('inference', guard.program, guard.rule)))]),
    ]),
  ));
  const proofs = new Map();
  const proof = step => {
    if (proofs.has(step)) return proofs.get(step);
    const reference = LABELLED_ROLES.has(step.role)
      ? b.seq([b.atom(step.program), b.atom(step.rule)])
      : ruleAddress(proofRuleKind(step), step.program, step.rule);
    const address = b.anonymous('proof', b.seq([
      b.term(step.judgement), reference, b.atom(step.role), b.seq(step.premises.map(proof)),
    ]));
    proofs.set(step, address);
    return address;
  };
  const judgementRefs = judgements.map(result => {
    const answers = result.answers === undefined || result.answers === null
      ? b.nil()
      : b.seq([b.seq(result.answers.map(answer => b.seq([
        b.term(answer.judgement),
        b.anonymous('substitution', b.seq(Object.entries(answer.bindings)
          .map(([variable, value]) => b.seq([b.atom(variable), b.term(value)])))),
        proof(answer.proof),
      ])))]);
    return b.anonymous('judgement', b.seq([
      b.atom(result.instance),
      foundationAddress(result.foundation.name, result.foundation.version),
      b.term(result.query),
      b.atom(result.status),
      b.atom(result.reason),
      b.seq(result.assumptions.map(assumption => b.term(assumption))),
      result.proof ? proof(result.proof) : b.nil(),
      answers,
    ]));
  });
  const valueRefs = values.map(({ program, input, result }) => b.anonymous('value', b.seq([
    programAddress(program), b.term(input), b.term(result.term), b.atom(String(result.trace.length)),
  ])));
  b.named(ROOT, 'closure', b.seq([
    ontologyRef, b.seq(categories), b.seq(foundationRefs), b.seq(programs), b.seq(judgementRefs), b.seq(valueRefs),
  ]), null);
  return new TypedSemanticArchive(b.snapshot([ROOT]), { roots: [ROOT] });
}

const PREFIXES = [
  ['rml.atom/', 'atom'], ['rml.cons/', 'cons'], ['rml.program/', 'program'], ['rml.rule/', 'rule'],
  ['rml.foundation/', 'foundation'], ['rml.proof/', 'proof'], ['rml.substitution/', 'substitution'],
  ['rml.judgement/', 'judgement'], ['rml.value/', 'value'], [`${CATEGORY_ROOT}/`, 'category'],
];
const ALLOWED = {
  atom: ['address', 'term'], nil: ['term'], cons: ['term'], category: ['type'], member: ['ontology', 'type'],
  program: ['program'], rule: ['rule'], foundation: ['foundation'], proof: ['proof'],
  substitution: ['substitution'], judgement: ['judgement'], value: ['value'], ontology: ['ontology'],
  closure: [], 'category-root': [],
};

function nodeKind(address, ontologyMembers) {
  if (address === NIL) return 'nil';
  if (address === ROOT) return 'closure';
  if (address === ONTOLOGY) return 'ontology';
  if (address === CATEGORY_ROOT) return 'category-root';
  for (const [prefix, kind] of PREFIXES) if (address.startsWith(prefix)) return kind;
  return ontologyMembers.has(address) ? 'member' : null;
}

/** Validate an archive as a recursive semantic closure and reconstruct its records. */
function validateSemanticClosure(archive) {
  const snapshot = archive.snapshot();
  const links = new Map(snapshot.links.map(row => [row.address, row]));
  const facts = new Map(snapshot.typeFacts.map(row => [row.address, row]));
  if (archive.roots.length !== 1 || archive.roots[0] !== ROOT) throw new Error(`semantic closure must have the single root ${ROOT}`);
  const node = address => {
    const row = links.get(address);
    if (!row) throw new Error(`semantic closure reference ${address} is not a link`);
    return row;
  };
  const list = (address, context) => {
    const items = [];
    const seen = new Set();
    let at = address;
    while (at !== NIL) {
      if (!at.startsWith('rml.cons/') || seen.has(at)) throw new Error(`${context} is not a proper list`);
      seen.add(at);
      const row = node(at);
      items.push(row.source);
      at = row.target;
    }
    return items;
  };
  const tuple = (address, size, context) => {
    const items = list(address, context);
    if (items.length !== size) throw new Error(`${context} must have ${size} fields`);
    return items;
  };
  const atom = (address, context) => {
    if (!address.startsWith('rml.atom/')) throw new Error(`${context} must be an atom`);
    return address.slice('rml.atom/'.length);
  };
  const term = address => {
    if (address.startsWith('rml.atom/')) return atom(address, 'term');
    if (address === NIL || address.startsWith('rml.cons/')) return list(address, 'term').map(term);
    throw new Error(`term reference ${address} is not term structure`);
  };
  const entity = (address, kind) => {
    const row = node(address);
    if (row.source !== tagAddress(kind)) throw new Error(`expected a ${kind} reference at ${address}`);
    return row.target;
  };

  // Root, ontology membership and categories.
  const [ontologyRef, categoryList, foundationList, programList, judgementList, valueList] =
    tuple(entity(ROOT, 'closure'), 6, 'closure root');
  const ontologyMembers = new Set();
  const ontologyFacts = new Set();
  let ontology = null;
  if (ontologyRef !== NIL) {
    const [memberList, factList] = tuple(entity(ontologyRef, 'ontology'), 2, 'ontology');
    for (const member of list(memberList, 'ontology links')) ontologyMembers.add(member);
    for (const fact of list(factList, 'ontology facts')) ontologyFacts.add(fact);
    ontology = {
      links: [...ontologyMembers].map(address => ({ ...node(address) })),
      typeFacts: [...ontologyFacts].map(address => {
        const row = facts.get(address);
        if (!row) throw new Error(`ontology type fact ${address} is undefined`);
        return { ...row };
      }),
    };
  }
  const categories = list(categoryList, 'categories');
  if (categories.length !== CATEGORIES.length || categories.some((address, i) => address !== categoryAddress(CATEGORIES[i]))) {
    throw new Error('semantic closure must list every category in canonical order');
  }

  // Per-link identity rules.
  for (const row of snapshot.links) {
    const kind = nodeKind(row.address, ontologyMembers);
    if (kind === null) throw new Error(`unrepresented node ${row.address}`);
    if ((kind === 'atom' || kind === 'nil' || kind === 'category-root') && (row.source !== row.address || row.target !== row.address)) {
      throw new Error(`${row.address} must be a self-link`);
    }
    if (kind === 'cons' && row.address !== `rml.cons/${closureHash(row.source, row.target)}`) {
      throw new Error(`content address mismatch for ${row.address}`);
    }
    if (kind === 'cons' && row.target !== NIL && !row.target.startsWith('rml.cons/')) throw new Error(`${row.address} is an improper list`);
    if (ANONYMOUS.includes(kind) && (row.source !== tagAddress(kind) || row.address !== `rml.${kind}/${closureHash(row.source, row.target)}`)) {
      throw new Error(`content address mismatch for ${row.address}`);
    }
    if (kind === 'category') {
      const name = row.address.slice(CATEGORY_ROOT.length + 1);
      if (!CATEGORIES.includes(name)) throw new Error(`unknown category ${name}`);
      if (row.source !== CATEGORY_ROOT || row.target !== row.address) throw new Error(`${row.address} must be classified by ${CATEGORY_ROOT}`);
    }
  }

  // Records, named identities and back references.
  const programs = new Map();
  const rules = new Map();
  const rule = address => {
    if (rules.has(address)) return rules.get(address);
    const [owner, kindAtom, nameAtom, body] = tuple(entity(address, 'rule'), 4, `rule ${address}`);
    const kind = atom(kindAtom, 'rule kind');
    const name = atom(nameAtom, 'rule name');
    if (!owner.startsWith('rml.program/')) throw new Error(`rule ${address} must reference its program`);
    const program = owner.slice('rml.program/'.length);
    if (address !== ruleAddress(kind, program, name)) throw new Error(`identity mismatch for rule ${address}`);
    let decoded;
    if (kind === 'rewrite') {
      const [pattern, replacement] = tuple(body, 2, `rewrite ${address}`);
      decoded = { program, name, pattern: term(pattern), replacement: term(replacement) };
    } else if (kind === 'fact') {
      decoded = { program, name, judgement: term(tuple(body, 1, `fact ${address}`)[0]) };
    } else if (kind === 'inference') {
      const [premises, conclusion] = tuple(body, 2, `inference ${address}`);
      decoded = { program, name, premises: list(premises, 'premises').map(term), conclusion: term(conclusion) };
    } else throw new Error(`rule ${address} has unsupported kind ${kind}`);
    const result = { kind, owner, decoded };
    rules.set(address, result);
    return result;
  };
  for (const address of list(programList, 'programs')) {
    const [nameAtom, useList, ruleList] = tuple(entity(address, 'program'), 3, `program ${address}`);
    const name = atom(nameAtom, 'program name');
    if (address !== programAddress(name)) throw new Error(`identity mismatch for program ${address}`);
    if (programs.has(name)) throw new Error(`semantic closure repeats program ${name}`);
    const uses = list(useList, 'uses').map(use => {
      const [target, bindings] = tuple(use, 2, 'use');
      entity(target, 'program');
      return {
        program: target.slice('rml.program/'.length),
        rebindings: list(bindings, 'rebindings').map(pair => tuple(pair, 2, 'rebinding').map(item => atom(item, 'rebinding'))),
      };
    });
    const decoded = { name, uses, rewrites: [], facts: [], inferences: [] };
    const listed = new Set();
    for (const ruleRef of list(ruleList, `rules of ${name}`)) {
      if (listed.has(ruleRef)) throw new Error(`program ${name} repeats rule ${ruleRef}`);
      listed.add(ruleRef);
      const item = rule(ruleRef);
      if (item.owner !== address) throw new Error(`rule ${ruleRef} does not link back to program ${name}`);
      decoded[{ rewrite: 'rewrites', fact: 'facts', inference: 'inferences' }[item.kind]].push(item.decoded);
    }
    programs.set(name, decoded);
  }
  for (const row of snapshot.links) {
    if (row.address.startsWith('rml.rule/')) {
      const item = rule(row.address);
      const owner = programs.get(item.decoded.program);
      if (!owner) throw new Error(`rule ${row.address} references an unlisted program`);
    }
  }
  for (const [name, program] of programs) {
    const listedRules = new Set([...program.rewrites, ...program.facts, ...program.inferences].map(item => item.name));
    for (const [address, item] of rules) {
      if (item.decoded.program === name && !listedRules.has(item.decoded.name)) {
        throw new Error(`rule ${address} is not listed by its program`);
      }
    }
  }
  const foundations = list(foundationList, 'foundations').map(address => {
    const [nameAtom, versionAtom, dependencies, roles, signature, policy] =
      tuple(entity(address, 'foundation'), 6, `foundation ${address}`);
    const name = atom(nameAtom, 'foundation name');
    const version = atom(versionAtom, 'foundation version');
    if (address !== foundationAddress(name, version)) throw new Error(`identity mismatch for foundation ${address}`);
    const [cycleAtom, guards] = tuple(policy, 2, 'cycle policy');
    return {
      name,
      version,
      dependsOn: list(dependencies, 'dependencies').map(dependency => {
        const [depName, depVersion] = tuple(entity(dependency, 'foundation'), 6, 'dependency').slice(0, 2);
        return { name: atom(depName, 'foundation name'), version: atom(depVersion, 'foundation version') };
      }),
      roles: list(roles, 'roles').map(role => {
        const [roleAtom, program] = tuple(role, 2, 'role');
        entity(program, 'program');
        return { role: atom(roleAtom, 'role'), program: program.slice('rml.program/'.length) };
      }),
      signature: list(signature, 'signature').map(term),
      cyclePolicy: {
        kind: atom(cycleAtom, 'cycle policy'),
        guards: list(guards, 'guards').map(guard => {
          const item = rule(guard);
          if (item.kind !== 'inference') throw new Error(`guard ${guard} must reference an inference rule`);
          return { program: item.decoded.program, rule: item.decoded.name };
        }),
      },
    };
  });
  const listedFoundations = new Set(foundations.map(item => foundationAddress(item.name, item.version)));
  for (const row of snapshot.links) {
    if ((row.address.startsWith('rml.program/') && !programs.has(row.address.slice('rml.program/'.length))) ||
        (row.address.startsWith('rml.foundation/') && !listedFoundations.has(row.address))) {
      throw new Error(`named node ${row.address} is not listed by the closure root`);
    }
  }
  const proofs = new Map();
  const proof = (address, active = new Set()) => {
    if (proofs.has(address)) return proofs.get(address);
    if (active.has(address)) throw new Error(`proof ${address} is circular`);
    active.add(address);
    const [judgement, reference, roleAtom, premises] = tuple(entity(address, 'proof'), 4, `proof ${address}`);
    const role = atom(roleAtom, 'proof role');
    let program;
    let ruleName;
    const premiseProofs = list(premises, 'premises').map(premise => proof(premise, active));
    if (LABELLED_ROLES.has(role)) {
      [program, ruleName] = tuple(reference, 2, 'labelled proof leaf').map(item => atom(item, 'label'));
      if (premiseProofs.length !== 0) throw new Error(`labelled proof leaf ${address} has premises`);
    } else {
      const item = rule(reference);
      if (item.kind !== (premiseProofs.length === 0 ? 'fact' : 'inference')) {
        throw new Error(`proof ${address} references a rule of the wrong kind`);
      }
      ({ program, name: ruleName } = item.decoded);
    }
    active.delete(address);
    const decoded = { judgement: term(judgement), program, rule: ruleName, role, premises: premiseProofs };
    proofs.set(address, decoded);
    return decoded;
  };
  const judgements = list(judgementList, 'judgements').map(address => {
    const [instance, foundation, query, status, reason, assumptions, proofRef, answers] =
      tuple(entity(address, 'judgement'), 8, `judgement ${address}`);
    const [foundationName, foundationVersion] = tuple(entity(foundation, 'foundation'), 6, 'judgement foundation').slice(0, 2);
    return {
      instance: atom(instance, 'instance'),
      foundation: { name: atom(foundationName, 'foundation name'), version: atom(foundationVersion, 'foundation version') },
      query: term(query),
      status: atom(status, 'status'),
      reason: atom(reason, 'reason'),
      assumptions: list(assumptions, 'assumptions').map(term),
      proof: proofRef === NIL ? null : proof(proofRef),
      answers: answers === NIL ? null : list(tuple(answers, 1, 'answers')[0], 'answers').map(answer => {
        const [judgement, substitution, answerProof] = tuple(answer, 3, 'answer');
        return {
          judgement: term(judgement),
          bindings: list(entity(substitution, 'substitution'), 'substitution').map(binding => {
            const [variable, value] = tuple(binding, 2, 'binding');
            return [atom(variable, 'variable'), term(value)];
          }),
          proof: proof(answerProof),
        };
      }),
    };
  });
  const values = list(valueList, 'values').map(address => {
    const [program, input, normal, steps] = tuple(entity(address, 'value'), 4, `value ${address}`);
    entity(program, 'program');
    return {
      program: program.slice('rml.program/'.length), input: term(input), term: term(normal), steps: Number(atom(steps, 'steps')),
    };
  });

  // Reachability: nothing may hide outside the rooted network.
  const reachable = reachableFrom([ROOT], new Map(snapshot.links.map(row => [row.address, row])),
    new Map(snapshot.typeFacts.map(row => [row.address, row])));
  for (const row of snapshot.links) if (!reachable.links.has(row.address)) throw new Error(`unreachable node ${row.address}`);
  for (const row of snapshot.typeFacts) if (!reachable.facts.has(row.address)) throw new Error(`unreachable type fact ${row.address}`);

  // Category membership is linked data and must agree with structure.
  const members = Object.fromEntries(CATEGORIES.map(name => [name, 0]));
  const memberships = new Map();
  for (const row of snapshot.typeFacts) {
    if (row.address.startsWith('rml.typed/')) {
      if (!row.type.startsWith(`${CATEGORY_ROOT}/`) || row.address !== factAddress(row.subject, row.type)) {
        throw new Error(`content address mismatch for type fact ${row.address}`);
      }
      const category = row.type.slice(CATEGORY_ROOT.length + 1);
      const kind = nodeKind(row.subject, ontologyMembers);
      if (!(ALLOWED[kind] ?? []).includes(category)) throw new Error(`category spoofing: ${row.subject} cannot be typed ${category}`);
      members[category] += 1;
      memberships.set(row.subject, [...(memberships.get(row.subject) ?? []), category]);
    } else if (!ontologyFacts.has(row.address)) {
      throw new Error(`unrepresented type fact ${row.address}`);
    }
  }
  for (const row of snapshot.links) {
    const kind = nodeKind(row.address, ontologyMembers);
    const required = kind === 'atom' ? 'address' : kind === 'member' ? 'ontology'
      : ['program', 'rule', 'foundation', 'proof', 'substitution', 'judgement', 'value', 'ontology'].includes(kind) ? kind
        : kind === 'category' ? 'type' : null;
    if (required !== null && !(memberships.get(row.address) ?? []).includes(required)) {
      throw new Error(`${row.address} is missing its ${required} category`);
    }
  }
  for (const name of CATEGORIES) if (members[name] === 0) throw new Error(`semantic closure is missing category ${name}`);

  return {
    schema: SCHEMA,
    root: ROOT,
    links: snapshot.links.length,
    typeFacts: snapshot.typeFacts.length,
    categories: members,
    ontology,
    foundations,
    programs: [...programs.values()],
    judgements,
    values,
  };
}

function reconstructSemanticClosure(archive) {
  const { ontology, foundations, programs, judgements, values } = validateSemanticClosure(archive);
  return { ontology, foundations, programs, judgements, values };
}

const termKey = term => emitLinoTerm(term);

/**
 * Validate a foundation's declared universe and soundness contract through
 * public pattern queries of one instance. Every judgement checked is either
 * derived by the selected foundation or explicitly supplied by the caller.
 */
function validateUniverseContract(workspace, instance, { extraJudgements = [], bounds = {} } = {}) {
  const ask = query => workspace.ask(instance, query, bounds);
  const first = ask(['universe-policy', '?policy']);
  const report = {
    schema: UNIVERSE_SCHEMA,
    instance,
    foundation: { name: first.foundation.name, version: first.foundation.version },
    status: 'accepted',
    reason: 'declared-contract-holds',
    policy: null,
    typingJudgement: null,
    cumulative: false,
    universes: [],
    order: [],
    obligations: [],
    judgementsChecked: 0,
    consistency: 'not-established',
  };
  const stop = (status, reason) => Object.assign(report, { status, reason });
  const complete = result => (result.status === 'proved' || result.status === 'unknown') && result.complete === true;
  if (first.status === 'unsupported') return stop('not-declared', 'policy-outside-signature');
  if (!complete(first)) return stop('incomplete', 'policy-search-incomplete');
  const policies = first.status === 'proved' ? first.answers.map(answer => answer.judgement[1]) : [];
  if (policies.length === 0) return stop('not-declared', 'no-universe-policy');
  if (policies.length > 1) {
    report.obligations.push({
      name: 'single-universe-policy', source: 'policy', status: 'violated',
      witness: { judgement: null, cycle: [], terms: policies },
    });
    return stop('violated', 'conflicting-universe-policies');
  }
  const [policy] = policies;
  report.policy = policy;
  if (policy !== 'stratified' && policy !== 'type-in-type') return stop('unsupported', 'unsupported-universe-policy');

  const answersOf = (query, reason) => {
    const result = ask(query);
    if (result.status === 'unsupported' || !complete(result)) return { failed: reason };
    return { answers: result.status === 'proved' ? result.answers.map(answer => answer.judgement) : [] };
  };
  const typing = answersOf(['universe-typing-judgement', '?predicate'], 'typing-declaration-incomplete');
  if (typing.failed) return stop('incomplete', typing.failed);
  if (typing.answers.length !== 1 || typeof typing.answers[0][1] !== 'string') {
    return stop('unsupported', typing.answers.length === 0 ? 'typing-judgement-undeclared' : 'ambiguous-typing-judgement');
  }
  const predicate = typing.answers[0][1];
  report.typingJudgement = predicate;
  const cumulativity = answersOf(['universe-cumulativity', '?mode'], 'cumulativity-declaration-incomplete');
  if (cumulativity.failed) return stop('incomplete', cumulativity.failed);
  if (cumulativity.answers.some(answer => answer[1] !== 'cumulative') || cumulativity.answers.length > 1) {
    return stop('unsupported', 'unsupported-cumulativity');
  }
  report.cumulative = cumulativity.answers.length === 1;
  const declaredOrder = answersOf(['universe-below', '?lower', '?upper'], 'universe-order-incomplete');
  if (declaredOrder.failed) return stop('incomplete', declaredOrder.failed);
  const declared = answersOf(['soundness-contract', '?obligation'], 'soundness-contract-incomplete');
  if (declared.failed) return stop('incomplete', declared.failed);
  const typed = answersOf([predicate, '?term', '?type'], 'typing-judgements-incomplete');
  if (typed.failed) return stop('incomplete', typed.failed);

  const edges = declaredOrder.answers.map(answer => [answer[1], answer[2]]);
  const universes = new Map();
  for (const [lower, upper] of edges) { universes.set(termKey(lower), lower); universes.set(termKey(upper), upper); }
  const keys = [...universes.keys()].sort(order);
  report.universes = keys.map(key => universes.get(key));
  report.order = edges.map(([lower, upper]) => [lower, upper])
    .sort((x, y) => order(termKey(x[0]), termKey(y[0])) || order(termKey(x[1]), termKey(y[1])));
  const successors = new Map(keys.map(key => [key, new Set()]));
  for (const [lower, upper] of edges) successors.get(termKey(lower)).add(termKey(upper));
  const below = (lower, upper) => {
    const start = termKey(lower);
    const goal = termKey(upper);
    if (!successors.has(start)) return false;
    if (!report.cumulative) return successors.get(start).has(goal);
    const seen = new Set();
    const stack = [...successors.get(start)];
    while (stack.length > 0) {
      const key = stack.pop();
      if (key === goal) return true;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(...successors.get(key));
    }
    return false;
  };
  const judgements = [...typed.answers, ...extraJudgements.filter(item =>
    Array.isArray(item) && item.length === 3 && item[0] === predicate)];
  const universeJudgements = judgements.filter(item => universes.has(termKey(item[1])) && universes.has(termKey(item[2])));
  report.judgementsChecked = universeJudgements.length;

  const checks = {
    'well-founded-universe-order': () => {
      const state = new Map();
      const path = [];
      let cycle = null;
      const visit = key => {
        state.set(key, 'active');
        path.push(key);
        for (const next of [...successors.get(key)].sort(order)) {
          if (cycle !== null) break;
          if (state.get(next) === 'active') cycle = [...path.slice(path.indexOf(next)), next];
          else if (!state.has(next)) visit(next);
        }
        path.pop();
        state.set(key, 'done');
      };
      for (const key of keys) if (cycle === null && !state.has(key)) visit(key);
      return cycle === null ? null : { judgement: null, cycle: cycle.map(key => universes.get(key)), terms: [] };
    },
    'typing-respects-universe-order': () => {
      const bad = universeJudgements.find(item => !below(item[1], item[2]));
      return bad ? { judgement: bad, cycle: termKey(bad[1]) === termKey(bad[2]) ? [bad[1], bad[2]] : [], terms: [] } : null;
    },
    'no-universe-self-typing': () => {
      const bad = universeJudgements.find(item => termKey(item[1]) === termKey(item[2]));
      return bad ? { judgement: bad, cycle: [bad[1], bad[2]], terms: [] } : null;
    },
  };
  const required = new Map();
  if (policy === 'stratified') {
    required.set('well-founded-universe-order', 'policy');
    required.set('typing-respects-universe-order', 'policy');
  }
  for (const answer of declared.answers) {
    const name = typeof answer[1] === 'string' ? answer[1] : termKey(answer[1]);
    required.set(name, required.has(name) ? 'policy-and-declared' : 'declared');
  }
  for (const [name, source] of [...required].sort((x, y) => order(x[0], y[0]))) {
    if (!Object.hasOwn(checks, name)) {
      report.obligations.push({ name, source, status: 'unsupported', witness: null });
      continue;
    }
    const witness = checks[name]();
    report.obligations.push({ name, source, status: witness === null ? 'holds' : 'violated', witness });
  }
  if (report.obligations.some(item => item.status === 'violated')) return stop('violated', 'obligation-violated');
  if (report.obligations.some(item => item.status === 'unsupported')) return stop('unsupported', 'obligation-not-checkable');
  return stop('accepted', policy === 'type-in-type'
    ? 'accepted-relative-to-declared-type-in-type'
    : 'accepted-relative-to-declared-stratification');
}

export {
  CATEGORIES as SEMANTIC_CLOSURE_CATEGORIES,
  SemanticClosureBuilder,
  closureHash,
  projectSemanticClosure,
  reconstructSemanticClosure,
  validateSemanticClosure,
  validateUniverseContract,
};
