import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { PropositionReader, shiftPropositionSyntax, explicitPropositionReference } from '../src/rml-formal-propositions-parser.mjs';

const read = name => readFileSync(new URL(`../../lib/meta-theory/${name}.lino`, import.meta.url), 'utf8');
const source = ['formal-propositions', 'formal-indexed', 'formal-records', 'formal-semantics'].map(read).join('\n') +
  '\n(linked-program proposition-primitives (uses formal-propositions) (uses formal-indexed) (uses formal-records) (uses formal-semantics))';
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
const infer = expression => registry.reduce('proposition-primitives', ['fs-infer', expression, 'fs-empty', 'fs-empty'], { maxSteps: 50_000 });
const accepted = result => result.term?.[0] === 'fs-ok';
const zero = ['fs-zero'], one = ['fs-successor', zero], bool = ['fs-bool-type'], nat = ['fs-nat-type'];
const variable = ['fs-variable', 'fs-index-zero'];
const reader = tokens => new PropositionReader(tokens, { language: 'lean', resolve(name) { throw new Error(`unbound source ${name}`); } });

describe('linked proposition formation without a truth shortcut', () => {
  it('forms a false natural equality but its reflexivity proof fails', () => {
    const equality = ['fs-equal', zero, one];
    const result = infer(equality);
    assert.deepEqual(result.term, ['fs-ok', 'fs-t-prop', ['fs-v-equality', 'fs-t-nat', 'fs-v-zero', ['fs-v-successor', 'fs-v-zero']]]);
    const proof = registry.reduce('proposition-primitives', ['fs-prove', equality, ['fs-proof-refl'], 'fs-empty', 'fs-empty']);
    assert.deepEqual(proof.term, ['fs-error', 'unequal-normal-forms']);
  });

  it('requires the same dependent index on both equality sides', () => {
    const left = ['fs-vector-repeat', zero, zero], right = ['fs-vector-repeat', one, zero];
    assert.deepEqual(infer(['fs-equal', left, right]).term, ['fs-error', 'equality-type-mismatch']);
    assert.equal(accepted(infer(['fs-equal', right, right])), true);
    assert.deepEqual(infer(['fs-equal', zero, ['fs-false']]).term, ['fs-error', 'equality-type-mismatch']);
  });

  it('checks a universal body under an arbitrary neutral and retains its lexical closure', () => {
    const body = ['fs-equal', variable, ['fs-successor', variable]];
    const result = infer(['fs-forall', nat, body]);
    assert.deepEqual(result.term, ['fs-ok', 'fs-t-prop', ['fs-v-forall', 'fs-t-nat', ['fs-proposition-closure', body, 'fs-empty']]]);
    assert(result.trace.some(step => step.rule === 'universal-depth'));
    assert.equal(accepted(infer(['fs-forall', nat, zero])), false);
    assert.equal(accepted(infer(['fs-forall', zero, body])), false);
  });

  it('infers an unannotated Bool domain from the source function without a Nat default', () => {
    const body = ['fs-equal', variable, ['fs-false']];
    const expression = ['fs-forall-domain-of', ['fs-lambda', bool, variable], body];
    assert.deepEqual(infer(expression).term, ['fs-ok', 'fs-t-prop', ['fs-v-forall', 'fs-t-bool', ['fs-proposition-closure', body, 'fs-empty']]]);
    assert.equal(accepted(infer(['fs-forall-domain-of', zero, body])), false);
    assert.equal(accepted(infer(['fs-forall-domain-of', ['fs-lambda', nat, variable], body])), false);
  });

  it('does not accept a malformed universal just because its first application determines a domain', () => {
    const first = ['fs-lambda', nat, variable], second = ['fs-lambda', bool, variable];
    const body = ['fs-equal', ['fs-apply', first, variable], ['fs-apply', second, variable]];
    assert.equal(accepted(infer(['fs-forall-domain-of', first, body])), false);
  });
});

describe('source-bound proposition parser', () => {
  it('records implicitness and shifts grouped dependent annotations', () => {
    const parse = reader(['{', 'n', ':', 'Nat', '}', '(', 'a', 'b', ':', 'Vector', 'Nat', 'n', ')']);
    assert.deepEqual(parse.binder(), [{ name: 'n', type: nat, implicit: true }]);
    const parameters = parse.binder();
    assert.equal(parameters[0].implicit, false);
    assert.deepEqual(parameters[0].type, ['fs-vector-type', nat, variable]);
    assert.deepEqual(parameters[1].type, ['fs-vector-type', nat, ['fs-variable', ['fs-index-next', 'fs-index-zero']]]);
    parse.end();
  });

  it('requires an annotated or source-constrained universal domain', () => {
    assert.throws(() => reader(['∀', 'x', ',', 'x', '=', 'x']).expression(), /no source application/);
    const expression = reader(['∀', '(', 'x', ':', 'Bool', ')', ',', 'x', '=', 'false']).expression();
    assert.deepEqual(expression, ['fs-forall', bool, ['fs-equal', variable, ['fs-false']]]);
    assert.equal(accepted(infer(expression)), true);
    assert.throws(() => reader(['∀', 'x', ',', 'x', 'x', '=', 'x']).expression(), /no source application/);
  });

  it('shifts only free variables under nested binders and rejects a self-dependent witness', () => {
    assert.deepEqual(shiftPropositionSyntax(['fs-lambda', nat, variable], 1), ['fs-lambda', nat, variable]);
    assert.deepEqual(shiftPropositionSyntax(['fs-lambda-inferred', variable], 1), ['fs-lambda-inferred', variable]);
    assert.throws(() => shiftPropositionSyntax(variable, -1), /depends on its own/);
    assert.throws(() => reader(['{', 'n', ':', 'Nat', ')']).binder(), /expected }/);
    assert.throws(() => reader(['(', 'x', 'x', ':', 'Nat', ')']).binder(), /shadowed binder/);
  });

  it('rejects implicit source calls until their omitted arguments have justified inference', () => {
    const hidden = { address: 'arbitrary-source-function', signature: ['{', 'n', ':', 'Nat', '}', ':', 'Prop'] };
    const parse = new PropositionReader(['hidden', '0'], { language: 'lean', resolve: () => explicitPropositionReference(hidden) });
    assert.throws(() => parse.expression(), /implicit source applications require justified/);
    assert.equal(explicitPropositionReference({ ...hidden, signature: ['(', 'n', ':', 'Nat', ')', ':', 'Prop'] }), hidden.address);
  });
});
