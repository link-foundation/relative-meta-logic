import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { parseOne, tokenizeOne } from '../src/rml-links.mjs';
const source = fs.readFileSync(new URL('../../lib/meta-theory/universal.lino', import.meta.url), 'utf8');
const corpus = JSON.parse(fs.readFileSync(new URL('../../test-corpus/historical-contracts/cases.json', import.meta.url)));
const term = text => text.startsWith('(') ? parseOne(tokenizeOne(text)) : text;
const programs = code => LinkedProgramRegistry.fromRml(code, { executionBasis: 'direct-structural' });
function omit(code, kind, program, name) {
  const start = code.indexOf(`(linked-${kind} ${program} ${name}\n`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    if (code[index] === '(') depth++;
    if (code[index] === ')' && --depth === 0) return code.slice(0, start) + code.slice(index + 1);
  }
  throw new Error('unterminated fixture rule');
}
function rebound(node, prefix) {
  if (Array.isArray(node)) return node.map(value => rebound(value, prefix));
  return node === 'cons' ? `${prefix}-cons` : node === 'empty' ? `${prefix}-empty` : node;
}

test('executes every finite set operation through one unchanged framework under both constructor imports', () => {
  const registry = programs(source);
  for (const [program, prefix] of [['set-theory-over-traditional-sequences', 'sequence'], ['set-theory-over-associative-links', 'link']]) {
    for (const fixture of corpus.sets) assert.deepEqual(registry.reduce(program, rebound(term(fixture.input), prefix)).term, rebound(term(fixture.expected), prefix), `${program}: ${fixture.name}`);
  }
});

test('removing each required finite set rule breaks its observable contract in both imports', () => {
  for (const fixture of corpus.sets) {
    const registry = programs(omit(source, 'rewrite', 'set-theory', fixture.remove));
    for (const [program, prefix] of [['set-theory-over-traditional-sequences', 'sequence'], ['set-theory-over-associative-links', 'link']]) assert.notDeepEqual(registry.reduce(program, rebound(term(fixture.input), prefix)).term, rebound(term(fixture.expected), prefix), `${program}: ${fixture.name}`);
  }
});

test('derives graph endpoint typing and reachability from linked rules on the generic execution path', () => {
  for (const fixture of corpus.graph) {
    const result = programs(source).prove('graph-theory', term(fixture.goal), { facts: fixture.facts.map(term), maxRounds: 8, maxFacts: 128 });
    assert.equal(result.ok, true, fixture.name);
    assert.equal(result.proof.rule, fixture.remove);
  }
});

test('does not grant graph constraints from an unrelated link or after removing the required rule', () => {
  for (const fixture of corpus.graph) {
    const result = programs(omit(source, 'inference', 'graph-theory', fixture.remove)).prove('graph-theory', term(fixture.goal), { facts: fixture.facts.map(term), maxRounds: 8, maxFacts: 128 });
    assert.equal(result.ok, false, fixture.name);
  }
  assert.equal(programs(source).prove('graph-theory', term('(valid-edge g a b)'), { facts: [term('(edge a b)'), term('(vertex g a)')] }).ok, false);
});

test('derives all seven relational algebra operations and typing obligations from linked rules', () => {
  for (const fixture of corpus.relations) {
    const result = programs(source).prove('relational-algebra', term(fixture.goal), { facts: fixture.facts.map(term), maxRounds: 1, maxFacts: 128 });
    assert.equal(result.ok, true, fixture.name);
    assert.equal(result.proof.rule, fixture.remove);
  }
});

test('removing relational rules or supplying unrelated endpoints cannot produce the requested evidence', () => {
  for (const fixture of corpus.relations) {
    const result = programs(omit(source, 'inference', 'relational-algebra', fixture.remove)).search('relational-algebra', [term(fixture.goal)], { facts: fixture.facts.map(term), maxRounds: 1, maxFacts: 128 });
    assert.equal(result.goals[0].proof, null, fixture.name);
  }
  assert.equal(programs(source).prove('relational-algebra', term('(valid-pair r a b)'), { facts: [term('(member-of a (domain r))'), term('(member-of b (codomain other))')] }).ok, false);
});

test('executes previously unknown inference without object callbacks and refuses a missing premise', () => {
  const definition = '(linked-program unfamiliar)\n(linked-inference unfamiliar consequence (premise (observed ?x)) (premise (enabled ?x)) (conclusion (accepted ?x)))';
  for (const executionBasis of ['direct-structural', 's-k']) {
    const registry = LinkedProgramRegistry.fromRml(definition, { executionBasis });
    const positive = registry.prove('unfamiliar', term('(accepted new-symbol)'), { facts: [term('(observed new-symbol)'), term('(enabled new-symbol)')] });
    assert.equal(positive.ok, true);assert.equal(positive.proof.rule, 'consequence');
    assert.equal(registry.prove('unfamiliar', term('(accepted new-symbol)'), { facts: [term('(observed new-symbol)'), term('(enabled other-symbol)')] }).ok, false);
  }
});

test('linked beta evaluation distinguishes bound positions and changes when substitution is removed', () => {
  const request = term('(evaluate (apply (apply (lambda (lambda (bound (successor zero)))) (free a)) (free b)) empty-environment)');
  assert.deepEqual(programs(source).reduce('lambda-calculus', request).term, term('(free a)'));
  assert.notDeepEqual(programs(source).reduce('lambda-calculus', request).term, term('(free b)'));
  const changed = omit(source, 'rewrite', 'lambda-calculus', 'evaluate-bound-successor');
  assert.notDeepEqual(programs(changed).reduce('lambda-calculus', request).term, term('(free a)'));
});
