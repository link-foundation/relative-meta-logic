// Tests for world declarations (issue #54, D16).
// Covers parsing of `(world <name> (<const>...))`, the call-site checker,
// and the relation-clause checker. The Rust suite mirrors these cases in
// rust/tests/worlds_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluate, Env } from '../src/rml-links.mjs';

describe('(world ...) declarations are parsed and stored', () => {
  it('records the allowed-constant list on the Env', () => {
    const env = new Env();
    const out = evaluate('(world plus (Natural))', { env });
    assert.strictEqual(out.diagnostics.length, 0);
    const allowed = env.worlds.get('plus');
    assert.deepStrictEqual(allowed, ['Natural']);
  });

  it('records multiple allowed constants', () => {
    const env = new Env();
    const out = evaluate('(world rel (Natural Boolean))', { env });
    assert.strictEqual(out.diagnostics.length, 0);
    assert.deepStrictEqual(env.worlds.get('rel'), ['Natural', 'Boolean']);
  });

  it('rejects a declaration with a non-symbolic relation name', () => {
    const out = evaluate('(world (foo bar) (Natural))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /must be a bare symbol/);
  });

  it('rejects a declaration without an allowed-constant list', () => {
    const out = evaluate('(world plus)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /must have shape/);
  });

  it('rejects a declaration whose constants are not bare symbols', () => {
    const out = evaluate('(world plus ((foo bar)))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /must be a bare symbol/);
  });
});

describe('call-site world checking', () => {
  it('rejects a call with a free constant outside the declared world', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(? (plus 1 Boolean))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 1);
    assert.match(e033[0].message, /Boolean/);
  });

  it('accepts a call whose arguments only mention declared constants', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(? (plus Natural Natural))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 0);
  });

  it('accepts numeric arguments unconditionally', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(? (plus 1 2))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 0);
  });

  it('does not check calls when no world is declared', () => {
    const out = evaluate('(? (plus Foo Bar))');
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 0);
  });

  it('reports each violation separately across multiple calls', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(? (plus Boolean 1))\n' +
      '(? (plus 1 String))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 2);
  });

  it('treats free constants inside nested terms as violations', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(? (plus (succ Boolean) Natural))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 1);
    assert.match(e033[0].message, /Boolean/);
  });
});

describe('relation declarations are independent from world checking', () => {
  it('does not check (relation ...) clauses against the world', () => {
    // Clause-level enforcement is intentionally out of scope for D16:
    // pattern variables vs. constants cannot be distinguished without
    // a naming convention. Only call sites are checked.
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))',
    );
    const e033 = out.diagnostics.filter(d => d.code === 'E033');
    assert.strictEqual(e033.length, 0);
  });
});

describe('world declarations interoperate with mode/total checks', () => {
  it('coexists with (mode ...) and (total ...) declarations', () => {
    const out = evaluate(
      '(world plus (Natural))\n' +
      '(mode plus +input +input -output)\n' +
      '(relation plus\n' +
      '  (plus zero n n)\n' +
      '  (plus (succ m) n (succ (plus m n))))\n' +
      '(total plus)',
    );
    assert.strictEqual(
      out.diagnostics.length,
      0,
      `expected no diagnostics, got: ${JSON.stringify(out.diagnostics)}`,
    );
  });
});
