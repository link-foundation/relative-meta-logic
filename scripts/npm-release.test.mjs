// Regression tests for issue #189: one npm package named
// `relative-meta-logic`, a distinct private VS Code extension package, and a
// single npm release workflow that publishes through trusted publishing.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPOSITORY,
  WORKFLOW_FILE,
  buildPublishGuidance,
  classifyPublishFailure,
  interpretViewResult,
  readLibraryManifest,
  releaseTag,
  trustedPublisherCommand,
} from './npm-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const releaseWorkflow = fs.readFileSync(path.join(workflowsDir, WORKFLOW_FILE), 'utf8');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', '_site']);

function findManifests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...findManifests(path.join(dir, entry.name)));
    } else if (entry.name === 'package.json') {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('workspace npm manifests (issue #189)', () => {
  const manifests = findManifests(repoRoot).map(file => ({
    file: path.relative(repoRoot, file),
    manifest: readJson(file),
  }));

  it('finds the library and the VS Code extension manifests', () => {
    const files = manifests.map(entry => entry.file).sort();
    assert.ok(files.includes(path.join('js', 'package.json')), files.join(', '));
    assert.ok(files.includes(path.join('vscode', 'package.json')), files.join(', '));
  });

  it('has no duplicate package names', () => {
    const byName = new Map();
    for (const { file, manifest } of manifests) {
      if (!manifest.name) continue;
      byName.set(manifest.name, [...(byName.get(manifest.name) || []), file]);
    }
    const duplicates = [...byName].filter(([, files]) => files.length > 1);
    assert.deepStrictEqual(duplicates, [], `duplicate package names: ${JSON.stringify(duplicates)}`);
  });

  it('keeps the publishable library named relative-meta-logic', () => {
    const library = readLibraryManifest();
    assert.strictEqual(library.name, 'relative-meta-logic');
    assert.notStrictEqual(library.private, true, 'the library must stay publishable');
    // npm provenance is only accepted when repository.url matches the
    // repository whose workflow signs the package.
    assert.match(library.repository.url, new RegExp(`github\\.com/${REPOSITORY}(\\.git)?$`));
    assert.strictEqual(library.repository.directory, 'js');
    assert.ok(library.files.includes('src/'), 'published tarball must contain src/');
    for (const bin of Object.values(library.bin)) {
      assert.ok(bin.startsWith('src/'), `bin ${bin} must be shipped through "files"`);
    }
  });

  it('gives the VS Code extension a distinct, private package name', () => {
    const extension = readJson(path.join(repoRoot, 'vscode', 'package.json'));
    assert.strictEqual(extension.name, 'relative-meta-logic-vscode');
    assert.strictEqual(extension.private, true, 'the extension must never be published to npm');
    const lock = readJson(path.join(repoRoot, 'vscode', 'package-lock.json'));
    assert.strictEqual(lock.name, extension.name);
    assert.strictEqual(lock.packages[''].name, extension.name);
  });

  it('gives every other private workspace manifest a name that differs from the library', () => {
    for (const { file, manifest } of manifests) {
      if (file === path.join('js', 'package.json')) continue;
      assert.notStrictEqual(manifest.name, 'relative-meta-logic', `${file} reuses the library name`);
    }
  });
});

describe('npm release workflow (issue #189)', () => {
  it('publishes only from the reviewed release workflows', () => {
    const publishers = fs.readdirSync(workflowsDir)
      .filter(name => /\.ya?ml$/.test(name))
      .filter(name => {
        const text = fs.readFileSync(path.join(workflowsDir, name), 'utf8');
        return /npm publish(?! --dry-run)|npm-release\.mjs publish/.test(text);
      });
    assert.deepStrictEqual(publishers.sort(), [WORKFLOW_FILE, 'crates-release.yml'].sort());
  });

  it('keeps the npm job in the crates release workflow main-only and OIDC-capable', () => {
    const cratesRelease = fs.readFileSync(path.join(workflowsDir, 'crates-release.yml'), 'utf8');
    assert.match(cratesRelease, /id-token: write/);
    assert.match(cratesRelease, /npm publish --provenance --access public/);
    assert.match(cratesRelease, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  });

  it('publishes through trusted publishing from main only', () => {
    assert.match(releaseWorkflow, /id-token: write/);
    assert.match(releaseWorkflow, /node scripts\/npm-release\.mjs publish/);
    assert.match(releaseWorkflow, /node scripts\/npm-release\.mjs verify/);
    assert.match(releaseWorkflow, /npm publish --dry-run/);
    const publishStep = releaseWorkflow.slice(releaseWorkflow.indexOf('- name: Publish to npm'));
    assert.match(publishStep.split(/\n\s+- name:/)[0], /github\.ref == 'refs\/heads\/main'/);
    assert.match(publishStep, /github\.event_name != 'pull_request'/);
    assert.match(releaseWorkflow, /- name: Report why this pull request skips publication\s+if: github\.event_name == 'pull_request' && steps\.check\.outputs\.should_publish == 'true'[\s\S]*?requires the npm trusted publisher on main/);
  });

  it('upgrades npm when it is older than 11.5.1 (the first OIDC-capable release)', () => {
    assert.match(releaseWorkflow, /npm install -g npm@\^11\.5\.1/);
  });

  it('validates package contents even when npm already serves this version', () => {
    const registryCheck = releaseWorkflow.indexOf('run: node scripts/npm-release.mjs check');
    const publishDryRun = releaseWorkflow.indexOf('npm publish --dry-run');
    assert.ok(registryCheck >= 0 && registryCheck < publishDryRun);
    const remainingSteps = releaseWorkflow.slice(registryCheck).split(/\n\s+- name: /);
    const unpublished = remainingSteps.find(step => step.includes('npm publish --dry-run'));
    const published = remainingSteps.find(step => step.includes('npm pack --dry-run'));
    assert.match(unpublished, /if: steps\.check\.outputs\.should_publish == 'true'/);
    assert.match(published, /if: steps\.check\.outputs\.should_publish == 'false'/);
  });

  it('keeps crates.io publication in the separate crates-release workflow', () => {
    assert.doesNotMatch(releaseWorkflow, /cargo publish/);
    assert.match(releaseWorkflow, /crates-release\.yml/);
  });
});

describe('npm-release helpers', () => {
  it('names release tags after the npm version', () => {
    assert.strictEqual(releaseTag('0.19.0'), 'js-v0.19.0');
  });

  it('treats a registry 404 as "not published"', () => {
    const output = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/relative-meta-logic - Not found';
    assert.strictEqual(interpretViewResult({ status: 1, stdout: '', output }, '0.19.0'), false);
  });

  it('detects an already published version', () => {
    assert.strictEqual(interpretViewResult({ status: 0, stdout: '"0.19.0"\n', output: '' }, '0.19.0'), true);
    assert.strictEqual(interpretViewResult({ status: 0, stdout: '["0.19.0"]', output: '' }, '0.19.0'), true);
    assert.strictEqual(interpretViewResult({ status: 0, stdout: '', output: '' }, '0.19.0'), false);
  });

  it('fails closed on registry errors other than 404', () => {
    assert.throws(
      () => interpretViewResult({ status: 1, stdout: '', output: 'npm error code ETIMEDOUT' }, '0.19.0'),
      /npm view failed/,
    );
  });

  it('classifies npm publish failures', () => {
    assert.strictEqual(classifyPublishFailure('npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/relative-meta-logic'), 'not-found');
    assert.strictEqual(classifyPublishFailure('npm error code ENEEDAUTH'), 'unauthenticated');
    assert.strictEqual(classifyPublishFailure('npm error code E403\nnpm error 403 403 Forbidden'), 'forbidden');
    assert.strictEqual(classifyPublishFailure('You cannot publish over the previously published versions: 0.19.0.'), 'already-published');
    assert.strictEqual(classifyPublishFailure('Error generating provenance statement'), 'provenance');
    assert.strictEqual(classifyPublishFailure('something else'), 'unknown');
  });

  it('tells maintainers how to configure the trusted publisher', () => {
    assert.strictEqual(
      trustedPublisherCommand('relative-meta-logic'),
      'npm trust github relative-meta-logic --file release.yml --repository link-foundation/relative-meta-logic --allow-publish --yes',
    );
    const guidance = buildPublishGuidance('relative-meta-logic', '0.19.0', 'not-found');
    assert.match(guidance, /npm trust github relative-meta-logic/);
    assert.match(guidance, /package-registry-manager setup --repository \. --registry npm --execute/);
    assert.match(guidance, /NPM_TOKEN/);
    assert.match(buildPublishGuidance('relative-meta-logic', '0.19.0', 'already-published'), /Bump "version" in js\/package\.json/);
  });
});
