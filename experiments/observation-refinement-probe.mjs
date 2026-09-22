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

    const automorphisms = occurrencePermutations.filter(permutation =>
      jointKey(referencePartition, refinementPartition, permutation) ===
        jointKey(referencePartition, refinementPartition, [0, 1, 2, 3]));
    const occurrenceOrbits = [];
    const pending = new Set([0, 1, 2, 3]);
    while (pending.size > 0) {
      const seed = pending.values().next().value;
      const orbitMembers = new Set(
        automorphisms.map(permutation => permutation[seed]),
      );
      for (const member of orbitMembers) pending.delete(member);
      occurrenceOrbits.push([...orbitMembers].sort((left, right) => left - right));
    }
    jointClasses.set(canonical, {
      referenceSpectrum: spectrum(referencePartition).join('+'),
      refinementSpectrum: spectrum(refinementPartition).join('+'),
      occurrenceOrbitSizes: occurrenceOrbits
        .map(orbitMembers => orbitMembers.length)
        .sort((left, right) => right - left),
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

console.log(JSON.stringify({
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
      })),
    classesWithInvariantSingleton: [...jointClasses.values()]
      .filter(item => item.occurrenceOrbitSizes.includes(1)).length,
    classesWithoutInvariantSingleton: [...jointClasses.values()]
      .filter(item => !item.occurrenceOrbitSizes.includes(1)).length,
  },
}, null, 2));
