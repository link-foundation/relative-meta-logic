/**
 * Provenance of one local verifier trace (R143/R144). The local verifier step
 * of rml-foundation-search.mjs is executed as the linked Horn clauses of
 * lib/meta-theory/horn-local-verifier.lino on the generic Horn resolver, and
 * every operation it uses is removed one at a time: each linked clause, each
 * declared reading replacement, each resolver law, and each remaining host
 * operation. The same Links are also re-represented (renamed, reordered,
 * slot-reversed, duplicated, relocated, replayed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HornResolution, HORN_LAWS } from '../../js/src/rml-horn-resolution.mjs';
import {
  decodeRelationalBits,
  decodeRelationalList,
  encodeRelationalBits,
  encodeRelationalList,
} from '../../js/src/rml-relational-kernel.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
export const VERIFIER_SOURCE = read('../../lib/meta-theory/horn-local-verifier.lino');
export const corpus = JSON.parse(read('../../test-corpus/verifier-provenance/cases.json'));
const BOUNDS = { captureProof: false, maxSteps: 200_000, maxDepth: 4096, maxAnswers: 64 };
const PROBE_CASES = 7;

const rename = ({ scale, offset }) => value => offset + scale * value;
/** The cases with the renamed case expanded from its source. */
export function expandedCases() {
  const map = rename(corpus.renaming);
  return corpus.cases.map(item => {
    if (item.renamedFrom === undefined) return item;
    const source = corpus.cases.find(other => other.id === item.renamedFrom);
    const records = list => list.map(record => record.map(map));
    return { id: item.id, description: source.description.map(map), mappings: records(source.mappings),
      records: records(source.records), candidates: source.candidates.map(map) };
  });
}

// Address codecs: the injective decimal codec, and a removal that maps every
// address to one code (and so decodes every code as address 0).
const injective = {
  encode: value => encodeRelationalBits(String(value)),
  decode: bits => {
    const text = decodeRelationalBits(bits);
    if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('invalid verifier address code');
    return Number(text);
  },
};
const collapsed = { encode: () => encodeRelationalBits('x'), decode: bits => (decodeRelationalBits(bits), 0) };
const address = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('verifier addresses must be nonnegative integers');
  return value;
};
const record = encode => value => {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('verifier records must be addressed triples');
  return ['rec', ...value.map(encode)];
};

/** One verifier query; the host still allocates trace addresses and classifies multiplicity. */
export function runCase(resolver, item, { ablatedLaws = [], maxAnswers = BOUNDS.maxAnswers, codec = injective } = {}) {
  const encode = record(value => codec.encode(address(value)));
  const goal = ['local-match', encode(item.description), encodeRelationalList(item.mappings.map(encode)),
    encodeRelationalList(item.records.map(encode)),
    encodeRelationalList(item.candidates.map(value => codec.encode(address(value)))), '?match'];
  let result;
  try {
    result = resolver.query(goal, { ...BOUNDS, maxAnswers, ablatedLaws });
  } catch (error) {
    if (!/bound exceeded/.test(error.message)) throw error;
    return { cell: 'BOUND', error: error.message };
  }
  let matches;
  try {
    matches = result.answers.map(({ goal: answer }) => {
      const [tag, description, concrete, witnesses] = answer.at(-1);
      if (tag !== 'match') throw new Error('invalid match');
      const number = codec.decode;
      return { description: number(description), concrete: number(concrete),
        witnesses: decodeRelationalList(witnesses).map(number) };
    });
  } catch {
    return { cell: 'INVALID' };
  }
  const traceRecords = matches.flatMap((match, index) => {
    const root = 200 + 10 * index;
    return [[root, match.description, match.concrete],
      ...match.witnesses.map((address, position) => [root + position + 1, root, address])];
  });
  const cardinality = matches.length === 0 ? 'ZERO' : matches.length === 1 ? 'ONE' : 'MANY';
  return { cell: cardinality, cardinality, matches, traceRecords };
}

export function applyVerifierReplacement(source, replacement) {
  let changed = source;
  for (const [before, after] of replacement.replace) {
    if (changed.split(before).length !== 2) throw new Error(`verifier replacement ${replacement.id} no longer matches`);
    changed = changed.replace(before, after);
  }
  return changed;
}
export function clauseNames(source = VERIFIER_SOURCE) {
  return HornResolution.fromSource(source).clauses().map(clause => clause.name);
}

/** The full removal matrix: one row per removed or replaced operation. */
export function removalMatrix() {
  const cases = expandedCases();
  const baseResolver = HornResolution.fromSource(VERIFIER_SOURCE);
  const run = (resolver, options) => cases.map(item => runCase(resolver, item, options));
  const baseline = run(baseResolver);
  const cells = results => Object.fromEntries(results.map((result, index) => {
    const reference = baseline[index];
    const sameTrace = JSON.stringify(result.traceRecords) === JSON.stringify(reference.traceRecords);
    const mark = result.cardinality !== undefined && result.cardinality === reference.cardinality && !sameTrace ? '*' : '';
    return [cases[index].id, `${result.cell}${mark}`];
  }));
  const changed = row => Object.entries(row).filter(([id, cell]) => cell !== baseline[cases.findIndex(item => item.id === id)].cell).map(([id]) => id);
  const rows = [{ kind: 'baseline', id: 'none', cells: cells(baseline) }];
  for (const clause of baseResolver.clauses()) {
    const resolver = new HornResolution(baseResolver.clauses().filter(other => other.name !== clause.name));
    rows.push({ kind: 'linked-clause', id: clause.name, cells: cells(run(resolver)) });
  }
  for (const replacement of corpus.replacements) {
    rows.push({ kind: 'linked-replacement', id: replacement.id,
      cells: cells(run(HornResolution.fromSource(applyVerifierReplacement(VERIFIER_SOURCE, replacement)))) });
  }
  for (const law of HORN_LAWS) {
    rows.push({ kind: 'resolver-law', id: law, cells: cells(run(baseResolver, { ablatedLaws: [law] })) });
  }
  rows.push({ kind: 'host-operation', id: 'exhaustive-answer-enumeration',
    cells: cells(run(baseResolver, { maxAnswers: 1 })) });
  rows.push({ kind: 'host-operation', id: 'injective-address-codec',
    cells: cells(run(baseResolver, { codec: collapsed })) });
  for (const row of rows) row.changed = changed(row.cells);
  const necessary = kind => rows.filter(row => row.kind === kind && row.changed.length > 0).map(row => row.id);
  const noCaseChanged = kind => rows.filter(row => row.kind === kind && row.changed.length === 0).map(row => row.id);
  const byId = Object.fromEntries(cases.map((item, index) => [item.id, baseline[index]]));
  const multiplicityRow = rows.find(row => row.id === 'presence-as-proof-multiplicity');
  const reversedRow = rows.find(row => row.id === 'reversed-reading');
  const map = rename(corpus.renaming);
  const renamedTrace = byId['complete-local-match'].traceRecords.map(([root, first, second], index) =>
    index === 0 ? [root, map(first), map(second)] : [root, first, map(second)]);
  const matchSet = result => result.matches.map(match => JSON.stringify(match)).sort();
  return {
    schema: 'rml-local-verifier-provenance/v1',
    verifierSource: 'lib/meta-theory/horn-local-verifier.lino',
    probe: 'rml-foundation-search.mjs linkedVerifierStep (cases 1-7 reproduced exactly)',
    cases: cases.map(item => item.id),
    baselineTraces: Object.fromEntries(cases.map((item, index) => [item.id, baseline[index].traceRecords])),
    rows,
    necessary: {
      linkedClauses: necessary('linked-clause'),
      readingReplacements: necessary('linked-replacement'),
      resolverLaws: necessary('resolver-law'),
      hostOperations: necessary('host-operation'),
    },
    noCaseChanged: {
      linkedClauses: noCaseChanged('linked-clause'),
      readingReplacements: noCaseChanged('linked-replacement'),
      resolverLaws: noCaseChanged('resolver-law'),
      hostOperations: noCaseChanged('host-operation'),
    },
    representation: {
      renamingPreservesTraceUpToRenaming: byId['renamed-complete-local-match'].cardinality === 'ONE' &&
        JSON.stringify(byId['renamed-complete-local-match'].traceRecords) === JSON.stringify(renamedTrace),
      recordOrderPreservesMatchSet: JSON.stringify(matchSet(byId['reordered-two-concrete-records'])) ===
        JSON.stringify(matchSet(byId['two-concrete-records'])),
      recordOrderPreservesTraceSequence: JSON.stringify(byId['reordered-two-concrete-records'].traceRecords) ===
        JSON.stringify(byId['two-concrete-records'].traceRecords),
      slotReversalForwardReading: byId['slot-reversed-complete-local-match'].cardinality,
      slotReversalReversedReading: reversedRow.cells['slot-reversed-complete-local-match'],
      duplicatedDescriptionSetPresence: byId['duplicated-description'].cardinality,
      duplicatedDescriptionProofMultiplicity: multiplicityRow.cells['duplicated-description'],
      relocatedDescriptionWithMovedMapping: byId['relocated-description'].cardinality,
      relocatedDescriptionWithStaleMapping: byId['relocated-description-stale-mapping'].cardinality,
      traceReplayBySameJoin: byId['trace-replay'].cardinality,
    },
    residualHostOperations: [
      'encoding addresses as binary codes and records as cons lists (injectivity is required)',
      'enumerating all answers up to the declared bound',
      'classifying the answer count as ZERO, ONE or MANY',
      'allocating trace addresses 200 + 10 * match index and publishing trace records',
      'the generic Horn resolver laws listed under resolverLaws',
    ],
    status: 'LOCAL_TRACE_FOLLOWS_FROM_LINKS_ONLY_WITH_DECLARED_READINGS_AND_RESOLVER_LAWS',
    claimBoundary: 'Every verifier decision except the listed host operations is a removable linked clause, and the matrix records which clause, reading and resolver law each case depends on. Two declared readings (correspondence orientation and presence multiplicity) change the trace on the same Links, so the trace does not follow from the input Links alone; this finite matrix neither authorizes a reading nor closes the authority boundary.',
    probeCases: PROBE_CASES,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(removalMatrix(), null, 1));
}
