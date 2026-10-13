import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import {
  encodeLinkedProofData, decodeLinkedProofData, verifyLinkedProof, replayLinkedProof,
} from '../src/rml-linked-proof.mjs';

const universal = readFileSync(new URL('../../lib/meta-theory/universal.lino', import.meta.url), 'utf8');
const verifier = readFileSync(new URL('../../lib/meta-theory/proof-verifier.lino', import.meta.url), 'utf8');
const cases = JSON.parse(readFileSync(new URL('../../test-corpus/linked-proof/cases.json', import.meta.url)));
const registry = (source = verifier, executionBasis = 'direct-structural') =>
  LinkedProgramRegistry.fromRml(`${universal}\n${source}`, { executionBasis });
const disabledHostServices = ['resolve-and-rebind-program-imports', 'select-and-traverse-rewrite-rules',
  'bind-pattern-variables', 'compare-link-structure', 'substitute-bound-structures', 'saturate-inference-rules'];
const baseline = cases[0];
const observations = JSON.parse(readFileSync(new URL('../../test-corpus/linked-proof/observations.json', import.meta.url)));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('public proof verification driven by linked definitions', () => {
  const programs = registry();
  for (const sample of cases) {
    it(sample.name, () => {
      const result = verifyLinkedProof(programs, sample.context, sample.goal, sample.candidate);
      assert.equal(result.accepted, sample.accepted, JSON.stringify(result.result));
      assert.equal(result.trace[0], 'linked-execution');
      assert.equal(result.trace.length, result.steps + 1);
      const expected = observations.cases.find(item => item.name === sample.name);
      assert.equal(result.steps, expected.steps);
      assert.equal(digest(result.result), expected.resultSha256);
    });
  }

  it('quotes every input constructor and keeps empty lists distinct from atoms', () => {
    for (const value of [[], 'list-end', ['pair', 'atom', []], ['variable', 'x']]) {
      assert.deepEqual(decodeLinkedProofData(encodeLinkedProofData(value)), value);
    }
    const cyclic = []; cyclic.push(cyclic);
    assert.throws(() => encodeLinkedProofData(cyclic), /finite, acyclic/);
    assert.throws(() => decodeLinkedProofData(['proof-accepted']), /invalid quoted/);
    const quotedCycle = ['pair', null, ['list-end']]; quotedCycle[1] = quotedCycle;
    assert.throws(() => decodeLinkedProofData(quotedCycle), /finite/);
  });

  it('bounds shared DAG expansion, nesting, quoted list spines and UTF-8 text', () => {
    let shared = ['leaf'];
    let quoted = encodeLinkedProofData(shared);
    for (let index = 0; index < 12; index += 1) {
      shared = [shared, shared];
      quoted = ['pair', quoted, ['pair', quoted, ['list-end']]];
    }
    assert.throws(() => encodeLinkedProofData(shared, { maxNodes: 64 }), /node limit/);
    assert.throws(() => decodeLinkedProofData(quoted, { maxNodes: 64 }), /node limit/);
    let deep = 'leaf';
    for (let index = 0; index < 8; index += 1) deep = [deep];
    assert.throws(() => encodeLinkedProofData(deep, { maxDepth: 8 }), /depth limit/);
    const encoded = encodeLinkedProofData(deep, { maxDepth: 9 });
    assert.throws(() => decodeLinkedProofData(encoded, { maxDepth: 8 }), /depth limit/);
    assert.deepEqual(decodeLinkedProofData(encoded, { maxDepth: 9 }), deep);
    assert.throws(() => encodeLinkedProofData(Array(129).fill('x')), /depth limit/);
    const wide = encodeLinkedProofData(Array(129).fill('x'), { maxDepth: 131 });
    assert.throws(() => decodeLinkedProofData(wide), /depth limit/);
    for (const codec of [encodeLinkedProofData, value => decodeLinkedProofData(['atom', value], { maxTextBytes: 7 })]) {
      assert.throws(() => codec('😀😀', { maxTextBytes: 7 }), /text byte limit/);
    }
    assert.deepEqual(decodeLinkedProofData(encodeLinkedProofData('😀😀', { maxTextBytes: 8 }), { maxTextBytes: 8 }), '😀😀');
    assert.throws(() => encodeLinkedProofData('x', { maxDepth: 257 }), /must not exceed/);
    assert.throws(() => encodeLinkedProofData('x', { maxNodes: 0 }), /positive/);
  });

  it('enforces shared request budgets before any reduction', () => {
    const unreachable = { reduce() { throw new Error('reducer must not run'); } };
    assert.throws(() => verifyLinkedProof(unreachable, 'context', 'goal', 'candidate', {
      inputLimits: { maxNodes: 2 },
    }), /node limit/);
    assert.throws(() => verifyLinkedProof(unreachable, '😀', '😀', 'candidate', {
      inputLimits: { maxTextBytes: 7 },
    }), /text byte limit/);
  });

  it('bounds forged shared, deep and cyclic replay metadata before comparison', () => {
    const { context, goal, candidate } = baseline;
    const receipt = verifyLinkedProof(programs, context, goal, candidate);
    const unreachable = { reduce() { throw new Error('reducer must not run'); } };
    const count = value => 1 + (Array.isArray(value) ? value.reduce((n, child) => n + count(child), 0) : 0);
    const fixedNodes = count(receipt.request) + count(receipt.result);
    let shared = ['leaf'];
    for (let index = 0; index < 12; index += 1) shared = [shared, shared];
    assert.throws(() => replayLinkedProof(unreachable, context, goal, { ...receipt, trace: shared }, {
      receiptLimits: { maxNodes: fixedNodes + 64 },
    }), /node limit/);
    let deep = 'leaf';
    for (let index = 0; index < 257; index += 1) deep = [deep];
    assert.throws(() => replayLinkedProof(unreachable, context, goal, { ...receipt, trace: deep }), /depth limit/);
    const cyclic = []; cyclic.push(cyclic);
    assert.throws(() => replayLinkedProof(unreachable, context, goal, { ...receipt, trace: cyclic }), /finite/);
  });

  it('replays independently and detects forged trace, result, request, and context', () => {
    const { context, goal, candidate } = baseline;
    const receipt = verifyLinkedProof(programs, context, goal, candidate);
    assert.equal(digest(receipt.request), observations.requestSha256);
    assert.equal(digest(receipt.trace), observations.traceSha256);
    const replay = replayLinkedProof(registry(), context, goal, receipt);
    assert.equal(replay.accepted, true);
    assert.equal(replay.matches, true);
    for (const field of ['trace', 'result']) {
      const forged = structuredClone(receipt);
      forged[field] = ['proof-accepted'];
      assert.equal(replayLinkedProof(registry(), context, goal, forged).matches, false);
    }
    for (const field of ['accepted', 'steps']) {
      const forged = structuredClone(receipt);
      forged[field] = field === 'accepted' ? false : receipt.steps + 1;
      const replay = replayLinkedProof(programs, context, goal, forged);
      assert.equal(replay.accepted, true);
      assert.equal(replay.matches, false);
    }
    const forged = structuredClone(receipt);
    forged.request = ['proof-accepted'];
    assert.throws(() => replayLinkedProof(programs, context, goal, forged), /unsupported/);
    forged.request = ['verify-linked-proof', 'context', 'goal', ['proof-accepted']];
    assert.throws(() => replayLinkedProof(programs, context, goal, forged), /invalid quoted/);
    const changed = structuredClone(context); changed[1][1] = 'v2';
    assert.equal(replayLinkedProof(programs, changed, goal, receipt).accepted, false);
    assert.equal(replayLinkedProof(programs, changed, goal, receipt).matches, false);
  });

  it('replacing the linked verifier definition changes execution on the unchanged runtime', () => {
    const { context, goal, candidate } = baseline;
    const altered = verifier.replace('(to (proof-accepted ?context ?goal ?dependencies ?evidence))',
      '(to (proof-rejected replaced-verification-policy))');
    assert.notEqual(altered, verifier);
    assert.equal(verifyLinkedProof(registry(altered), context, goal, candidate).accepted, false);
    const disabled = verifier.replace('(to (match-ok ?bindings))', '(to match-failed)');
    assert.equal(verifyLinkedProof(registry(disabled), context, goal, candidate).accepted, false);
    assert.equal(verifyLinkedProof(registry(), context, goal, candidate).accepted, true);
  });

  it('never calls the host proof searcher to verify a certificate', () => {
    const isolated = registry();
    isolated.prove = isolated.search = () => { throw new Error('host proof search forbidden'); };
    assert.equal(verifyLinkedProof(isolated, baseline.context, baseline.goal, baseline.candidate).accepted, true);
  });

  it('does not relabel a stopped reduction as a rejected proof', () => {
    assert.throws(() => verifyLinkedProof(programs, baseline.context, baseline.goal,
      baseline.candidate, { maxSteps: 1 }), /step limit/);
  });

  it('cannot run without the declared S/K bootstrap operations', () => {
    for (const operation of ['contract-s-link', 'contract-k-link']) {
      const runtime = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}`, { disabledOperations: [operation] });
      assert.throws(() => verifyLinkedProof(runtime, baseline.context, baseline.goal, baseline.candidate), /disabled host semantic operation/);
    }
    const direct = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}`, {
      executionBasis: 'direct-structural', disabledOperations: disabledHostServices,
    });
    assert.throws(() => verifyLinkedProof(direct, baseline.context, baseline.goal, baseline.candidate), /disabled host semantic operation/);
  });

  it('runs the same complete inference certificate on the closed S/K runtime', { timeout: 300_000 }, () => {
    const { context, goal, candidate } = baseline;
    const runtime = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}`, {
      executionBasis: 's-k', disabledOperations: disabledHostServices,
    });
    const closed = verifyLinkedProof(runtime, context, goal, candidate);
    assert.ok(runtime.runtimeSemanticTrace().observedOperations.every(operation => !disabledHostServices.includes(operation)));
    assert.equal(closed.accepted, true);
    const independent = replayLinkedProof(registry(), context, goal, closed);
    assert.equal(independent.matches, true);
    assert.equal(independent.accepted, true);
  });
});
