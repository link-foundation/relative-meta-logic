import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runResearcherWorkflow, researcherPackages, proofRegistry, certificateFromResult, selection, constructResearchObjects, executeResearchAlgorithm } from '../../examples/researcher-workflow.mjs';
import { FoundationPackages } from '../src/rml-foundation-packages.mjs';
import { verifyLinkedProof, replayLinkedProof } from '../src/rml-linked-proof.mjs';
import { TypedSemanticArchive } from '../src/rml-semantic-archive.mjs';
import { translatePortableNatural } from '../src/rml-portable-natural.mjs';
const expected = () => JSON.parse(readFileSync(new URL('../../test-corpus/researcher-workflow/expected.json', import.meta.url)));

for (const [executionBasis, assertionName] of [
  ['direct-structural', 'researcher lifecycle uses public APIs on direct-structural'],
  ['s-k', 'researcher lifecycle uses public APIs on s-k'],
]) test(assertionName, { timeout: 900_000 }, () => {
  const { report } = runResearcherWorkflow({ executionBasis });
  assert.deepEqual(report, { ...expected(), executionBasis });
});

test('replay rejects changed context, missing premise, forged conclusion, dependencies and trace', () => {
  const { certificate, receipt, manifests, first } = runResearcherWorkflow({ executionBasis: 'direct-structural' });
  const { context, goal, candidate } = certificate;
  const registry = proofRegistry();
  const verify = value => verifyLinkedProof(registry, context, goal, value).accepted;
  assert.equal(verify(candidate), true);
  for (const mutate of [
    value => value[4].pop(),
    value => { value[4][0][3] = ['publishable', 'forged']; },
    value => { value[4][0][6] = []; },
    value => { value[4][0][4] = [['x', 'forged']]; },
    value => { value[4][0][5] = ['n0']; },
  ]) {
    const altered = structuredClone(candidate); mutate(altered); assert.equal(verify(altered), false);
  }
  const otherContext = structuredClone(context); otherContext[1][1] = '2';
  assert.equal(replayLinkedProof(registry, otherContext, goal, receipt).accepted, false);
  const altered = structuredClone(receipt); altered.trace = ['linked-execution'];
  assert.equal(replayLinkedProof(registry, context, goal, altered).matches, false);
  const noEvidence = { ...first, result: { ...first.result, proof: null } };
  assert.throws(() => certificateFromResult(manifests[0], noEvidence), /assumption-free proof/);
  assert.throws(() => certificateFromResult(manifests[1], first), /matching/);
  const alteredSource = { ...manifests[0], source: manifests[0].source.replace('(input specimen)', '(input other)') };
  const stale = certificateFromResult(alteredSource, first);
  assert.equal(verifyLinkedProof(registry, stale.context, stale.goal, stale.candidate).accepted, false);
  // A claimed dependency cannot import an unrelated rule into trusted context.
  const forgedAnswer = structuredClone(first);
  forgedAnswer.result.dependencies.closure.push({ program: 'unrelated', role: 'axioms' });
  forgedAnswer.programs.push({ address: 'unrelated', name: manifests[0].name, version: manifests[0].version, program: 'unrelated' });
  const sourceWithUnrelated = { ...manifests[0], source: `${manifests[0].source}\n(linked-program unrelated)\n(linked-fact unrelated claim (judgement (publishable forged)))` };
  assert.deepEqual(certificateFromResult(sourceWithUnrelated, forgedAnswer).context, context);
});

test('changing a user source changes conclusions; source validation and version ownership cannot be bypassed', () => {
  const manifests = researcherPackages();
  const baseline = FoundationPackages.fromPackages(manifests, { executionBasis: 'direct-structural' });
  const goal = ['publishable', 'specimen'];
  const own = baseline.ask(selection('1'), goal);
  manifests[0].source = manifests[0].source.replace('(conclusion (accepted ?x))', '(conclusion (rejected ?x))');
  const changed = FoundationPackages.fromPackages(manifests, { executionBasis: 'direct-structural' });
  assert.equal(changed.ask(selection('1'), goal).result.status, 'refuted');
  assert.equal(baseline.ask(selection('1'), goal).result.status, 'proved');
  assert.throws(() => changed.revise([own], selection('1'), { removeRule: ['rules', 'admission'] }), /returned by this package workspace/);
  assert.throws(() => baseline.revise([own], selection('1'), { removeRule: ['rules', 'absent'] }), /no linked rule/);
  assert.throws(() => FoundationPackages.fromPackages([manifests[0], manifests[0]]), /duplicate package/);
  for (const language of ['Rust', 'Lean', 'Rocq']) {
    const unsupported = translatePortableNatural('async function successor(n) { return await n; }', 'JavaScript', language);
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.targetSource, null);
    assert.match(unsupported.obligations[0].code, /^RML_PORTABLE_/);
  }
});


test('constructs typed link-valued sets and executes their linked length algorithm on both bases', () => {
  const { summary, typed, collections } = constructResearchObjects();
  assert.deepEqual(summary, expected().objects);
  assert.throws(() => collections.encodeOrderedSet(['specimen', 'specimen'], 'bad-order'), /duplicate/);
  const missing = typed.snapshot(); missing.links = missing.links.filter(row => row.address !== 'submitted-edge');
  assert.throws(() => new TypedSemanticArchive(missing, { roots: [summary.setRoot] }), /dangling/);
  for (const executionBasis of ['direct-structural', 's-k']) {
    const packages = researcherPackages();
    const workspace = FoundationPackages.fromPackages(packages, { executionBasis });
    assert.deepEqual(executeResearchAlgorithm(workspace, summary.setMembers).result.output, ['s', ['s', 'z']]);
    assert.equal(executeResearchAlgorithm(workspace, []).result.output, 'z');
    packages[0].source = packages[0].source.replace('(to (s (length ?tail)))', '(to z)');
    const altered = FoundationPackages.fromPackages(packages, { executionBasis });
    assert.equal(executeResearchAlgorithm(altered, summary.setMembers).result.output, 'z');
  }
});
