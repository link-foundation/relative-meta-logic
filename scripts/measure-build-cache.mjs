#!/usr/bin/env node
/** Isolated, reproducible actual docs-build / full-clean / rebuild measurement. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyMeasurementSources } from './measurement-source.mjs';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [output, ...flags] = process.argv.slice(2);
const native = flags.includes('--native');
// The required portable-fragment oracles are explicit and recorded in scope;
// an oracle outside this set is never silently counted as verified.
const oracleFlag = flags.find(flag => flag.startsWith('--oracles='));
const oracles = oracleFlag ? oracleFlag.slice('--oracles='.length).split(',') : ['Rust', 'Lean', 'Rocq'];
if (!output || output.startsWith('--') || flags.some(flag => flag !== '--native' && flag !== oracleFlag) || (oracleFlag && !native) ||
    !oracles.length || oracles.some(name => !['Rust', 'Lean', 'Rocq'].includes(name)) || !oracles.includes('Rust') || new Set(oracles).size !== oracles.length) {
  throw new Error('Usage: node scripts/measure-build-cache.mjs <report.json> [--native [--oracles=Rust[,Lean][,Rocq]]]');
}
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'rml measured cycle '));
const env = { ...process.env, RML_CACHE_MIN_FREE_BYTES: '0' };
const results = [];
let activeChild;
let interruption;
const signalHandlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
  interruption ??= signal;
  activeChild?.kill(signal);
}]));
for (const [signal, handler] of signalHandlers) process.on(signal, handler);

async function run(label, command, cwd = fixture) {
  if (interruption) throw new Error(`Measurement interrupted by ${interruption}`);
  console.error(`measure-build-cache: ${label}`);
  // Long-running phases enter the cache wrapper directly. Wait for the wrapper
  // to settle its owned process group and release its lease before removing the fixture.
  const result = await new Promise(resolve => {
    activeChild = execFile(command[0], command.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      activeChild = undefined;
      resolve({ error, status: error ? (Number.isInteger(error.code) ? error.code : null) : 0, stdout, stderr });
    });
  });
  const record = { label, command: command.map(x => x.replaceAll(fixture, '<fixture>').replaceAll(source, '<source>')), exitCode: result.status, stdout: result.stdout?.replaceAll(fixture, '<fixture>'), stderr: result.stderr?.replaceAll(fixture, '<fixture>') };
  results.push(record);
  if (interruption) throw new Error(`Measurement interrupted by ${interruption} during ${label}`);
  if (result.error) throw new Error(`${label} failed: ${result.stderr}\n${result.stdout}`, { cause: result.error });
  return result;
}
try {
  copyMeasurementSources(source, fixture);
  fs.cpSync(path.join(source, 'js/node_modules'), path.join(fixture, 'js/node_modules'), { recursive: true, verbatimSymlinks: true });
  // Source-free editor integration tests require the installed editor runtime providers.
  if (fs.existsSync(path.join(source, 'vscode/node_modules'))) fs.cpSync(path.join(source, 'vscode/node_modules'), path.join(fixture, 'vscode/node_modules'), { recursive: true, verbatimSymlinks: true });
  for (const args of [['init', '-q'], ['config', 'user.name', 'Cache measurement'], ['config', 'user.email', 'cache@example.invalid'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'measurement inputs']]) execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' });
  await run('bootstrap fresh fixture', [process.execPath, 'scripts/bootstrap.mjs']);
  const wrapper = path.join(fixture, 'scripts/run-with-cache.mjs');
  const docCommand = [process.execPath, wrapper, '--', process.execPath, path.join(fixture, 'scripts/build-docs.mjs'), '--destination', '../_site/api/js'];
  await run('first actual JSDoc build', docCommand, path.join(fixture, 'js'));
  if (native) await run('first complete Rust test-target compilation', [process.execPath, wrapper, '--isolate-output', 'rust/target', '--', 'cargo', 'test', '--locked', '--manifest-path', 'rust/Cargo.toml', '--all-targets', '--no-run']);
  const first = JSON.parse((await run('before full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--report', '--json'])).stdout);
  await run('first full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--full']);
  const cleaned = JSON.parse(fs.readFileSync(path.join(fixture, '.rml-cache/reports/last-cleanup.json')));
  if (cleaned.afterBytes !== 0 || cleaned.reclaimedBytes < 1) throw new Error('No meaningful clean-build evidence');
  await run('clean JSDoc rebuild', docCommand, path.join(fixture, 'js'));
  const rebuilt = JSON.parse((await run('after clean rebuild', [process.execPath, 'scripts/build-cache.mjs', '--report', '--json'])).stdout);
  await run('post-rebuild full JavaScript verification', [process.execPath, wrapper, '--', process.execPath, '--test', '--test-concurrency=2', 'tests/*.test.mjs', '../scripts/*.test.mjs'], path.join(fixture, 'js'));
  if (native) {
    await run('post-clean full Rust rebuild and verification', [process.execPath, wrapper, '--isolate-output', 'rust/target', '--', 'cargo', 'test', '--locked', '--manifest-path', 'rust/Cargo.toml', '--all-targets']);
    await run(`post-clean required ${oracles.join(' ')} translation oracles`, [process.execPath, wrapper, '--', process.execPath, 'scripts/check-portable-native.mjs', `--require=${oracles.join(',')}`]);
  }
  await run('final full cleanup', [process.execPath, 'scripts/build-cache.mjs', '--full']);
  const final = JSON.parse(fs.readFileSync(path.join(fixture, '.rml-cache/reports/last-cleanup.json')));
  const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, node: process.version, scope: native ? `Actual JSDoc and all Rust test-target builds, full cache cleanup, clean rebuild, full JavaScript/Rust suites and required ${oracles.join('/')} portable-fragment oracles in an isolated fixture; excludes ${['Lean', 'Rocq'].filter(name => !oracles.includes(name)).map(name => `${name} oracles, `).join('')}Docker, global toolchain/dependency caches and full issue-183 acceptance.` : 'Actual JSDoc build, full cache cleanup, clean rebuild, and full npm JavaScript test suite in an isolated fixture; not Rust/Lean/Rocq/Docker or full issue-183 acceptance.', sourceRevision: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), measurementInputTree: execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), policySha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture, 'scripts/cache-policy.json'))).digest('hex'), implementationHashes: Object.fromEntries(['scripts/build-cache.mjs', 'scripts/run-with-cache.mjs', 'scripts/bootstrap.mjs', 'scripts/build-cache.test.mjs', 'scripts/build-cache-policy.test.mjs', 'scripts/cli-paths.test.mjs', 'scripts/measure-build-cache.mjs', 'scripts/measurement-source.mjs', 'scripts/measurement-source.test.mjs'].map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture, p))).digest('hex')])), requiredNativeOracles: native ? oracles : [], byteAccounting: 'Logical regular-file sizes across registered cache roots, not a filesystem quota or measurement of physical blocks; diagnostic evidence is excluded.', firstBuildBytes: first.beforeBytes, fullClean: { beforeBytes: cleaned.beforeBytes, afterBytes: cleaned.afterBytes, reclaimedBytes: cleaned.reclaimedBytes }, rebuiltBytes: rebuilt.beforeBytes, finalClean: { beforeBytes: final.beforeBytes, afterBytes: final.afterBytes, reclaimedBytes: final.reclaimedBytes }, results };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: output, firstBuildBytes: report.firstBuildBytes, reclaimedBytes: cleaned.reclaimedBytes, rebuiltBytes: report.rebuiltBytes, checks: results.map(r => [r.label, r.exitCode]) }, null, 2));
} catch (error) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), failed: true, error: error.message, results }, null, 2)}\n`);
  if (!interruption) throw error;
  console.error(error.message);
  process.exitCode = 128 + os.constants.signals[interruption];
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
}
