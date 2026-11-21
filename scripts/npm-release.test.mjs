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
  distTag,
  interpretViewResult,
  readLibraryManifest,
  releaseTag,
  trustedPublisherCommand,
} from './npm-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const releaseWorkflow = fs.readFileSync(path.join(workflowsDir, 'release.yml'), 'utf8');
const publishingWorkflow = fs.readFileSync(path.join(workflowsDir, WORKFLOW_FILE), 'utf8');

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
    assert.deepStrictEqual(publishers, [WORKFLOW_FILE]);
  });

  it('validates the archive even if its version already exists', () => {
    assert.match(releaseWorkflow, /npm pack --dry-run/);
    assert.doesNotMatch(releaseWorkflow, /npm publish/);
  });

  it('publishes through OIDC after validation on main and version tags', () => {
    const validation = publishingWorkflow.split('\n  npm-validate:')[1].split('\n  prm-publish-npm-1:')[0];
    const job = publishingWorkflow.split('\n  prm-publish-npm-1:')[1];
    assert.match(validation, /github\.ref == 'refs\/heads\/main'/);
    assert.match(validation, /github\.event_name == 'push' && github.ref_type == 'tag'/);
    assert.match(job, /needs: \[validate, npm-validate\]/);
    assert.match(job, /id-token: write/);
    assert.match(job, /id: npm_oidc[\s\S]+?node scripts\/npm-release\.mjs publish/);
    assert.match(job, /steps.npm_oidc.outcome == 'failure'/);
    assert.match(job, /node scripts\/npm-release\.mjs verify/);
  });

  it('upgrades npm when it is older than 11.5.1 (the first OIDC-capable release)', () => {
    assert.match(publishingWorkflow, /npm install -g npm@\^11\.5\.1/);
  });

  it('keeps crates.io publication in the separate crates-release workflow', () => {
    assert.doesNotMatch(releaseWorkflow, /cargo publish/);
    assert.match(publishingWorkflow, /cargo publish/);
  });
});

describe('npm-release helpers', () => {
  it('names release tags after the npm version', () => {
    assert.strictEqual(releaseTag('0.19.0'), 'js-v0.19.0');
  });

  it('publishes prereleases under next without advancing latest', () => {
    assert.strictEqual(distTag('0.20.0'), 'latest');
    assert.strictEqual(distTag('0.20.0-rc.1'), 'next');
    assert.strictEqual(distTag('0.20.0+build-id'), 'latest');
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
      'npm trust github relative-meta-logic --file crates-release.yml --repository link-foundation/relative-meta-logic --allow-publish --yes',
    );
    const guidance = buildPublishGuidance('relative-meta-logic', '0.19.0', 'not-found');
    assert.match(guidance, /npm trust github relative-meta-logic/);
    assert.match(guidance, /package-registry-manager setup --repository \. --registry npm --execute/);
    assert.match(guidance, /NPM_TOKEN/);
    assert.match(buildPublishGuidance('relative-meta-logic', '0.19.0', 'already-published'), /Bump "version" in js\/package\.json/);
  });
});
