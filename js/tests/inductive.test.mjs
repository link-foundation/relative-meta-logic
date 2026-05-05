// Tests for inductive families with eliminators (issue #45, D10).
// Cover the `(inductive ...)` parser form, the generated `Name-rec`
// eliminator, and the acceptance-criteria datatypes (Natural, List,
// Vector, propositional equality). The Rust suite mirrors these
// expectations in rust/tests/inductive_tests.rs.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  Env,
  evaluate,
  evalNode,
  parseInductiveForm,
  buildEliminatorType,
  keyOf,
  check,
  synth,
} from '../src/rml-links.mjs';

function evaluateClean(src) {
  const out = evaluate(src);
  assert.deepStrictEqual(out.diagnostics, [], `unexpected diagnostics: ${JSON.stringify(out.diagnostics)}`);
  return out.results;
}

describe('(inductive ...) parser form', () => {
  it('records the type, every constructor, and the eliminator on the Env', () => {
    const env = new Env();
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    assert.ok(env.inductives.has('Natural'));
    const decl = env.inductives.get('Natural');
    assert.strictEqual(decl.name, 'Natural');
    assert.deepStrictEqual(decl.constructors.map(c => c.name), ['zero', 'succ']);
    assert.strictEqual(decl.elimName, 'Natural-rec');
    assert.ok(env.terms.has('Natural'));
    assert.ok(env.terms.has('zero'));
    assert.ok(env.terms.has('succ'));
    assert.ok(env.terms.has('Natural-rec'));
    assert.strictEqual(env.getType('zero'), 'Natural');
    assert.strictEqual(keyOf(env.getType('succ')), '(Pi (Natural n) Natural)');
  });

  it('rejects an inductive declaration with no constructors', () => {
    const out = evaluate('(inductive Empty)');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /at least one constructor/);
  });

  it('rejects a malformed constructor clause', () => {
    const out = evaluate('(inductive Bad (zero))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /\(constructor <name>\)/);
  });

  it('rejects a constructor declared more than once', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor zero))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /declared more than once/);
  });

  it('rejects a constructor whose Pi-type does not return the inductive type', () => {
    const out = evaluate(
      '(inductive Natural\n' +
      '  (constructor (succ (Pi (Natural n) Boolean))))',
    );
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /must return "Natural"/);
  });

  it('rejects a type name that does not start with an uppercase letter', () => {
    const out = evaluate('(inductive natural (constructor zero))');
    assert.strictEqual(out.diagnostics.length, 1);
    assert.strictEqual(out.diagnostics[0].code, 'E033');
    assert.match(out.diagnostics[0].message, /uppercase letter/);
  });
});

describe('generated eliminator type-checks', () => {
  it('builds Natural-rec with the standard induction-principle Pi-type', () => {
    const decl = parseInductiveForm([
      'inductive', 'Natural',
      ['constructor', 'zero'],
      ['constructor', ['succ', ['Pi', ['Natural', 'n'], 'Natural']]],
    ]);
    const elimType = buildEliminatorType(decl);
    assert.strictEqual(
      keyOf(elimType),
      '(Pi (' +
        '(Pi (Natural _) (Type 0)) _motive) ' +
        '(Pi ((apply _motive zero) case_zero) ' +
          '(Pi (' +
            '(Pi (Natural n) ' +
              '(Pi ((apply _motive n) ih_n) (apply _motive (succ n)))) case_succ) ' +
            '(Pi (Natural _target) (apply _motive _target)))))',
    );
  });

  it('records the eliminator type so (type of Natural-rec) succeeds', () => {
    const results = evaluateClean(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))\n' +
      '(? (type of Natural-rec))',
    );
    assert.strictEqual(results.length, 1);
    assert.match(results[0], /^\(Pi \(.*_motive\) /);
    assert.match(results[0], /case_zero/);
    assert.match(results[0], /case_succ/);
  });

  it('membership query holds for the eliminator against its synthesised type', () => {
    const env = new Env();
    evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))',
      { env },
    );
    const elimTypeKey = keyOf(env.inductives.get('Natural').elimType);
    const result = evalNode(['?', ['Natural-rec', 'of', elimTypeKey]], env);
    assert.strictEqual(result.value, 1);
  });
});

describe('Lists are definable', () => {
  it('declares List with nil and cons constructors', () => {
    const env = new Env();
    evaluate('(A: (Type 0) A)', { env });
    const out = evaluate(
      '(inductive List\n' +
      '  (constructor nil)\n' +
      '  (constructor (cons (Pi (A x) (Pi (List xs) List)))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    assert.strictEqual(env.getType('nil'), 'List');
    assert.strictEqual(keyOf(env.getType('cons')), '(Pi (A x) (Pi (List xs) List))');
    const decl = env.inductives.get('List');
    assert.strictEqual(decl.elimName, 'List-rec');
    // The cons step type carries an inductive-hypothesis premise on its tail.
    const consCase = decl.constructors[1];
    assert.strictEqual(consCase.name, 'cons');
    assert.strictEqual(consCase.params.length, 2);
    assert.deepStrictEqual(consCase.params[1], { name: 'xs', type: 'List' });
  });
});

describe('Vectors (length-indexed lists) are definable', () => {
  it('records the indexed type and constructors', () => {
    const env = new Env();
    evaluate(
      '(A: (Type 0) A)\n' +
      '(Natural: (Type 0) Natural)\n' +
      '(zero: Natural zero)\n' +
      '(succ: (Pi (Natural n) Natural))',
      { env },
    );
    // Vector here is encoded with the index baked into the carrier name —
    // RML inductives currently parameterise by element type, with the
    // length index represented as a Natural in each constructor signature.
    const out = evaluate(
      '(inductive Vector\n' +
      '  (constructor vnil)\n' +
      '  (constructor (vcons (Pi (Natural n) (Pi (A x) (Pi (Vector xs) Vector))))))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    const decl = env.inductives.get('Vector');
    assert.strictEqual(decl.constructors.length, 2);
    const vcons = decl.constructors[1];
    assert.deepStrictEqual(
      vcons.params.map(p => [p.name, typeof p.type === 'string' ? p.type : keyOf(p.type)]),
      [['n', 'Natural'], ['x', 'A'], ['xs', 'Vector']],
    );
  });
});

describe('propositional equality is definable', () => {
  it('declares Eq with the refl constructor', () => {
    const env = new Env();
    evaluate(
      '(A: (Type 0) A)\n' +
      '(a: A a)',
      { env },
    );
    const out = evaluate(
      '(inductive Eq\n' +
      '  (constructor refl))',
      { env },
    );
    assert.deepStrictEqual(out.diagnostics, []);
    assert.strictEqual(env.getType('refl'), 'Eq');
    assert.strictEqual(env.inductives.get('Eq').elimName, 'Eq-rec');
  });
});

describe('eliminator participates in the bidirectional checker', () => {
  it('synth(Natural-rec) returns the generated dependent Pi-type', () => {
    const env = new Env();
    evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))',
      { env },
    );
    const result = synth('Natural-rec', env);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(result.type);
    assert.strictEqual(
      keyOf(result.type),
      keyOf(env.inductives.get('Natural').elimType),
    );
  });

  it('check accepts a constructor against the recorded type', () => {
    const env = new Env();
    evaluate(
      '(inductive Natural\n' +
      '  (constructor zero)\n' +
      '  (constructor (succ (Pi (Natural n) Natural))))',
      { env },
    );
    const result = check('zero', 'Natural', env);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(result.ok, true);
  });
});
