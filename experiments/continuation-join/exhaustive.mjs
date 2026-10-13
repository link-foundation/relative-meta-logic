/**
 * Exhaustive widths for the conditional continuation join (R145/R146).
 * conditionalContinuationProbe in rml-foundation-search.mjs reports its
 * results for one chain, [3,0,1], [4,1,2] with witness [5,3,4]. This
 * experiment applies the same join (copied verbatim below) to every ordered
 * addressed binary structure with three and with four records, up to address
 * renaming and record order, and counts where each single-chain observation
 * holds in general and where it fails.
 */
import { fileURLToPath } from 'node:url';

/** The join of rml-foundation-search.mjs `conditionalContinuations`. */
export function continuations(records, { unorderedWitness = false, reverseProjection = false } = {}) {
  const pairs = [];
  for (const first of records) {
    for (const second of records) {
      if (first[0] === second[0] || first[2] !== second[1]) continue;
      if (!records.some(witness => {
        if (witness[0] === first[0] || witness[0] === second[0]) return false;
        const forward = witness[1] === first[0] && witness[2] === second[0];
        const backward = witness[1] === second[0] && witness[2] === first[0];
        return forward || (unorderedWitness && backward);
      })) continue;
      const pair = reverseProjection ? [second[2], first[1]] : [first[1], second[2]];
      if (!pairs.some(existing => existing[0] === pair[0] && existing[1] === pair[1])) pairs.push(pair);
    }
  }
  return pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

/** Every supporting (first, second, witness) triple of one output pair. */
function supports(records, pair) {
  const found = [];
  for (const first of records) for (const second of records) {
    if (first[0] === second[0] || first[2] !== second[1] || first[1] !== pair[0] || second[2] !== pair[1]) continue;
    for (const witness of records) {
      if (witness[0] === first[0] || witness[0] === second[0]) continue;
      if (witness[1] === first[0] && witness[2] === second[0]) found.push([first[0], second[0], witness[0]]);
    }
  }
  return found;
}

function restrictedGrowth(width, visit) {
  const value = new Array(width);
  const extend = (index, maximum) => {
    if (index === width) { visit(value); return; }
    for (let next = 0; next <= maximum + 1; next++) { value[index] = next; extend(index + 1, Math.max(maximum, next)); }
  };
  value[0] = 0;
  extend(1, 0);
}
const normalize = sequence => {
  const names = new Map();
  return sequence.map(item => { if (!names.has(item)) names.set(item, names.size); return names.get(item); });
};
const permutations = count => (count === 0 ? [[]] : permutations(count - 1).flatMap(order =>
  Array.from({ length: order.length + 1 }, (_, index) => [...order.slice(0, index), count - 1, ...order.slice(index)])));
const key = pairs => pairs.map(pair => pair.join(',')).join(';');

/** One representative per class of binary structures up to renaming and record order. */
export function structures(count) {
  const orders = permutations(count);
  const seen = new Set();
  const output = [];
  restrictedGrowth(3 * count, flat => {
    const records = Array.from({ length: count }, (_, index) => flat.slice(3 * index, 3 * index + 3));
    if (new Set(records.map(([address]) => address)).size !== count) return;
    const canonical = orders.map(order => normalize(order.flatMap(index => records[index])).join(','))
      .reduce((best, value) => (value < best ? value : best));
    if (seen.has(canonical)) return;
    seen.add(canonical);
    output.push(records);
  });
  return output;
}

export function widthReport(count) {
  const all = structures(count);
  const tally = {
    records: count, classes: all.length, nonEmptyJoin: 0, projectionsDiffer: 0, projectionsAgreeNonEmpty: 0,
    uniformReversalSwapsEveryPairFailures: 0, unorderedWitnessChangesJoin: 0, conclusionAlreadyRecorded: 0,
    selfPairs: 0, extensionLosesAPair: 0, pairsWithRedundantSupport: 0, outputPairs: 0,
  };
  const witnesses = { projectionsAgree: null, unorderedWitnessChanges: null, conclusionAlreadyRecorded: null, redundantSupport: null };
  for (const records of all) {
    const forward = continuations(records);
    const reverse = continuations(records, { reverseProjection: true });
    if (forward.length > 0) tally.nonEmptyJoin += 1;
    if (key(forward) !== key(reverse)) tally.projectionsDiffer += 1;
    else if (forward.length > 0) { tally.projectionsAgreeNonEmpty += 1; witnesses.projectionsAgree ??= records; }
    const reversed = continuations(records.map(([address, first, second]) => [address, second, first]));
    const swapped = forward.map(([first, second]) => [second, first]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    if (key(reversed) !== key(swapped)) tally.uniformReversalSwapsEveryPairFailures += 1;
    if (key(continuations(records, { unorderedWitness: true })) !== key(forward)) {
      tally.unorderedWitnessChangesJoin += 1;
      witnesses.unorderedWitnessChanges ??= records;
    }
    if (forward.some(([first, second]) => records.some(([, left, right]) => left === first && right === second))) {
      tally.conclusionAlreadyRecorded += 1;
      witnesses.conclusionAlreadyRecorded ??= records;
    }
    if (forward.some(([first, second]) => first === second)) tally.selfPairs += 1;
    const fresh = Math.max(...records.flat()) + 1;
    for (const pair of forward) {
      tally.outputPairs += 1;
      const extended = continuations([...records, [fresh, ...pair]]);
      if (!forward.every(([first, second]) => extended.some(other => other[0] === first && other[1] === second))) tally.extensionLosesAPair += 1;
      // Removing one supporting record leaves the pair only if another support exists.
      const support = supports(records, pair);
      const survives = support.some(triple => triple.some(address =>
        key(continuations(records.filter(([other]) => other !== address))).split(';').includes(pair.join(','))));
      if (survives) { tally.pairsWithRedundantSupport += 1; witnesses.redundantSupport ??= records; }
    }
  }
  return { ...tally, firstWitnesses: witnesses };
}

export const WIDTHS = Object.freeze([3, 4]);

export function continuationJoinReport(widths = WIDTHS) {
  const rows = widths.map(widthReport);
  return {
    schema: 'rml-continuation-join-exhaustive/v1',
    join: 'conditionalContinuations of rml-foundation-search.mjs: distinct records P and Q with P.second = Q.first and a third record referencing P.address then Q.address; output [P.first, Q.second]',
    domain: 'every ordered addressed binary structure with distinct record addresses, up to address renaming and record order',
    singleChainObservations: {
      reverseProjectionGivesAnotherPair: 'R146: [0,2] versus [2,0] on the probe chain',
      witnessOrientationDispensable: 'R146: forward and reverse witnesses give the same [0,2] on the probe chain',
      removingAnySupportingRecordRemovesThePair: 'R145: removing any one of the three records reports none',
      witnessConditionHoldsWithTheResultRecord: 'R145: the witness-only structure and its [7,0,2] extension satisfy the same join',
      uniformSlotReversalReversesTheContinuation: 'R145: reversing every slot gives [2,0]',
    },
    rows,
    results: {
      uniformSlotReversalReversesEveryContinuation: rows.every(row => row.uniformReversalSwapsEveryPairFailures === 0),
      joinIsMonotoneUnderAddingTheResultRecord: rows.every(row => row.extensionLosesAPair === 0),
      witnessOrientationDispensableInGeneral: rows.every(row => row.unorderedWitnessChangesJoin === 0),
      projectionsAlwaysDifferWhenNonEmpty: rows.every(row => row.projectionsAgreeNonEmpty === 0),
      supportingRecordsAlwaysIndividuallyNecessary: rows.every(row => row.pairsWithRedundantSupport === 0),
      resultRecordCanAlreadyBePresent: rows.every(row => row.conclusionAlreadyRecorded > 0),
    },
    status: 'SINGLE_CHAIN_OBSERVATIONS_SEPARATED_INTO_GENERAL_AND_CHAIN_SPECIFIC',
    claimBoundary: 'Exhaustive for three and four records only. Reversal equivariance and monotonicity hold at every tested structure (the join is a positive existential query, so monotonicity holds at every width). Witness orientation, distinct projections and individually necessary support are properties of the probe chain, not of the join. No result makes the join intrinsic, authorizes a projection, or derives consequence.',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(continuationJoinReport(), null, 1));
}
