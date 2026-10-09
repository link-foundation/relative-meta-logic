/** Generic bounded first-order Horn resolution. No RML/theory predicates are built in. */
import { parseLino, parseOne, tokenizeOne } from './rml-links.mjs';

export const HORN_OPERATIONS = Object.freeze([
  'horn-freshen-clause', 'horn-unify', 'horn-resolve-goal', 'horn-project-answer',
]);
const variable = value => value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.variable === 'string';
const key = term => Array.isArray(term) && typeof term[0] === 'string' ? `${term.length}:${term[0]}` : null;

function checkData(term, { maxNodes = 1_000_000, maxDepth = 512 } = {}) {
  let count = 0;
  const pending = [[term, 0, false]];
  const ancestors = new Set();
  while (pending.length) {
    const [value, depth, leave] = pending.pop();
    if (leave) { ancestors.delete(value); continue; }
    if (++count > maxNodes || depth > maxDepth) throw new Error('Horn input size/depth bound exceeded');
    if (typeof value === 'string') continue;
    if (!Array.isArray(value) || ancestors.has(value)) throw new Error('Horn input must be a finite string/list term');
    ancestors.add(value); pending.push([value, depth, true]);
    for (let i = value.length - 1; i >= 0; --i) pending.push([value[i], depth + 1, false]);
  }
}
const groundTerms = new WeakSet();
const syntacticallyGround = term => typeof term === 'string' || Array.isArray(term) && groundTerms.has(term);
let variableSerial = 0;
function sourceTerm(term, scope, variables = new Map()) {
  if (typeof term === 'string') {
    if (!term.startsWith('?') || term.length < 2) return term;
    if (!variables.has(term)) variables.set(term, { variable: `${scope}:${term.slice(1)}`, birth: ++variableSerial });
    return variables.get(term);
  }
  const result = term.map(value => sourceTerm(value, scope, variables));
  if (result.every(syntacticallyGround)) groundTerms.add(result);
  return result;
}
function walk(term, bindings) {
  while (variable(term) && bindings.has(term)) term = bindings.get(term);
  return term;
}
// Eagerly resolve already-bound children before storing a new binding. The
// resulting immutable ground subtrees can safely skip future occurs scans.
// This is generic finite-tree unification, independent of every predicate.
function bindingValue(forbidden, term, bindings, depth = 0) {
  if (depth > 512) throw new Error('Horn binding depth bound exceeded');
  const value = walk(term, bindings);
  if (syntacticallyGround(value)) return value;
  if (variable(value)) return value === forbidden ? null : value;
  const children = [];
  let changed = false;
  for (const child of value) {
    const result = bindingValue(forbidden, child, bindings, depth + 1);
    if (result === null) return null;
    children.push(result); changed ||= result !== child;
  }
  const result = changed ? children : value;
  if (children.every(syntacticallyGround)) groundTerms.add(result);
  return result;
}
function unify(left, right, bindings, trail) {
  const pending = [[left, right]];
  while (pending.length) {
    let [a, b] = pending.pop(); a = walk(a, bindings); b = walk(b, bindings);
    if (a === b) continue;
    if (variable(a) || variable(b)) {
      if (!variable(a)) [a, b] = [b, a];
      const value = bindingValue(a, b, bindings);
      if (value === null) return false;
      bindings.set(a, value); trail.push(a);
    } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      for (let i = a.length - 1; i >= 0; --i) pending.push([a[i], b[i]]);
    } else return false;
  }
  return true;
}
// Read-only, conservative constructor discrimination. Variables remain
// wildcards, so this index cannot prune a unifiable clause.
function compatible(pattern, goal, bindings) {
  const captured = new Map(), pending = [[pattern, goal]];
  const samePossible = (a, b) => {
    const pairs = [[a, b]];
    while (pairs.length) {
      let [x, y] = pairs.pop(); x = walk(x, bindings); y = walk(y, bindings);
      if (variable(x) || variable(y) || x === y) continue;
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) pairs.push([x[i], y[i]]);
    }
    return true;
  };
  while (pending.length) {
    const [p, raw] = pending.pop(), value = walk(raw, bindings);
    if (typeof p === 'string' && p.startsWith('?') && p.length > 1) {
      if (captured.has(p) && !samePossible(captured.get(p), value)) return false;
      captured.set(p, value); continue;
    }
    if (variable(value)) continue;
    if (typeof p === 'string') { if (p !== value) return false; }
    else { if (!Array.isArray(value) || value.length !== p.length) return false; for (let i = 0; i < p.length; i++) pending.push([p[i], value[i]]); }
  }
  return true;
}
function project(term, bindings, depth = 0) {
  if (depth > 512) throw new Error('Horn answer depth bound exceeded');
  const value = walk(term, bindings);
  if (variable(value)) return `?${value.variable}`;
  return Array.isArray(value) ? value.map(child => project(child, bindings, depth + 1)) : value;
}
function budget(options = {}) {
  const { maxSteps = 1_000_000, maxDepth = 2048, maxAnswers = 1, disabledOperations = [] } = options;
  for (const n of [maxSteps, maxDepth, maxAnswers]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Horn bounds must be positive safe integers');
  const disabled = new Set(disabledOperations), observed = new Set();
  let steps = 0;
  return { maxDepth, maxAnswers, observed, get steps() { return steps; },
    observe(operation) {
      if (disabled.has(operation)) throw new Error(`disabled host semantic operation ${operation}`);
      observed.add(operation);
      if (++steps > maxSteps) throw new Error('Horn resolution step bound exceeded');
    },
  };
}

export class HornResolution {
  #clauses; #byId; #index;
  constructor(clauses) {
    if (!Array.isArray(clauses) || clauses.length === 0 || clauses.length > 10_000) throw new Error('invalid Horn clause count');
    this.#clauses = clauses.map(({ name, head, body = [] }) => {
      if (typeof name !== 'string' || name.length === 0 || !Array.isArray(head) || typeof head[0] !== 'string' || head[0].startsWith('?') || !Array.isArray(body)) throw new Error('invalid Horn clause');
      checkData([head, ...body]);
      for (const goal of body) if (!Array.isArray(goal) || typeof goal[0] !== 'string' || goal[0].startsWith('?')) throw new Error('Horn goals require a declared predicate symbol');
      return { name, head: structuredClone(head), body: structuredClone(body) };
    });
    this.#byId = new Map(this.#clauses.map(clause => [clause.name, clause]));
    if (this.#byId.size !== this.#clauses.length) throw new Error('duplicate Horn clause name');
    this.#index = new Map();
    for (const clause of this.#clauses) { const k = key(clause.head); if (!this.#index.has(k)) this.#index.set(k, []); this.#index.get(k).push(clause); }
  }
  static fromSource(source) {
    if (typeof source !== 'string' || source.length > 16_777_216) throw new Error('Horn source size bound exceeded');
    const forms = parseLino(source.replace(/^[ \t]+/gm, '')).map(form => parseOne(tokenizeOne(form)));
    const clauses = forms.map(form => {
      if (!Array.isArray(form) || form.length < 3 || form[0] !== 'horn-clause') throw new Error('expected horn-clause source declaration');
      return { name: form[1], head: form[2], body: form.slice(3) };
    });
    return new HornResolution(clauses);
  }
  clauses() { return structuredClone(this.#clauses); }
  query(goal, options = {}) {
    checkData(goal);
    const state = budget(options), bindings = new WeakMap(), trail = [], events = [], choices = [], answers = [];
    const query = sourceTerm(goal, 'query');
    let goals = [{ term: query, id: 0, depth: 0 }], fresh = 0, proofId = 0, exhausted = false;
    const rollback = mark => { while (trail.length > mark) bindings.delete(trail.pop()); };
    const advance = () => {
      while (choices.length) {
        const choice = choices[choices.length - 1];
        rollback(choice.mark); events.length = choice.eventMark;
        while (choice.next < choice.candidates.length) {
          state.observe('horn-resolve-goal');
          const clause = choice.candidates[choice.next++];
          state.observe('horn-freshen-clause');
          const scope = `clause-${++fresh}`;
          const variables = new Map();
          const head = sourceTerm(clause.head, scope, variables), body = clause.body.map(term => sourceTerm(term, scope, variables));
          state.observe('horn-unify');
          const localTrail = [];
          if (!unify(choice.goal.term, head, bindings, localTrail)) { for (const cell of localTrail) bindings.delete(cell); continue; }
          // Only bindings of cells that survive the next available alternative
          // need undo records. Fresh local cells are owned by this branch.
          const keepChoice = choice.next < choice.candidates.length;
          const checkpoint = keepChoice ? choice.birth : choices.at(-2)?.birth ?? -1;
          for (const cell of localTrail) if (cell.birth <= checkpoint) trail.push(cell);
          if (!keepChoice) choices.pop();
          const children = body.map(term => ({ term, id: ++proofId, depth: choice.goal.depth + 1 }));
          if (children.some(child => child.depth > state.maxDepth)) throw new Error('Horn resolution depth bound exceeded');
          if (options.captureProof !== false) events.push({ id: choice.goal.id, clause: clause.name, term: choice.goal.term, children: children.map(child => child.id) });
          goals = [...children, ...choice.rest];
          return true;
        }
        choices.pop();
      }
      return false;
    };
    while (true) {
      if (goals.length === 0) {
        state.observe('horn-project-answer');
        const proofs = new Map();
        if (options.captureProof !== false) for (let i = events.length - 1; i >= 0; --i) {
          const event = events[i];
          proofs.set(event.id, { clause: event.clause, goal: project(event.term, bindings), premises: event.children.map(id => proofs.get(id)) });
        }
        answers.push({ goal: project(query, bindings), proof: proofs.get(0) ?? null });
        if (answers.length >= state.maxAnswers) break;
        if (!advance()) { exhausted = true; break; }
      } else {
        const [first, ...rest] = goals;
        state.observe('horn-resolve-goal');
        const candidates = (this.#index.get(key(walk(first.term, bindings))) ?? []).filter(clause => { state.observe('horn-unify'); return compatible(clause.head, first.term, bindings); });
        choices.push({ goal: first, rest, candidates, next: 0, mark: trail.length, eventMark: events.length, birth: variableSerial });
        if (!advance()) { exhausted = true; break; }
      }
    }
    return { answers, exhausted, steps: state.steps, observedOperations: [...state.observed].sort() };
  }
  /** Check a chosen derivation without invoking search or accepting a new context. */
  replay(goal, proof, options = {}) {
    checkData(goal);
    const state = budget(options), bindings = new WeakMap(), trail = [];
    const query = sourceTerm(goal, 'replay-query');
    const pending = [{ goal: query, proof, depth: 0 }];
    let fresh = 0;
    while (pending.length) {
      const item = pending.pop();
      if (item.depth > state.maxDepth) throw new Error('Horn replay depth bound exceeded');
      if (!item.proof || typeof item.proof.clause !== 'string' || !Array.isArray(item.proof.premises)) return { accepted: false };
      const clause = this.#byId.get(item.proof.clause);
      if (!clause || clause.body.length !== item.proof.premises.length) return { accepted: false };
      checkData(item.proof.goal);
      state.observe('horn-resolve-goal'); state.observe('horn-freshen-clause');
      const scope = `replay-${++fresh}`, variables = new Map(), head = sourceTerm(clause.head, scope, variables), body = clause.body.map(term => sourceTerm(term, scope, variables));
      state.observe('horn-unify');
      // Proof goals are ground data: their '?' strings are never executable variables.
      if (!unify(item.goal, item.proof.goal, bindings, trail) || !unify(item.goal, head, bindings, trail)) return { accepted: false };
      trail.length = 0;
      for (let i = body.length - 1; i >= 0; --i) pending.push({ goal: body[i], proof: item.proof.premises[i], depth: item.depth + 1 });
    }
    state.observe('horn-project-answer');
    return { accepted: true, goal: project(query, bindings), steps: state.steps, observedOperations: [...state.observed].sort() };
  }
  trustReport() {
    return {
      schema: 'rml-horn-resolution-boundary/v1', operations: [...HORN_OPERATIONS],
      operationGroupsNotPrimitiveCount: true,
      unificationRules: ['dereference existing bindings', 'identity of atoms and variables',
        'decompose equal-arity constructors and reject clashes', 'orient a free-variable equation',
        'finite-tree occurs check', 'consistent extension and branch-local undo'],
      representationOptimizations: ['conservative constructor discrimination',
        'owned immutable ground-term normalization', 'conditional trailing of variable cells'],
      externalSemanticAuthority: [
        'first-order finite-tree unification, occurs check, variable dereference and substitution extension',
        'fresh clause-variable scope and repeated-variable identity',
        'leftmost depth-first SLD resolution, source clause order and backtracking',
        'answer projection and independent generic derivation checking',
      ],
      externalServices: ['LiNo parser and ? variable elaboration', 'predicate/arity indexing', 'data/proof codecs and validation',
        'source fingerprints and per-call atom dictionaries bind certificate context',
        'resource bounds, allocation, host runtime/compiler, operating system and processor'],
      noTheorySpecificCallbacks: true, independentPrimitiveMinimalityEstablished: false,
      intrinsicLinksAuthorityEstablished: false, fullImplementationClosure: false,
    };
  }
}
