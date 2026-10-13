import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Committed condensations of real CI artifacts. Each records its run, artifact and
// the SHA-256 of the full report it was condensed from; CI re-measures on every push.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = name => JSON.parse(fs.readFileSync(path.join(root, 'docs/case-studies/issue-183/data', name), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const requiredSteps = ['bootstrap fresh fixture', 'first actual JSDoc build', 'first complete Rust test-target compilation', 'first full cleanup', 'clean JSDoc rebuild', 'post-rebuild full JavaScript verification', 'post-clean full Rust rebuild and verification', 'final full cleanup'];
const sweep = /^build-cache: superseded Cargo units removed=(\d+) reclaimed=(\d+) bytes/;

/** Every reason a native measured cycle does not prove a clean rebuild and a full passing verification. */
export function nativeCycleErrors(report) {
  const errors = [];
  if (report.failed) errors.push('the measurement itself failed');
  const p = report.provenance ?? {};
  if (!Number.isInteger(p.runId) || !Number.isInteger(p.artifactId) || !/^[0-9a-f]{64}$/.test(p.fullReportSha256 ?? '') || !/^[0-9a-f]{40}$/.test(p.mergeRevision ?? '')) errors.push('missing run, artifact or report provenance');
  if (!/excludes/.test(report.scope ?? '')) errors.push('scope does not state its exclusions');
  const labels = (report.results ?? []).map(result => result.label);
  for (const label of requiredSteps) if (!labels.includes(label)) errors.push(`missing step: ${label}`);
  for (const result of report.results ?? []) if (result.exitCode !== 0) errors.push(`step failed: ${result.label}`);
  if (!(report.firstBuildBytes > 0)) errors.push('nothing was built');
  for (const key of ['fullClean', 'finalClean']) {
    const clean = report[key] ?? {};
    if (clean.afterBytes !== 0 || !(clean.reclaimedBytes > 0) || clean.beforeBytes - clean.afterBytes !== clean.reclaimedBytes) errors.push(`${key} did not reclaim every measured byte`);
  }
  if (!(report.rebuiltBytes > 0)) errors.push('the clean rebuild produced nothing');
  const js = report.results?.find(result => result.label === 'post-rebuild full JavaScript verification')?.javascriptTests;
  if (!js || !(js.pass > 0) || js.fail !== 0 || js.cancelled !== 0 || js.pass + js.skipped + js.todo !== js.tests) errors.push('JavaScript suite did not fully pass');
  const rust = report.results?.find(result => result.label === 'post-clean full Rust rebuild and verification')?.rustTests;
  if (!rust || !(rust.passed > 0) || rust.failed !== 0) errors.push('Rust suite did not fully pass');
  const oracles = report.results?.find(result => /oracles/.test(result.label))?.oracles;
  if (!oracles || !/^passed/.test(oracles.status) || !oracles.checks?.length || oracles.checks.some(check => check.status !== 'passed')) errors.push('native oracles did not pass');
  for (const name of report.requiredNativeOracles ?? []) if (!oracles?.versions?.[name]) errors.push(`required oracle ${name} has no recorded version`);
  return errors;
}

/** Every reason a Docker CI teardown does not prove that each owned resource was removed. */
export function dockerTeardownErrors(evidence) {
  const errors = [];
  if (!Number.isInteger(evidence.provenance?.runId) || !Number.isInteger(evidence.provenance?.artifactId)) errors.push('missing run or artifact provenance');
  if (evidence.lifecycle?.build_exit !== '0' || evidence.lifecycle?.cleanup_exit !== '0') errors.push('build or Docker cleanup failed');
  const reports = Object.entries(evidence.reports ?? {});
  const docker = reports.filter(([name]) => name.startsWith('docker-budget-'));
  if (!docker.some(([, report]) => report.resourceKind === 'buildx')) errors.push('no owned builder was torn down');
  for (const [name, report] of docker) {
    if (report.resourcesRemoved !== true || report.cleanupExitCode !== 0) errors.push(`${name}: owned resources remain`);
  }
  const builder = docker.find(([, report]) => report.resourceKind === 'buildx')?.[1];
  if (builder && (builder.remainingDockerBytes !== 0 || !(builder.reclaimedBytes > 0))) errors.push('builder teardown left Docker bytes');
  const last = evidence.reports?.['last-cleanup.json'];
  if (!last || last.afterBytes !== 0 || last.externalBytes !== 0) errors.push('final local cleanup left owned bytes');
  if (evidence.teardownStep?.conclusion !== 'success') errors.push('the always-run teardown step did not succeed');
  if (!evidence.commandEvidence?.length || evidence.commandEvidence.some(command => command.exitCode !== 0)) errors.push('the wrapped Docker command did not succeed');
  return errors;
}

test('the committed native cycle measured a full clean, a byte-identical clean rebuild and fully passing suites', () => {
  const report = load('build-cache-measurement-native.json');
  assert.deepEqual(nativeCycleErrors(report), []);
  // Rebuilding every target after the full clean reproduced exactly the first build's bytes.
  assert.equal(report.finalClean.beforeBytes, report.firstBuildBytes);
  assert.deepEqual(report.requiredNativeOracles, ['Rust', 'Lean']);
  assert.match(report.scope, /excludes Rocq oracles, Docker/);
});

test('the committed native cycle shows the superseded-unit sweep and the budget bounding Rust output', () => {
  const report = load('build-cache-measurement-native.json');
  for (const label of ['first complete Rust test-target compilation', 'post-clean full Rust rebuild and verification']) {
    const lines = report.results.find(result => result.label === label).cacheLines;
    const swept = lines.map(line => line.match(sweep)).find(Boolean);
    assert.ok(swept && Number(swept[1]) > 0 && Number(swept[2]) > 0, `${label}: the Cargo sweep removed nothing`);
    // The postflight bounded cleanup brought the compiled tree back within the budget.
    const bounded = lines.map(line => line.match(/^build-cache: before=(\d+) after=(\d+) reclaimed=(\d+) budget=(\d+) bytes;.*within budget$/)).filter(Boolean).at(-1);
    assert.ok(bounded && Number(bounded[1]) > Number(bounded[4]) && Number(bounded[2]) <= Number(bounded[4]), `${label}: output was not bounded`);
  }
});

test('a forged, failing or incomplete native measurement is rejected', () => {
  const original = load('build-cache-measurement-native.json');
  const step = (report, label) => report.results.find(result => result.label === label);
  const mutations = {
    'failed measurement': r => { r.failed = true; },
    'nonzero step': r => { step(r, 'clean JSDoc rebuild').exitCode = 1; },
    'missing Rust verification': r => { r.results = r.results.filter(result => result.label !== 'post-clean full Rust rebuild and verification'); },
    'JavaScript failure': r => { step(r, 'post-rebuild full JavaScript verification').javascriptTests.fail = 1; },
    'uncounted JavaScript tests': r => { step(r, 'post-rebuild full JavaScript verification').javascriptTests.tests += 7; },
    'Rust failure': r => { step(r, 'post-clean full Rust rebuild and verification').rustTests.failed = 2; },
    'no test evidence': r => { delete step(r, 'post-rebuild full JavaScript verification').javascriptTests; },
    'bytes left after full clean': r => { r.fullClean.afterBytes = 5; },
    'fabricated reclaim': r => { r.finalClean.reclaimedBytes += 1; },
    'empty rebuild': r => { r.rebuiltBytes = 0; },
    'failed oracle': r => { r.results.find(result => /oracles/.test(result.label)).oracles.checks[0].status = 'failed'; },
    'unversioned oracle': r => { delete r.results.find(result => /oracles/.test(result.label)).oracles.versions.Lean; },
    'missing provenance': r => { delete r.provenance.runId; },
    'unstated exclusions': r => { r.scope = 'Everything.'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const report = clone(original);
    mutate(report);
    assert.notDeepEqual(nativeCycleErrors(report), [], name);
  }
});

test('the committed Docker teardown removed every owned resource and left nothing behind', () => {
  const evidence = load('docker-teardown-ci.json');
  assert.deepEqual(dockerTeardownErrors(evidence), []);
  const builder = Object.values(evidence.reports).find(report => report.resourceKind === 'buildx');
  assert.ok(builder.reclaimedBytes > 1e9, 'a real image build was torn down');
  assert.equal(evidence.teardownStep.command, 'node scripts/build-cache.mjs --full');
});

test('a Docker teardown that kept resources, failed or left bytes is rejected', () => {
  const original = load('docker-teardown-ci.json');
  const builder = evidence => Object.values(evidence.reports).find(report => report.resourceKind === 'buildx');
  const mutations = {
    'cleanup failure': e => { e.lifecycle.cleanup_exit = '1'; },
    'build failure': e => { e.lifecycle.build_exit = '2'; },
    'resources kept': e => { builder(e).resourcesRemoved = false; },
    'remaining Docker bytes': e => { builder(e).remainingDockerBytes = 5; },
    'no builder report': e => { for (const [name, report] of Object.entries(e.reports)) if (report.resourceKind === 'buildx') delete e.reports[name]; },
    'local bytes left': e => { e.reports['last-cleanup.json'].afterBytes = 10; },
    'teardown step failed': e => { e.teardownStep.conclusion = 'failure'; },
    'wrapped command failed': e => { e.commandEvidence[0].exitCode = 1; },
    'missing provenance': e => { delete e.provenance.artifactId; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const evidence = clone(original);
    mutate(evidence);
    assert.notDeepEqual(dockerTeardownErrors(evidence), [], name);
  }
});
