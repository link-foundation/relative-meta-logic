// R148 prototype: where can the orientation of consequence come from?
//
// Premises K⟼A and A⟼B are ordinary addressed records [3,0,1] and [4,1,2]
// (K=0, A=1, B=2). The two candidate continuations are the unrecorded pairs
// [0,2] and [2,0]. The script asks which asymmetries the records force, using
// only address equality and, per contract, slot order:
//   named      ordered slots with names: symmetries are address renamings;
//   anonymous  ordered slots without names: renamings, optionally composed
//              with the global slot reversal;
//   unordered  unordered slots: renamings of unordered records.
// It checks, without completions, exclusions, or position laws:
//   1. the asymmetry ladder of the premises (element and candidate orbits);
//   2. the twin property over a finite family of extensions: the output swap
//      commutes with every contract symmetry, so both candidates always have
//      equal stabilizers and no structure fixes exactly one of them;
//   3. same-observation pairs;
//   4. address renaming and tagged (nested) representations;
//   5. a recursive tag carrier that grounds slot identity by self-incidence;
//   6. which output correspondences every structure leaves compatible;
//   7. where the one-step result stops: iterated closures of a 3-chain.
// Run: node experiments/r148-orientation-provenance.mjs

const K = 0, A = 1, B = 2;
const premises = [[3, K, A], [4, A, B]];
const forward = [K, B];
const reverse = [B, K];
const swap = ([x, y]) => [y, x];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => {
    const rest = values.filter((_, candidate) => candidate !== index);
    return permutations(rest).map(permutation => [value, ...permutation]);
  });
}

// Every address of a record structure is a record address or a referenced
// atom. A symmetry maps records to records, so once the record permutation
// and the slot treatment are fixed, every referenced address has one image.
function symmetries(records, contract) {
  const byAddress = new Map(records.map(record => [record[0], record]));
  const recordAddresses = records.map(([address]) => address);
  const found = [];
  const treatments = contract === 'named' ? [[false]] :
    contract === 'anonymous' ? [[false], [true]] :
    null;
  const flipsFor = contract === 'unordered' ?
    Array.from({ length: 2 ** records.length }, (_, mask) =>
      records.map((_, index) => Boolean(mask & (1 << index)))) :
    treatments.map(([reversed]) => records.map(() => reversed));
  for (const image of permutations(recordAddresses)) {
    for (const flips of flipsFor) {
      const map = new Map(recordAddresses.map((address, index) =>
        [address, image[index]]));
      let consistent = true;
      records.forEach(([address, first, second], index) => {
        const target = byAddress.get(map.get(address));
        const images = flips[index] ? [target[2], target[1]] :
          [target[1], target[2]];
        [first, second].forEach((value, slot) => {
          if (map.has(value)) {
            if (map.get(value) !== images[slot]) consistent = false;
          } else {
            map.set(value, images[slot]);
          }
        });
      });
      if (!consistent || new Set(map.values()).size !== map.size) continue;
      const reversed = contract === 'anonymous' && flips[0];
      const key = JSON.stringify([[...map].sort((l, r) => l[0] - r[0]), reversed]);
      if (!found.some(item => item.key === key)) {
        found.push({ key, map, reversed });
      }
    }
  }
  return found;
}

const act = ({ map, reversed }, [x, y]) =>
  reversed ? [map.get(y), map.get(x)] : [map.get(x), map.get(y)];
const orbit = (group, pair) => [...new Set(group.map(g =>
  JSON.stringify(act(g, pair))))].sort();
const stabilizer = (group, pair) => group.flatMap((g, index) =>
  same(act(g, pair), pair) ? [index] : []);
const elementOrbits = (group, records) => {
  const addresses = [...new Set(records.flat())].sort((l, r) => l - r);
  const seen = new Set();
  const orbits = [];
  for (const address of addresses) {
    if (seen.has(address)) continue;
    const members = [...new Set(group.map(({ map }) => map.get(address)))]
      .sort((l, r) => l - r);
    members.forEach(member => seen.add(member));
    orbits.push(members);
  }
  return orbits;
};

// ---------------------------------------------------------------------------
// 1. Asymmetry ladder of the premises.
console.log('1. asymmetry ladder of the premises');
for (const contract of ['named', 'anonymous', 'unordered']) {
  const group = symmetries(premises, contract);
  const candidateOrbits = contract === 'unordered' ?
    'candidates coincide as the unordered pair {0,2}' :
    [orbit(group, forward), orbit(group, reverse)];
  console.log(contract, {
    symmetries: group.length,
    elementOrbits: JSON.stringify(elementOrbits(group, premises)),
    endsExchanged: group.some(({ map }) => map.get(K) === B),
    candidateOrbits: JSON.stringify(candidateOrbits),
    candidatesExchanged: contract === 'unordered' ? null :
      orbit(group, forward).includes(JSON.stringify(reverse)),
    slotReversingSymmetry: group.filter(g => g.reversed).map(({ map }) =>
      JSON.stringify([...map].sort((l, r) => l[0] - r[0]))),
  });
}

// ---------------------------------------------------------------------------
// 2. Twin property over premises plus up to two ordinary records whose
// references range over every existing address and canonically numbered fresh
// atoms (10, 11, ... in order of first use).
function referenceSequences(length, existing) {
  const sequences = [];
  const walk = (prefix, freshCount) => {
    if (prefix.length === length) {
      sequences.push(prefix);
      return;
    }
    for (const value of existing) walk([...prefix, value], freshCount);
    for (let fresh = 0; fresh <= freshCount; fresh += 1) {
      walk([...prefix, 10 + fresh], Math.max(freshCount, fresh + 1));
    }
  };
  walk([], 0);
  return sequences;
}
const family = [0, 1, 2].flatMap(extra => {
  const existing = Array.from({ length: 5 + extra }, (_, index) => index);
  return referenceSequences(2 * extra, existing).map(references => ({
    extra,
    records: [...premises, ...Array.from({ length: extra }, (_, index) =>
      [5 + index, references[2 * index], references[2 * index + 1]])],
  }));
});
console.log('\n2. twin property over', family.length, 'structures',
  JSON.stringify([0, 1, 2].map(extra =>
    family.filter(item => item.extra === extra).length)));
const started = Date.now();
const tallies = Object.fromEntries(['named', 'anonymous'].map(contract => [
  contract, {
    exchanged: 0,
    separated: 0,
    stabilizerMismatches: 0,
    orbitMismatches: 0,
    swapCommutationFailures: 0,
    symmetriesFixingExactlyOneCandidate: 0,
    minimalExtraRecordsToExchange: null,
    exchanging: [],
    chiral: 0,
  },
]));
for (const { extra, records } of family) {
  const addresses = [...new Set(records.flat())];
  // Named symmetries are exactly the anonymous ones that keep slots in place.
  const anonymousGroup = symmetries(records, 'anonymous');
  for (const contract of ['named', 'anonymous']) {
    const group = contract === 'named' ?
      anonymousGroup.filter(g => !g.reversed) : anonymousGroup;
    const tally = tallies[contract];
    tally.symmetriesFixingExactlyOneCandidate += group.filter(g =>
      same(act(g, forward), forward) !== same(act(g, reverse), reverse)).length;
    for (const g of group) {
      for (const x of addresses) {
        for (const y of addresses) {
          if (!same(act(g, swap([x, y])), swap(act(g, [x, y])))) {
            tally.swapCommutationFailures += 1;
          }
        }
      }
    }
    if (!same(stabilizer(group, forward), stabilizer(group, reverse))) {
      tally.stabilizerMismatches += 1;
    }
    const forwardOrbit = orbit(group, forward);
    const reverseOrbit = orbit(group, reverse);
    if (!same(reverseOrbit,
      forwardOrbit.map(pair => JSON.stringify(swap(JSON.parse(pair)))).sort())) {
      tally.orbitMismatches += 1;
    }
    if (forwardOrbit.includes(JSON.stringify(reverse))) {
      tally.exchanged += 1;
      tally.exchanging.push(JSON.stringify(records.slice(premises.length)));
      if (tally.minimalExtraRecordsToExchange === null ||
        extra < tally.minimalExtraRecordsToExchange) {
        tally.minimalExtraRecordsToExchange = extra;
      }
    } else {
      tally.separated += 1;
    }
    if (contract === 'anonymous' && !group.some(g => g.reversed)) {
      tally.chiral += 1;
    }
  }
}
console.log(tallies, `${Date.now() - started} ms`);

// ---------------------------------------------------------------------------
// 3. Same-observation pairs.
const applyLaw = (records, [first, second]) => {
  const pairs = records.flatMap(left => records
    .filter(right => left[0] !== right[0] && left[2] === right[1])
    .map(right => {
      const references = [left[1], left[2], right[1], right[2]];
      return JSON.stringify([references[first], references[second]]);
    }));
  return [...new Set(pairs)].sort();
};
const laws = [0, 1, 2, 3].flatMap(first => [0, 1, 2, 3].map(second =>
  [first, second]));
const chainReadouts = records => laws.map(law => applyLaw(records, law));
const unorderedShadow = records => records
  .map(([address, left, right]) => [address, Math.min(left, right),
    Math.max(left, right)])
  .sort((l, r) => l[0] - r[0]);

console.log('\n3a. chirality pair: identical chain readouts');
const achiral = [...premises, [5, 3, 4]];
const chiral = [...achiral, [8, 8, 9]];
for (const [id, records] of [['achiral', achiral], ['chiral', chiral]]) {
  const group = symmetries(records, 'anonymous');
  console.log(id, {
    symmetries: group.length,
    slotReversingSymmetries: group.filter(g => g.reversed).length,
    endsExchanged: group.some(({ map }) => map.get(K) === B),
    candidatesExchanged: orbit(group, forward).includes(JSON.stringify(reverse)),
    stabilizersEqual: same(stabilizer(group, forward), stabilizer(group, reverse)),
  });
}
console.log('chain readouts identical for all 16 laws:',
  same(chainReadouts(achiral), chainReadouts(chiral)));

console.log('\n3b. slot-order pair: identical unordered records');
const cycle = [...premises, [5, B, 10], [6, 10, K]];
const detour = [...premises, [5, B, 10], [6, K, 10]];
console.log('unordered shadows identical:',
  same(unorderedShadow(cycle), unorderedShadow(detour)));
for (const [id, records] of [['cycle', cycle], ['detour', detour]]) {
  for (const contract of ['named', 'anonymous', 'unordered']) {
    const group = symmetries(records, contract);
    console.log(id, contract, {
      symmetries: group.length,
      candidatesExchanged: contract === 'unordered' ? 'coincide' :
        orbit(group, forward).includes(JSON.stringify(reverse)),
    });
  }
  console.log(id, 'readouts', {
    forwardLaw: JSON.stringify(applyLaw(records, [0, 3])),
    reverseLaw: JSON.stringify(applyLaw(records, [3, 0])),
  });
}

// ---------------------------------------------------------------------------
// 4. Address renaming and tagged representations.
console.log('\n4a. address renaming');
let renamingFailures = 0;
const renamings = permutations([0, 1, 2, 3, 4]);
for (const image of renamings) {
  const rename = value => image[value];
  const renamed = premises.map(record => record.map(rename));
  const group = symmetries(renamed, 'anonymous');
  const f = forward.map(rename);
  const r = reverse.map(rename);
  if (orbit(group, f).includes(JSON.stringify(r)) ||
    !same(stabilizer(group, f), stabilizer(group, r))) renamingFailures += 1;
}
console.log({ renamings: renamings.length, renamingFailures });

// Tagged incidence representation: [a,x,y] becomes (a,t0,x) and (a,t1,y).
// Symmetries are permutations of every symbol that preserve the triple set.
function tripleSymmetries(triples, fixedSymbols = []) {
  const symbols = [...new Set(triples.flat())].sort((l, r) => l - r);
  const key = set => set.map(triple => JSON.stringify(triple)).sort().join('|');
  const original = key(triples);
  return permutations(symbols)
    .map(image => new Map(symbols.map((symbol, index) => [symbol, image[index]])))
    .filter(map => fixedSymbols.every(symbol => map.get(symbol) === symbol))
    .filter(map => key(triples.map(triple => triple.map(symbol =>
      map.get(symbol)))) === original);
}
const encode = (records, [t0, t1]) => records.flatMap(([address, x, y]) =>
  [[address, t0, x], [address, t1, y]]);
const taggedCandidate = ([x, y], [t0, t1]) =>
  JSON.stringify([[t0, x], [t1, y]].sort((l, r) => l[0] - r[0] || l[1] - r[1]));
const taggedAct = (map, candidate) => JSON.stringify(JSON.parse(candidate)
  .map(([tag, value]) => [map.get(tag), map.get(value)])
  .sort((l, r) => l[0] - r[0] || l[1] - r[1]));
const tags = [20, 21];
const carriers = {
  'named-tags': { records: [], fixed: tags },
  'anonymous-tags': { records: [], fixed: [] },
  'symmetric-self-loop-carrier': {
    records: [[20, 20, 20], [21, 21, 21]], fixed: [],
  },
  'rigid-self-referential-carrier': {
    records: [[20, 20, 20], [21, 20, 20]], fixed: [],
  },
};
console.log('\n4b/5. tagged representations and recursive carriers');
for (const [id, { records, fixed }] of Object.entries(carriers)) {
  const carrierTriples = encode(records, tags);
  const carrierGroup = records.length ?
    tripleSymmetries(carrierTriples, fixed) : null;
  const triples = [...encode(premises, tags), ...carrierTriples];
  const group = tripleSymmetries(triples, fixed);
  const f = taggedCandidate(forward, tags);
  const r = taggedCandidate(reverse, tags);
  const stab = candidate => group.flatMap((map, index) =>
    taggedAct(map, candidate) === candidate ? [index] : []);
  console.log(id, {
    carrierSymmetries: carrierGroup?.length ?? null,
    carrierRecordsHaveEqualSlots: records.every(([, x, y]) => x === y),
    carrierUnorderedSymmetries: records.length ?
      symmetries(records, 'unordered').length : null,
    symmetries: group.length,
    tagsExchanged: group.some(map => map.get(20) === 21),
    endsExchanged: group.some(map => map.get(K) === B),
    candidatesExchanged: group.some(map => taggedAct(map, f) === r),
    stabilizersEqual: same(stab(f), stab(r)),
  });
}

console.log('\n4c. tag-swapped encoding');
const swappedTags = [21, 20];
const original = encode(premises, tags);
const tagSwapped = encode(premises, swappedTags);
const alignedCandidate = encoding => {
  const tagOf = (record, value) => encoding.find(([address, , v]) =>
    address === record && v === value)[1];
  return JSON.stringify([[tagOf(3, K), K], [tagOf(4, B), B]]
    .sort((l, r) => l[0] - r[0] || l[1] - r[1]));
};
const decode = candidate => {
  const pairs = JSON.parse(candidate);
  return [pairs.find(([tag]) => tag === 20)[1], pairs.find(([tag]) => tag === 21)[1]];
};
const key = set => set.map(triple => JSON.stringify(triple)).sort().join('|');
const tagSwappedIsomorphicTo = permutations([0, 1, 2, 3, 4]).some(image => {
  const map = new Map([...image.map((value, index) => [index, value]),
    [20, 20], [21, 21]]);
  return key(original.map(t => t.map(s => map.get(s)))) === key(tagSwapped);
});
console.log({
  isomorphicWithTagsFixed: tagSwappedIsomorphicTo,
  alignedDecodedOriginal: decode(alignedCandidate(original)),
  alignedDecodedTagSwapped: decode(alignedCandidate(tagSwapped)),
});

// ---------------------------------------------------------------------------
// 6. Output correspondences compatible with every symmetry. A correspondence
// maps the chain's slot pattern to the unrecorded output: identity gives
// [K,B], exchange gives [B,K]. It is compatible with a structure when it
// commutes with every contract symmetry of that structure.
console.log('\n6. compatible correspondences');
const correspondences = { identity: pair => pair, exchange: swap };
let minimumCompatible = Infinity;
for (const { records } of family) {
  for (const contract of ['named', 'anonymous']) {
    const group = symmetries(records, contract);
    const compatible = Object.values(correspondences).filter(kappa =>
      group.every(g => same(act(g, kappa(forward)), kappa(act(g, forward)))));
    minimumCompatible = Math.min(minimumCompatible, compatible.length);
  }
}
console.log({ minimumCompatibleCorrespondences: minimumCompatible });

// ---------------------------------------------------------------------------
// 7. Scope of the one-step result. Feeding a conclusion back records its slot
// order, so the aligned and reversed laws then build different closures. The
// requirements that separate those closures speak about how consequence
// composes, not about any record.
console.log('\n7. iterated closures of a 3-chain');
const chain = [[3, K, A], [4, A, B], [5, B, 9]];
const closure = (records, law) => {
  let current = records.map(([, x, y]) => [x, y]);
  for (;;) {
    const asRecords = current.map((pair, index) => [100 + index, ...pair]);
    const fresh = applyLaw(asRecords, law).map(item => JSON.parse(item))
      .filter(pair => !current.some(existing => same(existing, pair)));
    if (fresh.length === 0) {
      return current.sort((l, r) => l[0] - r[0] || l[1] - r[1]);
    }
    current = [...current, ...fresh];
  }
};
const joined = (pairs, x, z) => pairs.some(([p, q]) =>
  (p === x && q === z) || (p === z && q === x));
// Every path of pairs, of any length, has its ends joined by some pair.
const pathEndsJoined = pairs => {
  const reach = new Map();
  for (const [x] of pairs) {
    const seen = new Set();
    const stack = [x];
    while (stack.length) {
      const node = stack.pop();
      for (const [p, q] of pairs) {
        if (p === node && !seen.has(q)) {
          seen.add(q);
          stack.push(q);
        }
      }
    }
    reach.set(x, seen);
  }
  return [...reach].every(([x, targets]) =>
    [...targets].every(z => z === x || joined(pairs, x, z)));
};
for (const [id, law] of [['aligned', [0, 3]], ['reversed', [3, 0]]]) {
  const pairs = closure(chain, law);
  console.log(id, {
    closure: JSON.stringify(pairs),
    derivedPairs: pairs.length - chain.length,
    pathEndsJoined: pathEndsJoined(pairs),
  });
}
