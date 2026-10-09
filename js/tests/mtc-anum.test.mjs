// MTC/anum experimental foundation profile tests (issue #97, Phase 9).
//
// The `mtc-anum` foundation is pre-seeded but opt-in. Activating it does
// not rewire host arithmetic — it is metadata plus a four-abit
// serialization alphabet (`[`, `]`, `0`, `1`). The trust audit surfaces
// the profile with its `[experimental]` tag, root symbol, and abit list.
// `encodeAnum` / `decodeAnum` round-trip arbitrary Node values through
// strings written only in that alphabet.
//
// See: https://github.com/link-foundation/relative-meta-logic/issues/97
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  Env,
  evaluate,
  evaluateFile,
  formatFoundationReport,
  encodeAnum,
  decodeAnum,
  parseLinoForms,
} from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const theoryExamplePath = join(repoRoot, 'examples', 'mtc-anum-theory.lino');

describe('mtc-anum experimental foundation', () => {
  it('is pre-seeded but never activated implicitly', () => {
    const env = new Env();
    assert.ok(env.foundations.has('mtc-anum'), 'mtc-anum should be pre-seeded');
    assert.strictEqual(env.activeFoundation, 'default-rml',
      'default-rml stays the active foundation');
  });

  it('does not perturb baseline semantics when not selected', () => {
    // The pre-seeded mtc-anum profile is opt-in. A clean session should
    // continue to report the default-rml foundation and produce the same
    // query results it always did.
    const plain = evaluate('(? (1 + 2))');
    assert.deepStrictEqual(plain.diagnostics, []);
    assert.strictEqual(plain.results.length, 1);
    const env = new Env();
    assert.strictEqual(env.activeFoundation, 'default-rml');
  });

  it('surfaces the experimental flag, root, and abits on foundation report', () => {
    const env = new Env();
    const report = env.foundationReport();
    const mtc = report.foundations.find(f => f.name === 'mtc-anum');
    assert.ok(mtc, 'mtc-anum should appear in foundations');
    assert.strictEqual(mtc.experimental, true);
    assert.strictEqual(mtc.root, '∞');
    assert.ok(Array.isArray(mtc.abits));
    const symbols = mtc.abits.map(a => a.symbol).sort();
    assert.deepStrictEqual(symbols, ['0', '1', '[', ']']);
  });

  it('renders the experimental tag and abits in the printed report', () => {
    const env = new Env();
    const printed = formatFoundationReport(env.foundationReport());
    assert.match(printed, /mtc-anum \[experimental\]/);
    assert.match(printed, /root: ∞/);
    assert.match(printed, /abits: .*\[=start-of-meaning/);
  });

  it('accepts `(experimental)`, `(root ...)`, and `(abit ...)` parser clauses', () => {
    const env = new Env();
    const out = evaluate(`
(foundation toy-mtc
  (description "a toy mtc-style profile")
  (experimental)
  (root ★)
  (abit ▲ up)
  (abit ▼ down))
`, { env });
    assert.deepStrictEqual(out.diagnostics, []);
    const f = env.foundations.get('toy-mtc');
    assert.ok(f, 'toy-mtc should be registered');
    assert.strictEqual(f.experimental, true);
    assert.strictEqual(f.root, '★');
    assert.deepStrictEqual(
      f.abits.map(a => a.symbol),
      ['▲', '▼'],
    );
  });

  it('encodes and decodes leaf strings round-trip', () => {
    const cases = ['x', 'hello', '+', '∞', ''];
    for (const c of cases) {
      const enc = encodeAnum(c);
      // Only the four abits should ever appear in the encoded form.
      assert.match(enc, /^[\[\]01]+$/, `encoding of ${JSON.stringify(c)} not in alphabet`);
      assert.deepStrictEqual(decodeAnum(enc), c);
    }
  });

  it('encodes and decodes lists round-trip', () => {
    const cases = [
      [],
      ['a', 'b'],
      ['+', '1', '2'],
      ['lambda', ['x'], ['+', 'x', '1']],
    ];
    for (const c of cases) {
      const enc = encodeAnum(c);
      assert.match(enc, /^[\[\]01]+$/);
      assert.deepStrictEqual(decodeAnum(enc), c);
    }
  });

  it('round-trips a real parsed link form', () => {
    const parsed = parseLinoForms('(? (1 + 2))')[0];
    assert.deepStrictEqual(parsed, ['?', ['1', '+', '2']]);
    const enc = encodeAnum(parsed);
    assert.match(enc, /^[\[\]01]+$/);
    assert.deepStrictEqual(decodeAnum(enc), parsed);
  });

  it('decodeAnum rejects characters outside the four-abit alphabet', () => {
    assert.throws(() => decodeAnum('[0AB]'), err => err.code === 'E066');
    assert.throws(() => decodeAnum('[2]'), err => err.code === 'E066');
    assert.throws(() => decodeAnum('xyz'), err => err.code === 'E066');
  });

  it('decodeAnum rejects unbalanced frames', () => {
    assert.throws(() => decodeAnum('[0'), err => err.code === 'E066');
    assert.throws(() => decodeAnum('[1[0]'), err => err.code === 'E066');
    assert.throws(() => decodeAnum('[0]extra'), err => err.code === 'E066');
  });

  it('decodeAnum rejects misaligned leaf payloads', () => {
    // 7 bits — not byte-aligned.
    assert.throws(() => decodeAnum('[0' + '0101010' + ']'), err => err.code === 'E066');
  });

  it('encodeAnum rejects non-Node values', () => {
    assert.throws(() => encodeAnum(undefined), err => err.code === 'E066');
    assert.throws(() => encodeAnum(null), err => err.code === 'E066');
    assert.throws(() => encodeAnum({ a: 1 }), err => err.code === 'E066');
  });

  // --- Serialization invariants (issue #97, Phase 9 strengthening) ---
  //
  // The acceptance criteria from PR review "Blocking issue 7" ask for
  // stated invariants and explicit tests for the canonicality and
  // injectivity of `encodeAnum`/`decodeAnum`. The three properties
  // below — canonicality, injectivity, totality — together establish
  // that the four-abit alphabet is a faithful serialization domain.

  it('encodeAnum is canonical: repeated encoding yields the same string', () => {
    const samples = [
      '',
      'x',
      '∞',
      [],
      ['a', 'b'],
      ['lambda', ['x'], ['+', 'x', '1']],
      ['frame', ['pair', '∞', ['frame', '∞']]],
      parseLinoForms('(check-proof t)')[0],
    ];
    for (const x of samples) {
      const a = encodeAnum(x);
      const b = encodeAnum(x);
      assert.strictEqual(a, b, `canonicality failed for ${JSON.stringify(x)}`);
    }
  });

  it('encodeAnum is injective: distinct inputs encode to distinct strings', () => {
    // A sample of structurally distinct Node values. The decode round-
    // trip below additionally proves the encodings cannot collide
    // (because a collision would force one of them to decode wrong).
    const samples = [
      '',
      'a',
      'b',
      'ab',
      'ba',
      '∞',
      '[',
      ']',
      [],
      ['a'],
      ['a', 'b'],
      ['b', 'a'],
      [['a']],
      ['frame', '∞'],
      ['pair', '∞', '∞'],
      ['pair', '∞', ['frame', '∞']],
    ];
    const seen = new Map();
    for (const x of samples) {
      const enc = encodeAnum(x);
      const key = JSON.stringify(x);
      // Collision detection: if two distinct inputs ever produced the
      // same encoded string, fail loudly with both offenders.
      if (seen.has(enc)) {
        assert.fail(
          `injectivity violated: ${key} and ${JSON.stringify(seen.get(enc))} both encode to ${enc}`,
        );
      }
      seen.set(enc, x);
    }
    // Totality: every encoding must decode back to the original input.
    for (const x of samples) {
      assert.deepStrictEqual(decodeAnum(encodeAnum(x)), x);
    }
  });

  // --- Theory replay (issue #97, Phase 9 strengthening) ---
  //
  // The acceptance criteria also require at least one non-trivial MTC
  // theorem/rule replay through the proof substrate. The example
  // `examples/mtc-anum-theory.lino` declares three theory rules
  // (root-is-link, frame-makes-link, pair-makes-link) and three
  // proof-objects that build a composite link from them. The test
  // below pins down the example end-to-end and one of the rules in
  // isolation, plus a negative case verifying the substrate rejects a
  // derivation whose conclusion does not match the rule.

  it('runs the MTC theory example end-to-end with no diagnostics', () => {
    const out = evaluateFile(theoryExamplePath);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [1, 1, 1]);
  });

  it('frame-makes-link types a single frame over the root link', () => {
    const out = evaluate(`
(axiom root-is-link
  (judgement (∞ is-a link)))

(rule frame-makes-link
  (premise (?x is-a link))
  (conclusion ((frame ?x) is-a link)))

(proof-object framed-root-is-link
  (applies frame-makes-link)
  (premise-by root-is-link)
  (conclusion ((frame ∞) is-a link)))

(check-proof framed-root-is-link)
`);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [1]);
  });

  it('rejects an MTC derivation whose conclusion swaps the rule shape', () => {
    // The rule produces `(frame x) is-a link`, not `(unframe x) is-a
    // link`; a derivation that names a different head must fail.
    const out = evaluate(`
(axiom root-is-link
  (judgement (∞ is-a link)))

(rule frame-makes-link
  (premise (?x is-a link))
  (conclusion ((frame ?x) is-a link)))

(proof-object misframed
  (applies frame-makes-link)
  (premise-by root-is-link)
  (conclusion ((unframe ∞) is-a link)))

(check-proof misframed)
`);
    assert.deepStrictEqual(out.results, [0]);
    assert.ok(out.diagnostics.some(d => d.code === 'E064'));
  });

  // --- Theory / serialization domain boundary ---
  //
  // The pre-seeded `mtc-anum` foundation reads as one bundle but is
  // really two domains: a theory domain (links, frames, pairs) and a
  // serialization domain (the four-abit alphabet). The companion
  // example pins the distinction down in prose; the test below pins
  // it down as a runtime check so the boundary cannot quietly fade.

  it('makes the theory/serialization boundary explicit', () => {
    const source = readFileSync(theoryExamplePath, 'utf8');
    assert.match(source, /THEORY domain/);
    assert.match(source, /SERIALIZATION domain/);
    // A theory rule must be a links-defined inference rule.
    assert.match(source, /\(rule frame-makes-link/);
    // The four-abit alphabet is the *serialization* alphabet,
    // unrelated to which links the theory recognises.
    const env = new Env();
    const mtc = env.foundationReport().foundations.find(f => f.name === 'mtc-anum');
    const abits = mtc.abits.map(a => a.symbol).sort();
    assert.deepStrictEqual(abits, ['0', '1', '[', ']']);
  });
});
