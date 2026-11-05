/**
 * Fail-closed source elaborator for a bounded, non-dependent Lean/Rocq fragment.
 * This adapter resolves source names and binders. All typing, evaluation and
 * conversion-proof decisions are executed by formal-semantics.lino.
 * Unsupported corpus declarations remain explicitly unresolved.
 */
import { createHash } from 'node:crypto';
import { FormalCorpus } from './rml-formal-corpus.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

export const FORMAL_SEMANTICS_SCHEMA = 'rml-formal-semantics/v1';
const PROGRAM = 'formal-semantics';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = tokens => tokens.map(token => token.text);
const safeName = name => /^[\p{L}_][\p{L}\p{N}_'.]*$/u.test(name);
const BUILTINS = {
  lean: new Set(['Nat', 'List', 'forall']),
  rocq: new Set(['nat', 'list', 'prod', 'nil', 'cons', 'forall']),
};

export function formalNatural(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 512) {
    throw new RangeError('formal natural must be an integer from 0 through 512');
  }
  let result = ['fs-zero'];
  for (let index = 0; index < value; index += 1) result = ['fs-successor', result];
  return result;
}

export function formalList(values) {
  return values.reduceRight((tail, head) => ['fs-cons', head, tail], ['fs-nil']);
}

function indexTerm(value) {
  let result = 'fs-index-zero';
  for (let index = 0; index < value; index += 1) result = ['fs-index-next', result];
  return result;
}

class Reader {
  constructor(tokens, resolve, scope = [], language = 'lean') {
    this.tokens = tokens;
    this.position = 0;
    this.resolve = resolve;
    this.scope = [...scope];
    this.language = language;
  }
  peek() { return this.tokens[this.position]; }
  take() {
    if (this.position >= this.tokens.length) throw new Error('unexpected end of source expression');
    return this.tokens[this.position++];
  }
  eat(token) {
    if (this.peek() !== token) return false;
    this.position += 1;
    return true;
  }
  expect(token) {
    if (!this.eat(token)) throw new Error(`expected ${token}, found ${this.peek() ?? 'end'}`);
  }
  end() {
    if (this.position !== this.tokens.length) throw new Error(`unsupported trailing token ${this.peek()}`);
  }
  binder() {
    if (this.peek() === '{') throw new Error('implicit binder elaboration is outside this fragment');
    const close = this.eat('(') ? ')' : undefined;
    if (!close) throw new Error('explicitly typed binder required');
    const names = [];
    while (this.peek() !== ':') {
      const name = this.take();
      if (!safeName(name)) throw new Error(`unsupported binder ${name}`);
      if (name === '_') throw new Error('anonymous binders and elaboration holes are outside this fragment');
      if (BUILTINS[this.language].has(name)) throw new Error(`builtin-shadowing binder ${name} is outside this fragment`);
      names.push(name);
    }
    this.expect(':');
    if (!names.length) throw new Error('empty binder');
    const type = this.expression();
    this.expect(close);
    const result = [];
    for (const name of names) {
      if (this.scope.includes(name)) throw new Error(`shadowed binder ${name} is outside this fragment`);
      result.push({ name, type });
      this.scope.unshift(name);
    }
    return result;
  }
  expression(minimum = 0) {
    let left = this.atom();
    const infix = new Map([
      ['→', [1, 'fs-arrow-type']], ['->', [1, 'fs-arrow-type']],
      ['=', [2, 'fs-equal']], ['×', [3, 'fs-product-type']],
      ['*', [3, 'fs-product-type']], ['::', [4, 'fs-cons']],
    ]);
    if (this.language === 'lean') infix.delete('*');
    else { infix.delete('×'); infix.delete('→'); }
    const stops = new Set([')', ']', '}', ',', ';', ':', '=>', 'in', 'with', 'end', '|']);
    while (this.peek() !== undefined && !stops.has(this.peek())) {
      const operator = infix.get(this.peek());
      if (operator) {
        if (operator[0] < minimum) break;
        this.take();
        left = [operator[1], left, this.expression(operator[0])];
      } else {
        if (5 < minimum) break;
        if (!this.startsAtom()) break;
        left = ['fs-apply', left, this.expression(6)];
      }
    }
    return left;
  }
  startsAtom() {
    return ['(', '['].includes(this.peek()) || /^\d+$/.test(this.peek() ?? '') ||
      safeName(this.peek() ?? '');
  }
  atom() {
    const token = this.take();
    if (token === '_') throw new Error('elaboration holes are outside this fragment');
    if (token === '(') {
      const left = this.expression();
      if (this.eat(',')) {
        const right = this.expression(); this.expect(')');
        return ['fs-pair', left, right];
      }
      this.expect(')'); return left;
    }
    if (token === '[') {
      const values = [];
      if (!this.eat(']')) {
        do { values.push(this.expression()); } while (this.eat(this.language === 'lean' ? ',' : ';'));
        this.expect(']');
      }
      return formalList(values);
    }
    if (/^\d+$/.test(token)) return formalNatural(Number(token));
    if (token === (this.language === 'lean' ? 'Nat' : 'nat')) return ['fs-nat-type'];
    if (token === (this.language === 'lean' ? 'List' : 'list')) return ['fs-list-type', this.expression(6)];
    if (this.language === 'rocq' && token === 'prod') return ['fs-product-type', this.expression(6), this.expression(6)];
    if (this.language === 'rocq' && token === 'nil') return ['fs-nil'];
    if (this.language === 'rocq' && token === 'cons') return ['fs-cons', this.expression(6), this.expression(6)];
    if ((this.language === 'lean' ? ['∀', 'forall'] : ['forall']).includes(token)) {
      const original = [...this.scope];
      const binders = [];
      while (['(', '{'].includes(this.peek())) binders.push(...this.binder());
      if (!binders.length) throw new Error('forall requires explicitly typed binders in this fragment');
      this.expect(',');
      let body = this.expression();
      for (const binder of binders.reverse()) body = ['fs-forall', binder.type, body];
      this.scope = original;
      return body;
    }
    const bound = this.scope.indexOf(token);
    if (bound !== -1) return ['fs-variable', indexTerm(bound)];
    if (!safeName(token)) throw new Error(`unsupported expression token ${token}`);
    return ['fs-global', this.resolve(token)];
  }
}

function proofFromSource(declaration, binders, resolve, alreadyBound = 0) {
  const tokens = text(declaration.proof);
  let position = 0;
  let introduced = alreadyBound;
  if (declaration.language === 'lean') {
    if (tokens[position++] !== 'by') throw new Error('only explicit tactic proofs are supported');
  } else {
    if (tokens[position++] !== 'Proof' || tokens[position++] !== '.') throw new Error('expected Proof.');
  }
  while (['intro', 'intros', 'unfold'].includes(tokens[position])) {
    const command = tokens[position++];
    if (command === 'unfold') {
      let count = 0;
      while (safeName(tokens[position] ?? '') && !['reflexivity', 'rfl', 'intro', 'intros', 'unfold'].includes(tokens[position])) {
        resolve(tokens[position++]); count += 1;
      }
      if (!count) throw new Error('unfold requires a resolved source dependency');
    } else {
      let count = 0;
      while (safeName(tokens[position] ?? '') && !['reflexivity', 'rfl', 'intro', 'intros', 'unfold'].includes(tokens[position])) {
        const name = tokens[position++];
        if (introduced >= binders.length || binders[introduced].name !== name) {
          throw new Error(`proof binder ${name} does not match the source goal binder`);
        }
        introduced += 1; count += 1;
        if (command === 'intro') break;
      }
      if (!count) throw new Error('intro requires an explicit goal binder');
    }
    if (declaration.language === 'rocq' && tokens[position++] !== '.') throw new Error('unterminated Rocq tactic');
  }
  const final = declaration.language === 'lean' ? ['rfl'] : ['reflexivity', '.', 'Qed', '.'];
  if (!same(tokens.slice(position), final)) throw new Error('proof needs an unsupported tactic or term');
  if (introduced !== binders.length) throw new Error('not every quantified goal binder was introduced');
  let proof = ['fs-proof-refl'];
  for (let index = 0; index < introduced; index += 1) proof = ['fs-proof-intro', proof];
  return proof;
}

function elaborate(declaration, resolve) {
  if (BUILTINS[declaration.language].has(declaration.symbol)) throw new Error('builtin-shadowing declaration is outside this fragment');
  if (declaration.proofStatus === 'admitted') throw new Error('upstream admission is not proof evidence');
  if (declaration.recursive || ['inductive', 'structure', 'recursive-definition'].includes(declaration.kind)) {
    throw new Error('recursive definitions and datatype declarations need a larger kernel');
  }
  const signature = new Reader(text(declaration.signature), resolve, [], declaration.language);
  const binders = [];
  while (['(', '{'].includes(signature.peek())) binders.push(...signature.binder());
  let annotation;
  if (signature.eat(':')) annotation = signature.expression();
  signature.end();
  if (declaration.kind === 'theorem') {
    if (!annotation) throw new Error('missing theorem goal');
    // Quantifiers occurring in the goal are tracked with their original names.
    const goalReader = new Reader(text(declaration.signature), resolve, [], declaration.language);
    const goalBinders = [];
    while (['(', '{'].includes(goalReader.peek())) goalBinders.push(...goalReader.binder());
    goalReader.expect(':');
    if (['∀', 'forall'].includes(goalReader.peek())) {
      goalReader.take();
      while (['(', '{'].includes(goalReader.peek())) goalBinders.push(...goalReader.binder());
    }
    let goal = annotation;
    for (const binder of [...binders].reverse()) goal = ['fs-forall', binder.type, goal];
    return { goal, proof: proofFromSource(declaration, goalBinders, resolve, binders.length) };
  }
  const bodyReader = new Reader(text(declaration.body), resolve, signature.scope, declaration.language);
  let body = bodyReader.expression(); bodyReader.end();
  for (const binder of [...binders].reverse()) {
    body = ['fs-lambda', binder.type, body];
    if (annotation) annotation = ['fs-arrow-type', binder.type, annotation];
  }
  return { body, annotation };
}

function validateTerm(value, depth = 0, counter = { nodes: 0 }) {
  if (++counter.nodes > 20_000 || depth > 128) throw new RangeError('formal argument resource limit exceeded');
  if (!Array.isArray(value)) throw new TypeError('formal arguments must be constructor expressions');
  const arities = { 'fs-zero': 0, 'fs-successor': 1, 'fs-nil': 0, 'fs-cons': 2, 'fs-pair': 2 };
  if (!(value[0] in arities) || value.length !== arities[value[0]] + 1) throw new TypeError('unsupported formal argument constructor');
  for (const child of value.slice(1)) validateTerm(child, depth + 1, counter);
}

function validateProof(value, depth = 0) {
  if (depth > 256) throw new RangeError('proof nesting limit exceeded');
  if (!Array.isArray(value)) throw new TypeError('invalid conversion proof');
  if (value.length === 1 && value[0] === 'fs-proof-refl') return;
  if (value.length === 2 && value[0] === 'fs-proof-intro') return validateProof(value[1], depth + 1);
  throw new TypeError('unsupported conversion proof constructor');
}

// Replay metadata is untrusted. Count unfolded occurrences rather than unique
// object identities, so shared DAGs cannot evade limits before serialization.
function validateReceipt(value, depth = 0, budget = { nodes: 0, bytes: 0, ancestors: new Set() }) {
  if (++budget.nodes > 2_000_000 || depth > 512) throw new RangeError('formal receipt resource limit exceeded');
  if (typeof value === 'string') {
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > 64 * 1024 * 1024) throw new RangeError('formal receipt text limit exceeded');
    return;
  }
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))) return;
  if (!value || typeof value !== 'object') throw new TypeError('invalid formal receipt data');
  if (budget.ancestors.has(value)) throw new TypeError('formal receipt must be acyclic');
  budget.ancestors.add(value);
  for (const child of Object.values(value)) validateReceipt(child, depth + 1, budget);
  budget.ancestors.delete(value);
}

export class FormalSemantics {
  #corpus;
  #programs;
  #compiled = new Map();
  #checked = new Map();
  #statuses = new Map();
  #kernelHash;
  #maxSteps;

  static fromRml(source, foundation, kernelSource, { maxSteps = 50_000, executionBasis = 'direct-structural' } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps <= 0) throw new RangeError('maxSteps must be a positive safe integer');
    const semantics = new FormalSemantics();
    semantics.#corpus = FormalCorpus.fromRml(source, foundation);
    semantics.#programs = LinkedProgramRegistry.fromRml(kernelSource, { executionBasis });
    semantics.#kernelHash = digest(kernelSource);
    semantics.#maxSteps = maxSteps;
    for (const declaration of semantics.#corpus.declarations) semantics.#compile(declaration);
    for (const declaration of semantics.#corpus.declarations) semantics.#check(declaration.address, new Set());
    return semantics;
  }

  #compile(declaration) {
    const referenced = new Set();
    const resolve = name => {
      const candidates = declaration.dependencies.map(address => this.#corpus.declarationAt(address))
        .filter(other => other && other.language === declaration.language &&
          (other.symbol === name || `${other.module}.${other.symbol}` === name));
      const local = candidates.filter(other => other.module === declaration.module);
      const selected = local.length ? local : candidates;
      if (selected.length !== 1) throw new Error(`unresolved or ambiguous dependency ${name}`);
      referenced.add(selected[0].address);
      return selected[0].address;
    };
    try {
      const compiled = elaborate(declaration, resolve);
      if (!same([...referenced].sort(), [...declaration.dependencies].sort())) {
        throw new Error('source dependencies differ from the elaborated references');
      }
      this.#compiled.set(declaration.address, { ...compiled, dependencies: [...referenced].sort() });
    } catch (error) {
      this.#statuses.set(declaration.address, {
        address: declaration.address,
        status: declaration.proofStatus === 'admitted' ? 'upstream-admitted' : 'unsupported',
        reason: error.message,
      });
    }
  }

  #environment(address, includeSelf = false) {
    const visited = new Set();
    const visit = current => {
      if (visited.has(current)) return;
      if (this.#statuses.get(current)?.status !== 'definition-checked') throw new Error(`unchecked definition dependency ${current}`);
      visited.add(current);
      for (const dependency of this.#compiled.get(current)?.dependencies ?? []) visit(dependency);
    };
    for (const dependency of this.#compiled.get(address)?.dependencies ?? []) visit(dependency);
    if (includeSelf) visited.add(address);
    let result = 'fs-empty';
    for (const dependency of [...visited].sort()) {
      const checked = this.#checked.get(dependency);
      if (!checked || checked[0] !== 'fs-ok') throw new Error(`unchecked definition dependency ${dependency}`);
      result = ['fs-global-bind', dependency, checked[1], checked[2], result];
    }
    return result;
  }

  #reduce(request) {
    return this.#programs.reduce(PROGRAM, request, { maxSteps: this.#maxSteps });
  }

  #check(address, ancestors) {
    if (this.#statuses.has(address)) return;
    if (ancestors.has(address)) {
      this.#statuses.set(address, { address, status: 'unsupported', reason: 'cyclic semantic dependency' });
      return;
    }
    const compiled = this.#compiled.get(address);
    if (!compiled) return;
    const next = new Set([...ancestors, address]);
    for (const dependency of compiled.dependencies) this.#check(dependency, next);
    try {
      const globals = this.#environment(address);
      const request = compiled.goal
        ? ['fs-prove', compiled.goal, compiled.proof, 'fs-empty', globals]
        : compiled.annotation
          ? ['fs-definition', compiled.annotation, compiled.body, globals]
          : ['fs-infer', compiled.body, 'fs-empty', globals];
      const reduced = this.#reduce(request);
      const accepted = compiled.goal ? reduced.term === 'fs-proof-accepted' : reduced.term?.[0] === 'fs-ok';
      if (!accepted) throw new Error('linked type or conversion check did not accept the source declaration');
      if (!compiled.goal) this.#checked.set(address, reduced.term);
      this.#statuses.set(address, { address, status: compiled.goal ? 'conversion-proof-replayed' : 'definition-checked',
        dependencies: compiled.dependencies, steps: reduced.steps });
    } catch (error) {
      this.#statuses.set(address, { address, status: 'unresolved', reason: error.message });
    }
  }

  coverage() {
    const declarations = [...this.#statuses.values()].sort((a, b) =>
      a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
    return {
      schema: FORMAL_SEMANTICS_SCHEMA,
      corpusFingerprint: this.#corpus.fingerprint,
      kernelHash: this.#kernelHash,
      fullCorpusVerified: false,
      declarationCount: this.#corpus.declarations.length,
      checkedDefinitions: declarations.filter(item => item.status === 'definition-checked').length,
      replayedProofs: declarations.filter(item => item.status === 'conversion-proof-replayed').length,
      upstreamAdmissions: declarations.filter(item => item.status === 'upstream-admitted').length,
      declarations: structuredClone(declarations),
    };
  }

  #receipt(address, kind, input, request, reduced, accepted) {
    const receipt = {
      schema: FORMAL_SEMANTICS_SCHEMA, kind, address,
      corpusFingerprint: this.#corpus.fingerprint, kernelHash: this.#kernelHash,
      dependencies: [...this.#compiled.get(address).dependencies], input: structuredClone(input),
      accepted, request, result: reduced.term, trace: reduced.trace, steps: reduced.steps,
    };
    validateReceipt(receipt);
    return structuredClone(receipt);
  }

  evaluate(address, arguments_ = []) {
    if (this.#statuses.get(address)?.status !== 'definition-checked') throw new Error(`definition is not semantically checked: ${address}`);
    if (!Array.isArray(arguments_) || arguments_.length > 32) throw new RangeError('formal application accepts at most 32 arguments');
    const budget = { nodes: 0 };
    for (const argument of arguments_) validateTerm(argument, arguments_.length, budget);
    let expression = ['fs-global', address];
    for (const argument of arguments_) expression = ['fs-apply', expression, argument];
    const request = ['fs-infer', expression, 'fs-empty', this.#environment(address, true)];
    const reduced = this.#reduce(request);
    return this.#receipt(address, 'evaluation', arguments_, request, reduced, reduced.term?.[0] === 'fs-ok');
  }

  /** Recheck the source body/type obligation, not just a later function call. */
  verifyDefinition(address) {
    if (this.#statuses.get(address)?.status !== 'definition-checked') throw new Error(`definition is not semantically checked: ${address}`);
    const compiled = this.#compiled.get(address);
    const globals = this.#environment(address);
    const request = compiled.annotation
      ? ['fs-definition', compiled.annotation, compiled.body, globals]
      : ['fs-infer', compiled.body, 'fs-empty', globals];
    const reduced = this.#reduce(request);
    return this.#receipt(address, 'definition', [], request, reduced, reduced.term?.[0] === 'fs-ok');
  }

  verifyTheorem(address, candidate) {
    const compiled = this.#compiled.get(address);
    if (!compiled?.goal) throw new Error(`theorem is not in the supported proof fragment: ${address}`);
    const proof = candidate ?? compiled.proof;
    validateProof(proof);
    const request = ['fs-prove', compiled.goal, proof, 'fs-empty', this.#environment(address)];
    const reduced = this.#reduce(request);
    return this.#receipt(address, 'conversion-proof', proof, request, reduced, reduced.term === 'fs-proof-accepted');
  }

  replay(receipt) {
    validateReceipt(receipt);
    if (receipt?.schema !== FORMAL_SEMANTICS_SCHEMA || receipt.kernelHash !== this.#kernelHash ||
        receipt.corpusFingerprint !== this.#corpus.fingerprint) throw new Error('formal receipt context does not match the authoritative source and kernel');
    const result = receipt.kind === 'evaluation' ? this.evaluate(receipt.address, receipt.input)
      : receipt.kind === 'conversion-proof' ? this.verifyTheorem(receipt.address, receipt.input)
        : receipt.kind === 'definition' ? this.verifyDefinition(receipt.address)
        : undefined;
    if (!result) throw new Error('unsupported formal receipt kind');
    const matches = same(result, receipt);
    return { accepted: result.accepted && matches, executionAccepted: result.accepted, matches, result };
  }
}
