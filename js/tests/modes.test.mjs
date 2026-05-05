// Tests for mode declarations (issue #43, D15).
// Covers parsing of `(mode <name> +input -output ...)`, storage on the Env,
// and the mode-mismatch checker that fires at call sites. The Rust suite
// mirrors these cases in rust/tests/modes_tests.rs to keep the two
// implementations in lock-step.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, Env } from '../src/rml-links.mjs';

describe('(mode ...) declarations are parsed and stored', () => {
  it('records the per-argument flag list on the Env', () => {
    const env = new Env();
    const out = evaluate('(mode plus +input +input -output)', { env });
    assert.strictEqual(out.diagnostics.length, 0);
    assert.deepStrictEqual(env.modes.get('plus'), ['in', 'in', 'out']);
  });

  it('accepts the *either flag', () => {
    const env = new Env();
    const out = evaluate('(mode lookup +input *either -output)', { env });
    assert.strictEqual(out.diagnostics.length, 0);
    assert.deepStrictEqual(env.modes.get('lookup'), ['in', 'either', 'out']);
  });
});

describe('(mode ...) rejects malformed declarations with E030', () => {
  it('rejects unknown flag tokens', () => {
    const out = evaluate('(mode plus +input ~maybe -output)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E030');
    assert.match(out.diagnostics[0].message, /unknown flag "~maybe"/);
  });

  it('rejects a declaration with no flags', () => {
    const out = evaluate('(mode plus)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E030');
    assert.match(out.diagnostics[0].message, /at least one mode flag/);
  });

  it('rejects a non-symbolic relation name', () => {
    const out = evaluate('(mode (foo bar) +input -output)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E030');
    assert.match(out.diagnostics[0].message, /must be a bare symbol/);
  });
});

describe('mode mismatches fire E031 at call sites', () => {
  it('rejects a call with the wrong arity', () => {
    const out = evaluate(
      '(mode plus +input +input -output)\n(? (plus 1 2))',
    );
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 1);
    assert.match(e031[0].message, /expected 3 arguments, got 2/);
  });

  it('rejects a +input slot supplied with an unbound variable', () => {
    const out = evaluate(
      '(mode plus +input +input -output)\n(? (plus 1 unbound result))',
    );
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 1);
    assert.match(e031[0].message, /argument 2 \(\+input\) is not ground/);
  });

  it('accepts a call where every +input is ground', () => {
    const out = evaluate(
      '(Natural: Type Natural)\n' +
      '(zero: Natural zero)\n' +
      '(mode plus +input +input -output)\n' +
      '(? (plus zero zero result))',
    );
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 0);
  });

  it('treats numeric literals in +input slots as ground', () => {
    const out = evaluate(
      '(mode plus +input +input -output)\n(? (plus 1 2 result))',
    );
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 0);
  });

  it('lets *either slots accept anything, even unbound names', () => {
    const out = evaluate(
      '(mode lookup *either *either)\n(? (lookup whatever else))',
    );
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 0);
  });

  it('does not flag relations that have no mode declaration', () => {
    const out = evaluate('(? (mystery a b c))');
    const e031 = out.diagnostics.filter(d => d.code === 'E031');
    assert.strictEqual(e031.length, 0);
  });
});
