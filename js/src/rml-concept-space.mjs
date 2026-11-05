/** The certified-translation concept space (R166/R167, after meta-language#201).
 *
 * Every term a translation certificate uses for its own vocabulary (construct
 * kinds, obligation kinds, discharge kinds, preservation dimensions, authority
 * grants and RML surface-lowering kinds) is bound to exactly one concept of the
 * shared meta-language concept space. The vendored meta-language concept
 * records (the same `concept-records.json` the `meta-language` crate embeds) are
 * reused only on an exact identity match whose definition states the same
 * meaning; anything else is minted as an RML-local record in the `rml.`
 * namespace with the same record shape, so `conceptCorrespondence`,
 * `insertConceptRecord` and `LinkNetwork.toLino` of meta-language consume both.
 *
 * A term is bound through a source alias: the source is `rml:<category>` and
 * the name is the term. Each surface-lowering kind is bound twice: its meaning
 * (`rml:lowering`) and the upstream native-grammar construct it rewrites
 * (`rml:lowering-syntax`), which must be a concept that the kind's own native
 * grammar names. Two lowering kinds of different languages correspond exactly
 * when meta-language's `conceptCorrespondence` finds them `shared`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONCEPT_RECORDS, LinkNetwork, conceptCorrespondence, conceptRecord, currentConceptId } from '#meta-language';
import { LOWERING_KINDS } from './rml-surface-lowering.mjs';

export const CONCEPT_SPACE_SCHEMA = 'rml:certified-concept-space:1';
/** The prefix of every RML-local concept identity. */
export const RML_CONCEPT_NAMESPACE = 'rml.';
/** The source-alias prefix that binds a certificate term to its concept. */
export const RML_ALIAS_SOURCE = 'rml:';
const UPSTREAM_RECORDS_URL = new URL('../vendor/meta-language/js/src/data/concept-records.json', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** The certificate vocabulary, by category. The certified-translation tests pin these lists to the certificate code. */
export const CERTIFIED_VOCABULARY = Object.freeze({
  'construct-kind': Object.freeze(['function', 'data', 'constructor', 'theorem']),
  'obligation-kind': Object.freeze(['assertion', 'theorem', 'assumption', 'termination', 'trust']),
  discharge: Object.freeze(['rml-evaluation', 'rml-structural-decrease', 'unevaluated', 'target-kernel-oracle',
    'bounded-runtime-check-not-proof', 'declared-assumption', 'unproved-general-recursion', 'native-oracle-ci']),
  preservation: Object.freeze(['behavior', 'effects', 'ownership', 'types', 'universes', 'assumptions', 'proof-obligations']),
  authority: Object.freeze(['macros', 'traits', 'runtime', 'external-kernels', 'proof-authority']),
  lowering: Object.freeze(Object.keys(LOWERING_KINDS)),
  'lowering-syntax': Object.freeze(Object.keys(LOWERING_KINDS)),
});

/** The language a lowering kind belongs to, by its prefix. */
const LOWERING_LANGUAGE = Object.freeze({ rust: 'rust', lean: 'lean', rocq: 'rocq' });

/** Upstream concepts reused on an exact identity whose definition is the meaning RML uses. */
const UPSTREAM_BINDINGS = Object.freeze([
  ['construct-kind', 'function', 'function'],
  ['preservation', 'effects', 'program.effects'],
  ['authority', 'macros', 'program.macros-and-notation'],
  // The upstream native-grammar construct each lowering kind rewrites.
  ['lowering-syntax', 'rust-monomorphize', 'grammar.type-parameter-list'],
  ['lowering-syntax', 'rust-instantiation', 'grammar.type-argument-list'],
  ['lowering-syntax', 'rust-struct', 'grammar.structure-item'],
  ['lowering-syntax', 'rust-struct-variant', 'grammar.enumeration-variant'],
  ['lowering-syntax', 'rust-struct-literal', 'grammar.structure-expression'],
  ['lowering-syntax', 'rust-struct-pattern', 'grammar.structure-pattern'],
  ['lowering-syntax', 'rust-tuple-struct', 'grammar.ordered-field-declaration-list'],
  ['lowering-syntax', 'rust-field-read', 'grammar.field-expression'],
  ['lowering-syntax', 'lean-monomorphize', 'grammar.explicit-binder'],
  ['lowering-syntax', 'lean-instantiation', 'grammar.function-application'],
  ['lowering-syntax', 'lean-structure', 'grammar.structure'],
  ['lowering-syntax', 'lean-structure-instance', 'grammar.structure-instance'],
  ['lowering-syntax', 'lean-field-read', 'grammar.projection'],
  ['lowering-syntax', 'rocq-monomorphize', 'grammar.single-binder'],
  ['lowering-syntax', 'rocq-instantiation', 'grammar.function-application'],
  ['lowering-syntax', 'rocq-record', 'grammar.record-command'],
  ['lowering-syntax', 'rocq-record-instance', 'grammar.record-fields-literal'],
  ['lowering-syntax', 'rocq-projection', 'grammar.projection-term'],
].map(binding => Object.freeze(binding)));

const local = (id, phrase, definition, constraints, terms, languageAliases = []) => Object.freeze({
  id: `${RML_CONCEPT_NAMESPACE}${id}`, phrase, role: 'concept', definition, constraints: Object.freeze(constraints),
  sourceAliases: Object.freeze([...languageAliases.map(([source, name]) => Object.freeze({ source, name })),
    ...terms.map(([category, term]) => Object.freeze({ source: `${RML_ALIAS_SOURCE}${category}`, name: term }))]),
  formerNames: Object.freeze([]),
});
const NOT_UPSTREAM = 'No meta-language concept record has this exact meaning; RML mints it under the rml namespace until an upstream record exists.';

/** RML-local concept records, in the meta-language record shape. */
export const RML_CONCEPT_RECORDS = Object.freeze([
  // Construct kinds.
  local('certified.data-type', 'data type', 'A closed algebraic data type: finitely many constructors with fixed field types, possibly recursive.',
    [NOT_UPSTREAM, 'Records, structures and struct variants reach a certificate as data types after RML surface lowering.'],
    [['construct-kind', 'data']], [['Rust', 'enum'], ['Lean', 'inductive'], ['Rocq', 'Inductive']]),
  local('certified.data-constructor', 'data constructor', 'One constructor of a closed algebraic data type, applied to exactly its fields.',
    [NOT_UPSTREAM], [['construct-kind', 'constructor']]),
  local('certified.theorem', 'theorem', 'A named proposition that a certificate either discharges by RML evaluation or keeps as an open obligation.',
    [NOT_UPSTREAM, 'A theorem is never discharged by a target kernel; kernels are oracles.'],
    [['construct-kind', 'theorem'], ['obligation-kind', 'theorem']], [['Lean', 'theorem'], ['Rocq', 'Theorem']]),
  // Obligation kinds.
  local('certified.runtime-assertion', 'runtime assertion', 'A closed condition main checks while it runs; RML discharges it by running main or refutes it when main aborts on it.',
    [NOT_UPSTREAM], [['obligation-kind', 'assertion']], [['Rust', 'assert!']]),
  local('certified.emitter-assumption', 'emitter assumption', 'A statement an emitter relies on that the certificate lists and never discharges.',
    [NOT_UPSTREAM], [['obligation-kind', 'assumption']]),
  local('certified.termination', 'termination', 'The obligation that every call of a recursive function returns.',
    [NOT_UPSTREAM, 'Discharged only by an RML structural-decrease derivation that agrees with the archive.'], [['obligation-kind', 'termination']]),
  local('certified.trusted-step', 'trusted step', 'A step of the translation that is trusted host code, recorded as an open obligation instead of hidden.',
    [NOT_UPSTREAM], [['obligation-kind', 'trust']]),
  // Discharge kinds.
  local('certified.discharge.rml-evaluation', 'discharge by RML evaluation', 'A closed goal is decided by RML evaluating the certified intermediate program.',
    [NOT_UPSTREAM], [['discharge', 'rml-evaluation']]),
  local('certified.discharge.rml-structural-decrease', 'discharge by RML structural decrease', 'Termination follows from a parameter that RML finds structurally smaller on every recursive call, as the archive also records.',
    [NOT_UPSTREAM], [['discharge', 'rml-structural-decrease']]),
  local('certified.discharge.unevaluated', 'unevaluated goal', 'A closed goal that RML has not evaluated, so it stays open.',
    [NOT_UPSTREAM], [['discharge', 'unevaluated']]),
  local('certified.discharge.target-kernel-oracle', 'target kernel oracle', 'A goal left to a target proof kernel, whose acceptance is oracle evidence and never an RML discharge.',
    [NOT_UPSTREAM], [['discharge', 'target-kernel-oracle']]),
  local('certified.discharge.bounded-runtime-check', 'bounded runtime check', 'A goal checked by running a bounded executable test, which is not a proof.',
    [NOT_UPSTREAM], [['discharge', 'bounded-runtime-check-not-proof']]),
  local('certified.discharge.declared-assumption', 'declared assumption', 'An obligation that holds by assumption and is listed as assumed.',
    [NOT_UPSTREAM], [['discharge', 'declared-assumption']]),
  local('certified.discharge.unproved-general-recursion', 'unproved general recursion', 'Recursion without a structurally decreasing parameter, or through a call cycle, whose termination is not proved.',
    [NOT_UPSTREAM], [['discharge', 'unproved-general-recursion']]),
  local('certified.discharge.native-oracle-ci', 'native oracle in continuous integration', 'A goal observed by native toolchains in continuous integration, which is oracle evidence only.',
    [NOT_UPSTREAM], [['discharge', 'native-oracle-ci']]),
  // Preservation dimensions (effects reuses program.effects).
  local('certified.preservation.behavior', 'behavior', 'The ordered observable output of a program and whether it completes or aborts.',
    [NOT_UPSTREAM], [['preservation', 'behavior']]),
  local('certified.preservation.ownership', 'ownership', 'The discipline that governs who owns, borrows and drops a value.',
    [NOT_UPSTREAM], [['preservation', 'ownership']]),
  local('certified.preservation.types', 'types', 'The types a program declares and checks.',
    [NOT_UPSTREAM, 'meta-language program.types-and-universes joins types with universes; RML keeps the two dimensions distinct, so neither reuses it.'],
    [['preservation', 'types']]),
  local('certified.preservation.universes', 'universes', 'The universe hierarchy the declared types live in.',
    [NOT_UPSTREAM, 'meta-language program.types-and-universes joins types with universes; RML keeps the two dimensions distinct, so neither reuses it.'],
    [['preservation', 'universes']]),
  local('certified.preservation.assumptions', 'assumptions', 'The statements a translation relies on without proving them.',
    [NOT_UPSTREAM], [['preservation', 'assumptions']]),
  local('certified.preservation.proof-obligations', 'proof obligations', 'The goals a translation must discharge, with their discharge status.',
    [NOT_UPSTREAM, 'meta-language program.proof-terms-and-tactics names the proofs a program writes, not the goals a translation owes.'],
    [['preservation', 'proof-obligations']]),
  // Authority grants (macros reuses program.macros-and-notation).
  local('certified.authority.traits', 'traits', 'Type classes and traits that select an implementation by type.',
    [NOT_UPSTREAM], [['authority', 'traits']]),
  local('certified.authority.runtime', 'runtime', 'Host runtime code outside the certified program.',
    [NOT_UPSTREAM], [['authority', 'runtime']]),
  local('certified.authority.external-kernels', 'external kernels', 'Proof kernels and compilers outside RML.',
    [NOT_UPSTREAM], [['authority', 'external-kernels']]),
  local('certified.authority.proof-authority', 'proof authority', 'The checker whose verdict discharges an obligation.',
    [NOT_UPSTREAM], [['authority', 'proof-authority']]),
  // What each RML surface-lowering kind means.
  local('lowering.record-type', 'record type', 'A product type with named or positional fields, lowered to a single-constructor data type with one accessor per field read.',
    [NOT_UPSTREAM, 'A Rust struct or tuple struct, a Lean structure and a Rocq record share this concept.'],
    [['lowering', 'rust-struct'], ['lowering', 'rust-tuple-struct'], ['lowering', 'lean-structure'], ['lowering', 'rocq-record']]),
  local('lowering.record-construction', 'record construction', 'A value of a record type written with its fields, lowered to the constructor applied to the fields in declaration order.',
    [NOT_UPSTREAM], [['lowering', 'rust-struct-literal'], ['lowering', 'lean-structure-instance'], ['lowering', 'rocq-record-instance']]),
  local('lowering.field-projection', 'field projection', 'The read of one field of a record value, lowered to a call of a generated accessor.',
    [NOT_UPSTREAM], [['lowering', 'rust-field-read'], ['lowering', 'lean-field-read'], ['lowering', 'rocq-projection']]),
  local('lowering.record-pattern', 'record pattern', 'A pattern that names fields of a record, lowered to a positional constructor pattern with wildcards for omitted fields.',
    [NOT_UPSTREAM], [['lowering', 'rust-struct-pattern']]),
  local('lowering.named-field-constructor', 'named field constructor', 'A constructor of a data type whose fields are named, lowered to a positional constructor.',
    [NOT_UPSTREAM], [['lowering', 'rust-struct-variant']]),
  local('lowering.type-parameter-monomorphization', 'type parameter monomorphization', 'A declaration with explicit type parameters, copied once per explicit instantiation under a fresh name.',
    [NOT_UPSTREAM, 'Only explicit instantiations are monomorphized; inference, bounds and universe parameters are refused.'],
    [['lowering', 'rust-monomorphize'], ['lowering', 'lean-monomorphize'], ['lowering', 'rocq-monomorphize']]),
  local('lowering.explicit-type-instantiation', 'explicit type instantiation', 'A use of a generic declaration with its type arguments written out, lowered to the monomorphized copy.',
    [NOT_UPSTREAM], [['lowering', 'rust-instantiation'], ['lowering', 'lean-instantiation'], ['lowering', 'rocq-instantiation']]),
]);

/** The upstream records the space reuses, each with the RML term aliases appended. */
function boundUpstreamRecords() {
  const byId = new Map();
  for (const [category, term, id] of UPSTREAM_BINDINGS) {
    const record = conceptRecord(id);
    if (!record) throw new Error(`no meta-language concept record is named ${id}`);
    if (!byId.has(id)) byId.set(id, { ...record, sourceAliases: [...record.sourceAliases] });
    byId.get(id).sourceAliases.push({ source: `${RML_ALIAS_SOURCE}${category}`, name: term });
  }
  return [...byId.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** Every record of the space: the reused upstream records (with RML aliases), then the RML-local records. */
export function conceptSpaceRecords() {
  return [...boundUpstreamRecords(), ...RML_CONCEPT_RECORDS];
}

/** The register both runtimes read: the upstream fingerprint, every record and every binding. */
export function certifiedConceptSpace() {
  const upstreamText = readFileSync(UPSTREAM_RECORDS_URL);
  const records = conceptSpaceRecords();
  const bindings = [];
  for (const [category, terms] of Object.entries(CERTIFIED_VOCABULARY)) {
    for (const term of terms) {
      const owners = records.filter(record => record.sourceAliases.some(alias => alias.source === `${RML_ALIAS_SOURCE}${category}` && alias.name === term));
      if (owners.length !== 1) throw new Error(`${category} ${term} is bound to ${owners.length} concepts`);
      const id = owners[0].id;
      bindings.push({ category, term, concept: id, origin: id.startsWith(RML_CONCEPT_NAMESPACE) ? 'rml' : 'upstream' });
    }
  }
  return { schema: CONCEPT_SPACE_SCHEMA,
    upstream: { package: 'meta-language', file: 'js/vendor/meta-language/js/src/data/concept-records.json', records: CONCEPT_RECORDS.length, sha256: sha256(upstreamText) },
    records, bindings };
}

let cached;
/** The register, computed once. */
function space() { return (cached ??= certifiedConceptSpace()); }

/** The register as committed JSON text. */
export function conceptSpaceJson(value = space()) { return `${JSON.stringify(value, null, 2)}\n`; }

/** The sha256 that certificates pin: the register's JSON text. */
export function conceptSpaceSha256() { return sha256(conceptSpaceJson()); }

/** The concept a certificate term is bound to, `{ concept, origin }`, or undefined. */
export function conceptOf(category, term) {
  const binding = space().bindings.find(item => item.category === category && item.term === term);
  return binding ? { concept: binding.concept, origin: binding.origin } : undefined;
}

/**
 * The concept space as a meta-language link network: every record inserted
 * with meta-language's own `insertConceptRecord`, so the term aliases are alias
 * links on the concept links. `toLino()` of the result is the committed fixture.
 */
export function conceptSpaceNetwork(value = space()) {
  const network = new LinkNetwork();
  for (const record of value.records) network.insertConceptRecord(record);
  return network;
}

/**
 * Relates two certificate terms through meta-language's `conceptCorrespondence`
 * over the space's records: `shared` exactly when both terms are bound to one
 * concept.
 */
export function termCorrespondence(category, first, second, otherCategory = category) {
  return conceptCorrespondence({ source: `${RML_ALIAS_SOURCE}${category}`, name: first }, { source: `${RML_ALIAS_SOURCE}${otherCategory}`, name: second },
    { records: space().records });
}

/**
 * Checks a register against the exact-match discipline. Returns problems
 * `{ kind, subject, message }`; an empty list means the space holds.
 */
export function checkConceptSpace(value = space()) {
  const problems = [];
  const problem = (kind, subject, message) => problems.push({ kind, subject, message });
  if (value.schema !== CONCEPT_SPACE_SCHEMA) problem('schema', value.schema, 'unknown concept-space schema');
  const upstreamAliases = new Set(CONCEPT_RECORDS.flatMap(record => record.sourceAliases.map(alias => `${alias.source}\u0000${alias.name}`)));
  const ids = new Set();
  for (const record of value.records) {
    if (ids.has(record.id)) problem('duplicate-concept', record.id, 'a concept identity is minted twice');
    ids.add(record.id);
    const upstream = conceptRecord(record.id);
    if (record.id.startsWith(RML_CONCEPT_NAMESPACE)) {
      if (upstream) problem('shadowed-upstream-concept', record.id, 'an RML-local identity collides with a meta-language identity or former name');
      for (const alias of record.sourceAliases) {
        if (!alias.source.startsWith(RML_ALIAS_SOURCE) && upstreamAliases.has(`${alias.source}\u0000${alias.name}`)) {
          problem('ambiguous-spelling', `${record.id} ${alias.source}:${alias.name}`, 'an RML-local record repeats a spelling meta-language already gives a concept; reuse that concept instead');
        }
      }
      if (!record.sourceAliases.some(alias => alias.source.startsWith(RML_ALIAS_SOURCE))) problem('unused-concept', record.id, 'an RML-local record binds no certificate term');
    } else {
      if (!upstream || upstream.id !== record.id || currentConceptId(record.id) !== record.id) problem('inexact-upstream-concept', record.id, 'a reused concept must be named by its exact current meta-language identity');
      else {
        const own = record.sourceAliases.filter(alias => !alias.source.startsWith(RML_ALIAS_SOURCE));
        if (JSON.stringify(own) !== JSON.stringify(upstream.sourceAliases) || record.definition !== upstream.definition || record.phrase !== upstream.phrase) {
          problem('altered-upstream-concept', record.id, 'a reused meta-language record must be kept unchanged apart from the RML term aliases');
        }
      }
    }
  }
  for (const [category, terms] of Object.entries(CERTIFIED_VOCABULARY)) {
    for (const term of terms) {
      const owners = value.records.filter(record => record.sourceAliases.some(alias => alias.source === `${RML_ALIAS_SOURCE}${category}` && alias.name === term));
      if (owners.length === 0) problem('unbound-term', `${category} ${term}`, 'a certificate term has no concept');
      if (owners.length > 1) problem('ambiguous-term', `${category} ${term}`, 'a certificate term is bound to several concepts');
      if (category === 'lowering-syntax' && owners.length === 1) {
        const language = LOWERING_LANGUAGE[term.split('-')[0]];
        if (!owners[0].sourceAliases.some(alias => alias.source === `native:${language}`)) {
          problem('foreign-syntax', `${term} ${owners[0].id}`, `the bound construct is not named by the native ${language} grammar`);
        }
      }
    }
  }
  for (const record of value.records) {
    for (const alias of record.sourceAliases.filter(item => item.source.startsWith(RML_ALIAS_SOURCE))) {
      const category = alias.source.slice(RML_ALIAS_SOURCE.length);
      if (!CERTIFIED_VOCABULARY[category]?.includes(alias.name)) problem('unknown-term', `${category} ${alias.name}`, 'a concept binds a term no certificate uses');
    }
  }
  const derived = value.records.flatMap(record => record.sourceAliases.filter(alias => alias.source.startsWith(RML_ALIAS_SOURCE))
    .map(alias => `${alias.source.slice(RML_ALIAS_SOURCE.length)} ${alias.name} ${record.id}`)).sort();
  const claimed = (value.bindings ?? []).map(binding => `${binding.category} ${binding.term} ${binding.concept}`).sort();
  if (JSON.stringify(derived) !== JSON.stringify(claimed)) problem('bindings-mismatch', 'bindings', 'the binding list differs from the record aliases');
  for (const binding of value.bindings ?? []) {
    if (binding.origin !== (binding.concept.startsWith(RML_CONCEPT_NAMESPACE) ? 'rml' : 'upstream')) problem('origin-mismatch', `${binding.category} ${binding.term}`, 'a binding names the wrong origin');
  }
  return problems;
}

/**
 * The `concepts` section of a certificate: the register digest and the concept
 * of every term the certificate uses, in category then first-use order.
 */
export function certificateConceptsForm(used) {
  const entries = [];
  for (const category of Object.keys(CERTIFIED_VOCABULARY)) {
    for (const term of [...new Set(used[category] ?? [])]) {
      const binding = conceptOf(category, term);
      if (!binding) throw new Error(`certificate term ${category} ${term} has no concept`);
      entries.push(['concept', ['category', category], ['term', term], ['id', binding.concept], ['origin', binding.origin]]);
    }
  }
  return ['concepts', ['schema', CONCEPT_SPACE_SCHEMA], ['sha256', conceptSpaceSha256()], ['count', String(entries.length)], ...entries];
}
