/**
 * Assumption-by-assumption removal matrix for the repaired addressed
 * representation (R127/R139/R96). The base contract is the one retained by
 * the sharedAddressComposition audit: finite ordered link records, a fixed
 * number of ordered reference slots, distinct link addresses in one shared
 * address space, and address equality as the only observation. Each row
 * removes exactly one of those assumptions (or adds one observer order) and
 * counts, by exhaustive enumeration, which distinctions it identifies or adds,
 * with the first witness pair and whether the compositional non-faithfulness
 * of local single-link descriptors survives the removal.
 */
import { fileURLToPath } from 'node:url';

/** Restricted growth strings: every finite sequence up to global address renaming. */
function restrictedGrowth(width, visit) {
  const value = new Array(width);
  const extend = (index, maximum) => {
    if (index === width) { visit(value); return; }
    for (let next = 0; next <= maximum + 1; next++) {
      value[index] = next;
      extend(index + 1, Math.max(maximum, next));
    }
  };
  if (width === 0) { visit(value); return; }
  value[0] = 0;
  extend(1, 0);
}
const normalize = sequence => {
  const names = new Map();
  return sequence.map(item => {
    if (!names.has(item)) names.set(item, names.size);
    return names.get(item);
  });
};
const text = records => normalize(records.flat()).join(',');
const split = (flat, arities) => {
  const records = [];
  let offset = 0;
  for (const arity of arities) { records.push(flat.slice(offset, offset + arity + 1)); offset += arity + 1; }
  return records;
};
const permutations = count => {
  if (count === 0) return [[]];
  return permutations(count - 1).flatMap(order =>
    Array.from({ length: order.length + 1 }, (_, index) => [...order.slice(0, index), count - 1, ...order.slice(index)]));
};
const flip = ([address, first, second]) => [address, second, first];
const minimum = values => values.reduce((best, value) => (value < best ? value : best));

/** Base classes: ordered records, fixed arity, distinct link addresses. */
function baseClasses(count, arity) {
  const arities = Array(count).fill(arity);
  const classes = [];
  restrictedGrowth(count * (arity + 1), flat => {
    const records = split(flat, arities);
    if (new Set(records.map(([address]) => address)).size === count) classes.push(records);
  });
  return classes;
}

/** Orbit keys of the symmetry introduced by removing one assumption. */
function removalKey(id, count) {
  const orders = permutations(count);
  const masks = Array.from({ length: 2 ** count }, (_, mask) => mask);
  switch (id) {
    case 'ordered-link-records':
      return records => minimum(orders.map(order => text(order.map(index => records[index]))));
    case 'ordered-reference-slots':
      return records => minimum(masks.map(mask => text(records.map((item, index) => ((mask >> index) & 1 ? flip(item) : item)))));
    case 'slot-orientation':
      return records => minimum([text(records), text(records.map(flip))]);
    default:
      throw new Error(`unknown identifying removal ${id}`);
  }
}
/** Local single-link descriptors, read as the removal allows. */
function localKey(id) {
  const local = item => normalize(item).join('');
  switch (id) {
    case 'none': return records => records.map(local).join('|');
    case 'ordered-link-records': return records => records.map(local).sort().join('|');
    case 'ordered-reference-slots': return records => records.map(item => minimum([local(item), local(flip(item))])).join('|');
    case 'slot-orientation': return records => minimum([records.map(local).join('|'), records.map(item => local(flip(item))).join('|')]);
    default: throw new Error(`unknown descriptor reading ${id}`);
  }
}
/** Whether two different classes share all local descriptors. */
function locallyNonFaithful(classes, classKey, descriptorKey) {
  const fibres = new Map();
  for (const records of classes) {
    const descriptor = descriptorKey(records);
    if (!fibres.has(descriptor)) fibres.set(descriptor, new Set());
    fibres.get(descriptor).add(classKey(records));
  }
  return [...fibres.values()].some(fibre => fibre.size > 1);
}

function identifyingRow(id, count, arity) {
  const classes = baseClasses(count, arity);
  const key = removalKey(id, count);
  const first = new Map();
  let witness = null;
  for (const records of classes) {
    const orbit = key(records);
    if (!first.has(orbit)) first.set(orbit, records);
    else if (witness === null) witness = [first.get(orbit), records];
  }
  return {
    links: count, slots: arity, baseClasses: classes.length, classesAfterRemoval: first.size,
    direction: 'IDENTIFIES', identifiedClasses: classes.length - first.size, firstWitness: witness,
    localNonFaithfulnessBefore: locallyNonFaithful(classes, text, localKey('none')),
    localNonFaithfulnessAfter: locallyNonFaithful(classes, key, localKey(id)),
  };
}

function distinctAddressRow(count, arity) {
  let all = 0;
  let witness = null;
  restrictedGrowth(count * (arity + 1), flat => {
    all += 1;
    const records = split(flat, Array(count).fill(arity));
    if (witness === null && new Set(records.map(([address]) => address)).size !== count) witness = records.map(item => [...item]);
  });
  const base = baseClasses(count, arity).length;
  return { links: count, slots: arity, baseClasses: base, classesAfterRemoval: all, direction: 'SEPARATES',
    addedClasses: all - base, firstWitness: witness === null ? null : [witness] };
}

function mixedArityRow(count) {
  let all = 0;
  let witness = null;
  for (let mask = 0; mask < 2 ** count; mask++) {
    const arities = Array.from({ length: count }, (_, index) => ((mask >> index) & 1 ? 2 : 1));
    restrictedGrowth(arities.reduce((sum, arity) => sum + arity + 1, 0), flat => {
      const records = split(flat, arities);
      if (new Set(records.map(([address]) => address)).size !== count) return;
      all += 1;
      if (witness === null && new Set(arities).size > 1) witness = records.map(item => [...item]);
    });
  }
  const base = baseClasses(count, 1).length + baseClasses(count, 2).length;
  return { links: count, slots: '1|2', baseClasses: base, classesAfterRemoval: all, direction: 'SEPARATES',
    addedClasses: all - base, firstWitness: witness === null ? null : [witness] };
}

function observerOrderRow(count, arity) {
  const classes = baseClasses(count, arity);
  const factorial = value => (value <= 1 ? 1 : value * factorial(value - 1));
  const after = classes.reduce((sum, records) => sum + factorial(new Set(records.flat()).size), 0);
  const witness = classes.find(records => new Set(records.flat()).size > 1);
  return { links: count, slots: arity, baseClasses: classes.length, classesAfterRemoval: after, direction: 'SEPARATES',
    addedClasses: after - classes.length, firstWitness: witness === undefined ? null : [witness] };
}

export const WIDTHS = Object.freeze({ oneSlot: [1, 2, 3, 4], twoSlots: [1, 2, 3], mixed: [1, 2, 3] });

export function assumptionRemovalMatrix() {
  const rows = [
    { id: 'ordered-link-records', assumption: 'finite ordered link records', provenance: 'OBSERVER_RESTRICTION',
      removal: 'records are compared up to permutation',
      widths: [...WIDTHS.oneSlot.map(count => identifyingRow('ordered-link-records', count, 1)),
        ...WIDTHS.twoSlots.map(count => identifyingRow('ordered-link-records', count, 2))] },
    { id: 'ordered-reference-slots', assumption: 'ordered reference slots', provenance: 'OBSERVER_RESTRICTION',
      removal: 'each record may exchange its two reference slots independently',
      widths: WIDTHS.twoSlots.map(count => identifyingRow('ordered-reference-slots', count, 2)) },
    { id: 'slot-orientation', assumption: 'a fixed orientation of the reference slots', provenance: 'OBSERVER_RESTRICTION',
      removal: 'every record exchanges its two reference slots together',
      widths: WIDTHS.twoSlots.map(count => identifyingRow('slot-orientation', count, 2)) },
    { id: 'distinct-link-addresses', assumption: 'distinct link addresses in one shared address space',
      provenance: 'ISSUE_CONTRACT_SHARED_ADDRESS_SPACE_WITH_OBSERVER_DISTINCTNESS',
      removal: 'two links may carry the same address',
      widths: [...WIDTHS.oneSlot.map(count => distinctAddressRow(count, 1)),
        ...WIDTHS.twoSlots.map(count => distinctAddressRow(count, 2))] },
    { id: 'fixed-reference-arity', assumption: 'one fixed number of reference slots per link', provenance: 'OBSERVER_RESTRICTION',
      removal: 'each link independently has one or two reference slots',
      widths: WIDTHS.mixed.map(mixedArityRow) },
    { id: 'equality-only-observation', assumption: 'address equality is the only observation', provenance: 'OBSERVER_ADDITION_TESTED',
      removal: 'an observer total order on addresses is also observed',
      widths: [...WIDTHS.oneSlot.map(count => observerOrderRow(count, 1)),
        ...WIDTHS.twoSlots.map(count => observerOrderRow(count, 2))] },
  ];
  const identifying = rows.filter(row => row.widths[0].direction === 'IDENTIFIES');
  return {
    schema: 'rml-assumption-removal-matrix/v1',
    baseContract: [
      'finite ordered link records',
      'ordered reference slots, one or two per link',
      'distinct link addresses in one shared address space',
      'address equality is the only observation',
    ],
    retainedWithoutRemoval: [],
    removedByProbe: { finiteness: 'experiments/assumption-removal/finiteness.mjs' },
    rows,
    results: {
      everyRemovalChangesSomeWidth: rows.every(row => row.widths.some(width =>
        width.classesAfterRemoval !== width.baseClasses)),
      everyIdentifyingRemovalHasAWitness: identifying.every(row => row.widths.some(width => width.firstWitness !== null)),
      localNonFaithfulnessSurvivesEveryIdentifyingRemovalFromTwoLinks: identifying.every(row =>
        row.widths.filter(width => width.links >= 2).every(width => width.localNonFaithfulnessAfter)),
      orientationRemovalIdentifiesLessThanSlotOrderRemoval: rows[2].widths.every((width, index) =>
        width.identifiedClasses <= rows[1].widths[index].identifiedClasses),
    },
    status: 'FINITE_ASSUMPTION_REMOVAL_MATRIX_FOR_THE_RETAINED_CONTRACT',
    claimBoundary: 'Each count is an exhaustive finite enumeration for the listed widths. A removal that identifies classes shows which distinctions rest on that assumption; one that separates classes shows what the assumption excludes. No assumption is thereby shown intrinsic or eliminable for links in general. Finiteness cannot be removed by finite enumeration; finiteness.mjs removes it for finitely presented structures.',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(assumptionRemovalMatrix(), null, 1));
}
