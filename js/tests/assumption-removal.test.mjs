import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkOntologySymmetryExperiment } from '../src/rml-foundation-search.mjs';
import { assumptionRemovalMatrix } from '../../experiments/assumption-removal/matrix.mjs';

const recorded = JSON.parse(readFileSync(new URL('../../test-corpus/assumption-removal/report.json', import.meta.url), 'utf8'));
const matrix = assumptionRemovalMatrix();
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
  assert.deepEqual(matrix.retainedWithoutRemoval, ['finiteness (only finite widths are enumerated)']);
});
