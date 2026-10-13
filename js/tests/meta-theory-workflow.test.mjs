import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CERTIFIED_THEOREM, expandNative, nativeCall, nativeList, runMetaTheoryWorkflow, theoremDependencies,
} from '../../examples/meta-theory-workflow.mjs';
import { META_THEORY_NATIVE_PROGRAM, compactNative, nativeRegistry, renderNativeValue } from '../src/rml-meta-theory-native.mjs';
import { checkMetaTheoryCertificate, metaTheoryCertificateRegistries } from '../src/rml-meta-theory-certificates.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const expected = JSON.parse(read('test-corpus/researcher-workflow/meta-theory-expected.json'));
const prelude = read('lib/meta-theory/meta-theory-native-prelude.lino');
const program = read('lib/meta-theory/upstream-0.0.3-native.lino');

test('meta-theory research recipe reproduces the shared report through public APIs', { timeout: 600_000 }, () => {
  assert.deepEqual(runMetaTheoryWorkflow(), expected);
});

test('upstream definitions run on new data and a changed definition body changes the result', () => {
  const registry = nativeRegistry(prelude, program);
  const ordered = nativeCall(registry, 'rml.formal.lean.SetSequenceEquivalence.toOrderedUnique', [nativeList([9, 4, 9, 0])]);
  assert.equal(renderNativeValue(ordered.term, 'lean'), '[0, 4, 9]');
  // Removing the insertion step from the linked definition changes what is computed.
  const marker = '# rml.formal.lean.SetSequenceEquivalence.toOrderedUnique\n';
  const start = program.indexOf(marker);
  const end = program.indexOf('\n\n', start);
  const altered = program.slice(0, start) + program.slice(start, end).replaceAll('rml.formal.lean.SetSequenceEquivalence.insertSorted', 'mt-cons') + program.slice(end);
  assert.notEqual(altered, program);
  const changed = nativeRegistry(prelude, altered).reduceResult(META_THEORY_NATIVE_PROGRAM,
    ['rml.formal.lean.SetSequenceEquivalence.toOrderedUnique', nativeList([9, 4, 9, 0])], { maxSteps: 200_000 });
  assert.notDeepEqual(compactNative(changed.term), compactNative(ordered.term));
});

test('a recorded case request round-trips through compaction', () => {
  const cases = JSON.parse(read('test-corpus/meta-theory-native/cases.json')).cases;
  const item = cases.find(entry => entry.id === 'rml.formal.lean.NetworkExamples#command-17-execution');
  assert.deepEqual(compactNative(expandNative(item.request)), item.request);
});

test('the recipe certificate is rejected after its cited lemma is removed from the dependencies', () => {
  const registries = metaTheoryCertificateRegistries({
    prelude, program, conversion: read('lib/meta-theory/upstream-0.0.3-native-conversion.lino'),
    universal: read('lib/meta-theory/universal.lino'), verifier: read('lib/meta-theory/proof-verifier.lino'),
    natural: read('lib/meta-theory/proof-verifier-natural.lino'),
  });
  const certificates = JSON.parse(read('test-corpus/meta-theory-certificates/certificates.json'));
  const certificate = certificates.theorems.find(item => item.theorem === CERTIFIED_THEOREM).certificate;
  const coverage = JSON.parse(read('test-corpus/meta-theory-native/coverage.json'));
  const dependencies = theoremDependencies(coverage, CERTIFIED_THEOREM);
  assert.equal(checkMetaTheoryCertificate(registries, certificate, { theoremDependencies: dependencies }).accepted, true);
  const reduced = dependencies.filter(item => !item.endsWith('toOrderedUnique_is_ascending'));
  assert.equal(checkMetaTheoryCertificate(registries, certificate, { theoremDependencies: reduced }).accepted, false);
});
