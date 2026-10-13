import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { LINKED_PROOF_NATURAL_PROGRAM, verifyLinkedProof } from '../src/rml-linked-proof.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const universal = read('lib/meta-theory/universal.lino');
const verifier = read('lib/meta-theory/proof-verifier.lino');
const natural = read('lib/meta-theory/proof-verifier-natural.lino');
const cases = JSON.parse(read('test-corpus/linked-proof/natural-cases.json'));
const baseCases = JSON.parse(read('test-corpus/linked-proof/cases.json'));
const programs = LinkedProgramRegistry.fromRml(`${universal}\n${verifier}\n${natural}`, { executionBasis: 'direct-structural' });
const verify = (sample, program = LINKED_PROOF_NATURAL_PROGRAM) =>
  verifyLinkedProof(programs, sample.context, sample.goal, sample.candidate, { program, maxSteps: 200_000 });

describe('natural-deduction proof verification driven by linked definitions', () => {
  for (const sample of cases) {
    it(sample.name, () => {
      const result = verify(sample);
      assert.equal(result.accepted, sample.accepted, JSON.stringify(result.result));
      if (sample.accepted) assert.equal(result.result[0], 'proof-accepted');
      else assert.deepEqual(result.result, ['proof-rejected', sample.reason]);
    });
  }

  it('keeps the base verifier verdict and rejection reason on every base case', () => {
    for (const sample of baseCases) {
      const base = verify(sample, 'linked-proof-verifier');
      const extended = verify(sample);
      assert.equal(extended.accepted, base.accepted, sample.name);
      const verdict = result => (['proof-accepted', 'proof-rejected'].includes(result[0]) ? result[0] : 'no-verdict');
      // A base derivation without a verdict (an unbound conclusion variable) stays without one.
      assert.equal(verdict(extended.result), verdict(base.result), sample.name);
      if (verdict(base.result) === 'proof-rejected') assert.deepEqual(extended.result, base.result, sample.name);
    }
  });

  it('rejects every natural fixture under the base verifier, which has no locals or side conditions', () => {
    for (const sample of cases.filter(item => item.accepted)) {
      assert.equal(verify(sample, 'linked-proof-verifier').accepted, false, sample.name);
    }
  });

  it('decides discharge, congruence and closure by linked rules alone', () => {
    const rules = [...natural.matchAll(/^\(linked-rewrite linked-proof-verifier-natural ([^\s]+)/gm)].map(match => match[1]);
    for (const name of ['premises-discharge', 'discharge-local', 'discharge-invalid', 'side-congruent', 'cong-replace',
      'cong-spine-pair', 'closed-local', 'root-open']) {
      assert.ok(rules.includes(name), name);
    }
    const sample = cases.find(item => item.name === 'induction-discharges-its-hypothesis');
    const result = verify(sample);
    const used = new Set(result.trace.slice(1).map(step => `${step[1]}.${step[2]}`));
    for (const name of ['premises-discharge', 'discharge-local', 'remove-head', 'closed-step', 'root-closed']) {
      assert.ok(used.has(`linked-proof-verifier-natural.${name}`), name);
    }
  });
});
