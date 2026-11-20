import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOWERING_KINDS, MONOMORPHIZATION_LIMIT, SURFACE_LOWERING_SCHEMA, lowerSurface } from '../src/rml-surface-lowering.mjs';
import { readCertifiedCorpus, CORPUS_DIRECTORY } from '../../scripts/generate-certified-translations.mjs';

const corpus = readCertifiedCorpus();
const read = path => readFileSync(join(CORPUS_DIRECTORY, path), 'utf8');
const LOWERED = new Set(['rust-records', 'rust-generic', 'lean-structure', 'rocq-record']);

/** Lower and return the refusal, or fail when the program lowers. */
function refusal(source, language) {
  try { lowerSurface(source, language); } catch (error) {
    assert.equal(error.kind, 'unsupported');
    return { construct: error.details.construct, text: source.slice(error.span.start, error.span.end), message: error.reason };
  }
  assert.fail('expected an rml-lowering refusal');
}

describe('RML surface lowering records every rewrite against the original source', () => {
  it('leaves every program without records or type parameters byte-identical', () => {
    for (const item of [...corpus.translations, ...corpus.refusals]) {
      if (LOWERED.has(item.name)) continue;
      const source = read(item.source);
      let lowered;
      try { lowered = lowerSurface(source, item.language); } catch { continue; } // refusals at rml-lowering are covered below
      assert.equal(lowered.changed, false, item.name);
      assert.equal(lowered.text, source, item.name);
      assert.deepEqual(lowered.rewrites, [], item.name);
    }
  });
  it('lowers every record and generic corpus source with known kinds and exact original spans', () => {
    for (const item of corpus.translations.filter(entry => LOWERED.has(entry.name))) {
      const source = read(item.source);
      const lowered = lowerSurface(source, item.language);
      assert.equal(lowered.schema, SURFACE_LOWERING_SCHEMA);
      assert.equal(lowered.changed, true);
      assert.ok(lowered.rewrites.length > 0);
      for (const rewrite of lowered.rewrites) {
        assert.ok(Object.hasOwn(LOWERING_KINDS, rewrite.kind), rewrite.kind);
        assert.ok(rewrite.start >= 0 && rewrite.end <= source.length && rewrite.start < rewrite.end, `${item.name} ${rewrite.kind}`);
        assert.ok(rewrite.kind.startsWith(item.language.toLowerCase()), `${item.name} ${rewrite.kind}`);
      }
    }
  });
  it('a Rust struct becomes a single-variant enum with accessors for the fields read', () => {
    const source = 'struct Point {\n    x: i64,\n    y: i64,\n}\n\nfn main() {\n    let p = Point { x: 3, y: 4 };\n    println!("{}", p.x);\n}\n';
    const lowered = lowerSurface(source, 'Rust');
    assert.match(lowered.text, /enum Point \{\n {4}Point\(i64, i64\),\n\}/u);
    assert.match(lowered.text, /fn rml_point_x\(rml_value: Point\) -> i64/u);
    assert.doesNotMatch(lowered.text, /rml_point_y/u, 'only fields that are read get accessors');
    assert.match(lowered.text, /let p = Point::Point\(3, 4\);/u);
    assert.match(lowered.text, /println!\("\{\}", rml_point_x\(p\)\);/u);
    const texts = Object.fromEntries(lowered.rewrites.map(rewrite => [rewrite.kind, source.slice(rewrite.start, rewrite.end)]));
    assert.equal(texts['rust-struct-literal'], 'Point { x: 3, y: 4 }');
    assert.equal(texts['rust-field-read'], 'p.x');
    const literal = lowered.text.indexOf('Point::Point(3, 4)');
    assert.deepEqual(lowered.map({ start: literal, end: literal + 'Point::Point(3, 4)'.length }),
      { start: source.indexOf('Point { x: 3'), end: source.indexOf('Point { x: 3') + 'Point { x: 3, y: 4 }'.length });
    const println = lowered.text.indexOf('println');
    assert.deepEqual(lowered.map({ start: println, end: println + 7 }), { start: source.indexOf('println'), end: source.indexOf('println') + 7 });
  });
  it('struct patterns fill omitted fields with wildcards and struct variants become tuple variants', () => {
    const source = 'enum Shape {\n    Rect { w: i64, h: i64 },\n}\n\nfn width(s: Shape) -> i64 {\n    match s {\n        Shape::Rect { h: _, .. } => 0,\n    }\n}\n\nfn main() {}\n';
    const lowered = lowerSurface(source, 'Rust');
    assert.match(lowered.text, /Rect\(i64, i64\),/u);
    assert.match(lowered.text, /Shape::Rect\(_, _\) => 0/u);
  });
  it('a tuple-struct index reads through an accessor only when the receiver is annotated', () => {
    const source = 'struct Pair(i64, i64);\n\nfn main() {\n    let pair: Pair = Pair(1, 2);\n    println!("{}", pair.1);\n}\n';
    const lowered = lowerSurface(source, 'Rust');
    assert.match(lowered.text, /let pair: Pair = Pair::Pair\(1, 2\);/u);
    assert.match(lowered.text, /rml_pair_1\(pair\)/u);
  });
  it('explicit Rust instantiations are monomorphized under fresh names', () => {
    const source = 'fn ident<T>(value: T) -> T {\n    value\n}\n\nfn main() {\n    println!("{}", ident::<i64>(3));\n    println!("{}", ident::<bool>(true));\n}\n';
    const lowered = lowerSurface(source, 'Rust');
    assert.match(lowered.text, /fn ident_i64\(value: i64\) -> i64/u);
    assert.match(lowered.text, /fn ident_bool\(value: bool\) -> bool/u);
    assert.doesNotMatch(lowered.text, /<T>/u);
    assert.deepEqual(lowered.rewrites.map(rewrite => rewrite.kind).sort(), ['rust-instantiation', 'rust-instantiation', 'rust-monomorphize']);
  });
  it('Lean structures and Rocq records become inductives with projections', () => {
    const lean = lowerSurface('structure P where\n  a : Nat\n  b : Nat\n\ndef main : IO Unit := do\n  IO.println ({ b := 2, a := 1 } : P).a\n', 'Lean');
    assert.match(lean.text, /inductive P where\n {2}\| mk : Nat → Nat → P/u);
    assert.match(lean.text, /def a : P → Nat\n {2}\| P\.mk ml_field _ => ml_field/u);
    assert.match(lean.text, /P\.a \(\(P\.mk 1 2\)/u);
    const rocq = lowerSurface('Record r : Type := { f : nat; g : nat }.\nDefinition v : nat := {| g := 1; f := 2 |}.(f).\n', 'Rocq');
    assert.match(rocq.text, /Inductive r : Type :=\n {2}\| Build_r : nat -> nat -> r\./u);
    assert.match(rocq.text, /\(f \(Build_r 2 1\)\)/u);
  });
  it('JavaScript has no lowering pass', () => {
    const source = 'const point = { x: 1 };\nconsole.log(point.x);\n';
    assert.deepEqual(lowerSurface(source, 'JavaScript').rewrites, []);
  });
});

describe('RML surface lowering refuses what needs inference or changes evaluation', () => {
  it('refuses struct literals written out of declaration order', () => {
    const found = refusal('struct P {\n    a: i64,\n    b: i64,\n}\n\nfn main() {\n    let p = P { b: 1, a: 2 };\n}\n', 'Rust');
    assert.equal(found.construct, 'struct literal fields out of declaration order');
    assert.equal(found.text, 'P { b: 1, a: 2 }');
  });
  it('refuses unit structs, functional update and ambiguous field reads', () => {
    assert.equal(refusal('struct Unit;\n\nfn main() {}\n', 'Rust').construct, 'unit struct');
    assert.equal(refusal(read('refusals/rust-struct-update.rs'), 'Rust').text, '..origin');
    assert.equal(refusal(read('refusals/rust-ambiguous-field.rs'), 'Rust').text, '.x');
  });
  it('refuses generic items that are never explicitly instantiated, and generic values without type arguments', () => {
    assert.equal(refusal('enum Maybe<T> {\n    Nothing,\n    Just(T),\n}\n\nfn main() {}\n', 'Rust').construct, 'generic item without explicit instantiation');
    const value = refusal('enum Maybe<T> {\n    Nothing,\n    Just(T),\n}\n\nfn f(m: Maybe<i64>) -> i64 {\n    0\n}\n\nfn main() {\n    println!("{}", f(Maybe::Nothing));\n}\n', 'Rust');
    assert.equal(value.construct, 'value of a generic type without explicit instantiation');
    assert.equal(value.text, 'Maybe');
    assert.equal(refusal(read('refusals/rust-generic-function.rs'), 'Rust').construct, 'generic call without explicit instantiation');
  });
  it('refuses lifetimes, trait bounds and instantiation explosions', () => {
    assert.equal(refusal("fn first<'a>(x: &'a i64) -> i64 {\n    0\n}\n\nfn main() {}\n", 'Rust').construct, 'lifetime parameter');
    assert.equal(refusal(read('refusals/rust-trait-bound.rs'), 'Rust').text, 'T: PartialOrd');
    const calls = Array.from({ length: MONOMORPHIZATION_LIMIT + 1 }, (_, index) => `    println!("{}", ident::<T${index}>(0));`).join('\n');
    assert.equal(refusal(`fn ident<T>(value: T) -> T {\n    value\n}\n\nfn main() {\n${calls}\n}\n`, 'Rust').construct, 'instantiation limit');
  });
  it('refuses generated-name collisions instead of shadowing user code', () => {
    const found = refusal('struct P {\n    a: i64,\n}\n\nfn rml_p_a(x: i64) -> i64 {\n    x\n}\n\nfn main() {\n    let p = P { a: 1 };\n    println!("{}", p.a);\n}\n', 'Rust');
    assert.equal(found.construct, 'generated name collision');
  });
  it('refuses Lean structure updates, defaults, universe parameters and un-annotated generic constructors', () => {
    assert.equal(refusal('structure P where\n  a : Nat\n\ndef f (p : P) : P := { p with a := 1 }\n', 'Lean').construct, 'structure update');
    assert.equal(refusal(read('refusals/lean-structure-default.lean'), 'Lean').text, ':= 10');
    assert.equal(refusal(read('refusals/lean-universe-polymorphism.lean'), 'Lean').text, '(α : Type u)');
    const value = refusal('inductive Box (α : Type) where\n  | wrap : α → Box α\n\ndef unwrap (b : Box Nat) : Nat :=\n  match b with\n  | Box.wrap n => n\n\ndef main : IO Unit := do\n  IO.println (unwrap (Box.wrap 3))\n', 'Lean');
    assert.equal(value.construct, 'value of a generic type without explicit instantiation');
    assert.equal(value.text, 'Box.wrap');
  });
  it('refuses dependent Rocq record fields and Rocq constructors applied without their type parameter', () => {
    assert.equal(refusal(read('refusals/rocq-dependent-record.v'), 'Rocq').construct, 'dependent record field');
    const value = refusal('Inductive box (A : Type) : Type :=\n  | wrap : A -> box A.\n\nDefinition v : box nat := wrap 3.\n', 'Rocq');
    assert.equal(value.construct, 'constructor without its parameters');
    // Rocq rejects a constructor pattern that omits an explicit parameter, so RML does too.
    const pattern = 'Inductive box (A : Type) : Type :=\n  | wrap : A -> box A.\n\nDefinition get (b : box nat) : nat := match b with\n  | wrap x => x\n  end.\n';
    assert.equal(refusal(pattern, 'Rocq').construct, 'constructor pattern without its parameters');
    assert.doesNotThrow(() => lowerSurface(pattern.replace('| wrap x', '| wrap _ x'), 'Rocq'));
  });
});
