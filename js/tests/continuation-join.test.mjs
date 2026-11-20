import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOntologySymmetryExperiment } from '../src/rml-foundation-search.mjs';
import { continuationJoinReport, continuations, structures } from '../../experiments/continuation-join/exhaustive.mjs';

const recorded = JSON.parse(readFileSync(new URL('../../test-corpus/continuation-join/report.json', import.meta.url), 'utf8'));
const report = continuationJoinReport();

test('the copied join reproduces the conditionalContinuation probe on its chain', () => {
  const probe = linkOntologySymmetryExperiment().observationBoundary.startingRepresentationAudit.conditionalContinuation;
  for (const item of probe.cases) assert.deepEqual(continuations(item.records), item.continuations, item.id);
  const chain = [...probe.premises, probe.forwardWitness];
  assert.deepEqual(continuations(chain, { reverseProjection: true }), [[2, 0]]);
  assert.deepEqual(continuations([...probe.premises, probe.reverseWitness], { unorderedWitness: true }), [[0, 2]]);
});

test('every three- and four-record structure is classified exactly as recorded', () => {
  assert.deepEqual(report, recorded);
  assert.deepEqual(report.rows.map(row => [row.records, row.classes, row.nonEmptyJoin]), [[3, 1855, 75], [4, 56400, 4429]]);
  assert.equal(structures(2).length, 85);
});

test('reversal equivariance and monotonicity hold everywhere; the chain-specific observations do not', () => {
  assert.deepEqual(report.results, {
    uniformSlotReversalReversesEveryContinuation: true,
    joinIsMonotoneUnderAddingTheResultRecord: true,
    witnessOrientationDispensableInGeneral: false,
    projectionsAlwaysDifferWhenNonEmpty: false,
    supportingRecordsAlwaysIndividuallyNecessary: false,
    resultRecordCanAlreadyBePresent: true,
  });
  const [three, four] = report.rows;
  assert.equal(three.pairsWithRedundantSupport, 0);
  assert.equal(four.pairsWithRedundantSupport, 103);
  // Each first witness exhibits its counterexample directly.
  const agree = three.firstWitnesses.projectionsAgree;
  assert.deepEqual(continuations(agree), continuations(agree, { reverseProjection: true }));
  assert.ok(continuations(agree).length > 0);
  const unordered = three.firstWitnesses.unorderedWitnessChanges;
  assert.notDeepEqual(continuations(unordered, { unorderedWitness: true }), continuations(unordered));
  const redundant = four.firstWitnesses.redundantSupport;
  const [pair] = continuations(redundant);
  assert.ok(redundant.some(([address]) => {
    const remaining = continuations(redundant.filter(([other]) => other !== address));
    return remaining.some(([first, second]) => first === pair[0] && second === pair[1]);
  }));
  assert.match(report.claimBoundary, /No result makes the join intrinsic/);
});
