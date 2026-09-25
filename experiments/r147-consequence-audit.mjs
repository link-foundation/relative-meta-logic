// R147 prototype: what turns a possible continuation into one that follows?
//
// Premises K⟼A and A⟼B are ordinary addressed records [3,0,1] and [4,1,2]
// (K=0, A=1, B=2). This script checks three small, exhaustive facts before
// they are promoted into the foundation-search probe:
//   1. modal separation: "possible" = present in some admissible completion,
//      "follows" = present in every admissible completion;
//   2. law space: which of the 16 slot-position laws survive admitted
//      transformations, and which selectors break the forward/reverse tie;
//   3. self-application and assumption removal.
// Run: node experiments/r147-consequence-audit.mjs

const K = 0, A = 1, B = 2;
const carrier = [K, A, B];
const premises = [[3, K, A], [4, A, B]];
const premisePairs = premises.map(([, x, y]) => [x, y]);
const pairKey = ([x, y]) => `${x},${y}`;
const sortPairs = pairs => [...pairs].sort((l, r) => l[0] - r[0] || l[1] - r[1]);
const uniquePairs = pairs => sortPairs([...new Map(pairs.map(p => [pairKey(p), p])).values()]);
const hasPair = (pairs, pair) => pairs.some(p => p[0] === pair[0] && p[1] === pair[1]);

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => {
    const rest = values.filter((_, candidate) => candidate !== index);
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

// ---------------------------------------------------------------------------
// 1. Modal separation over every completion of the premise pairs.
const allPairs = carrier.flatMap(x => carrier.map(y => [x, y]));
const optionalPairs = allPairs.filter(pair => !hasPair(premisePairs, pair));
const completions = Array.from({ length: 1 << optionalPairs.length }, (_, mask) =>
  sortPairs([...premisePairs, ...optionalPairs.filter((_, bit) => mask & (1 << bit))]));
const closedUnder = (relation, conclude) => relation.every(([x, y]) =>
  relation.every(([y2, z]) => y !== y2 || hasPair(relation, conclude(x, y, z))));
const transitive = relation => closedUnder(relation, (x, _y, z) => [x, z]);
const circular = relation => closedUnder(relation, (x, _y, z) => [z, x]);
const classes = {
  unconstrained: completions,
  transitiveExclusion: completions.filter(transitive),
  circularExclusion: completions.filter(circular),
  orientationSymmetricExclusion: completions.filter(r => transitive(r) || circular(r)),
};
const intersection = relations => allPairs.filter(pair => relations.every(r => hasPair(r, pair)));
const union = relations => allPairs.filter(pair => relations.some(r => hasPair(r, pair)));
console.log('completions', completions.length);
for (const [id, members] of Object.entries(classes)) {
  const follows = intersection(members);
  const possible = union(members);
  console.log(id, {
    admissible: members.length,
    follows: JSON.stringify(follows),
    possibleCount: possible.length,
    forwardFollows: hasPair(follows, [K, B]),
    reverseFollows: hasPair(follows, [B, K]),
    forwardPossible: hasPair(possible, [K, B]),
    reversePossible: hasPair(possible, [B, K]),
    unorderedFollows: members.every(r => hasPair(r, [K, B]) || hasPair(r, [B, K])),
  });
}
// Positive facts alone never force a non-member: every fact set F over the
// carrier that contains the premises has exactly F as the intersection of its
// unconstrained completions.
const positiveOnly = completions.every(facts =>
  JSON.stringify(intersection(completions.filter(r => facts.every(p => hasPair(r, p))))) ===
    JSON.stringify(sortPairs(facts)));
console.log('positiveFactsNeverForceNonMembers', positiveOnly);

// ---------------------------------------------------------------------------
// 2. Law space: output slot i copies one of the four premise reference slots.
const slotNames = ['P.first', 'P.second', 'Q.first', 'Q.second'];
const laws = [0, 1, 2, 3].flatMap(i => [0, 1, 2, 3].map(j => [i, j]));
const mirror = ([i, j]) => [j, i];
function applyLaw(records, [i, j]) {
  const out = [];
  for (const first of records) {
    for (const second of records) {
      if (first[0] === second[0] || first[2] !== second[1]) continue;
      const refs = [first[1], first[2], second[1], second[2]];
      out.push([refs[i], refs[j]]);
    }
  }
  return uniquePairs(out);
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const renamePairs = (pairs, map) => uniquePairs(pairs.map(p => p.map(v => map[v] ?? v)));
const renameRecords = (records, map) => records.map(r => r.map(v => map[v] ?? v));
const addresses = [0, 1, 2, 3, 4];
const renamings = permutations(addresses);
const substitutions = carrier.flatMap(k => carrier.flatMap(a => carrier.map(b => [k, a, b])));
const valueOf = law => applyLaw(premises, law)[0];
const criteria = {
  addressRenamingEquivariant: law => renamings.every(perm =>
    same(applyLaw(renameRecords(premises, perm), law), renamePairs(applyLaw(premises, law), perm))),
  substitutionNatural: law => substitutions.every(([k, a, b]) => {
    const map = { [K]: k, [A]: a, [B]: b };
    const substituted = premises.map(([address, x, y]) => [address, map[x], map[y]]);
    const expected = renamePairs(applyLaw(premises, law), map);
    const actual = applyLaw(substituted, law);
    return expected.every(pair => hasPair(actual, pair));
  }),
  recordReorderingInvariant: law => same(applyLaw([...premises].reverse(), law), applyLaw(premises, law)),
  nestedEncodingInvariant: law => {
    const decoded = premises.map(([address, x, y]) => [address, [[0, x], [1, y]]])
      .map(([address, slots]) => [address, slots[0][1], slots[1][1]]);
    return same(applyLaw(decoded, law), applyLaw(premises, law));
  },
  slotReversalEquivariant: law => same(
    applyLaw(premises.map(([address, x, y]) => [address, y, x]), law),
    uniquePairs(applyLaw(premises, law).map(([x, y]) => [y, x]))),
  nonDegenerate: law => valueOf(law)[0] !== valueOf(law)[1],
  unorderedNovel: law => premisePairs.every(([x, y]) => {
    const [u, v] = valueOf(law);
    return !((u === x && v === y) || (u === y && v === x));
  }),
};
const selectors = {
  slotPositionPreservation: ([i, j]) => [0, 2].includes(i) && [1, 3].includes(j),
  unitNeutrality: law =>
    same(applyLaw([[3, K, A], [4, A, A]], law), [[K, A]]) &&
    same(applyLaw([[3, A, A], [4, A, B]], law), [[A, B]]),
  declaredClosedModel: law => {
    const model = [...premises, [7, K, B]];
    const pairs = model.map(([, x, y]) => [x, y]);
    return applyLaw(model, law).every(pair => hasPair(pairs, pair)) &&
      !hasPair(premisePairs, valueOf(law));
  },
};
const tauInvariance = Object.fromEntries(Object.entries(criteria).map(([id, test]) =>
  [id, laws.every(law => test(law) === test(mirror(law)))]));
const passCounts = Object.fromEntries(Object.entries(criteria).map(([id, test]) =>
  [id, laws.filter(test).length]));
console.log('laws', laws.length, 'values', new Set(laws.map(l => pairKey(valueOf(l)))).size);
console.log('tauInvariance', tauInvariance);
console.log('passCounts', passCounts);
const survivors = laws.filter(law => Object.values(criteria).every(test => test(law)));
console.log('survivors', survivors.map(([i, j]) => `${slotNames[i]}/${slotNames[j]} -> ${JSON.stringify(valueOf([i, j]))}`));
for (const [id, select] of Object.entries(selectors)) {
  const chosen = laws.filter(select);
  const mirrorChosen = laws.filter(law => select(mirror(law)));
  console.log(id, {
    tauInvariant: laws.every(law => select(law) === select(mirror(law))),
    allLawsPassing: chosen.map(l => JSON.stringify(valueOf(l))),
    survivorsSelected: survivors.filter(select).map(l => JSON.stringify(valueOf(l))),
    mirrorSurvivorsSelected: survivors.filter(law => select(mirror(law))).map(l => JSON.stringify(valueOf(l))),
    mirrorAllLaws: mirrorChosen.map(l => JSON.stringify(valueOf(l))),
  });
}
// tau commutes with every admitted transformation
const commutes = laws.every(law => Object.values(criteria).every(test => test(law) === test(mirror(law))));
console.log('tauCommutesWithAdmittedCriteria', commutes);

// ---------------------------------------------------------------------------
// 3. Least models, symmetry, self-application, and assumption removal.
function leastModel(law) {
  let records = premises.map(r => [...r]);
  let next = 7;
  for (;;) {
    const pairs = records.map(([, x, y]) => [x, y]);
    const fresh = applyLaw(records, law).filter(pair => !hasPair(pairs, pair));
    if (fresh.length === 0) return records;
    records = [...records, ...fresh.map(([x, y]) => [next++, x, y])];
  }
}
function pairAutomorphisms(pairs) {
  return permutations(carrier).filter(perm =>
    same(uniquePairs(pairs.map(([x, y]) => [perm[x], perm[y]])), uniquePairs(pairs)));
}
for (const law of survivors) {
  const model = leastModel(law);
  const pairs = model.map(([, x, y]) => [x, y]);
  const derived = pairs.filter(pair => !hasPair(premisePairs, pair));
  const automorphisms = pairAutomorphisms(pairs);
  const derivedOrbit = uniquePairs(automorphisms.flatMap(perm => derived.map(([x, y]) => [perm[x], perm[y]])));
  console.log('leastModel', JSON.stringify(valueOf(law)), {
    pairs: JSON.stringify(sortPairs(pairs)),
    closedUnderOwnLaw: applyLaw(model, law).every(pair => hasPair(pairs, pair)),
    closedUnderMirror: applyLaw(model, mirror(law)).every(pair => hasPair(pairs, pair)),
    automorphisms: automorphisms.length,
    derivedDistinguishableFromPremises: !derivedOrbit.some(pair => hasPair(premisePairs, pair)),
    outputsReferencePremiseAddresses: applyLaw(model, law).some(([x, y]) => [3, 4].includes(x) || [3, 4].includes(y)),
  });
}
// removing slot order: the premise structure gains an automorphism that swaps
// the two oriented candidates.
function recordAutomorphisms(records, unordered) {
  const normal = rs => JSON.stringify(rs.map(([address, x, y]) =>
    unordered ? [address, Math.min(x, y), Math.max(x, y)] : [address, x, y])
    .sort((l, r) => l[0] - r[0]));
  const used = [...new Set(records.flat())].sort((l, r) => l - r);
  return permutations(used).map(image => Object.fromEntries(used.map((v, i) => [v, image[i]])))
    .filter(map => normal(renameRecords(records, map)) === normal(records));
}
const withWitness = [...premises, [5, 3, 4]];
for (const unordered of [false, true]) {
  for (const records of [premises, withWitness]) {
    const autos = recordAutomorphisms(records, unordered);
    console.log(unordered ? 'unordered' : 'ordered', records.length, 'automorphisms', autos.length,
      'swapsCandidates', autos.some(map => map[K] === B && map[B] === K));
  }
}

// ---------------------------------------------------------------------------
// 4. Follow-up checks used by the promoted audit.
// A least admissible completion exists only when the class intersection is
// itself admissible (a Horn-like exclusion).
for (const [id, members] of Object.entries(classes)) {
  const meet = intersection(members);
  console.log('leastCompletionAdmissible', id,
    members.some(r => same(sortPairs(r), sortPairs(meet))));
}
// The oriented exclusions restate the two surviving laws.
const leastPairs = law => sortPairs(leastModel(law).map(([, x, y]) => [x, y]));
console.log('transitive meet = forward least model',
  same(intersection(classes.transitiveExclusion), leastPairs([0, 3])));
console.log('circular meet = reverse least model',
  same(intersection(classes.circularExclusion), leastPairs([3, 0])));
// Leave one criterion out at a time.
const criterionEntries = Object.entries(criteria);
console.log('survivorsWithoutEachCriterion', criterionEntries.map(([id]) => [id,
  laws.filter(law => criterionEntries.every(([other, test]) => other === id || test(law))).length]));
// No non-degenerate law is fixed by the output swap, so any swap-closed
// survivor set of non-degenerate laws has even size.
console.log('swapFixedNonDegenerate', laws.filter(law => criteria.nonDegenerate(law) &&
  same(law, mirror(law))).length);
// Every least-model link reproduced by the law from the other links?
for (const law of survivors) {
  const model = leastModel(law);
  console.log('everyLinkFollowsFromOthers', JSON.stringify(valueOf(law)),
    model.every(record => hasPair(applyLaw(model.filter(other => other !== record), law),
      [record[1], record[2]])));
}
// Varying which slot pair must coincide only relabels the same reference
// slots: collect readouts over four join conditions and both record orders.
const joinReadouts = new Set();
for (const [leftSlot, rightSlot] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
  for (const first of premises) for (const second of premises) {
    if (first[0] === second[0] || first[leftSlot] !== second[rightSlot]) continue;
    const refs = [first[1], first[2], second[1], second[2]];
    for (const [i, j] of laws) joinReadouts.add(pairKey([refs[i], refs[j]]));
  }
}
console.log('joinVariantReadouts', [...joinReadouts].sort());
