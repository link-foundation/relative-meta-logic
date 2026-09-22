// Independent finite probe for the observation-boundary follow-up to issue 183.
// This file deliberately does not import the production foundation report.

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => {
    const rest = values.filter((_, candidate) => candidate !== index);
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

function restrictedGrowthPartitions(width, prefix = []) {
  if (prefix.length === width) return [prefix];
  const largest = prefix.length === 0 ? -1 : Math.max(...prefix);
  return Array.from({ length: largest + 2 }, (_, value) => value)
    .flatMap(value => restrictedGrowthPartitions(width, [...prefix, value]));
}

function normalize(values) {
  const names = new Map();
  return values.map(value => {
    if (!names.has(value)) names.set(value, names.size);
    return names.get(value);
  });
}

function spectrum(partition) {
  const counts = new Map();
  for (const value of partition) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.values()].sort((left, right) => right - left);
}

function permutePartition(partition, permutation) {
  return normalize(permutation.map(index => partition[index]));
}

function jointKey(referencePartition, refinementPartition, permutation) {
  return JSON.stringify([
    permutePartition(referencePartition, permutation),
    permutePartition(refinementPartition, permutation),
  ]);
}

const widths = Array.from({ length: 4 }, (_, index) => index + 1)
  .map(width => ({
    width,
    partitions: restrictedGrowthPartitions(width),
  }));

const width = 4;
const occurrencePermutations = permutations(
  Array.from({ length: width }, (_, index) => index),
);
const partitions = restrictedGrowthPartitions(width);
const jointClasses = new Map();

function occurrenceOrbitSizes(...relations) {
  const relabellings = permutations(
    Array.from({ length: relations[0].length }, (_, index) => index),
  );
  const identity = JSON.stringify(relations.map(normalize));
  const automorphisms = relabellings.filter(permutation =>
    JSON.stringify(relations.map(relation =>
      permutePartition(relation, permutation))) === identity);
  const occurrenceOrbits = [];
  const pending = new Set(
    Array.from({ length: relations[0].length }, (_, index) => index),
  );
  while (pending.size > 0) {
    const seed = pending.values().next().value;
    const orbitMembers = new Set(
      automorphisms.map(permutation => permutation[seed]),
    );
    for (const member of orbitMembers) pending.delete(member);
    occurrenceOrbits.push([...orbitMembers].sort((left, right) => left - right));
  }
  return occurrenceOrbits
    .map(orbitMembers => orbitMembers.length)
    .sort((left, right) => right - left);
}

function basePreservingRelabellings(basePattern) {
  return permutations(
    Array.from({ length: basePattern.length }, (_, index) => index),
  ).filter(permutation =>
    JSON.stringify(permutePartition(basePattern, permutation)) ===
      JSON.stringify(basePattern));
}

function canonicalAddressableLinkPattern(addressPattern) {
  const referenceIndexes = addressPattern.slice(1).map((_, index) => index + 1);
  return permutations(referenceIndexes)
    .map(permutation => normalize([
      addressPattern[0],
      ...permutation.map(index => addressPattern[index]),
    ]))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0];
}

function addressableDescriptor(addressPattern) {
  const references = addressPattern.slice(1);
  return {
    referenceMultiplicitySpectrum: spectrum(references),
    directSelfReferenceMultiplicity: references
      .filter(address => address === addressPattern[0]).length,
  };
}

const startingRepresentationAudit = widths.map(({ width: observationWidth }) => {
  const addressableClasses = new Map();
  for (const addressPattern of restrictedGrowthPartitions(observationWidth + 1)) {
    const canonical = canonicalAddressableLinkPattern(addressPattern);
    addressableClasses.set(JSON.stringify(canonical), canonical);
  }
  const fibres = new Map();
  for (const addressPattern of addressableClasses.values()) {
    const projection = spectrum(addressPattern.slice(1)).join('+');
    if (!fibres.has(projection)) fibres.set(projection, []);
    fibres.get(projection).push(addressPattern);
  }
  const histogram = new Map();
  for (const fibre of fibres.values()) {
    histogram.set(fibre.length, (histogram.get(fibre.length) ?? 0) + 1);
  }
  const classesWithDirectSelfReference = [...addressableClasses.values()]
    .filter(pattern => pattern.slice(1).includes(pattern[0])).length;
  return {
    occurrenceCount: observationWidth,
    referenceOnlyClasses: fibres.size,
    addressableLinkClasses: addressableClasses.size,
    classesWithNoDirectSelfReference:
      addressableClasses.size - classesWithDirectSelfReference,
    classesWithDirectSelfReference,
    projectionFibreHistogram: [...histogram]
      .sort(([left], [right]) => left - right)
      .map(([addressableClasses, referenceOnlyClasses]) => ({
        addressableClasses,
        referenceOnlyClasses,
      })),
  };
});

const quotientAuditEnumeration = widths.map(({ width: observationWidth }) => {
  const orderedPatterns = restrictedGrowthPartitions(observationWidth + 1);
  const unlabelledClasses = new Set(orderedPatterns.map(pattern =>
    JSON.stringify(canonicalAddressableLinkPattern(pattern))));
  return {
    occurrenceCount: observationWidth,
    orderedEqualityClassesAfterAddressRenaming: orderedPatterns.length,
    unlabelledAddressableClasses: unlabelledClasses.size,
    classesCollapsedByOccurrencePermutation:
      orderedPatterns.length - unlabelledClasses.size,
  };
});
const descriptorToClasses = new Map();
for (const { width: observationWidth } of widths) {
  for (const pattern of restrictedGrowthPartitions(observationWidth + 1)) {
    const descriptor = JSON.stringify(addressableDescriptor(pattern));
    const canonical = JSON.stringify(canonicalAddressableLinkPattern(pattern));
    if (!descriptorToClasses.has(descriptor)) descriptorToClasses.set(descriptor, new Set());
    descriptorToClasses.get(descriptor).add(canonical);
  }
}

for (const referencePartition of partitions) {
  for (const refinementPartition of partitions) {
    const orbit = occurrencePermutations
      .map(permutation => jointKey(
        referencePartition,
        refinementPartition,
        permutation,
      ))
      .sort();
    const canonical = orbit[0];
    if (jointClasses.has(canonical)) continue;

    jointClasses.set(canonical, {
      referencePartition,
      refinementPartition,
      referenceSpectrum: spectrum(referencePartition).join('+'),
      refinementSpectrum: spectrum(refinementPartition).join('+'),
      referenceOccurrenceOrbitSizes: occurrenceOrbitSizes(referencePartition),
      refinementOccurrenceOrbitSizes: occurrenceOrbitSizes(refinementPartition),
      occurrenceOrbitSizes: occurrenceOrbitSizes(
        referencePartition,
        refinementPartition,
      ),
    });
  }
}

const projectionFibres = new Map();
for (const jointClass of jointClasses.values()) {
  if (!projectionFibres.has(jointClass.referenceSpectrum)) {
    projectionFibres.set(jointClass.referenceSpectrum, []);
  }
  projectionFibres.get(jointClass.referenceSpectrum).push(jointClass);
}

const jointClassValues = [...jointClasses.values()];
const singletonOrbitHistogram = new Map();
for (const jointClass of jointClassValues) {
  const singletonOrbits = jointClass.occurrenceOrbitSizes
    .filter(size => size === 1).length;
  singletonOrbitHistogram.set(
    singletonOrbits,
    (singletonOrbitHistogram.get(singletonOrbits) ?? 0) + 1,
  );
}
const interactionOnlyClass = jointClassValues.find(jointClass =>
  !jointClass.referenceOccurrenceOrbitSizes.includes(1) &&
  !jointClass.refinementOccurrenceOrbitSizes.includes(1) &&
  jointClass.occurrenceOrbitSizes.includes(1));
const withoutSingletonClass = jointClassValues.find(jointClass =>
  JSON.stringify(jointClass.referencePartition) ===
    JSON.stringify(interactionOnlyClass.referencePartition) &&
  !jointClass.occurrenceOrbitSizes.includes(1));

const derivationEnumeration = widths.map(({ width: observationWidth, partitions: items }) => {
  let baseSymmetryPreservingCandidates = 0;
  let preservingCandidatesChangingOccurrenceOrbits = 0;
  for (const basePattern of items) {
    const relabellings = basePreservingRelabellings(basePattern);
    const baseOrbits = occurrenceOrbitSizes(basePattern);
    for (const candidatePattern of items) {
      const preservesBaseSymmetry = relabellings.every(permutation =>
        JSON.stringify(permutePartition(candidatePattern, permutation)) ===
          JSON.stringify(candidatePattern));
      if (!preservesBaseSymmetry) continue;
      baseSymmetryPreservingCandidates += 1;
      if (JSON.stringify(occurrenceOrbitSizes(basePattern, candidatePattern)) !==
          JSON.stringify(baseOrbits)) {
        preservingCandidatesChangingOccurrenceOrbits += 1;
      }
    }
  }
  const candidateObservationsExamined = items.length ** 2;
  return {
    occurrenceCount: observationWidth,
    basePatternsExamined: items.length,
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

console.log(JSON.stringify({
  startingRepresentationAudit: {
    finiteEnumeration: startingRepresentationAudit,
    countermodel: {
      directSelfLink: [0, 0, 1],
      freshExternalLink: [0, 1, 2],
      sharedProjection: [1, 1],
    },
    consequence:
      'REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY',
    quotientAudit: {
      finiteEnumeration: quotientAuditEnumeration,
      addressRenamingCompleteInvariantVerified: widths.every(
        ({ width: observationWidth }) => {
          const patterns = restrictedGrowthPartitions(observationWidth + 1);
          const matrices = new Set(patterns.map(pattern => JSON.stringify(
            pattern.flatMap(left => pattern.map(right => Number(left === right))),
          )));
          return matrices.size === patterns.length;
        },
      ),
      transformations: [
        {
          transformation: 'global address renaming',
          classification:
            'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
        },
        {
          transformation: 'reference-occurrence permutation',
          classification: 'UNESTABLISHED_EQUIVALENCE',
        },
      ],
      occurrencePermutationCountermodel: {
        firstOrderedPattern: [0, 0, 1],
        secondOrderedPattern: [0, 1, 0],
        sameUnderAddressRenamingAlone: false,
        sameAfterOccurrencePermutation:
          JSON.stringify(canonicalAddressableLinkPattern([0, 0, 1])) ===
            JSON.stringify(canonicalAddressableLinkPattern([0, 1, 0])),
      },
      minimalFaithfulDescriptor: {
        fields: [
          'referenceMultiplicitySpectrum',
          'directSelfReferenceMultiplicity',
        ],
        finiteEnumerationAgreement: [...descriptorToClasses.values()]
          .every(classes => classes.size === 1) &&
            descriptorToClasses.size === quotientAuditEnumeration
              .reduce((total, item) => total + item.unlabelledAddressableClasses, 0),
      },
      occurrencePermutationIntrinsic: 'UNRESOLVED',
    },
  },
  arityBoundary: widths.map(({ width: observationWidth, partitions: items }) => ({
    occurrenceCount: observationWidth,
    labelledPartitions: items.length,
    quotientClasses: new Set(items.map(item => spectrum(item).join('+'))).size,
    multiplicitySpectra: [...new Set(items.map(item => spectrum(item).join('+')))].sort(),
  })),
  conditionalRefinement: {
    occurrenceCount: width,
    referencePartitions: partitions.length,
    refinementPartitions: partitions.length,
    labelledPairs: partitions.length ** 2,
    jointQuotientClasses: jointClasses.size,
    projectionFibres: [...projectionFibres.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([referenceSpectrum, items]) => ({
        referenceSpectrum,
        jointClasses: items.length,
        refinementSpectra: [...new Set(items.map(item => item.refinementSpectrum))].sort(),
        classesWithInvariantSingleton: items
          .filter(item => item.occurrenceOrbitSizes.includes(1)).length,
        classesWithoutInvariantSingleton: items
          .filter(item => !item.occurrenceOrbitSizes.includes(1)).length,
      })),
    classesWithInvariantSingleton: jointClassValues
      .filter(item => item.occurrenceOrbitSizes.includes(1)).length,
    classesWithoutInvariantSingleton: jointClassValues
      .filter(item => !item.occurrenceOrbitSizes.includes(1)).length,
    singletonOrbitHistogram: [...singletonOrbitHistogram]
      .sort(([left], [right]) => left - right)
      .map(([singletonOrbits, classes]) => ({ singletonOrbits, classes })),
    asymmetryProvenance: {
      baseForcedClasses: jointClassValues.filter(item =>
        item.referenceOccurrenceOrbitSizes.includes(1)).length,
      refinementPresentNotBaseForcedClasses: jointClassValues.filter(item =>
        !item.referenceOccurrenceOrbitSizes.includes(1) &&
        item.refinementOccurrenceOrbitSizes.includes(1)).length,
      relationalInteractionOnlyClasses: jointClassValues.filter(item =>
        !item.referenceOccurrenceOrbitSizes.includes(1) &&
        !item.refinementOccurrenceOrbitSizes.includes(1) &&
        item.occurrenceOrbitSizes.includes(1)).length,
      noSingletonOrbitClasses: jointClassValues.filter(item =>
        !item.occurrenceOrbitSizes.includes(1)).length,
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
    derivationBoundary: {
      finiteEnumeration: derivationEnumeration,
      consequence: 'BASE_DERIVATION_CANNOT_CREATE_NEW_OCCURRENCE_DISTINCTIONS',
      interactionOnlyCounterexample: {
        basePattern,
        conditionalPattern,
        basePreservingRelabelling,
        relabelledBasePattern: permutePartition(
          basePattern,
          basePreservingRelabelling,
        ),
        relabelledConditionalPattern: permutePartition(
          conditionalPattern,
          basePreservingRelabelling,
        ),
      },
    },
  },
}, null, 2));
