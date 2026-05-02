// Integration tests for the independent proof-replay checker (issue #36).
// Mirrors `rust/tests/check_tests.rs` so any drift between the two
// implementations fails both test suites. The checker is deliberately
// kernel-only — it never calls `evaluate()` — and the tests below verify
// that valid proofs replay successfully while every mutation we can come
// up with (wrong rule, wrong operand, wrong arity, missing or extra
// derivation, swapped sub-tree) is rejected.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, keyOf } from '../src/rml-links.mjs';
import { checkProgram, isOk } from '../src/check.mjs';

// Drive the proof-producing evaluator and return the printed proof stream
// that the kernel-only checker should accept verbatim.
function proofsFrom(src) {
  const out = evaluate(src, { withProofs: true });
  return out.proofs
    .filter(p => p !== null && p !== undefined)
    .map(keyOf)
    .join('\n');
}

describe('replay acceptance: structural-equality witness', () => {
  it('replays the canonical (by structural-equality (a a)) witness', () => {
    const r = checkProgram('(a: a is a)\n(? (a = a))', '(by structural-equality (a a))');
    assert.ok(isOk(r), JSON.stringify(r.errors));
    assert.strictEqual(r.ok.length, 1);
    assert.strictEqual(r.ok[0].rule, 'structural-equality');
  });

  it('matches proofs emitted by the evaluator for a varied program', () => {
    const program = [
      '(a: a is a)',
      '((b = b) has probability 0.7)',
      '(? (a = a))',
      '(? (b = b))',
      '(? (1 + 2))',
      '(? (5 - 2))',
      '(? (3 * 4))',
      '(? (8 / 2))',
      '(? (not 0))',
      '(? (1 and 0))',
      '(? (0 or 1))',
      '(? (both 1 and 1 and 0))',
      '(? (neither 0 nor 0))',
      '(? (1 = 2))',
      '(? (1 != 2))',
      '(? (subst (x + 0.1) x 0.2))',
      '(? (fresh z in z))',
    ].join('\n');
    const proofs = proofsFrom(program);
    const r = checkProgram(program, proofs);
    assert.ok(isOk(r), JSON.stringify(r.errors));
    assert.strictEqual(r.ok.length, 15);
  });
});

describe('rule-name mutations', () => {
  it('rejects wrong rule for structural equality', () => {
    const r = checkProgram(
      '(a: a is a)\n(? (a = a))',
      '(by numeric-equality (a a))',
    );
    assert.ok(!isOk(r));
    assert.ok(r.errors[0].message.includes('numeric-equality'));
  });

  it('rejects assigned rule when no assignment exists', () => {
    const r = checkProgram(
      '(a: a is a)\n(? (a = a))',
      '(by assigned-equality (a a))',
    );
    assert.ok(!isOk(r));
  });

  it('rejects swapped arithmetic rule', () => {
    const r = checkProgram(
      '(? (1 - 2))',
      '(by sum (by literal 1) (by literal 2))',
    );
    assert.ok(!isOk(r));
  });
});

describe('operand mutations', () => {
  it('rejects wrong operands in equality pair', () => {
    const r = checkProgram(
      '(a: a is a)\n(b: b is b)\n(? (a = a))',
      '(by structural-equality (a b))',
    );
    assert.ok(!isOk(r));
    const m = r.errors[0].message.toLowerCase();
    assert.ok(m.includes('operand') || r.errors[0].message.includes('does not match'));
  });

  it('rejects wrong literal inside arithmetic subtree', () => {
    const r = checkProgram(
      '(? (1 + 2))',
      '(by sum (by literal 1) (by literal 5))',
    );
    assert.ok(!isOk(r));
    assert.ok(r.errors[0].message.includes('5'));
  });
});

describe('payload mutations', () => {
  it('rejects wrong reduce payload', () => {
    const r = checkProgram(
      '(? (mystery 1))',
      '(by reduce (different 2))',
    );
    assert.ok(!isOk(r));
  });

  it('rejects wrong definition payload', () => {
    const r = checkProgram(
      '(? (foo: bar))',
      '(by definition (bar: foo))',
    );
    assert.ok(!isOk(r));
  });

  it('rejects wrong configuration payload', () => {
    const r = checkProgram(
      '(? (range 0 1))',
      '(by configuration valence 9)',
    );
    assert.ok(!isOk(r));
  });

  it('rejects wrong assigned-probability payload', () => {
    const r = checkProgram(
      '(? ((a = a) has probability 0.7))',
      '(by assigned-probability (b = b) 0.2)',
    );
    assert.ok(!isOk(r));
  });
});

describe('arity / shape mutations', () => {
  it('rejects missing subtree', () => {
    const r = checkProgram(
      '(? (1 + 2))',
      '(by sum (by literal 1))',
    );
    assert.ok(!isOk(r));
  });

  it('rejects extra subtree', () => {
    const r = checkProgram(
      '(? (not 0))',
      '(by not (by literal 0) (by literal 0))',
    );
    assert.ok(!isOk(r));
  });

  it('rejects non-by node at top level', () => {
    const r = checkProgram(
      '(? (a = a))',
      '(structural-equality (a a))',
    );
    assert.ok(!isOk(r));
  });
});

describe('pairing mutations', () => {
  it('rejects too few proofs for program', () => {
    const r = checkProgram(
      '(? (1 + 2))\n(? (1 - 2))',
      '(by sum (by literal 1) (by literal 2))',
    );
    assert.ok(!isOk(r));
    assert.ok(r.errors[0].message.includes('expected 2'));
  });

  it('rejects too many proofs for program', () => {
    const r = checkProgram(
      '(? (1 + 2))',
      '(by sum (by literal 1) (by literal 2))\n(by sum (by literal 3) (by literal 4))',
    );
    assert.ok(!isOk(r));
  });
});

describe('composite chains', () => {
  it('replays composite both chain', () => {
    const program = '(? (both 1 and 0 and 1))';
    const proofs = proofsFrom(program);
    const r = checkProgram(program, proofs);
    assert.ok(isOk(r), JSON.stringify(r.errors));
  });

  it('rejects mutated composite chain', () => {
    const r = checkProgram(
      '(? (both 1 and 0 and 1))',
      '(by both (by literal 1) (by literal 0))',
    );
    assert.ok(!isOk(r));
  });
});

describe('result agreement: replay does not depend on truth values', () => {
  it('checker accepts the evaluator output and rejects rule-mutated stream', () => {
    const program = [
      '(a: a is a)',
      '((a = a) has probability 1)',
      '(? ((a = a) and (a = a)))',
    ].join('\n');
    const proofs = proofsFrom(program);
    assert.ok(isOk(checkProgram(program, proofs)));
    const mutated = proofs.replace(/assigned-equality/g, 'structural-equality');
    assert.notStrictEqual(mutated, proofs);
    assert.ok(!isOk(checkProgram(program, mutated)));
  });
});

describe('result aggregation', () => {
  it('reports count of replayed derivations', () => {
    const program = '(? 1)\n(? 0)\n(? (1 + 1))';
    const proofs = '(by literal 1)\n(by literal 0)\n(by sum (by literal 1) (by literal 1))';
    const r = checkProgram(program, proofs);
    assert.ok(isOk(r));
    assert.strictEqual(r.ok.length, 3);
  });

  it('evaluator results match independently when proof replay succeeds', () => {
    const program = '(? (0 + 1))';
    const out = evaluate(program, { withProofs: true });
    assert.deepStrictEqual(out.results, [1]);
    const proof = keyOf(out.proofs[0]);
    assert.ok(isOk(checkProgram(program, proof)));
  });
});
