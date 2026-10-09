import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formalSemanticArtifacts } from './generate-formal-semantics.mjs';

test('formal semantic coverage and shared Rust replay cases are reproducible from current sources', () => {
  const current = formalSemanticArtifacts();
  for (const [name, value] of Object.entries(current)) {
    const recorded = JSON.parse(readFileSync(new URL(`../test-corpus/formal-semantics/${name}.json`, import.meta.url)));
    assert.deepEqual(recorded, value, `${name} must be regenerated after source or linked-kernel changes`);
  }
  assert.equal(current.cases.cases.length, 56);
  assert.equal(current.cases.cases.filter(item => item.kind === 'definition').length, 38);
  assert.equal(current.cases.cases.filter(item => item.name.includes('mutated-') && item.accepted).length, 0);
});
