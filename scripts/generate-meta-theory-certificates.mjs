#!/usr/bin/env node
/**
 * Produce linked proof certificates for the theorems of the pinned meta-theory
 * corpus from their preserved source proofs, check every produced certificate
 * with the trusted checker, and record each theorem's status honestly:
 * certified (and whether the chain of cited lemmas is itself certified) or
 * outside the certificate fragment with the precise reason.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
import { MetaTheoryNative, corpusCommands, nativeSha256 } from '../js/src/rml-meta-theory-native.mjs';
import {
  checkMetaTheoryCertificate, metaTheoryCertificateRegistries, produceMetaTheoryCertificate,
} from '../js/src/rml-meta-theory-certificates.mjs';
import { NATIVE_CONVERSION_PATH, NATIVE_PRELUDE_PATH, NATIVE_PROGRAM_PATH } from './generate-meta-theory-native.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
export const CERTIFICATES_PATH = 'test-corpus/meta-theory-certificates/certificates.json';
export const UNIVERSAL_PATH = 'lib/meta-theory/universal.lino';
export const VERIFIER_PATH = 'lib/meta-theory/proof-verifier.lino';
export const NATURAL_VERIFIER_PATH = 'lib/meta-theory/proof-verifier-natural.lino';

export function certificateSources() {
  return {
    prelude: read(NATIVE_PRELUDE_PATH), program: read(NATIVE_PROGRAM_PATH), conversion: read(NATIVE_CONVERSION_PATH),
    universal: read(UNIVERSAL_PATH), verifier: read(VERIFIER_PATH), natural: read(NATURAL_VERIFIER_PATH),
  };
}

export function loadCorpus() {
  return FormalCorpus.fromRml(read('lib/meta-theory/upstream-0.0.3.lino'), read('lib/meta-theory/upstream-0.0.3-foundation.lino'));
}

/** Theorems among a declaration's recorded dependency links. */
export function theoremDependencies(corpus, address) {
  return corpus.declarationAt(address).dependencies.filter(item => corpus.declarationAt(item)?.kind === 'theorem');
}

/**
 * Chain status of each certified theorem: closed when every transitively cited
 * lemma is itself certified, otherwise relative to the listed lemmas.
 */
function chains(corpus, records) {
  const byAddress = new Map(records.map(record => [record.theorem, record]));
  const memo = new Map();
  const open = address => {
    if (memo.has(address)) return memo.get(address);
    memo.set(address, []);
    const record = byAddress.get(address);
    const result = new Map();
    for (const cited of record.cites ?? []) {
      const other = byAddress.get(cited);
      if (other.status !== 'certified') {
        result.set(cited, { address: cited, upstreamProofStatus: corpus.declarationAt(cited).proofStatus, status: other.status });
      }
      for (const item of open(cited)) result.set(item.address, item);
    }
    const list = [...result.values()].sort((left, right) => (left.address < right.address ? -1 : 1));
    memo.set(address, list);
    return list;
  };
  for (const record of records) {
    if (record.status !== 'certified') continue;
    const relativeTo = open(record.theorem);
    record.chain = relativeTo.length ? { status: 'relative', relativeTo } : { status: 'closed', relativeTo: [] };
  }
}

export function metaTheoryCertificateArtifacts() {
  const corpus = loadCorpus();
  const sources = certificateSources();
  const commands = corpusCommands(corpus);
  const braceListModules = commands.filter(command => command.kind === 'notation').map(command => `${command.language}.${command.module}`);
  const native = MetaTheoryNative.fromCorpus(corpus, { braceListModules });
  const registries = metaTheoryCertificateRegistries(sources);
  const records = [];
  for (const declaration of corpus.declarations.filter(item => item.kind === 'theorem')) {
    const dependencies = theoremDependencies(corpus, declaration.address);
    const produced = produceMetaTheoryCertificate(native, registries, declaration.address);
    const record = { theorem: declaration.address, language: declaration.language, upstreamProofStatus: declaration.proofStatus,
      theoremDependencies: dependencies };
    if (produced.status !== 'produced') {
      records.push({ ...record, status: 'outside-fragment', reason: produced.reason });
      continue;
    }
    const checked = checkMetaTheoryCertificate(registries, produced.certificate, { theoremDependencies: dependencies });
    if (!checked.accepted) throw new Error(`${declaration.address}: produced certificate is rejected: ${checked.problems.join('; ')}`);
    records.push({ ...record, status: 'certified', cites: produced.certificate.cites, verifierSteps: checked.steps,
      certificate: produced.certificate });
  }
  chains(corpus, records);
  const count = predicate => records.filter(predicate).length;
  return {
    schema: 'rml-meta-theory-certificates/v1',
    corpusFingerprint: corpus.fingerprint,
    programHash: nativeSha256(sources.program),
    conversionHash: nativeSha256(sources.conversion),
    verifierHash: nativeSha256(sources.verifier),
    naturalVerifierHash: nativeSha256(sources.natural),
    theoremCount: records.length,
    certified: count(record => record.status === 'certified'),
    certifiedClosed: count(record => record.chain?.status === 'closed'),
    outsideFragment: count(record => record.status === 'outside-fragment'),
    theorems: records,
  };
}

function main() {
  const check = process.argv.includes('--check');
  const text = `${JSON.stringify(metaTheoryCertificateArtifacts(), null, 2)}\n`;
  if (check) {
    if (read(CERTIFICATES_PATH) !== text) throw new Error(`stale ${CERTIFICATES_PATH}; run node scripts/generate-meta-theory-certificates.mjs`);
  } else {
    mkdirSync(resolve(root, dirname(CERTIFICATES_PATH)), { recursive: true });
    writeFileSync(resolve(root, CERTIFICATES_PATH), text);
  }
  const data = JSON.parse(text);
  console.log(`${check ? 'checked' : 'generated'} ${data.certified}/${data.theoremCount} certified theorems ` +
    `(${data.certifiedClosed} with closed chains), ${data.outsideFragment} outside the certificate fragment`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
