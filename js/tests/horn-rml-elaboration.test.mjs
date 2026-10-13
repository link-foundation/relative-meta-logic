import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createHornLinkSubstitutionKernel,
  HORN_RML_ELABORATION_SOURCE,
  RML_ELABORATION_RESIDUAL_HOST_LAWS,
} from '../src/rml-horn-link-substitution.mjs';
import { encodeRelationalPrograms } from '../src/rml-relational-kernel.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import {
  applyElaborationReplacement,
  changedObservations,
  hornSourceObservations,
  workload,
} from '../../experiments/definition-replacement/mechanism-matrix.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../../lib/meta-theory/fixed-point-source.lino');
const cases = JSON.parse(read('../../test-corpus/kernel-replacement/elaboration-cases.json'));
const replacements = JSON.parse(read('../../test-corpus/kernel-replacement/elaboration-replacements.json'));
const shared = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-observations.json'));
const kernel = createHornLinkSubstitutionKernel(source);
const hostPrograms = text => encodeRelationalPrograms(LinkedProgramRegistry.fromRml(text).programs);
const NO_ANSWER = /linked Horn workflow has no answer within the declared search/;

test('linked elaboration builds exactly the host registry programs for the accepted corpus', () => {
  const documents = [
    ...cases.accepted.map(path => ({ name: path, text: read(`../../${path}`) })),
    ...cases.inline.map(item => ({ name: item.name, text: item.source })),
  ];
  assert.ok(documents.length >= 17);
  for (const { name, text } of documents) {
    const elaborated = kernel.elaborate(text);
    assert.equal(elaborated.rejection, null, name);
    assert.deepEqual(elaborated.programs, hostPrograms(text), name);
  }
});

test('linked elaboration rejects invalid documents for the same reasons as the host registry', () => {
  assert.equal(cases.rejected.length, 12);
  for (const item of cases.rejected) {
    assert.throws(() => LinkedProgramRegistry.fromRml(item.source), error => error.message.includes(item.host), item.name);
    const elaborated = kernel.elaborate(item.source);
    assert.equal(elaborated.programs, null, item.name);
    assert.deepEqual(elaborated.rejection, { reason: item.reason, detail: item.detail }, item.name);
    assert.throws(() => kernel.reduceSource(item.source, 'a', ['x']),
      error => error.rejection?.reason === item.reason && error.rejection.detail === item.detail, item.name);
  }
});

test('documents outside the linked form shapes have no linked elaboration', () => {
  for (const item of cases.unelaborated) {
    assert.throws(() => LinkedProgramRegistry.fromRml(item.source), error => error.message.includes(item.host), item.name);
    assert.throws(() => kernel.elaborate(item.source, { maxSteps: 2_000_000 }), NO_ANSWER, item.name);
  }
});

test('source workflows reproduce the shared observations with no host RML elaboration', () => {
  assert.deepEqual(hornSourceObservations(source), shared.baseline);
  assert.throws(() => kernel.reduceSource(workload, 'absent', ['x']), /linked-program absent is missing/);
  assert.throws(() => kernel.proveSource('(linked-program a)\n(linked-rewrite b r (from x) (to y))', 'a', ['x'], ['y']),
    error => error.rejection?.reason === 'unknown-program' && error.rejection.detail === 'b');
});

test('replacing a linked language decision changes execution with every host file unchanged', () => {
  assert.equal(replacements.replacements.length, 2);
  for (const replacement of replacements.replacements) {
    const { elaborationSource, document } = applyElaborationReplacement(HORN_RML_ELABORATION_SOURCE, workload, replacement);
    assert.notEqual(document, workload, replacement.id);
    assert.deepEqual(hornSourceObservations(source, { elaborationSource, document }), shared.baseline, replacement.id);
    const original = hornSourceObservations(source, { elaborationSource });
    assert.equal(original.error, undefined, replacement.id);
    assert.deepEqual(changedObservations(shared.baseline, original), replacement.originalWorkloadChanges, replacement.id);
    // The host registry still elaborates the spelled document by its own fixed
    // rules, so on this path the linked D' alone decides the programs.
    const replaced = createHornLinkSubstitutionKernel(source, { elaborationSource }).elaborate(document);
    assert.equal(replaced.rejection, null, replacement.id);
    assert.notDeepEqual(hostPrograms(document), replaced.programs, replacement.id);
    assert.deepEqual(kernel.elaborate(workload).programs, hostPrograms(workload), replacement.id);
  }
});

test('removing a linked language decision removes the elaboration it decided', () => {
  const withoutSigil = HORN_RML_ELABORATION_SOURCE.replace(/\(horn-clause variable-sigil [^\n]*\n/, '');
  assert.notEqual(withoutSigil, HORN_RML_ELABORATION_SOURCE);
  const noSigil = createHornLinkSubstitutionKernel(source, { elaborationSource: withoutSigil });
  assert.throws(() => noSigil.elaborate(workload, { maxSteps: 2_000_000 }), NO_ANSWER);
  const withoutProgramKeyword = HORN_RML_ELABORATION_SOURCE.replace(
    /\(horn-clause keyword-linked-program [^\n]*\n[^\n]*\n/, '');
  assert.notEqual(withoutProgramKeyword, HORN_RML_ELABORATION_SOURCE);
  const noKeyword = createHornLinkSubstitutionKernel(source, { elaborationSource: withoutProgramKeyword });
  assert.throws(() => noKeyword.elaborate(workload, { maxSteps: 2_000_000 }), NO_ANSWER);
});

test('the source-workflow host takes no RML decision and lists every residual host law', () => {
  const host = read('../src/rml-horn-link-substitution.mjs');
  for (const name of ["'linked-rewrite'", "'linked-program'", "'linked-fact'", "'linked-inference'", "'uses'", "'rebind'",
    "'from'", "'premise'", "startsWith('?')"]) {
    assert.equal(host.includes(name), false, `source-workflow host mentions ${name}`);
  }
  const report = kernel.trustReport();
  assert.equal(report.sourceElaboration.hostRegistryElaborationOnThisPath, false);
  assert.deepEqual(report.sourceElaboration.residualHostLaws, [...RML_ELABORATION_RESIDUAL_HOST_LAWS]);
  assert.equal(report.sourceElaboration.residualHostLaws.length, 7);
  assert.equal(report.sourceElaboration.linkedDecisions.length, 7);
  assert.match(report.sourceElaboration.elaborationSourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(report.fullImplementationClosure, false);
});
