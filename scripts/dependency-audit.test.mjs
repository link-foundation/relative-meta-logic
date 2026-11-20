import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMetaLanguageNpmDelivery } from './issue-183-npm-delivery.mjs';

// The dated dependency audit records, per direct dependency, the selected and the
// latest published release. This keeps the record honest offline: every selected
// version is what the manifests declare and the lock files resolve, and nothing
// selected is behind the latest release the audit observed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditPath = 'docs/case-studies/issue-183/data/dependency-audit-2026-10-13.json';
const notationAuditPath = 'docs/case-studies/issue-183/data/links-notation-audit-2026-11-20.json';
const npmManifests = ['js/package.json', 'vscode/package.json'];
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const bare = range => String(range).replace(/^[\^~=]/, '');

test('reports a missing upstream npm release on PRs and requires publication on main', () => {
  const lookup = (name, version, options) => {
    const upstream = JSON.parse(read('js/vendor/meta-language/js/package.json'));
    assert.equal(name, upstream.name);
    assert.equal(version, upstream.version);
    assert.deepEqual(options, { registry: 'https://registry.npmjs.org', preferOnline: true });
    return false;
  };
  const pull = checkMetaLanguageNpmDelivery({ event: 'pull_request', lookup });
  assert.equal(pull.passed, true);
  assert.match(pull.message, /Skipping.*gate still checks R51 and R133/);
  const main = checkMetaLanguageNpmDelivery({ event: 'push', lookup });
  assert.equal(main.passed, false);
  assert.match(main.message, /npm maintainer.*publish.*official.*then rerun/);
  assert.equal(checkMetaLanguageNpmDelivery({ event: 'push', lookup: () => true }).passed, true);
  assert.throws(() => checkMetaLanguageNpmDelivery({ event: 'pull_request', lookup: () => { throw new Error('registry outage'); } }), /registry outage/);
});

function currentAudit() {
  const audit = JSON.parse(read(auditPath));
  const notation = JSON.parse(read(notationAuditPath));
  assert.equal(notation.schema, 'rml-links-notation-audit/v1');
  assert.match(notation.revision, /^[a-f0-9]{40}$/);
  audit.npm['links-notation'] = notation.npm;
  audit.crates['links-notation'] = notation.crate;
  return audit;
}

/** The packages of a Cargo lock file as {name, version, checksum} records. */
export function lockPackages(text) {
  return text.split('[[package]]').slice(1).map(block => ({
    name: block.match(/^name = "([^"]+)"/m)?.[1],
    version: block.match(/^version = "([^"]+)"/m)?.[1],
    checksum: block.match(/^checksum = "([^"]+)"/m)?.[1] ?? null,
  }));
}

/** The repository's current dependency declarations and resolutions. */
export function repositoryState(files = read) {
  const npm = npmManifests.map(file => {
    const manifest = JSON.parse(files(file));
    const lock = JSON.parse(files(file.replace('package.json', 'package-lock.json')));
    return { file, declared: { ...manifest.dependencies, ...manifest.devDependencies }, locked: lock.packages ?? {} };
  });
  const cargoManifest = files('rust/Cargo.toml');
  const cargoSection = cargoManifest.slice(cargoManifest.indexOf('[dependencies]'), cargoManifest.indexOf('\n[', cargoManifest.indexOf('[dependencies]') + 1));
  const cargoDeclared = Object.fromEntries([...cargoSection.matchAll(/^([A-Za-z0-9_-]+) = (?:"([^"]+)"|\{[^}]*version = "([^"]+)")/gm)].map(m => [m[1], m[2] ?? m[3]]));
  return { npm, cargoDeclared, locks: files };
}

/** Every reason the audit does not describe the repository's selected, locked and current dependencies. */
export function auditErrors(audit, state = repositoryState()) {
  const errors = [];
  for (const [name, entry] of Object.entries(audit.npm ?? {})) {
    if (!entry.selected) continue;
    const declaring = state.npm.filter(manifest => manifest.declared[name] !== undefined);
    if (!declaring.length) errors.push(`npm ${name}: not declared by ${npmManifests.join(' or ')}`);
    for (const manifest of declaring) {
      // A caret range is compared by its floor; the lock below must resolve exactly that release.
      if (bare(manifest.declared[name]) !== bare(entry.selected)) errors.push(`npm ${name}: ${manifest.file} declares ${manifest.declared[name]}, audit selected ${entry.selected}`);
      const locked = manifest.locked[`node_modules/${name}`];
      if (locked?.version !== bare(entry.selected)) errors.push(`npm ${name}: ${manifest.file} lock resolves ${locked?.version}, audit selected ${entry.selected}`);
      if (entry.integrity && locked?.integrity !== entry.integrity) errors.push(`npm ${name}: ${manifest.file} integrity differs from the audited archive`);
    }
    if (entry.latest && bare(entry.selected) !== entry.latest) errors.push(`npm ${name}: selected ${entry.selected} is behind latest ${entry.latest}`);
  }
  const lockfiles = audit.crates?.lockfiles ?? [];
  if (!lockfiles.length) errors.push('crates: no lock files recorded');
  const locks = Object.fromEntries(lockfiles.map(file => [file, lockPackages(state.locks(file))]));
  for (const [name, entry] of Object.entries(audit.crates ?? {})) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.selected) continue;
    const version = bare(entry.selected);
    if (state.cargoDeclared[name] !== undefined && state.cargoDeclared[name] !== entry.selected && bare(state.cargoDeclared[name]) !== version) errors.push(`crate ${name}: rust/Cargo.toml requires ${state.cargoDeclared[name]}, audit selected ${entry.selected}`);
    for (const [file, packages] of Object.entries(locks)) {
      const resolved = packages.filter(item => item.name === name);
      if (!resolved.length) continue;
      const match = resolved.find(item => item.version === version);
      if (!match) errors.push(`crate ${name}: ${file} resolves ${resolved.map(item => item.version).join(', ')}, audit selected ${version}`);
      else if (entry.checksum && match.checksum !== entry.checksum) errors.push(`crate ${name}: ${file} checksum differs from the audited archive`);
    }
    if (state.cargoDeclared[name] !== undefined && !Object.values(locks).some(packages => packages.some(item => item.name === name && item.version === version))) errors.push(`crate ${name}: no lock file resolves the selected version`);
    if (entry.latest && version !== entry.latest) errors.push(`crate ${name}: selected ${entry.selected} is behind latest ${entry.latest}`);
  }
  for (const name of Object.keys(state.cargoDeclared)) if (!audit.crates?.[name]) errors.push(`crate ${name}: declared by rust/Cargo.toml but not audited`);
  return errors;
}

test('the dated dependency audit matches every declared and locked direct dependency and none is behind its audited latest release', () => {
  const audit = currentAudit();
  assert.equal(audit.schema, 'rml-dependency-audit/v1');
  assert.deepEqual(auditErrors(audit), []);
  // The one recorded publication gap stays explicit rather than silently dropped.
  assert.match(audit.npm['meta-language'].note, /npm publication remains absent/);
});

test('an audit that disagrees with a manifest, a lock file or a newer release is rejected', () => {
  const original = currentAudit();
  const state = repositoryState();
  const mutations = {
    'npm selection differs from the manifest': audit => { audit.npm['links-notation'].selected = '0.25.1'; },
    'npm integrity differs from the audited archive': audit => { audit.npm['links-notation'].integrity = 'sha512-fixture'; },
    'npm selection behind latest': audit => { audit.npm['web-tree-sitter'].latest = '0.28.0'; },
    'undeclared npm package': audit => { audit.npm['left-pad'] = { selected: '1.3.0', latest: '1.3.0' }; },
    'crate selection not locked': audit => { audit.crates.sha2.selected = '0.11.0'; },
    'crate checksum differs': audit => { audit.crates['serde_json'].checksum = '0'.repeat(64); },
    'crate behind latest': audit => { audit.crates.regex.latest = '1.14.0'; },
    'declared crate not audited': audit => { delete audit.crates['meta-language']; },
    'no lock files': audit => { audit.crates.lockfiles = []; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const audit = clone(original);
    mutate(audit);
    assert.notDeepEqual(auditErrors(audit, state), [], name);
  }
  const drifted = { ...state, npm: state.npm.map(manifest => manifest.file === 'js/package.json' ? { ...manifest, declared: { ...manifest.declared, 'web-tree-sitter': '0.26.0' } } : manifest) };
  assert.notDeepEqual(auditErrors(original, drifted), [], 'manifest drifted after the audit');
});
