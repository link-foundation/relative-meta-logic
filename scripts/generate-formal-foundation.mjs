#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalFoundation, formalRecord, linkedFoundationSource } from '../js/src/rml-formal-foundation.mjs';
import { formalNatural, formalList } from '../js/src/rml-formal-semantics.mjs';
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

export function formalFoundationArtifacts() {
  const kernels = { core: read('lib/meta-theory/formal-semantics.lino'), indexed: read('lib/meta-theory/formal-indexed.lino'), records: read('lib/meta-theory/formal-records.lino') };
  const system = FormalFoundation.fromRml(read('lib/meta-theory/upstream-0.0.3.lino'), read('lib/meta-theory/upstream-0.0.3-foundation.lino'), kernels);
  const registry = LinkedProgramRegistry.fromRml(linkedFoundationSource(kernels), { executionBasis: 'direct-structural' });
  const coverage = system.coverage(), cases = [];
  const add = (name, receipt) => cases.push({ name, address: receipt.address, kind: receipt.kind, input: receipt.input,
    request: receipt.request, expected: receipt.result, accepted: receipt.accepted, steps: receipt.steps });
  const checked = new Map(coverage.declarations.filter(entry => entry.status === 'definition-checked').map(entry => [entry.address, entry]));
  const seen = new Set();
  const visit = address => {
    if (seen.has(address)) return;
    const entry = checked.get(address);
    if (!entry) throw new Error(`unchecked dependency ${address}`);
    for (const dependency of entry.dependencies) visit(dependency);
    seen.add(address);
    add(`${address}-definition`, system.verifyDefinition(address));
  };
  for (const address of checked.keys()) visit(address);
  for (const language of ['lean', 'rocq']) {
    const prefix = `rml.formal.${language}.NetworkDefinitions.`;
    const vector = `${prefix}TupleOfReferencesDefault`;
    const size = prefix + (language === 'lean' ? 'AnyNetwork.size' : 'anyNetworkSize');
    const valid = prefix + (language === 'lean' ? 'AnyNetwork.isWellFormed' : 'anyNetworkIsWellFormed');
    add(`${language}-retained-meta-proof`, system.verifyTheorem(`rml.formal.${language}.MetaDefinitions.meta_network_is_duplet_network`));
    for (const length of [0, 2, 4]) add(`${language}-vector-${length}`, system.evaluate(vector, [formalNatural(length)]));
    add(`${language}-vector-wrong-domain`, system.evaluate(vector, [formalList([formalNatural(0)])]));
    const sample = ['fs-global', `${prefix}exampleAnyNetwork`];
    add(`${language}-record-size`, system.evaluate(size, [sample]));
    add(`${language}-record-valid`, system.evaluate(valid, [sample]));
    add(`${language}-record-invalid`, system.evaluate(valid, [formalRecord([formalNatural(2), formalList([formalList([formalNatural(1)])])])]));
    add(`${language}-record-empty`, system.evaluate(valid, [formalRecord([formalNatural(2), formalList([])])]));
    const other = ['fs-global', `rml.formal.${language === 'lean' ? 'rocq' : 'lean'}.NetworkDefinitions.exampleAnyNetwork`];
    add(`${language}-record-wrong-nominal-type`, system.evaluate(valid, [other]));
    const definition = system.verifyDefinition(vector);
    for (const mutation of ['body-length', 'binder', 'result-index', 'dependency']) {
      const request = structuredClone(definition.request);
      if (mutation === 'body-length') request[2][2][1] = ['fs-zero'];
      if (mutation === 'binder') request[2][1] = ['fs-bool-type'];
      if (mutation === 'result-index') request[1][2][2] = ['fs-zero'];
      if (mutation === 'dependency') request[3] = 'fs-empty';
      const result = registry.reduce('formal-foundation', request, { maxSteps: 50_000 });
      cases.push({ name: `${language}-mutated-${mutation}`, address: vector, kind: 'adversarial-definition', request,
        expected: result.term, accepted: result.term?.[0] === 'fs-ok', steps: result.steps });
    }
  }
  return { coverage, cases: { schema: 'rml-formal-foundation-cases/v1', corpusFingerprint: coverage.corpusFingerprint,
    kernelHash: coverage.kernelHash, fullCorpusVerified: false, cases } };
}

function main() {
  const check = process.argv.includes('--check'), artifacts = formalFoundationArtifacts();
  const directory = resolve(root, 'test-corpus/formal-foundation');
  if (!check) mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) {
    const file = resolve(directory, `${name}.json`), expected = `${JSON.stringify(value, null, 2)}\n`;
    if (check) { if (readFileSync(file, 'utf8') !== expected) throw new Error(`stale ${name} foundation artifact`); }
    else writeFileSync(file, expected);
  }
  console.log(`${check ? 'checked' : 'generated'} ${artifacts.coverage.checkedDefinitions} definition obligations, ` +
    `${artifacts.coverage.replayedProofs} proofs, ${artifacts.cases.cases.length} shared requests; ` +
    `${artifacts.coverage.pendingGeneratedTraits.length} derived traits remain pending`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
