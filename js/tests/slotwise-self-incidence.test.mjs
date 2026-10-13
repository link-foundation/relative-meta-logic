import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  linkOntologySymmetryExperiment,
  selfIncidenceByReferenceSlot,
} from '../src/rml-foundation-search.mjs';

test('classifies every Boolean self-incidence mask through eight ordered slots', () => {
  for (let width = 0; width <= 8; width += 1) {
    for (let bits = 0; bits < 2 ** width; bits += 1) {
      const expected = Array.from({length: width}, (_, slot) => Boolean(bits & (1 << slot)));
      const record = [17, ...expected.map((self, slot) => self ? 17 : 100 + slot)];
      assert.deepEqual(selfIncidenceByReferenceSlot(record), expected);
    }
  }
});

test('preserves each slot classification under injective address renaming', () => {
  const record = [13, 13, 0, 28, 13, 0];
  const expected = [true, false, false, true, false];
  assert.deepEqual(selfIncidenceByReferenceSlot(record), expected);
  assert.deepEqual(selfIncidenceByReferenceSlot(record.map(address => `address-${address}`)), expected);
  assert.deepEqual(selfIncidenceByReferenceSlot(record.map(address => 200 - 3 * address)), expected);
});

test('classifies wide record arities without a binary-slot assumption', () => {
  const expected = Array.from({length: 4096}, (_, slot) => slot % 7 === 0);
  assert.deepEqual(selfIncidenceByReferenceSlot([9, ...expected.map((self, slot) => self ? 9 : slot + 100)]), expected);
});

test('rejects replacing ordered slot incidence with only a self-reference count', () => {
  const first = selfIncidenceByReferenceSlot([4, 4, 8]);
  const second = selfIncidenceByReferenceSlot([4, 8, 4]);
  assert.equal(first.filter(Boolean).length, second.filter(Boolean).length);
  assert.notDeepEqual(first, second);
  assert.deepEqual(second, first.toReversed());
});

test('rejects noninjective renaming as an incidence-preserving equivalence', () => {
  const record = [4, 8, 4];
  assert.notDeepEqual(selfIncidenceByReferenceSlot(record), selfIncidenceByReferenceSlot(record.map(() => 4)));
});

test('rejects a record without a link address', () => {
  assert.throws(() => selfIncidenceByReferenceSlot([]), /requires a link address/);
  assert.throws(() => selfIncidenceByReferenceSlot(null), /requires a link address/);
});

test('retains the ordered equality contract and rejects inferred slot roles', () => {
  const audit = linkOntologySymmetryExperiment().observationBoundary.startingRepresentationAudit.slotwiseSelfIncidence;
  assert.deepEqual(audit.finiteEnumeration.map(row => row.selfIncidencePatterns), [2, 4, 8, 16]);
  assert.equal(audit.orderedFaithfulDescriptor.finiteEnumerationAgreement, true);
  assert.equal(audit.occurrencePermutationEquivariantVerified, true);
  assert.equal(audit.occurrencePermutationInvariant, false);
  assert.match(audit.claimBoundary, /does not establish.*intrinsic.*assign endpoint roles.*dynamics or execution/i);
});
