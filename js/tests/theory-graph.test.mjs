// Executable meta-theory acceptance tests for issue #183.
// Mirrors rust/tests/theory_graph_tests.rs so both runtimes expose the same
// theory graph, unified-address, and self-referential sequence semantics.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DoubletSequenceStore,
  TheoryGraph,
} from '../src/rml-theory-graph.mjs';
import { evaluate } from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const corePath = join(repoRoot, 'lib', 'meta-theory', 'core.lino');
const virtualRootFile = join(repoRoot, 'inline-meta-theory-test.lino');

function bundledGraph() {
  return TheoryGraph.fromRml(readFileSync(corePath, 'utf8'));
}

describe('meta-theory graph', () => {
  it('expands the doublet and derived triplet definitions through an import', () => {
    const out = evaluate(`
(import "lib/meta-theory/core.lino" as mt)
(? ((mt.doublet pair left right) =
     (pair maps-to (left right))))
(? ((mt.triplet statement subject relation object) =
     (statement maps-to (subject (relation object)))))
(? (mt.same-address
     rml.concept.addressable-link
     rml.concept.addressable-link))
`, { file: virtualRootFile });

    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [1, 1, 1]);
  });

  it('loads the bundled theory network losslessly through meta-language', () => {
    const graph = bundledGraph();

    assert.strictEqual(graph.metaLanguageRoundTripOk, true);
    assert.deepStrictEqual(
      graph.theoryNames(),
      ['links-theory', 'relative-meta-logic', 'set-theory', 'type-theory'],
    );
  });

  it('makes RML depend on Links Theory and closes the set/type/self cycle', () => {
    const graph = bundledGraph();

    assert.deepStrictEqual(
      graph.definitionPath('relative-meta-logic', 'set-theory'),
      ['relative-meta-logic', 'links-theory', 'set-theory'],
    );
    assert.deepStrictEqual(
      graph.definitionPath('relative-meta-logic', 'type-theory'),
      ['relative-meta-logic', 'links-theory', 'type-theory'],
    );
    assert.ok(
      graph.definitionsFor('links-theory')
        .some(definition => definition.using === 'links-theory'),
      'Links Theory must contain an explicit definition in itself',
    );
    assert.strictEqual(
      graph.definitionsFor('set-theory')
        .filter(definition => definition.using === 'links-theory').length,
      2,
      'set theory must have extensional and ordered-sequence link definitions',
    );
  });

  it('maps terms from every theory into a shared concept address', () => {
    const graph = bundledGraph();
    const address = 'rml.concept.addressable-link';

    assert.strictEqual(graph.resolveTerm('links-theory', 'link'), address);
    assert.strictEqual(graph.resolveTerm('relative-meta-logic', 'expression'), address);
    assert.strictEqual(graph.resolveTerm('set-theory', 'reference'), address);
    assert.strictEqual(graph.resolveTerm('type-theory', 'term'), address);
    assert.deepStrictEqual(graph.termsAt(address), [
      { theory: 'links-theory', term: 'link' },
      { theory: 'relative-meta-logic', term: 'expression' },
      { theory: 'set-theory', term: 'reference' },
      { theory: 'type-theory', term: 'term' },
    ]);
  });

  it('accepts user theories without hard-coded theory names', () => {
    const source = `${readFileSync(corePath, 'utf8')}
(theory user-theory (address user.theory))
(term user-theory entity rml.concept.addressable-link)
(definition user-by-rml
  (subject user-theory)
  (using relative-meta-logic)
  (witness user.definition.rml))
`;
    const graph = TheoryGraph.fromRml(source);

    assert.strictEqual(
      graph.resolveTerm('user-theory', 'entity'),
      'rml.concept.addressable-link',
    );
    assert.deepStrictEqual(
      graph.definitionPath('user-theory', 'type-theory'),
      ['user-theory', 'relative-meta-logic', 'links-theory', 'type-theory'],
    );
  });

  it('rejects ambiguous term addresses', () => {
    assert.throws(
      () => TheoryGraph.fromRml(`
(theory t (address theory.t))
(term t x concept.one)
(term t x concept.two)
`),
      /term t\.x maps to both concept\.one and concept\.two/,
    );
  });
});

describe('doublet sequence representation', () => {
  it('round-trips an ordered set as nested doublets without duplicates', () => {
    const store = new DoubletSequenceStore();
    const head = store.encodeOrderedSet(
      ['concept.alpha', 'concept.beta', 'concept.gamma'],
      'example.set',
    );

    assert.deepStrictEqual(store.decodeOrderedSet(head), [
      'concept.alpha',
      'concept.beta',
      'concept.gamma',
    ]);
    assert.throws(
      () => store.encodeOrderedSet(['concept.alpha', 'concept.alpha'], 'duplicate.set'),
      /ordered set contains duplicate concept\.alpha/,
    );
    assert.throws(
      () => store.encodeOrderedSet(['concept.alpha'], ''),
      /ordered set address must be a non-empty reference/,
    );
  });

  it('unfolds direct self-reference only to the requested finite prefix', () => {
    const store = new DoubletSequenceStore();
    store.define('repeat.alpha', 'concept.alpha', 'repeat.alpha');

    assert.deepStrictEqual(store.walk('repeat.alpha', 1), {
      values: ['concept.alpha'],
      complete: false,
      cyclic: true,
      cycleAt: 0,
    });
    assert.deepStrictEqual(store.walk('repeat.alpha', 4), {
      values: ['concept.alpha', 'concept.alpha', 'concept.alpha', 'concept.alpha'],
      complete: false,
      cyclic: true,
      cycleAt: 0,
    });
  });

  it('unfolds indirect self-reference and reports its cycle', () => {
    const store = new DoubletSequenceStore();
    store.define('alternating.a', 'concept.alpha', 'alternating.b');
    store.define('alternating.b', 'concept.beta', 'alternating.a');

    assert.strictEqual(store.walk('alternating.a', 2).cyclic, true);
    assert.deepStrictEqual(store.walk('alternating.a', 5), {
      values: [
        'concept.alpha',
        'concept.beta',
        'concept.alpha',
        'concept.beta',
        'concept.alpha',
      ],
      complete: false,
      cyclic: true,
      cycleAt: 0,
    });
    assert.throws(
      () => store.decodeOrderedSet('alternating.a'),
      /ordered set must be finite; alternating\.a is cyclic/,
    );
  });
});
