/**
 * Removal of the last retained assumption of the repaired addressed
 * representation: finiteness (R96/R127). The matrix in matrix.mjs removes the
 * other assumptions by exhaustive finite enumeration and so cannot remove this
 * one. Here finiteness is replaced by finite presentation: an affine one-slot
 * structure has one record [n, n + step] for every integer n >= start (or for
 * every integer when start is null), with distinct link addresses and address
 * equality as the only observation, exactly as in the base contract.
 *
 * Forcing fact of finiteness: every self-embedding (an injective address map
 * sending records to records) of a finite structure is onto, so deleting a
 * link is always observable. This is checked exhaustively over every one-slot
 * base class up to four links. Removing finiteness: the shift x -> x + 1 is a
 * symbolic, non-surjective self-embedding of each ray, so a ray is identified
 * with the proper substructure obtained by deleting its first link. Two
 * address-count invariants then show that this is the only invisible deletion
 * of a ray and that the two-sided line has none.
 */
import { fileURLToPath } from 'node:url';

export const STRUCTURES = Object.freeze([
  { id: 'forward-ray', start: 0, step: 1 },
  { id: 'backward-ray', start: 1, step: -1 },
  { id: 'two-sided-line', start: null, step: 1 },
]);
export const PREFIX_BOUND = 32;
export const DELETION_BOUND = 24;
export const FINITE_WIDTHS = Object.freeze([1, 2, 3, 4]);

function restrictedGrowth(width, visit) {
  const value = new Array(width);
  const extend = (index, maximum) => {
    if (index === width) { visit(value); return; }
    for (let next = 0; next <= maximum + 1; next++) {
      value[index] = next;
      extend(index + 1, Math.max(maximum, next));
    }
  };
  value[0] = 0;
  extend(1, 0);
}

/** Every embedding of one finite structure into another, as the record map it induces. */
function embeddings(records, into) {
  const found = [];
  const choose = (index, chosen) => {
    if (index === records.length) {
      const image = new Map();
      for (const [position, target] of chosen.entries()) {
        for (const slot of [0, 1]) {
          const from = records[position][slot], to = into[target][slot];
          if (image.has(from) && image.get(from) !== to) return;
          image.set(from, to);
        }
      }
      if (new Set(image.values()).size === image.size) found.push([...chosen]);
      return;
    }
    for (let target = 0; target < into.length; target++) choose(index + 1, [...chosen, target]);
  };
  choose(0, []);
  return found;
}

/** Finite control: exhaustively, no one-slot structure embeds onto a proper part of itself. */
export function finiteControl(widths = FINITE_WIDTHS) {
  return widths.map(links => {
    let structures = 0, selfMaps = 0, nonSurjective = 0, invisibleDeletions = 0;
    restrictedGrowth(links * 2, flat => {
      const records = Array.from({ length: links }, (_, index) => flat.slice(index * 2, index * 2 + 2));
      if (new Set(records.map(([address]) => address)).size !== links) return;
      structures += 1;
      for (const map of embeddings(records, records)) {
        selfMaps += 1;
        if (new Set(map).size !== links) nonSurjective += 1;
      }
      // A deletion is invisible when the whole structure still embeds into what remains.
      for (let deleted = 0; deleted < links; deleted++) {
        if (embeddings(records, records.filter((_, index) => index !== deleted)).length > 0) invisibleDeletions += 1;
      }
    });
    return { links, structures, selfEmbeddings: selfMaps, nonSurjectiveSelfEmbeddings: nonSurjective, invisibleDeletions };
  });
}

const record = (structure, n) => [n, n + structure.step];
const addressStart = structure => structure.start + Math.min(0, structure.step);

/**
 * Symbolic shift certificate. Records are affine in n with coefficient 1, written as
 * their constant offsets; the shift adds 1 to every offset.
 */
export function shiftCertificate(structure) {
  const offsets = [0, structure.step];
  const shifted = offsets.map(offset => offset + 1);
  const successor = offsets.map(offset => offset + 1); // record(n + 1) as offsets in n
  const recordsCommute = shifted.every((offset, index) => offset === successor[index]);
  const ray = structure.start !== null;
  const tail = ray ? { ...structure, start: structure.start + 1 } : structure;
  return {
    map: 'x -> x + 1',
    injective: true,
    recordsCommute,
    imageRecordStart: ray ? structure.start + 1 : null,
    imageAddressStart: ray ? addressStart(structure) + 1 : null,
    tailAddressStart: ray ? addressStart(tail) : null,
    surjective: !ray,
    identifiesWithProperSubstructure: ray && recordsCommute && addressStart(structure) + 1 === addressStart(tail),
  };
}

/** Concrete prefix check of the certificate: the shift maps each window exactly onto the next. */
export function prefixCheck(structure, bound = PREFIX_BOUND, recordOf = record) {
  const from = structure.start ?? -bound;
  for (let length = 1; length <= bound; length++) {
    for (let n = from; n < from + length; n++) {
      const image = recordOf(structure, n).map(address => address + 1);
      const target = recordOf(structure, n + 1);
      if (image[0] !== target[0] || image[1] !== target[1]) return { bound, holds: false, failure: { length, n } };
    }
  }
  return { bound, holds: true, failure: null };
}

/**
 * Isomorphism invariants of a structure with at most one link deleted: atoms (referenced
 * addresses that are not links) and unreferenced links. Beyond radius addresses past the
 * deletion and the start every address is both a link and referenced, so a finite window
 * decides both counts; two radii must agree.
 */
export function invariants(structure, deleted = null, radius = 4) {
  const centre = deleted ?? structure.start ?? 0;
  const low = structure.start ?? centre - radius;
  const high = Math.max(centre, structure.start ?? centre) + radius;
  const records = [];
  for (let n = low - (structure.start === null ? radius : 0); n <= high + radius; n++) {
    if (n !== deleted) records.push(record(structure, n));
  }
  const links = new Set(records.map(([address]) => address));
  const referenced = new Set(records.map(([, reference]) => reference));
  const lowest = structure.start === null ? low : addressStart(structure);
  let atoms = 0, unreferencedLinks = 0;
  for (let address = lowest; address <= high; address++) {
    if (referenced.has(address) && !links.has(address)) atoms += 1;
    if (links.has(address) && !referenced.has(address)) unreferencedLinks += 1;
  }
  return { atoms, unreferencedLinks };
}

function deletionProfile(structure, bound = DELETION_BOUND) {
  const base = invariants(structure);
  const from = structure.start ?? -bound;
  const deletions = [];
  for (let deleted = from; deleted < from + bound; deleted++) {
    const narrow = invariants(structure, deleted, 4), wide = invariants(structure, deleted, 8);
    const stable = narrow.atoms === wide.atoms && narrow.unreferencedLinks === wide.unreferencedLinks;
    const visible = narrow.atoms !== base.atoms || narrow.unreferencedLinks !== base.unreferencedLinks;
    deletions.push({ deleted, ...narrow, stable, visible });
  }
  return {
    base,
    deletions,
    invisibleDeletions: deletions.filter(item => !item.visible).map(item => item.deleted),
    everyWindowStable: deletions.every(item => item.stable),
  };
}

export function finitenessRemovalProbe() {
  const control = finiteControl();
  const infinite = STRUCTURES.map(structure => {
    const profile = deletionProfile(structure);
    const certificate = shiftCertificate(structure);
    return {
      id: structure.id,
      start: structure.start,
      step: structure.step,
      certificate,
      prefix: prefixCheck(structure),
      invariants: profile.base,
      firstDeletionInvariants: profile.deletions.slice(0, 3).map(({ deleted, atoms, unreferencedLinks }) =>
        ({ deleted, atoms, unreferencedLinks })),
      invisibleDeletions: profile.invisibleDeletions,
      everyWindowStable: profile.everyWindowStable,
    };
  });
  const rays = infinite.filter(item => item.start !== null);
  return {
    schema: 'rml-finiteness-removal/v1',
    assumption: 'finite ordered link records',
    provenance: 'OBSERVER_RESTRICTION',
    removal: 'finitely presented infinite one-slot structures are admitted',
    forcingFact: 'every self-embedding of a finite structure is onto, so deleting a link is observable',
    finiteControl: control,
    infinite,
    results: {
      finiteStructuresHaveOnlySurjectiveSelfEmbeddings: control.every(item =>
        item.nonSurjectiveSelfEmbeddings === 0 && item.invisibleDeletions === 0),
      finiteControlReproducesAuditedBaseCounts: control.map(item => item.structures).join('/') === '2/10/77/799',
      everyRayIsIdentifiedWithItsTail: rays.every(item =>
        item.certificate.identifiesWithProperSubstructure && item.prefix.holds),
      onlyTheFirstLinkOfARayIsInvisible: rays.every(item =>
        item.invisibleDeletions.length === 1 && item.invisibleDeletions[0] === item.start),
      theTwoSidedLineHasNoInvisibleDeletion: infinite.filter(item => item.start === null)
        .every(item => item.invisibleDeletions.length === 0 && item.certificate.surjective),
      bothSlotOrientationsBehaveAlike: rays.length === 2 && rays[0].invisibleDeletions.length === rays[1].invisibleDeletions.length,
    },
    status: 'FINITENESS_REMOVED_FOR_AFFINE_ONE_SLOT_STRUCTURES',
    claimBoundary: `The finite control is exhaustive up to ${FINITE_WIDTHS.at(-1)} links. The shift certificate is symbolic for every record of each listed affine structure; the prefix check covers windows up to ${PREFIX_BOUND} records and the deletion invariants cover the first ${DELETION_BOUND} deletions, which the invariant windows show to be uniform beyond the start. Removing finiteness identifies a ray with a proper substructure; this is not a claim that finiteness is intrinsic or eliminable for links in general.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(finitenessRemovalProbe(), null, 1));
}
