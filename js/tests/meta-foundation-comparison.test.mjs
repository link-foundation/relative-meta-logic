import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HornResolution, HORN_LAWS } from '../src/rml-horn-resolution.mjs';
import { createHornLinkSubstitutionKernel } from '../src/rml-horn-link-substitution.mjs';
import {
  exploreCombinatorBasis,
  hornSelfInterpretation,
  hornWitness,
  hornWorkload,
  HORN_SELF_CASES,
  lawRemoval,
  nonEquivalence,
  SK_SELF_CASES,
  skSelfInterpretation,
  skWorkload,
  upperSource,
} from '../../experiments/foundation-comparison/compare.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const report = JSON.parse(read('../../test-corpus/foundation-comparison/report.json'));
const shared = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-observations.json'));

test('two foundations execute one byte-identical upper layer with the same reductions judgements and proofs', () => {
  assert.equal(report.upperLayer.sha256, createHash('sha256').update(upperSource).digest('hex'));
  const sk = skWorkload();
  const horn = hornWorkload(createHornLinkSubstitutionKernel(upperSource));
  assert.deepEqual(sk, shared.baseline);
  assert.deepEqual(horn, shared.baseline);
  assert.deepEqual(report.preservation, {
    sameReductionsJudgementsAndProofs: true, matchesSharedFixture: true, mechanismReplacementRows: 5,
  });
  assert.equal(report.foundations['closed-s-k'].linkSubstitution.linked, false);
  assert.equal(report.foundations['horn-resolution'].linkSubstitution.linked, true);
});

test('single and reduced-basis law removal reproduces the recorded workload-relative minimality table', { timeout: 900_000 }, () => {
  const removal = lawRemoval();
  assert.deepEqual(removal['closed-s-k'], report.foundations['closed-s-k'].removal);
  assert.deepEqual(removal['horn-resolution'], report.foundations['horn-resolution'].removal);
  const horn = removal['horn-resolution'];
  assert.deepEqual(horn.removable, ['occurs-check', 'branch-local-undo', 'backtracking', 'source-clause-order']);
  assert.equal(horn.jointRemoval, 'PRESERVED');
  assert.equal(horn.reducedBasisRemovalMinimal, true);
  for (const [law, result] of Object.entries(horn.reducedBasisRemoval)) assert.notEqual(result, 'PRESERVED', law);
  assert.equal(removal['closed-s-k'].reducedBasisRemovalMinimal, true);
  assert.deepEqual(removal['closed-s-k'].removable, []);
});

test('unknown law names are rejected and the default relation is unchanged', () => {
  const resolver = new HornResolution([{ name: 'fact', head: ['p', 'a'], body: [] }]);
  assert.throws(() => resolver.query(['p', '?x'], { ablatedLaws: ['not-a-law'] }), /unknown Horn law/);
  assert.throws(() => resolver.query(['p', '?x'], { ablatedLaws: 'occurs-check' }), /list of Horn law names/);
  assert.deepEqual(resolver.query(['p', '?x']).answers[0].goal, ['p', 'a']);
  assert.equal(HORN_LAWS.length, 10);
  // A removed decomposition law makes even this one-step query fail.
  assert.equal(resolver.query(['p', '?x'], { ablatedLaws: ['constructor-decomposition'] }).answers.length, 0);
});

test('the S/K laws as linked rules are interpreted on both foundations and a replaced K law changes both', () => {
  const result = skSelfInterpretation();
  for (const foundation of ['closed-s-k', 'horn-resolution']) {
    assert.deepEqual(result[foundation].baseline, SK_SELF_CASES.map(item => item.baseline), foundation);
    assert.deepEqual(result[foundation].replacement, SK_SELF_CASES.map(item => item.replacement), foundation);
    assert.deepEqual(result[foundation].baseline, report.foundations[foundation].selfInterpretation.baseline);
  }
});

test('the quoted linked Horn interpreter runs the linked Link-as-substitution clauses and regenerates its image', () => {
  const result = hornSelfInterpretation();
  assert.deepEqual(result.interpreted.map(item => item.interpreted), HORN_SELF_CASES.map(item => item.output));
  assert.deepEqual(result.interpreted.map(item => item.direct), HORN_SELF_CASES.map(item => item.output));
  assert.equal(result.regeneratedImageEqual, true);
  assert.deepEqual(result.interpreted, report.foundations['horn-resolution'].selfInterpretation.quotedLinkSubstitution);
});

test('the lock-step criterion separates Horn from S/K but not a renamed S/K re-encoding', () => {
  const result = nonEquivalence();
  assert.deepEqual(result, report.nonEquivalence);
  assert.equal(result.sk.explored, result.sk.terms);
  assert.equal(result.sk.maxNormalForms, 1);
  assert.ok(result.sk.branchingStates > 0, 'S/K exploration must contain nondeterministic redex choices');
  assert.equal(result.horn.distinctAnswers, 2);
  assert.equal(result.horn.failingAnswers, 0);
  assert.equal(result.horn.failingExhausted, true);
  assert.deepEqual(result.pairs.map(pair => pair.classification), ['NOT_A_LOCKSTEP_RE_ENCODING', 'RE_ENCODING_NOT_EXCLUDED']);
  // Negative controls for the measuring instrument itself.
  assert.equal(exploreCombinatorBasis({ S: 'S', K: 'K' }, { maxLeaves: 3 }).maxNormalForms, 1);
  assert.equal(hornWitness().answers.length, 2);
});

test('the report keeps the full-closure gate open and claims neither ranking nor global minimality', () => {
  assert.equal(report.schema, 'rml-meta-foundation-comparison/v1');
  assert.equal(report.gate.genuinelyDifferentFoundations, 2);
  assert.equal(report.gate.r149Satisfied, false);
  assert.ok(report.gate.openReasons.length >= 4);
  assert.equal(report.globalMinimalityClaimed, false);
  assert.equal(report.rankingClaimed, false);
  assert.equal(report.foundations['closed-s-k'].selfGeneration, 'NOT_ESTABLISHED_HOST_COMPILER_GENERATES_ARTIFACT');
  assert.equal(report.foundations['horn-resolution'].selfGeneration, 'CLAUSE_IMAGE_REGENERATED_BY_LINKED_RELATION');
  for (const foundation of Object.values(report.foundations)) assert.ok(foundation.trustBoundary.length >= 5);
});
