import { isStructurallySame } from './rml-links.mjs';
import { LinkedProgramRegistry } from './rml-linked-program.mjs';

const ACCEPTANCE_OPERATIONS = Object.freeze([
  'load',
  'import',
  'rebind',
  'match',
  'substitute',
  'rewrite',
  'infer',
  'verify',
  'self-interpret',
]);

const DIRECT_SEMANTIC_OPERATIONS = Object.freeze([
  'compare-link-structure',
  'bind-pattern-variables',
  'substitute-bound-structures',
  'select-and-traverse-rewrite-rules',
  'resolve-and-rebind-program-imports',
  'saturate-inference-rules',
]);

const HORN_SEMANTIC_OPERATIONS = Object.freeze([
  'compare-link-structure',
  'bind-pattern-variables',
  'substitute-bound-structures',
  'insert-derived-fact',
  'schedule-horn-saturation',
]);

const NON_SEMANTIC_OPERATIONS = Object.freeze([
  'parse-linked-forms',
  'enforce-cycle-and-resource-bounds',
]);

const OPEN_FOUNDATIONAL_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'link-ontology',
    status: 'UNRESOLVED',
    question: 'What is a link before a host representation assigns categories to it?',
  }),
  Object.freeze({
    id: 'primitive-categories',
    status: 'UNRESOLVED',
    question: 'Which, if any, primitive categories are forced by the investigated phenomenon?',
  }),
  Object.freeze({
    id: 'structure-transformation-relation',
    status: 'UNRESOLVED',
    question: 'Is a distinction between structure and transformation derived or imported?',
  }),
  Object.freeze({
    id: 'intrinsic-semantic-authority',
    status: 'UNRESOLVED',
    question: 'Can semantic authority arise from links without being supplied externally?',
  }),
  Object.freeze({
    id: 'comparative-minimality',
    status: 'UNRESOLVED',
    question: 'Do independent derivations converge on a comparable minimal foundation?',
  }),
]);

const IMPORTED_PRIMITIVE_CATEGORIES = Object.freeze([
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
].map(id => Object.freeze({
  id,
  provenance: 'IMPORTED_EXPERIMENTAL_VOCABULARY',
  foundationalStatus: 'UNESTABLISHED',
})));

function ontologySearchAudit() {
  return {
    status: 'OPEN_INDEPENDENT_INVESTIGATION',
    openQuestions: OPEN_FOUNDATIONAL_QUESTIONS.map(question => ({ ...question })),
    provenanceQuestions: [
      'Was the concept forced by the investigated link phenomenon?',
      'Was the concept derived from already established properties?',
      'Was the concept imported from an existing formalism or host representation?',
    ],
    importedPrimitiveCategories: IMPORTED_PRIMITIVE_CATEGORIES.map(
      category => ({ ...category }),
    ),
    existingCandidatesRole: 'EXECUTABLE_CONTROLS_ONLY',
    existingCandidatesConstrainSearch: false,
    targetArchitectureSelected: false,
    acceptanceCriterion: 'A primitive earns foundational status only through an explicit derivation from independently established properties; successful execution, universality, self-hosting, elegance, and small size are insufficient.',
  };
}

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => {
    const rest = values.filter((_, candidate) => candidate !== index);
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

function assignments(width, carrierSize, prefix = []) {
  if (prefix.length === width) return [prefix];
  return Array.from({ length: carrierSize }, (_, value) => value)
    .flatMap(value => assignments(width, carrierSize, [...prefix, value]));
}

function surjectiveAssignments(width, carrierSize) {
  return assignments(width, carrierSize).filter(assignment =>
    new Set(assignment).size === carrierSize);
}

function observationActions(carrierSize, occurrenceCount = 2) {
  const occurrencePermutations = permutations(
    Array.from({ length: occurrenceCount }, (_, index) => index),
  );
  const referencePermutations = permutations(
    Array.from({ length: carrierSize }, (_, index) => index),
  );
  return occurrencePermutations.flatMap(occurrencePermutation =>
    referencePermutations.map(referencePermutation => ({
      occurrencePermutation,
      referencePermutation,
    })));
}

function applyObservationAction(assignment, action) {
  return action.occurrencePermutation.map(
    occurrence => action.referencePermutation[assignment[occurrence]],
  );
}

function uniqueVectors(vectors) {
  const unique = new Map(vectors.map(vector => [JSON.stringify(vector), vector]));
  return [...unique.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function observationOrbit(assignment) {
  return uniqueVectors(
    observationActions(new Set(assignment).size, assignment.length)
      .map(action => applyObservationAction(assignment, action)),
  );
}

function firstOccurrenceNormalForm(assignment) {
  const names = new Map();
  return assignment.map(reference => {
    if (!names.has(reference)) names.set(reference, names.size);
    return names.get(reference);
  });
}

function equalityMatrix(assignment) {
  return assignment.flatMap(left =>
    assignment.map(right => Number(left === right)));
}

function multiplicitySpectrum(assignment) {
  const counts = new Map();
  for (const reference of assignment) {
    counts.set(reference, (counts.get(reference) ?? 0) + 1);
  }
  return [...counts.values()].sort((left, right) => right - left);
}

function observationSignature(assignment) {
  return assignment[0] === assignment[1]
    ? 'same-reference'
    : 'distinct-references';
}

function invariantSubsets(size, permutationsToCheck) {
  return Array.from({ length: 2 ** size }, (_, mask) =>
    Array.from({ length: size }, (_, index) => index)
      .filter(index => (mask & (1 << index)) !== 0))
    .filter(subset => permutationsToCheck.every(permutation => {
      const transformed = subset.map(index => permutation[index])
        .sort((left, right) => left - right);
      return JSON.stringify(transformed) === JSON.stringify(subset);
    }));
}

function mapsCommute(left, right) {
  return left.every((_, index) => left[right[index]] === right[left[index]]);
}

function compareVectors(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function setPartitions(width) {
  return uniqueVectors(
    Array.from({ length: width }, (_, index) =>
      surjectiveAssignments(width, index + 1))
      .flat()
      .map(firstOccurrenceNormalForm),
  );
}

function permutePartition(partition, permutation) {
  return firstOccurrenceNormalForm(
    permutation.map(index => partition[index]),
  );
}

function canonicalPartitionSignature(partition) {
  return permutations(partition.map((_, index) => index))
    .map(permutation => JSON.stringify(
      permutePartition(partition, permutation),
    ))
    .sort()[0];
}

function canonicalPartitionPairSignature(referencePartition, refinementPartition) {
  return permutations(referencePartition.map((_, index) => index))
    .map(permutation => JSON.stringify([
      permutePartition(referencePartition, permutation),
      permutePartition(refinementPartition, permutation),
    ]))
    .sort()[0];
}

function canonicalPairedEqualityMatrixSignature(
  referencePartition,
  refinementPartition,
) {
  return permutations(referencePartition.map((_, index) => index))
    .map(permutation => JSON.stringify([
      equalityMatrix(permutePartition(referencePartition, permutation)),
      equalityMatrix(permutePartition(refinementPartition, permutation)),
    ]))
    .sort()[0];
}

function intersectionMultiplicityTable(leftPartition, rightPartition) {
  const rows = new Set(leftPartition).size;
  const columns = new Set(rightPartition).size;
  const table = Array.from({ length: rows }, () =>
    Array(columns).fill(0));
  for (let index = 0; index < leftPartition.length; index += 1) {
    table[leftPartition[index]][rightPartition[index]] += 1;
  }
  return table;
}

function canonicalIntersectionTableSignature(
  referencePartition,
  refinementPartition,
) {
  const table = intersectionMultiplicityTable(
    referencePartition,
    refinementPartition,
  );
  const rows = table.length;
  const columns = table[0].length;
  return permutations(Array.from({ length: rows }, (_, index) => index))
    .flatMap(rowPermutation =>
      permutations(Array.from({ length: columns }, (_, index) => index))
        .map(columnPermutation => JSON.stringify([
          rows,
          columns,
          rowPermutation.flatMap(row =>
            columnPermutation.map(column => table[row][column])),
        ])))
    .sort()[0];
}

function classificationsAgree(structures, baseline, candidate) {
  const baselineToCandidate = new Map();
  const candidateToBaseline = new Map();
  for (const structure of structures) {
    const baselineKey = baseline(...structure);
    const candidateKey = candidate(...structure);
    if (!baselineToCandidate.has(baselineKey)) {
      baselineToCandidate.set(baselineKey, new Set());
    }
    if (!candidateToBaseline.has(candidateKey)) {
      candidateToBaseline.set(candidateKey, new Set());
    }
    baselineToCandidate.get(baselineKey).add(candidateKey);
    candidateToBaseline.get(candidateKey).add(baselineKey);
  }
  return [...baselineToCandidate.values()].every(values => values.size === 1) &&
    [...candidateToBaseline.values()].every(values => values.size === 1);
}

function partitionPairOccurrenceOrbits(referencePartition, refinementPartition) {
  const width = referencePartition.length;
  const identityKey = JSON.stringify([
    referencePartition,
    refinementPartition,
  ]);
  const automorphisms = permutations(Array.from({ length: width }, (_, index) => index))
    .filter(permutation => JSON.stringify([
      permutePartition(referencePartition, permutation),
      permutePartition(refinementPartition, permutation),
    ]) === identityKey);
  const pending = new Set(Array.from({ length: width }, (_, index) => index));
  const orbits = [];
  while (pending.size > 0) {
    const seed = pending.values().next().value;
    const orbit = [...new Set(
      automorphisms.map(permutation => permutation[seed]),
    )].sort((left, right) => left - right);
    for (const occurrence of orbit) pending.delete(occurrence);
    orbits.push(orbit);
  }
  return orbits.sort(compareVectors);
}

function basePreservingRelabellings(basePattern) {
  const identityKey = JSON.stringify(basePattern);
  return permutations(basePattern.map((_, index) => index))
    .filter(permutation => JSON.stringify(
      permutePartition(basePattern, permutation),
    ) === identityKey);
}

function derivationBoundaryExperiment(interactionOnlyClass) {
  const finiteEnumeration = Array.from({ length: 4 }, (_, index) => index + 1)
    .map(occurrenceCount => {
      const patterns = setPartitions(occurrenceCount);
      let baseSymmetryPreservingCandidates = 0;
      let preservingCandidatesChangingOccurrenceOrbits = 0;
      for (const basePattern of patterns) {
        const baseRelabellings = basePreservingRelabellings(basePattern);
        const baseOrbits = partitionPairOccurrenceOrbits(
          basePattern,
          basePattern,
        );
        for (const candidatePattern of patterns) {
          const preservesBaseSymmetry = baseRelabellings.every(permutation =>
            JSON.stringify(permutePartition(candidatePattern, permutation)) ===
              JSON.stringify(candidatePattern));
          if (!preservesBaseSymmetry) continue;
          baseSymmetryPreservingCandidates += 1;
          const jointOrbits = partitionPairOccurrenceOrbits(
            basePattern,
            candidatePattern,
          );
          if (JSON.stringify(jointOrbits) !== JSON.stringify(baseOrbits)) {
            preservingCandidatesChangingOccurrenceOrbits += 1;
          }
        }
      }
      const candidateObservationsExamined = patterns.length ** 2;
      return {
        occurrenceCount,
        basePatternsExamined: patterns.length,
        candidateObservationsExamined,
        baseSymmetryPreservingCandidates,
        symmetryBreakingCandidates:
          candidateObservationsExamined - baseSymmetryPreservingCandidates,
        preservingCandidatesChangingOccurrenceOrbits,
      };
    });

  const basePattern = interactionOnlyClass.referencePartition;
  const conditionalPattern = interactionOnlyClass.refinementPartition;
  const basePreservingRelabelling = basePreservingRelabellings(basePattern)
    .find(permutation => permutation[0] === 1 &&
      JSON.stringify(permutePartition(conditionalPattern, permutation)) !==
        JSON.stringify(conditionalPattern));
  if (!basePreservingRelabelling) {
    throw new Error('interaction-only witness did not expose added choice');
  }
  const relabelledBasePattern = permutePartition(
    basePattern,
    basePreservingRelabelling,
  );
  const relabelledConditionalPattern = permutePartition(
    conditionalPattern,
    basePreservingRelabelling,
  );

  return {
    derivationCriterion: 'a deterministic observation derived from the base alone must commute with every occurrence relabelling',
    finiteEnumeration,
    generalArgument: {
      scope: 'all finite observations satisfying the stated derivation criterion',
      steps: [
        'take any occurrence relabelling that leaves the base observation unchanged',
        'commutation makes derivation after relabelling equal relabelling after derivation',
        'because the relabelled base is unchanged, the derived observation must also be unchanged',
        'therefore every base-preserving relabelling survives in the base together with its derived observation',
      ],
    },
    consequence: 'BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS',
    interactionOnlyCounterexample: {
      basePattern,
      conditionalPattern,
      basePreservingRelabelling,
      relabelledBasePattern,
      relabelledConditionalPattern,
      basePreserved:
        JSON.stringify(relabelledBasePattern) === JSON.stringify(basePattern),
      conditionalPatternPreserved:
        JSON.stringify(relabelledConditionalPattern) ===
          JSON.stringify(conditionalPattern),
    },
  };
}

function observationBoundaryExperiment() {
  const arityEnumeration = Array.from({ length: 4 }, (_, index) => index + 1)
    .map(occurrenceCount => {
      const rawAssignments = Array.from(
        { length: occurrenceCount },
        (_, carrierIndex) => surjectiveAssignments(
          occurrenceCount,
          carrierIndex + 1,
        ),
      ).flat();
      const partitions = setPartitions(occurrenceCount);
      const spectra = uniqueVectors(partitions.map(multiplicitySpectrum));
      const structures = partitions.map(partition => [partition]);
      return {
        occurrenceCount,
        surjectiveAssignmentsExamined: rawAssignments.length,
        referenceRenameClasses: partitions.length,
        quotientClasses: spectra.length,
        multiplicitySpectra: spectra,
        completeInvariantVerified: classificationsAgree(
          structures,
          partition => canonicalPartitionSignature(partition),
          partition => JSON.stringify(multiplicitySpectrum(partition)),
        ),
      };
    });

  const occurrenceCount = 4;
  const partitions = setPartitions(occurrenceCount);
  const structures = partitions.flatMap(referencePartition =>
    partitions.map(refinementPartition => [
      referencePartition,
      refinementPartition,
    ]));
  const encoders = [
    {
      id: 'canonical-partition-pair',
      encode: canonicalPartitionPairSignature,
    },
    {
      id: 'paired-equality-matrices',
      encode: canonicalPairedEqualityMatrixSignature,
    },
    {
      id: 'intersection-multiplicity-table',
      encode: canonicalIntersectionTableSignature,
    },
  ];
  const baselineEncoder = encoders[0].encode;
  const encodings = encoders.map(({ id, encode }) => ({
    id,
    distinctClasses: new Set(structures.map(structure => encode(...structure))).size,
    completeForEnumeration: classificationsAgree(
      structures,
      baselineEncoder,
      encode,
    ),
  }));

  const jointClasses = new Map();
  for (const [referencePartition, refinementPartition] of structures) {
    const key = baselineEncoder(referencePartition, refinementPartition);
    if (jointClasses.has(key)) continue;
    const occurrenceOrbits = partitionPairOccurrenceOrbits(
      referencePartition,
      refinementPartition,
    );
    const referenceOccurrenceOrbits = partitionPairOccurrenceOrbits(
      referencePartition,
      referencePartition,
    );
    const refinementOccurrenceOrbits = partitionPairOccurrenceOrbits(
      refinementPartition,
      refinementPartition,
    );
    jointClasses.set(key, {
      referencePartition,
      refinementPartition,
      referenceMultiplicitySpectrum: multiplicitySpectrum(referencePartition),
      refinementMultiplicitySpectrum: multiplicitySpectrum(refinementPartition),
      referenceOccurrenceOrbitSizes: referenceOccurrenceOrbits
        .map(orbit => orbit.length)
        .sort((left, right) => right - left),
      refinementOccurrenceOrbitSizes: refinementOccurrenceOrbits
        .map(orbit => orbit.length)
        .sort((left, right) => right - left),
      occurrenceOrbitSizes: occurrenceOrbits
        .map(orbit => orbit.length)
        .sort((left, right) => right - left),
    });
  }

  const fibres = new Map();
  for (const jointClass of jointClasses.values()) {
    const key = JSON.stringify(jointClass.referenceMultiplicitySpectrum);
    if (!fibres.has(key)) fibres.set(key, []);
    fibres.get(key).push(jointClass);
  }
  const projectionFibres = [...fibres.values()]
    .map(items => {
      const classesWithInvariantSingleton = items
        .filter(item => item.occurrenceOrbitSizes.includes(1)).length;
      const classesWithoutInvariantSingleton = items.length -
        classesWithInvariantSingleton;
      return {
        referenceMultiplicitySpectrum: items[0].referenceMultiplicitySpectrum,
        jointClasses: items.length,
        refinementMultiplicitySpectra: uniqueVectors(
          items.map(item => item.refinementMultiplicitySpectrum),
        ),
        classesWithInvariantSingleton,
        classesWithoutInvariantSingleton,
        singletonPresenceClassification:
          items[0].referenceOccurrenceOrbitSizes.includes(1)
          ? 'BASE_FORCED'
          : 'REFINEMENT_DEPENDENT',
      };
    })
    .sort((left, right) => compareVectors(
      left.referenceMultiplicitySpectrum,
      right.referenceMultiplicitySpectrum,
    ));
  const classesWithInvariantSingleton = [...jointClasses.values()]
    .filter(item => item.occurrenceOrbitSizes.includes(1)).length;
  const classesWithoutInvariantSingleton = jointClasses.size -
    classesWithInvariantSingleton;
  const singletonOrbitHistogram = [...jointClasses.values()]
    .reduce((histogram, item) => {
      const singletonOrbits = item.occurrenceOrbitSizes
        .filter(size => size === 1).length;
      histogram.set(singletonOrbits, (histogram.get(singletonOrbits) ?? 0) + 1);
      return histogram;
    }, new Map());
  const histogramRows = [...singletonOrbitHistogram]
    .sort(([left], [right]) => left - right)
    .map(([singletonOrbits, jointClassCount]) => ({
      singletonOrbits,
      jointClasses: jointClassCount,
    }));
  const provenanceClassifications = [
    {
      id: 'BASE_FORCED',
      matches: item => item.referenceOccurrenceOrbitSizes.includes(1),
    },
    {
      id: 'REFINEMENT_PRESENT_NOT_BASE_FORCED',
      matches: item => !item.referenceOccurrenceOrbitSizes.includes(1) &&
        item.refinementOccurrenceOrbitSizes.includes(1),
    },
    {
      id: 'RELATIONAL_INTERACTION_ONLY',
      matches: item => !item.referenceOccurrenceOrbitSizes.includes(1) &&
        !item.refinementOccurrenceOrbitSizes.includes(1) &&
        item.occurrenceOrbitSizes.includes(1),
    },
    {
      id: 'NO_SINGLETON_ORBIT',
      matches: item => !item.occurrenceOrbitSizes.includes(1),
    },
  ].map(({ id, matches }) => ({
    id,
    jointClasses: [...jointClasses.values()].filter(matches).length,
  }));
  const interactionOnlyClass = [...jointClasses.values()].find(item =>
    !item.referenceOccurrenceOrbitSizes.includes(1) &&
    !item.refinementOccurrenceOrbitSizes.includes(1) &&
    item.occurrenceOrbitSizes.includes(1));
  const withoutSingletonClass = [...jointClasses.values()].find(item =>
    JSON.stringify(item.referencePartition) ===
      JSON.stringify(interactionOnlyClass.referencePartition) &&
    !item.occurrenceOrbitSizes.includes(1));

  return {
    status: 'BINARY_CONTRACT_NOT_EXHAUSTIVE',
    unchangedPrimitiveVocabulary: [
      'unlabelled reference occurrences',
      'reference equality',
    ],
    arityEnumeration,
    arityEnumerationComplete: arityEnumeration.every(item =>
      item.completeInvariantVerified),
    generalizedCompleteInvariant:
      'reference multiplicity spectrum for each exhaustively tested unlabelled width 1 through 4',
    conditionalRefinement: {
      assumption: {
        id: 'second-unlabelled-equivalence-observation',
        provenance: 'CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED',
        foundationalStatus: 'UNESTABLISHED',
        role: 'measures information erased by the reference-only projection without interpreting the second equivalence as link identity, grouping, order, or semantics',
      },
      occurrenceCount,
      referencePartitionsExamined: partitions.length,
      refinementPartitionsExamined: partitions.length,
      labelledJointStructuresExamined: structures.length,
      occurrencePermutationsExamined: permutations(
        Array.from({ length: occurrenceCount }, (_, index) => index),
      ).length,
      jointQuotientClasses: jointClasses.size,
      encodings,
      encodingAgreement: encodings.every(item =>
        item.completeForEnumeration && item.distinctClasses === jointClasses.size),
      projectionFibres,
      everyProjectionFibreAmbiguous: projectionFibres.every(item =>
        item.jointClasses > 1),
      refinementRecoverableFromBase: projectionFibres.every(item =>
        item.jointClasses === 1),
      classesWithInvariantSingleton,
      classesWithoutInvariantSingleton,
      conditionalSingletonSelectorExists: classesWithInvariantSingleton > 0,
      universalSingletonSelectorExists: classesWithoutInvariantSingleton === 0,
      singletonOrbitHistogram: histogramRows,
      asymmetryProvenance: {
        classifications: provenanceClassifications,
        baseProjectionFibresWithBothOutcomes: projectionFibres
          .filter(item => item.classesWithInvariantSingleton > 0 &&
            item.classesWithoutInvariantSingleton > 0).length,
        baseProjectionFibresForcingSingleton: projectionFibres
          .filter(item =>
            item.singletonPresenceClassification === 'BASE_FORCED').length,
        countermodel: {
          normalizedReferencePartition: interactionOnlyClass.referencePartition,
          referenceOccurrenceOrbitSizes:
            interactionOnlyClass.referenceOccurrenceOrbitSizes,
          withoutSingletonRefinement: {
            normalizedPartition: withoutSingletonClass.refinementPartition,
            refinementOccurrenceOrbitSizes:
              withoutSingletonClass.refinementOccurrenceOrbitSizes,
            jointOccurrenceOrbitSizes: withoutSingletonClass.occurrenceOrbitSizes,
          },
          interactionOnlyRefinement: {
            normalizedPartition: interactionOnlyClass.refinementPartition,
            refinementOccurrenceOrbitSizes:
              interactionOnlyClass.refinementOccurrenceOrbitSizes,
            jointOccurrenceOrbitSizes: interactionOnlyClass.occurrenceOrbitSizes,
          },
        },
      },
      derivationBoundary: derivationBoundaryExperiment(interactionOnlyClass),
    },
    lossAudit: [
      {
        distinction: 'reference names',
        classification: 'INTENTIONAL_QUOTIENT',
        evidence: 'All observations are quotiented by reference renaming.',
      },
      {
        distinction: 'occurrence order',
        classification: 'INTENTIONAL_QUOTIENT',
        evidence: 'All observations are quotiented by every occurrence permutation.',
      },
      {
        distinction: 'width beyond two occurrences',
        classification: 'PROVEN_INFORMATION_LOSS',
        evidence: 'The unchanged equality vocabulary yields three classes at width three and five at width four, which the fixed binary contract cannot express.',
      },
      {
        distinction: 'second equivalence observation',
        classification: 'PROVEN_NOT_RECOVERABLE',
        evidence: 'Every reference-only width-four class is the projection of five to nine inequivalent joint classes.',
      },
      {
        distinction: 'endpoint direction',
        classification: 'NOT_OBSERVED_NOT_DISPROVED',
        evidence: 'Neither the base family nor the conditional refinement names or measures endpoint order.',
      },
      {
        distinction: 'dynamics and time',
        classification: 'NOT_OBSERVED_NOT_DISPROVED',
        evidence: 'Both enumerations are static and contain no transition or temporal observation.',
      },
    ],
  };
}

/**
 * Exhaust the finite consequences of a deliberately weaker observation than
 * the upstream ordered/reified link model: two unlabelled reference
 * occurrences and reference equality. No evaluator or candidate foundation
 * participates. Quotienting every assignment by occurrence permutation and
 * reference renaming discovers what survives representation changes instead
 * of installing source/target roles in advance.
 */
function linkOntologySymmetryExperiment() {
  const occurrenceCount = 2;
  const observations = Array.from(
    { length: occurrenceCount },
    (_, index) => surjectiveAssignments(occurrenceCount, index + 1),
  ).flat();
  const classes = new Map();
  for (const observation of observations) {
    const orbit = observationOrbit(observation);
    const key = JSON.stringify(orbit[0]);
    if (!classes.has(key)) {
      classes.set(key, {
        signature: observationSignature(observation),
        representative: orbit[0],
        orbit,
      });
    }
  }
  const canonicalClasses = [...classes.values()].sort((left, right) =>
    left.representative.join(',').localeCompare(right.representative.join(',')));

  const encodings = [
    {
      id: 'first-occurrence-normal-form',
      encode: firstOccurrenceNormalForm,
    },
    {
      id: 'occurrence-equality-matrix',
      encode: equalityMatrix,
    },
    {
      id: 'reference-multiplicity-spectrum',
      encode: multiplicitySpectrum,
    },
  ];
  const representationAgreement = encodings.map(({ id, encode }) => ({
    encoding: id,
    sameReference: observationSignature([0, 0]),
    distinctReferences: observationSignature([0, 1]),
    invariantAcrossAllActions: observations.every(observation =>
      observationActions(new Set(observation).size).every(action =>
        JSON.stringify(encode(observation)) === JSON.stringify(
          encode(applyObservationAction(observation, action)),
        ))),
    canonicalOutputs: {
      sameReference: encode([0, 0]),
      distinctReferences: encode([0, 1]),
    },
  }));

  const distinctObservation = [0, 1];
  const automorphisms = observationActions(2)
    .filter(action => JSON.stringify(
      applyObservationAction(distinctObservation, action),
    ) === JSON.stringify(distinctObservation));
  const occurrenceAutomorphisms = uniqueVectors(
    automorphisms.map(action => action.occurrencePermutation),
  );
  const occurrenceOrbits = [uniqueVectors(
    occurrenceAutomorphisms.map(permutation => [permutation[0]]),
  ).flat()];
  const selectors = invariantSubsets(occurrenceCount, occurrenceAutomorphisms);
  const selfMaps = assignments(occurrenceCount, occurrenceCount);
  const equivariantSelfMaps = selfMaps
    .filter(mapping => occurrenceAutomorphisms.every(automorphism =>
      mapsCommute(mapping, automorphism)))
    .map(mapping => ({
      id: mapping[0] === 0 && mapping[1] === 1 ? 'identity' : 'swap',
      mapping,
    }));

  const reificationModels = [
    {
      id: 'unreified-occurrence-pair',
      hasLinkIdentity: false,
      occurrences: ['alpha', 'beta'],
    },
    {
      id: 'reified-incidence-star',
      hasLinkIdentity: true,
      linkIdentity: 'link-identity',
      incidences: [
        ['link-identity', 'alpha'],
        ['link-identity', 'beta'],
      ],
    },
  ];
  const reificationCountermodels = reificationModels.map(model => {
    const projectedReferences = model.hasLinkIdentity
      ? model.incidences.map(([, reference]) => reference)
      : model.occurrences;
    return {
      ...model,
      projectedObservation: observationSignature(projectedReferences),
      projection: firstOccurrenceNormalForm(projectedReferences),
    };
  });
  const observationBoundary = observationBoundaryExperiment();

  return {
    schema: 'rml-link-ontology-symmetry-experiment/v4',
    question: 'Which facts survive the binary reference observation, what does its fixed width erase, and can an observation derived from that base create new distinctions?',
    startingContract: {
      id: 'unoriented-binary-reference-observation',
      occurrenceCount,
      assumptions: [
        {
          id: 'two-unlabelled-reference-occurrences',
          provenance: 'EXPERIMENTAL_OBSERVATION_CONTRACT',
          role: 'fixes only the arity of the investigated observation',
        },
        {
          id: 'reference-equality',
          provenance: 'EXPERIMENTAL_OBSERVATION_CONTRACT',
          role: 'permits observation of whether the two occurrences coincide',
        },
      ],
      deliberatelyAbsent: [
        'link identity',
        'endpoint order',
        'source/target roles',
        'passivity',
        'time',
        'execution law',
      ],
    },
    exhaustiveEnumeration: {
      carrierSizesExamined: [1, 2],
      supportRestriction: 'the carrier is exactly the set of observed references; unused references are discarded',
      assignmentsExamined: observations.length,
      groupActionsExamined: [1, 2]
        .reduce((total, size) => total + observationActions(size).length, 0),
      actionApplicationsExamined: observations.reduce(
        (total, observation) =>
          total + observationActions(new Set(observation).size).length,
        0,
      ),
      canonicalClasses,
      completeInvariant: 'equality partition of the two reference occurrences',
    },
    representationAgreement,
    distinctReferenceSymmetry: {
      automorphisms,
      occurrenceOrbits,
      unarySelectorsExamined: 2 ** occurrenceCount,
      invariantUnarySelectors: selectors,
      invariantSingletonSelectorExists: selectors.some(item => item.length === 1),
      totalSelfMapsExamined: selfMaps.length,
      equivariantSelfMaps,
      uniqueEquivariantSelfMap: equivariantSelfMaps.length === 1,
    },
    reificationCountermodels,
    observationBoundary,
    results: [
      {
        id: 'endpoint-direction',
        result: 'NOT_DERIVABLE',
        evidence: 'The distinct-reference class has one occurrence orbit and no automorphism-invariant singleton selector; choosing a source is changed by its occurrence-swap automorphism.',
      },
      {
        id: 'reified-link-identity',
        result: 'REPRESENTATION_DEPENDENT',
        evidence: 'Unreified and reified incidence representations project to the same observation while disagreeing about whether a distinct link identity exists.',
      },
      {
        id: 'reference-equality-pattern',
        result: 'COMPLETE_INVARIANT_FOR_CONTRACT',
        evidence: 'Exhaustive quotienting produces exactly the same-reference and distinct-references classes, and three independent encodings distinguish exactly those classes.',
      },
      {
        id: 'structure-transformation-separation',
        result: 'NON_ABSOLUTE_FOR_SYMMETRIES',
        evidence: 'Identity and endpoint swap are derived as automorphisms of the observation itself; they are structural symmetries, not imported execution steps.',
      },
      {
        id: 'representation-independent-authority',
        result: 'NEGATIVE_CONSTRAINT_ONLY',
        evidence: 'A representation-independent assertion must be constant on each computed orbit, which rejects an intrinsic source/target choice but supplies no positive execution law.',
      },
      {
        id: 'intrinsic-dynamics',
        result: 'NOT_SELECTED',
        evidence: 'Exactly two self-maps commute with every computed symmetry: identity and swap. The static contract does not select either as a dynamic law.',
      },
      {
        id: 'fixed-binary-observation-sufficiency',
        result: 'INSUFFICIENT_OUTSIDE_FIXED_ARITY',
        evidence: 'Without adding an observable, widening from two to three and four unlabelled occurrences yields three and five multiplicity classes. The binary quotient cannot express those distinctions.',
      },
      {
        id: 'conditional-refinement-recoverability',
        result: 'NOT_RECOVERABLE_FROM_BASE_PROJECTION',
        evidence: 'At width four, every reference-only class is the image of five to nine inequivalent structures carrying an uninterpreted second equivalence observation.',
      },
      {
        id: 'conditional-structural-asymmetry',
        result: 'EMERGES_IN_SOME_REFINEMENTS_NOT_UNIVERSAL',
        evidence: 'The singleton-orbit histogram is 20 classes with zero, 5 with one, 7 with two, and 1 with four. Structural asymmetry can therefore emerge, but only five classes select exactly one occurrence orbit and none assigns semantic endpoint meaning.',
      },
      {
        id: 'conditional-asymmetry-provenance',
        result: 'BASE_FORCED_AND_REFINEMENT_DEPENDENT_COMPONENTS_SEPARATED',
        evidence: 'Seven classes inherit a singleton forced by the base [3,1] multiplicity, five acquire one from an independently asymmetric refinement, one acquires four only through the interaction of two individually symmetric relations, and 20 retain none. Four base fibres have both outcomes; only [3,1] forces asymmetry across every refinement.',
      },
      {
        id: 'conditional-interaction-forcedness',
        result: 'SYMMETRY_BREAKING_REQUIRES_INFORMATION_NOT_DERIVED_FROM_BASE',
        evidence: 'All 73 candidate observations at widths one through four that preserve every base symmetry leave the base occurrence orbits unchanged. The interaction-only witness instead changes under a relabelling that leaves its base fixed. Generally, any deterministic derivation commuting with relabelling must preserve every base symmetry.',
      },
      {
        id: 'observation-loss-provenance',
        result: 'CLASSIFIED_NOT_RESOLVED',
        evidence: 'The report separates intentional renaming and order quotients, demonstrated width and projection losses, and distinctions that were never observed. It does not decide which lost distinctions are ontological.',
      },
    ],
    admissibleConclusion: 'Exhaustive enumeration shows that binary equality coincidence is complete only at fixed width two. At tested widths one through four, multiplicity spectra classify the unlabelled base observations. The conditional interaction can break symmetries, but every candidate observation preserving all base symmetries leaves the base occurrence orbits unchanged. The interaction-only witness fails that derivation criterion, so its new distinctions require information not derived from the tested base; they cannot select source, target, link identity, or dynamics.',
    remainingBoundary: 'This experiment proves that the interaction-only asymmetry is not derivable from the tested base alone. It does not define a link ontology, decide whether richer structure belongs intrinsically to links, generalize the finite multiplicity enumeration into an unbounded theorem, promote a singleton orbit to a semantic role, or turn a structural symmetry into execution semantics.',
  };
}

function renameAtoms(term, renaming) {
  if (Array.isArray(term)) return term.map(child => renameAtoms(child, renaming));
  return renaming.get(term) ?? term;
}

function linkRepresentationBoundaryWitness() {
  const sharedInput = ['link', 'left', 'right'];
  const interpretations = [
    {
      id: 'reflexive-observation',
      transition: term => cloneFoundationTerm(term),
    },
    {
      id: 'reverse-endpoints',
      transition: term => [term[0], term[2], term[1]],
    },
  ];
  const renaming = new Map([
    ['left', 'renamed-left'],
    ['right', 'renamed-right'],
  ]);
  return {
    classification: 'ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS',
    investigatedObject: 'host-representation-of-an-ordered-link',
    linkOntologyCovered: false,
    representationExhaustivenessEstablished: false,
    intrinsicTransitionAuthority: 'UNRESOLVED',
    structureTransformationSeparation: 'ASSUMED_BY_EXPERIMENT',
    transitionExternality: 'ASSUMED_BY_EXPERIMENT',
    modelAssumptions: [
      {
        id: 'tagged-ternary-host-value',
        status: 'ASSUMED_NOT_DERIVED',
        role: 'models one link as a host array containing a tag and two references',
      },
      {
        id: 'ordered-endpoint-positions',
        status: 'ASSUMED_NOT_DERIVED',
        role: 'models source and target as distinct ordered array positions',
      },
      {
        id: 'passive-link-value',
        status: 'ASSUMED_NOT_DERIVED',
        role: 'keeps represented structure unchanged until a host function acts',
      },
      {
        id: 'external-transition-function',
        status: 'ASSUMED_NOT_DERIVED',
        role: 'models transformation as a function supplied outside the represented link',
      },
    ],
    sharedInput: cloneFoundationTerm(sharedInput),
    representationSignature: [
      'link-identity',
      'ordered-source-reference',
      'ordered-target-reference',
    ],
    interpretations: interpretations.map(({ id, transition }) => {
      const input = cloneFoundationTerm(sharedInput);
      const output = transition(input);
      const renamedThenTransitioned = transition(renameAtoms(input, renaming));
      const transitionedThenRenamed = renameAtoms(output, renaming);
      return {
        id,
        input,
        output,
        preservesLinkFormation: Array.isArray(output) &&
          output.length === 3 && output[0] === 'link',
        renamingInvariant: isStructurallySame(
          renamedThenTransitioned,
          transitionedThenRenamed,
        ),
      };
    }),
    uniqueTransitionSelected: false,
    admissibleConclusion: 'This host representation signature does not select between the two tested formation-preserving, atom-renaming-invariant transition functions.',
    prohibitedConclusions: [
      'the representation signature exhausts the nature of links',
      'structure and transformation are intrinsically independent',
      'transformation must be external to links',
      'no execution principle can arise from links themselves',
      'links have no intrinsic transition authority',
    ],
    nextSearchConstraint: 'Re-audit the model of a link before drawing an ontological or foundational conclusion; do not add another known calculus as evidence about link ontology.',
  };
}

// Kept as a source-compatible alias for the pre-v3 API. The returned report
// deliberately makes no claim about intrinsic link authority.
const intrinsicLinkAuthorityWitness = linkRepresentationBoundaryWitness;

function cloneFoundationTerm(term) {
  return Array.isArray(term) ? term.map(cloneFoundationTerm) : term;
}

function counterProgram() {
  return [
    ['instruction', 'q0', 'decrement-left', 'failed', 'q1'],
    ['instruction', 'q1', 'increment-left', 'q2', 'unused'],
    ['instruction', 'q2', 'decrement-left', 'q3', 'failed'],
    ['instruction', 'q3', 'decrement-right', 'failed', 'q4'],
    ['instruction', 'q4', 'increment-right', 'q5', 'unused'],
    ['instruction', 'q5', 'decrement-right', 'halt', 'failed'],
  ].reduceRight(
    (tail, instruction) => ['instructions', instruction, tail],
    ['no-instructions'],
  );
}

function expectTerm(actual, expected, context) {
  if (!isStructurallySame(actual, expected)) {
    throw new Error(
      `${context} changed: expected ${JSON.stringify(expected)}, ` +
      `received ${JSON.stringify(actual)}`,
    );
  }
}

function expectProof(result, context) {
  if (!result.ok) throw new Error(`${context} was not derivable`);
  return result.proof;
}

function runRewriteFoundation(source, executionBasis, disabledOperations = []) {
  const registry = LinkedProgramRegistry.fromRml(source, {
    executionBasis,
    disabledOperations,
  });
  const acceptance = Object.fromEntries(
    ACCEPTANCE_OPERATIONS.map(operation => [operation, false]),
  );
  acceptance.load = registry.has('foundation-search-import');

  const imported = registry.reduce(
    'foundation-search-import',
    ['measured-input', 'alpha'],
  );
  expectTerm(imported.term, ['foundation-output', 'alpha'], 'import/rebind/rewrite');
  acceptance.import = true;
  acceptance.rebind = true;
  acceptance.rewrite = true;

  const objectRule = [
    'rewrite',
    ['pair', ['atom', 'identity'], ['meta-variable', 'argument']],
    ['meta-variable', 'argument'],
  ];
  const interpreted = registry.reduce('links-meta-foundation', [
    'meta-verify',
    ['atom', 'alpha'],
    [
      'meta-rewrite',
      ['rules', objectRule, ['no-rules']],
      ['pair', ['atom', 'identity'], ['atom', 'alpha']],
    ],
  ]);
  expectTerm(interpreted.term, 'verified', 'self-interpretation');
  const metaRules = new Set(interpreted.trace.map(step => step.rule));
  for (const rule of [
    'match-variable-reference',
    'substitute-variable-reference',
    'apply-object-rule',
    'verify-object-result',
  ]) {
    if (!metaRules.has(rule)) {
      throw new Error(`self-interpretation did not execute ${rule}`);
    }
  }
  acceptance.match = true;
  acceptance.substitute = true;
  acceptance.verify = true;
  acceptance['self-interpret'] = true;

  const proof = registry.prove(
    'foundation-search-proof',
    ['foundation-derived', 'alpha'],
  );
  expectProof(proof, 'foundation inference');
  acceptance.infer = true;

  const referential = registry.reduce('guarded-referential-links', [
    'observe',
    ['guarded-link', 'proof-knot', 'pulse', 'proof-knot'],
  ]);
  expectTerm(referential.term, [
    'observation',
    'proof-knot',
    'pulse',
    ['resume', 'proof-knot'],
  ], 'guarded referential observation');
  const unguarded = registry.reduce('guarded-referential-links', [
    'observe',
    ['guarded-link', 'left-address', 'pulse', 'right-address'],
  ]);
  expectTerm(unguarded.term, [
    'observe',
    ['guarded-link', 'left-address', 'pulse', 'right-address'],
  ], 'non-referential link must not satisfy the repeated-address guard');

  const described = registry.reduce('links-meta-foundation', [
    'meta-describe',
    objectRule,
  ]);
  expectTerm(described.term, [
    'rule-description',
    ['pattern', objectRule[1]],
    ['replacement', objectRule[2]],
  ], 'self-description');

  const generated = registry.reduce('links-meta-foundation', [
    'meta-generate-and-apply',
    objectRule,
    ['pair', ['atom', 'identity'], ['atom', 'generated']],
  ]);
  expectTerm(
    generated.term,
    ['rewrite-result', ['atom', 'generated']],
    'self-generation',
  );

  const program = counterProgram();
  const machine = registry.reduce('link-register-machine', [
    'machine-start',
    program,
    'q0',
    'zero',
    'zero',
  ]);
  if (!Array.isArray(machine.term) || machine.term[0] !== 'machine-halted') {
    throw new Error('link register machine did not halt');
  }
  expectTerm(machine.term.slice(0, 3), ['machine-halted', 'zero', 'zero'],
    'two-counter simulation');
  const machineRules = new Set(machine.trace.map(step => step.rule));
  for (const instruction of [
    'execute-increment-left',
    'execute-increment-right',
    'execute-decrement-left-nonzero',
    'execute-decrement-left-zero',
    'execute-decrement-right-nonzero',
    'execute-decrement-right-zero',
  ]) {
    if (!machineRules.has(instruction)) {
      throw new Error(`two-counter simulation did not execute ${instruction}`);
    }
  }

  const javascript = registry.reduce('javascript-core', [
    'javascript-execute',
    ['counter-program', program, 'q0'],
  ]);
  const rust = registry.reduce('rust-core', [
    'rust-execute',
    ['counter-program', program, 'q0'],
  ]);
  for (const [language, result] of [['JavaScript', javascript], ['Rust', rust]]) {
    expectTerm(result.term.slice(0, 3), ['machine-halted', 'zero', 'zero'],
      `${language} counter core`);
  }
  expectProof(registry.prove('lean-dependent-core', [
    'lean-has-type',
    ['lean-lambda', 'lean-Type', ['lean-bound', 'zero']],
    ['lean-pi', 'lean-Type', 'lean-Type'],
  ]), 'Lean dependent core');
  expectProof(registry.prove('rocq-dependent-core', [
    'rocq-has-type',
    ['rocq-fun', 'rocq-Type', ['rocq-rel', 'zero']],
    ['rocq-prod', 'rocq-Type', 'rocq-Type'],
  ]), 'Rocq dependent core');

  return {
    acceptance,
    selfDescription: true,
    selfGeneration: true,
    referentialWitness: {
      technique: 'guarded proof knot',
      result: referential.term,
      safetyBoundary: 'emits one finite observation and an opaque continuation; it does not authorize circular proof evidence',
    },
    turingCompleteness: {
      model: 'two-counter Minsky machine',
      completeInstructionBasis: [
        'increment-left',
        'increment-right',
        'decrement-left-with-zero-branch',
        'decrement-right-with-zero-branch',
      ],
      executableCertificate: {
        finalCounters: ['zero', 'zero'],
        linkedTransitionSteps: machine.steps,
        exercisedInstructionFamilies: 4,
        exercisedTransitionCases: 6,
      },
      proofMethod: 'configuration encoding plus instruction-by-instruction simulation; induction on machine steps transfers every finite two-counter run to linked transitions',
      externalTheorem: 'unbounded deterministic two-counter machines are Turing complete',
    },
    languageCores: {
      javascript: 'counter-machine operational core executed',
      rust: 'counter-machine operational core executed',
      lean: 'dependent identity proof checked',
      rocq: 'dependent identity proof checked',
    },
    trace: registry.runtimeSemanticTrace(),
  };
}

const HORN_GOALS = Object.freeze({
  load: ['accepted', 'load'],
  import: ['effective-rewrite', 'foundation-horn', 'measured-input', 'foundation-output'],
  rebind: ['effective-rewrite', 'foundation-horn', 'measured-input', 'foundation-output'],
  match: ['matched', 'foundation-horn', 'foundation-output', 'alpha'],
  substitute: ['substituted', 'foundation-horn', ['foundation-output', 'alpha']],
  rewrite: ['rewritten', 'foundation-horn', ['foundation-output', 'alpha']],
  infer: ['foundation-derived', 'alpha'],
  verify: ['verified', 'foundation-horn', 'alpha'],
  'self-interpret': [
    'self-interpreted',
    'horn-self-rule',
    ['encoded-derived', 'alpha'],
  ],
});

function runHornFoundation(source, disabledOperations = []) {
  const registry = LinkedProgramRegistry.fromRml(source, {
    executionBasis: 'horn-relational',
    disabledOperations,
  });
  const acceptance = {};
  for (const operation of ACCEPTANCE_OPERATIONS) {
    expectProof(
      registry.prove('horn-link-foundation', HORN_GOALS[operation]),
      `Horn ${operation}`,
    );
    acceptance[operation] = true;
  }
  expectProof(registry.prove('horn-link-foundation', [
    'encoded-clause',
    'horn-self-rule',
    ['premise', ['encoded-known', ['meta-variable', 'value']]],
    ['conclusion', ['encoded-derived', ['meta-variable', 'value']]],
  ]), 'Horn self-description');
  expectProof(registry.prove('horn-link-foundation', [
    'generated-clause',
    'copied-clause',
    ['premise', ['encoded-known', ['meta-variable', 'value']]],
    ['conclusion', ['encoded-copied', ['meta-variable', 'value']]],
  ]), 'Horn self-generation');
  const machineProof = expectProof(registry.prove('horn-link-foundation', [
    'turing-completeness-witness',
    'two-counter-machine',
    'zero',
    'zero',
  ]), 'Horn two-counter simulation');
  const machineProofRules = proofRules(machineProof);
  for (const transition of [
    'execute-counter-increment-left',
    'execute-counter-increment-right',
    'execute-counter-decrement-left',
    'execute-counter-decrement-left-zero',
    'execute-counter-decrement-right',
    'execute-counter-decrement-right-zero',
  ]) {
    if (!machineProofRules.has(transition)) {
      throw new Error(`Horn two-counter witness missed ${transition}`);
    }
  }
  const referentialProof = expectProof(registry.prove('horn-link-foundation', [
    'guarded-observation',
    'proof-knot',
    'pulse',
    ['resume', 'proof-knot'],
  ]), 'Horn guarded referential observation');
  if (registry.prove('horn-link-foundation', [
    'guarded-observation',
    'left-address',
    'pulse',
    ['resume', 'right-address'],
  ]).ok) {
    throw new Error('Horn repeated-address guard accepted unequal addresses');
  }
  for (const language of ['javascript', 'rust']) {
    expectProof(registry.prove('horn-link-foundation', [
      'language-core-executes',
      language,
      'two-counter-machine',
    ]), `Horn ${language} counter core`);
  }
  expectProof(registry.prove('horn-link-foundation', [
    'dependent-identity-checks',
    'lean',
    ['lean-lambda', 'lean-Type', ['lean-bound', 'zero']],
    ['lean-pi', 'lean-Type', 'lean-Type'],
  ]), 'Horn Lean dependent core');
  expectProof(registry.prove('horn-link-foundation', [
    'dependent-identity-checks',
    'rocq',
    ['rocq-fun', 'rocq-Type', ['rocq-rel', 'zero']],
    ['rocq-prod', 'rocq-Type', 'rocq-Type'],
  ]), 'Horn Rocq dependent core');

  return {
    acceptance,
    selfDescription: true,
    selfGeneration: true,
    referentialWitness: {
      technique: 'guarded proof knot',
      result: referentialProof.judgement,
      safetyBoundary: 'the repeated address is unified before a finite observation is derived; circular proof evidence remains invalid',
    },
    turingCompleteness: {
      model: 'two-counter Minsky machine encoded as Horn facts',
      completeInstructionBasis: [
        'increment-left',
        'increment-right',
        'decrement-left-with-zero-branch',
        'decrement-right-with-zero-branch',
      ],
      executableCertificate: {
        finalCounters: ['zero', 'zero'],
        proofRule: machineProof.rule,
        proofDepth: proofDepth(machineProof),
        exercisedInstructionFamilies: 4,
        exercisedTransitionCases: 6,
      },
      proofMethod: 'each instruction fact and configuration fact entails exactly the corresponding successor relation; induction on derivation length simulates the machine run',
      externalTheorem: 'unbounded deterministic two-counter machines are Turing complete',
    },
    languageCores: {
      javascript: 'counter-machine operational core checked relationally',
      rust: 'counter-machine operational core checked relationally',
      lean: 'dependent identity proof derived relationally',
      rocq: 'dependent identity proof derived relationally',
    },
    trace: registry.runtimeSemanticTrace(),
  };
}

function proofDepth(proof) {
  return 1 + Math.max(0, ...proof.premises.map(proofDepth));
}

function proofRules(proof, output = new Set()) {
  output.add(proof.rule);
  for (const premise of proof.premises) proofRules(premise, output);
  return output;
}

function removalExperiments(source, mechanism, operations) {
  return operations.map(operation => {
    try {
      if (mechanism === 'horn-relational') {
        runHornFoundation(source, [operation]);
      } else {
        runRewriteFoundation(source, mechanism, [operation]);
      }
      return {
        operation,
        classification: 'DERIVABLE',
        baselinePreserved: true,
        observedFailure: '',
      };
    } catch (error) {
      return {
        operation,
        classification: 'INDEPENDENT_FOR_CANDIDATE_WORKLOAD',
        baselinePreserved: false,
        observedFailure: String(error.message),
      };
    }
  });
}

function assertCompleteAcceptance(result, candidate) {
  const missing = ACCEPTANCE_OPERATIONS.filter(operation => !result.acceptance[operation]);
  if (missing.length > 0) {
    throw new Error(`${candidate} missed acceptance operations: ${missing.join(', ')}`);
  }
}

function trustCoverage(trace, semanticOperations) {
  const documented = new Set([...semanticOperations, ...NON_SEMANTIC_OPERATIONS]);
  const undocumentedOperations = trace.observedOperations
    .filter(operation => !documented.has(operation));
  return {
    observedPaths: trace.observedPaths.length,
    observedOperations: trace.observedOperations.length,
    undocumentedAuthorityPaths: undocumentedOperations,
    complete: undocumentedOperations.length === 0,
  };
}

function candidateRecord({
  id,
  title,
  semanticMechanism,
  representation,
  primitiveLaws,
  transitionMechanism,
  authority,
  provenance,
  hostBoundary,
  formationBoundary,
  controlBoundary,
  selfDescription,
  selfInterpretation,
  selfGeneration,
  run,
  removal,
  hostSelfDuplication,
  externalSemanticSources,
}) {
  assertCompleteAcceptance(run, id);
  const coverage = trustCoverage(run.trace, primitiveLaws.map(law => law.id));
  if (!coverage.complete) {
    throw new Error(`${id} has undocumented authority: ${coverage.undocumentedAuthorityPaths}`);
  }
  const linkedCapabilities = ACCEPTANCE_OPERATIONS.length;
  const hostCapabilities = hostSelfDuplication;
  const comparisonExclusionReasons = [];
  if (linkedCapabilities !== linkedCapabilities + hostCapabilities) {
    comparisonExclusionReasons.push('INCOMPLETE_SELF_HOSTING_CLOSURE');
  }
  if (hostSelfDuplication !== 0) {
    comparisonExclusionReasons.push('HOST_SELF_SEMANTIC_DUPLICATION');
  }
  if (externalSemanticSources !== 0) {
    comparisonExclusionReasons.push('EXTERNAL_SEMANTIC_SOURCE_DESCRIPTION');
  }
  if (!coverage.complete) {
    comparisonExclusionReasons.push('INCOMPLETE_RUNTIME_TRUST_COVERAGE');
  }
  return {
    candidate: id,
    title,
    classification: 'ACCEPTED_FOR_EXECUTABLE_SCOPE',
    semanticMechanism,
    representation,
    primitiveSemanticLaws: primitiveLaws,
    transitionMechanism,
    transitionAuthority: authority,
    sourceProvenance: provenance,
    hostRuntimeBoundary: hostBoundary,
    formationAdmissibilityBoundary: formationBoundary,
    executionControlBoundary: controlBoundary,
    selfDescriptionMechanism: selfDescription,
    selfInterpretationMechanism: selfInterpretation,
    selfGenerationMechanism: selfGeneration,
    referentialWitness: run.referentialWitness,
    externalSemanticInformation: primitiveLaws.length,
    derivedSemanticInformation: ACCEPTANCE_OPERATIONS,
    objectSpecificHostKnowledge: [],
    acceptanceWorkload: run.acceptance,
    turingCompleteness: run.turingCompleteness,
    languageCores: run.languageCores ?? null,
    measurements: {
      independentExternalSemanticInformation: removal
        .filter(experiment => !experiment.baselinePreserved).length,
      hostSemanticOperations: primitiveLaws.length,
      externalSemanticSourceDescriptions: externalSemanticSources,
      hostSelfSemanticDuplication: hostSelfDuplication,
      selfHostingClosure: {
        linkedCapabilities,
        hostCapabilities,
        totalCapabilities: linkedCapabilities + hostCapabilities,
        ratio: `${linkedCapabilities}/${linkedCapabilities + hostCapabilities}`,
      },
      foundationCompression: `${primitiveLaws.length}/8`,
      runtimeTrustCoverage: coverage,
      objectSpecificHostSemantics: 0,
      undocumentedAuthorityPaths: coverage.undocumentedAuthorityPaths,
    },
    comparisonEligibility: {
      eligible: comparisonExclusionReasons.length === 0,
      exclusionReasons: comparisonExclusionReasons,
    },
    ontologyRole: 'EXECUTABLE_CONTROL',
    constrainsOntologySearch: false,
    foundationalEligibility: {
      eligible: false,
      exclusionReasons: [
        'LINK_ONTOLOGY_UNRESOLVED',
        'PRIMITIVE_CATEGORY_PROVENANCE_UNESTABLISHED',
        'STRUCTURE_TRANSFORMATION_RELATION_UNRESOLVED',
        'INTRINSIC_SEMANTIC_AUTHORITY_UNRESOLVED',
        'COMPARATIVE_MINIMALITY_UNRESOLVED',
      ],
    },
    eliminationExperiments: removal,
    equivalentTo: null,
    equivalenceStatus: 'NOT_CLAIMED_WITHOUT_EXECUTABLE_BISIMULATION',
    rejectedBecause: null,
  };
}

/**
 * Execute three independently sourced semantic mechanisms and return their
 * architecture-neutral comparison.  Success establishes the finite workload
 * and universal-machine simulation, not global minimality or implementation
 * of complete production language ecosystems.
 */
function foundationSearchReport(universalSource, alternativeSource) {
  const source = `${universalSource}\n${alternativeSource}`;
  const candidateA = runRewriteFoundation(source, 's-k');
  const candidateB = runRewriteFoundation(source, 'direct-structural');
  const candidateC = runHornFoundation(source);
  const aOperations = [
    { id: 'contract-s-link', law: 'S x y z -> x z (y z)' },
    { id: 'contract-k-link', law: 'K x y -> x' },
  ];
  const bOperations = DIRECT_SEMANTIC_OPERATIONS.map(id => ({
    id,
    law: `direct structural ${id}`,
  }));
  const cOperations = HORN_SEMANTIC_OPERATIONS.map(id => ({
    id,
    law: `monotone Horn ${id}`,
  }));
  const candidates = [
    candidateRecord({
      id: 'candidate-a-closed-s-k',
      title: 'Closed linked terms over S/K contraction',
      semanticMechanism: 'normal-order contraction of closed binary-link terms',
      representation: 'addressed-doublet S/K DAG compiled from link source',
      primitiveLaws: aOperations,
      transitionMechanism: 'contract the leftmost S or K redex',
      authority: 'the two external contraction equations',
      provenance: 'externally primitive equations over a source represented as addressed links',
      hostBoundary: 'S/K contraction only; linked terms define all acceptance services',
      formationBoundary: 'closed generated term plus checked source/artifact parity',
      controlBoundary: 'external contraction and resource bound',
      selfDescription: 'meta-describe linked rewrite relation',
      selfInterpretation: 'links-meta-foundation object matcher/substituter',
      selfGeneration: 'meta-generate-and-apply linked rewrite relation',
      run: candidateA,
      removal: removalExperiments(source, 's-k', aOperations.map(item => item.id)),
      hostSelfDuplication: 0,
      externalSemanticSources: 0,
    }),
    candidateRecord({
      id: 'candidate-b-direct-structural',
      title: 'Direct structural link rewriting',
      semanticMechanism: 'ordered structural pattern rewriting plus bounded saturation',
      representation: 'LiNo pattern, replacement, import, fact, and inference links',
      primitiveLaws: bOperations,
      transitionMechanism: 'match a rule at the leftmost sublink and instantiate its replacement',
      authority: 'ordered linked rules interpreted by the direct structural transition',
      provenance: 'independent pre-S/K reference mechanism retained as a falsifiable control',
      hostBoundary: 'matching, binding, instantiation, traversal, import resolution, and saturation',
      formationBoundary: 'well-bound replacement and conclusion variables; acyclic imports',
      controlBoundary: 'external leftmost order, cycle detection, and resource bounds',
      selfDescription: 'same meta-describe link rules, executed without combinators',
      selfInterpretation: 'same links-meta-foundation object interpreter, executed directly',
      selfGeneration: 'same meta-generate-and-apply link rules, executed directly',
      run: candidateB,
      removal: removalExperiments(
        source,
        'direct-structural',
        DIRECT_SEMANTIC_OPERATIONS,
      ),
      hostSelfDuplication: DIRECT_SEMANTIC_OPERATIONS.length,
      externalSemanticSources: 1,
    }),
    candidateRecord({
      id: 'candidate-c-horn-relational',
      title: 'Monotone Horn links',
      semanticMechanism: 'premise unification and monotone fixed-point fact derivation',
      representation: 'facts and Horn clauses whose predicates and terms are links',
      primitiveLaws: cOperations,
      transitionMechanism: 'insert every novel instantiated conclusion whose premises unify',
      authority: 'the clause set and monotone saturation schedule',
      provenance: 'independently designed relational semantics with no S/K transition or bracket-abstraction machinery',
      hostBoundary: 'unification, instantiation, novel-fact insertion, and fair finite saturation',
      formationBoundary: 'range-restricted Horn conclusions and explicit finite bounds',
      controlBoundary: 'external saturation rounds and fact bound',
      selfDescription: 'encoded-clause facts describe the active clause shape',
      selfInterpretation: 'interpret-encoded-clause derives an encoded conclusion',
      selfGeneration: 'clause-schema derives a new encoded clause description',
      run: candidateC,
      removal: removalExperiments(
        source,
        'horn-relational',
        HORN_SEMANTIC_OPERATIONS,
      ),
      hostSelfDuplication: HORN_SEMANTIC_OPERATIONS.length,
      externalSemanticSources: 1,
    }),
  ];
  const comparisonCandidates = candidates.filter(candidate =>
    candidate.comparisonEligibility.eligible);
  const comparisonCohortSufficient = comparisonCandidates.length >= 2;
  const smallestMeasuredExternalLawCount = comparisonCohortSufficient
    ? Math.min(...comparisonCandidates.map(candidate =>
      candidate.externalSemanticInformation))
    : null;

  return {
    schema: 'rml-alternative-foundation-search/v8',
    foundationStatus: 'OPEN',
    question: 'Which representation and semantic assumptions does each executable links model introduce, and which comparisons remain justified?',
    candidateDesignConstraint: 'Candidates B and C define no S/K transition or bracket-abstraction machinery and execute without the combinator source compiler; language terms remain opaque data.',
    ontologySearch: ontologySearchAudit(),
    ontologyExperiment: linkOntologySymmetryExperiment(),
    acceptanceOperations: ACCEPTANCE_OPERATIONS,
    comparisonScope: 'EXECUTION_ARCHITECTURE_ONLY_NOT_ONTOLOGY',
    comparisonStatus: comparisonCohortSufficient
      ? 'COMPARABLE_COHORT_ESTABLISHED_NO_GLOBAL_MINIMALITY_CLAIM'
      : 'OPEN_NO_COMPARABLE_ALTERNATIVE',
    proofBoundary: 'The report proves the finite acceptance workload, an instruction-by-instruction simulation of the complete two-counter-machine basis, the binary symmetry quotient, the width-one-through-four multiplicity quotients, the conditional width-four refinement fibres, and the symmetry non-creation result for observations derived from the tested base. Turing completeness additionally uses the standard universality theorem for unbounded deterministic two-counter machines. The observation evidence does not establish link ontology, identify richer intrinsic link structure, turn a structural symmetry into execution semantics, permit the executable controls to constrain ontology, or claim complete Lean, Rocq, Rust, or JavaScript production implementations.',
    candidates,
    representationBoundaryWitness: linkRepresentationBoundaryWitness(),
    comparisonCohort: {
      eligibilityRequirements: [
        'complete finite acceptance workload',
        'full links-defined acceptance closure',
        'zero host/self semantic duplication',
        'zero external semantic source descriptions',
        'complete runtime trust coverage',
      ],
      minimumCandidates: 2,
      eligibleCandidates: comparisonCandidates.map(candidate => candidate.candidate),
      excludedCandidates: candidates
        .filter(candidate => !candidate.comparisonEligibility.eligible)
        .map(candidate => ({
          candidate: candidate.candidate,
          reasons: candidate.comparisonEligibility.exclusionReasons,
        })),
      sufficient: comparisonCohortSufficient,
      asymmetricRankingPermitted: false,
    },
    conclusion: {
      smallestMeasuredExternalLawCount,
      smallestMeasuredCandidates: comparisonCohortSufficient
        ? comparisonCandidates
          .filter(candidate =>
            candidate.externalSemanticInformation === smallestMeasuredExternalLawCount)
          .map(candidate => candidate.candidate)
        : [],
      selectedFoundation: null,
      globallyMinimal: false,
      intrinsicTransitionAuthority: 'UNRESOLVED',
      representationWitnessConclusion: 'The tested ordered-link host representation does not select between the two witnessed transitions.',
      ontologyExperimentConclusion: 'Binary equality coincidence is complete only at fixed width two. Across tested widths one through four, multiplicity spectra classify the base observation. The width-four refinement separates 7 base-forced, 5 refinement-present, 1 interaction-only, and 20 symmetric classes. Every tested candidate that preserves all base symmetries leaves the base occurrence orbits unchanged, while the interaction-only witness breaks a base-preserving relabelling; its distinction is therefore not derived from the tested base.',
      pathDependenceResult: 'The same workload survives two independently sourced non-combinator mechanisms, but only S/K currently meets the comparison-eligibility gate. No minimum or winner is reported from that asymmetric cohort.',
    },
  };
}

export {
  ACCEPTANCE_OPERATIONS,
  DIRECT_SEMANTIC_OPERATIONS,
  HORN_SEMANTIC_OPERATIONS,
  foundationSearchReport,
  intrinsicLinkAuthorityWitness,
  linkOntologySymmetryExperiment,
  linkRepresentationBoundaryWitness,
};
