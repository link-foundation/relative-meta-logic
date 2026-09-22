import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { foundationSearchReport } from '../js/src/rml-foundation-search.mjs';

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
    assert.equal(report.schema, 'rml-alternative-foundation-search/v2');
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

  it('demonstrates that link structure alone underdetermines transition semantics', () => {
    const witness = report.intrinsicAuthorityWitness;
    assert.equal(witness.classification, 'NO_INTRINSIC_TRANSITION_AUTHORITY');
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
    assert.equal(witness.forcedExecutionLaws.length, 0);
    assert.match(witness.argument, /same link structure/i);
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
    assert.equal(expected.schema, 'rml-foundation-candidate-table/v2');
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
    }
    assert.equal(report.conclusion.globallyMinimal, expected.claimBoundary.globallyMinimal);
    assert.equal(
      report.comparisonCohort.sufficient,
      expected.claimBoundary.comparableCohortEstablished,
    );
    assert.equal(
      report.intrinsicAuthorityWitness.classification,
      expected.claimBoundary.intrinsicTransitionAuthority,
    );
    assert.equal(
      report.intrinsicAuthorityWitness.classification,
      expected.intrinsicAuthority.classification,
    );
    assert.deepEqual(
      report.intrinsicAuthorityWitness.representationSignature,
      expected.intrinsicAuthority.representationSignature,
    );
    assert.deepEqual(
      report.intrinsicAuthorityWitness.forcedExecutionLaws,
      expected.intrinsicAuthority.forcedExecutionLaws,
    );
    assert.deepEqual(
      report.intrinsicAuthorityWitness.interpretations.map(item => item.id),
      expected.intrinsicAuthority.witnessInterpretations,
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
