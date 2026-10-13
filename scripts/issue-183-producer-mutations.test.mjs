// Mutation tests of the real producer-to-gate pipeline on real repository
// inputs: the reviewed manifest's own check definitions, the repository's own
// test files and implementations, the real Node reporter and the real gate.
// Each scratch tree is a byte-identical copy of the pinned inputs; mutations
// are re-pinned, as an author editing the manifest would, so only executed
// behavior can reject them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { executeIssue183Check, runIssue183Acceptance, sha256 } from './issue-183-requirements.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'docs/case-studies/issue-183';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, BASE, 'requirements.manifest.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, BASE, 'requirements.sources.json'), 'utf8'));
const realCheck = id => {
  const check = manifest.checks.find(candidate => candidate.id === id);
  assert.ok(check, `reviewed manifest no longer defines ${id}`);
  return structuredClone(check);
};

function scratch(context, checks) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rml-real-producer-')));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The implementation's whole module graph and its installed providers.
  fs.cpSync(path.join(ROOT, 'js/src'), path.join(root, 'js/src'), { recursive: true });
  for (const check of checks) for (const pin of check.files) {
    fs.mkdirSync(path.dirname(path.join(root, pin.path)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, pin.path), path.join(root, pin.path));
    assert.equal(sha256(fs.readFileSync(path.join(root, pin.path))), pin.sha256, `reviewed pin is stale in the checkout: ${pin.path}`);
  }
  fs.symlinkSync(path.join(ROOT, 'js/node_modules'), path.join(root, 'js/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(root, 'js/vendor'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'js/vendor/meta-language'), path.join(root, 'js/vendor/meta-language'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}
function edit(root, check, relative, transform) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  assert.notEqual(after, before, `mutation did not apply to ${relative}`);
  fs.writeFileSync(file, after);
  for (const pin of check.files) if (pin.path === relative) pin.sha256 = sha256(fs.readFileSync(file));
}

describe('real issue 183 producer-to-gate mutations', () => {
  const testFile = 'js/tests/proof-substrate.test.mjs';
  const implementation = 'js/src/rml-links.mjs';
  const cyclic = 'detects cyclic proof-object dependencies';

  it('the unmodified reviewed proof-substrate producer passes every bound assertion', context => {
    const check = realCheck('proof-substrate-js');
    const root = scratch(context, [check]);
    const evidence = executeIssue183Check(root, check);
    assert.equal(evidence.passed, true, evidence.error);
    assert.equal(evidence.assertions.length, check.assertions.length);
    assert.ok(check.assertions.some(assertion => assertion.name === cyclic && assertion.polarity === 'negative'));
  });

  it('removing a required real test is rejected while the remaining ordinary suite stays green', context => {
    const check = realCheck('proof-substrate-js');
    const root = scratch(context, [check]);
    edit(root, check, testFile, text => {
      const start = text.indexOf(`  it('${cyclic}'`);
      const end = text.indexOf('  it(', start + 1);
      assert.ok(start > 0 && end > start);
      return text.slice(0, start) + text.slice(end);
    });
    const ordinary = spawnSync(process.execPath, ['--test', testFile], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } });
    assert.equal(ordinary.status, 0, ordinary.stdout + ordinary.stderr);
    const evidence = executeIssue183Check(root, check);
    assert.equal(evidence.passed, false);
    assert.match(evidence.error, new RegExp(`required assertion did not execute exactly once: ${cyclic}`));
  });

  it('suppressing the real test process callback stream is rejected despite exit status zero', context => {
    const check = realCheck('proof-substrate-js');
    const root = scratch(context, [check]);
    edit(root, check, testFile, text => `process.stdout.write = () => true;\n${text}`);
    const evidence = executeIssue183Check(root, check);
    assert.equal(evidence.passed, false);
    assert.match(evidence.error, /did not execute exactly once|missing live execution callbacks/);
  });

  it('replacing real cycle-detection semantics with a placeholder success is rejected', context => {
    const check = realCheck('proof-substrate-js');
    const root = scratch(context, [check]);
    edit(root, check, implementation, text => text.replace(
      'return { ok: false, error: `cyclic proof dependency: ${stack.concat([name]).join(\' -> \')}` };',
      'return { ok: true };'));
    const evidence = executeIssue183Check(root, check);
    assert.equal(evidence.passed, false);
    assert.match(evidence.error, /execution failed/);
  });

  it('a falsified Complete status on a real partial row is rejected although its executed check passes', context => {
    // Project real R118 through the real gate: its reviewed obligation,
    // original sources, implementation pins, JavaScript producer and progress
    // bindings, with a consistent hand edit of both status cells to Complete.
    const record = structuredClone(manifest.requirements.find(row => row.id === 'R118'));
    assert.match(record.status, /^Partial/);
    assert.equal(record.completionBindings.length, 0);
    const check = realCheck('foundation-context-js');
    const root = scratch(context, [check]);
    // The reviewed check reads this fixture but does not pin it yet.
    fs.copyFileSync(path.join(ROOT, 'test-corpus/foundations/expected.json'), path.join(root, 'test-corpus/foundations/expected.json'));
    for (const pin of record.implementationClaims) {
      fs.mkdirSync(path.dirname(path.join(root, pin.path)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, pin.path), path.join(root, pin.path));
    }
    const projected = { ...record, id: 'R1', status: 'Complete', checks: [check.id], assertionBindings: record.assertionBindings.filter(binding => binding.checkId === check.id) };
    const projectedSources = sources.sources.filter(source => record.originalWording.some(ref => ref.sourceId === source.id)).map(source => ({ ...source, requirementIds: ['R1'] }));
    const snapshot = { ...sources, requiredRequirementIds: ['R1'], sources: projectedSources };
    fs.mkdirSync(path.join(root, BASE), { recursive: true });
    fs.writeFileSync(path.join(root, BASE, 'sources.json'), JSON.stringify(snapshot));
    const ledger = `${projectedSources.map(source => source.url).join('\n')}\n| R1 | ${record.obligation} | Complete | ${record.claimedEvidence} |\n`;
    const input = { root, ledger, sources: snapshot, enforceBaseline: false, manifest: { schema: manifest.schema, sourceSnapshot: { path: `${BASE}/sources.json`, role: 'source', sha256: sha256(fs.readFileSync(path.join(root, BASE, 'sources.json'))) }, checks: [check], requirements: [projected] } };
    const report = runIssue183Acceptance(input);
    assert.deepEqual(report.errors, []);
    assert.equal(report.checks[0].passed, true, report.checks[0].error);
    assert.equal(report.passed, false);
    const errors = report.requirements[0].errors.join('\n');
    assert.match(errors, /missing full-scope positive completion binding; progress evidence is not completion/);
    assert.match(errors, /missing native validation producer/);
    // Supplying fabricated full-scope bindings for assertions the producer does
    // not define is rejected before anything executes.
    projected.completionBindings = [{ checkId: check.id, file: check.testFiles[0], name: 'full four-language guarded outcome closure', polarity: 'positive' }];
    const fabricated = runIssue183Acceptance(input);
    assert.equal(fabricated.passed, false);
    assert.match(fabricated.errors.join('\n'), /full-scope binding has no matching progress assertion/);
  });
});
