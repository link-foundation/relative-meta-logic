import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// A committed condensation of every hosted pull-request workflow run at one commit:
// workflow, run, job conclusions, the log digest and the exact Node, rustc, Lean and
// Rocq versions the logs report. The acceptance gate may fail only on the ledger's
// unfinished rows; every other workflow must succeed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = 'docs/case-studies/issue-183/data/ci-matrix.json';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const acceptance = '.github/workflows/issue-183-acceptance.yml';

/** The pull-request workflows and the toolchains each one's YAML pins. */
export function workflowExpectations(files = read) {
  const directory = path.join(root, '.github/workflows');
  return fs.readdirSync(directory).filter(name => name.endsWith('.yml')).sort().map(name => {
    const file = `.github/workflows/${name}`;
    const yaml = files(file);
    const trigger = yaml.slice(yaml.search(/^on:/m), yaml.search(/^(?:permissions|concurrency|env|jobs):/m));
    return {
      file,
      pullRequest: /^\s+pull_request:/m.test(trigger),
      nodeMajors: [...new Set([...yaml.matchAll(/node-version: '(\d+)'/g)].map(m => m[1]))],
      rust: yaml.includes('rust-toolchain'),
      lean: yaml.match(/leanprover\/lean4:v(\d+\.\d+\.\d+)/)?.[1] ?? null,
      rocqImage: yaml.match(/rocq\/rocq-prover:[0-9.]+@sha256:[0-9a-f]{64}/)?.[0] ?? null,
    };
  }).filter(item => item.pullRequest);
}

/** The ledger rows that are not Complete. */
export function unfinishedRows(files = read) {
  const manifest = JSON.parse(files('docs/case-studies/issue-183/requirements.manifest.json'));
  return (manifest.rows ?? manifest.requirements).filter(row => !row.status.startsWith('Complete')).map(row => row.id);
}

/** Every reason the matrix is not a complete, successful run of every workflow at one commit. */
export function matrixErrors(matrix, expected = workflowExpectations(), unfinished = unfinishedRows()) {
  const errors = [];
  const p = matrix.provenance ?? {};
  if (!/^[0-9a-f]{40}$/.test(p.headSha ?? '') || p.event !== 'pull_request') errors.push('missing commit or event provenance');
  const recorded = new Map((matrix.workflows ?? []).map(entry => [entry.workflow, entry]));
  if (recorded.size !== (matrix.workflows ?? []).length) errors.push('a workflow is recorded twice');
  for (const workflow of recorded.keys()) if (!expected.some(item => item.file === workflow)) errors.push(`${workflow}: not a pull-request workflow of this tree`);
  for (const want of expected) {
    const entry = recorded.get(want.file);
    if (!entry) { errors.push(`${want.file}: no run at the recorded commit`); continue; }
    if (!Number.isInteger(entry.runId) || !/^[0-9a-f]{64}$/.test(entry.logSha256 ?? '') || !entry.jobs?.length) errors.push(`${want.file}: missing run, log or job provenance`);
    const versions = Object.fromEntries((entry.jobs ?? []).flatMap(job => Object.entries(job.versions ?? {})).map(([name, value]) => [name, value]));
    const all = name => (entry.jobs ?? []).map(job => job.versions?.[name]).filter(Boolean);
    if (want.file === acceptance) {
      const gate = entry.acceptance ?? {};
      if (gate.otherFailures?.length) errors.push(`${want.file}: rows fail for reasons other than being unfinished`);
      if (JSON.stringify(gate.unfinished ?? null) !== JSON.stringify(unfinished)) errors.push(`${want.file}: unfinished rows differ from the ledger`);
      if (entry.conclusion !== (unfinished.length ? 'failure' : 'success')) errors.push(`${want.file}: conclusion ${entry.conclusion} does not match ${unfinished.length} unfinished rows`);
      if ((entry.jobs ?? []).some(job => job.failedSteps?.length > 1)) errors.push(`${want.file}: more than the delivery step failed`);
    } else {
      if (entry.conclusion !== 'success') errors.push(`${want.file}: concluded ${entry.conclusion}`);
      for (const job of entry.jobs ?? []) if (!['success', 'skipped'].includes(job.conclusion)) errors.push(`${want.file}: job ${job.name} concluded ${job.conclusion}`);
    }
    if (!all('node').length || all('node').some(version => !want.nodeMajors.includes(version.split('.')[0]))) errors.push(`${want.file}: Node version missing or not the pinned major`);
    if (want.rust && !/^\d+\.\d+\.\d+ \([0-9a-f]+ \d{4}-\d\d-\d\d\)$/.test(versions.rustc ?? '')) errors.push(`${want.file}: rustc version missing`);
    // elan reports the installed toolchain; `lean --version` is recorded too where a job runs it.
    const lean = [...all('lean'), ...all('leanToolchain')];
    if (want.lean && (!lean.length || lean.some(version => version !== want.lean))) errors.push(`${want.file}: Lean version missing or differs from ${want.lean}`);
    if (want.rocqImage && (all('rocqImage').some(image => image !== want.rocqImage) || !all('rocqImage').length || !/^\d+\.\d+\.\d+$/.test(versions.rocq ?? ''))) errors.push(`${want.file}: Rocq image or version missing or differs`);
  }
  return errors;
}

test('the committed CI matrix records every pull-request workflow at one commit with exact toolchain versions', () => {
  const matrix = JSON.parse(read(matrixPath));
  assert.equal(matrix.schema, 'rml-ci-matrix/v1');
  assert.deepEqual(matrixErrors(matrix), []);
  assert.ok(workflowExpectations().length >= 15);
});

test('a matrix with a missing, failed, unversioned or mis-gated workflow is rejected', () => {
  const original = JSON.parse(read(matrixPath));
  const expected = workflowExpectations();
  const unfinished = unfinishedRows();
  const find = (matrix, name) => matrix.workflows.find(entry => entry.workflow.endsWith(name));
  const mutations = {
    'missing workflow': m => { m.workflows = m.workflows.filter(entry => !entry.workflow.endsWith('tests.yml')); },
    'failed workflow': m => { find(m, 'formal-corpus.yml').conclusion = 'failure'; },
    'failed job': m => { find(m, 'cache-portability.yml').jobs[0].conclusion = 'failure'; },
    'missing Node version': m => { for (const job of find(m, 'lint-english.yml').jobs) delete job.versions.node; },
    'missing rustc version': m => { for (const job of find(m, 'tests.yml').jobs) delete job.versions.rustc; },
    'different Lean version': m => { for (const job of find(m, 'formal-corpus.yml').jobs) if (job.versions.leanToolchain) job.versions.leanToolchain = '4.0.0'; },
    'unpinned Rocq image': m => { for (const job of find(m, 'formal-corpus.yml').jobs) if (job.versions.rocqImage) job.versions.rocqImage = 'rocq/rocq-prover:latest'; },
    'acceptance fails for another reason': m => { find(m, 'issue-183-acceptance.yml').acceptance.otherFailures.push('R1: check failed'); },
    'acceptance hides an unfinished row': m => { find(m, 'issue-183-acceptance.yml').acceptance.unfinished.pop(); },
    'unknown workflow': m => { m.workflows.push({ ...clone(find(m, 'tests.yml')), workflow: '.github/workflows/removed.yml' }); },
    'missing commit': m => { delete m.provenance.headSha; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const matrix = clone(original);
    mutate(matrix);
    assert.notDeepEqual(matrixErrors(matrix, expected, unfinished), [], name);
  }
  assert.notDeepEqual(matrixErrors(original, expected, unfinished.slice(1)), [], 'a row finished after the recorded run');
});
