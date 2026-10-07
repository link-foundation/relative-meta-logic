#!/usr/bin/env node
/** Temporary CI candidate validation; never changes the publishing checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repairPaths = ['docker/ci-build.sh', 'scripts/build-cache.mjs', 'scripts/build-cache-windows.ps1', 'scripts/build-cache.test.mjs', 'scripts/build-cache-policy.test.mjs'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sorted = values => [...values].sort();
const git = (root, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const split = text => text.split('\0').filter(Boolean);
const observedFiles = root => Object.fromEntries(repairPaths.map(name => {
  const file = path.join(root, name);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  assert.ok(!stat || stat.isFile(), `Non-regular candidate source: ${name}`);
  return [name, stat ? sha256(fs.readFileSync(file)) : null];
}));

export function loadPackage(packageDir = here) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  for (const key of ['baselineCommit', 'baselineTree', 'candidateTree']) assert.match(manifest[key], /^[0-9a-f]{40}$/, `Invalid ${key}`);
  assert.equal(manifest.patchFile, 'repair.patch');
  assert.deepEqual(sorted(manifest.files.map(file => file.path)), sorted(repairPaths), 'Candidate scope must be exactly the reviewed five files');
  for (const file of manifest.files) {
    assert.ok(file.beforeSha256 === null || /^[0-9a-f]{64}$/.test(file.beforeSha256));
    assert.match(file.afterSha256, /^[0-9a-f]{64}$/);
  }
  const patchFile = path.join(packageDir, manifest.patchFile);
  assert.equal(sha256(fs.readFileSync(patchFile)), manifest.patchSha256, 'Reviewed patch digest changed');
  return { packageDir, manifest, patchFile };
}

function checkIdentity(root, manifest) {
  assert.equal(fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')), fs.realpathSync(root), 'Candidate must be a separate checkout root');
  assert.equal(git(root, 'rev-parse', 'HEAD'), manifest.baselineCommit, 'Candidate baseline commit drifted');
  assert.equal(git(root, 'rev-parse', 'HEAD^{tree}'), manifest.baselineTree, 'Candidate baseline tree drifted');
}
function checkHashes(root, manifest, phase) {
  const observed = observedFiles(root);
  for (const file of manifest.files) assert.equal(observed[file.path], file[`${phase}Sha256`], `${phase} hash mismatch: ${file.path}`);
  return observed;
}
function evidenceDirectory(root) {
  let dir = root;
  for (const segment of ['.rml-cache', 'evidence', 'cache-portability-candidate']) {
    dir = path.join(dir, segment);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    assert.ok(!stat || stat.isDirectory() && !stat.isSymbolicLink(), 'Candidate evidence path must be an ordinary directory');
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function save(root, name, data) {
  fs.writeFileSync(path.join(evidenceDirectory(root), name), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
}

export function applyCandidate(root, candidate = loadPackage(), { packageRevision = null } = {}) {
  const { manifest, patchFile } = candidate;
  checkIdentity(root, manifest);
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'), '', 'Candidate checkout is dirty before patch application');
  const before = checkHashes(root, manifest, 'before');
  git(root, 'apply', '--check', '--index', patchFile);
  const evidence = {
    kind: 'proposed-cache-repair-only', purpose: manifest.purpose,
    baselineCommit: manifest.baselineCommit, baselineTree: manifest.baselineTree,
    reviewedRepairCommit: manifest.reviewedRepairCommit, packageRevision,
    patchSha256: manifest.patchSha256, beforeSha256: before,
    platform: process.platform, arch: process.arch, node: process.version,
  };
  save(root, 'before.json', evidence);
  fs.copyFileSync(patchFile, path.join(evidenceDirectory(root), 'applied-repair.patch'), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(candidate.packageDir, 'manifest.json'), path.join(evidenceDirectory(root), 'manifest.json'), fs.constants.COPYFILE_EXCL);
  git(root, 'apply', '--index', patchFile);
  const after = verifyCandidate(root, candidate);
  save(root, 'applied.json', { ...evidence, ...after });
  return after;
}

export function verifyCandidate(root, { manifest } = loadPackage()) {
  checkIdentity(root, manifest);
  assert.equal(git(root, 'diff', '--name-only'), '', 'Candidate tracked files changed after patch application');
  assert.equal(git(root, 'ls-files', '--others', '--exclude-standard'), '', 'Unexpected untracked candidate files');
  const changed = split(git(root, 'diff', '--cached', '--name-only', '-z'));
  assert.deepEqual(sorted(changed), sorted(repairPaths), 'Changed-file scope differs from the reviewed five-file repair');
  const after = checkHashes(root, manifest, 'after');
  const candidateTree = git(root, 'write-tree');
  assert.equal(candidateTree, manifest.candidateTree, 'Patched candidate tree differs from the reviewed source tree');
  return { candidateTree, changedFiles: sorted(changed), afterSha256: after };
}

function main() {
  const [operation] = process.argv.slice(2);
  assert.ok(operation === 'apply' || operation === 'verify', 'Usage: validate.mjs apply|verify (RML_CACHE_CANDIDATE_ROOT required)');
  assert.ok(process.env.RML_CACHE_CANDIDATE_ROOT, 'Set RML_CACHE_CANDIDATE_ROOT to the disposable baseline checkout');
  const root = fs.realpathSync(process.env.RML_CACHE_CANDIDATE_ROOT);
  const packageRoot = fs.realpathSync(path.resolve(here, '../../..'));
  assert.notEqual(root, packageRoot, 'Refusing to patch the publishing checkout');
  assert.equal(git(packageRoot, 'status', '--porcelain=v1', '--untracked-files=all'), '', 'Publishing checkout must remain clean');
  const candidate = loadPackage();
  const packageRevision = git(packageRoot, 'rev-parse', 'HEAD');
  if (operation === 'apply') {
    console.log(JSON.stringify(applyCandidate(root, candidate, { packageRevision }), null, 2));
  } else {
    const tests = process.env.RML_CACHE_CANDIDATE_TEST_OUTCOME;
    assert.ok(['success', 'failure', 'skipped', 'cancelled'].includes(tests), 'Missing actual candidate lifecycle step outcome');
    const result = { ...verifyCandidate(root, candidate), tests, packageRevision, scope: 'Proposed repair only; published runtime remains unpatched.' };
    save(root, 'verified.json', result);
    console.log(JSON.stringify(result, null, 2));
    assert.equal(tests, 'success', 'Candidate lifecycle tests did not pass');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`cache candidate validation: ${error.message}`); process.exitCode = 1; }
}
