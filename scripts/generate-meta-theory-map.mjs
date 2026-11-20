#!/usr/bin/env node
/**
 * Machine-readable stage map for every upstream 0.0.3 declaration and every
 * non-declaration command: preservation, typed elaboration, native linked
 * elaboration, dependency check, native execution, proof certificate and
 * admission status. Each claimed stage names the evidence that re-executes it;
 * validateMetaTheoryMap() rejects unmapped items, token partition gaps, stale
 * counts, and any claimed stage whose witness is missing or does not
 * re-execute.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { corpusCommands } from '../js/src/rml-meta-theory-native.mjs';
import {
  checkMetaTheoryCertificate, metaTheoryCertificateRegistries,
} from '../js/src/rml-meta-theory-certificates.mjs';
import {
  NATIVE_CASES_PATH, NATIVE_COVERAGE_PATH, NATIVE_PRELUDE_PATH, NATIVE_PROGRAM_PATH, validateNativeEvidence,
} from './generate-meta-theory-native.mjs';
import { CERTIFICATES_PATH, certificateSources, loadCorpus, theoremDependencies } from './generate-meta-theory-certificates.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
export const MAP_PATH = 'test-corpus/meta-theory-coverage/map.json';
export const MAP_SCHEMA = 'rml-meta-theory-map/v1';
const PROPOSITIONS_COVERAGE_PATH = 'test-corpus/formal-propositions/coverage.json';
const PROPOSITIONS_CASES_PATH = 'test-corpus/formal-propositions/cases.json';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const hex = text => Buffer.from(text, 'utf8').toString('hex');

/** Fingerprint of a token slice: one `kind:utf8-hex` line per token. */
export function tokenSha256(tokens) {
  return sha256(`${tokens.map(token => `${token.kind}:${hex(token.text)}`).join('\n')}\n`);
}

/** Every evidence file the map is computed from. */
export function mapEvidence() {
  return {
    corpus: loadCorpus(),
    nativeCoverage: JSON.parse(read(NATIVE_COVERAGE_PATH)),
    nativeCases: JSON.parse(read(NATIVE_CASES_PATH)),
    propositionsCoverage: JSON.parse(read(PROPOSITIONS_COVERAGE_PATH)),
    propositionsCases: JSON.parse(read(PROPOSITIONS_CASES_PATH)),
    certificates: JSON.parse(read(CERTIFICATES_PATH)),
  };
}

const tally = (items, key) => {
  const counts = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (left < right ? -1 : 1)));
};

function declarationRecord(evidence, declaration) {
  const { corpus, nativeCoverage, nativeCases, propositionsCoverage, propositionsCases, certificates } = evidence;
  const module = corpus.module(declaration.language, declaration.module);
  const native = nativeCoverage.declarations.find(entry => entry.address === declaration.address);
  const typed = propositionsCoverage.declarations.find(entry => entry.address === declaration.address);
  const typedCase = propositionsCases.cases.find(item => item.address === declaration.address && item.accepted);
  const certificate = certificates.theorems.find(item => item.theorem === declaration.address);
  let nativeExecution;
  if (native.executionWitness) nativeExecution = { status: 'ablation-witnessed', witness: native.executionWitness };
  else if (declaration.kind === 'theorem') {
    const statement = nativeCases.cases.find(item => item.id === `${declaration.address}-statement`);
    nativeExecution = { status: 'statement-normalized', witness: statement.id };
  } else nativeExecution = { status: 'not-witnessed' };
  const proof = declaration.kind !== 'theorem' ? { status: 'not-applicable' }
    : certificate.status === 'certified'
      ? { status: 'certified', chain: certificate.chain.status, relativeTo: certificate.chain.relativeTo.map(item => item.address) }
      : { status: 'outside-fragment', reason: certificate.reason };
  const relativeToAdmission = certificate?.chain?.relativeTo.some(item => item.upstreamProofStatus === 'admitted') ?? false;
  return {
    address: declaration.address,
    language: declaration.language,
    module: declaration.module,
    kind: declaration.kind,
    preservation: {
      status: 'preserved',
      syntaxRange: declaration.syntaxRange,
      tokenSha256: tokenSha256(module.tokens.slice(...declaration.syntaxRange)),
      dependencyLinks: declaration.dependencies.length,
    },
    typedElaboration: {
      status: typed.status,
      ...(['definition-checked', 'conversion-proof-replayed'].includes(typed.status) ? { witness: typedCase.name } : {}),
    },
    nativeElaboration: { status: native.status, rules: native.rules },
    dependencyCheck: { status: native.dependencyCheck.status, recorded: declaration.dependencies.length },
    nativeExecution,
    proof,
    admission: {
      upstream: declaration.proofStatus,
      typedLayer: typed.status === 'upstream-admitted' ? 'admitted' : 'none',
      certificateChain: relativeToAdmission ? 'relative-to-upstream-admission' : 'none',
    },
  };
}

function commandRecord(evidence, command, analysis) {
  const module = evidence.corpus.module(command.language, command.module);
  const record = {
    id: command.id,
    language: command.language,
    module: command.module,
    kind: command.kind,
    tokenRange: command.tokenRange,
    preservation: { status: 'preserved', tokenSha256: tokenSha256(module.tokens.slice(...command.tokenRange)) },
    elaboration: { status: analysis.status, ...(analysis.reason ? { reason: analysis.reason } : {}) },
  };
  const item = analysis.witness ? evidence.nativeCases.cases.find(entry => entry.id === analysis.witness) : undefined;
  if (['eval', 'compute'].includes(command.kind)) {
    record.execution = { status: item?.value ? 'value' : 'not-executed', witness: analysis.witness };
    if (item?.sourceExpectation !== undefined) {
      record.execution.sourceExpectation = item.sourceExpectation;
      record.execution.sourceExpectationNumbersMatch = item.sourceExpectationNumbersMatch;
    }
    if (item?.counterpart) record.execution.counterpart = { witness: item.counterpart, agrees: item.counterpartAgrees };
  } else if (command.kind === 'check') {
    record.execution = { status: 'target-normalized', witness: analysis.witness, target: analysis.target };
  } else if (['import', 'require-import'].includes(command.kind)) {
    record.execution = { status: 'imports-resolved', targets: analysis.targets };
  } else {
    record.execution = { status: 'scope-checked' };
  }
  return record;
}

function counts(declarations, commands, corpus) {
  return {
    declarations: declarations.length,
    commands: commands.length,
    modules: corpus.formalModules.length,
    declarationsByLanguage: tally(declarations, item => item.language),
    commandsByLanguage: tally(commands, item => item.language),
    commandsByKind: tally(commands, item => item.kind),
    preservation: tally(declarations, item => item.preservation.status),
    typedElaboration: tally(declarations, item => item.typedElaboration.status),
    nativeElaboration: tally(declarations, item => item.nativeElaboration.status),
    dependencyCheck: tally(declarations, item => item.dependencyCheck.status),
    nativeExecution: tally(declarations, item => item.nativeExecution.status),
    proof: tally(declarations, item => item.proof.status),
    upstreamAdmission: tally(declarations, item => item.admission.upstream),
    commandElaboration: tally(commands, item => item.elaboration.status),
    commandExecution: tally(commands, item => item.execution.status),
  };
}

export function metaTheoryMap(evidence = mapEvidence()) {
  const { corpus, nativeCoverage } = evidence;
  const commands = corpusCommands(corpus);
  const analyses = new Map(nativeCoverage.commands.map(record => [record.id, record]));
  const declarations = corpus.declarations.map(declaration => declarationRecord(evidence, declaration));
  const commandRecords = commands.map(command => commandRecord(evidence, command, analyses.get(command.id)));
  return {
    schema: MAP_SCHEMA,
    corpusFingerprint: corpus.fingerprint,
    evidence: {
      nativeProgram: nativeCoverage.programHash,
      nativeCoverage: sha256(read(NATIVE_COVERAGE_PATH)),
      nativeCases: sha256(read(NATIVE_CASES_PATH)),
      propositionsCoverage: sha256(read(PROPOSITIONS_COVERAGE_PATH)),
      propositionsCases: sha256(read(PROPOSITIONS_CASES_PATH)),
      certificates: sha256(read(CERTIFICATES_PATH)),
    },
    counts: counts(declarations, commandRecords, corpus),
    declarations,
    commands: commandRecords,
  };
}

/**
 * Validate a map against the corpus and the evidence. With `reexecute`, every
 * native case and witness and every certificate is re-executed as well.
 */
export function validateMetaTheoryMap(map, evidence = mapEvidence(), { reexecute = false } = {}) {
  const problems = [];
  const { corpus, nativeCoverage, nativeCases, propositionsCoverage, propositionsCases, certificates } = evidence;
  if (map.schema !== MAP_SCHEMA) problems.push('unsupported map schema');
  if (map.corpusFingerprint !== corpus.fingerprint) problems.push('map corpus fingerprint is stale');

  // Completeness: every declaration and command exactly once, nothing else.
  const seen = new Map();
  for (const entry of map.declarations) {
    if (seen.has(entry.address)) problems.push(`duplicate declaration ${entry.address}`);
    seen.set(entry.address, entry);
  }
  for (const declaration of corpus.declarations) if (!seen.has(declaration.address)) problems.push(`unmapped declaration ${declaration.address}`);
  for (const address of seen.keys()) if (!corpus.declarationAt(address)) problems.push(`unknown declaration ${address}`);
  const commands = corpusCommands(corpus);
  const mappedCommands = new Map();
  for (const entry of map.commands) {
    if (mappedCommands.has(entry.id)) problems.push(`duplicate command ${entry.id}`);
    mappedCommands.set(entry.id, entry);
  }
  for (const command of commands) if (!mappedCommands.has(command.id)) problems.push(`unmapped command ${command.id}`);
  const known = new Set(commands.map(command => command.id));
  for (const id of mappedCommands.keys()) if (!known.has(id)) problems.push(`unknown command ${id}`);

  // Partition: declarations and commands tile every module's tokens exactly.
  for (const module of corpus.formalModules) {
    const owner = new Array(module.tokens.length).fill(0);
    const prefix = `rml.formal.${module.language}.${module.name}`;
    const ranges = [
      ...map.declarations.filter(entry => entry.language === module.language && entry.module === module.name)
        .map(entry => entry.preservation.syntaxRange),
      ...map.commands.filter(entry => entry.language === module.language && entry.module === module.name).map(entry => entry.tokenRange),
    ];
    for (const [start, end] of ranges) for (let index = start; index < end; index += 1) owner[index] += 1;
    const gaps = owner.filter(value => value === 0).length;
    const overlaps = owner.filter(value => value > 1).length;
    if (gaps) problems.push(`${prefix}: ${gaps} tokens belong to no declaration or command`);
    if (overlaps) problems.push(`${prefix}: ${overlaps} tokens belong to more than one item`);
  }

  // Preservation fingerprints.
  for (const entry of map.declarations) {
    const declaration = corpus.declarationAt(entry.address);
    if (!declaration) continue;
    const module = corpus.module(declaration.language, declaration.module);
    if (JSON.stringify(entry.preservation.syntaxRange) !== JSON.stringify(declaration.syntaxRange) ||
        entry.preservation.tokenSha256 !== tokenSha256(module.tokens.slice(...declaration.syntaxRange))) {
      problems.push(`${entry.address}: preservation fingerprint differs from the corpus`);
    }
    if (entry.admission.upstream !== declaration.proofStatus) problems.push(`${entry.address}: upstream admission status differs`);
  }
  for (const entry of map.commands) {
    const command = commands.find(item => item.id === entry.id);
    if (!command) continue;
    const module = corpus.module(command.language, command.module);
    if (JSON.stringify(entry.tokenRange) !== JSON.stringify(command.tokenRange) ||
        entry.preservation.tokenSha256 !== tokenSha256(module.tokens.slice(...command.tokenRange))) {
      problems.push(`${entry.id}: preservation fingerprint differs from the corpus`);
    }
  }

  // Every claimed stage names evidence that exists and agrees.
  const nativeByAddress = new Map(nativeCoverage.declarations.map(entry => [entry.address, entry]));
  const casesById = new Map(nativeCases.cases.map(item => [item.id, item]));
  for (const entry of map.declarations) {
    const native = nativeByAddress.get(entry.address);
    const typed = propositionsCoverage.declarations.find(item => item.address === entry.address);
    if (!native || !typed) continue;
    if (entry.typedElaboration.status !== typed.status) problems.push(`${entry.address}: typed elaboration status differs from its evidence`);
    if (['definition-checked', 'conversion-proof-replayed'].includes(entry.typedElaboration.status)) {
      const witness = propositionsCases.cases.find(item => item.name === entry.typedElaboration.witness);
      if (!witness || witness.address !== entry.address || !witness.accepted) problems.push(`${entry.address}: typed elaboration claimed without an accepted case`);
    }
    if (entry.nativeElaboration.status !== native.status || entry.nativeElaboration.rules !== native.rules) {
      problems.push(`${entry.address}: native elaboration claim differs from its evidence`);
    }
    if (entry.dependencyCheck.status !== native.dependencyCheck.status) problems.push(`${entry.address}: dependency check claim differs`);
    const execution = entry.nativeExecution;
    if (execution.status === 'ablation-witnessed') {
      if (JSON.stringify(execution.witness) !== JSON.stringify(native.executionWitness)) {
        problems.push(`${entry.address}: native execution claimed without a recorded ablation witness`);
      }
    } else if (execution.status === 'statement-normalized') {
      const item = casesById.get(execution.witness);
      if (entry.kind !== 'theorem' || !item || item.address !== entry.address) problems.push(`${entry.address}: statement normalization claimed without a case`);
    } else if (execution.status !== 'not-witnessed' || native.executionWitness) {
      problems.push(`${entry.address}: native execution status ${execution.status} does not match its evidence`);
    }
    const certificate = certificates.theorems.find(item => item.theorem === entry.address);
    if (entry.proof.status === 'certified') {
      if (!certificate || certificate.status !== 'certified' || certificate.chain.status !== entry.proof.chain) {
        problems.push(`${entry.address}: proof certified without a certificate`);
      }
    } else if (entry.proof.status === 'outside-fragment') {
      if (!certificate || certificate.status !== 'outside-fragment') problems.push(`${entry.address}: proof status differs from the certificates`);
    } else if (entry.proof.status !== 'not-applicable' || entry.kind === 'theorem') {
      problems.push(`${entry.address}: proof status ${entry.proof.status} does not match the declaration kind`);
    }
  }
  for (const entry of map.commands) {
    const analysis = nativeCoverage.commands.find(item => item.id === entry.id);
    if (!analysis) continue;
    if (entry.elaboration.status !== analysis.status) problems.push(`${entry.id}: elaboration status differs from its evidence`);
    if (entry.execution.status === 'value') {
      const item = casesById.get(entry.execution.witness);
      if (!item || !item.value || item.command !== entry.id) problems.push(`${entry.id}: execution claimed without a value case`);
    }
    if (entry.execution.status === 'target-normalized') {
      const item = casesById.get(entry.execution.witness);
      if (!item || item.command !== entry.id) problems.push(`${entry.id}: check normalization claimed without a case`);
    }
  }

  // Counts must be recomputed exactly.
  const expected = counts(map.declarations, map.commands, corpus);
  if (JSON.stringify(map.counts) !== JSON.stringify(expected)) problems.push('map counts are stale');

  if (reexecute) {
    const native = validateNativeEvidence({
      prelude: read(NATIVE_PRELUDE_PATH), program: read(NATIVE_PROGRAM_PATH), cases: nativeCases, coverage: nativeCoverage,
    });
    problems.push(...native.map(problem => `native evidence: ${problem}`));
    const registries = metaTheoryCertificateRegistries(certificateSources());
    for (const entry of map.declarations.filter(item => item.proof.status === 'certified')) {
      const certificate = certificates.theorems.find(item => item.theorem === entry.address)?.certificate;
      const checked = certificate ? checkMetaTheoryCertificate(registries, certificate,
        { theoremDependencies: theoremDependencies(corpus, entry.address) }) : { accepted: false };
      if (!checked.accepted) problems.push(`${entry.address}: certificate does not re-check`);
    }
  }
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const map = metaTheoryMap();
  const problems = validateMetaTheoryMap(map);
  if (problems.length) throw new Error(`invalid meta-theory map:\n${problems.join('\n')}`);
  const text = `${JSON.stringify(map, null, 2)}\n`;
  if (check) {
    if (read(MAP_PATH) !== text) throw new Error(`stale ${MAP_PATH}; run node scripts/generate-meta-theory-map.mjs`);
  } else {
    mkdirSync(resolve(root, dirname(MAP_PATH)), { recursive: true });
    writeFileSync(resolve(root, MAP_PATH), text);
  }
  console.log(`${check ? 'checked' : 'generated'} ${map.counts.declarations} declarations and ${map.counts.commands} commands`);
  console.log(JSON.stringify(map.counts, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
