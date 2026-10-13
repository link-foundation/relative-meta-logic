import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { formalRecursionCases } from '../../scripts/formal-recursion-cases.mjs';

const corpus = JSON.parse(readFileSync(new URL('../../test-corpus/formal-recursion/cases.json', import.meta.url), 'utf8'));
const source = corpus.programs.map(name => readFileSync(new URL(`../../lib/meta-theory/${name}.lino`, import.meta.url), 'utf8')).join('\n') +
  `\n(linked-program ${corpus.program} ${corpus.programs.map(name => `(uses ${name})`).join(' ')})\n`;
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
test('structural recursor shared fixtures are reproducible', () => assert.deepEqual(corpus, formalRecursionCases()));
for (const example of corpus.cases) {
  test(`typed structural recursion: ${example.name}`, () => {
    const result = registry.reduce(corpus.program, example.request, { maxSteps: corpus.maxSteps });
    if (example.accepted) assert.deepEqual(result.term, example.expected);
    else assert.notEqual(result.term?.[0], 'fs-ok');
  });
}
