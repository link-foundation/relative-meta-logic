import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HornResolution } from '../src/rml-horn-resolution.mjs';
import { linkOntologySymmetryExperiment } from '../src/rml-foundation-search.mjs';
import {
  VERIFIER_SOURCE,
  applyVerifierReplacement,
  clauseNames,
  corpus,
  expandedCases,
  removalMatrix,
  runCase,
} from '../../experiments/verifier-provenance/removal-matrix.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const recorded = JSON.parse(read('../../test-corpus/verifier-provenance/report.json'));
const matrix = removalMatrix();
const row = id => matrix.rows.find(item => item.id === id);

test('the linked local verifier reproduces every linkedVerifierStep probe case and trace', () => {
  const probe = linkOntologySymmetryExperiment().observationBoundary.startingRepresentationAudit.linkedVerifierStep;
  assert.equal(probe.cases.length, matrix.probeCases);
  for (const [index, item] of probe.cases.entries()) {
    assert.equal(matrix.cases[index], item.id);
    assert.equal(row('none').cells[item.id], item.cardinality, item.id);
    assert.deepEqual(matrix.baselineTraces[item.id], item.traceRecords, item.id);
  }
  assert.deepEqual(matrix.baselineTraces['trace-replay'].slice(0, 1), [[200, 200, 200]]);
});

test('the removal matrix is reproduced exactly from the linked verifier source', () => {
  assert.deepEqual(matrix, recorded);
  assert.deepEqual(matrix.rows.filter(item => item.kind === 'linked-clause').map(item => item.id), clauseNames());
  assert.equal(matrix.rows.length, 1 + clauseNames().length + corpus.replacements.length + 10 + 2);
});

test('each removal changes exactly the cases that depend on the removed operation', () => {
  // Removing the only correspondence clause, the join, or enumeration leaves no trace at all.
  for (const id of ['corresponds-forward', 'description-match', 'record-here', 'atom-identity', 'constructor-decomposition']) {
    assert.ok(Object.values(row(id).cells).every(cell => cell === 'ZERO'), id);
  }
  // A second candidate needs the recursive candidate clause; the first does not.
  assert.equal(row('candidate-later').cells['two-concrete-records'], 'ONE');
  assert.equal(row('candidate-later').cells['complete-local-match'], 'ONE');
  // Without exhaustive enumeration every MANY collapses to ONE; ZERO is unchanged.
  assert.deepEqual(row('exhaustive-answer-enumeration').changed,
    ['duplicate-mapping', 'two-concrete-records', 'reordered-two-concrete-records']);
  // A non-injective address codec makes every case match many times.
  assert.ok(Object.values(row('injective-address-codec').cells).every(cell => cell.startsWith('MANY')));
  // Clause order changes the trace sequence of multi-answer cases, never a cardinality.
  assert.deepEqual(row('source-clause-order').changed,
    ['duplicate-mapping', 'two-concrete-records', 'reordered-two-concrete-records']);
  assert.ok(row('source-clause-order').changed.every(id => row('source-clause-order').cells[id].endsWith('*')));
  // Unresolved bindings leave answers that are not addresses.
  assert.ok(Object.values(row('follow-bindings').cells).every(cell => cell === 'INVALID'));
  assert.deepEqual(matrix.noCaseChanged.resolverLaws, ['occurs-check', 'leftmost-goal-selection']);
  assert.deepEqual(matrix.noCaseChanged.linkedClauses,
    ['code-empty-zero', 'code-empty-one', 'code-one-empty', 'all-second-no', 'all-third-no', 'present-end']);
});

test('representation changes separate what follows from the Links from declared readings', () => {
  assert.deepEqual(matrix.representation, {
    renamingPreservesTraceUpToRenaming: true,
    recordOrderPreservesMatchSet: true,
    recordOrderPreservesTraceSequence: false,
    slotReversalForwardReading: 'ZERO',
    slotReversalReversedReading: 'ONE',
    duplicatedDescriptionSetPresence: 'ONE',
    duplicatedDescriptionProofMultiplicity: 'MANY',
    relocatedDescriptionWithMovedMapping: 'ONE',
    relocatedDescriptionWithStaleMapping: 'ZERO',
    traceReplayBySameJoin: 'ONE',
  });
  // The reversed reading on the original Links loses the complete match.
  assert.equal(row('reversed-reading').cells['complete-local-match'], 'ZERO');
  assert.equal(matrix.status, 'LOCAL_TRACE_FOLLOWS_FROM_LINKS_ONLY_WITH_DECLARED_READINGS_AND_RESOLVER_LAWS');
  assert.match(matrix.claimBoundary, /neither authorizes a reading nor closes the authority boundary/);
});

test('malformed inputs, stale replacements and unknown laws are rejected', () => {
  const resolver = HornResolution.fromSource(VERIFIER_SOURCE);
  const [first] = expandedCases();
  assert.throws(() => runCase(resolver, { ...first, records: [[40, 30]] }), /addressed triples/);
  assert.throws(() => runCase(resolver, { ...first, candidates: [-1] }), /nonnegative integers/);
  assert.throws(() => runCase(resolver, first, { ablatedLaws: ['no-such-law'] }), /unknown Horn law/);
  const [reversed] = corpus.replacements;
  const once = applyVerifierReplacement(VERIFIER_SOURCE, reversed);
  assert.throws(() => applyVerifierReplacement(once, reversed), /no longer matches/);
  assert.equal(runCase(HornResolution.fromSource(once), first).cell, 'ZERO');
  assert.equal(runCase(resolver, first).cell, 'ONE');
});
