import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  foundationSearchReport,
  linkOntologySymmetryExperiment,
} from '../js/src/rml-foundation-search.mjs';

const universalSource = readFileSync(
  new URL('../lib/meta-theory/universal.lino', import.meta.url),
  'utf8',
);
const alternativeSource = readFileSync(
  new URL('../lib/meta-theory/alternative-foundations.lino', import.meta.url),
  'utf8',
);
const expected = JSON.parse(readFileSync(
  new URL('../lib/meta-theory/foundation-candidates.json', import.meta.url),
  'utf8',
));
const report = foundationSearchReport(universalSource, alternativeSource);

describe('architecture-neutral alternative-foundation search', () => {
  it('runs the same complete workload under three semantic mechanisms', () => {
    assert.equal(report.schema, 'rml-alternative-foundation-search/v13');
    assert.match(report.question, /representation and semantic assumptions/i);
    assert.doesNotMatch(report.question, /must be added to links/i);
    assert.match(report.proofBoundary, /does not establish link ontology/i);
    assert.deepEqual(report.acceptanceOperations, expected.acceptanceWorkload);
    assert.equal(report.candidates.length, 3);
    for (const candidate of report.candidates) {
      assert.equal(candidate.classification, 'ACCEPTED_FOR_EXECUTABLE_SCOPE');
      assert.deepEqual(
        Object.values(candidate.acceptanceWorkload),
        Array(report.acceptanceOperations.length).fill(true),
      );
      assert.equal(candidate.measurements.objectSpecificHostSemantics, 0);
      assert.deepEqual(candidate.measurements.undocumentedAuthorityPaths, []);
      assert.equal(candidate.equivalentTo, null);
      assert.equal(
        candidate.equivalenceStatus,
        'NOT_CLAIMED_WITHOUT_EXECUTABLE_BISIMULATION',
      );
    }
  });

  it('never ranks candidates whose reductions are structurally asymmetric', () => {
    const eligible = report.candidates.filter(candidate =>
      candidate.comparisonEligibility.eligible);
    assert.deepEqual(
      eligible.map(candidate => candidate.candidate),
      ['candidate-a-closed-s-k'],
    );
    for (const candidate of report.candidates) {
      const closure = candidate.measurements.selfHostingClosure;
      assert.equal(
        candidate.comparisonEligibility.eligible,
        closure.linkedCapabilities === closure.totalCapabilities &&
          candidate.measurements.hostSelfSemanticDuplication === 0 &&
          candidate.measurements.externalSemanticSourceDescriptions === 0 &&
          candidate.measurements.runtimeTrustCoverage.complete,
      );
    }
    assert.equal(report.comparisonCohort.minimumCandidates, 2);
    assert.equal(report.comparisonCohort.sufficient, false);
    assert.equal(report.comparisonStatus, 'OPEN_NO_COMPARABLE_ALTERNATIVE');
    assert.equal(report.conclusion.smallestMeasuredExternalLawCount, null);
    assert.deepEqual(report.conclusion.smallestMeasuredCandidates, []);
    assert.equal(report.conclusion.selectedFoundation, null);
  });

  it('bounds the witness to its host representation without claiming link ontology', () => {
    const witness = report.representationBoundaryWitness;
    assert.equal(
      witness.classification,
      'ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS',
    );
    assert.equal(witness.investigatedObject, 'host-representation-of-an-ordered-link');
    assert.equal(witness.linkOntologyCovered, false);
    assert.equal(witness.representationExhaustivenessEstablished, false);
    assert.equal(witness.intrinsicTransitionAuthority, 'UNRESOLVED');
    assert.equal(
      witness.structureTransformationSeparation,
      'ASSUMED_BY_EXPERIMENT',
    );
    assert.equal(witness.transitionExternality, 'ASSUMED_BY_EXPERIMENT');
    assert.deepEqual(
      witness.modelAssumptions.map(assumption => assumption.status),
      Array(witness.modelAssumptions.length).fill('ASSUMED_NOT_DERIVED'),
    );
    assert.deepEqual(witness.sharedInput, ['link', 'left', 'right']);
    assert.deepEqual(witness.interpretations.map(item => item.input), [
      witness.sharedInput,
      witness.sharedInput,
    ]);
    assert.notDeepEqual(
      witness.interpretations[0].output,
      witness.interpretations[1].output,
    );
    assert.ok(witness.interpretations.every(item =>
      item.preservesLinkFormation && item.renamingInvariant));
    assert.equal(witness.uniqueTransitionSelected, false);
    assert.match(witness.admissibleConclusion, /host representation signature/i);
    assert.ok(witness.prohibitedConclusions.includes(
      'no execution principle can arise from links themselves',
    ));
    assert.doesNotMatch(witness.admissibleConclusion, /intrinsic to links/i);
  });

  it('keeps the ontology investigation open and audits imported categories', () => {
    assert.equal(report.foundationStatus, 'OPEN');
    assert.equal(
      report.ontologySearch.status,
      'OPEN_INDEPENDENT_INVESTIGATION',
    );
    assert.equal(
      report.comparisonScope,
      'EXECUTION_ARCHITECTURE_ONLY_NOT_ONTOLOGY',
    );
    assert.deepEqual(
      report.ontologySearch.openQuestions.map(({ id, status }) => ({ id, status })),
      [
        { id: 'link-ontology', status: 'UNRESOLVED' },
        { id: 'primitive-categories', status: 'UNRESOLVED' },
        { id: 'structure-transformation-relation', status: 'UNRESOLVED' },
        { id: 'intrinsic-semantic-authority', status: 'UNRESOLVED' },
        { id: 'comparative-minimality', status: 'UNRESOLVED' },
      ],
    );
    assert.deepEqual(
      report.ontologySearch.importedPrimitiveCategories.map(item => item.id),
      [
        'data',
        'operation',
        'state',
        'transition',
        'interpreter',
        'evaluator',
        'rewrite',
        'rule',
        'function',
        'relation',
      ],
    );
    assert.ok(report.ontologySearch.importedPrimitiveCategories.every(item =>
      item.provenance === 'IMPORTED_EXPERIMENTAL_VOCABULARY' &&
      item.foundationalStatus === 'UNESTABLISHED'));
    assert.equal(report.ontologySearch.existingCandidatesRole, 'EXECUTABLE_CONTROLS_ONLY');
    assert.equal(report.ontologySearch.existingCandidatesConstrainSearch, false);
    assert.equal(report.ontologySearch.targetArchitectureSelected, false);
    assert.ok(report.ontologySearch.provenanceQuestions.length >= 3);

    for (const candidate of report.candidates) {
      assert.equal(candidate.ontologyRole, 'EXECUTABLE_CONTROL');
      assert.equal(candidate.constrainsOntologySearch, false);
      assert.equal(candidate.foundationalEligibility.eligible, false);
      assert.ok(candidate.foundationalEligibility.exclusionReasons.includes(
        'LINK_ONTOLOGY_UNRESOLVED',
      ));
    }
    assert.doesNotMatch(JSON.stringify(report), /link-native|links-native/i);
  });

  it('derives representation-independent facts from exhaustive link symmetries', () => {
    const experiment = linkOntologySymmetryExperiment();

    assert.deepEqual(report.ontologyExperiment, experiment);
    assert.equal(
      experiment.schema,
      'rml-link-ontology-symmetry-experiment/v10',
    );
    assert.equal(experiment.startingContract.occurrenceCount, 2);
    assert.deepEqual(
      experiment.startingContract.assumptions.map(item => item.id),
      ['two-unlabelled-reference-occurrences', 'reference-equality'],
    );
    assert.deepEqual(experiment.startingContract.deliberatelyAbsent, [
      'link identity',
      'endpoint order',
      'source/target roles',
      'passivity',
      'time',
      'execution law',
    ]);

    assert.equal(experiment.exhaustiveEnumeration.assignmentsExamined, 3);
    assert.equal(experiment.exhaustiveEnumeration.groupActionsExamined, 6);
    assert.equal(experiment.exhaustiveEnumeration.actionApplicationsExamined, 10);
    assert.match(experiment.exhaustiveEnumeration.supportRestriction, /unused references/i);
    assert.deepEqual(
      experiment.exhaustiveEnumeration.canonicalClasses.map(item => ({
        signature: item.signature,
        orbit: item.orbit,
      })),
      [
        { signature: 'same-reference', orbit: [[0, 0]] },
        { signature: 'distinct-references', orbit: [[0, 1], [1, 0]] },
      ],
    );
    assert.equal(
      experiment.exhaustiveEnumeration.completeInvariant,
      'equality partition of the two reference occurrences',
    );
    assert.ok(experiment.representationAgreement.every(item =>
      item.sameReference === 'same-reference' &&
      item.distinctReferences === 'distinct-references' &&
      item.invariantAcrossAllActions));
    for (const encoding of experiment.representationAgreement) {
      assert.notDeepEqual(
        encoding.canonicalOutputs.sameReference,
        encoding.canonicalOutputs.distinctReferences,
      );
    }

    const symmetry = experiment.distinctReferenceSymmetry;
    assert.equal(symmetry.automorphisms.length, 2);
    assert.deepEqual(symmetry.occurrenceOrbits, [[0, 1]]);
    assert.equal(symmetry.unarySelectorsExamined, 4);
    assert.deepEqual(symmetry.invariantUnarySelectors, [[], [0, 1]]);
    assert.equal(symmetry.invariantSingletonSelectorExists, false);
    assert.equal(symmetry.totalSelfMapsExamined, 4);
    assert.deepEqual(symmetry.equivariantSelfMaps, [
      { id: 'identity', mapping: [0, 1] },
      { id: 'swap', mapping: [1, 0] },
    ]);
    assert.equal(symmetry.uniqueEquivariantSelfMap, false);

    assert.equal(experiment.reificationCountermodels.length, 2);
    assert.ok(experiment.reificationCountermodels.every(model =>
      model.projectedObservation === 'distinct-references'));
    assert.deepEqual(
      experiment.reificationCountermodels.map(model => model.hasLinkIdentity),
      [false, true],
    );

    assert.deepEqual(
      experiment.results.map(item => [item.id, item.result]),
      [
        ['endpoint-direction', 'NOT_DERIVABLE'],
        ['reified-link-identity', 'REPRESENTATION_DEPENDENT'],
        ['reference-equality-pattern', 'COMPLETE_INVARIANT_FOR_CONTRACT'],
        ['structure-transformation-separation', 'NON_ABSOLUTE_FOR_SYMMETRIES'],
        ['representation-independent-authority', 'NEGATIVE_CONSTRAINT_ONLY'],
        ['intrinsic-dynamics', 'NOT_SELECTED'],
        ['fixed-binary-observation-sufficiency', 'INSUFFICIENT_OUTSIDE_FIXED_ARITY'],
        ['conditional-refinement-recoverability', 'NOT_RECOVERABLE_FROM_BASE_PROJECTION'],
        ['conditional-structural-asymmetry', 'EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL'],
        ['conditional-asymmetry-provenance', 'BASE_FORCED_AND_REFINEMENT_DEPENDENT_COMPONENTS_SEPARATED'],
        ['conditional-interaction-forcedness', 'SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE'],
        ['starting-representation-faithfulness', 'REFERENCE_ONLY_PROJECTION_NON_FAITHFUL_FOR_SELF_REFERENCE'],
        ['slotwise-self-incidence', 'CLASSIFIED_PER_ORDERED_REFERENCE_SLOT'],
        ['shared-address-composition', 'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL'],
        ['structural-application-composition', 'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION'],
        ['link-carried-selection-authority', 'LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY'],
        ['linked-structural-admissibility', 'LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING'],
        ['addressable-quotient-assumptions', 'RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED'],
        ['observation-loss-provenance', 'CLASSIFIED_NOT_RESOLVED'],
      ],
    );
    assert.match(experiment.admissibleConclusion, /exhaustive/i);
    assert.match(experiment.admissibleConclusion, /cannot assign source/i);
    assert.match(experiment.remainingBoundary, /does not define a link ontology/i);
    const boundary = experiment.observationBoundary;
    assert.equal(boundary.status, 'BINARY_CONTRACT_NOT_EXHAUSTIVE');
    assert.deepEqual(
      boundary.arityEnumeration.map(item => ({
        occurrenceCount: item.occurrenceCount,
        surjectiveAssignmentsExamined: item.surjectiveAssignmentsExamined,
        referenceRenameClasses: item.referenceRenameClasses,
        quotientClasses: item.quotientClasses,
        multiplicitySpectra: item.multiplicitySpectra,
      })),
      [
        {
          occurrenceCount: 1,
          surjectiveAssignmentsExamined: 1,
          referenceRenameClasses: 1,
          quotientClasses: 1,
          multiplicitySpectra: [[1]],
        },
        {
          occurrenceCount: 2,
          surjectiveAssignmentsExamined: 3,
          referenceRenameClasses: 2,
          quotientClasses: 2,
          multiplicitySpectra: [[1, 1], [2]],
        },
        {
          occurrenceCount: 3,
          surjectiveAssignmentsExamined: 13,
          referenceRenameClasses: 5,
          quotientClasses: 3,
          multiplicitySpectra: [[1, 1, 1], [2, 1], [3]],
        },
        {
          occurrenceCount: 4,
          surjectiveAssignmentsExamined: 75,
          referenceRenameClasses: 15,
          quotientClasses: 5,
          multiplicitySpectra: [[1, 1, 1, 1], [2, 1, 1], [2, 2], [3, 1], [4]],
        },
      ],
    );
    assert.equal(boundary.arityEnumerationComplete, true);
    assert.equal(
      boundary.generalizedCompleteInvariant,
      'reference multiplicity spectrum for each exhaustively tested unlabelled width 1 through 4',
    );

    const refinement = boundary.conditionalRefinement;
    assert.equal(
      refinement.assumption.provenance,
      'CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED',
    );
    assert.equal(refinement.assumption.foundationalStatus, 'UNESTABLISHED');
    assert.equal(refinement.occurrenceCount, 4);
    assert.equal(refinement.referencePartitionsExamined, 15);
    assert.equal(refinement.refinementPartitionsExamined, 15);
    assert.equal(refinement.labelledJointStructuresExamined, 225);
    assert.equal(refinement.occurrencePermutationsExamined, 24);
    assert.equal(refinement.jointQuotientClasses, 33);
    assert.deepEqual(
      refinement.encodings.map(item => ({
        id: item.id,
        distinctClasses: item.distinctClasses,
        completeForEnumeration: item.completeForEnumeration,
      })),
      [
        {
          id: 'canonical-partition-pair',
          distinctClasses: 33,
          completeForEnumeration: true,
        },
        {
          id: 'paired-equality-matrices',
          distinctClasses: 33,
          completeForEnumeration: true,
        },
        {
          id: 'intersection-multiplicity-table',
          distinctClasses: 33,
          completeForEnumeration: true,
        },
      ],
    );
    assert.equal(refinement.encodingAgreement, true);
    assert.deepEqual(
      refinement.projectionFibres.map(item => ({
        referenceMultiplicitySpectrum: item.referenceMultiplicitySpectrum,
        jointClasses: item.jointClasses,
        classesWithInvariantSingleton: item.classesWithInvariantSingleton,
        classesWithoutInvariantSingleton: item.classesWithoutInvariantSingleton,
        singletonPresenceClassification: item.singletonPresenceClassification,
      })),
      [
        {
          referenceMultiplicitySpectrum: [1, 1, 1, 1],
          jointClasses: 5,
          classesWithInvariantSingleton: 1,
          classesWithoutInvariantSingleton: 4,
          singletonPresenceClassification: 'REFINEMENT_DEPENDENT',
        },
        {
          referenceMultiplicitySpectrum: [2, 1, 1],
          jointClasses: 9,
          classesWithInvariantSingleton: 3,
          classesWithoutInvariantSingleton: 6,
          singletonPresenceClassification: 'REFINEMENT_DEPENDENT',
        },
        {
          referenceMultiplicitySpectrum: [2, 2],
          jointClasses: 7,
          classesWithInvariantSingleton: 1,
          classesWithoutInvariantSingleton: 6,
          singletonPresenceClassification: 'REFINEMENT_DEPENDENT',
        },
        {
          referenceMultiplicitySpectrum: [3, 1],
          jointClasses: 7,
          classesWithInvariantSingleton: 7,
          classesWithoutInvariantSingleton: 0,
          singletonPresenceClassification: 'BASE_FORCED',
        },
        {
          referenceMultiplicitySpectrum: [4],
          jointClasses: 5,
          classesWithInvariantSingleton: 1,
          classesWithoutInvariantSingleton: 4,
          singletonPresenceClassification: 'REFINEMENT_DEPENDENT',
        },
      ],
    );
    assert.equal(refinement.everyProjectionFibreAmbiguous, true);
    assert.equal(refinement.refinementRecoverableFromBase, false);
    assert.equal(refinement.classesWithInvariantSingleton, 13);
    assert.equal(refinement.classesWithoutInvariantSingleton, 20);
    assert.equal(refinement.conditionalSingletonSelectorExists, true);
    assert.equal(refinement.universalSingletonSelectorExists, false);
    assert.deepEqual(refinement.singletonOrbitHistogram, [
      { singletonOrbits: 0, jointClasses: 20 },
      { singletonOrbits: 1, jointClasses: 5 },
      { singletonOrbits: 2, jointClasses: 7 },
      { singletonOrbits: 4, jointClasses: 1 },
    ]);
    assert.deepEqual(refinement.asymmetryProvenance.classifications, [
      { id: 'BASE_FORCED', jointClasses: 7 },
      { id: 'REFINEMENT_PRESENT_NOT_BASE_FORCED', jointClasses: 5 },
      { id: 'RELATIONAL_INTERACTION_ONLY', jointClasses: 1 },
      { id: 'NO_SINGLETON_ORBIT', jointClasses: 20 },
    ]);
    assert.equal(
      refinement.asymmetryProvenance.baseProjectionFibresWithBothOutcomes,
      4,
    );
    assert.equal(
      refinement.asymmetryProvenance.baseProjectionFibresForcingSingleton,
      1,
    );
    assert.deepEqual(refinement.asymmetryProvenance.countermodel, {
      normalizedReferencePartition: [0, 0, 1, 2],
      referenceOccurrenceOrbitSizes: [2, 2],
      withoutSingletonRefinement: {
        normalizedPartition: [0, 0, 0, 0],
        refinementOccurrenceOrbitSizes: [4],
        jointOccurrenceOrbitSizes: [2, 2],
      },
      interactionOnlyRefinement: {
        normalizedPartition: [0, 1, 0, 2],
        refinementOccurrenceOrbitSizes: [2, 2],
        jointOccurrenceOrbitSizes: [1, 1, 1, 1],
      },
    });
    assert.deepEqual(refinement.derivationBoundary.finiteEnumeration, [
      {
        occurrenceCount: 1,
        basePatternsExamined: 1,
        candidateObservationsExamined: 1,
        baseSymmetryPreservingCandidates: 1,
        symmetryBreakingCandidates: 0,
        preservingCandidatesChangingOccurrenceOrbits: 0,
      },
      {
        occurrenceCount: 2,
        basePatternsExamined: 2,
        candidateObservationsExamined: 4,
        baseSymmetryPreservingCandidates: 4,
        symmetryBreakingCandidates: 0,
        preservingCandidatesChangingOccurrenceOrbits: 0,
      },
      {
        occurrenceCount: 3,
        basePatternsExamined: 5,
        candidateObservationsExamined: 25,
        baseSymmetryPreservingCandidates: 13,
        symmetryBreakingCandidates: 12,
        preservingCandidatesChangingOccurrenceOrbits: 0,
      },
      {
        occurrenceCount: 4,
        basePatternsExamined: 15,
        candidateObservationsExamined: 225,
        baseSymmetryPreservingCandidates: 55,
        symmetryBreakingCandidates: 170,
        preservingCandidatesChangingOccurrenceOrbits: 0,
      },
    ]);
    assert.equal(
      refinement.derivationBoundary.consequence,
      'BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS',
    );
    assert.equal(
      refinement.derivationBoundary.generalArgument.scope,
      'all finite observations satisfying the stated derivation criterion',
    );
    assert.deepEqual(
      refinement.derivationBoundary.interactionOnlyCounterexample,
      {
        basePattern: [0, 0, 1, 2],
        conditionalPattern: [0, 1, 0, 2],
        basePreservingRelabelling: [1, 0, 2, 3],
        relabelledBasePattern: [0, 0, 1, 2],
        relabelledConditionalPattern: [0, 1, 1, 2],
        basePreserved: true,
        conditionalPatternPreserved: false,
      },
    );

    const startingRepresentation = boundary.startingRepresentationAudit;
    assert.equal(
      startingRepresentation.status,
      'REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE',
    );
    assert.equal(
      startingRepresentation.independentJustification.provenance,
      'ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT',
    );
    assert.deepEqual(
      startingRepresentation.finiteEnumeration.map(item => ({
        occurrenceCount: item.occurrenceCount,
        referenceOnlyClasses: item.referenceOnlyClasses,
        addressableLinkClasses: item.addressableLinkClasses,
        classesWithNoDirectSelfReference: item.classesWithNoDirectSelfReference,
        classesWithDirectSelfReference: item.classesWithDirectSelfReference,
        projectionFibreHistogram: item.projectionFibreHistogram,
      })),
      [
        {
          occurrenceCount: 1,
          referenceOnlyClasses: 1,
          addressableLinkClasses: 2,
          classesWithNoDirectSelfReference: 1,
          classesWithDirectSelfReference: 1,
          projectionFibreHistogram: [{ addressableClasses: 2, referenceOnlyClasses: 1 }],
        },
        {
          occurrenceCount: 2,
          referenceOnlyClasses: 2,
          addressableLinkClasses: 4,
          classesWithNoDirectSelfReference: 2,
          classesWithDirectSelfReference: 2,
          projectionFibreHistogram: [{ addressableClasses: 2, referenceOnlyClasses: 2 }],
        },
        {
          occurrenceCount: 3,
          referenceOnlyClasses: 3,
          addressableLinkClasses: 7,
          classesWithNoDirectSelfReference: 3,
          classesWithDirectSelfReference: 4,
          projectionFibreHistogram: [
            { addressableClasses: 2, referenceOnlyClasses: 2 },
            { addressableClasses: 3, referenceOnlyClasses: 1 },
          ],
        },
        {
          occurrenceCount: 4,
          referenceOnlyClasses: 5,
          addressableLinkClasses: 12,
          classesWithNoDirectSelfReference: 5,
          classesWithDirectSelfReference: 7,
          projectionFibreHistogram: [
            { addressableClasses: 2, referenceOnlyClasses: 3 },
            { addressableClasses: 3, referenceOnlyClasses: 2 },
          ],
        },
      ],
    );
    assert.equal(startingRepresentation.everyProjectionFibreAmbiguous, true);
    assert.equal(startingRepresentation.referenceOnlyProjectionFaithful, false);
    assert.deepEqual(startingRepresentation.countermodel, {
      projectedReferenceMultiplicitySpectrum: [1, 1],
      directSelfLink: {
        normalizedAddressPattern: [0, 0, 1],
        directSelfReferenceCount: 1,
      },
      freshExternalLink: {
        normalizedAddressPattern: [0, 1, 2],
        directSelfReferenceCount: 0,
      },
      sameReferenceOnlyProjection: true,
      sameAddressableLinkClass: false,
    });
    assert.equal(
      startingRepresentation.generalArgument.consequence,
      'REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY',
    );
    const slotwiseIncidence = startingRepresentation.slotwiseSelfIncidence;
    assert.equal(
      slotwiseIncidence.status,
      'CLASSIFIED_PER_ORDERED_REFERENCE_SLOT',
    );
    assert.equal(
      slotwiseIncidence.provenance,
      'ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT',
    );
    assert.equal(
      slotwiseIncidence.predicate,
      'selfIncidenceByReferenceSlot[i] = (referenceAddress[i] === linkAddress)',
    );
    assert.deepEqual(
      slotwiseIncidence.finiteEnumeration.map(item => ({
        occurrenceCount: item.occurrenceCount,
        selfIncidencePatterns: item.selfIncidencePatterns,
        orderedEqualityClasses: item.orderedEqualityClasses,
        classesBySelfIncidence: item.classesBySelfIncidence.map(row => [
          row.selfIncidenceByReferenceSlot.map(Number).join(''),
          row.orderedEqualityClasses,
        ]),
      })),
      [
        {
          occurrenceCount: 1,
          selfIncidencePatterns: 2,
          orderedEqualityClasses: 2,
          classesBySelfIncidence: [['0', 1], ['1', 1]],
        },
        {
          occurrenceCount: 2,
          selfIncidencePatterns: 4,
          orderedEqualityClasses: 5,
          classesBySelfIncidence: [
            ['00', 2], ['01', 1], ['10', 1], ['11', 1],
          ],
        },
        {
          occurrenceCount: 3,
          selfIncidencePatterns: 8,
          orderedEqualityClasses: 15,
          classesBySelfIncidence: [
            ['000', 5], ['001', 2], ['010', 2], ['011', 1],
            ['100', 2], ['101', 1], ['110', 1], ['111', 1],
          ],
        },
        {
          occurrenceCount: 4,
          selfIncidencePatterns: 16,
          orderedEqualityClasses: 52,
          classesBySelfIncidence: [
            ['0000', 15], ['0001', 5], ['0010', 5], ['0011', 2],
            ['0100', 5], ['0101', 2], ['0110', 2], ['0111', 1],
            ['1000', 5], ['1001', 2], ['1010', 2], ['1011', 1],
            ['1100', 2], ['1101', 1], ['1110', 1], ['1111', 1],
          ],
        },
      ],
    );
    assert.equal(slotwiseIncidence.everyBooleanSlotPatternRealized, true);
    assert.equal(slotwiseIncidence.addressRenamingInvariantVerified, true);
    assert.equal(
      slotwiseIncidence.occurrencePermutationEquivariantVerified,
      true,
    );
    assert.equal(slotwiseIncidence.occurrencePermutationInvariant, false);
    assert.deepEqual(slotwiseIncidence.countermodel, {
      firstOrderedPattern: [0, 0, 1],
      secondOrderedPattern: [0, 1, 0],
      firstSelfIncidenceByReferenceSlot: [true, false],
      secondSelfIncidenceByReferenceSlot: [false, true],
      sameSelfIncidenceMultiplicity: true,
      sameSlotwiseSelfIncidence: false,
      sameAfterOccurrencePermutation: true,
    });
    assert.deepEqual(
      slotwiseIncidence.orderedFaithfulDescriptor.fields,
      ['referenceEqualityMatrix', 'selfIncidenceByReferenceSlot'],
    );
    assert.equal(
      slotwiseIncidence.orderedFaithfulDescriptor.status,
      'COMPLETE_INVARIANT_FOR_ORDERED_ADDRESS_EQUALITY_CONTRACT',
    );
    assert.equal(
      slotwiseIncidence.orderedFaithfulDescriptor.finiteEnumerationAgreement,
      true,
    );
    const sharedAddressComposition =
      startingRepresentation.sharedAddressComposition;
    assert.equal(
      sharedAddressComposition.status,
      'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL',
    );
    assert.equal(
      sharedAddressComposition.provenance,
      'ISSUE_183_INDIRECT_SELF_REFERENCE_REQUIREMENT',
    );
    assert.deepEqual(
      sharedAddressComposition.finiteEnumeration.map(item => ({
        linkCount: item.linkCount,
        referenceSlotsPerLink: item.referenceSlotsPerLink,
        sharedAddressClasses: item.sharedAddressClasses,
        localDescriptorClasses: item.localDescriptorClasses,
        localDescriptorFibreHistogram: item.localDescriptorFibreHistogram,
        localDescriptorsFaithful: item.localDescriptorsFaithful,
        sharedDescriptorClasses: item.sharedDescriptorClasses,
        sharedDescriptorFaithful: item.sharedDescriptorFaithful,
      })),
      [
        {
          linkCount: 1,
          referenceSlotsPerLink: 1,
          sharedAddressClasses: 2,
          localDescriptorClasses: 2,
          localDescriptorFibreHistogram: [
            { sharedAddressClasses: 1, localDescriptorClasses: 2 },
          ],
          localDescriptorsFaithful: true,
          sharedDescriptorClasses: 2,
          sharedDescriptorFaithful: true,
        },
        {
          linkCount: 2,
          referenceSlotsPerLink: 1,
          sharedAddressClasses: 10,
          localDescriptorClasses: 4,
          localDescriptorFibreHistogram: [
            { sharedAddressClasses: 1, localDescriptorClasses: 1 },
            { sharedAddressClasses: 2, localDescriptorClasses: 2 },
            { sharedAddressClasses: 5, localDescriptorClasses: 1 },
          ],
          localDescriptorsFaithful: false,
          sharedDescriptorClasses: 10,
          sharedDescriptorFaithful: true,
        },
        {
          linkCount: 3,
          referenceSlotsPerLink: 1,
          sharedAddressClasses: 77,
          localDescriptorClasses: 8,
          localDescriptorFibreHistogram: [
            { sharedAddressClasses: 1, localDescriptorClasses: 1 },
            { sharedAddressClasses: 3, localDescriptorClasses: 3 },
            { sharedAddressClasses: 10, localDescriptorClasses: 3 },
            { sharedAddressClasses: 37, localDescriptorClasses: 1 },
          ],
          localDescriptorsFaithful: false,
          sharedDescriptorClasses: 77,
          sharedDescriptorFaithful: true,
        },
        {
          linkCount: 4,
          referenceSlotsPerLink: 1,
          sharedAddressClasses: 799,
          localDescriptorClasses: 16,
          localDescriptorFibreHistogram: [
            { sharedAddressClasses: 1, localDescriptorClasses: 1 },
            { sharedAddressClasses: 4, localDescriptorClasses: 4 },
            { sharedAddressClasses: 17, localDescriptorClasses: 6 },
            { sharedAddressClasses: 77, localDescriptorClasses: 4 },
            { sharedAddressClasses: 372, localDescriptorClasses: 1 },
          ],
          localDescriptorsFaithful: false,
          sharedDescriptorClasses: 799,
          sharedDescriptorFaithful: true,
        },
      ],
    );
    assert.equal(
      sharedAddressComposition
        .localDescriptorsFaithfulAtEveryTestedMultiLinkWidth,
      false,
    );
    assert.deepEqual(
      sharedAddressComposition.countermodel.externalReferences,
      [[0, 1], [2, 3]],
    );
    assert.deepEqual(
      sharedAddressComposition.countermodel.twoLinkCycle,
      [[0, 2], [2, 0]],
    );
    assert.equal(
      sharedAddressComposition.countermodel.sameLocalDescriptors,
      true,
    );
    assert.equal(
      sharedAddressComposition.countermodel.sameSharedAddressClass,
      false,
    );
    assert.equal(
      sharedAddressComposition.countermodel.externalReferencesCycleLength,
      0,
    );
    assert.equal(
      sharedAddressComposition.countermodel.twoLinkCycleLength,
      2,
    );
    assert.equal(
      sharedAddressComposition.sharedFaithfulDescriptor.status,
      'COMPLETE_INVARIANT_FOR_ORDERED_SHARED_ADDRESS_EQUALITY_CONTRACT',
    );
    assert.deepEqual(
      sharedAddressComposition.sharedFaithfulDescriptor.fields,
      [
        'referenceEqualityMatrixAcrossLinks',
        'referenceToLinkAddressIncidenceMatrix',
      ],
    );
    assert.equal(
      sharedAddressComposition.sharedFaithfulDescriptor
        .finiteEnumerationAgreement,
      true,
    );
    assert.match(
      sharedAddressComposition.assumptionClassification.semanticsNotAssigned,
      /not a source, target, transition, dependency, or execution edge/,
    );
    const structuralProbe =
      startingRepresentation.structuralApplicationComposition;
    assert.equal(
      structuralProbe.status,
      'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION',
    );
    assert.deepEqual(structuralProbe.semanticSeparation, {
      logicalImplication: 'NOT_IDENTIFIED_WITH_LINK_STRUCTURE',
      linkStructure: 'ADDRESS_REFERENCE_INCIDENCE_ONLY',
      composition: 'PROPOSED_LINK_NOT_FORCED',
      execution: 'NO_TRANSFORMATION_OR_CREATION_LAW_PRESENT',
    });
    assert.deepEqual(
      structuralProbe.candidateEncodings.leftAssociated,
      [[3, 0, 1], [4, 3, 2]],
    );
    assert.deepEqual(
      structuralProbe.candidateEncodings.rightAssociated,
      [[3, 1, 2], [4, 0, 3]],
    );
    assert.equal(
      structuralProbe.candidateEncodings.sameUnderAddressRenamingAlone,
      false,
    );
    assert.equal(
      structuralProbe.candidateEncodings
        .sameAfterUniformSlotReversalAndAddressRenaming,
      true,
    );
    assert.equal(
      structuralProbe.candidateEncodings.recursiveAddressReferencesPresent,
      true,
    );
    assert.equal(
      structuralProbe.roleRecovery.semanticAssignmentsForThreeLeaves,
      6,
    );
    assert.equal(
      structuralProbe.roleRecovery.unorderedStructureAutomorphisms,
      2,
    );
    assert.deepEqual(
      structuralProbe.roleRecovery.unorderedLeafOrbitSizes,
      [1, 2],
    );
    assert.equal(
      structuralProbe.roleRecovery.allFourSemanticRolesRecovered,
      false,
    );
    assert.equal(
      structuralProbe.roleRecovery.status,
      'ADDITIONAL_ROLE_ASSIGNMENT_REQUIRED',
    );
    assert.deepEqual(
      structuralProbe.compositionCountermodel.withoutProposedResult,
      [[3, 0, 1], [4, 1, 2], [5, 2, 0], [6, 6, 3]],
    );
    assert.deepEqual(
      structuralProbe.compositionCountermodel.withProposedResult,
      [[3, 0, 1], [4, 1, 2], [5, 2, 0], [6, 6, 3], [7, 0, 2]],
    );
    assert.deepEqual(structuralProbe.compositionCountermodel.premiseP, [3, 0, 1]);
    assert.deepEqual(structuralProbe.compositionCountermodel.premiseQ, [4, 1, 2]);
    assert.deepEqual(
      structuralProbe.compositionCountermodel.proposedResult,
      [7, 0, 2],
    );
    assert.deepEqual(
      structuralProbe.compositionCountermodel.commonFacts,
      {
        distinctLinkIdentities: true,
        premiseLinkIdentitiesDistinctFromReferences: true,
        premiseReferenceAddressesPairwiseDistinct: true,
        directSelfIncidence: true,
        sharedAddressIncidence: true,
        recursiveLinkReferences: true,
      },
    );
    assert.equal(
      structuralProbe.compositionCountermodel.premisesHoldInBoth,
      true,
    );
    assert.equal(
      structuralProbe.compositionCountermodel.reversePairAlreadyPresent,
      true,
    );
    assert.equal(
      structuralProbe.compositionCountermodel.proposedResultAbsentInFirst,
      true,
    );
    assert.equal(
      structuralProbe.compositionCountermodel.proposedResultPresentInSecond,
      true,
    );
    assert.equal(
      structuralProbe.formationProbe.orderedPairsUsingExistingAddresses,
      49,
    );
    assert.deepEqual(
      structuralProbe.formationProbe.existingAddresses,
      [0, 1, 2, 3, 4, 5, 6],
    );
    assert.deepEqual(
      structuralProbe.formationProbe.proposedReferencePair,
      [0, 2],
    );
    assert.equal(
      structuralProbe.formationProbe.everyFormationExtensionPreservesPremises,
      true,
    );
    assert.equal(
      structuralProbe.formationProbe.compositionSpecificSelectionFromFormationOnly,
      false,
    );
    assert.match(
      structuralProbe.claimBoundary,
      /additional selection\/closure law/,
    );
    const authorityProbe =
      startingRepresentation.linkCarriedSelectionAuthority;
    assert.equal(
      authorityProbe.status,
      'LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY',
    );
    assert.deepEqual(authorityProbe.records.premises, [
      [3, 0, 1],
      [4, 1, 2],
    ]);
    assert.deepEqual(authorityProbe.records.candidates, [
      [7, 0, 2],
      [8, 0, 2],
    ]);
    assert.deepEqual(authorityProbe.records.additionalLink, [9, 7, 7]);
    assert.equal(
      authorityProbe.records.incidenceReadoutProvenance,
      'EXPERIMENTAL_EQUAL-REFERENCE_OBSERVATION_NOT_INTRINSIC_AUTHORITY',
    );
    assert.deepEqual(
      authorityProbe.equivariantSelectionConstraint.withoutAdditionalLink,
      {
        candidateAutomorphisms: [[0, 1], [1, 0]],
        candidateOrbitSizes: [2],
        invariantCandidateSubsets: [[], [7, 8]],
        invariantSingletonSelections: 0,
      },
    );
    assert.deepEqual(
      authorityProbe.equivariantSelectionConstraint.withAdditionalLink,
      {
        candidateAutomorphisms: [[0, 1]],
        candidateOrbitSizes: [1, 1],
        invariantCandidateSubsets: [[], [7], [8], [7, 8]],
        invariantSingletonSelections: 2,
      },
    );
    assert.equal(
      authorityProbe.equivariantSelectionConstraint
        .singletonSelectionMadePossible,
      true,
    );
    assert.equal(
      authorityProbe.equivariantSelectionConstraint.singletonSelectionForced,
      false,
    );
    assert.deepEqual(
      authorityProbe.oppositeEquivariantReadings.map(reading => [
        reading.id,
        reading.selectedCandidates,
        reading.addressRenamingEquivariant,
      ]),
      [
        ['referenced-candidate', [7], true],
        ['unreferenced-candidate', [8], true],
      ],
    );
    assert.deepEqual(authorityProbe.perturbations.removal.markedCandidates, []);
    assert.deepEqual(authorityProbe.perturbations.replacement.markedCandidates, [8]);
    assert.deepEqual(authorityProbe.perturbations.duplication.markedCandidates, [7, 8]);
    assert.equal(authorityProbe.perturbations.duplication.unique, false);
    assert.equal(
      authorityProbe.perturbations.forgery.structurallyRejected,
      false,
    );
    assert.equal(
      authorityProbe.perturbations.contextRelocation
        .sameUnderContextAddressRenaming,
      true,
    );
    assert.equal(
      authorityProbe.recursiveAuthority.finiteChainCandidateSwapPreservesShape,
      true,
    );
    assert.equal(
      authorityProbe.recursiveAuthority.selfReferenceClosesAddressCycle,
      true,
    );
    assert.equal(
      authorityProbe.recursiveAuthority
        .selfReferentialCandidateSwapPreservesShape,
      true,
    );
    assert.equal(
      authorityProbe.recursiveAuthority.selectionPolarityStillUnderdetermined,
      true,
    );
    assert.deepEqual(authorityProbe.distinctions, {
      formation: 'BOTH_CANDIDATE_LINKS_EXIST',
      selection: 'NOT_FORCED_TWO_OPPOSITE_EQUIVARIANT_READINGS',
      justification: 'ISOMORPHIC_FORGERY_NOT_REJECTED',
      activation: 'NO_LINK_DERIVED_ADMISSION_VALIDATION_OR_ACTIVATION',
      applicability: 'AMBIENT_EXISTENCE_DOES_NOT_SELECT_APPLICABILITY',
      execution: 'NO_TRANSITION_CREATION_OR_PUBLICATION_EVENT',
    });
    assert.match(
      authorityProbe.claimBoundary,
      /does not prove that external authority is irreducible/,
    );
    const admissibilityProbe =
      startingRepresentation.linkedStructuralAdmissibility;
    assert.equal(
      admissibilityProbe.status,
      'LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING',
    );
    assert.equal(
      admissibilityProbe.contract.verificationProvenance,
      'EXTERNAL_FINITE_RELATIONAL_CHECK_NOT_LINK_DERIVED_AUTHORITY',
    );
    assert.deepEqual(
      admissibilityProbe.cases.map(item => [
        item.id,
        item.cardinality,
        item.admissibleCandidates,
      ]),
      [
        ['valid-complete-evidence', 'ONE', [7]],
        ['missing-evidence', 'ZERO', []],
        ['duplicate-evidence', 'ZERO', []],
        ['foreign-evidence', 'ZERO', []],
        ['wrong-decomposition', 'ZERO', []],
        ['two-equally-admissible-candidates', 'MANY', [7, 8]],
        ['zero-admissible-candidates', 'ZERO', []],
        ['same-candidate-other-context', 'ZERO', []],
        ['context-relocated-evidence', 'ONE', [7]],
        ['replacement-description', 'ONE', [8]],
      ],
    );
    assert.deepEqual(
      admissibilityProbe.cardinalityAudit.observedClassifications,
      ['ZERO', 'ONE', 'MANY'],
    );
    assert.equal(
      admissibilityProbe.adversarialBoundary
        .forgedLocallyIsomorphicCandidateRejected,
      false,
    );
    assert.equal(
      admissibilityProbe.authorityRegress.descriptionRepresentedAsLinks,
      true,
    );
    assert.equal(
      admissibilityProbe.authorityRegress.descriptionAuthenticatedByStructure,
      false,
    );
    assert.match(
      admissibilityProbe.claimBoundary,
      /conditional on the observer-supplied verifier and role assignment/,
    );
    assert.deepEqual(
      startingRepresentation.quotientAudit.finiteEnumeration,
      [
        {
          occurrenceCount: 1,
          orderedEqualityClassesAfterAddressRenaming: 2,
          unlabelledAddressableClasses: 2,
          classesCollapsedByOccurrencePermutation: 0,
        },
        {
          occurrenceCount: 2,
          orderedEqualityClassesAfterAddressRenaming: 5,
          unlabelledAddressableClasses: 4,
          classesCollapsedByOccurrencePermutation: 1,
        },
        {
          occurrenceCount: 3,
          orderedEqualityClassesAfterAddressRenaming: 15,
          unlabelledAddressableClasses: 7,
          classesCollapsedByOccurrencePermutation: 8,
        },
        {
          occurrenceCount: 4,
          orderedEqualityClassesAfterAddressRenaming: 52,
          unlabelledAddressableClasses: 12,
          classesCollapsedByOccurrencePermutation: 40,
        },
      ],
    );
    assert.equal(
      startingRepresentation.quotientAudit
        .addressRenamingCompleteInvariantVerified,
      true,
    );
    assert.deepEqual(
      startingRepresentation.quotientAudit.transformations.map(item => [
        item.transformation,
        item.classification,
      ]),
      [
        [
          'global address renaming',
          'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
        ],
        ['reference-occurrence permutation', 'UNESTABLISHED_EQUIVALENCE'],
      ],
    );
    assert.deepEqual(
      startingRepresentation.quotientAudit.occurrencePermutationCountermodel,
      {
        firstOrderedPattern: [0, 0, 1],
        secondOrderedPattern: [0, 1, 0],
        sameUnderAddressRenamingAlone: false,
        sameAfterOccurrencePermutation: true,
        interpretation: 'DISTINGUISHABLE_ONLY_IF_REFERENCE_SLOTS_HAVE_IDENTITY',
      },
    );
    assert.equal(
      startingRepresentation.quotientAudit.minimalFaithfulDescriptor.status,
      'COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT',
    );
    assert.deepEqual(
      startingRepresentation.quotientAudit.minimalFaithfulDescriptor.fields,
      ['referenceMultiplicitySpectrum', 'directSelfReferenceMultiplicity'],
    );
    assert.equal(
      startingRepresentation.quotientAudit.minimalFaithfulDescriptor
        .finiteEnumerationAgreement,
      true,
    );
    assert.equal(
      startingRepresentation.quotientAudit.occurrencePermutationIntrinsic,
      'UNRESOLVED',
    );

    assert.deepEqual(
      boundary.lossAudit.map(item => [item.distinction, item.classification]),
      [
        [
          'reference names',
          'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
        ],
        ['occurrence order', 'UNESTABLISHED_EQUIVALENCE'],
        ['width beyond two occurrences', 'PROVEN_INFORMATION_LOSS'],
        ['second equivalence observation', 'PROVEN_NOT_RECOVERABLE'],
        ['direct self-reference', 'PROVEN_INFORMATION_LOSS_FOR_ADDRESSABLE_LINKS'],
        [
          'self-incidence reference slot',
          'RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT',
        ],
        [
          'cross-link address incidence',
          'PROVEN_INFORMATION_LOSS_UNDER_LOCAL_PROJECTION',
        ],
        [
          'application and composition meaning',
          'PROVEN_NOT_ENTAILED_BY_TESTED_LINK_STRUCTURE',
        ],
        [
          'selection authority from additional linked incidence',
          'ASYMMETRY_PERMITS_BUT_DOES_NOT_FORCE_SELECTION',
        ],
        [
          'admissibility from linked descriptions and evidence',
          'STRUCTURAL_CERTIFICATES_FILTER_RELATIVE_TO_EXTERNAL_VERIFIER',
        ],
        ['endpoint direction', 'NOT_OBSERVED_NOT_DISPROVED'],
        ['dynamics and time', 'NOT_OBSERVED_NOT_DISPROVED'],
      ],
    );
    assert.ok(experiment.results.some(item =>
      item.id === 'fixed-binary-observation-sufficiency' &&
      item.result === 'INSUFFICIENT_OUTSIDE_FIXED_ARITY'));
    assert.ok(experiment.results.some(item =>
      item.id === 'conditional-structural-asymmetry' &&
      item.result === 'EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL'));
    assert.ok(experiment.results.some(item =>
      item.id === 'conditional-interaction-forcedness' &&
      item.result === 'SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE'));
    assert.ok(experiment.results.some(item =>
      item.id === 'addressable-quotient-assumptions' &&
      item.result === 'RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED'));
    assert.ok(experiment.results.some(item =>
      item.id === 'shared-address-composition' &&
      item.result ===
        'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL'));
    assert.ok(experiment.results.some(item =>
      item.id === 'structural-application-composition' &&
      item.result ===
        'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION'));
    assert.ok(experiment.results.some(item =>
      item.id === 'link-carried-selection-authority' &&
      item.result ===
        'LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY'));
    assert.ok(experiment.results.some(item =>
      item.id === 'linked-structural-admissibility' &&
      item.result ===
        'LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING'));
    assert.match(
      report.conclusion.ontologyExperimentConclusion,
      /binary equality coincidence is complete only at fixed width two/i,
    );
    assert.match(
      report.conclusion.ontologyExperimentConclusion,
      /two opposite equivariant singleton readings/i,
    );
    assert.match(
      report.conclusion.ontologyExperimentConclusion,
      /ZERO\/ONE\/MANY candidates/i,
    );
  });

  it('fault-injects every residual semantic law instead of assuming it', () => {
    for (const candidate of report.candidates) {
      assert.equal(
        candidate.eliminationExperiments.length,
        candidate.primitiveSemanticLaws.length,
      );
      for (const experiment of candidate.eliminationExperiments) {
        assert.equal(experiment.baselinePreserved, false);
        assert.equal(
          experiment.classification,
          'INDEPENDENT_FOR_CANDIDATE_WORKLOAD',
        );
        assert.ok(experiment.observedFailure.length > 0);
      }
    }
  });

  it('checks a complete universal counter-machine basis and language cores', () => {
    for (const candidate of report.candidates) {
      assert.equal(candidate.turingCompleteness.completeInstructionBasis.length, 4);
      assert.deepEqual(
        candidate.turingCompleteness.executableCertificate.finalCounters,
        ['zero', 'zero'],
      );
      assert.equal(
        candidate.turingCompleteness.executableCertificate.exercisedTransitionCases,
        6,
      );
      assert.equal(candidate.referentialWitness.technique, 'guarded proof knot');
      assert.match(candidate.referentialWitness.safetyBoundary, /circular proof/);
    }
    for (const candidate of report.candidates) {
      assert.deepEqual(Object.keys(candidate.languageCores).sort(), [
        'javascript',
        'lean',
        'rocq',
        'rust',
      ]);
    }
    assert.match(report.proofBoundary, /production implementations/);
  });

  it('keeps the checked-in candidate table synchronized with execution', () => {
    assert.equal(expected.schema, 'rml-foundation-candidate-table/v13');
    assert.equal(
      new Set(expected.claimBoundary.proved).size,
      expected.claimBoundary.proved.length,
      'proved claim list must not contain duplicate generated entries',
    );
    assert.equal(
      new Set(expected.claimBoundary.notProved).size,
      expected.claimBoundary.notProved.length,
      'not-proved claim list must not contain duplicate generated entries',
    );
    for (const row of expected.candidates) {
      const candidate = report.candidates.find(item => item.candidate === row.candidate);
      assert.ok(candidate, `missing executed candidate ${row.candidate}`);
      assert.equal(candidate.semanticMechanism, row.semanticMechanism);
      for (const field of [
        'representation',
        'transitionMechanism',
        'transitionAuthority',
        'sourceProvenance',
        'hostRuntimeBoundary',
        'formationAdmissibilityBoundary',
        'executionControlBoundary',
        'selfDescriptionMechanism',
        'selfInterpretationMechanism',
        'selfGenerationMechanism',
      ]) {
        assert.equal(candidate[field], row[field], `${row.candidate} ${field} drifted`);
      }
      assert.deepEqual(
        candidate.primitiveSemanticLaws.map(law => law.id),
        row.externalLaws,
      );
      assert.equal(
        candidate.measurements.independentExternalSemanticInformation,
        row.independentExternalInformation,
      );
      assert.equal(
        candidate.measurements.hostSemanticOperations,
        row.hostSemanticOperations,
      );
      assert.equal(
        candidate.measurements.selfHostingClosure.ratio,
        row.selfHostingClosure,
      );
      assert.equal(candidate.equivalentTo, row.equivalentTo);
      assert.equal(candidate.rejectedBecause, row.rejectedBecause);
      assert.deepEqual(
        candidate.objectSpecificHostKnowledge,
        row.objectSpecificHostKnowledge,
      );
      assert.deepEqual(
        candidate.measurements.undocumentedAuthorityPaths,
        row.undocumentedAuthorityPaths,
      );
      assert.equal(
        candidate.comparisonEligibility.eligible,
        row.comparisonEligible,
      );
      assert.deepEqual(
        candidate.comparisonEligibility.exclusionReasons,
        row.comparisonExclusionReasons,
      );
      assert.equal(candidate.ontologyRole, row.ontologyRole);
      assert.equal(
        candidate.constrainsOntologySearch,
        row.constrainsOntologySearch,
      );
      assert.deepEqual(
        candidate.foundationalEligibility,
        row.foundationalEligibility,
      );
    }
    assert.equal(report.foundationStatus, expected.foundationStatus);
    assert.equal(report.comparisonScope, expected.comparisonScope);
    assert.deepEqual(report.ontologySearch, expected.ontologySearch);
    assert.deepEqual(report.ontologyExperiment, expected.ontologyExperiment);
    assert.equal(expected.claimBoundary.foundationStatus, 'OPEN');
    assert.equal(expected.claimBoundary.ontologyQuestionsResolved, false);
    assert.equal(expected.claimBoundary.existingCandidatesConstrainOntologySearch, false);
    assert.ok(expected.claimBoundary.proved.includes(
      'binary equality coincidence is complete for the exhaustive fixed-width-two observation contract',
    ));
    assert.ok(expected.claimBoundary.proved.includes(
      'a conditional second equivalence observation produces 33 joint classes whose reference-only projection has five to nine refinements per fibre',
    ));
    assert.ok(expected.claimBoundary.proved.includes(
      'slotwise self-incidence is invariant under address renaming and equivariant under reference-slot permutation',
    ));
    assert.ok(expected.claimBoundary.notProved.includes(
      'that the two-occurrence observation contract exhausts the ontology of links',
    ));
    assert.ok(expected.claimBoundary.notProved.includes(
      'that the conditional second equivalence observation is fundamental to links',
    ));
    assert.ok(expected.claimBoundary.notProved.includes(
      'that a self-incident slot is a source, target, or execution role',
    ));
    assert.equal(report.conclusion.globallyMinimal, expected.claimBoundary.globallyMinimal);
    assert.equal(
      report.comparisonCohort.sufficient,
      expected.claimBoundary.comparableCohortEstablished,
    );
    assert.equal(
      report.representationBoundaryWitness.intrinsicTransitionAuthority,
      expected.claimBoundary.intrinsicTransitionAuthority,
    );
    assert.equal(
      report.representationBoundaryWitness.classification,
      expected.representationBoundary.classification,
    );
    assert.deepEqual(
      report.representationBoundaryWitness.representationSignature,
      expected.representationBoundary.representationSignature,
    );
    assert.equal(
      report.representationBoundaryWitness.investigatedObject,
      expected.representationBoundary.investigatedObject,
    );
    assert.equal(
      report.representationBoundaryWitness.linkOntologyCovered,
      expected.representationBoundary.linkOntologyCovered,
    );
    assert.equal(
      report.representationBoundaryWitness.representationExhaustivenessEstablished,
      expected.representationBoundary.representationExhaustivenessEstablished,
    );
    assert.equal(
      report.representationBoundaryWitness.structureTransformationSeparation,
      expected.representationBoundary.structureTransformationSeparation,
    );
    assert.equal(
      report.representationBoundaryWitness.transitionExternality,
      expected.representationBoundary.transitionExternality,
    );
    assert.deepEqual(
      report.representationBoundaryWitness.modelAssumptions.map(({ id, status }) => ({
        id,
        status,
      })),
      expected.representationBoundary.modelAssumptions,
    );
    assert.deepEqual(
      report.representationBoundaryWitness.interpretations.map(item => item.id),
      expected.representationBoundary.witnessInterpretations,
    );
    assert.equal(
      report.representationBoundaryWitness.uniqueTransitionSelected,
      expected.representationBoundary.uniqueTransitionSelected,
    );
    assert.deepEqual(
      report.representationBoundaryWitness.prohibitedConclusions,
      expected.representationBoundary.prohibitedConclusions,
    );
    assert.equal(
      report.comparisonCohort.minimumCandidates,
      expected.comparisonCohort.minimumCandidates,
    );
    assert.deepEqual(
      report.comparisonCohort.eligibleCandidates,
      expected.comparisonCohort.eligibleCandidates,
    );
    assert.deepEqual(
      report.comparisonCohort.excludedCandidates.map(item => item.candidate),
      expected.comparisonCohort.excludedCandidates,
    );
    assert.equal(
      report.comparisonCohort.asymmetricRankingPermitted,
      expected.comparisonCohort.asymmetricRankingPermitted,
    );
  });
});
