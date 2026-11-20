import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import {
  LINKED_PROOF_NATURAL_PROGRAM, LINKED_PROOF_OUTCOME_SCHEMA, checkLinkedProof, linkedProofOutcome, verifyLinkedProof,
} from '../src/rml-linked-proof.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const universal = read('lib/meta-theory/universal.lino');
const verifier = read('lib/meta-theory/proof-verifier.lino');
const natural = read('lib/meta-theory/proof-verifier-natural.lino');
const cases = JSON.parse(read('test-corpus/linked-proof/cases.json'));
const naturalCases = JSON.parse(read('test-corpus/linked-proof/natural-cases.json'));
const programs = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}\n${natural}`, { executionBasis: 'direct-structural' });
const valid = cases.find(item => item.name === 'valid-modus-ponens');
const forged = cases.find(item => item.name === 'forged-root-conclusion');
const check = (sample, options = {}) => checkLinkedProof(programs, sample.context, sample.goal, sample.candidate, options);
const contractKinds = new Set(FoundationWorkspace.outcomes().map(outcome => outcome.kind));

describe('linked-proof results under the shared outcome contract', () => {
  it('reports an accepted proof without caller assumptions as proved', () => {
    const { receipt, outcome } = check(valid);
    assert.equal(receipt.accepted, true);
    assert.equal(outcome.schema, LINKED_PROOF_OUTCOME_SCHEMA);
    assert.equal(outcome.kind, 'proved');
    assert.equal(outcome.truth, 'true');
    assert.equal(outcome.establishes, true);
    assert.deepEqual(outcome.assumptions, []);
  });

  it('reports a proof that uses a declared assumption as assumption-dependent and lists only the used ones', () => {
    const { outcome } = check(valid, { assumptions: ['p', 'unused-rule'] });
    assert.equal(outcome.kind, 'assumption-dependent');
    assert.equal(outcome.status, 'proved');
    assert.equal(outcome.truth, 'conditional');
    assert.equal(outcome.assumptionDependent, true);
    assert.deepEqual(outcome.assumptions, ['p']);
  });

  it('reports a rejected proof as unknown with its linked reason, never as refuted', () => {
    const { receipt, outcome } = check(forged);
    assert.equal(receipt.accepted, false);
    assert.equal(outcome.kind, 'unknown');
    assert.equal(outcome.truth, 'undetermined');
    assert.equal(outcome.establishes, false);
    assert.equal(outcome.reason, receipt.result[1]);
    for (const sample of [...cases, ...naturalCases.map(item => ({ ...item, natural: true }))]) {
      const options = sample.natural ? { program: LINKED_PROOF_NATURAL_PROGRAM, maxSteps: 200_000 } : {};
      const { receipt, outcome: { kind } } = check(sample, options);
      // A derivation left without a linked verdict is unsupported, never unknown or refuted.
      const expected = sample.accepted ? 'proved' : receipt.result[0] === 'proof-rejected' ? 'unknown' : 'unsupported';
      assert.ok(kind === expected, `${sample.name}: ${kind}`);
    }
  });

  it('reports a spent step bound or input bound as exhausted without a receipt', () => {
    const stepped = check(valid, { maxSteps: 5 });
    assert.equal(stepped.receipt, null);
    assert.equal(stepped.outcome.kind, 'exhausted');
    assert.equal(stepped.outcome.reason, 'rewrite-limit');
    const bounded = check(valid, { inputLimits: { maxNodes: 4 } });
    assert.equal(bounded.outcome.kind, 'exhausted');
    assert.equal(bounded.outcome.establishes, false);
  });

  it('reports malformed input and a verdict-free result as unsupported', () => {
    const malformed = checkLinkedProof(programs, valid.context, valid.goal, ['proof', 7]);
    assert.equal(malformed.receipt, null);
    assert.equal(malformed.outcome.kind, 'unsupported');
    assert.equal(malformed.outcome.reason, 'malformed-input');
    const receipt = verifyLinkedProof(programs, valid.context, valid.goal, valid.candidate);
    assert.equal(linkedProofOutcome({ ...receipt, result: ['pv-root', 'stuck'] }).kind, 'unsupported');
    assert.equal(linkedProofOutcome({ ...receipt, result: ['proof-accepted', 'not', 'quoted', 'data'] }).kind, 'unsupported');
  });

  it('rejects a relabelled verdict: the outcome follows the linked result, not the receipt flag', () => {
    const receipt = verifyLinkedProof(programs, forged.context, forged.goal, forged.candidate);
    assert.equal(linkedProofOutcome({ ...receipt, accepted: true }).kind, 'unknown');
  });

  it('uses only kinds of the one foundation outcome contract and never claims falsity', () => {
    const kinds = new Set();
    kinds.add(check(valid).outcome.kind);
    kinds.add(check(valid, { assumptions: ['p'] }).outcome.kind);
    kinds.add(check(forged).outcome.kind);
    kinds.add(check(valid, { maxSteps: 5 }).outcome.kind);
    kinds.add(checkLinkedProof(programs, valid.context, valid.goal, ['proof', 7]).outcome.kind);
    assert.deepEqual([...kinds].sort(), ['assumption-dependent', 'exhausted', 'proved', 'unknown', 'unsupported']);
    for (const kind of kinds) assert.ok(contractKinds.has(kind), kind);
    assert.ok(!kinds.has('refuted') && !kinds.has('contradictory'));
  });
});
