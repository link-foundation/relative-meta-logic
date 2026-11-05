import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOntologySymmetryExperiment } from '../src/rml-foundation-search.mjs';
import { assumptionRemovalMatrix } from '../../experiments/assumption-removal/matrix.mjs';
import {
  finitenessRemovalProbe, finiteControl, shiftCertificate, prefixCheck, invariants,
} from '../../experiments/assumption-removal/finiteness.mjs';

const recorded = JSON.parse(readFileSync(new URL('../../test-corpus/assumption-removal/report.json', import.meta.url), 'utf8'));
const recordedFiniteness = JSON.parse(readFileSync(new URL('../../test-corpus/assumption-removal/finiteness.json', import.meta.url), 'utf8'));
const matrix = assumptionRemovalMatrix();
const finiteness = finitenessRemovalProbe();
const infinite = id => finiteness.infinite.find(item => item.id === id);
const row = id => matrix.rows.find(item => item.id === id);
const width = (id, links, slots) => row(id).widths.find(item => item.links === links && item.slots === slots);
const normal = records => {
  const names = new Map();
  return records.flat().map(value => {
    if (!names.has(value)) names.set(value, names.size);
    return names.get(value);
  }).join(',');
};

test('the removal matrix is reproduced exactly and starts from the audited base contract', () => {
  assert.deepEqual(matrix, recorded);
  const audit = linkOntologySymmetryExperiment().observationBoundary.startingRepresentationAudit.sharedAddressComposition;
  assert.deepEqual(audit.retainedAssumptions, [
    'finite ordered link records', 'one ordered reference slot per link',
    'distinct link addresses in one shared address space', 'address equality is the only observation']);
  assert.deepEqual(row('ordered-link-records').widths.filter(item => item.slots === 1).map(item => item.baseClasses),
    audit.finiteEnumeration.map(item => item.sharedAddressClasses));
  assert.deepEqual(matrix.rows.map(item => item.id), ['ordered-link-records', 'ordered-reference-slots',
    'slot-orientation', 'distinct-link-addresses', 'fixed-reference-arity', 'equality-only-observation']);
});

test('each removal identifies or separates exactly the recorded number of classes', () => {
  assert.deepEqual(row('ordered-link-records').widths.map(item => item.classesAfterRemoval), [2, 7, 20, 61, 5, 85, 1855]);
  assert.deepEqual(row('ordered-reference-slots').widths.map(item => item.classesAfterRemoval), [4, 66, 2406]);
  assert.deepEqual(row('slot-orientation').widths.map(item => item.classesAfterRemoval), [4, 85, 5328]);
  assert.deepEqual(row('distinct-link-addresses').widths.map(item => item.classesAfterRemoval), [2, 15, 203, 4140, 5, 203, 21147]);
  assert.deepEqual(row('fixed-reference-arity').widths.map(item => item.classesAfterRemoval), [7, 235, 17419]);
  assert.deepEqual(row('equality-only-observation').widths.map(item => item.classesAfterRemoval),
    [3, 62, 3210, 310344, 13, 4142, 5544342]);
  assert.deepEqual(matrix.results, {
    everyRemovalChangesSomeWidth: true,
    everyIdentifyingRemovalHasAWitness: true,
    localNonFaithfulnessSurvivesEveryIdentifyingRemovalFromTwoLinks: true,
    orientationRemovalIdentifiesLessThanSlotOrderRemoval: true,
  });
});

test('every witness pair is distinct in the base and identified only by its removed assumption', () => {
  const flip = ([address, first, second]) => [address, second, first];
  const [left, right] = width('ordered-link-records', 2, 1).firstWitness;
  assert.notEqual(normal(left), normal(right));
  assert.equal(normal([left[1], left[0]]), normal(right));
  const [slotLeft, slotRight] = width('ordered-reference-slots', 2, 2).firstWitness;
  assert.notEqual(normal(slotLeft), normal(slotRight));
  assert.equal(normal([slotLeft[0], flip(slotLeft[1])]), normal(slotRight));
  // Uniform reversal identifies the same pair: reversing [0,0,0] leaves it unchanged.
  const [orientationLeft, orientationRight] = width('slot-orientation', 2, 2).firstWitness;
  assert.equal(normal(orientationLeft.map(flip)), normal(orientationRight));
  // A width where per-record exchange identifies strictly more than uniform reversal.
  assert.ok(width('ordered-reference-slots', 3, 2).classesAfterRemoval < width('slot-orientation', 3, 2).classesAfterRemoval);
  const [shared] = width('distinct-link-addresses', 2, 1).firstWitness;
  assert.equal(shared[0][0], shared[1][0]);
  const [mixed] = width('fixed-reference-arity', 2, '1|2').firstWitness;
  assert.notEqual(mixed[0].length, mixed[1].length);
});

test('negative controls: a single link has no local non-faithfulness and no record-order witness', () => {
  assert.equal(width('ordered-link-records', 1, 1).firstWitness, null);
  assert.equal(width('ordered-link-records', 1, 1).localNonFaithfulnessBefore, false);
  assert.equal(width('distinct-link-addresses', 1, 2).firstWitness, null);
  assert.equal(width('ordered-reference-slots', 1, 2).localNonFaithfulnessAfter, false);
  assert.match(matrix.claimBoundary, /No assumption is thereby shown intrinsic or eliminable/);
  assert.deepEqual(matrix.retainedWithoutRemoval, []);
  assert.deepEqual(matrix.removedByProbe, { finiteness: 'experiments/assumption-removal/finiteness.mjs' });
});

test('finiteness removal is reproduced exactly and no finite structure embeds onto a proper part of itself', () => {
  assert.deepEqual(finiteness, recordedFiniteness);
  assert.deepEqual(finiteness.finiteControl.map(item => item.structures), [2, 10, 77, 799]);
  assert.deepEqual(finiteness.finiteControl.map(item => item.selfEmbeddings), [2, 14, 120, 1464]);
  assert.ok(finiteness.finiteControl.every(item => item.nonSurjectiveSelfEmbeddings === 0 && item.invisibleDeletions === 0));
  // The finite control enumerates exactly the audited one-slot base classes.
  assert.deepEqual(finiteness.finiteControl.map(item => item.structures),
    row('ordered-link-records').widths.filter(item => item.slots === 1).map(item => item.baseClasses));
});

test('removing finiteness identifies each ray with its tail by a symbolic shift certificate', () => {
  for (const id of ['forward-ray', 'backward-ray']) {
    const item = infinite(id);
    assert.equal(item.certificate.identifiesWithProperSubstructure, true, id);
    assert.equal(item.certificate.surjective, false, id);
    assert.equal(item.certificate.imageRecordStart, item.start + 1, id);
    assert.equal(item.certificate.imageAddressStart, item.certificate.tailAddressStart, id);
    assert.deepEqual(item.prefix, { bound: 32, holds: true, failure: null }, id);
  }
  assert.deepEqual(finiteness.results, {
    finiteStructuresHaveOnlySurjectiveSelfEmbeddings: true,
    finiteControlReproducesAuditedBaseCounts: true,
    everyRayIsIdentifiedWithItsTail: true,
    onlyTheFirstLinkOfARayIsInvisible: true,
    theTwoSidedLineHasNoInvisibleDeletion: true,
    bothSlotOrientationsBehaveAlike: true,
  });
});

test('only the first link of a ray is an invisible deletion and the two-sided line has none', () => {
  assert.deepEqual(infinite('forward-ray').invariants, { atoms: 0, unreferencedLinks: 1 });
  assert.deepEqual(infinite('forward-ray').firstDeletionInvariants.map(item => [item.atoms, item.unreferencedLinks]), [[0, 1], [1, 2], [1, 2]]);
  assert.deepEqual(infinite('backward-ray').invariants, { atoms: 1, unreferencedLinks: 0 });
  assert.deepEqual(infinite('backward-ray').firstDeletionInvariants.map(item => [item.atoms, item.unreferencedLinks]), [[1, 0], [2, 1], [2, 1]]);
  assert.deepEqual(infinite('forward-ray').invisibleDeletions, [0]);
  assert.deepEqual(infinite('backward-ray').invisibleDeletions, [1]);
  assert.deepEqual(infinite('two-sided-line').invisibleDeletions, []);
  assert.ok(finiteness.infinite.every(item => item.everyWindowStable));
  // Deleting a later link leaves a dangling reference, an isomorphism invariant.
  assert.deepEqual(invariants({ id: 'forward-ray', start: 0, step: 1 }, 40), { atoms: 1, unreferencedLinks: 2 });
});

test('negative controls: a surjective shift or a non-affine structure identifies no proper substructure', () => {
  const line = shiftCertificate({ id: 'two-sided-line', start: null, step: 1 });
  assert.equal(line.surjective, true);
  assert.equal(line.identifiesWithProperSubstructure, false);
  // References growing at slope 2 are not shift-invariant: the very first window fails.
  const ray = { id: 'forward-ray', start: 0, step: 1 };
  assert.deepEqual(prefixCheck(ray, 32, (_, n) => [n, 2 * n]), { bound: 32, holds: false, failure: { length: 1, n: 0 } });
  assert.equal(prefixCheck(ray).holds, true);
  // A finite structure has no invisible deletion at any enumerated width.
  assert.ok(finiteControl([1, 2]).every(item => item.invisibleDeletions === 0));
  assert.match(finiteness.claimBoundary, /not a claim that finiteness is intrinsic or eliminable/);
});
