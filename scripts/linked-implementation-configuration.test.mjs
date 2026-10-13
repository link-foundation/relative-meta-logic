import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { decodeLinkedValues, encodeLinkedValues } from './linked-runtime-graph.mjs';
import { readLinkedImplementation, compileLinkedImplementation, repositoryRoot } from './generate-linked-runtime.mjs';
import { readLinkedRustImplementation } from './generate-linked-rust-runtime.mjs';
import { readImplementationConfiguration, implementationConfigurationFiles, emitImplementationConfiguration } from './linked-implementation-configuration.mjs';
import { checkCurrentLinkedImplementation } from './check-linked-implementation.mjs';

const configuration = readImplementationConfiguration();
const scratch = mkdtempSync(join(tmpdir(), 'rml-linked-configuration-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('the ordinary test suite rejects current-checkout source or provider drift', () => {
  assert.equal(checkCurrentLinkedImplementation().currentTreeConsistent, true);
});

test('the configuration graph supplies real build settings and direct linked library inputs', () => {
  const data = decodeLinkedValues(configuration), files = implementationConfigurationFiles(configuration);
  assert.ok(data.providers.some(item => item.family === 'npm' && item.path.endsWith('/@babel/parser')));
  assert.ok(data.providers.some(item => item.family === 'cargo' && item.name === 'meta-language'));
  assert.ok(data.providers.some(item => item.family === 'pinned-generic-source'));
  assert.ok(files['rust/Cargo.toml'].includes('links-notation'));
  assert.ok(files['lib/meta-theory/proof-verifier.lino'].includes('linked-proof-verifier'));
  assert.ok(files['scripts/linked-runtime-rust/vendor/syn-serde/LICENSE-MIT']);
  data.files['rust/Cargo.toml'].value += '\n[profile.release]\noverflow-checks = true\n';
  assert.ok(implementationConfigurationFiles(encodeLinkedValues(data))['rust/Cargo.toml'].includes('overflow-checks = true'));
  assert.equal(files['rust/Cargo.toml'].includes('overflow-checks = true'), false);
});

test('configuration refuses omitted providers and escaping output paths', () => {
  const providers = decodeLinkedValues(configuration); providers.providers.pop();
  assert.throws(() => implementationConfigurationFiles(encodeLinkedValues(providers)), /provider inventory differs/);
  const escaping = decodeLinkedValues(configuration); escaping.files['lib/../../outside'] = { format: 'text', value: 'unexpected' };
  assert.throws(() => implementationConfigurationFiles(encodeLinkedValues(escaping)), /invalid linked configuration file/);
});

test('ordinary-build guard rejects added host modules and changed dependency settings', () => {
  const root = join(scratch, 'generated');
  emitImplementationConfiguration(configuration, root);
  const javascript = compileLinkedImplementation(readLinkedImplementation());
  for (const [path, text] of Object.entries(javascript)) { const target = join(root, path); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, text); }
  // Rust generation is independently exercised by the native acceptance job.
  // For this guard test, exact frozen host mirrors are sufficient inputs.
  const rustManifest = JSON.parse(readFileSync(join(repositoryRoot, 'lib/linked-runtime/rust-manifest.json')));
  readLinkedRustImplementation();
  for (const item of rustManifest.modules) { const target = join(root, item.path); mkdirSync(join(target, '..'), { recursive: true }); cpSync(join(repositoryRoot, item.path), target); }
  mkdirSync(join(root, 'lib/linked-runtime'), { recursive: true });
  for (const name of ['implementation.links.json.gz', 'manifest.json', 'rust-implementation.links.json.gz', 'rust-manifest.json', 'configuration.links.json.gz', 'configuration-manifest.json']) cpSync(join(repositoryRoot, 'lib/linked-runtime', name), join(root, 'lib/linked-runtime', name));
  assert.equal(checkCurrentLinkedImplementation(root).currentTreeConsistent, true);
  const added = join(root, 'js/src/r151-unreported.mjs'); writeFileSync(added, 'export const semanticChoice = true;\n');
  assert.throws(() => checkCurrentLinkedImplementation(root), /inventory differs/);
  rmSync(added);
  const manifest = join(root, 'rust/Cargo.toml'); writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\n[profile.release]\noverflow-checks = true\n');
  assert.throws(() => checkCurrentLinkedImplementation(root), /configuration\/provider differs/);
});
