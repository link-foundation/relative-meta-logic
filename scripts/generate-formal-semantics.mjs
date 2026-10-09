#!/usr/bin/env node
/** Generate/check reproducible source-bound semantic coverage and replay cases. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FormalSemantics, formalNatural, formalList } from '../js/src/rml-formal-semantics.mjs';
import { LinkedProgramRegistry } from '../js/src/rml-linked-program.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function formalSemanticArtifacts() {
  const source = readFileSync(resolve(root, 'lib/meta-theory/upstream-0.0.3.lino'), 'utf8');
  const foundation = readFileSync(resolve(root, 'lib/meta-theory/upstream-0.0.3-foundation.lino'), 'utf8');
  const kernel = readFileSync(resolve(root, 'lib/meta-theory/formal-semantics.lino'), 'utf8');
  const semantics = FormalSemantics.fromRml(source, foundation, kernel);
  const registry = LinkedProgramRegistry.fromRml(kernel, { executionBasis: 'direct-structural' });
  const cases = [];
  const add = (name, receipt) => cases.push({ name, address: receipt.address, kind: receipt.kind,
    input: receipt.input, request: receipt.request, expected: receipt.result, accepted: receipt.accepted,
    steps: receipt.steps });
  const checked = new Map(semantics.coverage().declarations
    .filter(declaration => declaration.status === 'definition-checked')
    .map(declaration => [declaration.address, declaration]));
  const visited = new Set();
  const visit = address => {
    if (visited.has(address)) return;
    const declaration = checked.get(address);
    if (!declaration) throw new Error(`unchecked source dependency ${address}`);
    for (const dependency of declaration.dependencies) visit(dependency);
    visited.add(address);
    add(`${address}-definition`, semantics.verifyDefinition(address));
  };
  for (const address of checked.keys()) visit(address);
  for (const language of ['lean', 'rocq']) {
    const prefix = `rml.formal.${language}.`;
    add(`${language}-source-identity-proof`, semantics.verifyTheorem(`${prefix}MetaDefinitions.meta_network_is_duplet_network`));
    add(`${language}-missing-introduction`, semantics.verifyTheorem(`${prefix}MetaDefinitions.meta_network_is_duplet_network`, ['fs-proof-refl']));
    add(`${language}-singleton-call`, semantics.evaluate(`${prefix}SetDefinitions.SingletonSet`, [formalNatural(3)]));
    add(`${language}-network-literal`, semantics.evaluate(`${prefix}MetaDefinitions.exampleMetaNetwork`));
    add(`${language}-wrong-domain`, semantics.evaluate(`${prefix}SetDefinitions.SingletonSet`, [formalList([formalNatural(1)])]));
    const receipt = semantics.verifyTheorem(`${prefix}MetaDefinitions.meta_network_is_duplet_network`);
    for (const mutation of ['binder', 'premise', 'conclusion', 'dependency']) {
      const request = structuredClone(receipt.request);
      if (mutation === 'binder') request[1][1] = ['fs-nat-type'];
      if (mutation === 'premise') request[1][2][0] = 'fs-unsupported-implication';
      if (mutation === 'conclusion') request[1][2][2] = ['fs-zero'];
      if (mutation === 'dependency') request[4] = 'fs-empty';
      const result = registry.reduce('formal-semantics', request, { maxSteps: 50_000 });
      cases.push({ name: `${language}-mutated-${mutation}`, address: receipt.address,
        kind: 'adversarial-kernel-request', request, expected: result.term,
        accepted: result.term === 'fs-proof-accepted', steps: result.steps });
    }
  }
  return { coverage: semantics.coverage(), cases: { schema: 'rml-formal-semantic-cases/v1',
    corpusFingerprint: semantics.coverage().corpusFingerprint,
    kernelHash: semantics.coverage().kernelHash,
    scope: 'Non-dependent typed conversion fragment; not whole-corpus verification', cases } };
}

function main() {
  const check = process.argv.includes('--check');
  const artifacts = formalSemanticArtifacts();
  const directory = resolve(root, 'test-corpus/formal-semantics');
  if (!check) mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) {
    const file = resolve(directory, `${name}.json`);
    const expected = `${JSON.stringify(value, null, 2)}\n`;
    if (check) {
      if (readFileSync(file, 'utf8') !== expected) throw new Error(`stale formal semantic artifact: ${name}.json`);
    } else writeFileSync(file, expected);
  }
  console.log(`${check ? 'checked' : 'generated'} ${artifacts.coverage.checkedDefinitions} definitions, ` +
    `${artifacts.coverage.replayedProofs} proofs, ${artifacts.coverage.upstreamAdmissions} admissions, ` +
    `${artifacts.cases.cases.length} shared cases; full-corpus verification remains false`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
