#!/usr/bin/env node
/** Isolated, reproducible actual docs-build / full-clean / rebuild measurement. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyMeasurementSources } from './measurement-source.mjs';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
const native = process.argv[3] === '--native';
if (!output || process.argv.length > 4 || (process.argv[3] && !native)) throw new Error('Usage: node scripts/measure-build-cache.mjs <report.json> [--native]');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rml measured cycle '));
const env = { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0' };
const results = [];
function run(label, command, cwd = fixture) {
  console.error(`measure-build-cache: ${label}`);
  const result = spawnSync(command[0], command.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const record = { label, command: command.map(x => x.replaceAll(fixture, '<fixture>').replaceAll(source, '<source>')), exitCode: result.status, stdout: result.stdout?.replaceAll(fixture, '<fixture>'), stderr: result.stderr?.replaceAll(fixture, '<fixture>') };
  results.push(record);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr}\n${result.stdout}`);
  return result;
}
try {
  copyMeasurementSources(source, fixture);
  fs.cpSync(path.join(source, 'js/node_modules'), path.join(fixture, 'js/node_modules'), { recursive: true, verbatimSymlinks: true });
  for (const args of [['init', '-q'], ['config', 'user.name', 'Cache measurement'], ['config', 'user.email', 'cache@example.invalid'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'measurement inputs']]) execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' });
  run('bootstrap fresh fixture', [process.execPath, 'scripts/bootstrap.mjs']);
  const wrapper = path.join(fixture, 'scripts/run-with-cache.mjs');
  const docCommand = [process.execPath, wrapper, '--', process.execPath, path.join(fixture, 'scripts/build-docs.mjs'), '--destination', '../_site/api/js'];
  run('first actual JSDoc build', docCommand, path.join(fixture, 'js'));
  if (native) run('first complete Rust test-target compilation', [process.execPath, wrapper, '--isolate-output', 'rust/target', '--', 'cargo', 'test', '--locked', '--manifest-path', 'rust/Cargo.toml', '--all-targets', '--no-run']);
  const first = JSON.parse(run('before full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--report', '--json']).stdout);
  run('first full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--full']);
  const cleaned = JSON.parse(fs.readFileSync(path.join(fixture, '.rml-cache/reports/last-cleanup.json')));
  if (cleaned.afterBytes !== 0 || cleaned.reclaimedBytes < 1) throw new Error('No meaningful clean-build evidence');
  run('clean JSDoc rebuild', docCommand, path.join(fixture, 'js'));
  const rebuilt = JSON.parse(run('after clean rebuild', [process.execPath, 'scripts/build-cache.mjs', '--report', '--json']).stdout);
  run('post-rebuild full JavaScript verification', [process.execPath, wrapper, '--', 'npm', '--prefix', 'js', 'test']);
  if (native) {
    run('post-clean full Rust rebuild and verification', [process.execPath, wrapper, '--isolate-output', 'rust/target', '--', 'cargo', 'test', '--locked', '--manifest-path', 'rust/Cargo.toml', '--all-targets']);
    run('post-clean required Rust Lean Rocq translation oracles', [process.execPath, wrapper, '--', process.execPath, 'scripts/check-portable-native.mjs', '--require=Rust,Lean,Rocq']);
  }
  run('final full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--full']);
  const final = JSON.parse(fs.readFileSync(path.join(fixture, '.rml-cache/reports/last-cleanup.json')));
  const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, node: process.version, scope: native ? 'Actual JSDoc and all Rust test-target builds, full cache cleanup, clean rebuild, full JavaScript/Rust suites and all required Rust/Lean/Rocq portable-fragment oracles in an isolated fixture; excludes Docker, global toolchain/dependency caches and full issue-183 acceptance.' : 'Actual JSDoc build, full cache cleanup, clean rebuild, and full npm JavaScript test suite in an isolated fixture; not Rust/Lean/Rocq/Docker or full issue-183 acceptance.', sourceRevision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), measurementInputTree: execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), policySha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture, 'scripts/cache-policy.json'))).digest('hex'), implementationHashes: Object.fromEntries(['scripts/build-cache.mjs', 'scripts/run-with-cache.mjs', 'scripts/bootstrap.mjs', 'scripts/build-cache.test.mjs', 'scripts/build-cache-policy.test.mjs', 'scripts/cli-paths.test.mjs', 'scripts/measure-build-cache.mjs', 'scripts/measurement-source.mjs', 'scripts/measurement-source.test.mjs'].map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture, p))).digest('hex')])), byteAccounting: 'Logical regular-file sizes across registered cache roots, not a filesystem quota or measurement of physical blocks; diagnostic evidence is excluded.', firstBuildBytes: first.beforeBytes, fullClean: { beforeBytes: cleaned.beforeBytes, afterBytes: cleaned.afterBytes, reclaimedBytes: cleaned.reclaimedBytes }, rebuiltBytes: rebuilt.beforeBytes, finalClean: { beforeBytes: final.beforeBytes, afterBytes: final.afterBytes, reclaimedBytes: final.reclaimedBytes }, results };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: output, firstBuildBytes: report.firstBuildBytes, reclaimedBytes: cleaned.reclaimedBytes, rebuiltBytes: report.rebuiltBytes, checks: results.map(r => [r.label, r.exitCode]) }, null, 2));
} catch (error) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), failed: true, error: error.message, results }, null, 2)}\n`);
  throw error;
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
