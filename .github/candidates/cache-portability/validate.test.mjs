import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyCandidate, loadPackage, repairPaths, verifyCandidate } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-candidate-validator-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'candidate');
  const packageDir = path.join(directory, 'package');
  fs.mkdirSync(root); fs.mkdirSync(packageDir);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); };
  git('init', '-q'); git('config', 'user.name', 'Candidate fixture'); git('config', 'user.email', 'candidate@example.invalid');
  write('.gitignore', '.rml-cache/\n'); write('unrelated.txt', 'unchanged\n');
  const files = repairPaths.map(name => {
    const before = name.endsWith('.ps1') ? null : `before: ${name}\n`;
    if (before) write(name, before);
    return { path: name, beforeSha256: before === null ? null : hash(before), afterSha256: hash(`after: ${name}\n`) };
  });
  git('add', '.'); git('commit', '-qm', 'baseline');
  const baselineCommit = git('rev-parse', 'HEAD');
  const baselineTree = git('rev-parse', 'HEAD^{tree}');
  for (const name of repairPaths) write(name, `after: ${name}\n`);
  git('add', '.');
  const patch = execFileSync('git', ['-C', root, 'diff', '--cached', '--binary', '--full-index']);
  const candidateTree = git('write-tree');
  git('reset', '--hard', 'HEAD');
  const manifest = { schemaVersion: 1, purpose: 'test fixture', baselineCommit, baselineTree, candidateTree, reviewedRepairCommit: 'f'.repeat(40), patchFile: 'repair.patch', patchSha256: hash(patch), files };
  fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(packageDir, 'repair.patch'), patch);
  return { root, packageDir, manifest, git, write, candidate: loadPackage(packageDir) };
}

test('candidate validation applies exactly the five reviewed files and records tree/patch evidence', t => {
  const f = fixture(t);
  const result = applyCandidate(f.root, f.candidate);
  assert.equal(result.candidateTree, f.manifest.candidateTree);
  assert.deepEqual(result.changedFiles, [...repairPaths].sort());
  assert.equal(fs.readFileSync(path.join(f.root, 'unrelated.txt'), 'utf8'), 'unchanged\n');
  assert.deepEqual(verifyCandidate(f.root, f.candidate), result);
  const evidence = path.join(f.root, '.rml-cache/evidence/cache-portability-candidate');
  assert.equal(hash(fs.readFileSync(path.join(evidence, 'applied-repair.patch'))), f.manifest.patchSha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(evidence, 'before.json'))).baselineTree, f.manifest.baselineTree);
});

for (const kind of ['tracked', 'untracked', 'ignored']) {
  test(`candidate validation refuses ${kind} dirty state before applying the patch`, t => {
    const f = fixture(t);
    f.write({ tracked: 'unrelated.txt', untracked: 'extra.txt', ignored: '.rml-cache/preexisting' }[kind], 'must survive');
    assert.throws(() => applyCandidate(f.root, f.candidate), /dirty before patch/);
    assert.equal(fs.readFileSync(path.join(f.root, repairPaths[0]), 'utf8'), `before: ${repairPaths[0]}\n`);
    assert.equal(f.git('diff', '--cached', '--name-only'), '');
  });
}

test('candidate validation rejects baseline drift and a tampered patch', t => {
  const f = fixture(t);
  f.git('commit', '--allow-empty', '-qm', 'unexpected revision');
  assert.throws(() => applyCandidate(f.root, f.candidate), /baseline commit drifted/);
  fs.appendFileSync(path.join(f.packageDir, 'repair.patch'), '\n');
  assert.throws(() => loadPackage(f.packageDir), /patch digest changed/);
});

test('candidate verification rejects changed source hashes and expanded changed-file scope', t => {
  const f = fixture(t);
  applyCandidate(f.root, f.candidate);
  f.write(repairPaths[0], 'unreviewed content');
  assert.throws(() => verifyCandidate(f.root, f.candidate), /tracked files changed/);
  f.git('add', repairPaths[0]);
  assert.throws(() => verifyCandidate(f.root, f.candidate), /after hash mismatch/);
  f.write('unrelated.txt', 'unexpected change'); f.git('add', 'unrelated.txt');
  assert.throws(() => verifyCandidate(f.root, f.candidate), /Changed-file scope/);
});

test('candidate manifest cannot expand the frozen five-file repair allowlist', t => {
  const f = fixture(t);
  f.manifest.files.push({ path: 'unrelated.txt', beforeSha256: '0'.repeat(64), afterSha256: '1'.repeat(64) });
  fs.writeFileSync(path.join(f.packageDir, 'manifest.json'), JSON.stringify(f.manifest));
  assert.throws(() => loadPackage(f.packageDir), /exactly the reviewed five files/);
});

test('separate candidate workflow keeps all platforms and bootstrap/archive/final-cleanup ordering', () => {
  const source = fs.readFileSync(path.resolve(here, '../../workflows/cache-candidate-validation.yml'), 'utf8');
  assert.match(source, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.doesNotMatch(source, /continue-on-error:|test-name-pattern|--test-skip-pattern/);
  assert.equal((source.match(/uses: actions\/checkout@v7/g) ?? []).length, 2);
  const manifest = loadPackage().manifest;
  assert.ok(source.includes(`ref: ${manifest.baselineCommit}`));
  assert.ok(source.indexOf('validate.mjs apply') < source.indexOf('run: node scripts/bootstrap.mjs'));
  assert.match(source, /run: node scripts\/run-with-cache\.mjs -- node --test --test-concurrency=2 scripts\/build-cache\.test\.mjs scripts\/build-cache-policy\.test\.mjs/);
  assert.ok(source.indexOf('actions/upload-artifact@') < source.indexOf('run: node scripts/build-cache.mjs --full'));
  assert.match(source, /if: always\(\)\n        run: node scripts\/build-cache\.mjs --full\s*$/);
});
