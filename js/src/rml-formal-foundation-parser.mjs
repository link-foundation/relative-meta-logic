/** Explicit source elaboration for indexed types and named finite records.
 * Parsing produces data only. The linked foundation program checks every type,
 * definition, constructor, projection and function application independently.
 */
import { formalNatural, formalList } from './rml-formal-semantics.mjs';

const identifier = value => typeof value === 'string' && /^[\p{L}_][\p{L}\p{N}_'.]*$/u.test(value);
const index = number => number === 0 ? 'fs-index-zero' : ['fs-index-next', index(number - 1)];
const spine = (tag, end, items) => items.reduceRight((tail, value) => [tag, value, tail], end);
export const recordValues = values => spine('fs-field-value', 'fs-field-values-end', values);

export class FoundationReader {
  constructor(tokens, { language, resolve, records = [], scope = [] }) {
    this.tokens = tokens.map(token => typeof token === 'string' ? token : token.text);
    this.position = 0;
    this.language = language;
    this.resolve = resolve;
    this.records = records;
    this.scope = [...scope];
  }
  peek(offset = 0) { return this.tokens[this.position + offset]; }
  take() {
    if (this.position === this.tokens.length) throw new Error('unexpected end of foundation expression');
    return this.tokens[this.position++];
  }
  eat(value) { if (this.peek() !== value) return false; this.position += 1; return true; }
  expect(value) { if (!this.eat(value)) throw new Error(`expected ${value}, found ${this.peek() ?? 'end'}`); }
  end() { if (this.position !== this.tokens.length) throw new Error(`unsupported trailing source ${this.peek()}`); }
  child(tokens, scope = this.scope) {
    return new FoundationReader(tokens, { language: this.language, resolve: this.resolve, records: this.records, scope });
  }
  binder() {
    if (this.peek() === '{') throw new Error('implicit arguments require further source elaboration');
    this.expect('(');
    const names = [];
    while (this.peek() !== ':') {
      const name = this.take();
      if (!identifier(name) || name === '_' || this.scope.includes(name) || names.includes(name)) {
        throw new Error(`unsupported or shadowed binder ${name}`);
      }
      names.push(name);
    }
    this.expect(':');
    const type = this.expression();
    this.expect(')');
    if (!names.length) throw new Error('empty binder');
    for (const name of names) this.scope.unshift(name);
    return names.map(name => ({ name, type }));
  }
  expression(minimum = 0) {
    let value = this.atom();
    const operators = new Map([
      ['->', [1, 'fs-arrow-type']], ['=', [2, 'fs-equal']],
      ['::', [4, 'fs-cons']],
      ...(this.language === 'lean'
        ? [['→', [1, 'fs-arrow-type']], ['×', [3, 'fs-product-type']], ['==', [2, 'fs-nat-equal']]]
        : [['*', [3, 'fs-product-type']], ['=?', [2, 'fs-nat-equal']]]),
    ]);
    const stops = new Set([')', ']', '}', '⟩', ',', ';', ':', '=>', '|', 'in', 'with', 'end', 'deriving']);
    while (this.peek() !== undefined && !stops.has(this.peek())) {
      const operator = operators.get(this.peek());
      if (operator) {
        if (operator[0] < minimum) break;
        this.take();
        value = [operator[1], value, this.expression(operator[0])];
      } else {
        if (minimum > 5 || !this.startsAtom()) break;
        value = ['fs-apply', value, this.expression(6)];
      }
    }
    return value;
  }
  startsAtom() {
    return ['(', '[', '⟨'].includes(this.peek()) || identifier(this.peek()) || /^\d+$/.test(this.peek() ?? '');
  }
  atom() {
    const token = this.take();
    if (token === '_') throw new Error('source elaboration holes are not checked terms');
    if (token === '(') {
      const first = this.expression();
      if (this.eat(',')) { const second = this.expression(); this.expect(')'); return ['fs-pair', first, second]; }
      this.expect(')'); return first;
    }
    if (token === '[') {
      const values = [];
      if (!this.eat(']')) {
        do { values.push(this.expression()); } while (this.eat(this.language === 'lean' ? ',' : ';'));
        this.expect(']');
      }
      return formalList(values);
    }
    if (token === '⟨' && this.language === 'lean') {
      const values = [];
      if (!this.eat('⟩')) {
        do { values.push(this.expression()); } while (this.eat(','));
        this.expect('⟩');
      }
      return ['fs-record-untyped', recordValues(values)];
    }
    if (/^\d+$/.test(token)) return formalNatural(Number(token));
    // Resolve lexical locals first: Rocq's vector type constructor `t` must not
    // steal a source binder named t, a common name in the actual proof corpus.
    const path = token.split('.');
    const local = this.scope.indexOf(path[0]);
    if (local !== -1) {
      let value = ['fs-variable', index(local)];
      for (const field of path.slice(1)) {
        if (field === 'length' && this.language === 'lean') value = ['fs-length', value];
        else if (field === 'all' && this.language === 'lean') value = ['fs-all', this.expression(6), value];
        else {
          this.requireProjection(field);
          value = ['fs-project', field, value];
        }
      }
      return value;
    }
    if (token === (this.language === 'lean' ? 'Nat' : 'nat')) return ['fs-nat-type'];
    if (token === (this.language === 'lean' ? 'Bool' : 'bool')) return ['fs-bool-type'];
    if (token === (this.language === 'lean' ? 'List' : 'list')) return ['fs-list-type', this.expression(6)];
    if (token === (this.language === 'lean' ? 'Vector' : 't')) return ['fs-vector-type', this.expression(6), this.expression(6)];
    if (this.language === 'lean' && token === 'Vector.replicate') {
      const length = this.expression(6), value = this.expression(6);
      return ['fs-vector-repeat', length, value];
    }
    if (this.language === 'rocq' && token === 'Vector.const') {
      const value = this.expression(6), length = this.expression(6);
      return ['fs-vector-repeat', length, value];
    }
    if (this.language === 'rocq' && token === 'prod') return ['fs-product-type', this.expression(6), this.expression(6)];
    if (this.language === 'rocq' && token === 'nil') return ['fs-nil'];
    if (this.language === 'rocq' && token === 'cons') return ['fs-cons', this.expression(6), this.expression(6)];
    if (this.language === 'rocq' && token === 'length') return ['fs-length', this.expression(6)];
    if (this.language === 'rocq' && token === 'Nat.eqb') return ['fs-nat-equal', this.expression(6), this.expression(6)];
    if (this.language === 'rocq' && token === 'forallb') {
      const predicate = this.expression(6), list = this.expression(6);
      return ['fs-all', predicate, list];
    }
    if (token === 'true' || token === 'false') return [`fs-${token}`];
    if (token === 'fun') return this.lambda();
    const constructors = this.records.filter(record => record.language === this.language && record.constructor === token);
    if (constructors.length === 1) {
      const record = constructors[0];
      const address = this.resolve(record.symbol);
      const values = record.fields.map(() => this.expression(6));
      return ['fs-record', ['fs-global', address], recordValues(values)];
    }
    if (this.language === 'rocq' && this.records.some(record => record.language === this.language && record.fields.some(field => field.name === token))) {
      this.requireProjection(token);
      return ['fs-project', token, this.expression(6)];
    }
    if (!identifier(token)) throw new Error(`unsupported source atom ${token}`);
    return ['fs-global', this.resolve(token)];
  }
  requireProjection(name) {
    const owners = this.records.filter(record => record.language === this.language && record.fields.some(field => field.name === name));
    if (owners.length !== 1) throw new Error(`unresolved or ambiguous record projection ${name}`);
    this.resolve(owners[0].symbol);
  }
  lambda() {
    const previous = [...this.scope];
    const parameters = [];
    while (this.peek() !== '=>') {
      if (this.peek() === '(') parameters.push(...this.binder());
      else {
        const name = this.take();
        if (!identifier(name) || name === '_' || this.scope.includes(name)) throw new Error(`unsupported lambda binder ${name}`);
        this.scope.unshift(name);
        parameters.push({ name });
      }
    }
    if (!parameters.length) throw new Error('lambda needs a binder');
    this.expect('=>');
    let body = this.expression();
    for (const parameter of parameters.reverse()) body = parameter.type
      ? ['fs-lambda', parameter.type, body] : ['fs-lambda-inferred', body];
    this.scope = previous;
    return body;
  }
}

/** Read generated field/constructor context from actual structure source. */
export function describeSourceRecord(declaration) {
  if (declaration.kind !== 'structure') throw new Error('source declaration is not a record');
  const tokens = declaration.body.map(token => token.text);
  let at = 0;
  let constructor;
  if (declaration.language === 'rocq') {
    constructor = tokens[at++];
    if (!identifier(constructor) || tokens[at++] !== '{') throw new Error('unsupported Rocq record constructor header');
  }
  const fields = [];
  const derived = [];
  while (at < tokens.length && !['}', 'deriving'].includes(tokens[at])) {
    const name = tokens[at++];
    if (!identifier(name) || name === '_' || fields.some(field => field.name === name) || tokens[at++] !== ':') {
      throw new Error('invalid or duplicate source record field');
    }
    const begin = at;
    let depth = 0;
    while (at < tokens.length) {
      const token = tokens[at];
      if (depth === 0 && ([';', '}', 'deriving'].includes(token) || (identifier(token) && tokens[at + 1] === ':'))) break;
      if (['(', '[', '{'].includes(token)) depth += 1;
      if ([')', ']', '}'].includes(token)) depth -= 1;
      at += 1;
    }
    if (at === begin || depth !== 0) throw new Error('missing or malformed record field type');
    fields.push({ name, tokens: tokens.slice(begin, at) });
    if (tokens[at] === ';') at += 1;
  }
  if (declaration.language === 'rocq') {
    if (tokens[at++] !== '}' || at !== tokens.length) throw new Error('trailing record source');
  } else if (tokens[at] === 'deriving') {
    at += 1;
    while (at < tokens.length) {
      const trait = tokens[at++];
      if (!['Repr', 'BEq'].includes(trait) || derived.includes(trait)) throw new Error(`unsupported derived trait ${trait}`);
      derived.push(trait);
      if (at < tokens.length && tokens[at++] !== ',') throw new Error('malformed deriving clause');
    }
  }
  if (!fields.length || at !== tokens.length) throw new Error('unsupported empty or trailing record syntax');
  return { address: declaration.address, language: declaration.language, symbol: declaration.symbol, constructor, fields, derived };
}

export function elaborateFoundationDeclaration(declaration, resolve, records) {
  const options = { language: declaration.language, resolve, records };
  if (declaration.kind === 'structure') {
    const record = records.find(record => record.address === declaration.address);
    if (!record) throw new Error('record context unavailable');
    let fields = 'fs-fields-end';
    for (const field of [...record.fields].reverse()) {
      const reader = new FoundationReader(field.tokens, options);
      const type = reader.expression(); reader.end();
      fields = ['fs-field', field.name, type, fields];
    }
    return { body: ['fs-record-type', declaration.address, fields], derived: record.derived };
  }
  if (declaration.kind === 'theorem' || declaration.kind === 'inductive' || declaration.recursive) {
    throw new Error('induction, recursive definitions and new proof forms need the next linked layer');
  }
  const signature = new FoundationReader(declaration.signature, options);
  const parameters = [];
  while (['(', '{'].includes(signature.peek())) parameters.push(...signature.binder());
  let annotation;
  if (signature.eat(':')) annotation = signature.expression();
  signature.end();
  const reader = new FoundationReader(declaration.body, { ...options, scope: signature.scope });
  let body = reader.expression(); reader.end();
  for (const parameter of [...parameters].reverse()) {
    body = ['fs-lambda', parameter.type, body];
    if (annotation) annotation = ['fs-pi-type', parameter.type, annotation];
  }
  return { body, annotation };
}
