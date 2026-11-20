import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formalPropositionArtifacts } from './generate-formal-propositions.mjs';

test('all eight raw NetworkEquivalence sources regenerate 70 checked definitions and 88 shared requests', () => {
  const current = formalPropositionArtifacts({ inspectSystem(system) {
    const address = 'rml.formal.lean.NetworkEquivalence.DupletListEquivalence';
    const receipt = system.verifyDefinition(address);
    assert.equal(system.replay(receipt).accepted, true);
    const tampered = structuredClone(receipt);
    tampered.request[2] = ['fs-zero'];
    assert.equal(system.replay(tampered).accepted, false);
    assert.deepEqual(system.verifyDefinition(address), receipt);
    const falseSource = structuredClone(receipt); falseSource.corpusFingerprint = 'forged';
    assert.throws(() => system.replay(falseSource), /authoritative source/);
    const cycle = structuredClone(receipt); cycle.trace = cycle;
    assert.throws(() => system.replay(cycle), /cyclic/);
  } });
  for (const [name, expected] of Object.entries(current)) {
    const actual = JSON.parse(readFileSync(new URL(`../test-corpus/formal-propositions/${name}.json`, import.meta.url)));
    assert.deepEqual(actual, expected, `regenerate proposition ${name}`);
  }
  assert.equal(current.coverage.checkedDefinitions, 70);
  assert.equal(current.coverage.replayedProofs, 2);
  assert.equal(current.coverage.upstreamAdmissions, 4);
  assert.equal(current.coverage.declarationCount, 229);
  assert.equal(current.coverage.pendingGeneratedTraits.length, 2);
  assert.equal(current.coverage.fullCorpusVerified, false);
  assert.equal(current.coverage.propositionTruthVerified, false);
  const predicates = current.coverage.declarations.filter(entry => entry.address.includes('.NetworkEquivalence.'));
  assert.equal(predicates.length, 8);
  assert(predicates.every(entry => entry.status === 'definition-checked'));
  assert.equal(predicates.filter(entry => entry.parameters[0].implicit).length, 4);
  assert.equal(current.cases.cases.length, 88);
  const mutations = current.cases.cases.filter(entry => entry.kind === 'source-mutation');
  assert.equal(mutations.length, 16);
  assert.equal(mutations.filter(entry => entry.accepted).length, 4);
  assert(mutations.filter(entry => entry.accepted).every(entry => /false-but-formed|unlisted-source-name/.test(entry.name)));
  assert(mutations.every(entry => entry.sourceBinding.corpusFingerprint !== current.cases.corpusFingerprint));
});
