#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';
import { FormalPropositions, linkedPropositionSource } from '../js/src/rml-formal-propositions.mjs';
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';
import { assertCorpusMatchesUpstream } from './check-meta-theory-corpus.mjs';
import { propositionSourceMutations, sourcePropositionRequest, sha256 } from './formal-propositions-cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

export function formalPropositionArtifacts({ inspectSystem } = {}) {
  const kernels = { core: read('lib/meta-theory/formal-semantics.lino'), indexed: read('lib/meta-theory/formal-indexed.lino'),
    records: read('lib/meta-theory/formal-records.lino'), propositions: read('lib/meta-theory/formal-propositions.lino') };
  const source = read('lib/meta-theory/upstream-0.0.3.lino'), foundation = read('lib/meta-theory/upstream-0.0.3-foundation.lino');
  const corpus = FormalCorpus.fromRml(source, foundation), upstream = resolve(root, 'lib/meta-theory/upstream-0.0.3-source');
  assertCorpusMatchesUpstream(upstream, corpus);
  const system = FormalPropositions.fromRml(source, foundation, kernels);
  if (inspectSystem) inspectSystem(system);
  const registry = LinkedProgramRegistry.fromRml(linkedPropositionSource(kernels), { executionBasis: 'direct-structural' });
  const coverage = system.coverage(), cases = [], checked = new Map();
  const add = (name, receipt) => cases.push({ name, address: receipt.address, kind: receipt.kind, dependencies: receipt.dependencies,
    request: receipt.request, expected: receipt.result, accepted: receipt.accepted, steps: receipt.steps });
  const declarations = new Map(coverage.declarations.filter(entry => entry.status === 'definition-checked').map(entry => [entry.address, entry]));
  const visit = address => {
    if (checked.has(address)) return;
    for (const dependency of declarations.get(address).dependencies) visit(dependency);
    const receipt = system.verifyDefinition(address);
    checked.set(address, receipt);
    add(`${address}-definition`, receipt);
  };
  for (const address of declarations.keys()) visit(address);
  for (const declaration of coverage.declarations.filter(entry => entry.status === 'conversion-proof-replayed')) {
    add(`${declaration.address}-retained-proof`, system.verifyTheorem(declaration.address));
  }
  for (const control of propositionSourceMutations(upstream)) {
    const request = sourcePropositionRequest(control.declaration, control.corpus, checked);
    const result = registry.reduce('formal-proposition-checker', request, { maxSteps: 50_000 });
    const accepted = result.term?.[0] === 'fs-ok';
    if (accepted !== control.expectedAccepted) throw new Error(`incorrect mutation outcome ${control.name}`);
    cases.push({ name: control.name, address: control.declaration.address, kind: 'source-mutation', dependencies: control.declaration.dependencies,
      sourceBinding: control.sourceBinding, request, expected: result.term, accepted, steps: result.steps });
  }
  const retainedSources = ['lean/NetworkEquivalence.lean', 'rocq/NetworkEquivalence.v'].map(path => {
    const relative = `lib/meta-theory/upstream-0.0.3-source/drafts/0.0.3/src/${path}`;
    return { path: relative, sha256: sha256(read(relative)) };
  });
  return { coverage, cases: { schema: 'rml-formal-propositions-cases/v1', corpusFingerprint: coverage.corpusFingerprint,
    kernelHash: coverage.kernelHash, retainedSources, propositionTruthVerified: false, fullCorpusVerified: false, cases } };
}

function main() {
  const check = process.argv.includes('--check'), artifacts = formalPropositionArtifacts();
  const directory = resolve(root, 'test-corpus/formal-propositions');
  if (!check) mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) {
    const file = resolve(directory, `${name}.json`), expected = `${JSON.stringify(value, null, 2)}\n`;
    if (check) { if (readFileSync(file, 'utf8') !== expected) throw new Error(`stale ${name} proposition artifact`); }
    else writeFileSync(file, expected);
  }
  console.log(`${check ? 'checked' : 'generated'} ${artifacts.coverage.checkedDefinitions} definitions, ` +
    `${artifacts.coverage.replayedProofs} retained proofs and ${artifacts.cases.cases.length} shared requests; proposition truth remains unproved`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
