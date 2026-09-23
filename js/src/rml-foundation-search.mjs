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
  if (width === 0) return [[]];
  const partitions = [];
  const visit = (partition, maximum) => {
    if (partition.length === width) {
      partitions.push(partition);
      return;
    }
    for (let value = 0; value <= maximum + 1; value += 1) {
      visit([...partition, value], Math.max(maximum, value));
    }
  };
  visit([0], 0);
  return partitions;
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

function canonicalAddressableLinkSignature(addressPattern) {
  const referenceIndexes = addressPattern.slice(1).map((_, index) => index + 1);
  return permutations(referenceIndexes)
    .map(permutation => JSON.stringify(firstOccurrenceNormalForm([
      addressPattern[0],
      ...permutation.map(index => addressPattern[index]),
    ])))
    .sort()[0];
}

function addressableLinkDescriptor(addressPattern) {
  const references = addressPattern.slice(1);
  return {
    referenceMultiplicitySpectrum: multiplicitySpectrum(references),
    directSelfReferenceMultiplicity: references
      .filter(address => address === addressPattern[0]).length,
  };
}

function selfIncidenceByReferenceSlot(addressPattern) {
  return addressPattern.slice(1)
    .map(referenceAddress => referenceAddress === addressPattern[0]);
}

function orderedAddressableLinkDescriptor(addressPattern) {
  const references = addressPattern.slice(1);
  return {
    referenceEqualityMatrix: equalityMatrix(references),
    selfIncidenceByReferenceSlot:
      selfIncidenceByReferenceSlot(addressPattern),
  };
}

function slotwiseSelfIncidenceAudit() {
  const finiteEnumeration = [1, 2, 3, 4].map(occurrenceCount => {
    const orderedPatterns = setPartitions(occurrenceCount + 1);
    const classes = new Map();
    for (const addressPattern of orderedPatterns) {
      const selfIncidence = selfIncidenceByReferenceSlot(addressPattern);
      const key = JSON.stringify(selfIncidence);
      if (!classes.has(key)) {
        classes.set(key, {
          selfIncidenceByReferenceSlot: selfIncidence,
          orderedEqualityClasses: 0,
        });
      }
      classes.get(key).orderedEqualityClasses += 1;
    }
    return {
      occurrenceCount,
      selfIncidencePatterns: classes.size,
      orderedEqualityClasses: orderedPatterns.length,
      classesBySelfIncidence: [...classes.values()]
        .sort((left, right) => compareVectors(
          left.selfIncidenceByReferenceSlot,
          right.selfIncidenceByReferenceSlot,
        )),
    };
  });
  const orderedPatterns = [1, 2, 3, 4]
    .flatMap(occurrenceCount => setPartitions(occurrenceCount + 1));
  const addressRenamingInvariantVerified = orderedPatterns.every(addressPattern => {
    const addresses = [...new Set(addressPattern)];
    const expected = selfIncidenceByReferenceSlot(addressPattern);
    return permutations(addresses).every(permutedAddresses => {
      const renaming = new Map(addresses.map(
        (address, index) => [address, permutedAddresses[index]],
      ));
      return JSON.stringify(selfIncidenceByReferenceSlot(
        addressPattern.map(address => renaming.get(address)),
      )) === JSON.stringify(expected);
    });
  });
  const permutationChecks = orderedPatterns.flatMap(addressPattern => {
    const references = addressPattern.slice(1);
    const selfIncidence = selfIncidenceByReferenceSlot(addressPattern);
    return permutations(references.map((_, index) => index))
      .map(permutation => {
        const permutedPattern = [
          addressPattern[0],
          ...permutation.map(index => references[index]),
        ];
        const permutedIncidence = selfIncidenceByReferenceSlot(permutedPattern);
        const expected = permutation.map(index => selfIncidence[index]);
        return {
          equivariant:
            JSON.stringify(permutedIncidence) === JSON.stringify(expected),
          invariant:
            JSON.stringify(permutedIncidence) === JSON.stringify(selfIncidence),
        };
      });
  });
  const descriptorToSignatures = new Map();
  for (const addressPattern of orderedPatterns) {
    const descriptor = JSON.stringify(
      orderedAddressableLinkDescriptor(addressPattern),
    );
    if (!descriptorToSignatures.has(descriptor)) {
      descriptorToSignatures.set(descriptor, new Set());
    }
    descriptorToSignatures.get(descriptor).add(
      JSON.stringify(firstOccurrenceNormalForm(addressPattern)),
    );
  }
  const firstOrderedPattern = [0, 0, 1];
  const secondOrderedPattern = [0, 1, 0];
  const firstSelfIncidence = selfIncidenceByReferenceSlot(firstOrderedPattern);
  const secondSelfIncidence = selfIncidenceByReferenceSlot(secondOrderedPattern);

  return {
    status: 'CLASSIFIED_PER_ORDERED_REFERENCE_SLOT',
    provenance: 'ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT',
    predicate:
      'selfIncidenceByReferenceSlot[i] = (referenceAddress[i] === linkAddress)',
    finiteEnumeration,
    everyBooleanSlotPatternRealized: finiteEnumeration.every(item =>
      item.selfIncidencePatterns === 2 ** item.occurrenceCount),
    addressRenamingInvariantVerified,
    occurrencePermutationEquivariantVerified:
      permutationChecks.every(check => check.equivariant),
    occurrencePermutationInvariant:
      permutationChecks.every(check => check.invariant),
    countermodel: {
      firstOrderedPattern,
      secondOrderedPattern,
      firstSelfIncidenceByReferenceSlot: firstSelfIncidence,
      secondSelfIncidenceByReferenceSlot: secondSelfIncidence,
      sameSelfIncidenceMultiplicity:
        firstSelfIncidence.filter(Boolean).length ===
          secondSelfIncidence.filter(Boolean).length,
      sameSlotwiseSelfIncidence:
        JSON.stringify(firstSelfIncidence) === JSON.stringify(secondSelfIncidence),
      sameAfterOccurrencePermutation:
        canonicalAddressableLinkSignature(firstOrderedPattern) ===
          canonicalAddressableLinkSignature(secondOrderedPattern),
    },
    orderedFaithfulDescriptor: {
      status: 'COMPLETE_INVARIANT_FOR_ORDERED_ADDRESS_EQUALITY_CONTRACT',
      fields: [
        'referenceEqualityMatrix',
        'selfIncidenceByReferenceSlot',
      ],
      finiteEnumerationAgreement: [...descriptorToSignatures.values()]
        .every(signatures => signatures.size === 1) &&
          descriptorToSignatures.size === orderedPatterns.length,
      generalArgument:
        'Reference equality classifies the ordered references up to address renaming, while the slotwise self-incidence mask identifies exactly which reference class, if any, is the link address.',
    },
    quotientConsequence:
      'Occurrence permutation preserves the slotwise mask only equivariantly; the unlabelled quotient retains its number of true entries but forgets their ordered positions.',
    claimBoundary:
      'This classifies address/reference equality per ordered slot. It does not establish that reference-slot identity is intrinsic, assign endpoint roles to slots, or supply dynamics or execution semantics.',
  };
}

function orderedSharedAddressConfigurations(linkCount) {
  return setPartitions(linkCount * 2).filter(configuration => {
    const linkAddresses = Array.from(
      { length: linkCount },
      (_, linkIndex) => configuration[linkIndex * 2],
    );
    return new Set(linkAddresses).size === linkCount;
  });
}

function localSingleLinkDescriptors(configuration) {
  return Array.from(
    { length: configuration.length / 2 },
    (_, linkIndex) => orderedAddressableLinkDescriptor([
      configuration[linkIndex * 2],
      configuration[(linkIndex * 2) + 1],
    ]),
  );
}

function sharedAddressDescriptor(configuration) {
  const linkCount = configuration.length / 2;
  const linkAddresses = Array.from(
    { length: linkCount },
    (_, linkIndex) => configuration[linkIndex * 2],
  );
  const references = Array.from(
    { length: linkCount },
    (_, linkIndex) => configuration[(linkIndex * 2) + 1],
  );
  return {
    referenceEqualityMatrixAcrossLinks: equalityMatrix(references),
    referenceToLinkAddressIncidenceMatrix: references.flatMap(reference =>
      linkAddresses.map(linkAddress => Number(reference === linkAddress))),
  };
}

function linkIncidenceCycleLength(configuration, startingLinkIndex) {
  const linkCount = configuration.length / 2;
  const linkAddresses = Array.from(
    { length: linkCount },
    (_, linkIndex) => configuration[linkIndex * 2],
  );
  const visitedAt = new Map();
  let linkIndex = startingLinkIndex;
  while (!visitedAt.has(linkIndex)) {
    visitedAt.set(linkIndex, visitedAt.size);
    const referenceAddress = configuration[(linkIndex * 2) + 1];
    linkIndex = linkAddresses.indexOf(referenceAddress);
    if (linkIndex === -1) return 0;
  }
  return linkIndex === startingLinkIndex
    ? visitedAt.size - visitedAt.get(linkIndex)
    : 0;
}

function sharedAddressCompositionAudit() {
  const finiteEnumeration = [1, 2, 3, 4].map(linkCount => {
    const configurations = orderedSharedAddressConfigurations(linkCount);
    const localDescriptorFibres = new Map();
    const sharedDescriptorToSignatures = new Map();
    for (const configuration of configurations) {
      const localDescriptor = JSON.stringify(
        localSingleLinkDescriptors(configuration),
      );
      localDescriptorFibres.set(
        localDescriptor,
        (localDescriptorFibres.get(localDescriptor) ?? 0) + 1,
      );
      const sharedDescriptor = JSON.stringify(
        sharedAddressDescriptor(configuration),
      );
      if (!sharedDescriptorToSignatures.has(sharedDescriptor)) {
        sharedDescriptorToSignatures.set(sharedDescriptor, new Set());
      }
      sharedDescriptorToSignatures.get(sharedDescriptor).add(
        JSON.stringify(firstOccurrenceNormalForm(configuration)),
      );
    }
    const localDescriptorFibreHistogram = [...localDescriptorFibres.values()]
      .reduce((histogram, sharedAddressClasses) => {
        histogram.set(
          sharedAddressClasses,
          (histogram.get(sharedAddressClasses) ?? 0) + 1,
        );
        return histogram;
      }, new Map());
    return {
      linkCount,
      referenceSlotsPerLink: 1,
      sharedAddressClasses: configurations.length,
      localDescriptorClasses: localDescriptorFibres.size,
      localDescriptorFibreHistogram: [...localDescriptorFibreHistogram]
        .sort(([left], [right]) => left - right)
        .map(([sharedAddressClasses, localDescriptorClasses]) => ({
          sharedAddressClasses,
          localDescriptorClasses,
        })),
      localDescriptorsFaithful: [...localDescriptorFibres.values()]
        .every(fibreSize => fibreSize === 1),
      sharedDescriptorClasses: sharedDescriptorToSignatures.size,
      sharedDescriptorFaithful: [...sharedDescriptorToSignatures.values()]
        .every(signatures => signatures.size === 1) &&
          sharedDescriptorToSignatures.size === configurations.length,
    };
  });
  const externalReferences = [[0, 1], [2, 3]];
  const twoLinkCycle = [[0, 2], [2, 0]];
  const flatten = configuration => configuration.flat();
  const externalPattern = flatten(externalReferences);
  const cyclePattern = flatten(twoLinkCycle);

  return {
    status: 'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL',
    provenance: 'ISSUE_183_INDIRECT_SELF_REFERENCE_REQUIREMENT',
    removedAssumption: 'single addressed link considered in isolation',
    retainedAssumptions: [
      'finite ordered link records',
      'one ordered reference slot per link',
      'distinct link addresses in one shared address space',
      'address equality is the only observation',
    ],
    finiteEnumeration,
    localDescriptorsFaithfulAtEveryTestedMultiLinkWidth:
      finiteEnumeration.filter(item => item.linkCount > 1)
        .every(item => item.localDescriptorsFaithful),
    countermodel: {
      externalReferences,
      twoLinkCycle,
      sameLocalDescriptors:
        JSON.stringify(localSingleLinkDescriptors(externalPattern)) ===
          JSON.stringify(localSingleLinkDescriptors(cyclePattern)),
      sameSharedAddressClass:
        JSON.stringify(firstOccurrenceNormalForm(externalPattern)) ===
          JSON.stringify(firstOccurrenceNormalForm(cyclePattern)),
      externalReferencesCycleLength:
        linkIncidenceCycleLength(externalPattern, 0),
      twoLinkCycleLength: linkIncidenceCycleLength(cyclePattern, 0),
      distinguishingObservation:
        'whether each reference address equals another link address in the same configuration',
    },
    sharedFaithfulDescriptor: {
      status:
        'COMPLETE_INVARIANT_FOR_ORDERED_SHARED_ADDRESS_EQUALITY_CONTRACT',
      fields: [
        'referenceEqualityMatrixAcrossLinks',
        'referenceToLinkAddressIncidenceMatrix',
      ],
      finiteEnumerationAgreement: finiteEnumeration.every(item =>
        item.sharedDescriptorFaithful),
      generalArgument:
        'With distinct ordered link addresses, incidence identifies every reference equal to a link address; the reference equality matrix partitions all remaining external references. Equal descriptors therefore induce a global bijection of every used address.',
    },
    generalConsequence:
      'For any finite ordered collection of distinct link addresses with one reference each, the product of local single-link descriptors retains only the diagonal of cross-link incidence and is non-faithful from two links onward.',
    assumptionClassification: {
      forcedByIssueContract:
        'indirect self-reference requires comparing references with other link addresses in a shared address space',
      survivesRepresentationChange:
        'the external-reference and two-link-cycle configurations remain distinct under every global address renaming',
      introducedByObserver:
        'link-record order, fixed finite link count, and one reference slot are retained experimental restrictions',
      semanticsNotAssigned:
        'cross-link incidence is only address equality; it is not a source, target, transition, dependency, or execution edge',
    },
    claimBoundary:
      'This removes single-link isolation and proves a compositional information loss for the declared equality contract. It does not establish that ordered link records or one-slot links are intrinsic, interpret an incidence cycle dynamically, or define a complete link ontology.',
  };
}

function binaryLinkRecordSignature(records) {
  return firstOccurrenceNormalForm(records.flat());
}

function reverseBinaryReferenceSlots(records) {
  return records.map(([address, left, right]) => [address, right, left]);
}

function unorderedBinaryLinkRecordSignature(records) {
  return JSON.stringify(records.map(([address, left, right]) => [
    address,
    ...[left, right].sort((first, second) => first - second),
  ]));
}

function renameCandidateLeaves(records, permutation) {
  return records.map(([address, ...references]) => [
    address,
    ...references.map(reference =>
      reference < permutation.length ? permutation[reference] : reference),
  ]);
}

function hasReferencePair(records, pair) {
  return records.some(([, left, right]) =>
    left === pair[0] && right === pair[1]);
}

function hasRecord(records, expected) {
  return records.some(record =>
    record.length === expected.length &&
      record.every((value, index) => value === expected[index]));
}

function structuralApplicationCompositionProbe() {
  // Each record is [link address, first reference, second reference]. The
  // numbers are addresses only: none is assigned a semantic role here.
  const leftAssociated = [[3, 0, 1], [4, 3, 2]];
  const rightAssociated = [[3, 1, 2], [4, 0, 3]];
  const candidateLinkAddresses = new Set(leftAssociated.map(([address]) =>
    address));
  const candidateEncodingsHaveRecursion = [leftAssociated, rightAssociated]
    .every(records => records.some(([address, ...references]) =>
      references.some(reference =>
        candidateLinkAddresses.has(reference) && reference !== address)));

  const leafAddresses = [0, 1, 2];
  const leftUnorderedSignature = unorderedBinaryLinkRecordSignature(
    leftAssociated,
  );
  const unorderedAutomorphisms = permutations(leafAddresses)
    .filter(permutation => unorderedBinaryLinkRecordSignature(
      renameCandidateLeaves(leftAssociated, permutation),
    ) === leftUnorderedSignature);
  const unseenLeaves = new Set(leafAddresses);
  const unorderedLeafOrbitSizes = [];
  while (unseenLeaves.size > 0) {
    const [leaf] = unseenLeaves;
    const orbit = new Set(unorderedAutomorphisms.map(permutation =>
      permutation[leaf]));
    unorderedLeafOrbitSizes.push(orbit.size);
    for (const member of orbit) unseenLeaves.delete(member);
  }
  unorderedLeafOrbitSizes.sort((left, right) => left - right);

  // P and Q have identities 3 and 4, their K/A/B references are the distinct
  // addresses 0/1/2, and they share only A. A third link contains the reverse
  // B/K pair. A fourth is directly self-incident and recursively refers to P.
  // Thus all requested structural phenomena are present without a record whose
  // references are [0, 2].
  const withoutProposedResult = [
    [3, 0, 1],
    [4, 1, 2],
    [5, 2, 0],
    [6, 6, 3],
  ];
  const proposedResult = [7, 0, 2];
  const withProposedResult = [...withoutProposedResult, proposedResult];
  const premiseP = [3, 0, 1];
  const premiseQ = [4, 1, 2];
  const premiseReferenceAddresses = new Set([
    ...premiseP.slice(1),
    ...premiseQ.slice(1),
  ]);
  const usedAddresses = new Set(withoutProposedResult.flat());
  const structuralFacts = records => {
    const linkAddresses = new Set(records.map(([address]) => address));
    return {
      distinctLinkIdentities: linkAddresses.size === records.length,
      premiseLinkIdentitiesDistinctFromReferences:
        [premiseP[0], premiseQ[0]].every(address =>
          !premiseReferenceAddresses.has(address)),
      premiseReferenceAddressesPairwiseDistinct:
        premiseReferenceAddresses.size === 3,
      directSelfIncidence: records.some(
        ([address, ...references]) => references.includes(address),
      ),
      sharedAddressIncidence:
        premiseP[2] === premiseQ[1],
      recursiveLinkReferences: records.some(
        ([address, ...references]) => references.some(reference =>
          reference !== address && linkAddresses.has(reference)),
      ),
    };
  };
  const commonFacts = structuralFacts(withoutProposedResult);
  const premisesHold = records =>
    hasRecord(records, premiseP) &&
      hasRecord(records, premiseQ) &&
      Object.values(structuralFacts(records)).every(Boolean);
  const formationExtensions = [...usedAddresses].flatMap(left =>
    [...usedAddresses].map(right => [
      ...withoutProposedResult,
      [proposedResult[0], left, right],
    ]));

  return {
    status: 'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION',
    premiseVocabulary: [
      'link identity',
      'reference-address equality',
      'self-incidence',
      'shared-address incidence',
      'recursive reference to a link address',
    ],
    semanticSeparation: {
      logicalImplication: 'NOT_IDENTIFIED_WITH_LINK_STRUCTURE',
      linkStructure: 'ADDRESS_REFERENCE_INCIDENCE_ONLY',
      composition: 'PROPOSED_LINK_NOT_FORCED',
      execution: 'NO_TRANSFORMATION_OR_CREATION_LAW_PRESENT',
    },
    candidateEncodings: {
      leftAssociated,
      rightAssociated,
      sameUnderAddressRenamingAlone:
        JSON.stringify(binaryLinkRecordSignature(leftAssociated)) ===
          JSON.stringify(binaryLinkRecordSignature(rightAssociated)),
      sameAfterUniformSlotReversalAndAddressRenaming:
        JSON.stringify(binaryLinkRecordSignature(
          reverseBinaryReferenceSlots(leftAssociated),
        )) === JSON.stringify(binaryLinkRecordSignature(rightAssociated)),
      recursiveAddressReferencesPresent: candidateEncodingsHaveRecursion,
      orderedSlotContractConsequence:
        'the two association candidates occupy different ordered reference positions',
      unorderedSlotContractConsequence:
        'uniform reference-slot reversal plus address renaming identifies the two candidates',
    },
    roleRecovery: {
      investigatedRoles: ['function', 'argument', 'result', 'application'],
      semanticAssignmentsForThreeLeaves: permutations(leafAddresses).length,
      unorderedStructureAutomorphisms: unorderedAutomorphisms.length,
      unorderedLeafOrbitSizes,
      orderedPositionsSelectSemanticRoles: false,
      allFourSemanticRolesRecovered: false,
      status: 'ADDITIONAL_ROLE_ASSIGNMENT_REQUIRED',
      evidence:
        'Ordered slots distinguish three leaf positions but do not name their meaning. Without slot order, the two leaves of the nested link form one orbit, so the raw structure does not even separate all three leaf positions.',
    },
    compositionCountermodel: {
      withoutProposedResult,
      withProposedResult,
      premiseP,
      premiseQ,
      proposedResult,
      commonFacts,
      premisesHoldInBoth:
        premisesHold(withoutProposedResult) && premisesHold(withProposedResult),
      reversePairAlreadyPresent: hasReferencePair(withoutProposedResult, [2, 0]),
      proposedResultAbsentInFirst:
        !hasReferencePair(withoutProposedResult, proposedResult.slice(1)),
      proposedResultPresentInSecond:
        hasReferencePair(withProposedResult, proposedResult.slice(1)),
    },
    formationProbe: {
      existingAddresses: [...usedAddresses].sort((left, right) => left - right),
      orderedPairsUsingExistingAddresses: usedAddresses.size ** 2,
      proposedReferencePair: proposedResult.slice(1),
      everyFormationExtensionPreservesPremises:
        formationExtensions.every(premisesHold),
      compositionSpecificSelectionFromFormationOnly: false,
      consequence:
        'Binary link formation admits every ordered pair of the seven existing addresses; it does not uniquely select [0,2].',
    },
    conclusion:
      'The proposed result is structurally formable but is neither unavoidable nor selected. The premise-only structure and its result-bearing conservative extension satisfy the same stated structural conditions.',
    claimBoundary:
      'This countermodel refutes entailment from the tested identity/equality/incidence/recursion structure. It does not refute a future links-derived composition, but such a result needs an additional selection/closure law and an explicit account of its authority; no logical implication, function role, or execution meaning is assigned here.',
  };
}

function startingRepresentationAudit() {
  const finiteEnumeration = Array.from({ length: 4 }, (_, index) => index + 1)
    .map(occurrenceCount => {
      const addressableClasses = new Map();
      for (const addressPattern of setPartitions(occurrenceCount + 1)) {
        const signature = canonicalAddressableLinkSignature(addressPattern);
        if (!addressableClasses.has(signature)) {
          addressableClasses.set(signature, JSON.parse(signature));
        }
      }

      const fibres = new Map();
      for (const addressPattern of addressableClasses.values()) {
        const projection = JSON.stringify(multiplicitySpectrum(
          addressPattern.slice(1),
        ));
        if (!fibres.has(projection)) fibres.set(projection, []);
        fibres.get(projection).push(addressPattern);
      }
      const projectionFibreHistogram = [...fibres.values()]
        .reduce((histogram, fibre) => {
          histogram.set(fibre.length, (histogram.get(fibre.length) ?? 0) + 1);
          return histogram;
        }, new Map());
      const classesWithDirectSelfReference = [...addressableClasses.values()]
        .filter(pattern => pattern.slice(1).includes(pattern[0])).length;

      return {
        occurrenceCount,
        referenceOnlyClasses: fibres.size,
        addressableLinkClasses: addressableClasses.size,
        classesWithNoDirectSelfReference:
          addressableClasses.size - classesWithDirectSelfReference,
        classesWithDirectSelfReference,
        projectionFibreHistogram: [...projectionFibreHistogram]
          .sort(([left], [right]) => left - right)
          .map(([addressableClassCount, referenceOnlyClassCount]) => ({
            addressableClasses: addressableClassCount,
            referenceOnlyClasses: referenceOnlyClassCount,
          })),
        everyProjectionFibreAmbiguous: [...fibres.values()]
          .every(fibre => fibre.length > 1),
      };
    });

  const directSelfPattern = [0, 0, 1];
  const freshExternalPattern = [0, 1, 2];
  const directSelfProjection = multiplicitySpectrum(directSelfPattern.slice(1));
  const freshExternalProjection = multiplicitySpectrum(
    freshExternalPattern.slice(1),
  );
  const quotientFiniteEnumeration = Array.from(
    { length: 4 },
    (_, index) => index + 1,
  ).map(occurrenceCount => {
    const orderedPatterns = setPartitions(occurrenceCount + 1);
    const unlabelledSignatures = new Set(
      orderedPatterns.map(canonicalAddressableLinkSignature),
    );
    return {
      occurrenceCount,
      orderedEqualityClassesAfterAddressRenaming: orderedPatterns.length,
      unlabelledAddressableClasses: unlabelledSignatures.size,
      classesCollapsedByOccurrencePermutation:
        orderedPatterns.length - unlabelledSignatures.size,
    };
  });
  const descriptorToSignatures = new Map();
  for (const occurrenceCount of [1, 2, 3, 4]) {
    for (const addressPattern of setPartitions(occurrenceCount + 1)) {
      const descriptor = JSON.stringify(addressableLinkDescriptor(addressPattern));
      const signature = canonicalAddressableLinkSignature(addressPattern);
      if (!descriptorToSignatures.has(descriptor)) {
        descriptorToSignatures.set(descriptor, new Set());
      }
      descriptorToSignatures.get(descriptor).add(signature);
    }
  }
  const firstOrderedPattern = [0, 0, 1];
  const secondOrderedPattern = [0, 1, 0];

  return {
    status: 'REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE',
    scope: 'finite addressable links with one or more unlabelled reference occurrences and direct self-reference in the same address space',
    independentJustification: {
      requirement: 'a link may occur directly among its own references',
      provenance: 'ISSUE_183_DIRECT_SELF_REFERENCE_REQUIREMENT',
      consequence: 'the link address and reference addresses must participate in the same equality comparison',
    },
    representationChangesUnderAudit: [
      'global address renaming',
      'permutation of reference occurrences',
    ],
    finiteEnumeration,
    everyProjectionFibreAmbiguous: finiteEnumeration.every(item =>
      item.everyProjectionFibreAmbiguous),
    referenceOnlyProjectionFaithful: finiteEnumeration.every(item =>
      item.addressableLinkClasses === item.referenceOnlyClasses),
    countermodel: {
      projectedReferenceMultiplicitySpectrum: directSelfProjection,
      directSelfLink: {
        normalizedAddressPattern: directSelfPattern,
        directSelfReferenceCount: directSelfPattern.slice(1)
          .filter(address => address === directSelfPattern[0]).length,
      },
      freshExternalLink: {
        normalizedAddressPattern: freshExternalPattern,
        directSelfReferenceCount: freshExternalPattern.slice(1)
          .filter(address => address === freshExternalPattern[0]).length,
      },
      sameReferenceOnlyProjection:
        JSON.stringify(directSelfProjection) ===
          JSON.stringify(freshExternalProjection),
      sameAddressableLinkClass:
        canonicalAddressableLinkSignature(directSelfPattern) ===
          canonicalAddressableLinkSignature(freshExternalPattern),
    },
    generalArgument: {
      scope: 'every nonempty finite reference multiplicity spectrum',
      steps: [
        'give the link a fresh address not used by any reference occurrence',
        'alternatively identify the link address with a reference class',
        'forgetting the link address maps both lifts to the same reference-only observation',
        'global address renaming and occurrence permutation preserve whether a reference equals the link address',
      ],
      exactFibreCardinality: 'one fresh-address lift plus one self-identifying lift for each distinct reference multiplicity',
      consequence: 'REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY',
    },
    slotwiseSelfIncidence: slotwiseSelfIncidenceAudit(),
    sharedAddressComposition: sharedAddressCompositionAudit(),
    structuralApplicationComposition: structuralApplicationCompositionProbe(),
    quotientAudit: {
      finiteEnumeration: quotientFiniteEnumeration,
      addressRenamingCompleteInvariantVerified: [1, 2, 3, 4]
        .every(occurrenceCount => {
          const orderedPatterns = setPartitions(occurrenceCount + 1);
          return new Set(orderedPatterns.map(pattern =>
            JSON.stringify(equalityMatrix(pattern)))).size ===
              orderedPatterns.length;
        }),
      transformations: [
        {
          transformation: 'global address renaming',
          classification:
            'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
          evidence:
            'The full equality matrix is invariant under every bijective address renaming and uniquely determines every ordered equality class at widths one through four; generally, equal matrices induce the bijection between used addresses.',
          ontologyScope: 'CONTRACT_RELATIVE_NOT_ABSOLUTE',
        },
        {
          transformation: 'reference-occurrence permutation',
          classification: 'UNESTABLISHED_EQUIVALENCE',
          evidence:
            'No link-derived fact in the tested contract identifies reference slots. The quotient collapses 0/1/8/40 ordered equality classes at widths one through four; treating those collapses as intrinsic would require an independent reason that slots have no identity.',
          ontologyScope: 'OBSERVER_CHOICE_UNTIL_DERIVED',
        },
      ],
      occurrencePermutationCountermodel: {
        firstOrderedPattern,
        secondOrderedPattern,
        sameUnderAddressRenamingAlone:
          JSON.stringify(firstOccurrenceNormalForm(firstOrderedPattern)) ===
            JSON.stringify(firstOccurrenceNormalForm(secondOrderedPattern)),
        sameAfterOccurrencePermutation:
          canonicalAddressableLinkSignature(firstOrderedPattern) ===
            canonicalAddressableLinkSignature(secondOrderedPattern),
        interpretation:
          'DISTINGUISHABLE_ONLY_IF_REFERENCE_SLOTS_HAVE_IDENTITY',
      },
      minimalFaithfulDescriptor: {
        status:
          'COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT',
        fields: [
          'referenceMultiplicitySpectrum',
          'directSelfReferenceMultiplicity',
        ],
        finiteEnumerationAgreement: [...descriptorToSignatures.values()]
          .every(signatures => signatures.size === 1) &&
            descriptorToSignatures.size === quotientFiniteEnumeration
              .reduce((total, item) =>
                total + item.unlabelledAddressableClasses, 0),
        generalArgument:
          'The reference multiplicity spectrum fixes the unlabelled reference classes; zero denotes a fresh link address, while a positive self-reference multiplicity selects the uniquely sized reference class identified with the link. Equal descriptors therefore differ only by address renaming and occurrence permutation.',
      },
      occurrencePermutationIntrinsic: 'UNRESOLVED',
      claimBoundary:
        'The canonical descriptor is faithful only after unlabelled occurrences are declared. The audit derives address-renaming equivalence from equality, but it neither derives occurrence permutation from links nor proves that ordered slots are intrinsic.',
    },
    claimBoundary: 'This proves a loss in the starting representation required to express direct self-reference and audits the remaining quotient assumptions. It does not establish that reference occurrences are intrinsically ordered or unlabelled, make link identity a complete ontology, derive endpoint roles, an evaluator, dynamics, or an execution law.',
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
    startingRepresentationAudit: startingRepresentationAudit(),
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
        classification:
          'DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT',
        evidence: 'The full equality matrix is invariant and complete under bijective address renaming; this justification remains relative to the address/equality contract.',
      },
      {
        distinction: 'occurrence order',
        classification: 'UNESTABLISHED_EQUIVALENCE',
        evidence: 'Occurrence permutation collapses 0/1/8/40 ordered equality classes at widths one through four, but no link-derived premise in the tested contract establishes that reference slots lack identity.',
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
        distinction: 'direct self-reference',
        classification: 'PROVEN_INFORMATION_LOSS_FOR_ADDRESSABLE_LINKS',
        evidence: 'At widths one through four, forgetting the link address maps 2/4/7/12 addressable classes to 1/2/3/5 reference-only classes; every coarse fibre contains both fresh-address and self-identifying lifts.',
      },
      {
        distinction: 'self-incidence reference slot',
        classification: 'RENAMING_INVARIANT_PERMUTATION_EQUIVARIANT',
        evidence: 'All 2/4/8/16 Boolean self-incidence masks occur at widths one through four. Each mask is invariant under address renaming and moves equivariantly, rather than remaining fixed, under reference-slot permutation.',
      },
      {
        distinction: 'cross-link address incidence',
        classification: 'PROVEN_INFORMATION_LOSS_UNDER_LOCAL_PROJECTION',
        evidence: 'For two through four ordered one-reference links, products of local descriptors collapse 10/77/799 shared-address classes to 4/8/16 classes. A fresh-external pair and a two-link incidence cycle have identical local descriptors but inequivalent global equality patterns.',
      },
      {
        distinction: 'application and composition meaning',
        classification: 'PROVEN_NOT_ENTAILED_BY_TESTED_LINK_STRUCTURE',
        evidence: 'A connected countermodel keeps the P/Q link identities distinct from the pairwise-distinct K/A/B addresses and has direct self-incidence, a shared address, and recursive link references while containing [2,0] but not the proposed [0,2]. Adding [0,2] preserves every premise. Formation admits all 49 ordered pairs over the seven existing addresses and selects none.',
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
    schema: 'rml-link-ontology-symmetry-experiment/v8',
    question: 'Which facts survive the binary reference observation, what do fixed width and single-link isolation erase, how is self-incidence classified per reference slot, and do identity, incidence, shared address, and recursion entail application or composition?',
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
        id: 'starting-representation-faithfulness',
        result: 'REFERENCE_ONLY_PROJECTION_NON_FAITHFUL_FOR_SELF_REFERENCE',
        evidence: 'Direct-self [0,0,1] and fresh-external [0,1,2] address patterns have the same reference-only [1,1] projection but cannot be related by address renaming or occurrence permutation. At widths one through four, 2/4/7/12 addressable classes collapse to 1/2/3/5 reference-only classes.',
      },
      {
        id: 'slotwise-self-incidence',
        result: 'CLASSIFIED_PER_ORDERED_REFERENCE_SLOT',
        evidence: 'The slotwise Boolean mask realizes 2/4/8/16 patterns at widths one through four, is invariant under global address renaming, and is equivariant but not invariant under slot permutation. Together with the ordered reference-equality matrix it completely classifies the tested ordered address/equality patterns.',
      },
      {
        id: 'shared-address-composition',
        result: 'LOCAL_SINGLE_LINK_DESCRIPTOR_NOT_COMPOSITIONALLY_FAITHFUL',
        evidence: 'At two through four ordered one-reference links, 10/77/799 shared-address equality classes collapse to 4/8/16 products of local descriptors. [[0,1],[2,3]] and [[0,2],[2,0]] have identical local descriptors, but only the latter is a two-link incidence cycle.',
      },
      {
        id: 'structural-application-composition',
        result: 'RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION',
        evidence: 'The premise-only [[3,0,1],[4,1,2],[5,2,0],[6,6,3]] and result-bearing extension with [7,0,2] both keep P/Q distinct from K/A/B and preserve distinct identities, self-incidence, shared address, and recursive reference. The first already contains reverse references [2,0] but no [0,2]. Recursive association candidates coincide after the still-unestablished uniform slot reversal plus address renaming; semantic roles and a creation law require additional authority.',
      },
      {
        id: 'addressable-quotient-assumptions',
        result: 'RENAMING_DERIVED_ORDER_QUOTIENT_UNESTABLISHED',
        evidence: 'Equality matrices completely classify ordered address patterns under bijective renaming, but occurrence permutation additionally collapses 0/1/8/40 classes at widths one through four without a link-derived premise that reference slots lack identity. Multiplicity spectrum plus self-reference multiplicity is complete only for the explicitly unlabelled contract.',
      },
      {
        id: 'observation-loss-provenance',
        result: 'CLASSIFIED_NOT_RESOLVED',
        evidence: 'The report derives renaming equivalence within the equality contract, marks occurrence permutation unestablished, separates demonstrated width and projection losses, and leaves unobserved distinctions unresolved.',
      },
    ],
    admissibleConclusion: 'Exhaustive enumeration shows that binary equality coincidence is complete only at fixed width two. At tested widths one through four, multiplicity spectra classify the unlabelled base observations, but that reference-only projection is non-faithful once the issue requirement that links can reference themselves is admitted: it forgets whether a reference equals the link address. Before occurrence permutation, the Boolean self-incidence mask classifies that equality per ordered reference slot. Removing single-link isolation exposes another loss: local descriptors retain only self-incidence and cannot distinguish external references from cross-link incidence, including a two-link cycle. Across one through four ordered one-reference links, the cross-reference equality matrix plus the reference-to-link-address incidence matrix completely classifies the shared-address contract. A connected identity/self-incidence/shared-address/recursion countermodel then proves that a proposed composition link is formable but not entailed; raw structure cannot assign source or target, function roles, logical implication, composition authority, or execution meaning.',
    remainingBoundary: 'This experiment proves that the interaction-only asymmetry is not derivable from the tested base, that reference-only and link-local projections lose required self-reference information, that raw address names add no information within the address/equality contract, that self-incidence has an explicit slotwise invariant before the permutation quotient, and that the tested raw structure has models both without and with the proposed composition result. It does not define a link ontology, establish whether reference occurrences or link records intrinsically have order, interpret an incidence cycle dynamically, claim the addressed representation is complete, derive an additional selection/closure law, derive execution semantics, or generalize every finite enumeration beyond its stated argument.',
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
    schema: 'rml-alternative-foundation-search/v11',
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
    proofBoundary: 'The report proves the finite acceptance workload, an instruction-by-instruction simulation of the complete two-counter-machine basis, the binary symmetry quotient, the width-one-through-four multiplicity quotients, the slotwise self-incidence classification, the one-through-four-link shared-address audit, the structural application/composition countermodel, the conditional width-four refinement fibres, and the symmetry non-creation result for observations derived from the tested base. Turing completeness additionally uses the standard universality theorem for unbounded deterministic two-counter machines. The observation evidence does not establish link ontology, intrinsic slot or link-record order, richer intrinsic link structure, a function-role assignment, a composition closure law, turn structural incidence into execution semantics, permit the executable controls to constrain ontology, or claim complete Lean, Rocq, Rust, or JavaScript production implementations.',
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
      ontologyExperimentConclusion: 'Binary equality coincidence is complete only at fixed width two. Across tested widths one through four, multiplicity spectra classify the base observation. The width-four refinement separates 7 base-forced, 5 refinement-present, 1 interaction-only, and 20 symmetric classes. Every tested candidate that preserves all base symmetries leaves the base occurrence orbits unchanged, while the interaction-only witness breaks a base-preserving relabelling; its distinction is therefore not derived from the tested base. The reference-only projection is non-faithful for required direct self-reference. Before occurrence permutation, 2/4/8/16 Boolean masks classify self-incidence per ordered slot. Removing single-link isolation yields 10/77/799 shared-address classes at two through four links but only 4/8/16 local-descriptor products; an external-reference pair and a two-link incidence cycle are the explicit countermodel. Cross-reference equality plus reference-to-link-address incidence is complete for the ordered one-reference shared-address contract, without assigning semantic meaning to that incidence. A connected identity/self-incidence/shared-address/recursion structure keeps P/Q distinct from K/A/B and contains the reverse [2,0] reference pair but not proposed [0,2]; its conservative extension adds [0,2] without changing the premises. Binary formation admits all 49 pairs over the seven existing addresses, so application roles and composition/execution authority require an additional distinction or law.',
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
