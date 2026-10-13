#!/usr/bin/env node
/**
 * Researcher recipe for the pinned upstream meta-theory corpus and an unseen
 * user-defined logic, through public APIs only. Every value in the report is
 * recomputed here: native execution runs the generated linked program, the
 * certificate is re-checked by the trusted checker, and the unseen logic's
 * answers are replayed by its own package workspace. Rust mirrors this in
 * rust/examples/meta_theory_workflow.rs with the same expected report.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
import { FoundationPackages } from '../js/src/rml-foundation-packages.mjs';
import {
  META_THEORY_NATIVE_PROGRAM, binaryNatural, compactNative, isNativeValue, nativeRegistry, renderNativeValue,
} from '../js/src/rml-meta-theory-native.mjs';
import { checkMetaTheoryCertificate, metaTheoryCertificateRegistries } from '../js/src/rml-meta-theory-certificates.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));
const MAX_STEPS = 200_000;
export const MAPPED_DECLARATION = 'rml.formal.lean.SetSequenceEquivalence.toOrderedUnique';
export const UPSTREAM_COMMAND = 'rml.formal.lean.NetworkExamples#command-17';
export const CERTIFIED_THEOREM = 'rml.formal.lean.SetSequenceEquivalence.set_sequence_equivalence';
export const UNSEEN_QUERY = 'home-reaches-dry';

/** Inverse of the shared fixture compaction: (mt-natural N) to a binary natural. */
export function expandNative(term) {
  if (Array.isArray(term) && term.length === 2 && term[0] === 'mt-natural') return binaryNatural(Number(term[1]));
  return Array.isArray(term) ? term.map(expandNative) : term;
}

/** A natural-number list as a native value: (mt-v (mt-cons n ... mt-nil)). */
export function nativeList(numbers) {
  return ['mt-v', numbers.reduceRight((tail, number) => ['mt-cons', binaryNatural(number), tail], 'mt-nil')];
}

export function nativeCall(registry, address, args) {
  const reduced = registry.reduceResult(META_THEORY_NATIVE_PROGRAM, [address, ...args], { maxSteps: MAX_STEPS });
  if (!isNativeValue(reduced.term)) throw new Error(`${address} did not reach a value`);
  return reduced;
}

/** Theorem dependencies recorded in the native coverage (references that are theorems). */
export function theoremDependencies(coverage, address) {
  const theorems = new Set(coverage.declarations.filter(entry => entry.kind === 'theorem').map(entry => entry.address));
  return coverage.declarations.find(entry => entry.address === address).references.filter(item => theorems.has(item));
}

function unseenPackages() {
  const fixture = json('test-corpus/foundation-packages/unseen-modal-frames.json');
  const manifests = fixture.packages.map(item => ({
    name: item.name, version: item.version, source: read(`test-corpus/foundation-packages/${item.source}`), imports: item.imports,
  }));
  return { fixture, packages: FoundationPackages.fromPackages(manifests, { executionBasis: 'direct-structural' }) };
}

export function runMetaTheoryWorkflow() {
  // 1. Inspect where one upstream declaration stands in every stage.
  const map = json('test-corpus/meta-theory-coverage/map.json');
  const row = map.declarations.find(entry => entry.address === MAPPED_DECLARATION);
  const corpus = FormalCorpus.fromRml(read('lib/meta-theory/upstream-0.0.3.lino'), read('lib/meta-theory/upstream-0.0.3-foundation.lino'));

  // 2. Execute an upstream evaluation command natively, against its source comment and Rocq counterpart.
  const prelude = read('lib/meta-theory/meta-theory-native-prelude.lino');
  const program = read('lib/meta-theory/upstream-0.0.3-native.lino');
  const registry = nativeRegistry(prelude, program);
  const cases = json('test-corpus/meta-theory-native/cases.json').cases;
  const recorded = cases.find(item => item.id === `${UPSTREAM_COMMAND}-execution`);
  const executed = registry.reduceResult(META_THEORY_NATIVE_PROGRAM, expandNative(recorded.request), { maxSteps: MAX_STEPS });
  const counterpart = cases.find(item => item.id === recorded.counterpart);
  const counterpartRun = registry.reduceResult(META_THEORY_NATIVE_PROGRAM, expandNative(counterpart.request), { maxSteps: MAX_STEPS });

  // 3. Run upstream definitions on the researcher's own data, in both languages.
  const newData = [];
  for (const language of ['lean', 'rocq']) {
    const module = `rml.formal.${language}.SetSequenceEquivalence`;
    const ordered = nativeCall(registry, `${module}.toOrderedUnique`, [nativeList([3, 1, 2, 3])]);
    newData.push({ language, definition: 'toOrderedUnique', input: [3, 1, 2, 3], value: renderNativeValue(ordered.term, language) });
    for (const input of [[1, 2, 3], [2, 1]]) {
      const decided = nativeCall(registry, `${module}.IsOrderedUniqueSequence`, [nativeList(input)]);
      newData.push({ language, definition: 'IsOrderedUniqueSequence', input, value: renderNativeValue(decided.term, language) });
    }
  }

  // 4. Re-check a proof certificate and see which upstream admissions it is relative to.
  const certificates = json('test-corpus/meta-theory-certificates/certificates.json');
  const certified = certificates.theorems.find(item => item.theorem === CERTIFIED_THEOREM);
  const registries = metaTheoryCertificateRegistries({
    prelude, program, conversion: read('lib/meta-theory/upstream-0.0.3-native-conversion.lino'),
    universal: read('lib/meta-theory/universal.lino'), verifier: read('lib/meta-theory/proof-verifier.lino'),
  });
  const coverage = json('test-corpus/meta-theory-native/coverage.json');
  const dependencies = theoremDependencies(coverage, CERTIFIED_THEOREM);
  const checked = checkMetaTheoryCertificate(registries, certified.certificate, { theoremDependencies: dependencies });
  const forged = structuredClone(certified.certificate);
  forged.candidate[4][0][3] = ['holds', ['mt-v', 'mt-true']];
  const forgedCheck = checkMetaTheoryCertificate(registries, forged, { theoremDependencies: dependencies });

  // 5. Ask one question of an unseen links-only logic in three foundation versions and replay each answer.
  const { fixture, packages } = unseenPackages();
  const query = fixture.queries.find(item => item.name === UNSEEN_QUERY).query;
  const unseen = fixture.packages.map(({ version }) => {
    const answer = packages.ask({ name: 'modal-frames', version, instance: fixture.instance }, query);
    const replay = packages.replay(answer);
    return { version, status: answer.result.status, outcome: answer.result.outcome.kind, replayAccepted: replay.accepted };
  });

  return {
    schema: 'rml-meta-theory-workflow/v1',
    corpus: { declarations: corpus.declarations.length, fingerprint: corpus.fingerprint },
    map: {
      declarations: map.counts.declarations,
      commands: map.counts.commands,
      row: {
        address: row.address,
        typedElaboration: row.typedElaboration.status,
        nativeElaboration: row.nativeElaboration.status,
        dependencyCheck: row.dependencyCheck.status,
        nativeExecution: row.nativeExecution.status,
        proof: row.proof.status,
      },
    },
    upstreamCommand: {
      id: UPSTREAM_COMMAND,
      value: renderNativeValue(executed.term, 'lean'),
      matchesRecordedCase: JSON.stringify(compactNative(executed.term)) === JSON.stringify(recorded.expected) && executed.steps === recorded.steps,
      counterpart: counterpart.command,
      counterpartValue: renderNativeValue(counterpartRun.term, 'rocq'),
      counterpartAgrees: recorded.counterpartAgrees,
    },
    newData,
    certificate: {
      theorem: CERTIFIED_THEOREM,
      accepted: checked.accepted,
      chain: certified.chain.status,
      relativeTo: certified.chain.relativeTo.map(item => `${item.address} (${item.upstreamProofStatus})`),
      forgedConclusionAccepted: forgedCheck.accepted,
    },
    unseenLogic: { query: UNSEEN_QUERY, answers: unseen },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(runMetaTheoryWorkflow(), null, 2));
}
