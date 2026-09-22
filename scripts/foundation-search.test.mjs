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
    assert.equal(report.schema, 'rml-alternative-foundation-search/v1');
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
    }
    assert.equal(report.conclusion.globallyMinimal, expected.claimBoundary.globallyMinimal);
  });
});
