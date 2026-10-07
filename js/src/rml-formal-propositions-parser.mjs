/** Source elaboration for a bounded proposition fragment. This module builds
 * syntax only; proposition formation and domain constraints execute in .lino.
 * It preserves implicit parameter metadata but does not guess omitted actuals.
 */
import { FoundationReader } from './rml-formal-foundation-parser.mjs';

const identifier = value => typeof value === 'string' && /^[\p{L}_][\p{L}\p{N}_'.]*$/u.test(value);
const index = number => number === 0 ? 'fs-index-zero' : ['fs-index-next', index(number - 1)];
const bindsAt = (tag, position) => tag === 'fs-lambda-inferred' ? position === 1
  : ['fs-lambda', 'fs-pi-type', 'fs-forall', 'fs-forall-domain-of'].includes(tag) && position === 2;

/** This fragment preserves implicit binders in definitions but has no general
 * application unifier. Refuse a source reference requiring that elaboration,
 * rather than silently treating its next actual as an explicit implicit slot.
 */
export function explicitPropositionReference(declaration) {
  if (declaration.signature.some(token => (typeof token === 'string' ? token : token.text) === '{')) {
    throw new Error('implicit source applications require justified argument inference');
  }
  return declaration.address;
}
function indexNumber(value) {
  if (value === 'fs-index-zero') return 0;
  if (Array.isArray(value) && value.length === 2 && value[0] === 'fs-index-next') return 1 + indexNumber(value[1]);
  throw new Error('malformed local index');
}

/** Shift free de Bruijn indices, respecting every binder emitted here. */
export function shiftPropositionSyntax(term, amount, cutoff = 0) {
  if (!Array.isArray(term)) return term;
  if (term[0] === 'fs-variable') {
    const value = indexNumber(term[1]);
    if (value < cutoff) return [...term];
    if (value + amount < cutoff) throw new Error('quantifier domain depends on its own untyped binder');
    return ['fs-variable', index(value + amount)];
  }
  return term.map((part, position) => position === 0 ? part
    : shiftPropositionSyntax(part, amount, cutoff + (bindsAt(term[0], position) ? 1 : 0)));
}

// Find a use of this binder as an application argument and retain its actual
// source function. Lowering rejects a function that itself depends on that
// binder. All remaining uses are independently checked by the linked program.
function domainWitness(body, depth = 0) {
  if (!Array.isArray(body)) return undefined;
  if (body[0] === 'fs-apply' && body[2]?.[0] === 'fs-variable' && indexNumber(body[2][1]) === depth) {
    try {
      let witness = body[1];
      for (let removed = 0; removed <= depth; removed += 1) witness = shiftPropositionSyntax(witness, -1);
      return witness;
    } catch { /* Another source occurrence may provide an independent domain. */ }
  }
  for (let position = 1; position < body.length; position += 1) {
    const found = domainWitness(body[position], depth + (bindsAt(body[0], position) ? 1 : 0));
    if (found) return found;
  }
  return undefined;
}

export class PropositionReader extends FoundationReader {
  child(tokens, scope = this.scope) {
    return new PropositionReader(tokens, { language: this.language, resolve: this.resolve, records: this.records, scope });
  }
  binder() {
    const implicit = this.eat('{');
    if (!implicit) this.expect('(');
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
    this.expect(implicit ? '}' : ')');
    if (!names.length) throw new Error('empty binder');
    for (const name of names) this.scope.unshift(name);
    // In `(x y : F n)`, y's annotation is under x, so n moves by one.
    return names.map((name, offset) => ({ name, type: shiftPropositionSyntax(type, offset), implicit }));
  }
  atom() {
    if (this.peek() === 'Prop') { this.take(); return ['fs-prop-type']; }
    if (this.peek() === (this.language === 'lean' ? '∀' : 'forall')) {
      this.take();
      return this.universal();
    }
    return super.atom();
  }
  universal() {
    const previous = [...this.scope], parameters = [];
    while (this.peek() !== ',') {
      if (this.peek() === '(') parameters.push(...this.binder());
      else {
        const name = this.take();
        if (!identifier(name) || name === '_' || this.scope.includes(name)) throw new Error(`unsupported universal binder ${name}`);
        this.scope.unshift(name);
        parameters.push({ name });
      }
    }
    if (!parameters.length) throw new Error('universal proposition needs a binder');
    this.expect(',');
    let body = this.expression();
    for (const parameter of parameters.reverse()) {
      if (parameter.type) body = ['fs-forall', parameter.type, body];
      else {
        const witness = domainWitness(body);
        if (!witness) throw new Error(`no source application determines universal domain ${parameter.name}`);
        body = ['fs-forall-domain-of', witness, body];
      }
    }
    this.scope = previous;
    return body;
  }
}

export function elaboratePropositionDeclaration(declaration, resolve, records = []) {
  if (!['definition', 'abbreviation'].includes(declaration.kind) || declaration.recursive) {
    throw new Error('proposition layer supports nonrecursive definitions only');
  }
  const options = { language: declaration.language, resolve, records };
  const signature = new PropositionReader(declaration.signature, options);
  const parameters = [];
  while (['(', '{'].includes(signature.peek())) parameters.push(...signature.binder());
  let annotation;
  if (signature.eat(':')) annotation = signature.expression();
  signature.end();
  const reader = new PropositionReader(declaration.body, { ...options, scope: signature.scope });
  let body = reader.expression(); reader.end();
  for (const parameter of [...parameters].reverse()) {
    body = ['fs-lambda', parameter.type, body];
    if (annotation) annotation = ['fs-pi-type', parameter.type, annotation];
  }
  return { body, annotation, parameters };
}
