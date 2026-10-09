import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

test('indexed: independently typed generic positive and adversarial rules (21 assertions)', () => {
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = ['formal-indexed', 'formal-semantics'].map(name =>
  readFileSync(`${root}/lib/meta-theory/${name}.lino`, 'utf8')).join('\n') + `
(linked-program indexed-smoke
  (uses formal-indexed)
  (uses formal-semantics))
`;
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
const run = request => registry.reduce('indexed-smoke', request, { maxSteps: 10000 }).term;
const nat = ['fs-nat-type'];
const zero = ['fs-zero'];
const two = ['fs-successor', ['fs-successor', zero]];
const zeroValue = 'fs-v-zero';
const twoValue = ['fs-v-successor', ['fs-v-successor', zeroValue]];
const variable = ['fs-variable', 'fs-index-zero'];
const outerVariable = ['fs-variable', ['fs-index-next', 'fs-index-zero']];
const empty = 'fs-empty';
const vector = ['fs-vector-type', nat, variable];
const repeat = ['fs-vector-repeat', variable, zero];
const annotation = ['fs-pi-type', nat, vector];
const pi = ['fs-t-pi', 'fs-t-nat', ['fs-type-closure', vector, empty]];
const expectedVector = ['fs-ok', ['fs-t-vector', 'fs-t-nat', twoValue],
  ['fs-v-vector', ['fs-v-cons', zeroValue, ['fs-v-cons', zeroValue, 'fs-v-nil']]]];
let count = 0;
const equals = (request, expected) => { assert.deepEqual(run(request), expected); count++; };
const rejected = request => { assert.notEqual(run(request)?.[0], 'fs-ok'); count++; };

equals(['fs-infer', annotation, empty, empty], ['fs-ok', 'fs-kind', pi]);
const definition = run(['fs-definition', annotation, ['fs-lambda', nat, repeat], empty]);
assert.deepEqual(definition, ['fs-ok', pi, ['fs-closure', repeat, empty]]); count++;
equals(['fs-definition', annotation, ['fs-lambda-inferred', repeat], empty], definition);
const globals = ['fs-global-bind', 'vectorMaker', definition[1], definition[2], empty];
equals(['fs-infer', ['fs-apply', ['fs-global', 'vectorMaker'], two], empty, globals], expectedVector);
equals(['fs-infer', ['fs-vector-repeat', two, zero], empty, empty], expectedVector);
equals(['fs-infer', ['fs-vector-repeat', zero, zero], empty, empty],
  ['fs-ok', ['fs-t-vector', 'fs-t-nat', zeroValue], ['fs-v-vector', 'fs-v-nil']]);

const neutral = ['fs-neutral', 'fs-index-zero'];
const locals = ['fs-bind', 'fs-t-nat', neutral, empty];
equals(['fs-infer', repeat, locals, empty],
  ['fs-ok', ['fs-t-vector', 'fs-t-nat', neutral],
    ['fs-v-vector', ['fs-neutral', ['fs-neutral-vector-repeat', 'fs-index-zero', zeroValue]]]]);
equals(['fs-infer', ['fs-vector-repeat', ['fs-successor', variable], zero], locals, empty],
  ['fs-ok', ['fs-t-vector', 'fs-t-nat', ['fs-v-successor', neutral]],
    ['fs-v-vector', ['fs-v-cons', zeroValue,
      ['fs-neutral', ['fs-neutral-vector-repeat', 'fs-index-zero', zeroValue]]]]]);
equals(['fs-prove', ['fs-forall', nat,
  ['fs-equal', ['fs-apply', ['fs-global', 'vectorMaker'], variable], repeat]],
  ['fs-proof-intro', ['fs-proof-refl']], empty, globals], 'fs-proof-accepted');

// Lexical type closures preserve an outer n when a different m is applied.
const nestedAnnotation = ['fs-pi-type', nat,
  ['fs-pi-type', nat, ['fs-vector-type', nat, outerVariable]]];
const nestedBody = ['fs-lambda', nat,
  ['fs-lambda', nat, ['fs-vector-repeat', outerVariable, zero]]];
const nested = run(['fs-definition', nestedAnnotation, nestedBody, empty]);
assert.equal(nested[0], 'fs-ok'); count++;
const nestedGlobals = ['fs-global-bind', 'outerVector', nested[1], nested[2], empty];
equals(['fs-infer', ['fs-apply', ['fs-apply', ['fs-global', 'outerVector'], two], zero],
  empty, nestedGlobals], expectedVector);

// Type aliases remain ordinary arrow-to-kind lambdas in the frozen kernel.
const familyBody = ['fs-lambda', nat, vector];
const family = run(['fs-infer', familyBody, empty, empty]);
assert.deepEqual(family[1], ['fs-t-arrow', 'fs-t-nat', 'fs-kind']); count++;
const aliasGlobals = ['fs-global-bind', 'Family', family[1], family[2],
  ['fs-global-bind', 'Default', 'fs-t-nat', zeroValue, empty]];
const aliasAnnotation = ['fs-pi-type', nat, ['fs-apply', ['fs-global', 'Family'], variable]];
const aliasBody = ['fs-lambda', nat, ['fs-vector-repeat', variable, ['fs-global', 'Default']]];
assert.equal(run(['fs-definition', aliasAnnotation, aliasBody, aliasGlobals])[0], 'fs-ok'); count++;

equals(['fs-check', ['fs-vector-repeat', two, ['fs-nil']],
  ['fs-t-vector', ['fs-t-list', 'fs-t-nat'], twoValue], empty, empty],
  ['fs-ok', ['fs-t-vector', ['fs-t-list', 'fs-t-nat'], twoValue],
    ['fs-v-vector', ['fs-v-cons', 'fs-v-nil', ['fs-v-cons', 'fs-v-nil', 'fs-v-nil']]]]);
equals(['fs-check', ['fs-vector-repeat', zero, zero],
  ['fs-t-vector', 'fs-t-nat', twoValue], empty, empty], ['fs-error', 'vector-length-mismatch']);
rejected(['fs-definition', annotation, ['fs-lambda', ['fs-list-type', nat], repeat], empty]);
rejected(['fs-definition', ['fs-pi-type', nat,
  ['fs-vector-type', nat, ['fs-successor', variable]]], ['fs-lambda', nat, repeat], empty]);
rejected(['fs-infer', ['fs-pi-type', nat, zero], empty, empty]);
rejected(['fs-infer', ['fs-vector-type', nat, ['fs-pair', zero, zero]], empty, empty]);
rejected(['fs-infer', ['fs-vector-repeat', two, ['fs-unknown-expression']], empty, empty]);
rejected(['fs-infer', ['fs-apply', ['fs-global', 'vectorMaker'], ['fs-pair', zero, zero]], empty, globals]);
assert.equal(count, 21);

});

test('records: independently typed generic positive and adversarial rules (44 assertions)', () => {
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = ['formal-records', 'formal-semantics'].map(name =>
  readFileSync(`${root}/lib/meta-theory/${name}.lino`, 'utf8')).join('\n') +
  '\n(linked-program records-smoke (uses formal-records) (uses formal-semantics))\n';
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
let passed = 0;
const reduce = term => registry.reduce('records-smoke', term, { maxSteps: 50_000 }).term;
const infer = (expression, locals = 'fs-empty', globals = 'fs-empty') =>
  ['fs-infer', expression, locals, globals];
const check = (expression, type, locals = 'fs-empty', globals = 'fs-empty') =>
  ['fs-check', expression, type, locals, globals];
const ok = (type, value) => ['fs-ok', type, value];
const assertResult = (name, term, expected) => {
  assert.deepEqual(reduce(term), expected, name);
  passed += 1;
};
const assertReject = (name, term) => {
  assert.notEqual(reduce(term)?.[0], 'fs-ok', name);
  passed += 1;
};
const nat = n => n === 0 ? ['fs-zero'] : ['fs-successor', nat(n - 1)];
const valueNat = n => n === 0 ? 'fs-v-zero' : ['fs-v-successor', valueNat(n - 1)];
const list = items => items.reduceRight((rest, item) => ['fs-cons', item, rest], ['fs-nil']);
const listValue = items => items.reduceRight((rest, item) => ['fs-v-cons', item, rest], 'fs-v-nil');
const fieldValues = values => values.reduceRight((rest, value) => ['fs-field-value', value, rest], 'fs-field-values-end');
const recordFields = (natType, listType) => ['fs-field', 'dimension', natType,
  ['fs-field', 'tuples', listType, 'fs-fields-end']];
const fields = recordFields(['fs-nat-type'], ['fs-list-type', ['fs-list-type', ['fs-nat-type']]]);
const typedFields = recordFields('fs-t-nat', ['fs-t-list', ['fs-t-list', 'fs-t-nat']]);
const recordType = ['fs-record-type', 'record-alpha', fields];
const recordTypeValue = ['fs-t-record', 'record-alpha', typedFields];
const record = (dimension, tuples) => ['fs-record', recordType, fieldValues([nat(dimension), list(tuples.map(xs => list(xs.map(nat))))])];
const emptyRecord = record(0, []);
const exampleRecord = record(2, [[1, 1], [2, 2], [1, 2]]);
const zero = ['fs-variable', 'fs-index-zero'];
const one = ['fs-variable', ['fs-index-next', 'fs-index-zero']];
const neutral = name => ['fs-neutral', name];
const recordLocal = ['fs-bind', recordTypeValue, neutral('record-input'), 'fs-empty'];
const natLocals = ['fs-bind', 'fs-t-nat', neutral('n'),
  ['fs-bind', 'fs-t-nat', neutral('m'), 'fs-empty']];
const listLocals = ['fs-bind', ['fs-t-list', 'fs-t-nat'], neutral('xs'), 'fs-empty'];
const typedEmpty = ['fs-global', 'empty-naturals'];
const globals = ['fs-global-bind', 'empty-naturals', ['fs-t-list', 'fs-t-nat'], 'fs-v-nil', 'fs-empty'];
const predicate = ['fs-lambda-inferred', ['fs-nat-equal', zero, nat(2)]];
const wellFormedBody = ['fs-all',
  ['fs-lambda-inferred', ['fs-nat-equal', ['fs-length', zero], ['fs-project', 'dimension', one]]],
  ['fs-project', 'tuples', zero]];
const wellFormed = ['fs-lambda', recordType, wellFormedBody];

assertResult('generic record type formation', infer(recordType), ok('fs-kind', recordTypeValue));
assertResult('empty record fields and values', infer(['fs-record', ['fs-record-type', 'unit-record', 'fs-fields-end'], 'fs-field-values-end']),
  ok(['fs-t-record', 'unit-record', 'fs-fields-end'], ['fs-v-record', 'unit-record', 'fs-field-values-end']));
assertReject('duplicate record field rejected', infer(['fs-record-type', 'duplicate',
  ['fs-field', 'x', ['fs-nat-type'], ['fs-field', 'x', ['fs-bool-type'], 'fs-fields-end']]]));
assertReject('record field must be a type', infer(['fs-record-type', 'invalid', ['fs-field', 'x', nat(0), 'fs-fields-end']]));
assertResult('concrete record constructor', infer(emptyRecord), ok(recordTypeValue,
  ['fs-v-record', 'record-alpha', fieldValues(['fs-v-zero', 'fs-v-nil'])]));
assertResult('contextual anonymous constructor', check(['fs-record-untyped', fieldValues([nat(0), ['fs-nil']])], recordTypeValue),
  ok(recordTypeValue, ['fs-v-record', 'record-alpha', fieldValues(['fs-v-zero', 'fs-v-nil'])]));
assertReject('anonymous constructor has no inferred nominal type', infer(['fs-record-untyped', fieldValues([nat(0), ['fs-nil']])]));
assertReject('missing record value rejected', infer(['fs-record', recordType, fieldValues([nat(0)])]));
assertReject('extra record value rejected', infer(['fs-record', recordType, fieldValues([nat(0), ['fs-nil'], nat(0)])]));
assertReject('wrong record value type rejected', infer(['fs-record', recordType, fieldValues([['fs-true'], ['fs-nil']])]));
assertReject('nominally distinct record rejected', check(emptyRecord, ['fs-t-record', 'record-beta', typedFields]));
assertReject('wrong constructor type rejected', infer(['fs-record', ['fs-nat-type'], 'fs-field-values-end']));
assertResult('concrete projection', infer(['fs-project', 'dimension', exampleRecord]), ok('fs-t-nat', valueNat(2)));
assertResult('tail projection and concrete list length', infer(['fs-length', ['fs-project', 'tuples', exampleRecord]]), ok('fs-t-nat', valueNat(3)));
assertResult('neutral projection preserves its declared type', infer(['fs-project', 'dimension', zero], recordLocal),
  ok('fs-t-nat', neutral(['fs-neutral-project', 'record-alpha', 'dimension', 'record-input'])));
assertReject('unknown concrete projection rejected', infer(['fs-project', 'missing', emptyRecord]));
assertReject('unknown neutral projection rejected', infer(['fs-project', 'missing', zero], recordLocal));
assertReject('projection of a natural rejected', infer(['fs-project', 'dimension', nat(0)]));
assertReject('projection nominal type/value mismatch rejected', infer(['fs-project', 'dimension', zero],
  ['fs-bind', recordTypeValue, ['fs-v-record', 'record-beta', fieldValues(['fs-v-zero', 'fs-v-nil'])], 'fs-empty']));
assertResult('Boolean type', infer(['fs-bool-type']), ok('fs-kind', 'fs-t-bool'));
assertResult('Boolean true', infer(['fs-true']), ok('fs-t-bool', 'fs-v-true'));
assertResult('Boolean false', infer(['fs-false']), ok('fs-t-bool', 'fs-v-false'));
assertResult('equal natural values', infer(['fs-nat-equal', nat(3), nat(3)]), ok('fs-t-bool', 'fs-v-true'));
assertResult('unequal natural values', infer(['fs-nat-equal', nat(2), nat(3)]), ok('fs-t-bool', 'fs-v-false'));
assertReject('Boolean is not a Nat for equality', infer(['fs-nat-equal', ['fs-true'], nat(0)]));
assertResult('distinct unknown naturals stay neutral', infer(['fs-nat-equal', zero, one], natLocals),
  ok('fs-t-bool', neutral(['fs-neutral-nat-equal', neutral('n'), neutral('m')])));
assertResult('neutral versus concrete stays neutral', infer(['fs-nat-equal', nat(0), zero], natLocals),
  ok('fs-t-bool', neutral(['fs-neutral-nat-equal', 'fs-v-zero', neutral('n')])));
assertResult('symbolic list length stays neutral', infer(['fs-length', zero], listLocals),
  ok('fs-t-nat', neutral(['fs-neutral-length', 'xs'])));
assertResult('known cons contributes to symbolic length', infer(['fs-length', ['fs-cons', nat(4), zero]], listLocals),
  ok('fs-t-nat', ['fs-v-successor', neutral(['fs-neutral-length', 'xs'])]));
assertResult('typed empty list length is zero', infer(['fs-length', typedEmpty], 'fs-empty', globals), ok('fs-t-nat', 'fs-v-zero'));
assertReject('length requires list', infer(['fs-length', nat(0)]));
assertResult('contextual nested empty lists', check(list([list([])]), ['fs-t-list', ['fs-t-list', 'fs-t-nat']]),
  ok(['fs-t-list', ['fs-t-list', 'fs-t-nat']], listValue(['fs-v-nil'])));
assertResult('all true with inferred lambda', infer(['fs-all', predicate, list([nat(2), nat(2)])]), ok('fs-t-bool', 'fs-v-true'));
assertResult('all false with inferred lambda', infer(['fs-all', predicate, list([nat(2), nat(1)])]), ok('fs-t-bool', 'fs-v-false'));
assertResult('all typed empty list', infer(['fs-all', predicate, typedEmpty], 'fs-empty', globals), ok('fs-t-bool', 'fs-v-true'));
assertReject('all rejects non-Boolean predicate even on empty list', infer(['fs-all', ['fs-lambda-inferred', nat(0)], typedEmpty], 'fs-empty', globals));
assertReject('all requires list', infer(['fs-all', predicate, nat(0)]));
assertReject('inferred lambda requires expected function type', infer(predicate));
assertResult('network well-formedness example', infer(['fs-apply', wellFormed, exampleRecord]), ok('fs-t-bool', 'fs-v-true'));
assertResult('network well-formedness negative', infer(['fs-apply', wellFormed, record(2, [[1, 2], [3]])]), ok('fs-t-bool', 'fs-v-false'));
assertResult('network well-formedness empty', infer(['fs-apply', wellFormed, emptyRecord]), ok('fs-t-bool', 'fs-v-true'));
assertResult('network zero dimension with empty tuple', infer(['fs-apply', wellFormed, record(0, [[]])]), ok('fs-t-bool', 'fs-v-true'));
const predicateGlobals = ['fs-global-bind', 'unknown-predicate', ['fs-t-arrow', 'fs-t-nat', 'fs-t-bool'], neutral('predicate'), 'fs-empty'];
assertResult('all applies neutral predicates using base machinery', infer(['fs-all', ['fs-global', 'unknown-predicate'], list([nat(2)])], 'fs-empty', predicateGlobals),
  ok('fs-t-bool', neutral(['fs-neutral-bool-and', ['fs-neutral-apply', 'predicate', valueNat(2)], 'fs-v-true'])));
assertResult('all keeps neutral list and checked function', infer(['fs-all', predicate, zero], listLocals),
  ok('fs-t-bool', neutral(['fs-neutral-all', 'fs-t-nat', ['fs-closure', predicate[1], listLocals], 'xs'])));
assert.equal(passed, 44);

});
