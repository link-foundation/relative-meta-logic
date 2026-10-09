import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formalFoundationArtifacts } from './generate-formal-foundation.mjs';

test('indexed/record coverage and all 90 requests regenerate exactly from authoritative source', () => {
  const current = formalFoundationArtifacts();
  for (const [name, expected] of Object.entries(current)) {
    const actual = JSON.parse(readFileSync(new URL(`../test-corpus/formal-foundation/${name}.json`, import.meta.url)));
    assert.deepEqual(actual, expected, `regenerate foundation ${name}`);
  }
  assert.equal(current.cases.cases.length, 90);
  assert.equal(current.cases.cases.filter(item => item.kind === 'definition').length, 62);
  assert.equal(current.cases.cases.filter(item => item.name.includes('-mutated-') && item.accepted).length, 0);
  assert.equal(current.coverage.pendingGeneratedTraits.length, 2);
  assert.equal(current.coverage.fullCorpusVerified, false);
});
