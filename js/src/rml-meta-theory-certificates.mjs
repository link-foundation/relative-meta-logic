/**
 * Replayable proof certificates for theorems of the pinned meta-theory corpus.
 *
 * A certificate is ordinary data for the natural-deduction linked proof
 * verifier (lib/meta-theory/proof-verifier-natural.lino, which reuses
 * lib/meta-theory/proof-verifier.lino). The trusted checker rebuilds every
 * logical part of the context itself: the theorem statement and every cited
 * lemma statement are recomputed by the native linked program from preserved
 * tokens, lemma rules are offered only for theorems among the theorem's
 * recorded dependency links, and the theorem's own binders are generalized
 * into fresh eigen-constants and hypotheses. The certificate may add only
 * instance rules whose validity the checker re-executes:
 *
 *   instance       (instance OWNER BINDER TERM): inert binding data
 *   conversion     (holds A) => (holds B) when A and B have the same normal
 *                  form under the conversion program (definitional unfolding)
 *   forall-intro   (holds B[eigen]) => (holds (mt-forall (mt-binder b D) B))
 *                  for an eigen-constant absent from the conclusion, the goal
 *                  and every hypothesis
 *   exists-intro   (holds B[W]) => (holds (mt-exists (mt-binder b D) B))
 *   local          (local ID (holds A)): an assumption that only its owning
 *                  induction or cases rule may discharge
 *   rewrite        (holds (mt-equal L R)), (holds A) => (holds B) where the
 *                  linked verifier checks that B is A with occurrences of L
 *                  replaced by R (or R by L); L and R are closed
 *   induction      (holds P[nil]), (discharge IH (holds P[cons h t])) =>
 *                  (holds P[x]) for a list-typed eigen-constant x, with IH
 *                  concluding (holds P[t]) and fresh eigen-constants h, t
 *   cases          (discharge E0 G), (discharge E1 G) => G for a list-typed
 *                  eigen-constant x, with E0 concluding x = nil and E1
 *                  concluding x = cons h t for fresh h, t
 *
 * Eigen-constant types come from the statement binders, from declared
 * parameter types for inferred binders, from quantifier domains and from the
 * induction and cases rules themselves; an induction or cases target must have
 * the list type the rule names under every declaration. After the linked
 * verifier accepts, the checker also requires that no undischarged local a
 * quantifier, induction or cases node depends on mentions its eigen-constants.
 *
 * The producer elaborates the source proof (Lean terms and `by intro/exact/rfl`,
 * `induction ... with` arms and goal-closing `simp`, Rocq intro/intros/unfold/
 * simpl/apply/exact/exists/split/reflexivity, `induction` and `destruct` of a
 * list) into a derivation. It is untrusted: whatever it emits must pass the
 * checker. Arithmetic decision procedures, iff rewriting, induction over
 * indexed families and tactic sequencing are reported as outside the
 * certificate fragment rather than approximated.
 */
import { LINKED_PROOF_NATURAL_PROGRAM, encodeLinkedProofData } from './rml-linked-proof.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';
import { META_THEORY_CONVERSION_PROGRAM, META_THEORY_NATIVE_PROGRAM } from './rml-meta-theory-native.mjs';

export const META_THEORY_CERTIFICATE_SCHEMA = 'rml-meta-theory-certificate/v1';
const MAX_STEPS = 200_000;
const VERIFIER_STEPS = 2_000_000;
const PROOF_LIMITS = Object.freeze({ maxDepth: 256, maxNodes: 1_000_000, maxTextBytes: 16_777_216 });
// Propositional connectives of the native prelude: a binder of such a type is a hypothesis.
const CONNECTIVES = new Set(['mt-equal', 'mt-not-equal', 'mt-and', 'mt-or', 'mt-not', 'mt-iff', 'mt-less',
  'mt-less-equal', 'mt-member', 'mt-forall', 'mt-exists']);
const PROP_TYPE = ['mt-v', 'mt-prop-type'];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const NIL = ['mt-v', 'mt-nil'];
const TRUE = ['mt-v', 'mt-true'];
const MOTIVE = 'mt-motive';

/**
 * Registries for statements/conversion and for the linked proof verifier;
 * `natural` is lib/meta-theory/proof-verifier-natural.lino.
 */
export function metaTheoryCertificateRegistries({ prelude, program, conversion, universal, verifier, natural }) {
  if (typeof natural !== 'string') throw new TypeError('certificate registries need the natural-deduction verifier source');
  return {
    native: LinkedProgramRegistry.fromRml(`${prelude}\n${program}\n${conversion}`, { executionBasis: 'direct-structural' }),
    verifier: LinkedProgramRegistry.fromRml(`${universal}\n${verifier}\n${natural}`, { executionBasis: 'direct-structural' }),
  };
}

export const eigen = bound => ['mt-v', ['mt-eigen', bound]];
const eigenName = term => (Array.isArray(term) && term.length === 2 && term[0] === 'mt-v' && Array.isArray(term[1]) &&
  term[1].length === 2 && term[1][0] === 'mt-eigen' && typeof term[1][1] === 'string' ? term[1][1] : undefined);

/** Replace every occurrence of a whole subterm. */
function replaceTerm(term, from, to) {
  if (same(term, from)) return to;
  return typeof term === 'string' ? term : term.map(item => replaceTerm(item, from, to));
}

function mentionsLocal(term) {
  if (typeof term === 'string') return false;
  if (term.length === 2 && term[0] === 'mt-local') return true;
  return term.some(mentionsLocal);
}

function bindsName(term, name) {
  if (typeof term === 'string') return false;
  if (term[0] === 'mt-binder' && term[1] === name) return true;
  return term.some(item => bindsName(item, name));
}

function substituteLocal(term, bound, replacement) {
  if (typeof term === 'string') return term;
  if (term.length === 2 && term[0] === 'mt-local' && term[1] === bound) return replacement;
  return term.map(item => substituteLocal(item, bound, replacement));
}

function occurs(term, part) {
  if (same(term, part)) return true;
  return Array.isArray(term) && term.some(item => occurs(item, part));
}

function hasVariable(term) {
  if (typeof term === 'string') return false;
  if (term.length === 2 && term[0] === 'variable') return true;
  return term.some(hasVariable);
}

/** Replace every remaining (mt-local b) by its eigen-constant. */
function closeLocals(term) {
  if (typeof term === 'string') return term;
  if (term.length === 2 && term[0] === 'mt-local') return eigen(term[1]);
  return term.map(closeLocals);
}

function normalize(registry, program, term) {
  return registry.reduceResult(program, term, { maxSteps: MAX_STEPS }).term;
}

/** The statement the native linked program elaborates for a theorem. */
export function theoremStatement(registries, address) {
  return normalize(registries.native, META_THEORY_NATIVE_PROGRAM, ['mt-statement', address]);
}

/**
 * Whether a binder type is a proposition (so the binder is a hypothesis): a
 * prelude connective, or an application whose declared result type, after
 * consuming the remaining arguments through arrow types, is Prop.
 */
export function isHypothesisType(registries, type) {
  if (!Array.isArray(type) || type[0] === 'mt-v') return false;
  if (CONNECTIVES.has(type[0])) return true;
  if (typeof type[0] !== 'string' || !type[0].startsWith('rml.formal.')) return false;
  const [head, ...args] = closeLocals(type);
  for (let supplied = args.length; supplied >= 0; supplied -= 1) {
    const result = normalize(registries.native, META_THEORY_NATIVE_PROGRAM, ['mt-result-type', head, ...args.slice(0, supplied)]);
    if (!Array.isArray(result) || result[0] !== 'mt-v') continue;
    let remaining = result[1];
    for (let index = supplied; index < args.length; index += 1) {
      if (!Array.isArray(remaining) || remaining[0] !== 'mt-arrow' || remaining.length !== 3) return false;
      remaining = remaining[2];
    }
    return remaining === 'mt-prop-type';
  }
  return false;
}

/** Leading binders of a statement, classified as data or hypothesis. */
export function statementBinders(registries, statement) {
  const binders = [];
  let body = statement;
  let premises = 0;
  for (;;) {
    if (Array.isArray(body) && body[0] === 'mt-forall' && body.length === 3 && body[1][0] === 'mt-binder') {
      const [, bound, type] = body[1];
      binders.push({ bound, type, kind: isHypothesisType(registries, type) ? 'hypothesis' : 'data' });
      body = body[2];
    } else if (Array.isArray(body) && body[0] === 'mt-arrow' && body.length === 3 && isHypothesisType(registries, body[1])) {
      // An implication premise is an anonymous hypothesis binder.
      binders.push({ bound: `mt-premise-${premises++}`, type: body[1], kind: 'hypothesis' });
      body = body[2];
    } else {
      return { binders, body };
    }
  }
}

/** Generalize a theorem: eigen-constants for data binders, hypothesis rules for the rest. */
export function generalizeTheorem(registries, address) {
  const statement = theoremStatement(registries, address);
  const { binders, body } = statementBinders(registries, statement);
  const close = term => binders.reduce((current, binder) =>
    binder.kind === 'data' ? substituteLocal(current, binder.bound, eigen(binder.bound)) : current, term);
  const hypotheses = binders.filter(binder => binder.kind === 'hypothesis')
    .map(binder => ['rule', `hypothesis:${binder.bound}`, [], ['holds', close(binder.type)]]);
  return { statement, binders, goal: ['holds', close(body)], hypotheses };
}

/** The schematic rule of a cited lemma: instance premises bind every data binder. */
export function lemmaRule(registries, address) {
  const { binders, body } = statementBinders(registries, theoremStatement(registries, address));
  const open = term => binders.reduce((current, binder) =>
    binder.kind === 'data' ? substituteLocal(current, binder.bound, ['variable', binder.bound]) : current, term);
  const premises = binders.map(binder => (binder.kind === 'data'
    ? ['instance', address, binder.bound, ['variable', binder.bound]]
    : ['holds', open(binder.type)]));
  return ['rule', `lemma:${address}`, premises, ['holds', open(body)]];
}

export const STRUCTURAL_RULES = Object.freeze([
  ['rule', 'and-intro', [['holds', ['variable', 'left']], ['holds', ['variable', 'right']]],
    ['holds', ['mt-and', ['variable', 'left'], ['variable', 'right']]]],
  ['rule', 'and-left', [['holds', ['mt-and', ['variable', 'left'], ['variable', 'right']]]], ['holds', ['variable', 'left']]],
  ['rule', 'and-right', [['holds', ['mt-and', ['variable', 'left'], ['variable', 'right']]]], ['holds', ['variable', 'right']]],
  ['rule', 'refl', [['instance', 'refl', 'term', ['variable', 'term']]],
    ['holds', ['mt-equal', ['variable', 'term'], ['variable', 'term']]]],
  ['rule', 'true-intro', [], ['holds', TRUE]],
]);

const INSTANCE_KINDS = new Set(['instance', 'conversion', 'forall-intro', 'exists-intro', 'local', 'rewrite', 'induction', 'cases']);

/** The value of a list built from eigen-constants h and t. */
export const consOf = (head, tail) => ['mt-cons', eigen(head), eigen(tail)];

/**
 * The declared type of an inferred binder: every corpus function the
 * statement applies directly to the binder declares a closed parameter type
 * (mt-parameter-type F k) in the conversion program; all such witnesses must
 * agree. Returns undefined when there is no witness or they disagree.
 */
export function inferredBinderType(registries, statement, bound) {
  const witnesses = [];
  const visit = term => {
    if (typeof term === 'string') return;
    if (typeof term[0] === 'string' && term[0].startsWith('rml.formal.')) {
      term.slice(1).forEach((argument, index) => {
        if (!same(argument, ['mt-local', bound])) return;
        const type = normalize(registries.native, META_THEORY_CONVERSION_PROGRAM, ['mt-parameter-type', term[0], String(index)]);
        if (Array.isArray(type) && type[0] !== 'mt-parameter-type') witnesses.push(type);
      });
    }
    term.forEach(visit);
  };
  visit(statement);
  if (!witnesses.length || witnesses.some(type => !same(type, witnesses[0]))) return undefined;
  return witnesses[0];
}

/** Declared types of the theorem's own data eigen-constants. */
export function theoremEigenTypes(registries, generalized) {
  const types = new Map();
  for (const binder of generalized.binders) {
    if (binder.kind !== 'data') continue;
    const type = binder.type === 'mt-inferred-domain'
      ? inferredBinderType(registries, generalized.statement, binder.bound) : closeLocals(binder.type);
    if (type !== undefined) types.set(binder.bound, [type]);
  }
  return types;
}

/** Every declared type of every eigen-constant: statement, quantifier, induction and cases. */
function eigenDeclarations(registries, generalized, entries) {
  const types = theoremEigenTypes(registries, generalized);
  const declare = (name, type) => {
    if (type === 'mt-inferred-domain') return;
    types.set(name, [...(types.get(name) ?? []), type]);
  };
  for (const entry of entries) {
    if (entry.kind === 'forall-intro') {
      const binder = entry.rule?.[3]?.[1]?.[1];
      if (Array.isArray(binder) && binder[0] === 'mt-binder') declare(binder[1], binder[2]);
    }
    if ((entry.kind === 'induction' || entry.kind === 'cases') && Array.isArray(entry.domain)) {
      declare(entry.head, ['mt-v', entry.domain[1]?.[1]]);
      declare(entry.tail, entry.domain);
    }
  }
  return types;
}

/** Shape and freshness of an induction or cases rule; its locals are checked by the owner check. */
function checkStructuralInduction(generalized, entry) {
  const { kind, rule, target, domain, head, tail } = entry;
  const id = rule[1];
  const name = eigenName(target);
  if (name === undefined) return `${id}: the ${kind} target must be an eigen-constant`;
  if (!Array.isArray(domain) || domain.length !== 2 || domain[0] !== 'mt-v' || !Array.isArray(domain[1]) ||
      domain[1].length !== 2 || domain[1][0] !== 'mt-list-type') return `${id}: the ${kind} domain must be a list type`;
  if (typeof head !== 'string' || typeof tail !== 'string' || head === tail || head === name || tail === name) {
    return `${id}: the ${kind} eigen-constants must be distinct names`;
  }
  const [, , premises, conclusion] = rule;
  const fresh = [eigen(head), eigen(tail)];
  const stale = term => fresh.some(constant => occurs(term, constant));
  if (stale(conclusion) || stale(generalized.goal) || generalized.hypotheses.some(stale)) {
    return `${id}: eigen-constant is not fresh`;
  }
  if (kind === 'induction') {
    const { motive, hypothesis } = entry;
    if (motive?.bound !== MOTIVE || !Array.isArray(motive.body) || bindsName(motive.body, MOTIVE)) return `${id}: malformed motive`;
    if (stale(motive.body)) return `${id}: the motive mentions the step eigen-constants`;
    const at = value => ['holds', substituteLocal(motive.body, MOTIVE, value)];
    const expected = [at(NIL), ['discharge', hypothesis, at(consOf(head, tail))]];
    if (!same(premises, expected)) return `${id}: premises are not the base and step cases of the motive`;
    if (!same(conclusion, at(target))) return `${id}: conclusion is not the motive at the target`;
    return undefined;
  }
  const [zero, one] = entry.equations ?? [];
  if (!same(premises, [['discharge', zero, conclusion], ['discharge', one, conclusion]])) {
    return `${id}: premises are not the two discharged cases of the conclusion`;
  }
  return undefined;
}

/** The conclusion each owned local must state. */
function ownedLocals(entry) {
  if (entry.kind === 'induction') {
    return [[entry.hypothesis, ['holds', substituteLocal(entry.motive.body, MOTIVE, eigen(entry.tail))]]];
  }
  if (entry.kind === 'cases') {
    return [[entry.equations[0], ['holds', ['mt-equal', entry.target, NIL]]],
      [entry.equations[1], ['holds', ['mt-equal', entry.target, consOf(entry.head, entry.tail)]]]];
  }
  return [];
}

/**
 * Check one instance rule supplied by a certificate. Returns a problem string
 * or undefined. `generalized` is the checker's own generalization.
 */
export function checkInstanceRule(registries, generalized, entry) {
  const { kind, rule } = entry ?? {};
  if (!INSTANCE_KINDS.has(kind)) return `unknown instance rule kind ${kind}`;
  if (kind === 'local') {
    if (!Array.isArray(rule) || rule.length !== 3 || rule[0] !== 'local' || typeof rule[1] !== 'string' ||
        !rule[1].startsWith('local:') || !Array.isArray(rule[2]) || rule[2][0] !== 'holds' || rule[2].length !== 2) {
      return 'malformed local';
    }
    return hasVariable(rule[2]) ? `${rule[1]}: locals must be ground` : undefined;
  }
  const sided = kind === 'rewrite';
  if (!Array.isArray(rule) || rule.length !== (sided ? 5 : 4) || rule[0] !== 'rule' || typeof rule[1] !== 'string' ||
      !rule[1].startsWith(`${kind}:`) || !Array.isArray(rule[2])) return 'malformed instance rule';
  const [, id, premises, conclusion] = rule;
  if (hasVariable(premises) || hasVariable(conclusion) || (sided && hasVariable(rule[4]))) return `${id}: instance rules must be ground`;
  if (kind === 'induction' || kind === 'cases') return checkStructuralInduction(generalized, entry);
  if (kind === 'rewrite') {
    const [equation, source] = premises;
    if (premises.length !== 2 || equation?.[0] !== 'holds' || equation.length !== 2 || !Array.isArray(equation[1]) ||
        equation[1][0] !== 'mt-equal' || equation[1].length !== 3 || source?.[0] !== 'holds' || source.length !== 2 ||
        conclusion[0] !== 'holds' || conclusion.length !== 2) return `${id}: expects an equation and a holds premise`;
    const [, left, right] = equation[1];
    if (mentionsLocal(left) || mentionsLocal(right)) return `${id}: rewritten terms must be closed`;
    const side = rule[4];
    const forward = same(side, ['congruent', left, right, source[1], conclusion[1]]);
    const backward = same(side, ['congruent', right, left, source[1], conclusion[1]]);
    // Only the shape is checked here; the congruence itself is checked by the linked verifier.
    return forward || backward ? undefined : `${id}: side condition does not restate the rewrite`;
  }
  if (kind === 'instance') {
    if (premises.length || conclusion.length !== 4 || conclusion[0] !== 'instance') return `${id}: malformed instance fact`;
    return undefined;
  }
  if (premises.length !== 1 || premises[0][0] !== 'holds' || conclusion[0] !== 'holds') return `${id}: expects one holds premise`;
  const premise = premises[0][1];
  const target = conclusion[1];
  if (kind === 'conversion') {
    const left = normalize(registries.native, META_THEORY_CONVERSION_PROGRAM, premise);
    const right = normalize(registries.native, META_THEORY_CONVERSION_PROGRAM, target);
    return same(left, right) ? undefined : `${id}: premise and conclusion are not convertible`;
  }
  if (kind === 'forall-intro' || kind === 'exists-intro') {
    const quantifier = kind === 'forall-intro' ? 'mt-forall' : 'mt-exists';
    if (target.length !== 3 || target[0] !== quantifier || target[1][0] !== 'mt-binder') return `${id}: conclusion is not ${quantifier}`;
    const bound = target[1][1];
    if (kind === 'forall-intro') {
      const constant = eigen(bound);
      if (!same(premise, substituteLocal(target[2], bound, constant))) return `${id}: premise is not the opened body`;
      if (occurs(target, constant) || occurs(generalized.goal, constant) ||
          generalized.hypotheses.some(hypothesis => occurs(hypothesis, constant))) {
        return `${id}: eigen-constant is not fresh`;
      }
      return undefined;
    }
    if (entry.witness === undefined || hasVariable(entry.witness)) return `${id}: missing ground witness`;
    return same(premise, substituteLocal(target[2], bound, entry.witness)) ? undefined : `${id}: premise is not the witnessed body`;
  }
  return `${id}: unknown instance rule kind ${kind}`;
}

/**
 * Check a certificate's instance rules together: each rule alone, unique ids,
 * every local owned by exactly one induction or cases rule that states it,
 * and induction and cases targets typed as the list type the rule names.
 */
export function checkInstanceRules(registries, generalized, entries) {
  const problems = [];
  const ids = new Set();
  for (const entry of entries) {
    const problem = checkInstanceRule(registries, generalized, entry);
    if (problem) problems.push(problem);
    if (ids.has(entry?.rule?.[1])) problems.push(`duplicate instance rule ${entry?.rule?.[1]}`);
    ids.add(entry?.rule?.[1]);
  }
  if (problems.length) return problems;
  const locals = new Map(entries.filter(entry => entry.kind === 'local').map(entry => [entry.rule[1], entry.rule[2]]));
  const owners = new Map();
  for (const entry of entries) {
    for (const [id, conclusion] of ownedLocals(entry)) {
      if (owners.has(id)) problems.push(`${id}: discharged by more than one rule`);
      owners.set(id, entry.rule[1]);
      if (!locals.has(id)) problems.push(`${entry.rule[1]}: missing local ${id}`);
      else if (!same(locals.get(id), conclusion)) problems.push(`${id}: local does not state what ${entry.rule[1]} assumes`);
    }
  }
  for (const id of locals.keys()) if (!owners.has(id)) problems.push(`${id}: local has no discharging rule`);
  const declarations = eigenDeclarations(registries, generalized, entries);
  for (const entry of entries) {
    if (entry.kind !== 'induction' && entry.kind !== 'cases') continue;
    const name = eigenName(entry.target);
    const types = declarations.get(name) ?? [];
    if (!types.length) problems.push(`${entry.rule[1]}: the type of eigen-constant ${name} is not declared`);
    else if (types.some(type => !same(type, entry.domain))) problems.push(`${entry.rule[1]}: eigen-constant ${name} is not of type ${JSON.stringify(entry.domain)}`);
  }
  return problems;
}

/**
 * Eigenvariable condition on the verified derivation: a forall-intro,
 * induction or cases node may not depend on an undischarged local that
 * mentions the eigen-constants it introduces.
 */
export function checkEigenScopes(entries, candidate) {
  const byId = new Map(entries.map(entry => [entry.rule[1], entry]));
  const problems = [];
  for (const node of Array.isArray(candidate?.[4]) ? candidate[4] : []) {
    const entry = byId.get(node[2]);
    if (!entry) continue;
    const introduced = entry.kind === 'forall-intro' ? [entry.rule[3][1][1][1]]
      : entry.kind === 'induction' || entry.kind === 'cases' ? [entry.head, entry.tail] : [];
    for (const dependency of Array.isArray(node[6]) ? node[6] : []) {
      const local = byId.get(dependency);
      if (local?.kind !== 'local') continue;
      if (introduced.some(name => occurs(local.rule[2], eigen(name)))) {
        problems.push(`${node[1]}: eigen-constant escapes through undischarged ${dependency}`);
      }
    }
  }
  return problems;
}

/** The exact context the checker trusts for a theorem and its validated instance rules. */
export function certificateContext(registries, address, theoremDependencies, generalized, instanceRules) {
  const lemmas = [...theoremDependencies].sort().map(dependency => lemmaRule(registries, dependency));
  return ['proof-context', ['rml-meta-theory', address],
    [...STRUCTURAL_RULES, ...generalized.hypotheses, ...lemmas, ...instanceRules.map(entry => entry.rule)]];
}

/**
 * Independently check a certificate. `theoremDependencies` are the recorded
 * dependency links of the theorem that are themselves theorems.
 */
export function checkMetaTheoryCertificate(registries, certificate, { theoremDependencies }) {
  const problems = [];
  if (certificate?.schema !== META_THEORY_CERTIFICATE_SCHEMA) return { accepted: false, problems: ['unsupported certificate schema'] };
  const address = certificate.theorem;
  if (theoremDependencies.includes(address)) problems.push('a theorem cannot cite itself');
  const generalized = generalizeTheorem(registries, address);
  if (!same(generalized.statement, certificate.statement)) problems.push('statement differs from the native elaboration');
  if (!same(generalized.goal, certificate.goal)) problems.push('goal differs from the generalized statement');
  const entries = Array.isArray(certificate.instanceRules) ? certificate.instanceRules : [];
  problems.push(...checkInstanceRules(registries, generalized, entries));
  const cited = (certificate.cites ?? []).filter(item => !theoremDependencies.includes(item));
  for (const item of cited) problems.push(`cites ${item}, which is not a recorded theorem dependency`);
  if (problems.length) return { accepted: false, problems };
  const context = certificateContext(registries, address, theoremDependencies, generalized, entries);
  const request = ['verify-linked-proof', encodeLinkedProofData(context, PROOF_LIMITS),
    encodeLinkedProofData(generalized.goal, PROOF_LIMITS), encodeLinkedProofData(certificate.candidate, PROOF_LIMITS)];
  const reduced = registries.verifier.reduceResult(LINKED_PROOF_NATURAL_PROGRAM, request, { maxSteps: VERIFIER_STEPS });
  const verified = Array.isArray(reduced.term) && reduced.term[0] === 'proof-accepted';
  const scopes = verified ? checkEigenScopes(entries, certificate.candidate) : [];
  const accepted = verified && scopes.length === 0;
  return {
    accepted,
    problems: accepted ? [] : verified ? scopes : ['linked proof verifier rejected the derivation'],
    result: reduced.term,
    steps: reduced.steps,
  };
}

// ---------------------------------------------------------------------------
// Producer: elaborate the source proof into a derivation (untrusted)

const LEAN_TACTICS = new Set(['intro', 'intros', 'exact', 'rfl', 'simp', 'induction', 'cases', 'rw', 'congr', 'apply',
  'unfold', 'constructor', 'omega', 'decide', 'sorry']);
const ROCQ_TACTICS = new Set(['intro', 'intros', 'unfold', 'simpl', 'apply', 'exact', 'exists', 'split', 'reflexivity', 'destruct',
  'induction']);
// Proofs of True: Rocq's constructor I and Lean's trivial/True.intro.
const TRUE_PROOFS = new Set(['I', 'trivial', 'True.intro']);

class Unsupported extends Error {}

/** Split a Lean tactic block at tactic words; `induction` owns every token after it (its arms). */
function leanSplit(tokens) {
  const tactics = [];
  let index = 0;
  while (index < tokens.length) {
    const word = tokens[index].text;
    if (!LEAN_TACTICS.has(word)) throw new Unsupported(`unexpected token ${word} in tactic block`);
    let end = index + 1;
    let depth = 0;
    while (end < tokens.length && word !== 'induction') {
      const text = tokens[end].text;
      if (['(', '[', '⟨', '{'].includes(text)) depth += 1;
      if ([')', ']', '⟩', '}'].includes(text)) depth -= 1;
      if (depth === 0 && LEAN_TACTICS.has(text)) break;
      end += 1;
    }
    if (word === 'induction') end = tokens.length;
    tactics.push({ word, tokens: tokens.slice(index + 1, end) });
    index = end;
  }
  return tactics;
}

function matchPattern(pattern, term, assignment, unknown) {
  if (Array.isArray(pattern) && pattern.length === 2 && pattern[0] === 'variable') {
    const name = pattern[1];
    if (!unknown.has(name)) return true;
    if (assignment.has(name)) return same(assignment.get(name), term);
    assignment.set(name, term);
    return true;
  }
  if (typeof pattern === 'string' || typeof term === 'string') return pattern === term;
  return pattern.length === term.length && pattern.every((item, index) => matchPattern(item, term[index], assignment, unknown));
}

function substituteVariables(term, assignment) {
  if (typeof term === 'string') return term;
  if (term.length === 2 && term[0] === 'variable' && assignment.has(term[1])) return assignment.get(term[1]);
  return term.map(item => substituteVariables(item, assignment));
}

class CertificateProducer {
  constructor(native, registries, address) {
    this.native = native;
    this.registries = registries;
    this.address = address;
    this.declaration = native.corpus.declarationAt(address);
    this.language = this.declaration.language;
    this.elaborator = native.proofElaborator(this.declaration);
    this.delta = new Map(native.conversionRules().map(rule => [rule.pattern[0], rule]));
    this.theoremDependencies = this.declaration.dependencies.filter(item => native.corpus.declarationAt(item)?.kind === 'theorem');
    this.generalized = generalizeTheorem(registries, address);
    this.types = theoremEigenTypes(registries, this.generalized);
    this.instanceRules = [];
    this.nodes = [];
    this.cites = new Set();
    this.counters = new Map();
  }

  fresh(kind) {
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    return `${kind}:${next}`;
  }

  node(rule, conclusion, premises, bindings = []) {
    const id = `n${this.nodes.length + 1}`;
    const record = { id, rule, conclusion, premises, bindings };
    this.nodes.push(record);
    return record;
  }

  instanceRule(kind, premises, conclusion, extra = {}, side = undefined) {
    const rule = ['rule', this.fresh(kind), premises, conclusion, ...(side ? [side] : [])];
    const entry = { kind, rule, ...extra };
    // The producer is untrusted, but it reports an unjustified step as outside
    // the fragment instead of emitting a certificate the checker must reject.
    const problem = checkInstanceRule(this.registries, this.generalized, entry);
    if (problem) throw new Unsupported(problem);
    this.instanceRules.push(entry);
    return rule[1];
  }

  /** A local assumption; its owning induction or cases rule discharges it. */
  local(conclusion) {
    const rule = ['local', this.fresh('local'), conclusion];
    this.instanceRules.push({ kind: 'local', rule });
    return rule[1];
  }

  trueIntro(goal) {
    return this.convert(this.node('true-intro', ['holds', TRUE], []), goal);
  }

  /** Rewrite `source` with an equation node, left to right or (backward) right to left. */
  rewrite(equation, source, conclusion, backward = false) {
    if (same(source.conclusion, conclusion)) return source;
    const [, left, right] = equation.conclusion[1];
    const side = backward ? ['congruent', right, left, source.conclusion[1], conclusion[1]]
      : ['congruent', left, right, source.conclusion[1], conclusion[1]];
    const id = this.instanceRule('rewrite', [equation.conclusion, source.conclusion], conclusion, {}, side);
    return this.node(id, conclusion, [equation, source]);
  }

  /** A fresh eigen-constant name derived from a source name. */
  freshEigen(name) {
    const taken = candidate => this.types.has(candidate) || occurs(this.generalized.goal, eigen(candidate)) ||
      this.generalized.hypotheses.some(hypothesis => occurs(hypothesis, eigen(candidate)));
    let candidate = name;
    for (let index = 1; taken(candidate); index += 1) candidate = `${name}-${index}`;
    return candidate;
  }

  /** The list type of an eigen-constant, or undefined. */
  listType(target) {
    const types = this.types.get(eigenName(target)) ?? [];
    const [type] = types;
    if (!types.length || types.some(item => !same(item, type))) return undefined;
    return Array.isArray(type) && type[0] === 'mt-v' && Array.isArray(type[1]) && type[1][0] === 'mt-list-type' ? type : undefined;
  }

  declare(name, type) {
    this.types.set(name, [...(this.types.get(name) ?? []), type]);
  }

  /**
   * Structural list induction on an eigen-constant. `solveNil(goal)` and
   * `solveCons(goal, head, tail, hypothesis)` prove the two cases; the
   * hypothesis is a node concluding the motive at the tail.
   */
  induction(goal, target, names, solveNil, solveCons) {
    const domain = this.listType(target);
    if (!domain) throw new Unsupported('induction target is not a list-typed eigen-constant');
    const body = replaceTerm(goal[1], target, ['mt-local', MOTIVE]);
    if (bindsName(body, MOTIVE)) throw new Unsupported('goal binds the motive name');
    const head = this.freshEigen(names[0]);
    this.declare(head, ['mt-v', domain[1][1]]);
    const tail = this.freshEigen(names[1]);
    this.declare(tail, domain);
    const at = value => ['holds', substituteLocal(body, MOTIVE, value)];
    const hypothesis = this.local(at(eigen(tail)));
    const base = this.convert(solveNil(at(NIL)), at(NIL));
    const step = this.convert(solveCons(at(consOf(head, tail)), head, tail, this.node(hypothesis, at(eigen(tail)), [])),
      at(consOf(head, tail)));
    const id = this.instanceRule('induction', [at(NIL), ['discharge', hypothesis, at(consOf(head, tail))]], goal,
      { target, motive: { bound: MOTIVE, body }, domain, head, tail, hypothesis });
    return this.node(id, goal, [base, step]);
  }

  /**
   * Case analysis of a list eigen-constant. `solve(goal, equation, head, tail)`
   * proves the goal with the target replaced by nil or by cons head tail;
   * the result is rewritten back with the case's equation.
   */
  cases(goal, target, names, solve) {
    const domain = this.listType(target);
    if (!domain) throw new Unsupported('destruct target is not a list-typed eigen-constant');
    const head = this.freshEigen(names[0]);
    this.declare(head, ['mt-v', domain[1][1]]);
    const tail = this.freshEigen(names[1]);
    this.declare(tail, domain);
    const values = [NIL, consOf(head, tail)];
    const equations = values.map(value => this.local(['holds', ['mt-equal', target, value]]));
    const branches = values.map((value, index) => {
      const equation = this.node(equations[index], ['holds', ['mt-equal', target, value]], []);
      const opened = replaceTerm(goal, target, value);
      const proof = this.convert(solve(opened, equation, index === 0 ? undefined : [head, tail]), opened);
      return this.rewrite(equation, proof, goal, true);
    });
    const id = this.instanceRule('cases', equations.map(equation => ['discharge', equation, goal]), goal,
      { target, domain, head, tail, equations });
    return this.node(id, goal, branches);
  }

  /** Rewrite every proof in scope that mentions the target with a case equation. */
  rewriteScope(scope, equation) {
    const [, target, value] = equation.conclusion[1];
    const inner = new Map();
    for (const [name, entry] of scope) {
      const proof = entry?.hypothesis || entry?.derived ? this.proofNamed(name, scope) : undefined;
      if (proof && occurs(proof.conclusion, target)) {
        inner.set(name, { derived: this.rewrite(equation, proof, replaceTerm(proof.conclusion, target, value)) });
      } else if (!same(entry, target)) {
        inner.set(name, entry);
      }
    }
    return inner;
  }

  /** Conclude exactly `goal` from a node, inserting a checked conversion when needed. */
  convert(node, goal) {
    if (!goal || same(node.conclusion, goal)) return node;
    const id = this.instanceRule('conversion', [node.conclusion], goal);
    return this.node(id, goal, [node]);
  }

  /** Unfold the head of a term by one definitional (delta) step, if possible. */
  unfoldHead(term) {
    if (!Array.isArray(term)) return undefined;
    const rule = this.delta.get(term[0]);
    if (!rule || rule.pattern.length !== term.length) return undefined;
    const assignment = new Map(rule.pattern.slice(1).map((variable, index) => [variable, term[index + 1]]));
    const replace = item => (typeof item === 'string' ? (assignment.has(item) ? assignment.get(item) : item) : item.map(replace));
    return replace(rule.replacement);
  }

  /**
   * View a proposition through head unfolding, or else through its normal form
   * under the conversion program, until its head is `head`.
   */
  view(proposition, head) {
    let current = proposition;
    for (let step = 0; step < 8 && current; step += 1) {
      if (Array.isArray(current) && current[0] === head) return current;
      current = this.unfoldHead(current);
    }
    const normal = normalize(this.registries.native, META_THEORY_CONVERSION_PROGRAM, proposition);
    if (Array.isArray(normal) && normal[0] === head) return normal;
    throw new Unsupported(`goal is not ${head}`);
  }

  /** Split a proof of a conjunction into proofs of its two sides. */
  andElim(node) {
    const conjunction = this.view(node.conclusion[1], 'mt-and');
    const source = this.convert(node, ['holds', conjunction]);
    const bindings = [['right', conjunction[2]], ['left', conjunction[1]]];
    return [this.node('and-left', ['holds', conjunction[1]], [source], bindings),
      this.node('and-right', ['holds', conjunction[2]], [source], bindings)];
  }

  proofNamed(name, scope) {
    const entry = scope.get(name);
    if (entry?.hypothesis) return this.node(entry.hypothesis[1], entry.hypothesis[3], []);
    if (entry?.derived) return entry.derived;
    return undefined;
  }

  /** First-order matching of a lemma conclusion against a goal, up to head unfolding. */
  matchUpTo(pattern, term, assignment, unknown) {
    const attempts = [];
    for (let left = pattern, i = 0; left && i < 6; left = this.unfoldHead(left), i += 1) {
      for (let right = term, j = 0; right && j < 6; right = this.unfoldHead(right), j += 1) attempts.push([left, right]);
    }
    // Finally the conversion normal form, which also unfolds recursive definitions on constructors.
    if (!hasVariable(term)) attempts.push([pattern, normalize(this.registries.native, META_THEORY_CONVERSION_PROGRAM, term)]);
    for (const [left, right] of attempts) {
      const trial = new Map(assignment);
      if (matchPattern(left, right, trial, unknown)) {
        for (const [key, item] of trial) assignment.set(key, item);
        return true;
      }
    }
    return false;
  }

  data(node, scope) {
    const before = this.elaborator.rules.length;
    const term = this.elaborator.term(node, scope);
    if (this.elaborator.rules.length !== before) throw new Unsupported('proof argument needs auxiliary rules');
    return term;
  }

  theoremNamed(name) {
    const found = this.elaborator.candidates(name).filter(item => item.kind === 'theorem');
    return found.length === 1 ? found[0].address : undefined;
  }

  /** Apply a cited lemma: explicit arguments, holes inferred against the goal and proofs. */
  lemma(address, args, scope, goal, solveHypothesis) {
    if (!this.theoremDependencies.includes(address)) throw new Unsupported(`${address} is not a recorded dependency`);
    this.cites.add(address);
    const rule = lemmaRule(this.registries, address);
    const { binders } = statementBinders(this.registries, theoremStatement(this.registries, address));
    const info = this.native.info.get(address);
    const implicit = new Set((info.signature?.binders ?? []).map((binder, index) => (binder.implicit ? binders[index]?.bound : undefined))
      .filter(Boolean));
    const unknown = new Set(binders.filter(binder => binder.kind === 'data').map(binder => binder.bound));
    const assignment = new Map();
    const proofArgs = new Map();
    let position = 0;
    for (const binder of binders) {
      if (implicit.has(binder.bound)) continue;
      if (position >= args.length) break;
      const arg = args[position++];
      if (arg.t === 'hole') continue;
      if (binder.kind === 'data') assignment.set(binder.bound, this.data(arg, scope));
      else proofArgs.set(binder.bound, arg);
    }
    if (position < args.length) throw new Unsupported(`too many arguments for ${address}`);
    const [, , premisePatterns, conclusionPattern] = rule;
    if (goal) this.matchUpTo(conclusionPattern[1], goal[1], assignment, unknown);
    const proofs = new Map();
    for (const [index, binder] of binders.entries()) {
      if (binder.kind !== 'hypothesis' || !proofArgs.has(binder.bound)) continue;
      const pattern = premisePatterns[index][1];
      const complete = [...unknown].every(name => !occurs(pattern, ['variable', name]) || assignment.has(name));
      const proof = this.term(proofArgs.get(binder.bound), scope, complete ? ['holds', substituteVariables(pattern, assignment)] : undefined);
      if (!complete) this.matchUpTo(pattern, proof.conclusion[1], assignment, unknown);
      proofs.set(binder.bound, proof);
    }
    for (const name of unknown) if (!assignment.has(name)) throw new Unsupported(`cannot infer ${name} of ${address}`);
    const premises = binders.map((binder, index) => {
      if (binder.kind === 'data') {
        const fact = ['instance', address, binder.bound, assignment.get(binder.bound)];
        return this.node(this.instanceRule('instance', [], fact), fact, []);
      }
      const expected = ['holds', substituteVariables(premisePatterns[index][1], assignment)];
      if (proofs.has(binder.bound)) return this.convert(proofs.get(binder.bound), expected);
      return this.convert(solveHypothesis(expected), expected);
    });
    const conclusion = ['holds', substituteVariables(conclusionPattern[1], assignment)];
    const bindings = binders.filter(binder => binder.kind === 'data').map(binder => [binder.bound, assignment.get(binder.bound)]).reverse();
    return this.convert(this.node(`lemma:${address}`, conclusion, premises, bindings), goal);
  }

  refl(goal) {
    const equality = this.view(goal[1], 'mt-equal');
    const fact = ['instance', 'refl', 'term', equality[1]];
    const instance = this.node(this.instanceRule('instance', [], fact), fact, []);
    const conclusion = ['holds', ['mt-equal', equality[1], equality[1]]];
    return this.convert(this.node('refl', conclusion, [instance], [['term', equality[1]]]), goal);
  }

  andIntro(goal, proveLeft, proveRight) {
    const conjunction = this.view(goal[1], 'mt-and');
    const left = proveLeft(['holds', conjunction[1]]);
    const right = proveRight(['holds', conjunction[2]]);
    const conclusion = ['holds', ['mt-and', left.conclusion[1], right.conclusion[1]]];
    return this.convert(this.node('and-intro', conclusion, [left, right], [['right', right.conclusion[1]], ['left', left.conclusion[1]]]), goal);
  }

  existsIntro(goal, witness, proveBody) {
    const quantifier = this.view(goal[1], 'mt-exists');
    const [, [, bound], body] = quantifier;
    const opened = ['holds', substituteLocal(body, bound, witness)];
    const child = this.convert(proveBody(opened), opened);
    const id = this.instanceRule('exists-intro', [opened], ['holds', quantifier], { witness });
    return this.convert(this.node(id, ['holds', quantifier], [child]), goal);
  }

  forallIntro(goal, name, scope, proveBody) {
    const quantifier = this.view(goal[1], 'mt-forall');
    const [, [, bound], body] = quantifier;
    const opened = ['holds', substituteLocal(body, bound, eigen(bound))];
    if (quantifier[1][2] !== 'mt-inferred-domain') this.declare(bound, quantifier[1][2]);
    const inner = new Map(scope);
    if (name) inner.set(name, eigen(bound));
    const child = this.convert(proveBody(opened, inner), opened);
    const id = this.instanceRule('forall-intro', [opened], ['holds', quantifier]);
    return this.convert(this.node(id, ['holds', quantifier], [child]), goal);
  }

  /** Elaborate a Lean/Rocq proof term against an optional goal. */
  term(node, scope, goal) {
    if (node.t === 'name' && node.name === 'rfl') return this.refl(goal);
    if (node.t === 'name' && TRUE_PROOFS.has(node.name) && !this.proofNamed(node.name, scope)) return this.trueIntro(goal);
    if (node.t === 'name' && this.proofNamed(node.name, scope)) return this.convert(this.proofNamed(node.name, scope), goal);
    if (node.t === 'name' || (node.t === 'app' && node.fn.t === 'name')) {
      const name = node.t === 'name' ? node.name : node.fn.name;
      const address = this.theoremNamed(name);
      if (!address) throw new Unsupported(`proof term ${name} is not a cited theorem`);
      return this.lemma(address, node.t === 'name' ? [] : node.args, scope, goal,
        () => { throw new Unsupported(`missing proof argument for ${address}`); });
    }
    if (node.t === 'anonymous') {
      if (!goal) throw new Unsupported('anonymous constructor needs an expected proposition');
      const [first, ...rest] = node.items;
      const remainder = rest.length === 1 ? rest[0] : { t: 'anonymous', items: rest };
      const head = Array.isArray(goal[1]) ? goal[1][0] : undefined;
      if (head === 'mt-exists' || (head !== 'mt-and' && this.tryView(goal[1], 'mt-exists'))) {
        return this.existsIntro(goal, this.data(first, scope), opened => this.term(remainder, scope, opened));
      }
      return this.andIntro(goal, left => this.term(first, scope, left), right => this.term(remainder, scope, right));
    }
    if (node.t === 'fun') {
      if (!goal) throw new Unsupported('lambda proof needs an expected proposition');
      const [param, ...params] = node.params;
      const body = params.length ? { t: 'fun', params, body: node.body } : node.body;
      return this.forallIntro(goal, param.name, scope, (opened, inner) => this.term(body, inner, opened));
    }
    throw new Unsupported(`proof form ${node.t} is outside the certificate fragment`);
  }

  tryView(proposition, head) {
    try { return this.view(proposition, head); } catch { return undefined; }
  }

  /** Signature binder names are bound to their eigen-constants; others wait for intro. */
  initialScope() {
    const scope = new Map();
    const info = this.native.info.get(this.address);
    const names = (info.signature?.binders ?? []).map(binder => binder.name);
    const pending = [];
    this.generalized.binders.forEach((binder, index) => {
      const value = binder.kind === 'data' ? eigen(binder.bound)
        : { hypothesis: this.generalized.hypotheses.find(rule => rule[1] === `hypothesis:${binder.bound}`) };
      if (index < names.length) scope.set(names[index], value);
      else pending.push(value);
    });
    return { scope, pending };
  }

  leanProof() {
    const tokens = this.declaration.proof;
    const { scope, pending } = this.initialScope();
    if (tokens[0]?.text !== 'by') {
      const reader = this.elaborator.reader(tokens);
      const node = reader.expression();
      reader.end();
      return this.leanTerm(node, scope, pending);
    }
    return this.leanTactics(leanSplit(tokens.slice(1)), this.generalized.goal, scope, pending);
  }

  leanTerm(node, scope, pending) {
    if (node.t === 'fun' && pending.length) {
      const [param, ...params] = node.params;
      const inner = new Map(scope);
      inner.set(param.name, pending[0]);
      const body = params.length ? { t: 'fun', params, body: node.body } : node.body;
      return this.leanTerm(body, inner, pending.slice(1));
    }
    return this.term(node, scope, this.generalized.goal);
  }

  leanTactics(tactics, goal, scope, pending) {
    const [tactic, ...rest] = tactics;
    if (!tactic) throw new Unsupported('tactic block ends with open goals');
    if (tactic.word === 'intro' || tactic.word === 'intros') {
      let inner = new Map(scope);
      let queue = pending;
      for (const token of tactic.tokens) {
        if (!queue.length) {
          return this.forallIntro(goal, token.text, inner, (opened, scoped) =>
            this.leanTactics([{ word: 'intro', tokens: tactic.tokens.slice(tactic.tokens.indexOf(token) + 1) }, ...rest], opened, scoped, []));
        }
        inner.set(token.text, queue[0]);
        queue = queue.slice(1);
      }
      return this.leanTactics(rest, goal, inner, queue);
    }
    if (tactic.word === 'induction') return this.leanInduction(tactic.tokens, goal, scope, pending);
    // A simp followed by further tactics only rewrites the goal definitionally,
    // which conversion re-establishes; a final simp must close the goal.
    if (tactic.word === 'simp' && rest.length) return this.leanTactics(rest, goal, scope, pending);
    if (rest.length) throw new Unsupported(`tactic ${tactic.word} followed by further tactics`);
    if (tactic.word === 'simp') {
      try {
        return this.trueIntro(goal);
      } catch (error) {
        if (error instanceof Unsupported) throw new Unsupported('simp does not close the goal by conversion');
        throw error;
      }
    }
    if (tactic.word === 'rfl' && !tactic.tokens.length) return this.refl(goal);
    if (tactic.word === 'exact') {
      const reader = this.elaborator.reader(tactic.tokens);
      const node = reader.expression();
      reader.end();
      return this.term(node, scope, goal);
    }
    throw new Unsupported(`tactic ${tactic.word} is outside the certificate fragment`);
  }

  /** `induction x with | nil => tactics | cons h t ih => tactics` on a list eigen-constant. */
  leanInduction(tokens, goal, scope, pending) {
    const texts = tokens.map(token => token.text);
    const value = scope.get(texts[0]);
    if (!Array.isArray(value) || texts[1] !== 'with' || texts[2] !== '|') {
      throw new Unsupported('induction is outside the certificate fragment except list induction with nil and cons arms');
    }
    const arms = new Map();
    let start = 3;
    for (let index = 3; index <= texts.length; index += 1) {
      if (index < texts.length && texts[index] !== '|') continue;
      const arm = tokens.slice(start, index);
      const arrow = arm.findIndex(token => token.text === '=>');
      if (arrow < 1) throw new Unsupported('malformed induction arm');
      arms.set(arm[0].text, { names: arm.slice(1, arrow).map(token => token.text), tactics: leanSplit(arm.slice(arrow + 1)) });
      start = index + 1;
    }
    const nil = arms.get('nil');
    const cons = arms.get('cons');
    if (arms.size !== 2 || !nil || !cons || nil.names.length || cons.names.length !== 3) {
      throw new Unsupported('induction arms must be nil and cons h t ih');
    }
    return this.induction(goal, value, cons.names, opened => this.leanTactics(nil.tactics, opened, scope, pending),
      (opened, head, tail, hypothesis) => {
        const inner = new Map(scope);
        inner.set(cons.names[0], eigen(head));
        inner.set(cons.names[1], eigen(tail));
        inner.set(cons.names[2], { derived: hypothesis });
        return this.leanTactics(cons.tactics, opened, inner, pending);
      });
  }

  rocqProof() {
    const sentences = [];
    let current = [];
    let depth = 0;
    for (const token of this.declaration.proof) {
      if (token.text === '(') depth += 1;
      if (token.text === ')') depth -= 1;
      if (token.text === '.' && depth === 0) { sentences.push(current); current = []; continue; }
      current.push(token);
    }
    if (current.length) throw new Unsupported('unterminated proof sentence');
    const script = sentences.filter(sentence => !(sentence.length === 1 && ['Proof', 'Qed'].includes(sentence[0].text)))
      .map(sentence => {
        let start = 0;
        while (['-', '+', '*'].includes(sentence[start]?.text)) start += 1;
        return sentence.slice(start);
      });
    if (script.some(sentence => sentence.some(token => token.text === ';'))) throw new Unsupported('tactic sequencing with ; is outside the certificate fragment');
    const { scope, pending } = this.initialScope();
    const queue = [...script];
    const node = this.rocqSolve(queue, this.generalized.goal, scope, pending);
    if (queue.length) throw new Unsupported(`unused tactics after the proof: ${queue[0].map(token => token.text).join(' ')}`);
    return node;
  }

  rocqSolve(queue, goal, scope, pending) {
    const sentence = queue.shift();
    if (!sentence) throw new Unsupported('proof script ends with open goals');
    const [head, ...args] = sentence;
    const word = head.text;
    if (!ROCQ_TACTICS.has(word)) throw new Unsupported(`tactic ${word} is outside the certificate fragment`);
    const expression = () => {
      const reader = this.elaborator.reader(args);
      const node = reader.expression();
      reader.end();
      return node;
    };
    switch (word) {
      case 'intro':
      case 'intros': {
        let inner = new Map(scope);
        let rest = pending;
        for (const [index, { text: name }] of args.entries()) {
          if (!rest.length) {
            const remaining = args.slice(index + 1);
            return this.forallIntro(goal, name, inner, (opened, scoped) => {
              if (remaining.length) queue.unshift([{ text: 'intros', kind: 'identifier' }, ...remaining]);
              return this.rocqSolve(queue, opened, scoped, []);
            });
          }
          inner.set(name, rest[0]);
          rest = rest.slice(1);
        }
        return this.rocqSolve(queue, goal, inner, rest);
      }
      case 'unfold':
      case 'simpl':
        return this.rocqSolve(queue, goal, scope, pending);
      case 'induction': {
        // List induction: induction l as [ | h t IH ], introducing l first when it is still pending.
        const texts = args.map(token => token.text);
        if (texts.length !== 8 || texts[1] !== 'as' || texts[2] !== '[' || texts[3] !== '|' || texts[7] !== ']') {
          throw new Unsupported('induction is outside the certificate fragment except induction l as [ | h t IH ]');
        }
        let inner = scope;
        let rest = pending;
        if (!scope.has(texts[0]) && Array.isArray(pending[0])) {
          inner = new Map(scope);
          inner.set(texts[0], pending[0]);
          rest = pending.slice(1);
        }
        const value = inner.get(texts[0]);
        if (!Array.isArray(value)) throw new Unsupported(`induction target ${texts[0]} is not a data variable`);
        const [, , , , head, tail, hypothesisName] = texts;
        return this.induction(goal, value, [head, tail], opened => this.rocqSolve(queue, opened, inner, rest),
          (opened, headName, tailName, hypothesis) => {
            const step = new Map(inner);
            step.set(head, eigen(headName));
            step.set(tail, eigen(tailName));
            step.set(hypothesisName, { derived: hypothesis });
            return this.rocqSolve(queue, opened, step, rest);
          });
      }
      case 'destruct': {
        const texts = args.map(token => token.text);
        if (Array.isArray(scope.get(texts[0]))) {
          // Case analysis of a list: destruct l as [ | h t ].
          if (texts.length !== 7 || texts[1] !== 'as' || texts[2] !== '[' || texts[3] !== '|' || texts[6] !== ']') {
            throw new Unsupported('destruct of data is outside the certificate fragment except destruct l as [ | h t ]');
          }
          return this.cases(goal, scope.get(texts[0]), [texts[4], texts[5]], (opened, equation, eigens) => {
            const inner = this.rewriteScope(scope, equation);
            if (eigens) {
              inner.set(texts[4], eigen(eigens[0]));
              inner.set(texts[5], eigen(eigens[1]));
            }
            return this.rocqSolve(queue, opened, inner, pending);
          });
        }
        // Otherwise only conjunction hypotheses: destruct H as [ A B ].
        const proof = this.proofNamed(texts[0], scope);
        if (!proof || texts[1] !== 'as' || texts[2] !== '[' || texts[5] !== ']' || texts.length !== 6) {
          throw new Unsupported('destruct is outside the certificate fragment except for conjunction hypotheses');
        }
        const [left, right] = this.andElim(proof);
        const inner = new Map(scope);
        if (texts[3] !== '_') inner.set(texts[3], { derived: left });
        if (texts[4] !== '_') inner.set(texts[4], { derived: right });
        return this.rocqSolve(queue, goal, inner, pending);
      }
      case 'reflexivity':
        return this.refl(goal);
      case 'exact':
        return this.term(expression(), scope, goal);
      case 'apply': {
        const node = expression();
        const name = node.t === 'name' ? node.name : node.fn?.name;
        const address = this.theoremNamed(name);
        if (!address) throw new Unsupported(`apply target ${name} is not a cited theorem`);
        return this.lemma(address, node.t === 'name' ? [] : node.args, scope, goal,
          expected => this.rocqSolve(queue, expected, scope, []));
      }
      case 'exists':
        return this.existsIntro(goal, this.data(expression(), scope), opened => this.rocqSolve(queue, opened, scope, []));
      case 'split':
        return this.andIntro(goal, left => this.rocqSolve(queue, left, scope, []), right => this.rocqSolve(queue, right, scope, []));
      default:
        throw new Unsupported(`tactic ${word} is outside the certificate fragment`);
    }
  }

  candidate(root) {
    const dependencies = new Map();
    const reachable = [];
    const premisesOf = new Map(this.instanceRules.filter(entry => entry.rule[0] === 'rule').map(entry => [entry.rule[1], entry.rule[2]]));
    const visit = node => {
      if (dependencies.has(node.id)) return dependencies.get(node.id);
      const list = [node.rule];
      node.premises.forEach((premise, index) => {
        // A discharging premise removes its local from that premise's dependencies.
        const pattern = premisesOf.get(node.rule)?.[index];
        const discharged = Array.isArray(pattern) && pattern[0] === 'discharge' ? pattern[1] : undefined;
        for (const item of visit(premise)) if (item !== discharged && !list.includes(item)) list.push(item);
      });
      dependencies.set(node.id, list);
      reachable.push(node);
      return list;
    };
    visit(root);
    const context = certificateContext(this.registries, this.address, this.theoremDependencies, this.generalized, this.instanceRules);
    const nodes = reachable.map(node => ['node', node.id, node.rule, node.conclusion, node.bindings,
      node.premises.map(premise => premise.id), dependencies.get(node.id)]);
    return ['proof', context, this.generalized.goal, root.id, nodes, dependencies.get(root.id)];
  }
}

/**
 * Produce a certificate for a theorem from its preserved source proof, or a
 * precise reason why the proof is outside the certificate fragment.
 */
export function produceMetaTheoryCertificate(native, registries, address) {
  const producer = new CertificateProducer(native, registries, address);
  let root;
  try {
    root = producer.language === 'lean' ? producer.leanProof() : producer.rocqProof();
  } catch (error) {
    return { theorem: address, status: 'outside-fragment', reason: error.message };
  }
  root = producer.convert(root, producer.generalized.goal);
  // Drop instance rules that the final derivation does not use.
  const candidate = producer.candidate(root);
  const used = new Set(candidate[4].map(node => node[2]));
  // Locals stay when a used rule discharges them, even if no node cites them.
  for (const entry of producer.instanceRules) {
    if (used.has(entry.rule[1])) for (const [id] of ownedLocals(entry)) used.add(id);
  }
  producer.instanceRules = producer.instanceRules.filter(entry => used.has(entry.rule[1]));
  return {
    theorem: address,
    status: 'produced',
    certificate: {
      schema: META_THEORY_CERTIFICATE_SCHEMA,
      theorem: address,
      statement: producer.generalized.statement,
      goal: producer.generalized.goal,
      cites: [...producer.cites].sort(),
      instanceRules: producer.instanceRules,
      candidate: producer.candidate(root),
    },
    theoremDependencies: producer.theoremDependencies,
  };
}
