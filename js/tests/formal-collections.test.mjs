import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { collectionCases } from '../../scripts/formal-collections-cases.mjs';
const programs = ['formal-collections', 'formal-indexed', 'formal-records', 'formal-semantics'];
const source = programs.map(name => readFileSync(new URL(`../../lib/meta-theory/${name}.lino`, import.meta.url), 'utf8')).join('\n') +
  `\n(linked-program collections-checker ${programs.map(name => `(uses ${name})`).join(' ')})`;
const registry = LinkedProgramRegistry.fromRml(source, { executionBasis: 'direct-structural' });
for (const example of collectionCases().cases) {
  test(`collection kernel: ${example.name}`, () => {
    const result = registry.reduce('collections-checker', example.request, { maxSteps: 10_000 });
    if (example.accepted) assert.deepEqual(result.term, example.expected);
    else assert.notEqual(result.term?.[0], 'fs-ok');
  });
}
