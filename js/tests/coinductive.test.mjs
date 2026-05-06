// Tests for coinductive families and productivity (issue #53, D11).
// Cover the `(coinductive ...)` parser form, the generated `Name-corec`
// corecursor, and the productivity check that rejects non-productive
// declarations. The Rust suite mirrors these expectations in
// rust/tests/coinductive_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Env,
  evaluate,
  evalNode,
  parseCoinductiveForm,
  buildCorecursorType,
  keyOf,
  check,
  synth,
} from '../src/rml-links.mjs';

function evaluateClean(src) {
  const out = evaluate(src);
  assert.deepStrictEqual(out.diagnostics, [], `unexpected diagnostics: ${JSON.stringify(out.diagnostics)}`);
  return out.results;
}

describe('(coinductive ...) parser form', () => {
  it('records the type, every constructor, and the corecursor on the Env', () => {
    const env = new Env();
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    assert.ok(env.coinductives.has('Stream'));
    const decl = env.coinductives.get('Stream');
    assert.strictEqual(decl.name, 'Stream');
    assert.deepStrictEqual(decl.constructors.map(c => c.name), ['cons']);
    assert.strictEqual(decl.corecName, 'Stream-corec');
    assert.ok(env.terms.has('Stream'));
    assert.ok(env.terms.has('cons'));
    assert.ok(env.terms.has('Stream-corec'));
    assert.strictEqual(
      keyOf(env.getType('cons')),
      '(Pi (Natural head) (Pi (Stream tail) Stream))',
    );
  });

  it('rejects a coinductive declaration with no constructors', () => {
    const out = evaluate('(coinductive Empty)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /at least one constructor/);
  });

  it('rejects a malformed constructor clause', () => {
    const out = evaluate('(coinductive Bad (cons))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /\(constructor <name>\)/);
  });

  it('rejects a constructor declared more than once', () => {
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream))))\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /declared more than once/);
  });

  it('rejects a constructor whose Pi-type does not return the coinductive type', () => {
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Boolean)))))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /must return "Stream"/);
  });

  it('rejects a type name that does not start with an uppercase letter', () => {
    const out = evaluate('(coinductive stream (constructor (cons (Pi (stream tail) stream))))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /uppercase letter/);
  });
});

describe('productivity check (guarded corecursion)', () => {
  it('rejects a declaration whose constructors are all non-recursive (non-productive)', () => {
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Bad\n' +
      '  (constructor leaf)\n' +
      '  (constructor (mid (Pi (Natural n) Bad))))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E035');
    assert.match(out.diagnostics[0].message, /non-productive/);
  });

  it('accepts a declaration where at least one constructor is recursive', () => {
    const out = evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
    );
    assert.deepStrictEqual(out.diagnostics, []);
  });

  it('accepts a declaration mixing constant and recursive constructors', () => {
    // `Conat` (extended/coinductive natural numbers) has both a `cozero`
    // base and a `cosucc` recursive constructor. The recursive one is what
    // makes the type productive.
    const out = evaluate(
      '(coinductive Conat\n' +
      '  (constructor cozero)\n' +
      '  (constructor (cosucc (Pi (Conat n) Conat))))',
    );
    assert.deepStrictEqual(out.diagnostics, []);
  });
});

describe('generated corecursor type-checks', () => {
  it('builds Stream-corec with the standard coiteration Pi-type', () => {
    const decl = parseCoinductiveForm([
      'coinductive', 'Stream',
      ['constructor', ['cons', ['Pi', ['Natural', 'head'], ['Pi', ['Stream', 'tail'], 'Stream']]]],
    ]);
    const corecType = buildCorecursorType(decl);
    assert.strictEqual(
      keyOf(corecType),
      '(Pi (' +
        '(Type 0) _state_type) ' +
        '(Pi (' +
          '(Pi (_state_type _state) ' +
            '(Pi (Natural head) (Pi (_state_type tail) Stream))) case_cons) ' +
          '(Pi (_state_type _seed) Stream)))',
    );
  });

  it('records the corecursor type so (type of Stream-corec) succeeds', () => {
    const results = evaluateClean(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))\n' +
      '(? (type of Stream-corec))',
    );
    assert.strictEqual(results.length, 1);
    assert.match(results[0], /^\(Pi \(.*_state_type\) /);
    assert.match(results[0], /case_cons/);
  });

  it('membership query holds for the corecursor against its synthesised type', () => {
    const env = new Env();
    evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
      { env },
    );
    const corecTypeKey = keyOf(env.coinductives.get('Stream').corecType);
    const result = evalNode(['?', ['Stream-corec', 'of', corecTypeKey]], env);
    assert.strictEqual(result.value, 1);
  });
});

describe('Streams are definable', () => {
  it('declares Stream with a single recursive constructor and a corecursor', () => {
    const env = new Env();
    evaluate('(Natural: (Type 0) Natural)', { env });
    const out = evaluate(
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    assert.strictEqual(
      keyOf(env.getType('cons')),
      '(Pi (Natural head) (Pi (Stream tail) Stream))',
    );
    const decl = env.coinductives.get('Stream');
    assert.strictEqual(decl.corecName, 'Stream-corec');
    const cons = decl.constructors[0];
    assert.strictEqual(cons.params.length, 2);
    assert.deepStrictEqual(cons.params[1], { name: 'tail', type: 'Stream' });
  });
});

describe('Conat (coinductive Naturals) is definable', () => {
  it('records the type and constructors and treats it as productive', () => {
    const env = new Env();
    const out = evaluate(
      '(coinductive Conat\n' +
      '  (constructor cozero)\n' +
      '  (constructor (cosucc (Pi (Conat n) Conat))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    const decl = env.coinductives.get('Conat');
    assert.strictEqual(decl.constructors.length, 2);
    assert.strictEqual(decl.constructors[0].name, 'cozero');
    assert.deepStrictEqual(decl.constructors[1].params, [{ name: 'n', type: 'Conat' }]);
  });
});

describe('corecursor participates in the bidirectional checker', () => {
  it('synth(Stream-corec) returns the generated dependent Pi-type', () => {
    const env = new Env();
    evaluate(
      '(Natural: (Type 0) Natural)\n' +
      '(coinductive Stream\n' +
      '  (constructor (cons (Pi (Natural head) (Pi (Stream tail) Stream)))))',
      { env },
    );
    const result = synth('Stream-corec', env);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.type);
    assert.strictEqual(
      keyOf(result.type),
      keyOf(env.coinductives.get('Stream').corecType),
    );
  });

  it('check accepts a constructor against the recorded type', () => {
    const env = new Env();
    evaluate(
      '(coinductive Conat\n' +
      '  (constructor cozero)\n' +
      '  (constructor (cosucc (Pi (Conat n) Conat))))',
      { env },
    );
    const result = check('cozero', 'Conat', env);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(result.ok, true);
  });
});
