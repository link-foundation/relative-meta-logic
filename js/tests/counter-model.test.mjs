// Tests for finite-valence counter-model search (issue #58).
// Mirrored by `rust/tests/counter_model_tests.rs` so JS and Rust stay aligned.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  counterModel,
  evaluate,
  parseOne,
  tokenizeOne,
} from '../src/rml-links.mjs';

function link(src) {
  return parseOne(tokenizeOne(src));
}

describe('counterModel searches finite valuations', () => {
  it('finds the Kleene excluded-middle witness in ternary valence', () => {
    const witness = counterModel(link('(or p (not p))'), 3);

    assert.ok(witness);
    assert.deepStrictEqual(witness.variables, ['p']);
    assert.deepStrictEqual(witness.valuation, { p: 0.5 });
    assert.strictEqual(witness.value, 0.5);
  });

  it('returns null when Boolean excluded middle has no counter-model', () => {
    const witness = counterModel(link('(or p (not p))'), 2);

    assert.strictEqual(witness, null);
  });

  it('exposes counter-model search as a LiNo form using the current valence', () => {
    const out = evaluate('(valence: 3)\n(counter-model (or p (not p)))');

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [
      '(counter-model (or p (not p)) (valuation (p 0.5)) (value 0.5))',
    ]);
  });

  it('reports a diagnostic when the LiNo form has no finite valence', () => {
    const out = evaluate('(counter-model (or p (not p)))');

    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E041');
    assert.match(out.diagnostics[0].message, /finite valence/);
  });
});
