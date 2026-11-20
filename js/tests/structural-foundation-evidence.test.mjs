import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  linkOntologySymmetryExperiment,
  linkedCertificateCandidates,
  selfIncidenceByReferenceSlot,
} from '../src/rml-foundation-search.mjs';

const audit = linkOntologySymmetryExperiment().observationBoundary.startingRepresentationAudit;
const fixtures = JSON.parse(readFileSync(new URL('../../test-corpus/foundation-structural-evidence/certificates.json', import.meta.url))).cases;
const fixture = id => structuredClone(fixtures.find(item => item.id === id));
const evaluate = item => linkedCertificateCandidates(item);

test('R128 preserves address identity direct self incidence arity and ordered quotient counts', () => {
  assert.deepEqual(audit.quotientAudit.finiteEnumeration.map(row => [row.occurrenceCount, row.orderedEqualityClassesAfterAddressRenaming, row.unlabelledAddressableClasses, row.classesCollapsedByOccurrencePermutation]), [[1,2,2,0],[2,5,4,1],[3,15,7,8],[4,52,12,40]]);
  assert.equal(audit.quotientAudit.addressRenamingCompleteInvariantVerified, true);
  const witness = audit.countermodel;
  assert.deepEqual(witness.directSelfLink.normalizedAddressPattern, [0,0,1]);
  assert.deepEqual(witness.freshExternalLink.normalizedAddressPattern, [0,1,2]);
  assert.equal(witness.directSelfLink.directSelfReferenceCount, 1);
  assert.equal(witness.freshExternalLink.directSelfReferenceCount, 0);
  for (const width of [0,1,2,4,19]) {
    const record = [83, ...Array(width).fill(83)];
    assert.equal(selfIncidenceByReferenceSlot(record).length, width);
    assert.ok(selfIncidenceByReferenceSlot(record).every(Boolean));
  }
  assert.equal(audit.slotwiseSelfIncidence.orderedFaithfulDescriptor.finiteEnumerationAgreement, true);
});

test('R128 rejects erasing direct self incidence or silently quotienting ordered slots', () => {
  const witness = audit.countermodel;
  assert.equal(witness.sameReferenceOnlyProjection, true);
  assert.equal(witness.sameAddressableLinkClass, false);
  assert.equal(audit.referenceOnlyProjectionFaithful, false);
  const quotient = audit.quotientAudit;
  const countermodel = quotient.occurrencePermutationCountermodel;
  assert.deepEqual(countermodel.firstOrderedPattern, [0,0,1]);
  assert.deepEqual(countermodel.secondOrderedPattern, [0,1,0]);
  assert.equal(countermodel.sameUnderAddressRenamingAlone, false);
  assert.equal(countermodel.sameAfterOccurrencePermutation, true);
  assert.notDeepEqual(selfIncidenceByReferenceSlot(countermodel.firstOrderedPattern), selfIncidenceByReferenceSlot(countermodel.secondOrderedPattern));
  assert.deepEqual(quotient.transformations.map(row => row.classification), ['DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT','UNESTABLISHED_EQUIVALENCE']);
  assert.equal(quotient.occurrencePermutationIntrinsic, 'UNRESOLVED');
  assert.match(audit.claimBoundary, /does not establish.*derive endpoint roles.*dynamics.*execution law/);
});

test('R139 detects cross link cycles and faithfully enumerates the retained shared address contract', () => {
  const shared = audit.sharedAddressComposition;
  assert.deepEqual(shared.finiteEnumeration.map(row => [row.linkCount,row.sharedAddressClasses,row.localDescriptorClasses,row.sharedDescriptorClasses]), [[1,2,2,2],[2,10,4,10],[3,77,8,77],[4,799,16,799]]);
  assert.ok(shared.finiteEnumeration.every(row => row.sharedDescriptorFaithful));
  for (const row of shared.finiteEnumeration) {
    assert.equal(row.localDescriptorFibreHistogram.reduce((sum,item) => sum + item.sharedAddressClasses * item.localDescriptorClasses, 0), row.sharedAddressClasses);
  }
  assert.deepEqual(shared.countermodel.externalReferences, [[0,1],[2,3]]);
  assert.deepEqual(shared.countermodel.twoLinkCycle, [[0,2],[2,0]]);
  assert.equal(shared.countermodel.externalReferencesCycleLength, 0);
  assert.equal(shared.countermodel.twoLinkCycleLength, 2);
});

test('R139 rejects local descriptor completeness and leaves retained assumptions uneliminated', () => {
  const shared = audit.sharedAddressComposition;
  assert.equal(shared.countermodel.sameLocalDescriptors, true);
  assert.equal(shared.countermodel.sameSharedAddressClass, false);
  assert.equal(shared.localDescriptorsFaithfulAtEveryTestedMultiLinkWidth, false);
  assert.deepEqual(shared.finiteEnumeration.map(row => row.localDescriptorsFaithful), [true,false,false,false]);
  assert.deepEqual(shared.retainedAssumptions, ['finite ordered link records','one ordered reference slot per link','distinct link addresses in one shared address space','address equality is the only observation']);
  assert.match(shared.assumptionClassification.introducedByObserver, /order.*finite.*one reference slot/);
  assert.match(shared.assumptionClassification.semanticsNotAssigned, /not a source.*execution edge/);
});

test('R140 preserves every stated structural premise in the exact conservative extension', () => {
  const probe = audit.structuralApplicationComposition;
  const pair = probe.compositionCountermodel;
  assert.deepEqual(pair.withoutProposedResult, [[3,0,1],[4,1,2],[5,2,0],[6,6,3]]);
  assert.deepEqual(pair.withProposedResult, [...pair.withoutProposedResult,[7,0,2]]);
  assert.ok(Object.values(pair.commonFacts).every(Boolean));
  assert.equal(pair.premisesHoldInBoth, true);
  assert.equal(pair.reversePairAlreadyPresent, true);
  assert.deepEqual(probe.formationProbe.existingAddresses, [0,1,2,3,4,5,6]);
  assert.equal(probe.formationProbe.orderedPairsUsingExistingAddresses, 49);
  assert.equal(probe.formationProbe.everyFormationExtensionPreservesPremises, true);
});

test('R140 rejects deriving composition or semantic roles from formability and slot order', () => {
  const probe = audit.structuralApplicationComposition;
  assert.equal(probe.compositionCountermodel.proposedResultAbsentInFirst, true);
  assert.equal(probe.compositionCountermodel.proposedResultPresentInSecond, true);
  assert.equal(probe.formationProbe.compositionSpecificSelectionFromFormationOnly, false);
  assert.deepEqual(probe.roleRecovery.unorderedLeafOrbitSizes, [1,2]);
  assert.equal(probe.roleRecovery.semanticAssignmentsForThreeLeaves, 6);
  assert.equal(probe.roleRecovery.orderedPositionsSelectSemanticRoles, false);
  assert.equal(probe.roleRecovery.allFourSemanticRolesRecovered, false);
  assert.equal(probe.candidateEncodings.sameUnderAddressRenamingAlone, false);
  assert.equal(probe.candidateEncodings.sameAfterUniformSlotReversalAndAddressRenaming, true);
  assert.match(probe.claimBoundary, /additional selection\/closure law.*authority/);
});

test('R141 computes symmetry breaking and every specified evidence perturbation', () => {
  const probe = audit.linkCarriedSelectionAuthority;
  const symmetry = probe.equivariantSelectionConstraint;
  assert.deepEqual(symmetry.withoutAdditionalLink.candidateAutomorphisms, [[0,1],[1,0]]);
  assert.deepEqual(symmetry.withAdditionalLink.candidateAutomorphisms, [[0,1]]);
  assert.deepEqual(symmetry.withoutAdditionalLink.candidateOrbitSizes, [2]);
  assert.deepEqual(symmetry.withAdditionalLink.candidateOrbitSizes, [1,1]);
  assert.deepEqual(probe.perturbations.removal.markedCandidates, []);
  assert.deepEqual(probe.perturbations.replacement.markedCandidates, [8]);
  assert.deepEqual(probe.perturbations.duplication.markedCandidates, [7,8]);
  assert.equal(probe.perturbations.contextRelocation.sameUnderContextAddressRenaming, true);
  assert.equal(probe.recursiveAuthority.finiteChainCandidateSwapPreservesShape, true);
  assert.equal(probe.recursiveAuthority.selfReferentialCandidateSwapPreservesShape, true);
});

test('R141 rejects asymmetry isomorphic evidence and recursive marks as selection authority', () => {
  const probe = audit.linkCarriedSelectionAuthority;
  const symmetry = probe.equivariantSelectionConstraint;
  assert.equal(symmetry.withoutAdditionalLink.invariantSingletonSelections, 0);
  assert.equal(symmetry.withAdditionalLink.invariantSingletonSelections, 2);
  assert.equal(symmetry.singletonSelectionMadePossible, true);
  assert.equal(symmetry.singletonSelectionForced, false);
  assert.deepEqual(probe.oppositeEquivariantReadings.map(row => [row.selectedCandidates,row.addressRenamingEquivariant]), [[[7],true],[[8],true]]);
  assert.equal(probe.perturbations.forgery.structurallyRejected, false);
  assert.equal(probe.perturbations.contextRelocation.ambientExistenceSelectsActiveContext, false);
  assert.equal(probe.recursiveAuthority.selectionPolarityStillUnderdetermined, true);
  assert.match(probe.claimBoundary, /does not prove that external authority is irreducible/);
});

test('R142 accepts exact cover certificates under renaming and record reordering', () => {
  const original = fixture('complete');
  assert.deepEqual(evaluate(original), [207]);
  assert.deepEqual(evaluate({...original,records:original.records.toReversed()}), [207]);
  const rename = value => 7 * value + 31;
  const renamed = {...original,description:original.description.map(row => row.map(rename)),records:original.records.map(row => row.map(rename)),candidateAddresses:original.candidateAddresses.map(rename),contextAddress:rename(original.contextAddress)};
  assert.deepEqual(evaluate(renamed), [rename(207)]);
  assert.deepEqual(original, fixture('complete'));
});

test('R142 rejects incomplete foreign duplicate malformed and noninjective evidence', () => {
  for (const id of ['missing','duplicate','foreign','wrong-decomposition','zero-domain','malformed-record','duplicate-record-address','dangling-member','missing-description','noninjective-target']) {
    const item = fixture(id);
    assert.deepEqual(evaluate(item), [], id);
  }
});

test('R142 distinguishes context applicability and replacement descriptions using live records', () => {
  for (const id of ['other-context','relocated','replaced-description']) {
    const item = fixture(id);
    assert.deepEqual(evaluate(item), item.expected, id);
  }
  assert.deepEqual(evaluate(fixture('complete')), [207]);
});

test('R142 rejects uniqueness when two locally isomorphic certificates are admissible', () => {
  assert.deepEqual(evaluate(fixture('many')), [207,208]);
  const probe = audit.linkedStructuralAdmissibility;
  assert.equal(probe.adversarialBoundary.forgedLocallyIsomorphicCandidateRejected, false);
  assert.equal(probe.cardinalityAudit.classificationDerivedInsideLinkSubstrate, false);
  assert.equal(probe.authorityRegress.descriptionAuthenticatedByStructure, false);
  assert.equal(probe.authorityRegress.observerRoleAssignmentAuthorizedByStructure, false);
  assert.equal(probe.authorityRegress.verifierRepresentedOrExecutedByTestedRecords, false);
  assert.equal(probe.authorityRegress.finiteLinkedMetaChainClosesAuthorityRegress, false);
});
