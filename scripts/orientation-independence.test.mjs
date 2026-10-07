import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { inspectProofSources, checkNativeProofs } from './check-orientation-independence.mjs';

const root = new URL('../', import.meta.url);

test('the two native proof sources retain the same audited theorem obligations', () => {
  const { theoremNames } = inspectProofSources();
  assert.equal(theoremNames.length, 33);
  for (const name of [
    'reversal_closed_criterion_has_alternative', 'exchanged_pair_obstruction',
    'rigid_candidate_distinction_is_invariant', 'same_observation_nondefinability',
    'positive_facts_only', 'faithful_transport_preserves_alternatives',
    'derived_carrier_preserves_stabilizer', 'recursive_carrier_equivariant',
    'noncommuting_reversal_breaks_equivariance',
  ]) assert.ok(theoremNames.includes(name));
});

test('proof holes, extra assumptions, inventory loss, and empty native checks fail closed', () => {
  const { sources } = inspectProofSources();
  for (const [language, addition] of [
    ['Lean', '\naxiom fabricated : False\n'], ['Lean', '\ntheorem fabricated : False := by sorry\n'],
    ['Rocq', '\nAxiom fabricated : False.\n'], ['Rocq', '\nTheorem fabricated : False. Admitted.\n'],
  ]) assert.throws(() => inspectProofSources({ ...sources, [language]: sources[language] + addition }));
  assert.throws(() => inspectProofSources({ ...sources, Rocq: sources.Rocq.replace('Print Assumptions positive_facts_only.', '') }), /expose its kernel assumptions/);
  assert.throws(() => checkNativeProofs([]), /empty kernel check/);
  assert.throws(() => checkNativeProofs(['JavaScript']), /Select Lean, Rocq/);
});

test('recorded native result matches these sources and includes both kernels and rejected counterclaims', () => {
  const record = JSON.parse(readFileSync(new URL('test-corpus/orientation-independence/verification.json', root)));
  for (const [path, hash] of Object.entries(record.sourceHashes)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex'), hash);
  }
  assert.deepEqual(record.kernels.map(kernel => kernel.language), ['Lean', 'Rocq']);
  assert.deepEqual(record.theoremNames, inspectProofSources().theoremNames);
  for (const kernel of record.kernels) {
    assert.equal(kernel.checkedTheorems, 33);
    assert.deepEqual(kernel.axioms, []);
    assert.equal(kernel.negatives.length, 4);
    assert.ok(kernel.negatives.every(item => item.exitCode > 0 && item.status === 'rejected-false-claim'));
  }
  assert.equal(record.requirementStatus.R147, 'PARTIAL_ENDOGENOUS_CONSEQUENCE_OPEN');
  assert.equal(record.requirementStatus.R148, 'PARTIAL_INTRINSIC_ORIENTATION_OPEN');
});

test('dedicated CI requires real Lean and Rocq checks and owned-cache teardown', () => {
  const workflow = readFileSync(new URL('.github/workflows/orientation-proofs.yml', root), 'utf8');
  assert.match(workflow, /check-orientation-independence\.mjs --languages=Lean/);
  assert.match(workflow, /check-orientation-independence\.mjs --languages=Rocq/);
  assert.match(workflow, /leanprover\/lean4:v4\.28\.0/);
  assert.match(workflow, /rocq\/rocq-prover:9\.1/);
  assert.match(workflow, /docker\/run-owned\.sh/);
  assert.equal((workflow.match(/node scripts\/build-cache\.mjs --full/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
});

test('an absent requested compiler fails instead of skipping native checking', () => {
  const result = spawnSync(process.execPath, ['scripts/check-orientation-independence.mjs', '--languages=Lean'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, LEAN: '/nonexistent-rml-orientation-compiler/lean' },
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not complete/);
  assert.doesNotMatch(result.stdout, /passed-selected-kernels/);
});
