#!/usr/bin/env node
/** Fast ordinary-build guard: graph integrity, exact inventory and source pins. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { implementationInventory, implementationModules, readLinkedImplementation, repositoryRoot } from './generate-linked-runtime.mjs';
import { readLinkedRustImplementation, rustImplementationInventory } from './generate-linked-rust-runtime.mjs';
import { checkImplementationConfiguration } from './linked-implementation-configuration.mjs';
import { assertJavaScriptDependencyClosure, discoverExecutableInventory } from './linked-executable-inventory.mjs';

export function checkCurrentLinkedImplementation(root = repositoryRoot) {
  discoverExecutableInventory(root);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const archive = readLinkedImplementation(root); readLinkedRustImplementation(root);
  assertJavaScriptDependencyClosure(implementationModules(archive), root);
  const results = [];
  for (const [path, inventory] of [['lib/linked-runtime/manifest.json', implementationInventory], ['lib/linked-runtime/rust-manifest.json', rustImplementationInventory]]) {
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    if (JSON.stringify(inventory(root)) !== JSON.stringify(manifest.modules.map(item => item.path))) throw new Error(`owned implementation inventory differs from linked archive: ${path}`);
    for (const item of manifest.modules) if (![item.sourceSha256, item.generatedSha256].includes(hash(readFileSync(resolve(root, item.path))))) throw new Error(`implementation differs from linked source: ${item.path}; deliberately update the authoritative graph before building`);
    results.push({ manifest: path, modules: manifest.modules.length, archiveSha256: manifest.archiveSha256 });
  }
  return { schema: 'rml-current-linked-implementation/v1', currentTreeConsistent: true, implementations: results, configuration: checkImplementationConfiguration(root) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(checkCurrentLinkedImplementation(), null, 2));
