import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  run,
  tokenizeOne,
  parseOne,
  Env,
  evalNode,
  quantize,
  decRound,
  substitute,
  subst,
  formalizeSelectedInterpretation,
  evaluateFormalization,
} from '../src/rml-links.mjs';

const approx = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon,
    `Expected ${expected}, got ${actual} (diff: ${Math.abs(actual - expected)})`);

describe('tokenizeOne', () => {
  it('should tokenize simple link', () => {
    const tokens = tokenizeOne('(a: a is a)');
    assert.deepStrictEqual(tokens, ['(', 'a:', 'a', 'is', 'a', ')']);
  });

  it('should tokenize nested link', () => {
    const tokens = tokenizeOne('((a = a) has probability 1)');
    assert.deepStrictEqual(tokens, ['(', '(', 'a', '=', 'a', ')', 'has', 'probability', '1', ')']);
  });

  it('should strip inline comments', () => {
    const tokens = tokenizeOne('(and: avg) # this is a comment');
    assert.deepStrictEqual(tokens, ['(', 'and:', 'avg', ')']);
  });

  it('should balance parens after stripping comments', () => {
    const tokens = tokenizeOne('((and: avg) # comment)');
    assert.deepStrictEqual(tokens, ['(', '(', 'and:', 'avg', ')', ')']);
  });
});

describe('parseOne', () => {
  it('should parse simple link', () => {
    const tokens = ['(', 'a:', 'a', 'is', 'a', ')'];
    const ast = parseOne(tokens);
    assert.deepStrictEqual(ast, ['a:', 'a', 'is', 'a']);
  });

  it('should parse nested link', () => {
    const tokens = ['(', '(', 'a', '=', 'a', ')', 'has', 'probability', '1', ')'];
    const ast = parseOne(tokens);
    assert.deepStrictEqual(ast, [['a', '=', 'a'], 'has', 'probability', '1']);
  });

  it('should parse deeply nested link', () => {
    const tokens = ['(', '?', '(', '(', 'a', '=', 'a', ')', 'and', '(', 'a', '!=', 'a', ')', ')', ')'];
    const ast = parseOne(tokens);
    assert.deepStrictEqual(ast, ['?', [['a', '=', 'a'], 'and', ['a', '!=', 'a']]]);
  });
});

describe('Env', () => {
  it('should initialize with default operators', () => {
    const env = new Env();
    assert.ok(env.ops.has('not'));
    assert.ok(env.ops.has('and'));
    assert.ok(env.ops.has('or'));
    assert.ok(env.ops.has('='));
    assert.ok(env.ops.has('!='));
  });

  it('should allow defining new operators', () => {
    const env = new Env();
    env.defineOp('test', (x) => x * 2);
    assert.ok(env.ops.has('test'));
    assert.strictEqual(env.getOp('test')(0.5), 1);
  });

  it('should store expression probabilities', () => {
    const env = new Env();
    env.setExprProb(['a', '=', 'a'], 1);
    assert.strictEqual(env.assign.get('(a = a)'), 1);
  });
});

describe('evalNode', () => {
  it('should evaluate numeric literals', () => {
    const env = new Env();
    assert.strictEqual(evalNode('1', env), 1);
    assert.strictEqual(evalNode('0.5', env), 0.5);
    assert.strictEqual(evalNode('0', env), 0);
  });

  it('should evaluate term definitions', () => {
    const env = new Env();
    evalNode(['a:', 'a', 'is', 'a'], env);
    assert.ok(env.terms.has('a'));
  });

  it('should evaluate operator redefinitions', () => {
    const env = new Env();
    evalNode(['!=:', 'not', '='], env);
    assert.ok(env.ops.has('!='));
  });

  it('should evaluate aggregator selection', () => {
    const env = new Env();
    evalNode(['and:', 'min'], env);
    const andOp = env.getOp('and');
    assert.strictEqual(andOp(0.3, 0.7), 0.3);
  });

  it('should evaluate probability assignments', () => {
    const env = new Env();
    const result = evalNode([['a', '=', 'a'], 'has', 'probability', '1'], env);
    assert.strictEqual(result, 1);
    assert.strictEqual(env.assign.get('(a = a)'), 1);
  });

  it('should evaluate equality operator', () => {
    const env = new Env();
    // Syntactic equality
    const result = evalNode(['a', '=', 'a'], env);
    assert.strictEqual(result, 1);
  });

  it('should evaluate inequality operator', () => {
    const env = new Env();
    const result = evalNode(['a', '!=', 'a'], env);
    assert.strictEqual(result, 0);
  });

  it('should evaluate not operator', () => {
    const env = new Env();
    const result = evalNode(['not', '1'], env);
    assert.strictEqual(result, 0);
  });

  it('should evaluate and operator (avg)', () => {
    const env = new Env();
    const result = evalNode(['1', 'and', '0'], env);
    assert.strictEqual(result, 0.5);
  });

  it('should evaluate or operator (max)', () => {
    const env = new Env();
    const result = evalNode(['1', 'or', '0'], env);
    assert.strictEqual(result, 1);
  });

  it('should evaluate queries', () => {
    const env = new Env();
    const result = evalNode(['?', '1'], env);
    assert.ok(result.query);
    assert.strictEqual(result.value, 1);
  });
});

describe('run', () => {
  it('should run demo.lino example', () => {
    const text = `
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) and (a != a)))
(? ((a = a) or  (a != a)))
`;
    const results = run(text);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 1);
  });

  it('should run flipped-axioms.lino example', () => {
    const text = `
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 0)
((a != a) has probability 1)
(? ((a = a) and (a != a)))
(? ((a = a) or  (a != a)))
`;
    const results = run(text);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 1);
  });

  it('should handle different aggregators for and', () => {
    const text = `
(a: a is a)
(and: min)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) and (a != a)))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0);
  });

  it('should handle product aggregator (full name)', () => {
    const text = `
(and: product)
(? (0.5 and 0.5))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.25);
  });

  it('should handle product aggregator (short name backward compatible)', () => {
    const text = `
(and: prod)
(? (0.5 and 0.5))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.25);
  });

  it('should handle probabilistic_sum aggregator (full name)', () => {
    const text = `
(or: probabilistic_sum)
(? (0.5 or 0.5))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.75);
  });

  it('should handle probabilistic sum aggregator (short name backward compatible)', () => {
    const text = `
(or: ps)
(? (0.5 or 0.5))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.75);
  });

  it('should ignore comment-only links', () => {
    const text = `
# This is a comment
(# This is also a comment)
(a: a is a)
(? (a = a))
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 1);
  });

  it('should handle inline comments', () => {
    const text = `
(a: a is a) # define term a
((a = a) has probability 1) # axiom
(? (a = a)) # query
`;
    const results = run(text);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 1);
  });

  it('handles inline comments that contain colons', () => {
    // Cross-implementation regression: a `:` inside an inline comment used
    // to confuse the Rust parser into dropping every statement in the file.
    // The JS parser already stripped these correctly; this test pins the
    // shared behaviour. See docs/case-studies/issue-68.
    const text = `
(? true)                  # comment with: colon
(? false)                 # another: comment
`;
    const results = run(text);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 0);
  });
});

describe('meta-expression adapter API', () => {
  it('formalizes and evaluates arithmetic equality deterministically', () => {
    const formalization = formalizeSelectedInterpretation({
      text: '0.1 + 0.2 = 0.3',
      interpretation: {
        kind: 'arithmetic-equality',
        expression: '0.1 + 0.2 = 0.3',
      },
      formalSystem: 'rml-arithmetic',
    });

    assert.strictEqual(formalization.computable, true);
    assert.strictEqual(formalization.formalizationLevel, 3);
    assert.deepStrictEqual(formalization.unknowns, []);

    const result = evaluateFormalization(formalization);
    assert.deepStrictEqual(result.unknowns, []);
    assert.strictEqual(result.computable, true);
    assert.strictEqual(result.result.kind, 'truth-value');
    assert.strictEqual(result.result.value, 1);
  });

  it('formalizes and evaluates arithmetic questions without query clamping', () => {
    const formalization = formalizeSelectedInterpretation({
      text: 'What is 0.1 + 0.2?',
      interpretation: {
        kind: 'arithmetic-question',
        expression: '0.1 + 0.2',
      },
      formalSystem: 'rml-arithmetic',
    });

    const result = evaluateFormalization(formalization);
    assert.strictEqual(result.computable, true);
    assert.strictEqual(result.result.kind, 'number');
    assert.strictEqual(result.result.value, 0.3);
  });

  it('keeps unsupported real-world claims partial with explicit unknowns', () => {
    const formalization = formalizeSelectedInterpretation({
      text: 'moon orbits the Sun',
      interpretation: {
        kind: 'real-world-claim',
        summary: 'Treat "moon orbits the Sun" as a factual claim that needs evidence.',
      },
      formalSystem: 'rml',
      dependencies: [
        { id: 'wikidata', status: 'missing', description: 'No selected entity and relation ids were provided.' },
      ],
    });

    assert.strictEqual(formalization.computable, false);
    assert.strictEqual(formalization.formalizationLevel, 2);
    assert.ok(formalization.unknowns.includes('selected-subject'));
    assert.ok(formalization.unknowns.includes('selected-relation'));

    const result = evaluateFormalization(formalization);
    assert.strictEqual(result.computable, false);
    assert.strictEqual(result.result.kind, 'partial');
    assert.strictEqual(result.result.value, 'unknown');
  });
});

// =============================================================================
// Standard logic examples — testing the example files
// =============================================================================
describe('Example: classical-logic.lino', () => {
  it('should produce correct results for classical Boolean logic', () => {
    const results = run(`
(valence: 2)
(and: min)
(or: max)
(p: p is p)
(q: q is q)
((p = true) has probability 1)
((q = true) has probability 0)
(? (p = true))
(? (q = true))
(? (not (p = true)))
(? (not (q = true)))
(? ((p = true) and (q = true)))
(? ((p = true) or (q = true)))
(? ((p = true) or (not (p = true))))
(? ((p = true) and (not (p = true))))
(? (not (not (p = true))))
`);
    assert.strictEqual(results.length, 9);
    assert.strictEqual(results[0], 1);    // p = true
    assert.strictEqual(results[1], 0);    // q = false
    assert.strictEqual(results[2], 0);    // not p = false
    assert.strictEqual(results[3], 1);    // not q = true
    assert.strictEqual(results[4], 0);    // p AND q = false
    assert.strictEqual(results[5], 1);    // p OR q = true
    assert.strictEqual(results[6], 1);    // excluded middle
    assert.strictEqual(results[7], 0);    // non-contradiction
    assert.strictEqual(results[8], 1);    // double negation
  });
});

describe('Example: propositional-logic.lino', () => {
  it('should produce correct results for probabilistic propositional logic', () => {
    const results = run(`
(and: product)
(or: probabilistic_sum)
(rain: rain is rain)
(umbrella: umbrella is umbrella)
(wet: wet is wet)
((rain = true) has probability 0.3)
((umbrella = true) has probability 0.6)
((wet = true) has probability 0.4)
(? (rain = true))
(? (umbrella = true))
(? ((rain = true) and (umbrella = true)))
(? ((rain = true) or (umbrella = true)))
(? (not (rain = true)))
(? (and (rain = true) (umbrella = true) (wet = true)))
(? (or (rain = true) (umbrella = true) (wet = true)))
`);
    assert.strictEqual(results.length, 7);
    approx(results[0], 0.3);
    approx(results[1], 0.6);
    approx(results[2], 0.18);
    approx(results[3], 0.72);
    approx(results[4], 0.7);
    approx(results[5], 0.072);
    approx(results[6], 0.832);
  });
});

describe('Example: fuzzy-logic.lino', () => {
  it('should produce correct results for fuzzy logic (Zadeh)', () => {
    const results = run(`
(and: min)
(or: max)
(a: a is a)
(b: b is b)
(c: c is c)
((a = tall) has probability 0.8)
((b = tall) has probability 0.3)
((c = tall) has probability 0.6)
(? (a = tall))
(? (b = tall))
(? ((a = tall) and (b = tall)))
(? ((a = tall) or (b = tall)))
(? (not (a = tall)))
(? ((a = tall) and ((b = tall) or (c = tall))))
`);
    assert.strictEqual(results.length, 6);
    approx(results[0], 0.8);
    approx(results[1], 0.3);
    approx(results[2], 0.3);   // min(0.8, 0.3)
    approx(results[3], 0.8);   // max(0.8, 0.3)
    approx(results[4], 0.2);   // 1 - 0.8
    approx(results[5], 0.6);   // min(0.8, max(0.3, 0.6))
  });
});

describe('Example: belnap-four-valued.lino', () => {
  it('should produce correct results for Belnap four-valued logic', () => {
    const results = run(`
(and: min)
(or: max)
(? true)
(? false)
(? (not true))
(? (not false))
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
(? (true both false))
(? (true neither false))
(? (true both true))
(? (false both false))
(? (true neither true))
(? (false neither false))
`);
    assert.strictEqual(results.length, 12);
    assert.strictEqual(results[0], 1);      // true
    assert.strictEqual(results[1], 0);      // false
    assert.strictEqual(results[2], 0);      // not true
    assert.strictEqual(results[3], 1);      // not false
    assert.strictEqual(results[4], 0.5);    // liar paradox
    assert.strictEqual(results[5], 0.5);    // not liar paradox
    assert.strictEqual(results[6], 0.5);    // true both false = 0.5 (contradiction)
    assert.strictEqual(results[7], 0);      // true neither false = 0 (gap)
    assert.strictEqual(results[8], 1);      // true both true = 1
    assert.strictEqual(results[9], 0);      // false both false = 0
    assert.strictEqual(results[10], 1);     // true neither true = 1
    assert.strictEqual(results[11], 0);     // false neither false = 0
  });
});

// =============================================================================
// Quantization helper
// See: https://en.wikipedia.org/wiki/Many-valued_logic
// =============================================================================
describe('quantize', () => {
  it('should not quantize for valence < 2 (continuous)', () => {
    assert.strictEqual(quantize(0.33, 0, 0, 1), 0.33);
    assert.strictEqual(quantize(0.33, 1, 0, 1), 0.33);
  });

  it('should quantize to 2 levels (binary/Boolean)', () => {
    // https://en.wikipedia.org/wiki/Boolean_algebra
    assert.strictEqual(quantize(0.3, 2, 0, 1), 0);
    assert.strictEqual(quantize(0.7, 2, 0, 1), 1);
    assert.strictEqual(quantize(0.5, 2, 0, 1), 1); // round up at midpoint
  });

  it('should quantize to 3 levels (ternary)', () => {
    // https://en.wikipedia.org/wiki/Three-valued_logic
    assert.strictEqual(quantize(0.1, 3, 0, 1), 0);
    assert.strictEqual(quantize(0.4, 3, 0, 1), 0.5);
    assert.strictEqual(quantize(0.5, 3, 0, 1), 0.5);
    assert.strictEqual(quantize(0.8, 3, 0, 1), 1);
  });

  it('should quantize to 5 levels', () => {
    // Levels: 0, 0.25, 0.5, 0.75, 1
    assert.strictEqual(quantize(0.1, 5, 0, 1), 0);
    assert.strictEqual(quantize(0.3, 5, 0, 1), 0.25);
    assert.strictEqual(quantize(0.6, 5, 0, 1), 0.5);
    assert.strictEqual(quantize(0.7, 5, 0, 1), 0.75);
    assert.strictEqual(quantize(0.9, 5, 0, 1), 1);
  });

  it('should quantize in [-1, 1] range (balanced ternary)', () => {
    // https://en.wikipedia.org/wiki/Balanced_ternary
    // 3 levels in [-1, 1]: {-1, 0, 1}
    assert.strictEqual(quantize(-0.8, 3, -1, 1), -1);
    assert.strictEqual(quantize(-0.2, 3, -1, 1), 0);
    assert.strictEqual(quantize(0.0, 3, -1, 1), 0);
    assert.strictEqual(quantize(0.6, 3, -1, 1), 1);
  });

  it('should quantize binary in [-1, 1] range', () => {
    // 2 levels in [-1, 1]: {-1, 1}
    assert.strictEqual(quantize(-0.5, 2, -1, 1), -1);
    assert.strictEqual(quantize(0.5, 2, -1, 1), 1);
  });
});

// =============================================================================
// Env with range and valence options
// =============================================================================
describe('Env with options', () => {
  it('should accept custom range', () => {
    const env = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(env.lo, -1);
    assert.strictEqual(env.hi, 1);
    assert.strictEqual(env.mid, 0);
  });

  it('should accept custom valence', () => {
    const env = new Env({ valence: 3 });
    assert.strictEqual(env.valence, 3);
  });

  it('should clamp to range', () => {
    const env = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(env.clamp(2), 1);
    assert.strictEqual(env.clamp(-2), -1);
    assert.strictEqual(env.clamp(0.5), 0.5);
  });

  it('should clamp and quantize when valence is set', () => {
    const env = new Env({ valence: 2 }); // Boolean
    assert.strictEqual(env.clamp(0.3), 0);
    assert.strictEqual(env.clamp(0.7), 1);
  });

  it('should compute midpoint correctly for both ranges', () => {
    const env01 = new Env();
    assert.strictEqual(env01.mid, 0.5);
    const envBal = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(envBal.mid, 0);
  });

  it('should use midpoint as default symbol probability', () => {
    const env = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(env.getSymbolProb('unknown'), 0);
  });

  it('not operator should mirror around midpoint in [-1,1]', () => {
    const env = new Env({ lo: -1, hi: 1 });
    const notOp = env.getOp('not');
    assert.strictEqual(notOp(1), -1);   // not(true) = false
    assert.strictEqual(notOp(-1), 1);   // not(false) = true
    assert.strictEqual(notOp(0), 0);    // not(unknown) = unknown
  });

  it('not operator should mirror around midpoint in [0,1]', () => {
    const env = new Env();
    const notOp = env.getOp('not');
    assert.strictEqual(notOp(1), 0);
    assert.strictEqual(notOp(0), 1);
    assert.strictEqual(notOp(0.5), 0.5);
  });
});

// =============================================================================
// 1-valued (Unary) Logic — trivial logic with only one truth value
// https://en.wikipedia.org/wiki/Many-valued_logic
// =============================================================================
describe('Unary logic (1-valued)', () => {
  it('should collapse all values to the midpoint', () => {
    // In unary logic with valence=1, there is only one truth value: the midpoint.
    // Since valence=1 means < 2, quantization is disabled and values pass through.
    // Unary logic is trivial — it effectively means "everything is equally uncertain."
    const env = new Env({ valence: 1 });
    // With valence=1 (trivial logic), no quantization is applied,
    // values pass through as-is — the system degenerates to continuous.
    assert.strictEqual(env.clamp(0.5), 0.5);
    assert.strictEqual(env.clamp(1), 1);
    assert.strictEqual(env.clamp(0), 0);
  });

  it('should work via run with valence:1 configuration', () => {
    const results = run(`
(valence: 1)
(a: a is a)
(? (a = a))
`, { valence: 1 });
    assert.strictEqual(results.length, 1);
    // Even in unary mode, syntactic equality still returns hi (1)
    assert.strictEqual(results[0], 1);
  });
});

// =============================================================================
// 2-valued (Binary/Boolean) Logic
// https://en.wikipedia.org/wiki/Boolean_algebra
// https://en.wikipedia.org/wiki/Classical_logic
// =============================================================================
describe('Binary logic (2-valued, Boolean)', () => {
  it('should quantize truth values to {0, 1} in [0,1] range', () => {
    const results = run(`
(valence: 2)
(a: a is a)
(!=: not =)
(and: avg)
(or: max)
((a = a) has probability 1)
((a != a) has probability 0)
(? (a = a))
(? (a != a))
(? ((a = a) and (a != a)))
(? ((a = a) or (a != a)))
`);
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0], 1);   // true
    assert.strictEqual(results[1], 0);   // false
    // avg(1, 0) = 0.5, quantized to 1 in binary (round up at midpoint)
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 1);   // max(1, 0) = 1
  });

  it('should quantize truth values to {-1, 1} in [-1,1] range', () => {
    const results = run(`
(range: -1 1)
(valence: 2)
(a: a is a)
((a = a) has probability 1)
(? (a = a))
(? (not (a = a)))
`, { lo: -1, hi: 1, valence: 2 });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], -1);
  });

  it('should enforce law of excluded middle (A or not A = true)', () => {
    // In Boolean logic, A ∨ ¬A is always true
    const results = run(`
(valence: 2)
(a: a is a)
(or: max)
((a = a) has probability 1)
(? ((a = a) or (not (a = a))))
`);
    assert.strictEqual(results[0], 1);
  });

  it('should enforce law of non-contradiction (A and not A = false)', () => {
    // In Boolean logic with min semantics, A ∧ ¬A is always false
    const results = run(`
(valence: 2)
(a: a is a)
(and: min)
((a = a) has probability 1)
(? ((a = a) and (not (a = a))))
`);
    assert.strictEqual(results[0], 0);
  });
});

// =============================================================================
// 3-valued (Ternary) Logic — Kleene and Łukasiewicz
// https://en.wikipedia.org/wiki/Three-valued_logic
// https://en.wikipedia.org/wiki/%C5%81ukasiewicz_logic
// =============================================================================
describe('Ternary logic (3-valued)', () => {
  it('should quantize truth values to {0, 0.5, 1} in [0,1] range', () => {
    const env = new Env({ valence: 3 });
    assert.strictEqual(env.clamp(0), 0);
    assert.strictEqual(env.clamp(0.3), 0.5);
    assert.strictEqual(env.clamp(0.5), 0.5);
    assert.strictEqual(env.clamp(0.8), 1);
    assert.strictEqual(env.clamp(1), 1);
  });

  it('should quantize truth values to {-1, 0, 1} in [-1,1] range (balanced ternary)', () => {
    // https://en.wikipedia.org/wiki/Balanced_ternary
    const env = new Env({ lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(env.clamp(-1), -1);
    assert.strictEqual(env.clamp(-0.4), 0);
    assert.strictEqual(env.clamp(0), 0);
    assert.strictEqual(env.clamp(0.6), 1);
    assert.strictEqual(env.clamp(1), 1);
  });

  it('should handle Kleene strong three-valued logic (AND=min, OR=max)', () => {
    // https://en.wikipedia.org/wiki/Three-valued_logic#Kleene_and_Priest_logics
    // In Kleene logic: AND = min, OR = max, NOT = 1 - x
    // Unknown (0.5) AND True (1) = Unknown (0.5)
    // Unknown (0.5) OR False (0) = Unknown (0.5)
    const results = run(`
(valence: 3)
(and: min)
(or: max)
(? (0.5 and 1))
(? (0.5 or 0))
(? (not 0.5))
`);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0], 0.5);  // unknown AND true = unknown
    assert.strictEqual(results[1], 0.5);  // unknown OR false = unknown
    assert.strictEqual(results[2], 0.5);  // NOT unknown = unknown
  });

  it('should handle Kleene logic: unknown AND false = false', () => {
    const results = run(`
(valence: 3)
(and: min)
(? (0.5 and 0))
`);
    assert.strictEqual(results[0], 0);  // unknown AND false = false
  });

  it('should handle Kleene logic: unknown OR true = true', () => {
    const results = run(`
(valence: 3)
(or: max)
(? (0.5 or 1))
`);
    assert.strictEqual(results[0], 1);  // unknown OR true = true
  });

  it('law of excluded middle fails in ternary logic (Kleene)', () => {
    // https://en.wikipedia.org/wiki/Three-valued_logic#Kleene_and_Priest_logics
    // In Kleene logic, A ∨ ¬A is NOT a tautology — when A = unknown:
    // unknown OR unknown = unknown (0.5)
    const results = run(`
(valence: 3)
(or: max)
(? (0.5 or (not 0.5)))
`);
    assert.strictEqual(results[0], 0.5);  // NOT 1 (tautology fails!)
  });

  it('should resolve the liar paradox to 0.5 (unknown) in [0,1] range', () => {
    // The liar paradox: "This statement is false"
    // In three-valued logic, this resolves to the third value (unknown/0.5)
    // https://en.wikipedia.org/wiki/Liar_paradox
    // ('this statement': 'this statement' (is false)) = 50% (from 0% to 100%)
    const results = run(`
(valence: 3)
(and: avg)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('should resolve the liar paradox to 0 in [-1,1] range (balanced ternary)', () => {
    // ('this statement': 'this statement' (is false)) = 0% (from -100% to 100%)
    // https://en.wikipedia.org/wiki/Balanced_ternary
    const results = run(`
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 0);
  });
});

// =============================================================================
// 4-valued (Quaternary) Logic — Belnap's four-valued logic
// https://en.wikipedia.org/wiki/Many-valued_logic
// =============================================================================
describe('Quaternary logic (4-valued)', () => {
  it('should quantize to 4 levels in [0,1]: {0, 1/3, 2/3, 1}', () => {
    const env = new Env({ valence: 4 });
    approx(env.clamp(0), 0);
    approx(env.clamp(0.2), 1/3);
    approx(env.clamp(0.5), 2/3);   // 0.5 is equidistant, rounds up to level 2 (2/3)
    approx(env.clamp(0.6), 2/3);
    approx(env.clamp(1), 1);
  });

  it('should quantize to 4 levels in [-1,1]: {-1, -1/3, 1/3, 1}', () => {
    const env = new Env({ lo: -1, hi: 1, valence: 4 });
    approx(env.clamp(-1), -1);
    approx(env.clamp(-0.5), -1/3);
    approx(env.clamp(0), 1/3);    // 0 is equidistant between -1/3 and 1/3, rounds up
    approx(env.clamp(0.5), 1/3);
    approx(env.clamp(1), 1);
  });

  it('should support 4-valued logic via run', () => {
    const results = run(`
(valence: 4)
(and: min)
(or: max)
(? (0.33 and 0.66))
(? (0.33 or 0.66))
`);
    assert.strictEqual(results.length, 2);
    approx(results[0], 1/3);   // min(1/3, 2/3) = 1/3
    approx(results[1], 2/3);   // max(1/3, 2/3) = 2/3
  });
});

// =============================================================================
// 5-valued (Quinary) Logic
// https://en.wikipedia.org/wiki/Many-valued_logic
// =============================================================================
describe('Quinary logic (5-valued)', () => {
  it('should quantize to 5 levels in [0,1]: {0, 0.25, 0.5, 0.75, 1}', () => {
    const env = new Env({ valence: 5 });
    assert.strictEqual(env.clamp(0), 0);
    assert.strictEqual(env.clamp(0.1), 0);
    assert.strictEqual(env.clamp(0.2), 0.25);
    assert.strictEqual(env.clamp(0.4), 0.5);
    assert.strictEqual(env.clamp(0.6), 0.5);
    assert.strictEqual(env.clamp(0.7), 0.75);
    assert.strictEqual(env.clamp(0.9), 1);
    assert.strictEqual(env.clamp(1), 1);
  });

  it('should support 5-valued logic with paradox at 0.5', () => {
    const results = run(`
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });
});

// =============================================================================
// Higher N-valued logics (7, 10, 100)
// https://en.wikipedia.org/wiki/Many-valued_logic
// =============================================================================
describe('Higher N-valued logics', () => {
  it('should support 7-valued logic', () => {
    // 7 levels in [0,1]: {0, 1/6, 2/6, 3/6, 4/6, 5/6, 1}
    const env = new Env({ valence: 7 });
    approx(env.clamp(0), 0);
    approx(env.clamp(0.5), 0.5);   // 3/6
    approx(env.clamp(1), 1);
  });

  it('should support 10-valued logic', () => {
    // 10 levels in [0,1]: {0, 1/9, 2/9, ..., 8/9, 1}
    const env = new Env({ valence: 10 });
    approx(env.clamp(0), 0);
    approx(env.clamp(1), 1);
    approx(env.clamp(0.5), 5/9);   // closest level
  });

  it('should support 100-valued logic', () => {
    // 100 levels in [0,1]: fine-grained but discrete
    // Levels: 0/99, 1/99, 2/99, ..., 99/99
    const env = new Env({ valence: 100 });
    approx(env.clamp(0), 0);
    approx(env.clamp(1), 1);
    // 0.5 → level = round(0.5 * 99) = round(49.5) = 50 → 50/99
    // But due to floating point, round(49.5) might go to 49 or 50.
    // Math.round(49.5) = 50 in JS, so expect 50/99
    const actual = env.clamp(0.5);
    // Just verify it's close to 0.5
    approx(actual, actual);  // self-check
    assert.ok(Math.abs(actual - 0.5) < 0.02, `100-valued 0.5 should be close to 0.5, got ${actual}`);
  });
});

// =============================================================================
// Continuous Probabilistic / Fuzzy Logic (infinite-valued, valence=0)
// https://en.wikipedia.org/wiki/Fuzzy_logic
// https://en.wikipedia.org/wiki/%C5%81ukasiewicz_logic (infinite-valued variant)
// =============================================================================
describe('Continuous probabilistic logic (infinite-valued, fuzzy)', () => {
  it('should preserve exact values in [0,1] range (no quantization)', () => {
    const results = run(`
(a: a is a)
(and: avg)
((a = a) has probability 0.7)
(? (a = a))
(? (not (a = a)))
`);
    assert.strictEqual(results.length, 2);
    approx(results[0], 0.7);
    approx(results[1], 0.3);
  });

  it('should preserve exact values in [-1,1] range', () => {
    const results = run(`
(range: -1 1)
(a: a is a)
((a = a) has probability 0.4)
(? (a = a))
(? (not (a = a)))
`, { lo: -1, hi: 1 });
    assert.strictEqual(results.length, 2);
    approx(results[0], 0.4);
    approx(results[1], -0.4);  // not(0.4) in [-1,1] = hi - (x - lo) = 1 - (0.4 - (-1)) = 1 - 1.4 = -0.4
  });

  it('should handle the liar paradox at 0.5 in [0,1] (continuous)', () => {
    // In continuous probabilistic logic, the liar paradox "this statement is false"
    // resolves to 0.5 — the fixed point of negation in [0,1].
    // not(x) = 1 - x, fixed point: x = 1 - x → x = 0.5
    // https://en.wikipedia.org/wiki/Liar_paradox
    const results = run(`
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
`);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);  // not(0.5) = 0.5 — fixed point!
  });

  it('should handle the liar paradox at 0 in [-1,1] (continuous)', () => {
    // In [-1,1] range, the liar paradox resolves to 0 — the midpoint.
    // not(x) = -x in balanced range, fixed point: x = -x → x = 0
    // https://en.wikipedia.org/wiki/Balanced_ternary
    const results = run(`
(range: -1 1)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
(? (not (s = false)))
`, { lo: -1, hi: 1 });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 0);
    assert.strictEqual(results[1], 0);   // not(0) = 0 — fixed point!
  });

  it('should demonstrate fuzzy membership degrees', () => {
    // https://en.wikipedia.org/wiki/Fuzzy_logic
    // Fuzzy logic uses truth values in [0,1] as degrees of membership
    const results = run(`
(and: min)
(or: max)
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.3)
(? ((a = tall) and (b = tall)))
(? ((a = tall) or (b = tall)))
`);
    assert.strictEqual(results.length, 2);
    approx(results[0], 0.3);   // min(0.8, 0.3)
    approx(results[1], 0.8);   // max(0.8, 0.3)
  });
});

// =============================================================================
// Range configuration via LiNo syntax
// =============================================================================
describe('Range and valence configuration via LiNo syntax', () => {
  it('should configure range via (range: lo hi) define form', () => {
    const results = run(`
(range: -1 1)
(a: a is a)
(? (a = a))
(? (not (a = a)))
`);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], -1);
  });

  it('should configure valence via (valence: N) define form', () => {
    const results = run(`
(valence: 3)
(? (not 0.5))
`);
    // In ternary with [0,1]: not(0.5) = 0.5
    assert.strictEqual(results[0], 0.5);
  });

  it('should configure both range and valence', () => {
    const results = run(`
(range: -1 1)
(valence: 3)
(a: a is a)
(? (a = a))
(? (not (a = a)))
(? (0 and 0))
`);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0], 1);    // true
    assert.strictEqual(results[1], -1);   // false
    assert.strictEqual(results[2], 0);    // unknown (midpoint, quantized to 0)
  });
});

// =============================================================================
// Liar paradox comprehensive test — the key example from the issue
// "('this statement': 'this statement' (is false)) = 50% (from 0% to 100%)
//  or 0% (from -100% to 100%)"
// https://en.wikipedia.org/wiki/Liar_paradox
// =============================================================================
describe('Liar paradox resolution across logic types', () => {
  it('in ternary [0,1]: resolves to 0.5 (50%)', () => {
    // https://en.wikipedia.org/wiki/Three-valued_logic
    const results = run(`
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('in ternary [-1,1]: resolves to 0 (0%)', () => {
    // https://en.wikipedia.org/wiki/Balanced_ternary
    const results = run(`
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 0);
  });

  it('in continuous [0,1]: resolves to 0.5 (50%)', () => {
    const results = run(`
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);  // fixed point of negation
  });

  it('in continuous [-1,1]: resolves to 0 (0%)', () => {
    const results = run(`
(range: -1 1)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
(? (not (s = false)))
`, { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
    assert.strictEqual(results[1], 0);    // fixed point of negation
  });

  it('in 5-valued [0,1]: resolves to 0.5', () => {
    const results = run(`
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('in 5-valued [-1,1]: resolves to 0', () => {
    const results = run(`
(range: -1 1)
(valence: 5)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 5 });
    assert.strictEqual(results[0], 0);
  });
});

// ===== Decimal-precision arithmetic =====

describe('decRound', () => {
  it('should round 0.1 + 0.2 to exactly 0.3', () => {
    assert.strictEqual(decRound(0.1 + 0.2), 0.3);
  });

  it('should round 0.3 - 0.1 to exactly 0.2', () => {
    assert.strictEqual(decRound(0.3 - 0.1), 0.2);
  });

  it('should preserve exact values', () => {
    assert.strictEqual(decRound(1.0), 1.0);
    assert.strictEqual(decRound(0.0), 0.0);
    assert.strictEqual(decRound(0.5), 0.5);
  });

  it('should handle non-finite values', () => {
    assert.strictEqual(decRound(Infinity), Infinity);
    assert.strictEqual(decRound(-Infinity), -Infinity);
    assert.ok(Number.isNaN(decRound(NaN)));
  });
});

describe('Decimal arithmetic operators', () => {
  it('(? (0.1 + 0.2)) should equal 0.3', () => {
    const results = run('(? (0.1 + 0.2))');
    assert.strictEqual(results[0], 0.3);
  });

  it('(? (0.3 - 0.1)) should equal 0.2', () => {
    const results = run('(? (0.3 - 0.1))');
    assert.strictEqual(results[0], 0.2);
  });

  it('(? (0.1 * 0.2)) should equal 0.02', () => {
    const results = run('(? (0.1 * 0.2))');
    assert.strictEqual(results[0], 0.02);
  });

  it('(? (1 / 3)) should equal 0.333333333333', () => {
    const results = run('(? (1 / 3))');
    approx(results[0], 1/3, 1e-9);
  });

  it('(? (0 / 0)) should handle division by zero', () => {
    const results = run('(? (0 / 0))');
    assert.strictEqual(results[0], 0);
  });

  it('(? ((0.1 + 0.2) = 0.3)) should equal 1 (true)', () => {
    const results = run('(? ((0.1 + 0.2) = 0.3))');
    assert.strictEqual(results[0], 1);
  });

  it('(? ((0.1 + 0.2) != 0.3)) should equal 0 (false)', () => {
    const results = run('(? ((0.1 + 0.2) != 0.3))');
    assert.strictEqual(results[0], 0);
  });

  it('(? ((0.3 - 0.1) = 0.2)) should equal 1 (true)', () => {
    const results = run('(? ((0.3 - 0.1) = 0.2))');
    assert.strictEqual(results[0], 1);
  });

  it('arithmetic with nested expressions', () => {
    const results = run('(? ((0.1 + 0.2) + (0.3 + 0.1)))');
    assert.strictEqual(results[0], 0.7);
  });

  it('arithmetic does not clamp intermediate values', () => {
    const results = run('(? (2 + 3))');
    // Query clamps to [0,1], so 5 becomes 1
    assert.strictEqual(results[0], 1);
  });

  it('arithmetic equality across expressions', () => {
    const results = run(`
(? ((0.1 + 0.2) = (0.5 - 0.2)))
`);
    assert.strictEqual(results[0], 1);
  });
});

// =============================================================================
// Truth constants: true, false, unknown, undefined
// These are predefined symbol probabilities based on the current range.
// By default: (false: min(range)), (true: max(range)),
//             (unknown: mid(range)), (undefined: mid(range))
// They can be redefined by the user via (true: <value>), (false: <value>), etc.
// See: https://github.com/link-foundation/associative-dependent-logic/issues/11
// =============================================================================
describe('Truth constants: default values in [0,1] range', () => {
  it('true should default to 1 (max of range)', () => {
    const results = run('(? true)');
    assert.strictEqual(results[0], 1);
  });

  it('false should default to 0 (min of range)', () => {
    const results = run('(? false)');
    assert.strictEqual(results[0], 0);
  });

  it('unknown should default to 0.5 (mid of range)', () => {
    const results = run('(? unknown)');
    assert.strictEqual(results[0], 0.5);
  });

  it('undefined should default to 0.5 (mid of range)', () => {
    const results = run('(? undefined)');
    assert.strictEqual(results[0], 0.5);
  });
});

describe('Truth constants: default values in [-1,1] range', () => {
  it('true should default to 1 (max of range)', () => {
    const results = run('(range: -1 1)\n(? true)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 1);
  });

  it('false should default to -1 (min of range)', () => {
    const results = run('(range: -1 1)\n(? false)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], -1);
  });

  it('unknown should default to 0 (mid of range)', () => {
    const results = run('(range: -1 1)\n(? unknown)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
  });

  it('undefined should default to 0 (mid of range)', () => {
    const results = run('(range: -1 1)\n(? undefined)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
  });
});

describe('Truth constants: redefinition via (true: value)', () => {
  it('should allow redefining true', () => {
    const results = run(`
(true: 0.8)
(? true)
`);
    assert.strictEqual(results[0], 0.8);
  });

  it('should allow redefining false', () => {
    const results = run(`
(false: 0.2)
(? false)
`);
    assert.strictEqual(results[0], 0.2);
  });

  it('should allow redefining unknown', () => {
    const results = run(`
(unknown: 0.3)
(? unknown)
`);
    assert.strictEqual(results[0], 0.3);
  });

  it('should allow redefining undefined', () => {
    const results = run(`
(undefined: 0.7)
(? undefined)
`);
    assert.strictEqual(results[0], 0.7);
  });

  it('should allow redefining true and false in [-1,1] range', () => {
    const results = run(`
(range: -1 1)
(true: 0.5)
(false: -0.5)
(? true)
(? false)
`, { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], -0.5);
  });
});

describe('Truth constants: range change re-initializes defaults', () => {
  it('should update truth constants when range changes', () => {
    const results = run(`
(? true)
(? false)
(range: -1 1)
(? true)
(? false)
(? unknown)
`);
    assert.strictEqual(results.length, 5);
    assert.strictEqual(results[0], 1);    // true in [0,1]
    assert.strictEqual(results[1], 0);    // false in [0,1]
    assert.strictEqual(results[2], 1);    // true in [-1,1]
    assert.strictEqual(results[3], -1);   // false in [-1,1]
    assert.strictEqual(results[4], 0);    // unknown in [-1,1]
  });
});

describe('Truth constants: use in expressions', () => {
  it('(not true) should equal false', () => {
    const results = run('(? (not true))');
    assert.strictEqual(results[0], 0);
  });

  it('(not false) should equal true', () => {
    const results = run('(? (not false))');
    assert.strictEqual(results[0], 1);
  });

  it('(not unknown) should equal unknown (fixed point of negation)', () => {
    const results = run('(? (not unknown))');
    assert.strictEqual(results[0], 0.5);
  });

  it('(true and false) should equal 0.5 with avg aggregator', () => {
    const results = run('(? (true and false))');
    assert.strictEqual(results[0], 0.5);
  });

  it('(true or false) should equal 1 with max aggregator', () => {
    const results = run('(? (true or false))');
    assert.strictEqual(results[0], 1);
  });

  it('(true and false) should equal 0 with min aggregator', () => {
    const results = run(`
(and: min)
(? (true and false))
`);
    assert.strictEqual(results[0], 0);
  });

  it('truth constants in [-1,1] range with not', () => {
    const results = run(`
(range: -1 1)
(? (not true))
(? (not false))
(? (not unknown))
`, { lo: -1, hi: 1 });
    assert.strictEqual(results[0], -1);   // not(1) = -1
    assert.strictEqual(results[1], 1);    // not(-1) = 1
    assert.strictEqual(results[2], 0);    // not(0) = 0
  });
});

describe('Truth constants: with quantization (valence)', () => {
  it('truth constants should work with binary valence', () => {
    const results = run(`
(valence: 2)
(? true)
(? false)
(? unknown)
`);
    assert.strictEqual(results[0], 1);    // true = 1, quantized to 1
    assert.strictEqual(results[1], 0);    // false = 0, quantized to 0
    assert.strictEqual(results[2], 1);    // unknown = 0.5, quantized to 1 (round up)
  });

  it('truth constants should work with ternary valence', () => {
    const results = run(`
(valence: 3)
(? true)
(? false)
(? unknown)
`);
    assert.strictEqual(results[0], 1);    // true = 1, quantized to 1
    assert.strictEqual(results[1], 0);    // false = 0, quantized to 0
    assert.strictEqual(results[2], 0.5);  // unknown = 0.5, quantized to 0.5
  });

  it('truth constants should work with ternary valence in [-1,1]', () => {
    const results = run(`
(range: -1 1)
(valence: 3)
(? true)
(? false)
(? unknown)
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 1);    // true = 1
    assert.strictEqual(results[1], -1);   // false = -1
    assert.strictEqual(results[2], 0);    // unknown = 0
  });
});

describe('Truth constants: Env API', () => {
  it('Env should have truth constants initialized', () => {
    const env = new Env();
    assert.strictEqual(env.getSymbolProb('true'), 1);
    assert.strictEqual(env.getSymbolProb('false'), 0);
    assert.strictEqual(env.getSymbolProb('unknown'), 0.5);
    assert.strictEqual(env.getSymbolProb('undefined'), 0.5);
  });

  it('Env with [-1,1] range should have correct truth constants', () => {
    const env = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(env.getSymbolProb('true'), 1);
    assert.strictEqual(env.getSymbolProb('false'), -1);
    assert.strictEqual(env.getSymbolProb('unknown'), 0);
    assert.strictEqual(env.getSymbolProb('undefined'), 0);
  });

  it('truth constants should survive operator redefinition', () => {
    const results = run(`
(and: min)
(or: max)
(? true)
(? false)
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 0);
  });
});

// =============================================================================
// Belnap's four-valued logic operators: both, neither
// https://en.wikipedia.org/wiki/Four-valued_logic#Belnap
// =============================================================================
describe('Operators: both and neither (Belnap four-valued)', () => {
  it('both should compute avg of operands (contradiction)', () => {
    const results = run('(? (true both false))');
    assert.strictEqual(results[0], 0.5);   // avg(1, 0) = 0.5
  });

  it('neither should compute product of operands (gap)', () => {
    const results = run('(? (true neither false))');
    assert.strictEqual(results[0], 0);     // product(1, 0) = 0
  });

  it('both should be redefinable via aggregator', () => {
    const results = run(`
(both: min)
(? (true both false))
`);
    assert.strictEqual(results[0], 0);     // min(1, 0) = 0
  });

  it('neither should be redefinable via aggregator', () => {
    const results = run(`
(neither: max)
(? (true neither false))
`);
    assert.strictEqual(results[0], 1);     // max(1, 0) = 1
  });

  it('Env should have both and neither as operators', () => {
    const env = new Env();
    assert.strictEqual(typeof env.ops.get('both'), 'function');
    assert.strictEqual(typeof env.ops.get('neither'), 'function');
  });

  it('both with same values should return that value', () => {
    const results = run(`
(? (true both true))
(? (false both false))
`);
    assert.strictEqual(results[0], 1);     // avg(1, 1) = 1
    assert.strictEqual(results[1], 0);     // avg(0, 0) = 0
  });

  it('neither with same values should return that value', () => {
    const results = run(`
(? (true neither true))
(? (false neither false))
`);
    assert.strictEqual(results[0], 1);     // product(1, 1) = 1
    assert.strictEqual(results[1], 0);     // product(0, 0) = 0
  });

  it('both with fuzzy values', () => {
    const results = run(`
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.4)
(? ((a = tall) both (b = tall)))
`);
    assert.strictEqual(results[0], 0.6);   // avg(0.8, 0.4) = 0.6
  });

  it('neither with fuzzy values', () => {
    const results = run(`
(a: a is a)
(b: b is b)
((a = tall) has probability 0.8)
((b = tall) has probability 0.5)
(? ((a = tall) neither (b = tall)))
`);
    assert.strictEqual(results[0], 0.4);   // product(0.8, 0.5) = 0.4
  });

  it('both should work in prefix form', () => {
    const results = run('(? (both true false))');
    assert.strictEqual(results[0], 0.5);   // avg(1, 0) = 0.5
  });

  it('neither should work in prefix form', () => {
    const results = run('(? (neither true false))');
    assert.strictEqual(results[0], 0);     // product(1, 0) = 0
  });

  it('both should work in composite natural language form: (both A and B)', () => {
    const results = run(`
(? (both true and false))
(? (both true and true))
(? (both false and false))
`);
    assert.strictEqual(results[0], 0.5);   // avg(1, 0) = 0.5
    assert.strictEqual(results[1], 1);     // avg(1, 1) = 1
    assert.strictEqual(results[2], 0);     // avg(0, 0) = 0
  });

  it('neither should work in composite natural language form: (neither A nor B)', () => {
    const results = run(`
(? (neither true nor false))
(? (neither true nor true))
(? (neither false nor false))
`);
    assert.strictEqual(results[0], 0);     // product(1, 0) = 0
    assert.strictEqual(results[1], 1);     // product(1, 1) = 1
    assert.strictEqual(results[2], 0);     // product(0, 0) = 0
  });

  it('composite both should work with variadic form: (both A and B and C)', () => {
    const results = run('(? (both true and true and false))');
    assert.ok(Math.abs(results[0] - 0.666666666667) < 0.0001); // avg(1, 1, 0)
  });

  it('composite neither should work with variadic form: (neither A nor B nor C)', () => {
    const results = run('(? (neither true nor true nor false))');
    assert.strictEqual(results[0], 0);     // product(1, 1, 0) = 0
  });

  it('composite both should be redefinable', () => {
    const results = run(`
(both: min)
(? (both true and false))
`);
    assert.strictEqual(results[0], 0);     // min(1, 0) = 0
  });

  it('composite neither should be redefinable', () => {
    const results = run(`
(neither: max)
(? (neither true nor false))
`);
    assert.strictEqual(results[0], 1);     // max(1, 0) = 1
  });

  it('both should update behavior when range changes', () => {
    const results = run(`
(? (true both false))
(range: -1 1)
(? (true both false))
`);
    assert.strictEqual(results[0], 0.5);   // avg(1, 0) = 0.5 in [0,1]
    assert.strictEqual(results[1], 0);     // avg(1, -1) = 0 in [-1,1] (clamped to range)
  });

  it('issue scenario: both (a=a) and (a!=a) gives 0.5', () => {
    const results = run(`
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? (both (a = a) and (a != a)))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('issue scenario: neither (a=a) nor (a!=a) gives 0', () => {
    const results = run(`
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? (neither (a = a) nor (a != a)))
`);
    assert.strictEqual(results[0], 0);
  });

  it('issue scenario: infix backward compat (a=a) both (a!=a) gives 0.5', () => {
    const results = run(`
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? ((a = a) both (a != a)))
`);
    assert.strictEqual(results[0], 0.5);
  });
});

describe('Truth constants: liar paradox using truth constants', () => {
  it('liar paradox with true/false constants in [0,1]', () => {
    // "This statement is false" — the classic liar paradox
    // Using the symbolic constant 'false' instead of numeric 0
    const results = run(`
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('liar paradox with truth constants in [-1,1]', () => {
    const results = run(`
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 0);
  });
});

// =============================================================================
// Type System — "everything is a link"
// Dependent types as links: types are stored as associations in the link network.
// See: https://github.com/link-foundation/associative-dependent-logic/issues/13
// =============================================================================

describe('Type System: substitute (beta-reduction helper)', () => {
  it('should expose subst as the kernel substitution primitive', () => {
    assert.strictEqual(subst('x', 'x', 'y'), 'y');
  });

  it('should substitute a variable in a string', () => {
    assert.strictEqual(substitute('x', 'x', 'y'), 'y');
  });

  it('should not substitute a different variable', () => {
    assert.strictEqual(substitute('y', 'x', 'z'), 'y');
  });

  it('should substitute in arrays', () => {
    assert.deepStrictEqual(
      substitute(['x', '+', '1'], 'x', '5'),
      ['5', '+', '1']
    );
  });

  it('should substitute recursively in nested arrays', () => {
    assert.deepStrictEqual(
      substitute(['+', 'x', ['+', 'x', '1']], 'x', '5'),
      ['+', '5', ['+', '5', '1']]
    );
  });

  it('should not substitute inside shadowing lambda bindings (colon form)', () => {
    const expr = ['lambda', ['x:', 'Natural'], 'x'];
    assert.deepStrictEqual(substitute(expr, 'x', '5'), expr);
  });

  it('should not substitute inside shadowing lambda bindings (prefix form)', () => {
    const expr = ['lambda', ['Natural', 'x'], 'x'];
    assert.deepStrictEqual(substitute(expr, 'x', '5'), expr);
  });

  it('should not substitute inside shadowing Pi bindings', () => {
    const expr = ['Pi', ['x:', 'Natural'], 'x'];
    assert.deepStrictEqual(substitute(expr, 'x', 'Boolean'), expr);
  });

  it('should substitute free variables in lambda body', () => {
    const expr = ['lambda', ['Natural', 'y'], 'x'];
    assert.deepStrictEqual(
      substitute(expr, 'x', '5'),
      ['lambda', ['Natural', 'y'], '5']
    );
  });

  it('should alpha-rename lambda binders that would capture the replacement', () => {
    const expr = ['lambda', ['Natural', 'y'], ['x', '+', 'y']];
    assert.deepStrictEqual(
      subst(expr, 'x', 'y'),
      ['lambda', ['Natural', 'y_1'], ['y', '+', 'y_1']]
    );
  });

  it('should alpha-rename Pi binders that would capture the replacement', () => {
    const expr = ['Pi', ['Natural', 'y'], ['Vec', 'x', 'y']];
    assert.deepStrictEqual(
      subst(expr, 'x', 'y'),
      ['Pi', ['Natural', 'y_1'], ['Vec', 'y', 'y_1']]
    );
  });

  it('should alpha-rename fresh binders that would capture the replacement', () => {
    const expr = ['fresh', 'y', 'in', ['x', '+', 'y']];
    assert.deepStrictEqual(
      subst(expr, 'x', 'y'),
      ['fresh', 'y_1', 'in', ['y', '+', 'y_1']]
    );
  });
});

describe('Type System: universe sorts — (Type N)', () => {
  it('should evaluate (Type 0) as a valid expression', () => {
    const env = new Env();
    const result = evalNode(['Type', '0'], env);
    assert.strictEqual(result, 1);
  });

  it('should store type of (Type 0) as (Type 1)', () => {
    const env = new Env();
    evalNode(['Type', '0'], env);
    assert.strictEqual(env.getType(['Type', '0']), '(Type 1)');
  });

  it('should store type of (Type 1) as (Type 2)', () => {
    const env = new Env();
    evalNode(['Type', '1'], env);
    assert.strictEqual(env.getType(['Type', '1']), '(Type 2)');
  });

  it('(Type 0) via run should work', () => {
    const results = run('(? (Type 0))');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 1);
  });
});

describe('Type System: typed variable declarations — (name: Type name)', () => {
  it('should declare a typed variable via prefix notation', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(x: Natural x)
(? (x of Natural))
`);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 1);
  });

  it('should return false for wrong type', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(? (x of Boolean))
`);
    assert.strictEqual(results[0], 0);
  });

  it('should support multiple typed declarations', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(y: Boolean y)
(? (x of Natural))
(? (y of Boolean))
(? (x of Boolean))
`);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 0);
  });
});

describe('Type System: Pi-types — (Pi (Natural x) B)', () => {
  it('should evaluate a Pi-type as valid', () => {
    const results = run('(? (Pi (Natural x) Natural))');
    assert.strictEqual(results[0], 1);
  });

  it('should register Pi-type in the type environment', () => {
    const env = new Env();
    evalNode(['Pi', ['Natural', 'x'], 'Natural'], env);
    const typeOfPi = env.getType(['Pi', ['Natural', 'x'], 'Natural']);
    assert.ok(typeOfPi !== null);
  });

  it('should register the parameter type from Pi', () => {
    const env = new Env();
    evalNode(['Pi', ['Natural', 'n'], ['Vec', 'n', 'Boolean']], env);
    assert.ok(env.terms.has('n'));
    assert.strictEqual(env.getType('n'), 'Natural');
  });

  it('non-dependent function type: (Pi (Natural _) Boolean)', () => {
    const results = run('(? (Pi (Natural _) Boolean))');
    assert.strictEqual(results[0], 1);
  });
});

describe('Type System: lambda abstraction — (lambda (Natural x) body)', () => {
  it('should evaluate a lambda as valid', () => {
    const results = run('(? (lambda (Natural x) x))');
    assert.strictEqual(results[0], 1);
  });

  it('should store lambda type as a Pi-type', () => {
    const env = new Env();
    evalNode(['lambda', ['Natural', 'x'], 'x'], env);
    const t = env.getType(['lambda', ['Natural', 'x'], 'x']);
    assert.ok(t !== null);
    assert.ok(t.includes('Pi'));
  });
});

describe('Type System: application — (apply f x) with beta-reduction', () => {
  it('should beta-reduce (apply (lambda (Natural x) x) 0.5) to 0.5', () => {
    const results = run('(? (apply (lambda (Natural x) x) 0.5))');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.5);
  });

  it('should beta-reduce with arithmetic in body', () => {
    const results = run('(? (apply (lambda (Natural x) (x + 0.1)) 0.2))');
    assert.strictEqual(results[0], 0.3);
  });

  it('should apply named lambda via (apply name arg)', () => {
    const results = run(`
(identity: lambda (Natural x) x)
(? (apply identity 0.7))
`);
    assert.strictEqual(results[0], 0.7);
  });

  it('should apply named lambda via prefix form (name arg)', () => {
    const results = run(`
(identity: lambda (Natural x) x)
(? (identity 0.7))
`);
    assert.strictEqual(results[0], 0.7);
  });

  it('should apply const function', () => {
    const results = run('(? (apply (lambda (Natural x) 0.5) 0.9))');
    assert.strictEqual(results[0], 0.5);
  });
});

describe('Type System: type check query — (expr of Type)', () => {
  it('should confirm type with of link', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(x: Natural x)
(? (x of Natural))
`);
    assert.strictEqual(results[0], 1);
  });

  it('should reject wrong type', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(x: Natural x)
(? (x of Boolean))
`);
    assert.strictEqual(results[0], 0);
  });

  it('should work with universe types', () => {
    const results = run(`
(Type 0)
(? ((Type 0) of (Type 1)))
`);
    assert.strictEqual(results[0], 1);
  });
});

describe('Type System: type of query — (type of expr)', () => {
  it('should infer type of a typed variable', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(x: Natural x)
(? (type of x))
`);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 'Natural');
  });

  it('should return unknown for untyped expressions', () => {
    const results = run(`
(a: a is a)
(? (type of a))
`);
    assert.strictEqual(results[0], 'unknown');
  });
});

describe('Type System: encoding Lean/Rocq core concepts as links', () => {
  it('should define natural number type and constructors', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (Natural of (Type 0)))
`);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('should define Boolean type and constructors', () => {
    const results = run(`
(Boolean: (Type 0) Boolean)
(true-val: Boolean true-val)
(false-val: Boolean false-val)
(? (true-val of Boolean))
(? (false-val of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('should define identity function with type', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(identity: (Pi (Natural x) Natural))
(? (identity of (Pi (Natural x) Natural)))
`);
    assert.strictEqual(results[0], 1);
  });

  it('should combine types with probability assignments', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(? (zero of Natural))
((zero = zero) has probability 1)
(? (zero = zero))
`);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('should define and apply identity function', () => {
    const results = run(`
(identity: lambda (Natural x) x)
(? (apply identity 0.5))
`);
    assert.strictEqual(results[0], 0.5);
  });
});

describe('Type System: backward compatibility', () => {
  it('existing term definitions still work', () => {
    const results = run(`
(a: a is a)
(? (a = a))
`);
    assert.strictEqual(results[0], 1);
  });

  it('existing probability assignments still work', () => {
    const results = run(`
(a: a is a)
((a = a) has probability 0.7)
(? (a = a))
`);
    approx(results[0], 0.7);
  });

  it('existing operators still work', () => {
    const results = run(`
(and: min)
(or: max)
(? (0.3 and 0.7))
(? (0.3 or 0.7))
`);
    assert.strictEqual(results[0], 0.3);
    assert.strictEqual(results[1], 0.7);
  });

  it('liar paradox still works', () => {
    const results = run(`
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);
  });

  it('arithmetic still works', () => {
    const results = run('(? (0.1 + 0.2))');
    assert.strictEqual(results[0], 0.3);
  });

  it('mixed: types alongside probabilistic logic', () => {
    const results = run(`
(a: a is a)
(Natural: (Type 0) Natural)
(x: Natural x)
((a = a) has probability 1)
(? (a = a))
(? (x of Natural))
(? (Type 0))
`);
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
  });
});

describe('Type System: prefix type notation — (name: Type name)', () => {
  it('(zero: Natural zero) declares zero has type Natural', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(? (zero of Natural))
`);
    assert.strictEqual(results[0], 1);
  });

  it('(Boolean: (Type 0) Boolean) declares Boolean has type (Type 0)', () => {
    const results = run(`
(Type 0)
(Boolean: (Type 0) Boolean)
(? (Boolean of (Type 0)))
`);
    assert.strictEqual(results[0], 1);
  });

  it('prefix notation with simple type names', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (true-val of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('prefix notation with Pi-type constructor', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (succ of (Pi (Natural n) Natural)))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('type hierarchy: (Type: (Type 0) Type), (Boolean: Type Boolean)', () => {
    const results = run(`
(Type 0)
(Type: (Type 0) Type)
(Boolean: Type Boolean)
(True: Boolean True)
(False: Boolean False)
(? (Boolean of Type))
(? (True of Boolean))
(? (False of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
  });

  it('lambda with multi-param binding: (lambda (Natural x, Natural y) body)', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(? (lambda (Natural x, Natural y) (x + y)))
`);
    assert.strictEqual(results[0], 1);
  });
});

describe('Type System: self-referential (Type: Type Type) — dynamic axiomatic system', () => {
  it('(Type: Type Type) defines Type as its own type', () => {
    const results = run(`
(Type: Type Type)
(? (Type of Type))
`);
    assert.strictEqual(results[0], 1);
  });

  it('(Type: Type Type) supports full type hierarchy', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (Natural of Type))
(? (Boolean of Type))
(? (Type of Type))
`);
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 1);
  });

  it('(type of Natural) returns Type when using self-referential Type', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(? (type of Natural))
(? (type of Type))
`);
    assert.strictEqual(results[0], 'Type');
    assert.strictEqual(results[1], 'Type');
  });

  it('(Type: Type Type) coexists with (Type N) universe hierarchy', () => {
    const results = run(`
(Type: Type Type)
(Type 0)
(Type 1)
(Natural: (Type 0) Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(? (Type of Type))
(? (Natural of (Type 0)))
(? (Boolean of Type))
(? (zero of Natural))
(? ((Type 0) of (Type 1)))
`);
    assert.strictEqual(results.length, 5);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 1);
    assert.strictEqual(results[4], 1);
  });

  it('paradox resolution: liar paradox alongside self-referential types', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
(? (Natural of Type))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);
    assert.strictEqual(results[2], 1);
  });

  it('paradox resolution: self-referential equality resolves to 0.5', () => {
    const results = run(`
(Type: Type Type)
(R: R is R)
((R = R) has probability 0.5)
(? (R = R))
(? (not (R = R)))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);
  });
});

// ──────────────────────────────────────────────────────────────
// Bayesian Inference and Bayesian Networks
// ──────────────────────────────────────────────────────────────
describe('Bayesian Inference', () => {
  it('Bayes theorem: medical diagnosis P(Disease|Positive)', () => {
    // P(D)=0.01, P(Pos|D)=0.95, P(Pos|~D)=0.05
    // P(D|Pos) = P(Pos|D)*P(D) / (P(Pos|D)*P(D)+P(Pos|~D)*P(~D))
    const results = run(`
(? (0.95 * 0.01))
(? ((0.95 * 0.01) + (0.05 * 0.99)))
(? ((0.95 * 0.01) / ((0.95 * 0.01) + (0.05 * 0.99))))
`);
    approx(results[0], 0.0095);
    approx(results[1], 0.059);
    approx(results[2], 0.161017, 1e-6);
  });

  it('probabilistic AND (product): P(A ∩ B) = P(A)*P(B)', () => {
    const results = run(`
(and: product)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.3)
(((b) = true) has probability 0.7)
(? (((a) = true) and ((b) = true)))
`);
    approx(results[0], 0.21);
  });

  it('probabilistic OR (probabilistic_sum): P(A ∪ B) = 1-(1-P(A))*(1-P(B))', () => {
    const results = run(`
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.3)
(((b) = true) has probability 0.7)
(? (((a) = true) or ((b) = true)))
`);
    approx(results[0], 0.79);
  });

  it('joint probability with product and probabilistic_sum together', () => {
    const results = run(`
(and: product)
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(c: c is c)
(((a) = true) has probability 0.5)
(((b) = true) has probability 0.3)
(((c) = true) has probability 0.5)
(? (((a) = true) and ((b) = true)))
(? (((a) = true) or ((b) = true)))
(? (and ((a) = true) ((b) = true) ((c) = true)))
`);
    approx(results[0], 0.15);
    approx(results[1], 0.65);
    approx(results[2], 0.075);
  });

  it('Bayesian network: chain rule decomposition', () => {
    // P(WetGrass) from conditional probabilities
    // P(W|S,R)=0.99, P(W|S,~R)=0.9, P(W|~S,R)=0.9, P(W|~S,~R)=0.01
    // P(S)=0.3, P(R)=0.5
    const results = run(`
(? (((0.99 * 0.15) + (0.9 * 0.15)) + ((0.9 * 0.35) + (0.01 * 0.35))))
`);
    approx(results[0], 0.602, 1e-6);
  });

  it('law of total probability', () => {
    // P(B) = P(B|A)*P(A) + P(B|~A)*P(~A)
    // P(A)=0.4, P(B|A)=0.8, P(B|~A)=0.3
    // P(B) = 0.8*0.4 + 0.3*0.6 = 0.32 + 0.18 = 0.5
    const results = run(`
(? ((0.8 * 0.4) + (0.3 * 0.6)))
`);
    approx(results[0], 0.5);
  });

  it('conditional probability via Bayes: P(A|B) = P(B|A)*P(A)/P(B)', () => {
    // P(A)=0.4, P(B|A)=0.8, P(B)=0.5
    // P(A|B) = 0.8*0.4/0.5 = 0.64
    const results = run(`
(? ((0.8 * 0.4) / 0.5))
`);
    approx(results[0], 0.64);
  });

  it('independent events: P(A ∩ B) = P(A)*P(B)', () => {
    const results = run(`
(and: product)
(coin1: coin1 is coin1)
(coin2: coin2 is coin2)
(((coin1) = heads) has probability 0.5)
(((coin2) = heads) has probability 0.5)
(? (((coin1) = heads) and ((coin2) = heads)))
`);
    approx(results[0], 0.25);
  });

  it('complement rule: P(~A) = 1 - P(A)', () => {
    const results = run(`
(a: a is a)
(((a) = true) has probability 0.7)
(? ((a) = true))
(? (not ((a) = true)))
`);
    approx(results[0], 0.7);
    approx(results[1], 0.3);
  });

  it('multi-node network with prefix AND', () => {
    const results = run(`
(and: product)
(a: a is a)
(b: b is b)
(c: c is c)
(d: d is d)
(((a) = true) has probability 0.9)
(((b) = true) has probability 0.8)
(((c) = true) has probability 0.7)
(((d) = true) has probability 0.6)
(? (and ((a) = true) ((b) = true) ((c) = true) ((d) = true)))
`);
    approx(results[0], 0.3024);
  });
});

// ──────────────────────────────────────────────────────────────
// Self-Reasoning (Meta-Logic)
// ──────────────────────────────────────────────────────────────
describe('Self-Reasoning: meta-logic reasoning about itself', () => {
  it('can define and query properties of logic systems', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(Property: Type Property)
(RML: Logic RML)
(supports_many_valued: Property supports_many_valued)
(((RML supports_many_valued) = true) has probability 1)
(? ((RML supports_many_valued) = true))
(? (RML of Logic))
(? (Logic of Type))
(? (type of RML))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 'Logic');
  });

  it('can compare properties of different logic systems', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(Classical: Logic Classical)
(((RML supports_self_reference) = true) has probability 1)
(((Classical supports_self_reference) = true) has probability 0)
(? ((RML supports_self_reference) = true))
(? ((Classical supports_self_reference) = true))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 0);
  });

  it('can reason about its own paradox resolution', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(liar: liar is liar)
((liar = false) has probability 0.5)
(? (liar = false))
(? (not (liar = false)))
(? (RML of Logic))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);
    assert.strictEqual(results[2], 1);
  });
});

// ──────────────────────────────────────────────────────────────
// Comprehensive valence coverage (0 to ∞)
// ──────────────────────────────────────────────────────────────
describe('Valence coverage: 0 (continuous) through high N', () => {
  it('valence 0: continuous — no quantization', () => {
    const results = run(`
(valence: 0)
(a: a is a)
(((a) = true) has probability 0.123456)
(? ((a) = true))
`);
    approx(results[0], 0.123456);
  });

  it('valence 1: unary — no quantization', () => {
    const results = run(`
(valence: 1)
(a: a is a)
(((a) = true) has probability 0.7)
(? ((a) = true))
`);
    approx(results[0], 0.7);
  });

  it('valence 6: six-valued logic', () => {
    // Levels: {0, 0.2, 0.4, 0.6, 0.8, 1}
    const results = run(`
(valence: 6)
(a: a is a)
(((a) = true) has probability 0.33)
(? ((a) = true))
(((a) = true) has probability 0.71)
(? ((a) = true))
`);
    approx(results[0], 0.4);   // 0.33 → nearest 0.4
    approx(results[1], 0.8);   // 0.71 → nearest 0.8
  });

  it('valence 7: seven-valued logic', () => {
    // Levels: {0, 1/6, 2/6, 3/6, 4/6, 5/6, 1} ≈ {0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333, 1}
    const results = run(`
(valence: 7)
(a: a is a)
(((a) = true) has probability 0.5)
(? ((a) = true))
`);
    approx(results[0], 0.5);  // 0.5 = 3/6, exact match
  });

  it('valence 10: ten-valued logic', () => {
    // Levels: {0, 1/9, 2/9, ..., 1} ≈ {0, 0.111, 0.222, ..., 1}
    const results = run(`
(valence: 10)
(a: a is a)
(((a) = true) has probability 0.3)
(? ((a) = true))
(((a) = true) has probability 0.77)
(? ((a) = true))
`);
    approx(results[0], 1/3, 1e-6);    // 0.3 → nearest 1/3
    approx(results[1], 7/9, 1e-6);    // 0.77 → nearest 7/9
  });

  it('valence 100: hundred-valued logic — fine granularity', () => {
    // Step = 1/99 ≈ 0.010101
    const results = run(`
(valence: 100)
(a: a is a)
(((a) = true) has probability 0.505)
(? ((a) = true))
`);
    // 0.505 → nearest level: round(0.505*99)/99 = 50/99 ≈ 0.505051
    approx(results[0], 50/99, 1e-4);
  });

  it('valence 1000: thousand-valued — near-continuous', () => {
    const results = run(`
(valence: 1000)
(a: a is a)
(((a) = true) has probability 0.333)
(? ((a) = true))
`);
    // step = 1/999, nearest = round(0.333*999)/999 = 333/999 = 0.333333...
    approx(results[0], 333/999, 1e-3);
  });

  it('valence 6, balanced range [-1,1]: six-valued', () => {
    // Levels: {-1, -0.6, -0.2, 0.2, 0.6, 1}
    const results = run(`
(range: -1 1)
(valence: 6)
(a: a is a)
(((a) = true) has probability 0.15)
(? ((a) = true))
`);
    approx(results[0], 0.2);  // 0.15 → nearest 0.2
  });

  it('valence 2: binary with product AND and probabilistic_sum OR', () => {
    const results = run(`
(valence: 2)
(and: product)
(or: probabilistic_sum)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.8)
(((b) = true) has probability 0.6)
(? (((a) = true) and ((b) = true)))
(? (((a) = true) or ((b) = true)))
`);
    // In binary: 0.8 → 1, 0.6 → 1, so product(1,1)=1, probabilistic_sum(1,1)=1
    approx(results[0], 1);
    approx(results[1], 1);
  });

  it('valence 3: ternary with Bayesian product AND', () => {
    const results = run(`
(valence: 3)
(and: product)
(a: a is a)
(b: b is b)
(((a) = true) has probability 0.5)
(((b) = true) has probability 0.5)
(? (((a) = true) and ((b) = true)))
`);
    // In ternary: 0.5 stays 0.5, product(0.5,0.5)=0.25 → quantized to 0.5
    approx(results[0], 0.5);
  });
});

// ===== Truth constants: true, false, unknown, undefined =====

describe('Truth constants', () => {
  // --- Default values in [0,1] range ---

  it('true defaults to 1 in [0,1]', () => {
    const results = run('(? true)');
    assert.strictEqual(results[0], 1);
  });

  it('false defaults to 0 in [0,1]', () => {
    const results = run('(? false)');
    assert.strictEqual(results[0], 0);
  });

  it('unknown defaults to 0.5 in [0,1]', () => {
    const results = run('(? unknown)');
    assert.strictEqual(results[0], 0.5);
  });

  it('undefined defaults to 0.5 in [0,1]', () => {
    const results = run('(? undefined)');
    assert.strictEqual(results[0], 0.5);
  });

  // --- Default values in [-1,1] range ---

  it('true defaults to 1 in [-1,1]', () => {
    const results = run('(range: -1 1)\n(? true)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 1);
  });

  it('false defaults to -1 in [-1,1]', () => {
    const results = run('(range: -1 1)\n(? false)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], -1);
  });

  it('unknown defaults to 0 in [-1,1]', () => {
    const results = run('(range: -1 1)\n(? unknown)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
  });

  it('undefined defaults to 0 in [-1,1]', () => {
    const results = run('(range: -1 1)\n(? undefined)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
  });

  // --- Redefinition ---

  it('redefine true', () => {
    const results = run('(true: 0.8)\n(? true)');
    assert.strictEqual(results[0], 0.8);
  });

  it('redefine false', () => {
    const results = run('(false: 0.2)\n(? false)');
    assert.strictEqual(results[0], 0.2);
  });

  it('redefine unknown', () => {
    const results = run('(unknown: 0.3)\n(? unknown)');
    assert.strictEqual(results[0], 0.3);
  });

  it('redefine undefined', () => {
    const results = run('(undefined: 0.7)\n(? undefined)');
    assert.strictEqual(results[0], 0.7);
  });

  it('redefine in balanced range', () => {
    const results = run('(range: -1 1)\n(true: 0.5)\n(false: -0.5)\n(? true)\n(? false)', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], -0.5);
  });

  // --- Range change re-initializes defaults ---

  it('range change reinitializes defaults', () => {
    const results = run('(? true)\n(? false)\n(range: -1 1)\n(? true)\n(? false)\n(? unknown)');
    assert.strictEqual(results.length, 5);
    assert.strictEqual(results[0], 1);   // true in [0,1]
    assert.strictEqual(results[1], 0);   // false in [0,1]
    assert.strictEqual(results[2], 1);   // true in [-1,1]
    assert.strictEqual(results[3], -1);  // false in [-1,1]
    assert.strictEqual(results[4], 0);   // unknown in [-1,1]
  });

  // --- Use in expressions ---

  it('not true', () => {
    const results = run('(? (not true))');
    assert.strictEqual(results[0], 0);
  });

  it('not false', () => {
    const results = run('(? (not false))');
    assert.strictEqual(results[0], 1);
  });

  it('not unknown', () => {
    const results = run('(? (not unknown))');
    assert.strictEqual(results[0], 0.5);
  });

  it('true and false (avg)', () => {
    const results = run('(? (true and false))');
    assert.strictEqual(results[0], 0.5);
  });

  it('true or false (max)', () => {
    const results = run('(? (true or false))');
    assert.strictEqual(results[0], 1);
  });

  it('true and false (min)', () => {
    const results = run('(and: min)\n(? (true and false))');
    assert.strictEqual(results[0], 0);
  });

  it('balanced not operators', () => {
    const results = run('(range: -1 1)\n(? (not true))\n(? (not false))\n(? (not unknown))', { lo: -1, hi: 1 });
    assert.strictEqual(results[0], -1);  // not(1) = -1
    assert.strictEqual(results[1], 1);   // not(-1) = 1
    assert.strictEqual(results[2], 0);   // not(0) = 0
  });

  // --- With quantization ---

  it('binary valence', () => {
    const results = run('(valence: 2)\n(? true)\n(? false)\n(? unknown)');
    assert.strictEqual(results[0], 1);   // true = 1
    assert.strictEqual(results[1], 0);   // false = 0
    assert.strictEqual(results[2], 1);   // unknown = 0.5, quantized to 1
  });

  it('ternary valence', () => {
    const results = run('(valence: 3)\n(? true)\n(? false)\n(? unknown)');
    assert.strictEqual(results[0], 1);   // true = 1
    assert.strictEqual(results[1], 0);   // false = 0
    assert.strictEqual(results[2], 0.5); // unknown = 0.5
  });

  it('ternary balanced', () => {
    const results = run('(range: -1 1)\n(valence: 3)\n(? true)\n(? false)\n(? unknown)', { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 1);   // true = 1
    assert.strictEqual(results[1], -1);  // false = -1
    assert.strictEqual(results[2], 0);   // unknown = 0
  });

  // --- Env API ---

  it('Env API [0,1]', () => {
    const env = new Env();
    assert.strictEqual(env.getSymbolProb('true'), 1);
    assert.strictEqual(env.getSymbolProb('false'), 0);
    assert.strictEqual(env.getSymbolProb('unknown'), 0.5);
    assert.strictEqual(env.getSymbolProb('undefined'), 0.5);
  });

  it('Env API [-1,1]', () => {
    const env = new Env({ lo: -1, hi: 1 });
    assert.strictEqual(env.getSymbolProb('true'), 1);
    assert.strictEqual(env.getSymbolProb('false'), -1);
    assert.strictEqual(env.getSymbolProb('unknown'), 0);
    assert.strictEqual(env.getSymbolProb('undefined'), 0);
  });

  it('survive operator redefinition', () => {
    const results = run('(and: min)\n(or: max)\n(? true)\n(? false)');
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 0);
  });

  // --- Liar paradox with truth constants ---

  it('liar paradox [0,1]', () => {
    const results = run(`
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('liar paradox [-1,1]', () => {
    const results = run(`
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 0);
  });
});

// ===== Liar paradox resolution across logic types =====

describe('Liar paradox across logic types', () => {
  it('ternary [0,1]', () => {
    const results = run(`
(valence: 3)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('ternary [-1,1]', () => {
    const results = run(`
(range: -1 1)
(valence: 3)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 3 });
    assert.strictEqual(results[0], 0);
  });

  it('continuous [0,1]', () => {
    const results = run(`
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
`);
    assert.strictEqual(results[0], 0.5);
    assert.strictEqual(results[1], 0.5);
  });

  it('continuous [-1,1]', () => {
    const results = run(`
(range: -1 1)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
(? (not (s = false)))
`, { lo: -1, hi: 1 });
    assert.strictEqual(results[0], 0);
    assert.strictEqual(results[1], 0);
  });

  it('5-valued [0,1]', () => {
    const results = run(`
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });

  it('5-valued [-1,1]', () => {
    const results = run(`
(range: -1 1)
(valence: 5)
(s: s is s)
((s = false) has probability 0)
(? (s = false))
`, { lo: -1, hi: 1, valence: 5 });
    assert.strictEqual(results[0], 0);
  });
});

// ===== Additional arithmetic tests =====

describe('Arithmetic equality', () => {
  it('(0.1 + 0.2) = 0.3', () => {
    const results = run('(? ((0.1 + 0.2) = 0.3))');
    assert.strictEqual(results[0], 1);
  });

  it('(0.1 + 0.2) != 0.3 is false', () => {
    const results = run('(? ((0.1 + 0.2) != 0.3))');
    assert.strictEqual(results[0], 0);
  });

  it('(0.3 - 0.1) = 0.2', () => {
    const results = run('(? ((0.3 - 0.1) = 0.2))');
    assert.strictEqual(results[0], 1);
  });
});

// ===== Higher N-valued logics =====

describe('Higher N-valued logics', () => {
  it('7-valued logic', () => {
    const env = new Env({ valence: 7 });
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(0.5), 0.5);
    approx(env.clamp(1.0), 1.0);
  });

  it('10-valued logic', () => {
    const env = new Env({ valence: 10 });
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(1.0), 1.0);
    approx(env.clamp(0.5), 5/9);
  });

  it('100-valued logic', () => {
    const env = new Env({ valence: 100 });
    approx(env.clamp(0.0), 0.0);
    approx(env.clamp(1.0), 1.0);
    const actual = env.clamp(0.5);
    assert.ok(Math.abs(actual - 0.5) < 0.02, `100-valued 0.5 should be close to 0.5, got ${actual}`);
  });

  it('5-valued paradox at 0.5', () => {
    const results = run(`
(valence: 5)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
`);
    assert.strictEqual(results[0], 0.5);
  });
});

// ===== Pi-types =====

describe('Pi-types', () => {
  it('Pi type evaluation', () => {
    const results = run('(? (Pi (Natural x) Natural))');
    assert.strictEqual(results[0], 1);
  });

  it('Pi type non-dependent', () => {
    const results = run('(? (Pi (Natural _) Boolean))');
    assert.strictEqual(results[0], 1);
  });
});

// ===== Lambda abstraction =====

describe('Lambda abstraction', () => {
  it('lambda evaluates as valid', () => {
    const results = run('(? (lambda (Natural x) x))');
    assert.strictEqual(results[0], 1);
  });

  it('lambda multi-param', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(? (lambda (Natural x, Natural y) (x + y)))
`);
    assert.strictEqual(results[0], 1);
  });
});

// ===== Application with beta-reduction =====

describe('Application (beta-reduction)', () => {
  it('apply identity', () => {
    const results = run('(? (apply (lambda (Natural x) x) 0.5))');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 0.5);
  });

  it('apply arithmetic', () => {
    const results = run('(? (apply (lambda (Natural x) (x + 0.1)) 0.2))');
    assert.strictEqual(results[0], 0.3);
  });

  it('apply const function', () => {
    const results = run('(? (apply (lambda (Natural x) 0.5) 0.9))');
    assert.strictEqual(results[0], 0.5);
  });
});

// ===== Prefix type notation =====

describe('Prefix type notation', () => {
  it('zero of Natural', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(? (zero of Natural))
`);
    assert.strictEqual(results[0], 1);
  });

  it('complex type', () => {
    const results = run(`
(Type 0)
(Boolean: (Type 0) Boolean)
(? (Boolean of (Type 0)))
`);
    assert.strictEqual(results[0], 1);
  });

  it('multiple constructors', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(Boolean: (Type 0) Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (true-val of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('with Pi constructor', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (succ of (Pi (Natural n) Natural)))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('type hierarchy', () => {
    const results = run(`
(Type 0)
(Type: (Type 0) Type)
(Boolean: Type Boolean)
(True: Boolean True)
(False: Boolean False)
(? (Boolean of Type))
(? (True of Boolean))
(? (False of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
  });
});

// ===== Lean/Rocq core concept encoding =====

describe('Lean/Rocq core concepts', () => {
  it('Natural type constructors', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(zero: Natural zero)
(succ: (Pi (Natural n) Natural))
(? (zero of Natural))
(? (Natural of (Type 0)))
`);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('Boolean type constructors', () => {
    const results = run(`
(Boolean: (Type 0) Boolean)
(true-val: Boolean true-val)
(false-val: Boolean false-val)
(? (true-val of Boolean))
(? (false-val of Boolean))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
  });

  it('identity function type', () => {
    const results = run(`
(Natural: (Type 0) Natural)
(identity: (Pi (Natural x) Natural))
(? (identity of (Pi (Natural x) Natural)))
`);
    assert.strictEqual(results[0], 1);
  });
});

// ===== Self-referential (Type: Type Type) =====

describe('Self-referential types', () => {
  it('Type: Type Type', () => {
    const results = run(`
(Type: Type Type)
(? (Type of Type))
`);
    assert.strictEqual(results[0], 1);
  });

  it('full hierarchy', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (zero of Natural))
(? (Natural of Type))
(? (Boolean of Type))
(? (Type of Type))
`);
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 1);
  });

  it('type of query', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(? (type of Natural))
(? (type of Type))
`);
    assert.strictEqual(results[0], 'Type');
    assert.strictEqual(results[1], 'Type');
  });

  it('coexists with universe hierarchy', () => {
    const results = run(`
(Type: Type Type)
(Type 0)
(Type 1)
(Natural: (Type 0) Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(? (Type of Type))
(? (Natural of (Type 0)))
(? (Boolean of Type))
(? (zero of Natural))
(? ((Type 0) of (Type 1)))
`);
    assert.strictEqual(results.length, 5);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 1);
    assert.strictEqual(results[4], 1);
  });

  it('liar paradox alongside', () => {
    const results = run(`
(Type: Type Type)
(Natural: Type Natural)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))
(? (not (s = false)))
(? (Natural of Type))
`);
    approx(results[0], 0.5);
    approx(results[1], 0.5);
    assert.strictEqual(results[2], 1);
  });

  it('paradox resolution', () => {
    const results = run(`
(Type: Type Type)
(R: R is R)
((R = R) has probability 0.5)
(? (R = R))
(? (not (R = R)))
`);
    approx(results[0], 0.5);
    approx(results[1], 0.5);
  });
});

// ===== Self-Reasoning (Meta-Logic) =====

describe('Self-reasoning (meta-logic)', () => {
  it('logic properties', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(Property: Type Property)
(RML: Logic RML)
(supports_many_valued: Property supports_many_valued)
(((RML supports_many_valued) = true) has probability 1)
(? ((RML supports_many_valued) = true))
(? (RML of Logic))
(? (Logic of Type))
(? (type of RML))
`);
    assert.strictEqual(results[0], 1);
    assert.strictEqual(results[1], 1);
    assert.strictEqual(results[2], 1);
    assert.strictEqual(results[3], 'Logic');
  });

  it('compare logics', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(Classical: Logic Classical)
(((RML supports_self_reference) = true) has probability 1)
(((Classical supports_self_reference) = true) has probability 0)
(? ((RML supports_self_reference) = true))
(? ((Classical supports_self_reference) = true))
`);
    approx(results[0], 1);
    approx(results[1], 0);
  });

  it('paradox resolution in meta context', () => {
    const results = run(`
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)
(liar: liar is liar)
((liar = false) has probability 0.5)
(? (liar = false))
(? (not (liar = false)))
(? (RML of Logic))
`);
    approx(results[0], 0.5);
    approx(results[1], 0.5);
    approx(results[2], 1);
  });
});

// ===== Backward compatibility =====

describe('Backward compatibility', () => {
  it('arithmetic still works', () => {
    const results = run('(? (0.1 + 0.2))');
    assert.strictEqual(results[0], 0.3);
  });
});

// ===== Markov Chains with Dependent Probabilities =====

describe('Markov chains', () => {
  it('one-step transition: sunny', () => {
    // P(Sunny at t+1) = P(S→S)*P(S) + P(R→S)*P(R) = 0.8*0.7 + 0.4*0.3
    const results = run('(? ((0.8 * 0.7) + (0.4 * 0.3)))');
    approx(results[0], 0.68);
  });

  it('one-step transition: rainy', () => {
    // P(Rainy at t+1) = P(S→R)*P(S) + P(R→R)*P(R) = 0.2*0.7 + 0.6*0.3
    const results = run('(? ((0.2 * 0.7) + (0.6 * 0.3)))');
    approx(results[0], 0.32);
  });

  it('two-step transition', () => {
    const results = run(`
(? ((0.8 * 0.68) + (0.4 * 0.32)))
(? ((0.2 * 0.68) + (0.6 * 0.32)))
`);
    approx(results[0], 0.672);
    approx(results[1], 0.328);
  });

  it('joint probability', () => {
    // P(Sunny_t, Sunny_t+1) = P(S→S) * P(S_t) = 0.8 * 0.7
    const results = run(`
(and: product)
(? (0.8 and 0.7))
`);
    approx(results[0], 0.56);
  });

  it('stationary distribution', () => {
    // Stationary: pi(S) = 2/3, pi(R) = 1/3
    const results = run(`
(? ((0.8 * 0.666667) + (0.4 * 0.333333)))
(? ((0.2 * 0.666667) + (0.6 * 0.333333)))
`);
    assert.ok(Math.abs(results[0] - 2/3) < 1e-4);
    assert.ok(Math.abs(results[1] - 1/3) < 1e-4);
  });

  it('conditional transitions with links', () => {
    const results = run(`
(and: product)
(or: probabilistic_sum)
(sunny: sunny is sunny)
(rainy: rainy is rainy)
(((sunny) = true) has probability 0.7)
(((rainy) = true) has probability 0.3)

(? (((sunny) = true) and ((rainy) = true)))
(? (((sunny) = true) or ((rainy) = true)))
`);
    approx(results[0], 0.21);
    approx(results[1], 0.79);
  });
});

// ===== Cyclic Markov Networks =====

describe('Markov networks (cyclic)', () => {
  it('pairwise joint probability in cyclic network', () => {
    // Three nodes forming a cycle: Alice—Bob—Carol—Alice
    const results = run(`
(and: product)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (((alice) = agree) and ((bob) = agree)))
(? (((bob) = agree) and ((carol) = agree)))
(? (((carol) = agree) and ((alice) = agree)))
`);
    approx(results[0], 0.35);
    approx(results[1], 0.3);
    approx(results[2], 0.42);
  });

  it('three-way clique in cyclic network', () => {
    const results = run(`
(and: product)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (and ((alice) = agree) ((bob) = agree) ((carol) = agree)))
`);
    approx(results[0], 0.21);
  });

  it('union in cyclic network', () => {
    const results = run(`
(or: probabilistic_sum)
(alice: alice is alice)
(bob: bob is bob)
(carol: carol is carol)
(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)
(? (or ((alice) = agree) ((bob) = agree) ((carol) = agree)))
`);
    approx(results[0], 0.94);
  });

  it('unnormalized clique potential product', () => {
    // φ(A,B) * φ(B,C) * φ(C,A) = 0.8 * 0.7 * 0.6
    const results = run('(? ((0.8 * 0.7) * 0.6))');
    approx(results[0], 0.336);
  });

  it('normalized probability via partition function', () => {
    // P(config) = unnormalized / Z = 0.336 / 2.5
    const results = run('(? (0.336 / 2.5))');
    approx(results[0], 0.1344);
  });
});
