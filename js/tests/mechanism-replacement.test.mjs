import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyLinkedSourceReplacement,
  changedObservations,
  hornObservations,
  lambdaObservations,
  matrix,
  mechanismMatrix,
  source,
} from '../../experiments/definition-replacement/mechanism-matrix.mjs';
import { createLambdaKernel } from '../src/rml-lambda-kernel.mjs';
import { createHornLinkSubstitutionKernel } from '../src/rml-horn-link-substitution.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const shared = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-observations.json'));
const workload = read('../../test-corpus/lambda-kernel/workload.lino');

test('each linked mechanism replacement changes execution identically on S/K, Horn and the lambda control', { timeout: 600_000 }, () => {
  const report = mechanismMatrix();
  assert.deepEqual(report.executions, ['lambda', 'compiled-sk', 'horn']);
  assert.equal(report.baselineAgrees, true);
  assert.deepEqual(report.baseline, shared.baseline);
  assert.deepEqual(report.rows.map(row => row.level), [
    'matching', 'substitution', 'rule-selection-and-application',
    'definition-import-and-rebinding', 'verification',
  ]);
  for (const [index, row] of report.rows.entries()) {
    assert.equal(row.agreeAcrossExecutions, true, row.id);
    assert.deepEqual(row.observations, shared.rows[index].observations, row.id);
    assert.deepEqual(row.changed, shared.rows[index].changed, row.id);
    assert.ok(row.changed.length > 0, `${row.id} must change an observation`);
    assert.equal(row.observations.error, undefined, row.id);
  }
  assert.equal(report.claimsFullImplementationClosure, false);
});

test('mechanism replacements produce the independently predicted observations', () => {
  const byId = Object.fromEntries(shared.rows.map(row => [row.id, row.observations]));
  const term = (id, name) => byId[id].reductions.find(item => item.name === name).term;
  assert.deepEqual(term('matching-ignores-repeated-binding', 'unequal repeated binding'), ['equal', 'a']);
  assert.deepEqual(term('substitution-reverses-lists', 'recursive substitution'), ['done', ['value', 'nested'], 'pair']);
  assert.deepEqual(term('selection-prefers-later-rule', 'ordered rule choice'), ['selected', 'second', 'a']);
  assert.deepEqual(term('definition-rebinding-reversed', 'import rebinding'), ['renamed', 'value']);
  assert.deepEqual(byId['definition-rebinding-reversed'].derivations[0].judgement, ['reached', 'seed']);
  assert.deepEqual(byId['verification-accepts-first-known'].absentProof.judgement, ['ready', 'seed']);
  assert.deepEqual(byId['verification-accepts-first-known'].proof.judgement, ['ready', 'seed']);
  assert.deepEqual(changedObservations(shared.baseline, byId['verification-accepts-first-known']), ['proof', 'absentProof']);
});

test('stale or forged replacement declarations are rejected instead of silently selecting another definition', () => {
  const [first] = matrix.replacements;
  assert.throws(() => applyLinkedSourceReplacement(source.replace('(lambda previous n752)', '(lambda previous n751)'), first),
    /no longer matches n753/);
  assert.throws(() => applyLinkedSourceReplacement(source.replace('(node-count 1446)', ''), first), /node-count/);
  const forged = { ...first, add: [['n9', '(variable x)']] };
  assert.throws(() => createLambdaKernel(applyLinkedSourceReplacement(source, forged)), /duplicate|counts|unbound/);
  const open = { id: 'open', replace: [['n753', '(lambda previous n752)', '(lambda previous n1446)']], add: [['n1446', '(variable unbound-name)']] };
  assert.throws(() => createLambdaKernel(applyLinkedSourceReplacement(source, open)), /unbound/);
  assert.match(lambdaObservations(applyLinkedSourceReplacement(source, open)).error, /unbound/);
  assert.match(hornObservations(applyLinkedSourceReplacement(source, open)).error, /unbound/);
});

test('a D-prime kernel and the default kernel stay isolated in one process', () => {
  const programs = LinkedProgramRegistry.fromRml(workload).programs;
  const replacement = matrix.replacements.find(item => item.id === 'selection-prefers-later-rule');
  const changed = createHornLinkSubstitutionKernel(applyLinkedSourceReplacement(source, replacement));
  const original = createHornLinkSubstitutionKernel(source);
  assert.deepEqual(changed.reduce(programs, 'rules', ['choose', 'a']).term, ['selected', 'second', 'a']);
  assert.deepEqual(original.reduce(programs, 'rules', ['choose', 'a']).term, ['selected', 'first', 'a']);
  assert.deepEqual(LinkedProgramRegistry.fromRml(workload).reduce('rules', ['choose', 'a']).term, ['selected', 'first', 'a']);
});
