import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
const programs = ['formal-definition-context', 'formal-collections', 'formal-indexed', 'formal-records', 'formal-semantics'];
const source = programs.map(name => readFileSync(new URL(`../../lib/meta-theory/${name}.lino`, import.meta.url), 'utf8')).join('\n') +
 `\n(linked-program definition-context ${programs.map(name => `(uses ${name})`).join(' ')})`;
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
const reduce = request => registry.reduce('definition-context', request, { maxSteps: 10_000 }).term;
const nat = ['fs-nat-type'], arrow = ['fs-arrow-type', nat, nat], zero = ['fs-zero'];
const local = ['fs-variable', 'fs-index-zero'];
const identity = ['fs-lambda', nat, local];
const imported = reduce(['fs-definition', arrow, identity, 'fs-empty']);
assert.equal(imported[0], 'fs-ok');
const globals = ['fs-global-bind', 'checked.identity', imported[1], imported[2], 'fs-empty'];
const wrapper = ['fs-lambda', nat, ['fs-apply', ['fs-global', 'checked.identity'], local]];
test('closed function formation returns the original body with no abstract captured values', () => {
  const actual = reduce(['fs-closed-function-definition', arrow, wrapper, globals]);
  assert.deepEqual(actual, ['fs-ok', ['fs-t-arrow', 'fs-t-nat', 'fs-t-nat'], ['fs-closure', wrapper[2], 'fs-empty']]);
  assert.deepEqual(actual, reduce(['fs-definition', arrow, wrapper, globals]));
});
test('execution uses actual checked values after hypothetical formation', () => {
  const definition = reduce(['fs-closed-function-definition', arrow, wrapper, globals]);
  const actual = ['fs-global-bind', 'checked.wrapper', definition[1], definition[2], globals];
  assert.deepEqual(reduce(['fs-infer', ['fs-apply', ['fs-global', 'checked.wrapper'], ['fs-successor', zero]], 'fs-empty', actual]),
    ['fs-ok', 'fs-t-nat', ['fs-v-successor', 'fs-v-zero']]);
});
test('formation still rejects an incorrectly typed body, argument, binder, and conclusion', () => {
  for (const [annotation, body] of [
    [arrow, ['fs-lambda', nat, ['fs-true']]],
    [arrow, ['fs-lambda', nat, ['fs-apply', ['fs-global', 'checked.identity'], ['fs-true']]]],
    [arrow, ['fs-lambda', ['fs-bool-type'], zero]],
    [['fs-bool-type'], wrapper],
  ]) assert.notEqual(reduce(['fs-closed-function-definition', annotation, body, globals])?.[0], 'fs-ok');
});
test('a missing imported function cannot become a typing hypothesis', () => {
  assert.notEqual(reduce(['fs-closed-function-definition', arrow, wrapper, 'fs-empty'])?.[0], 'fs-ok');
});
test('non-lambda inputs cannot expose temporary neutral global values', () => {
  assert.notEqual(reduce(['fs-closed-function-definition', arrow, ['fs-global', 'checked.identity'], globals])?.[0], 'fs-ok');
});
test('type constructors retain their actual checked value in the formation context', () => {
  const typeConstructor = reduce(['fs-definition', ['fs-arrow-type', nat, ['fs-universe']], ['fs-lambda', nat, ['fs-list-type', nat]], 'fs-empty']);
  // The base language has no source universe expression. Check the actual typed
  // constructor against the internal kind with the ordinary linked checker.
  assert.notEqual(typeConstructor?.[0], 'fs-ok');
  const checked = reduce(['fs-check', ['fs-lambda', nat, ['fs-list-type', nat]], ['fs-t-arrow', 'fs-t-nat', 'fs-kind'], 'fs-empty', 'fs-empty']);
  assert.equal(checked[0], 'fs-ok');
  const environment = ['fs-global-bind', 'checked.type-constructor', checked[1], checked[2], globals];
  const listType = ['fs-apply', ['fs-global', 'checked.type-constructor'], zero];
  const annotation = ['fs-arrow-type', listType, nat], body = ['fs-lambda', listType, zero];
  assert.deepEqual(reduce(['fs-closed-function-definition', annotation, body, environment]), reduce(['fs-definition', annotation, body, environment]));
});
test('dependent function and universe globals remain transparent', () => {
  for (const type of ['fs-kind', ['fs-t-pi', 'fs-t-nat', ['fs-type-closure', nat, 'fs-empty']]]) {
    assert.deepEqual(reduce(['fdc-map', ['fs-global-bind', 'preserved', type, 'value', 'fs-empty']]),
      ['fdc-mapped', ['fs-global-bind', 'preserved', type, 'value', 'fs-empty']]);
  }
});
