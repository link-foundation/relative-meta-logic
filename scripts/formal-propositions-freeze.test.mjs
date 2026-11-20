import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the additive proposition checkpoint retains its exact reviewed file allowlist and hashes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../test-corpus/formal-propositions/manifest.json', import.meta.url)));
  assert.equal(manifest.schema, 'rml-formal-propositions-checkpoint/v1');
  assert.equal(manifest.baseRevision, '23ccbb80a8f6a6ceaac377a229e0c51f5c003e6c');
  assert.equal(manifest.fullCorpusVerified, false);
  assert.equal(manifest.propositionTruthVerified, false);
  assert.deepEqual(manifest.files.map(entry => entry.path), [
    'docs/FORMAL_PROPOSITIONS.md',
    'js/src/rml-formal-propositions-parser.mjs',
    'js/src/rml-formal-propositions.mjs',
    'js/tests/formal-propositions-primitives.test.mjs',
    'js/tests/formal-propositions.test.mjs',
    'lib/meta-theory/formal-propositions.lino',
    'rust/tests/formal_propositions_tests.rs',
    'scripts/formal-propositions-cases.mjs',
    'scripts/formal-propositions-freeze.test.mjs',
    'scripts/formal-propositions.test.mjs',
    'scripts/generate-formal-propositions.mjs',
    'test-corpus/formal-propositions/cases.json',
    'test-corpus/formal-propositions/coverage.json',
  ]);
  for (const entry of manifest.files) {
    const bytes = readFileSync(new URL(`../${entry.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
    assert.equal(bytes.length, entry.bytes, entry.path);
  }
});
