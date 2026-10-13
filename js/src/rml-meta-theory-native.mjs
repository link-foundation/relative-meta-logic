/**
 * Native linked definitions for the pinned upstream meta-theory corpus.
 *
 * The elaborator reads each preserved declaration's actual signature/body
 * tokens, resolves every global reference against that declaration's recorded
 * dependency links, and emits ordinary linked rewrite rules. Pattern matches
 * become constructor decision trees, lambdas become closures and source
 * builtins are mapped to the inspectable meta-theory-native-prelude program.
 * The generic linked reducer performs all execution; declaration names never
 * select host behaviour. Unsupported source stays explicitly unsupported.
 *
 * This is an untyped execution semantics. Typing remains the separate
 * formal-semantics/foundation/proposition layers. Prop-valued definitions over
 * finite data execute as boolean decision procedures, and unbounded
 * quantifiers are elaborated as statement data without an execution rule.
 */
import { createHash } from 'node:crypto';
import { FormalCorpus } from './rml-formal-corpus.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

export const META_THEORY_NATIVE_SCHEMA = 'rml-meta-theory-native/v1';
export const META_THEORY_NATIVE_PROGRAM = 'upstream-0.0.3-native';
export const META_THEORY_NATIVE_PRELUDE = 'meta-theory-native-prelude';
export const NATIVE_COMMAND_SECTION = 'commands';
export const META_THEORY_CONVERSION_PROGRAM = 'upstream-0.0.3-native-conversion';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// ---------------------------------------------------------------------------
// Surface syntax

const LEAN_OPERATORS = new Map([
  ['↔', [20, 'right', 'iff']], ['→', [25, 'right', 'arrow']], ['->', [25, 'right', 'arrow']],
  ['∨', [30, 'right', 'or']], ['∧', [35, 'right', 'and']], ['×', [35, 'right', 'product']],
  ['=', [50, 'left', 'eq']], ['==', [50, 'left', 'eq']], ['≠', [50, 'left', 'ne']],
  ['!=', [50, 'left', 'ne']], ['<', [50, 'left', 'lt']], ['≤', [50, 'left', 'le']],
  ['<=', [50, 'left', 'le']], ['>', [50, 'left', 'gt']], ['≥', [50, 'left', 'ge']],
  ['>=', [50, 'left', 'ge']], ['∈', [50, 'left', 'mem']], ['∉', [50, 'left', 'notmem']],
  ['++', [65, 'left', 'append']], ['+', [65, 'left', 'add']], ['-', [65, 'left', 'sub']],
  ['::', [67, 'right', 'cons']], ['*', [70, 'left', 'mul']], ['/', [70, 'left', 'div']],
]);
// Rocq levels are inverted: a lower level binds more tightly.
const ROCQ_OPERATORS = new Map([
  ['<->', [5, 'right', 'iff']], ['->', [1, 'right', 'arrow']],
  ['\\/', [15, 'right', 'or']], ['/\\', [20, 'right', 'and']],
  ['=', [30, 'left', 'eq']], ['<>', [30, 'left', 'ne']], ['<', [30, 'left', 'lt']],
  ['<=', [30, 'left', 'le']], ['>', [30, 'left', 'gt']], ['>=', [30, 'left', 'ge']],
  ['=?', [30, 'left', 'eq']], ['<?', [30, 'left', 'lt']], ['<=?', [30, 'left', 'le']],
  ['::', [40, 'right', 'cons']], ['++', [40, 'right', 'append']],
  ['+', [50, 'left', 'add']], ['-', [50, 'left', 'sub']],
  ['*', [60, 'left', 'product']], ['/', [60, 'left', 'div']],
]);
const ARGUMENT_OPENERS = new Set(['(', '[', '⟨', '#', '·', '@']);
// Identifier-kind words that end an application rather than supply an argument.
const STOP_WORDS = new Set(['deriving', 'do', 'at', 'using', 'generalizing', 'Proof', 'Qed']);

class Reader {
  constructor(tokens, language, { braceLists = false, arityOf } = {}) {
    this.arityOf = arityOf;
    this.limitApplications = false;
    this.tokens = tokens.map(token => (typeof token === 'string' ? { text: token, kind: 'identifier' } : token));
    this.position = 0;
    this.language = language;
    this.operators = language === 'lean' ? LEAN_OPERATORS : ROCQ_OPERATORS;
    this.braceLists = braceLists;
    this.usedBraceLists = false;
  }
  peek(offset = 0) { return this.tokens[this.position + offset]?.text; }
  kind(offset = 0) { return this.tokens[this.position + offset]?.kind; }
  take() {
    if (this.position >= this.tokens.length) throw new Error('unexpected end of source expression');
    return this.tokens[this.position++].text;
  }
  eat(text) {
    if (this.peek() !== text) return false;
    this.position += 1;
    return true;
  }
  expect(text) {
    if (!this.eat(text)) throw new Error(`expected ${text}, found ${this.peek() ?? 'end'}`);
  }
  end() {
    if (this.position !== this.tokens.length) throw new Error(`unsupported trailing source ${this.peek()}`);
  }
  isName(offset = 0) { return this.kind(offset) === 'identifier'; }

  expression(minimum = 0) {
    let left = this.prefix();
    for (;;) {
      const operator = this.operators.get(this.peek());
      if (!operator || operator[0] < minimum) break;
      this.take();
      const right = this.expression(operator[1] === 'right' ? operator[0] : operator[0] + 1);
      left = { t: 'op', op: operator[2], left, right };
    }
    return left;
  }

  prefix() {
    const token = this.peek();
    if (token === 'fun' || token === 'λ') { this.take(); return this.lambda(); }
    if (token === 'match') { this.take(); return this.match(); }
    if (token === 'if') { this.take(); return this.conditional(); }
    if (token === 'let') { this.take(); return this.letBinding(); }
    if (token === 'do' && this.language === 'lean') { this.take(); return this.doBlock(); }
    if (token === '∀' || token === 'forall') { this.take(); return this.quantifier('forall'); }
    if (token === '∃' || token === 'exists') { this.take(); return this.quantifier('exists'); }
    if (token === '¬' || token === '~') { this.take(); return { t: 'op', op: 'not', left: this.expression(40) }; }
    return this.application();
  }

  startsArgument() {
    const token = this.peek();
    if (token === undefined) return false;
    if (this.kind() === 'numeral') return true;
    if (this.isName()) return !STOP_WORDS.has(token);
    if (token === '{') return this.braceLists;
    return ARGUMENT_OPENERS.has(token);
  }

  application() {
    const head = this.atom();
    const args = [];
    // Lean separates `let x := f a b` from its body only by a line break, which
    // the token stream does not retain. Inside such a value, a known global's
    // declared arity ends its application.
    const limit = this.limitApplications && head.t === 'name' ? this.arityOf?.(head.name) : undefined;
    while (this.startsArgument() && (limit === undefined || args.length < limit)) args.push(this.atom());
    return args.length ? { t: 'app', fn: head, args } : head;
  }

  atom() {
    let value = this.baseAtom();
    // Lean postfix projection `e.field`, `e.1`, also written `e . 1` by the lexer.
    while (this.language === 'lean' && this.peek() === '.' &&
      (this.kind(1) === 'numeral' || this.isName(1))) {
      this.take();
      value = { t: 'proj', expr: value, field: this.take() };
    }
    return value;
  }

  baseAtom() {
    const kind = this.kind();
    const token = this.take();
    if (kind === 'numeral') return { t: 'num', value: Number(token) };
    if (kind === 'identifier') return token === '_' ? { t: 'hole' } : { t: 'name', name: token };
    if (token === '@' && this.isName()) return { t: 'name', name: this.take() };
    if (token === '·') return { t: 'placeholder' };
    if (token === '(') {
      if (this.eat(')')) return { t: 'unit' };
      const first = this.expression();
      if (this.eat('as')) {
        const name = this.take();
        this.expect(')');
        return { t: 'as', pattern: first, name };
      }
      if (this.eat(':')) {
        const type = this.expression();
        this.expect(')');
        return { t: 'ascribe', expr: first, type };
      }
      const items = [first];
      while (this.eat(',')) items.push(this.expression());
      this.expect(')');
      const value = items.length === 1 ? first : { t: 'tuple', items };
      return containsPlaceholder(value) ? { t: 'fun', params: [{ name: '·' }], body: value } : value;
    }
    if (token === '[') return { t: 'list', items: this.sequence(']', this.language === 'lean' ? ',' : ';') };
    if (token === '#' && this.peek() === 'v' && this.peek(1) === '[') {
      this.take(); this.take();
      return { t: 'list', items: this.sequence(']', ','), vector: true };
    }
    if (token === '⟨') return { t: 'anonymous', items: this.sequence('⟩', ',') };
    if (token === '{' && this.braceLists) {
      this.usedBraceLists = true;
      return { t: 'list', items: this.sequence('}', ',') };
    }
    if (token === '.' && this.language === 'lean' && this.isName()) return { t: 'dot-constructor', name: this.take() };
    throw new Error(`unsupported source atom ${token}`);
  }

  sequence(close, separator) {
    const items = [];
    if (this.eat(close)) return items;
    do { items.push(this.expression()); } while (this.eat(separator));
    this.expect(close);
    return items;
  }

  parameterNames(stop) {
    const params = [];
    while (this.peek() !== stop) {
      if (this.peek() === '(') {
        this.take();
        const names = [];
        while (this.peek() !== ':') names.push(this.take());
        this.expect(':');
        const type = this.expression();
        this.expect(')');
        for (const name of names) params.push({ name, type });
      } else {
        const name = this.take();
        if (!this.tokens[this.position - 1] || this.kind(-1) !== 'identifier') {
          throw new Error(`unsupported binder ${name}`);
        }
        params.push({ name });
      }
    }
    return params;
  }

  lambda() {
    const params = this.parameterNames('=>');
    if (!params.length) throw new Error('lambda needs a binder');
    this.expect('=>');
    return { t: 'fun', params, body: this.expression() };
  }

  quantifier(kind) {
    const binders = [];
    while (this.peek() !== ',') {
      if (this.peek() === '(' || this.peek() === '{') {
        const close = this.take() === '(' ? ')' : '}';
        const names = [];
        while (this.peek() !== ':') names.push(this.take());
        this.expect(':');
        const type = this.expression();
        this.expect(close);
        for (const name of names) binders.push({ name, type });
      } else {
        const names = [];
        while (this.isName() && this.peek() !== ',') names.push(this.take());
        if (!names.length) throw new Error(`unsupported quantifier binder ${this.peek()}`);
        let type;
        if (this.eat(':')) type = this.expression();
        for (const name of names) binders.push({ name, type });
      }
    }
    this.expect(',');
    return { t: kind, binders, body: this.expression() };
  }

  match() {
    const scrutinees = [this.expression()];
    while (this.eat(',')) scrutinees.push(this.expression());
    this.expect('with');
    const arms = [];
    const rocq = this.language === 'rocq';
    if (rocq) this.eat('|');
    else if (this.peek() !== '|') throw new Error('Lean match needs alternatives');
    for (;;) {
      if (!rocq) this.expect('|');
      const patterns = [this.expression()];
      while (this.eat(',')) patterns.push(this.expression());
      this.expect('=>');
      arms.push({ patterns, body: this.expression() });
      if (rocq) {
        if (this.eat('end')) break;
        this.expect('|');
      } else if (this.peek() !== '|') break;
    }
    for (const arm of arms) {
      if (arm.patterns.length !== scrutinees.length) throw new Error('match alternative has the wrong number of patterns');
    }
    return { t: 'match', scrutinees, arms };
  }

  conditional() {
    let hypothesis;
    if (this.isName() && this.peek(1) === ':') { hypothesis = this.take(); this.take(); }
    const condition = this.expression();
    this.expect('then');
    const consequent = this.expression();
    this.expect('else');
    return { t: 'if', hypothesis, condition, consequent, alternative: this.expression() };
  }

  letBinding() {
    if (this.language === 'rocq') this.eat("'");
    const pattern = this.expression();
    this.expect(':=');
    const saved = this.limitApplications;
    this.limitApplications = this.language === 'lean';
    const value = this.expression();
    this.limitApplications = saved;
    if (this.language === 'rocq') this.expect('in');
    else this.eat(';');
    return { t: 'let', pattern, value, body: this.expression() };
  }

  doBlock() {
    if (this.eat('let')) {
      const name = this.take();
      this.expect('←');
      const value = this.expression();
      this.eat(';');
      return { t: 'bind', name, value, body: this.doBlock() };
    }
    if (this.eat('return')) return { t: 'return', expr: this.expression() };
    return this.expression();
  }
}

function containsPlaceholder(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.t === 'placeholder') return true;
  if (node.t === 'fun') return false;
  return Object.values(node).some(value => (Array.isArray(value)
    ? value.some(containsPlaceholder) : containsPlaceholder(value)));
}

/** Names syntactically occurring in an expression (over-approximates free names). */
function occurringNames(node, names = new Set()) {
  if (!node || typeof node !== 'object') return names;
  if (node.t === 'name') names.add(node.name.split('.')[0]);
  if (node.t === 'placeholder') names.add('·');
  if (node.t === 'bind') names.add(node.name);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => occurringNames(item, names));
    else if (value && typeof value === 'object') occurringNames(value, names);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Declaration signatures

function readBinders(reader) {
  const binders = [];
  while (['(', '{', '['].includes(reader.peek())) {
    const open = reader.take();
    const close = { '(': ')', '{': '}', '[': ']' }[open];
    const names = [];
    while (reader.peek() !== ':') {
      if (!reader.isName()) throw new Error(`unsupported binder ${reader.peek()}`);
      names.push(reader.take());
    }
    reader.expect(':');
    const type = reader.expression();
    let fallback;
    if (reader.eat(':=')) fallback = reader.expression();
    reader.expect(close);
    for (const name of names) binders.push({ name, type, implicit: open !== '(', fallback });
  }
  return binders;
}

function readSignature(declaration) {
  const reader = new Reader(declaration.signature, declaration.language);
  const binders = readBinders(reader);
  let result;
  if (reader.eat(':')) result = reader.expression();
  reader.end();
  return { binders, result };
}

function equationArity(declaration) {
  const tokens = declaration.body;
  if (tokens[0]?.text !== '|') return 0;
  let depth = 0;
  let count = 1;
  for (const token of tokens.slice(1)) {
    if (['(', '[', '⟨', '{'].includes(token.text)) depth += 1;
    else if ([')', ']', '⟩', '}'].includes(token.text)) depth -= 1;
    else if (depth === 0 && token.text === ',') count += 1;
    else if (depth === 0 && token.text === '=>') return count;
  }
  throw new Error('equation alternative has no =>');
}

function describeInductive(declaration) {
  const reader = new Reader(declaration.body, declaration.language);
  const constructors = [];
  while (reader.eat('|')) {
    const name = reader.take();
    reader.expect(':');
    const type = reader.expression();
    let arity = 0;
    for (let current = type; current.t === 'op' && current.op === 'arrow'; current = current.right) arity += 1;
    constructors.push({ name, arity, type });
  }
  if (declaration.language === 'lean' && reader.eat('deriving')) {
    while (reader.peek() !== undefined) reader.take();
  }
  reader.end();
  if (!constructors.length) throw new Error('inductive declaration has no constructors');
  return constructors;
}

function describeStructure(declaration) {
  const tokens = declaration.body;
  const reader = new Reader(tokens, declaration.language);
  let constructor = 'mk';
  if (declaration.language === 'rocq') {
    constructor = reader.take();
    reader.expect('{');
  }
  const fields = [];
  const derived = [];
  while (reader.peek() !== undefined && reader.peek() !== '}' && reader.peek() !== 'deriving') {
    const name = reader.take();
    reader.expect(':');
    const start = reader.position;
    let depth = 0;
    while (reader.peek() !== undefined) {
      const token = reader.peek();
      if (depth === 0 && ([';', '}', 'deriving'].includes(token) ||
        (reader.isName() && reader.peek(1) === ':'))) break;
      if (['(', '['].includes(token)) depth += 1;
      if ([')', ']'].includes(token)) depth -= 1;
      reader.take();
    }
    const typeReader = new Reader(tokens.slice(start, reader.position), declaration.language);
    const type = typeReader.expression();
    typeReader.end();
    fields.push({ name, type });
    reader.eat(';');
  }
  if (declaration.language === 'rocq') reader.expect('}');
  else if (reader.eat('deriving')) {
    do { derived.push(reader.take()); } while (reader.eat(','));
  }
  reader.end();
  if (!fields.length) throw new Error('structure declaration has no fields');
  return { constructor, fields, derived };
}

// ---------------------------------------------------------------------------
// Builtins: the explicit mapping from source library names to prelude links.

// Evaluation is call-by-value: a finished value is the link (mt-v RAW).
const value = raw => ['mt-v', raw];
// Naturals are canonical little-endian binary links: mt-zero, (mt-b0 N) and
// (mt-b1 N) with N never mt-zero under mt-b0. Their depth is logarithmic, so
// literals and intermediate results stay small and within the LiNo nesting bound.
export function binaryNatural(number) {
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError('natural literal must be a safe non-negative integer');
  return number === 0 ? 'mt-zero' : [number % 2 === 0 ? 'mt-b0' : 'mt-b1', binaryNatural(Math.floor(number / 2))];
}
const nat = number => value(binaryNatural(number));
// Builders such as (mt-cons HEAD TAIL) produce values once both operands are values.
const list = items => items.reduceRight((tail, head) => ['mt-cons', head, tail], value('mt-nil'));

const fixed = (arity, build) => ({ arity, build });
const tag = (name, arity) => fixed(arity, args => (arity === 0 ? value(name) : [name, ...args]));
const COMMON_BUILTINS = {
  Prop: tag('mt-prop-type', 0), Type: tag('mt-type-universe', 0),
  True: tag('mt-true', 0), False: tag('mt-false', 0),
  true: tag('mt-true', 0), false: tag('mt-false', 0),
};
const BUILTINS = {
  lean: {
    ...COMMON_BUILTINS,
    Nat: tag('mt-nat-type', 0), Bool: tag('mt-bool-type', 0),
    List: tag('mt-list-type', 1), Option: tag('mt-option-type', 1),
    Vector: tag('mt-vector-type', 2), none: tag('mt-none', 0), some: tag('mt-some', 1),
    'Nat.succ': tag('mt-succ', 1), 'Nat.zero': tag('mt-zero', 0),
    'List.nil': tag('mt-nil', 0), 'List.cons': tag('mt-cons', 2), 'List.length': tag('mt-length', 1),
    'Vector.replicate': fixed(2, ([count, value]) => ['mt-replicate', count, value]),
  },
  rocq: {
    ...COMMON_BUILTINS,
    nat: tag('mt-nat-type', 0), bool: tag('mt-bool-type', 0),
    list: tag('mt-list-type', 1), option: tag('mt-option-type', 1),
    prod: tag('mt-product-type', 2), t: tag('mt-vector-type', 2),
    None: tag('mt-none', 0), Some: tag('mt-some', 1),
    O: tag('mt-zero', 0), S: tag('mt-succ', 1),
    nil: tag('mt-nil', 0), cons: tag('mt-cons', 2),
    'List.nil': tag('mt-nil', 0), 'List.cons': tag('mt-cons', 2),
    length: tag('mt-length', 1), 'List.length': tag('mt-length', 1), app: tag('mt-append', 2), map: tag('mt-map', 2),
    fst: tag('mt-first', 1), snd: tag('mt-second', 1),
    firstn: tag('mt-take', 2), skipn: tag('mt-drop', 2), nth: tag('mt-nth', 3),
    forallb: tag('mt-all', 2), 'Nat.eqb': tag('mt-nat-equal', 2), In: tag('mt-member', 2),
    'Vector.const': fixed(2, ([value, count]) => ['mt-replicate', count, value]),
    // Vector.nil A and Vector.cons A h n t erase their type/index arguments.
    'Vector.nil': fixed(1, () => value('mt-nil')),
    'Vector.cons': fixed(4, ([, head, , tail]) => ['mt-cons', head, tail]),
  },
};
// Pattern constructors: [family, constructor, arity] after erasing type arguments.
const PATTERN_CONSTRUCTORS = {
  lean: {
    none: ['option', 'none', 0], some: ['option', 'some', 1], 'Nat.succ': ['nat', 'succ', 1],
    'Nat.zero': ['nat', 'zero', 0], 'List.nil': ['list', 'nil', 0], 'List.cons': ['list', 'cons', 2],
    true: ['bool', 'true', 0], false: ['bool', 'false', 0],
  },
  rocq: {
    None: ['option', 'none', 0], Some: ['option', 'some', 1], S: ['nat', 'succ', 1], O: ['nat', 'zero', 0],
    nil: ['list', 'nil', 0], cons: ['list', 'cons', 2], 'List.nil': ['list', 'nil', 0],
    'List.cons': ['list', 'cons', 2], true: ['bool', 'true', 0], false: ['bool', 'false', 0],
    'Vector.nil': ['list', 'nil', 0, [false]], 'Vector.cons': ['list', 'cons', 2, [false, true, false, true]],
  },
};
const FAMILIES = {
  nat: [['zero', 0], ['succ', 1]],
  list: [['nil', 0], ['cons', 2]],
  option: [['none', 0], ['some', 1]],
  bool: [['true', 0], ['false', 0]],
  pair: [['pair', 2]],
};
const VALUE_TAGS = {
  zero: 'mt-zero', succ: 'mt-succ', nil: 'mt-nil', cons: 'mt-cons', none: 'mt-none',
  some: 'mt-some', true: 'mt-true', false: 'mt-false', pair: 'mt-pair',
};
const METHODS = {
  length: [0, receiver => ['mt-length', receiver]],
  size: [0, receiver => ['mt-length', receiver]],
  toList: [0, receiver => receiver],
  toArray: [0, receiver => receiver],
  1: [0, receiver => ['mt-first', receiver]],
  2: [0, receiver => ['mt-second', receiver]],
  fst: [0, receiver => ['mt-first', receiver]],
  snd: [0, receiver => ['mt-second', receiver]],
  map: [1, (receiver, [fn]) => ['mt-map', fn, receiver]],
  all: [1, (receiver, [fn]) => ['mt-all', fn, receiver]],
  take: [1, (receiver, [count]) => ['mt-take', count, receiver]],
  drop: [1, (receiver, [count]) => ['mt-drop', count, receiver]],
};
const OPERATOR_TERMS = {
  iff: 'mt-iff', arrow: 'mt-arrow', or: 'mt-or', and: 'mt-and', product: 'mt-product-type',
  eq: 'mt-equal', ne: 'mt-not-equal', lt: 'mt-less', le: 'mt-less-equal',
  mem: 'mt-member', append: 'mt-append', add: 'mt-add', sub: 'mt-sub', cons: 'mt-cons',
  mul: 'mt-mul', div: 'mt-div',
};

// ---------------------------------------------------------------------------
// Elaboration into linked rewrite rules

const PROOF = Symbol('erased-proof');

class DeclarationElaborator {
  constructor(owner, declaration, { resolveScope, auxPrefix = declaration.address } = {}) {
    this.owner = owner;
    this.declaration = declaration;
    this.language = declaration.language;
    this.rules = [];
    this.references = new Set();
    this.structuralReferences = new Set();
    this.counter = 0;
    this.variableCounter = 0;
    this.auxPrefix = auxPrefix;
    this.resolveScope = resolveScope ?? (() => declaration.dependencies);
    this.nonExhaustive = 0;
    this.usedBraceLists = false;
  }

  variable() { return `?v${this.variableCounter++}`; }
  aux(kind) { return `${this.auxPrefix}--${kind}${this.counter++}`; }
  rule(pattern, replacement) {
    this.rules.push({ name: `${this.auxPrefix}--r${this.rules.length}`, pattern, replacement });
  }
  reader(tokens) {
    const arityOf = name => {
      const found = this.candidates(name);
      if (found.length === 1) return this.owner.info.get(found[0].address)?.syntacticArity;
      return BUILTINS[this.language][name]?.arity;
    };
    return new Reader(tokens, this.language, { braceLists: this.owner.braceLists(this.declaration), arityOf });
  }

  candidates(name) {
    const visible = this.resolveScope().map(address => this.owner.corpus.declarationAt(address)).filter(Boolean);
    const matches = visible.filter(other => other.language === this.language &&
      (other.symbol === name || `${other.module}.${other.symbol}` === name));
    const local = matches.filter(other => other.module === this.declaration.module);
    return local.length ? local : matches;
  }

  global(name) {
    const found = this.candidates(name);
    if (found.length > 1) throw new Error(`ambiguous source reference ${name}`);
    if (!found.length) return undefined;
    this.references.add(found[0].address);
    return this.owner.info.get(found[0].address);
  }

  visibleInfos() {
    return this.resolveScope().map(address => this.owner.info.get(address)).filter(Boolean)
      .filter(info => info.language === this.language);
  }

  constructorNamed(name) {
    const found = this.visibleInfos().filter(info => info.constructors?.some(entry => entry.name === name));
    if (found.length !== 1) return undefined;
    this.structuralReferences.add(found[0].address);
    return { info: found[0], constructor: found[0].constructors.find(entry => entry.name === name) };
  }

  recordConstructorNamed(name) {
    const found = this.visibleInfos().filter(info => info.structure?.constructor === name);
    if (found.length !== 1) return undefined;
    this.references.add(found[0].address);
    return found[0];
  }

  fieldOwner(field) {
    const found = this.visibleInfos().filter(info => info.structure?.fields.some(entry => entry.name === field));
    if (found.length > 1) throw new Error(`ambiguous record projection ${field}`);
    if (found.length) this.structuralReferences.add(found[0].address);
    return found[0];
  }

  // -- expressions ---------------------------------------------------------

  term(node, scope, expected) {
    switch (node.t) {
      case 'num': return nat(node.value);
      case 'unit': return value('mt-unit');
      case 'hole': throw new Error('elaboration holes are outside native execution');
      case 'placeholder': return this.name('·', scope);
      case 'name': return this.apply(node, [], scope, expected);
      case 'app': return this.apply(node.fn, node.args, scope, expected);
      case 'proj': return this.apply(node, [], scope);
      case 'ascribe': return this.term(node.expr, scope, node.type);
      case 'tuple': return this.tuple(node.items.map(item => this.term(item, scope)));
      case 'list': return list(node.items.map(item => this.term(item, scope)));
      case 'anonymous': return this.anonymous(node, scope, expected);
      case 'dot-constructor': return this.apply(node, [], scope);
      case 'op': return this.operator(node, scope);
      case 'if': {
        const inner = new Map(scope);
        if (node.hypothesis) inner.set(node.hypothesis, PROOF);
        return ['mt-if', this.term(node.condition, scope), this.term(node.consequent, inner, expected),
          this.term(node.alternative, scope, expected)];
      }
      case 'let':
        // A let is a one-alternative match, so its value is computed once.
        return this.match({ scrutinees: [node.value], arms: [{ patterns: [node.pattern], body: node.body }] }, scope);
      case 'fun': return this.lambda(node.params.map(param => param.name), node.body, scope);
      case 'match': return this.match(node, scope);
      case 'bind': {
        const continuation = this.lambda([node.name], node.body, scope);
        return ['mt-option-bind', this.term(node.value, scope), continuation];
      }
      case 'return': return ['mt-some', this.term(node.expr, scope)];
      case 'forall':
      case 'exists': return this.quantifier(node, scope);
      default: throw new Error(`unsupported source form ${node.t}`);
    }
  }

  tuple(items) {
    if (items.length < 2) return items[0];
    if (this.language === 'lean') return items.reduceRight((tail, head) => ['mt-pair', head, tail]);
    return items.reduce((head, next) => ['mt-pair', head, next]);
  }

  local(name, scope) {
    if (!scope.has(name)) return undefined;
    const value = scope.get(name);
    if (value === PROOF) throw new Error(`proof hypothesis ${name} is used computationally`);
    if (value?.implicit) throw new Error(`implicit argument ${name} is used computationally; source call sites omit it`);
    return value;
  }

  name(name, scope) { return this.apply({ t: 'name', name }, [], scope); }

  operator(node, scope) {
    if (node.op === 'not') return ['mt-not', this.term(node.left, scope)];
    const left = this.term(node.left, scope);
    const right = this.term(node.right, scope);
    if (node.op === 'gt') return ['mt-less', right, left];
    if (node.op === 'ge') return ['mt-less-equal', right, left];
    if (node.op === 'notmem') return ['mt-not', ['mt-member', left, right]];
    return [OPERATOR_TERMS[node.op], left, right];
  }

  quantifier(node, scope) {
    const inner = new Map(scope);
    const binders = [];
    for (const binder of node.binders) {
      const bound = `mt-bound-${this.counter++}`;
      binders.push(['mt-binder', bound, binder.type ? this.term(binder.type, inner) : 'mt-inferred-domain']);
      inner.set(binder.name, ['mt-local', bound]);
    }
    let body = this.term(node.body, inner);
    for (const binder of binders.reverse()) body = [`mt-${node.t}`, binder, body];
    return body;
  }

  anonymous(node, scope, expected) {
    const structure = expected?.t === 'name' ? this.global(expected.name) : undefined;
    if (structure?.structure) {
      if (node.items.length !== structure.structure.fields.length) throw new Error('anonymous constructor has the wrong field count');
      return ['mt-record', structure.address, ...node.items.map(item => this.term(item, scope))];
    }
    // A subtype/vector value ⟨data, proof⟩ erases its proof component.
    const last = node.items.at(-1);
    if (node.items.length === 2 && last.t === 'name' && scope.get(last.name) === PROOF) return this.term(node.items[0], scope);
    throw new Error('anonymous constructor needs a known structure or erasable proof');
  }

  /** Elaborate `head args...`, including dotted method chains. */
  apply(head, argNodes, scope, expected) {
    const args = () => argNodes.map(arg => this.term(arg, scope));
    if (head.t === 'proj') {
      const receiver = this.term(head.expr, scope);
      return this.method(receiver, head.field, argNodes, scope);
    }
    if (head.t === 'dot-constructor') return this.constructorTerm(head.name, args(), true);
    if (head.t !== 'name') return this.applyValue(this.term(head, scope), args());
    const name = head.name;
    if (name === '·' || (!name.includes('.') && scope.has(name))) {
      return this.applyValue(this.local(name, scope), args());
    }
    // Lean auto-bound implicit type variables (`List α`) are type parameters.
    if (this.language === 'lean' && /^[α-ω]$/u.test(name) && !argNodes.length) {
      return value(['mt-type-variable', `greek-${name.codePointAt(0)}`]);
    }
    const resolved = this.resolveName(name, scope, argNodes, expected);
    if (resolved) return resolved;
    // Lean dotted access: local.field.method, Global.method
    const parts = name.split('.');
    for (let split = parts.length - 1; split >= 1; split -= 1) {
      const prefix = parts.slice(0, split).join('.');
      let receiver;
      if (split === 1 && scope.has(prefix)) receiver = this.local(prefix, scope);
      else receiver = this.resolveName(prefix, scope, []);
      if (receiver === undefined) continue;
      const methods = parts.slice(split);
      for (const method of methods.slice(0, -1)) receiver = this.method(receiver, method, [], scope);
      return this.method(receiver, methods.at(-1), argNodes, scope);
    }
    throw new Error(`unresolved or unsupported source reference ${name}`);
  }

  resolveName(name, scope, argNodes, expected) {
    const args = () => argNodes.map(arg => this.term(arg, scope));
    const info = this.global(name);
    if (info) return this.callGlobal(info, args(), argNodes, scope, expected);
    const record = this.recordConstructorNamed(name);
    if (record) return this.saturate(record.structure.fields.length, args(), values => ['mt-record', record.address, ...values], name);
    const constructor = this.constructorNamed(name);
    if (constructor && this.language === 'rocq') return this.constructorTerm(name, args(), false);
    if (this.language === 'rocq') {
      const owner = this.fieldOwner(name);
      if (owner) return this.saturate(1, args(), ([value]) => ['mt-project', owner.address, name, value], name);
    }
    const builtin = BUILTINS[this.language][name];
    if (builtin) return this.saturate(builtin.arity, args(), builtin.build, name);
    return undefined;
  }

  saturate(arity, values, build, name) {
    if (values.length < arity) throw new Error(`partial application of ${name} is outside native execution`);
    return this.applyValue(build(values.slice(0, arity)), values.slice(arity));
  }

  constructorTerm(name, values, dotted) {
    const found = this.constructorNamed(name);
    if (!found) throw new Error(`unresolved ${dotted ? 'dotted ' : ''}constructor ${name}`);
    const { info, constructor } = found;
    return this.saturate(constructor.arity, values, items => (items.length
      ? ['mt-con', info.address, name, ...items] : value(['mt-con', info.address, name])), name);
  }

  method(receiver, field, argNodes, scope) {
    const values = argNodes.map(arg => this.term(arg, scope));
    const builtin = METHODS[field];
    if (builtin) {
      if (values.length < builtin[0]) throw new Error(`method ${field} needs ${builtin[0]} argument(s)`);
      return this.applyValue(builtin[1](receiver, values.slice(0, builtin[0])), values.slice(builtin[0]));
    }
    const owner = this.fieldOwner(field);
    if (owner) return this.applyValue(['mt-project', owner.address, field, receiver], values);
    throw new Error(`unsupported method or field ${field}`);
  }

  applyValue(fn, values) {
    let result = fn;
    for (const value of values) result = ['mt-apply', result, value];
    return result;
  }

  callGlobal(info, values, argNodes, scope, expected) {
    if (info.kind === 'theorem') throw new Error(`theorem ${info.address} is used as a computational term`);
    if (info.promoted?.length) values = this.inferImplicit(info, values, scope, expected);
    let arity = info.arity;
    if (values.length < arity && info.defaults?.length) {
      // Fill trailing source defaults, elaborated with the supplied actuals.
      const callee = this.owner.corpus.declarationAt(info.address);
      const binders = info.explicit;
      const filled = [...values];
      while (filled.length < arity && binders[filled.length]?.fallback) {
        const inner = new Map();
        binders.slice(0, filled.length).forEach((binder, index) => inner.set(binder.name, filled[index]));
        const saved = this.declaration;
        this.declaration = callee;
        try { filled.push(this.term(binders[filled.length].fallback, inner)); } finally { this.declaration = saved; }
      }
      values = filled;
    }
    if (values.length < arity) return values.length ? ['mt-fn', info.address, ...values] : value(['mt-fn', info.address]);
    return this.applyValue([info.address, ...values.slice(0, arity)], values.slice(arity));
  }

  /** Supply computationally used implicit parameters by first-order matching
   * of the callee's declared result type against the caller's expected type. */
  inferImplicit(info, values, scope, expected) {
    const metas = new Set(info.promoted);
    const bindings = new Map();
    const unify = (pattern, target) => {
      if (!pattern || !target) return false;
      if (pattern.t === 'name' && metas.has(pattern.name)) {
        if (bindings.has(pattern.name)) return JSON.stringify(bindings.get(pattern.name)) === JSON.stringify(target);
        bindings.set(pattern.name, target);
        return true;
      }
      if (pattern.t !== target.t) return false;
      if (pattern.t === 'name') return pattern.name === target.name;
      if (pattern.t === 'num') return pattern.value === target.value;
      if (pattern.t === 'app') return pattern.args.length === target.args.length && unify(pattern.fn, target.fn) &&
        pattern.args.every((arg, index) => unify(arg, target.args[index]));
      if (pattern.t === 'op') return pattern.op === target.op && unify(pattern.left, target.left) && unify(pattern.right, target.right);
      return false;
    };
    if (!unify(info.signature.result, expected) || !info.promoted.every(name => bindings.has(name))) {
      throw new Error(`cannot infer implicit argument(s) ${info.promoted.join(',')} of ${info.address} from the expected type`);
    }
    const result = [];
    let next = 0;
    for (const binder of info.signature.binders) {
      if (binder.implicit && !info.promoted.includes(binder.name)) continue;
      result.push(binder.implicit ? this.term(bindings.get(binder.name), scope) : values[next++]);
    }
    return [...result, ...values.slice(next)];
  }

  lambda(params, bodyNode, scope) {
    const fn = this.aux('fn');
    const names = occurringNames(bodyNode);
    const captured = [...scope.keys()].filter(name => names.has(name) && !params.includes(name) &&
      scope.get(name) !== PROOF && !scope.get(name)?.implicit);
    const capturedVars = captured.map(() => this.variable());
    const paramVars = params.map(() => this.variable());
    const inner = markers(scope);
    captured.forEach((name, index) => inner.set(name, value(capturedVars[index])));
    params.forEach((name, index) => { if (name !== '_') inner.set(name, value(paramVars[index])); });
    const body = this.term(bodyNode, inner);
    this.rule([fn, ...[...capturedVars, ...paramVars].map(value)], body);
    this.applicationRules(fn, captured.length + params.length, captured.length);
    return captured.length ? ['mt-fn', fn, ...captured.map(name => scope.get(name))] : value(['mt-fn', fn]);
  }

  /** The prelude turns (mt-apply CLOSURE ARGUMENT) into (FUNCTION mt-enter ...).
   * These rules, indexed by the function itself, saturate or extend it. */
  applicationRules(fn, arity, from = 0) {
    for (let supplied = from; supplied < arity; supplied += 1) {
      const vars = Array.from({ length: supplied + 1 }, () => this.variable());
      this.rule([fn, 'mt-enter', ...vars.map(value)],
        supplied + 1 === arity ? [fn, ...vars.map(value)] : value(['mt-fn', fn, ...vars]));
    }
  }

  // -- patterns --------------------------------------------------------------

  pattern(node) {
    switch (node.t) {
      case 'hole': return { p: 'wild' };
      case 'as': return { p: 'as', name: node.name, inner: this.pattern(node.pattern) };
      case 'num': return this.natPattern(node.value, { p: 'ctor', family: 'nat', ctor: 'zero', args: [] });
      case 'list': return node.items.reduceRight((tail, head) => ({ p: 'ctor', family: 'list', ctor: 'cons', args: [this.pattern(head), tail] }),
        { p: 'ctor', family: 'list', ctor: 'nil', args: [] });
      case 'tuple': {
        const items = node.items.map(item => this.pattern(item));
        const pair = (a, b) => ({ p: 'ctor', family: 'pair', ctor: 'pair', args: [a, b] });
        return this.language === 'lean' ? items.reduceRight((tail, head) => pair(head, tail)) : items.reduce((head, next) => pair(head, next));
      }
      case 'op':
        if (node.op === 'cons') return { p: 'ctor', family: 'list', ctor: 'cons', args: [this.pattern(node.left), this.pattern(node.right)] };
        if (node.op === 'add' && node.right.t === 'num') return this.natPattern(node.right.value, this.pattern(node.left));
        throw new Error(`unsupported pattern operator ${node.op}`);
      case 'dot-constructor': return this.constructorPattern(node.name, []);
      case 'name': return this.namePattern(node.name, []);
      case 'app':
        if (node.fn.t === 'dot-constructor') return this.constructorPattern(node.fn.name, node.args);
        if (node.fn.t === 'name') return this.namePattern(node.fn.name, node.args);
        throw new Error('unsupported applied pattern');
      default: throw new Error(`unsupported pattern ${node.t}`);
    }
  }

  natPattern(count, base) {
    let result = base;
    for (let index = 0; index < count; index += 1) result = { p: 'ctor', family: 'nat', ctor: 'succ', args: [result] };
    return result;
  }

  namePattern(name, argNodes) {
    const builtin = PATTERN_CONSTRUCTORS[this.language][name];
    if (builtin) {
      const [family, ctor, arity, keep] = builtin;
      const kept = keep ? argNodes.filter((_, index) => keep[index]) : argNodes;
      if ((keep ? keep.length : arity) !== argNodes.length) throw new Error(`pattern ${name} has the wrong arity`);
      return { p: 'ctor', family, ctor, args: kept.map(arg => this.pattern(arg)) };
    }
    if (this.language === 'rocq' && this.constructorNamed(name)) return this.constructorPattern(name, argNodes);
    if (argNodes.length) throw new Error(`unsupported constructor pattern ${name}`);
    if (name.includes('.')) throw new Error(`unsupported qualified pattern ${name}`);
    return { p: 'var', name };
  }

  constructorPattern(name, argNodes) {
    const found = this.constructorNamed(name);
    if (!found) throw new Error(`unresolved constructor pattern ${name}`);
    if (found.constructor.arity !== argNodes.length) throw new Error(`constructor pattern ${name} has the wrong arity`);
    return { p: 'ctor', family: found.info.address, ctor: name, args: argNodes.map(arg => this.pattern(arg)) };
  }

  familyConstructors(family) {
    if (FAMILIES[family]) return FAMILIES[family];
    const info = this.owner.info.get(family);
    return info.constructors.map(entry => [entry.name, entry.arity]);
  }

  /** The raw constructor link inspected by one decision-tree step. */
  constructorValue(family, ctor, values) {
    if (family === 'nat') return ctor === 'zero' ? 'mt-view-zero' : ['mt-view-succ', ...values];
    if (FAMILIES[family]) return values.length ? [VALUE_TAGS[ctor], ...values] : VALUE_TAGS[ctor];
    return ['mt-con', family, ctor, ...values];
  }

  /** A term that rebuilds the matched value from its constructor's fields. */
  rebuildConstructor(family, ctor, fields) {
    const tagged = fields.map(value);
    if (FAMILIES[family]) return tagged.length ? [VALUE_TAGS[ctor], ...tagged] : value(VALUE_TAGS[ctor]);
    return tagged.length ? ['mt-con', family, ctor, ...tagged] : value(['mt-con', family, ctor]);
  }

  match(node, scope) {
    const fn = this.aux('match');
    const names = new Set();
    for (const arm of node.arms) occurringNames(arm.body, names);
    const captured = [...scope.keys()].filter(name => names.has(name) && scope.get(name) !== PROOF && !scope.get(name)?.implicit);
    const capturedVars = captured.map(() => this.variable());
    const columns = node.scrutinees.map(() => this.variable());
    const rows = node.arms.map(arm => ({ patterns: arm.patterns.map(pattern => this.pattern(pattern)), body: arm.body, binds: new Map() }));
    this.decide(fn, captured, capturedVars, columns, rows, markers(scope));
    return [fn, ...captured.map(name => scope.get(name)), ...node.scrutinees.map(item => this.term(item, scope))];
  }

  decide(fn, captured, capturedVars, columns, rows, marked) {
    if (!rows.length) { this.nonExhaustive += 1; return; }
    for (const row of rows) {
      row.patterns = row.patterns.map((pattern, index) => {
        while (pattern.p === 'as') {
          row.binds.set(pattern.name, value(columns[index]));
          pattern = pattern.inner;
        }
        return pattern;
      });
    }
    const first = rows[0];
    const column = first.patterns.findIndex(pattern => pattern.p === 'ctor');
    if (column === -1) {
      const scope = new Map(marked);
      captured.forEach((name, index) => scope.set(name, value(capturedVars[index])));
      for (const [name, bound] of first.binds) scope.set(name, bound);
      first.patterns.forEach((pattern, index) => { if (pattern.p === 'var') scope.set(pattern.name, value(columns[index])); });
      this.rule([fn, ...[...capturedVars, ...columns].map(value)], this.term(first.body, scope));
      return;
    }
    const family = first.patterns[column].family;
    const variable = columns[column];
    // A binary natural is inspected through its zero/successor view.
    let head = fn;
    if (family === 'nat') {
      head = this.aux('view');
      const viewed = [...capturedVars, ...columns].map(value);
      viewed[capturedVars.length + column] = ['mt-nat-view', variable];
      this.rule([fn, ...[...capturedVars, ...columns].map(value)], [head, ...viewed]);
    }
    for (const [ctor, arity] of this.familyConstructors(family)) {
      const fresh = Array.from({ length: arity }, () => this.variable());
      const raw = this.constructorValue(family, ctor, fresh);
      const next = [];
      for (const row of rows) {
        const pattern = row.patterns[column];
        if (pattern.p === 'ctor' && pattern.family !== family) throw new Error('match column mixes constructor families');
        if (pattern.p === 'ctor' && pattern.ctor !== ctor) continue;
        const rebuilt = this.rebuildConstructor(family, ctor, fresh);
        const binds = new Map([...row.binds].map(([name, bound]) => [name, substitute(bound, value(variable), rebuilt)]));
        let expanded;
        if (pattern.p === 'ctor') expanded = pattern.args;
        else {
          expanded = fresh.map(() => ({ p: 'wild' }));
          if (pattern.p === 'var') binds.set(pattern.name, rebuilt);
        }
        next.push({ patterns: [...row.patterns.slice(0, column), ...expanded, ...row.patterns.slice(column + 1)], body: row.body, binds });
      }
      if (!next.length) { this.nonExhaustive += 1; continue; }
      const child = this.aux('case');
      const childColumns = [...columns.slice(0, column), ...fresh, ...columns.slice(column + 1)];
      const matched = [...capturedVars, ...columns].map(value);
      matched[capturedVars.length + column] = value(raw);
      this.rule([head, ...matched], [child, ...[...capturedVars, ...childColumns].map(value)]);
      this.decide(child, captured, capturedVars, childColumns, next, marked);
    }
  }
}

/** Proof and implicit markers stay visible so their misuse is reported exactly. */
function markers(scope) {
  return new Map([...scope].filter(([, value]) => value === PROOF || value?.implicit));
}

/** Whether a parameter variable occurs other than as a tagged value (mt-v ?p). */
function hasUntaggedOccurrence(term, params) {
  if (typeof term === 'string') return params.has(term);
  if (term.length === 2 && term[0] === 'mt-v' && params.has(term[1])) return false;
  return term.some(item => hasUntaggedOccurrence(item, params));
}

/** Replace each tagged parameter (mt-v ?p) by the bare variable ?p. */
function untagParameters(term, params) {
  if (typeof term === 'string') return term;
  if (term.length === 2 && term[0] === 'mt-v' && params.has(term[1])) return term[1];
  return term.map(item => untagParameters(item, params));
}

/** Replace every occurrence of the tagged column link by its rebuilding term. */
function substitute(term, tagged, replacement) {
  if (Array.isArray(term) && term.length === 2 && term[0] === tagged[0] && term[1] === tagged[1]) return replacement;
  return Array.isArray(term) ? term.map(item => substitute(item, tagged, replacement)) : term;
}

// ---------------------------------------------------------------------------
// Corpus-wide native program

function renderTerm(term) {
  return Array.isArray(term) ? `(${term.map(renderTerm).join(' ')})` : term;
}

/** Elaborated native linked semantics for every supported corpus declaration. */
export class MetaTheoryNative {
  constructor(corpus) {
    this.corpus = corpus;
    this.info = new Map();
    this.entries = new Map();
    this.braceModules = new Set();
    this.promoted = new Map();
  }

  static fromCorpus(corpus, { braceListModules = [] } = {}) {
    const native = new MetaTheoryNative(corpus);
    for (const key of braceListModules) native.braceModules.add(key);
    // An implicit parameter that a body uses computationally becomes an explicit
    // linked parameter, inferred at call sites from the expected result type.
    for (let round = 0; round < 4; round += 1) {
      native.entries.clear();
      for (const declaration of corpus.declarations) native.describe(declaration);
      for (const declaration of corpus.declarations) native.elaborate(declaration);
      let changed = false;
      for (const entry of native.entries.values()) {
        const match = /^implicit argument (\S+) is used computationally/.exec(entry.reason ?? '');
        const promoted = native.promoted.get(entry.address) ?? [];
        if (match && !promoted.includes(match[1])) {
          native.promoted.set(entry.address, [...promoted, match[1]]);
          changed = true;
        }
      }
      if (!changed) break;
    }
    return native;
  }

  static fromRml(source, foundation, options) {
    return MetaTheoryNative.fromCorpus(FormalCorpus.fromRml(source, foundation), options);
  }

  braceLists(declaration) {
    return declaration.language === 'rocq' && this.braceModules.has(`${declaration.language}.${declaration.module}`);
  }

  describe(declaration) {
    const info = { address: declaration.address, language: declaration.language, kind: declaration.kind, arity: 0 };
    this.info.set(declaration.address, info);
    try {
      if (declaration.kind === 'inductive') info.constructors = describeInductive(declaration);
      if (declaration.kind === 'structure') info.structure = describeStructure(declaration);
      const signature = readSignature(declaration);
      info.signature = signature;
      info.explicit = signature.binders.filter(binder => !binder.implicit);
      info.defaults = info.explicit.filter(binder => binder.fallback);
      if (!['inductive', 'structure', 'theorem'].includes(declaration.kind)) {
        info.syntacticArity = info.explicit.length + equationArity(declaration);
        info.promoted = this.promoted.get(declaration.address) ?? [];
        info.arity = info.syntacticArity + info.promoted.length;
      }
    } catch (error) {
      info.error = error.message;
    }
  }

  elaborate(declaration) {
    const info = this.info.get(declaration.address);
    const elaborator = new DeclarationElaborator(this, declaration);
    const entry = { address: declaration.address, kind: declaration.kind, language: declaration.language };
    this.entries.set(declaration.address, entry);
    try {
      if (info.error) throw new Error(info.error);
      const scope = new Map();
      const { binders, result } = info.signature;
      if (declaration.kind === 'inductive') {
        elaborator.global(declaration.symbol);
        elaborator.rule([declaration.address], value(['mt-inductive-type', declaration.address]));
        for (const constructor of info.constructors) {
          elaborator.rule(['mt-constructor-type', declaration.address, constructor.name],
            elaborator.term(constructor.type, new Map()));
        }
      } else if (declaration.kind === 'structure') {
        elaborator.rule([declaration.address], value(['mt-record-type', declaration.address]));
        const vars = info.structure.fields.map(() => elaborator.variable());
        info.structure.fields.forEach((field, index) => {
          elaborator.rule(['mt-field-type', declaration.address, field.name], elaborator.term(field.type, new Map()));
          elaborator.rule(['mt-project', declaration.address, field.name, value(['mt-record', declaration.address, ...vars])], value(vars[index]));
        });
        const derived = info.structure.derived;
        if (derived.includes('BEq') || declaration.language === 'rocq') {
          const other = info.structure.fields.map(() => elaborator.variable());
          // Field-wise structural equality, reusing the prelude's pair comparison.
          const chain = items => items.reduceRight((tail, head) => ['mt-pair', head, tail]);
          elaborator.rule(['mt-equal-raw', ['mt-record', declaration.address, ...vars], ['mt-record', declaration.address, ...other]],
            ['mt-equal-raw', chain(vars), chain(other)]);
        }
        entry.derived = derived;
      } else if (declaration.kind === 'theorem') {
        const statementScope = new Map();
        let statement = result;
        if (!statement) throw new Error('theorem has no statement');
        const binderTerms = [];
        for (const binder of binders) {
          const bound = `mt-bound-${elaborator.counter++}`;
          binderTerms.push(['mt-binder', bound, elaborator.term(binder.type, statementScope)]);
          statementScope.set(binder.name, ['mt-local', bound]);
        }
        let term = elaborator.term(statement, statementScope);
        for (const binder of binderTerms.reverse()) term = ['mt-forall', binder, term];
        elaborator.rule(['mt-statement', declaration.address], term);
        entry.statement = term;
        // Proof objects are checked by linked certificates, not here. Record
        // which corpus declarations the proof text names, as token evidence.
        for (const token of declaration.proof) {
          if (token.kind !== 'identifier') continue;
          for (const name of [token.text, token.text.slice(token.text.lastIndexOf('.') + 1)]) {
            const found = elaborator.candidates(name);
            if (found.length === 1) elaborator.references.add(found[0].address);
          }
        }
      } else {
        const params = [];
        // Types may mention implicit parameters symbolically; values may not.
        const typeScope = () => new Map([...scope].map(([name, bound]) =>
          [name, bound?.implicit ? value(['mt-implicit-parameter', `mt-implicit-${[...scope.keys()].indexOf(name)}`]) : bound]));
        for (const binder of binders) {
          elaborator.term(binder.type, typeScope());
          if (binder.implicit && !info.promoted.includes(binder.name)) {
            scope.set(binder.name, { implicit: true });
            continue;
          }
          const variable = elaborator.variable();
          if (binder.fallback) elaborator.term(binder.fallback, new Map(scope));
          scope.set(binder.name, value(variable));
          params.push(variable);
        }
        if (result) elaborator.rule(['mt-result-type', declaration.address, ...params.map(value)], elaborator.term(result, typeScope()));
        const reader = elaborator.reader(declaration.body);
        let body;
        if (reader.peek() === '|') {
          const columns = info.arity - params.length;
          const names = Array.from({ length: columns }, (_, index) => `·column${index}`);
          for (const name of names) {
            const variable = elaborator.variable();
            scope.set(name, value(variable));
            params.push(variable);
          }
          const arms = [];
          while (reader.eat('|')) {
            const patterns = [reader.expression()];
            while (reader.eat(',')) patterns.push(reader.expression());
            reader.expect('=>');
            arms.push({ patterns, body: reader.expression() });
          }
          reader.end();
          body = elaborator.match({ scrutinees: names.map(name => ({ t: 'name', name })), arms }, scope);
        } else {
          const node = reader.expression();
          reader.end();
          body = elaborator.term(node, scope, result);
        }
        if (reader.usedBraceLists) elaborator.usedBraceLists = true;
        elaborator.rule([declaration.address, ...params.map(value)], body);
        if (info.arity > 0) elaborator.applicationRules(declaration.address, info.arity);
      }
      entry.status = 'elaborated';
      entry.rules = elaborator.rules;
      entry.arity = info.arity;
      entry.nonExhaustiveBranches = elaborator.nonExhaustive;
      entry.usedBraceLists = elaborator.usedBraceLists;
    } catch (error) {
      entry.status = 'unsupported';
      entry.reason = error.message;
      entry.rules = [];
    }
    const references = [...elaborator.references].sort(compare);
    const structural = [...elaborator.structuralReferences].filter(address => !elaborator.references.has(address)).sort(compare);
    const recorded = declaration.dependencies;
    const known = new Set([...references, ...structural]);
    entry.references = references;
    entry.structuralReferences = structural;
    entry.dependencyCheck = entry.status === 'elaborated'
      ? {
        status: references.every(address => recorded.includes(address)) && recorded.every(address => known.has(address))
          ? 'exact' : 'mismatch',
        unrecorded: references.filter(address => !recorded.includes(address)),
        unused: recorded.filter(address => !known.has(address)),
      }
      : { status: 'not-checked' };
    if (entry.status === 'elaborated' && entry.dependencyCheck.status === 'mismatch') {
      entry.status = 'dependency-mismatch';
      entry.reason = `elaborated references differ from recorded dependency links: unrecorded ${entry.dependencyCheck.unrecorded.join(',') || 'none'}; unused ${entry.dependencyCheck.unused.join(',') || 'none'}`;
    }
  }

  /** Elaborate a source expression from a module-level command. */
  /** Modules reachable from a module through its own import commands. */
  importClosure(language, module, commands) {
    const imports = new Map();
    for (const command of commands) {
      if (command.language !== language || !['import', 'require-import'].includes(command.kind)) continue;
      const targets = commandImportTargets(command);
      imports.set(command.module, [...(imports.get(command.module) ?? []), ...targets]);
    }
    const reached = new Set([module]);
    const pending = [module];
    while (pending.length) {
      for (const target of imports.get(pending.pop()) ?? []) {
        if (reached.has(target) || !this.corpus.module(language, target)) continue;
        reached.add(target);
        pending.push(target);
      }
    }
    return reached;
  }

  /**
   * Elaborate every non-declaration command. Expression commands become
   * linked terms (plus auxiliary rules); scope and import commands are checked
   * against the corpus. Execution happens separately on a linked registry.
   */
  analyzeCommands(commands) {
    const analyses = [];
    const rules = [];
    for (const command of commands) {
      const texts = command.tokens.map(token => token.text);
      const analysis = { id: command.id, language: command.language, module: command.module, kind: command.kind, tokenRange: command.tokenRange };
      const closure = this.importClosure(command.language, command.module, commands);
      const visible = this.corpus.declarations.filter(item => item.language === command.language && closure.has(item.module)).map(item => item.address);
      try {
        if (command.kind === 'import' || command.kind === 'require-import') {
          const targets = commandImportTargets(command);
          analysis.targets = targets.map(target => ({
            name: target,
            resolution: this.corpus.module(command.language, target) ? 'corpus-module' : 'external-library',
          }));
          analysis.status = 'elaborated';
        } else if (command.kind === 'eval' || command.kind === 'compute') {
          const tokens = command.kind === 'eval' ? command.tokens.slice(2)
            : command.tokens.slice(1, texts.at(-1) === '.' ? -1 : undefined);
          const pseudo = { address: `${command.id.replace('#', '.')}`, language: command.language, module: command.module,
            dependencies: visible, signature: [], body: tokens, proof: [], kind: 'command' };
          const elaborator = new DeclarationElaborator(this, pseudo, { auxPrefix: pseudo.address });
          const reader = elaborator.reader(tokens);
          const node = reader.expression();
          reader.end();
          analysis.term = elaborator.term(node, new Map());
          analysis.references = [...elaborator.references].sort(compare);
          rules.push(...elaborator.rules);
          analysis.status = 'elaborated';
        } else if (command.kind === 'check') {
          const name = (command.language === 'lean' ? texts.slice(2) : texts.slice(1, -1)).filter(text => text !== '@');
          if (name.length !== 1) throw new Error('check command must name one declaration');
          const pseudo = { address: command.id, language: command.language, module: command.module, dependencies: visible };
          const found = new DeclarationElaborator(this, pseudo).candidates(name[0]);
          if (found.length !== 1) throw new Error(`unresolved check target ${name[0]}`);
          analysis.target = found[0].address;
          analysis.term = found[0].kind === 'theorem' ? ['mt-statement', found[0].address] : [found[0].address];
          analysis.status = this.entries.get(found[0].address)?.status === 'elaborated' ? 'elaborated' : 'unsupported';
          if (analysis.status !== 'elaborated') analysis.reason = 'check target is not natively elaborated';
        } else if (command.kind === 'notation') {
          const body = texts.slice(texts.indexOf(':=') + 1).join(' ');
          const known = ['( nil ) ( at level 0 ) .', '( cons x .. ( cons y nil ) .. ) ( at level 0 ) .'];
          if (!known.includes(body)) throw new Error('unsupported notation body');
          analysis.notation = 'brace-list';
          analysis.status = 'elaborated';
        } else if (command.kind === 'namespace' || command.kind === 'end') {
          const name = texts[1];
          if (texts.length !== 2 || name !== command.module) throw new Error('namespace must name its module');
          analysis.namespace = name;
          analysis.status = 'elaborated';
        } else if (command.kind === 'open') {
          analysis.namespace = texts[1];
          analysis.status = this.corpus.module(command.language, texts[1]) ? 'elaborated' : 'unsupported';
          if (analysis.status !== 'elaborated') analysis.reason = 'opened namespace is not a corpus module';
        } else {
          throw new Error(`unsupported command kind ${command.kind}`);
        }
      } catch (error) {
        analysis.status = 'unsupported';
        analysis.reason = error.message;
      }
      analyses.push(analysis);
    }
    return { analyses, rules };
  }

  /**
   * Symbolic delta rules for definitional conversion: each non-recursive
   * definition also unfolds by name on arbitrary (possibly open) arguments.
   * Recursive definitions keep only their call-by-value rules, so unfolding
   * an open term always terminates. Used only by the conversion program that
   * proof certificates consult; ordinary execution never loads these rules.
   */
  conversionRules() {
    const rules = [];
    for (const entry of [...this.entries.values()].sort((left, right) => compare(left.address, right.address))) {
      const declaration = this.corpus.declarationAt(entry.address);
      if (entry.status !== 'elaborated' || !entry.arity || declaration.recursive || declaration.kind === 'theorem') continue;
      const main = entry.rules.find(rule => rule.pattern[0] === entry.address && rule.pattern.length === entry.arity + 1 &&
        rule.pattern.slice(1).every(item => Array.isArray(item) && item.length === 2 && item[0] === 'mt-v' &&
          typeof item[1] === 'string' && item[1].startsWith('?')));
      if (!main) continue;
      const params = main.pattern.slice(1).map(item => item[1]);
      if (hasUntaggedOccurrence(main.replacement, new Set(params))) continue;
      rules.push({ name: `${entry.address}--delta`, pattern: [entry.address, ...params],
        replacement: untagParameters(main.replacement, new Set(params)) });
    }
    return rules;
  }

  /** The conversion program: delta rules first, then the whole native program. */
  conversionProgramSource() {
    const lines = [
      '# Generated by scripts/generate-meta-theory-native.mjs: definitional unfolding for certificate conversion.',
      '# Each rule restates one non-recursive definition by name; do not edit.',
      '',
      `(linked-program ${META_THEORY_CONVERSION_PROGRAM} (uses ${META_THEORY_NATIVE_PROGRAM}))`,
    ];
    for (const rule of this.conversionRules()) {
      lines.push('', `(linked-rewrite ${META_THEORY_CONVERSION_PROGRAM} ${rule.name}`,
        `  (from ${renderTerm(rule.pattern)})`, `  (to ${renderTerm(rule.replacement)}))`);
    }
    return `${lines.join('\n')}\n`;
  }

  /** An elaborator for source terms that occur inside a theorem's proof. */
  proofElaborator(declaration) {
    return new DeclarationElaborator(this, declaration, { auxPrefix: `${declaration.address}--proof` });
  }

  coverage() {
    return [...this.entries.values()].sort((left, right) => compare(left.address, right.address)).map(entry => ({
      address: entry.address,
      kind: entry.kind,
      status: entry.status,
      ...(entry.reason ? { reason: entry.reason } : {}),
      rules: entry.rules.length,
      references: entry.references,
      structuralReferences: entry.structuralReferences,
      dependencyCheck: entry.dependencyCheck,
      ...(entry.nonExhaustiveBranches ? { nonExhaustiveBranches: entry.nonExhaustiveBranches } : {}),
      ...(entry.derived ? { derived: entry.derived } : {}),
    }));
  }

  /** The executable program: only exact, dependency-checked declarations. */
  programSource({ extraRules = [] } = {}) {
    const lines = [
      '# Generated by scripts/generate-meta-theory-native.mjs from upstream-0.0.3.lino.',
      '# Each rule is elaborated from preserved declaration tokens; do not edit.',
      '',
      `(linked-program ${META_THEORY_NATIVE_PROGRAM} (uses ${META_THEORY_NATIVE_PRELUDE}))`,
    ];
    for (const entry of [...this.entries.values()].sort((left, right) => compare(left.address, right.address))) {
      if (entry.status !== 'elaborated') continue;
      lines.push('', `# ${entry.address}`);
      for (const rule of entry.rules) {
        lines.push(`(linked-rewrite ${META_THEORY_NATIVE_PROGRAM} ${rule.name}`,
          `  (from ${renderTerm(rule.pattern)})`, `  (to ${renderTerm(rule.replacement)}))`);
      }
    }
    if (extraRules.length) lines.push('', `# ${NATIVE_COMMAND_SECTION}`);
    for (const rule of extraRules) {
      lines.push(`(linked-rewrite ${META_THEORY_NATIVE_PROGRAM} ${rule.name}`,
        `  (from ${renderTerm(rule.pattern)})`, `  (to ${renderTerm(rule.replacement)}))`);
    }
    return `${lines.join('\n')}\n`;
  }
}

// ---------------------------------------------------------------------------
// Non-declaration commands

const LEAN_COMMAND_STARTS = new Set(['import', 'open', 'namespace', 'end', 'section', 'example', 'instance',
  'set_option', 'variable', 'notation', 'attribute']);
const LEAN_HASH_COMMANDS = { eval: 'eval', check: 'check', print: 'print', reduce: 'reduce' };

function leanCommandKind(tokens) {
  const first = tokens[0]?.text;
  if (first === '#') return LEAN_HASH_COMMANDS[tokens[1]?.text] ?? 'unknown';
  return LEAN_COMMAND_STARTS.has(first) ? first : 'unknown';
}

function rocqCommandKind(tokens) {
  const texts = tokens.map(token => token.text);
  if (texts[0] === 'Require' && texts[1] === 'Import') return 'require-import';
  if (texts[0] === 'From' && texts.includes('Require')) return 'require-import';
  return { Import: 'import', Notation: 'notation', Compute: 'compute', Check: 'check', Open: 'open' }[texts[0]] ?? 'unknown';
}

function commandImportTargets(command) {
  const texts = command.tokens.map(token => token.text);
  const start = command.language === 'lean' ? 1 : texts.indexOf('Import') + 1;
  return texts.slice(start).filter(text => text !== '.');
}

/**
 * Every source token outside a declaration range, segmented into commands.
 * Together with the declarations these segments cover each module's complete
 * linked token stream; the coverage map test asserts that partition.
 */
export function corpusCommands(corpus) {
  const commands = [];
  for (const module of corpus.formalModules) {
    const covered = new Array(module.tokens.length).fill(false);
    for (const declaration of corpus.declarations) {
      if (declaration.language !== module.language || declaration.module !== module.name) continue;
      for (let index = declaration.syntaxRange[0]; index < declaration.syntaxRange[1]; index += 1) covered[index] = true;
    }
    const segments = [];
    let current;
    const flush = () => { if (current) segments.push(current); current = undefined; };
    for (let index = 0; index < module.tokens.length; index += 1) {
      if (covered[index]) { flush(); continue; }
      const token = module.tokens[index];
      if (module.language === 'lean' && (LEAN_COMMAND_STARTS.has(token.text) ||
        (token.text === '#' && LEAN_HASH_COMMANDS[module.tokens[index + 1]?.text]))) flush();
      current ??= { start: index, tokens: [] };
      current.tokens.push(token);
      current.end = index + 1;
      // A Rocq command ends with a period token (`..` is notation syntax).
      if (module.language === 'rocq' && token.text === '.') flush();
    }
    flush();
    segments.forEach((segment, position) => {
      commands.push({
        id: `rml.formal.${module.language}.${module.name}#command-${position}`,
        language: module.language,
        module: module.name,
        kind: module.language === 'lean' ? leanCommandKind(segment.tokens) : rocqCommandKind(segment.tokens),
        tokenRange: [segment.start, segment.end],
        tokens: segment.tokens,
      });
    });
  }
  return commands;
}

// ---------------------------------------------------------------------------
// Rendering normal forms for comparison with source-stated expectations

/** The number denoted by a canonical binary natural link, or undefined. */
export function naturalValue(term) {
  if (term === 'mt-zero') return 0;
  if (!Array.isArray(term) || term.length !== 2 || (term[0] !== 'mt-b0' && term[0] !== 'mt-b1')) return undefined;
  const half = naturalValue(term[1]);
  if (half === undefined || (term[0] === 'mt-b0' && half === 0)) return undefined;
  return half * 2 + (term[0] === 'mt-b1' ? 1 : 0);
}

export function renderNativeValue(term, language = 'lean') {
  if (Array.isArray(term) && term[0] === 'mt-v' && term.length === 2) return renderNativeValue(term[1], language);
  const number = naturalValue(term);
  if (number !== undefined) return String(number);
  if (term === 'mt-nil') return '[]';
  if (term === 'mt-true') return 'true';
  if (term === 'mt-false') return 'false';
  if (term === 'mt-none') return language === 'lean' ? 'none' : 'None';
  if (!Array.isArray(term)) return term;
  if (term[0] === 'mt-cons') {
    const items = [];
    let current = term;
    while (Array.isArray(current) && current[0] === 'mt-cons') { items.push(renderNativeValue(current[1], language)); current = current[2]; }
    if (current !== 'mt-nil') return `(${items.join(' :: ')} :: ${renderNativeValue(current, language)})`;
    return `[${items.join(language === 'lean' ? ', ' : '; ')}]`;
  }
  if (term[0] === 'mt-pair') return `(${renderNativeValue(term[1], language)}, ${renderNativeValue(term[2], language)})`;
  if (term[0] === 'mt-some') return `${language === 'lean' ? 'some' : 'Some'} ${renderNativeValue(term[1], language)}`;
  if (term[0] === 'mt-con') return `(${term[2]}${term.slice(3).map(item => ` ${renderNativeValue(item, language)}`).join('')})`;
  if (term[0] === 'mt-record') return `{${term.slice(2).map(item => renderNativeValue(item, language)).join(', ')}}`;
  return renderTerm(term);
}

/** Replace language-qualified addresses so Lean and Rocq values can be compared. */
export function languageNeutral(term) {
  if (typeof term === 'string') return term.replace(/^rml\.formal\.(lean|rocq)\./, 'rml.formal.*.');
  return term.map(languageNeutral);
}

/** A finished value: the tagged link (mt-v RAW) whose RAW contains no redex tag. */
export function isNativeValue(term) {
  const raw = node => typeof node === 'string' ? node !== 'mt-v' : node.length > 0 && node[0] !== 'mt-v' && node.every(raw);
  return Array.isArray(term) && term.length === 2 && term[0] === 'mt-v' && raw(term[1]);
}

/**
 * Shared JSON transport for normal forms: every canonical binary natural becomes
 * (mt-natural DECIMAL), so fixtures stay readable. Both runtimes apply the same
 * compaction before comparing an executed normal form with a fixture.
 */
export function compactNative(term) {
  const number = naturalValue(term);
  if (number !== undefined && Array.isArray(term)) return ['mt-natural', String(number)];
  return Array.isArray(term) ? term.map(compactNative) : term;
}

export function nativeRegistry(prelude, programSource, { executionBasis = 'direct-structural' } = {}) {
  return LinkedProgramRegistry.fromRml(`${prelude}\n${programSource}`, { executionBasis });
}

/**
 * Declarations reachable from `roots` through elaborated and structural
 * references in a coverage listing: the static closure that a native
 * execution may use.
 */
export function nativeClosure(declarations, roots) {
  const byAddress = new Map(declarations.map(entry => [entry.address, entry]));
  const reached = new Set();
  const pending = [...roots];
  while (pending.length) {
    const address = pending.pop();
    if (reached.has(address) || !byAddress.has(address)) continue;
    reached.add(address);
    const entry = byAddress.get(address);
    pending.push(...entry.references, ...entry.structuralReferences);
  }
  return [...reached].sort(compare);
}

/**
 * The generated program restricted to the sections of `addresses` (each
 * section is the `# ADDRESS` block of one declaration) plus the shared command
 * section. Removing one address from a closure ablates exactly that
 * declaration's rules, which is how execution witnesses are checked.
 */
export function sliceNativeProgram(programSource, addresses) {
  const keep = new Set([...addresses, NATIVE_COMMAND_SECTION]);
  const header = section => section.slice(2, section.indexOf('\n') === -1 ? undefined : section.indexOf('\n'));
  const sections = programSource.trimEnd().split('\n\n');
  const kept = sections.filter(section => !section.startsWith('# ') || section.startsWith('# Generated') || keep.has(header(section)));
  return `${kept.join('\n\n')}\n`;
}

export { renderTerm as renderNativeTerm, sha256 as nativeSha256 };
