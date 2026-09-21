// Executable meta-theory acceptance tests for issue #183.
// Mirrors rust/tests/theory_network_tests.rs so both runtimes expose the same
// theory network, unified-address, and self-referential sequence semantics.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DoubletSequenceStore,
  FiniteRelation,
  LinkGraph,
  LinkNetwork,
  MembershipSetStore,
  TheoryNetwork,
  TypedLinkNetwork,
} from '../src/rml-theory-network.mjs';
import { evaluate } from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const corePath = join(repoRoot, 'lib', 'meta-theory', 'core.lino');
const foundationPath = join(repoRoot, 'lib', 'meta-theory', 'foundation.lino');
const virtualRootFile = join(repoRoot, 'inline-meta-theory-test.lino');
const foundationSource = readFileSync(foundationPath, 'utf8');

function networkFrom(source, trustedFoundation = foundationSource) {
  return TheoryNetwork.fromRml(source, trustedFoundation);
}

function bundledNetwork() {
  return networkFrom(readFileSync(corePath, 'utf8'));
}

describe('meta-theory network', () => {
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
    const network = bundledNetwork();

    assert.strictEqual(network.metaLanguageRoundTripOk, true);
    assert.strictEqual(network.trustedFoundationRoundTripOk, true);
    assert.deepStrictEqual(
      network.theoryNames(),
      [
        'graph-theory',
        'links-theory',
        'relational-algebra',
        'relative-meta-logic',
        'set-theory',
        'type-theory',
      ],
    );
  });

  it('makes RML depend on Links Theory and closes the set/type/self cycle', () => {
    const network = bundledNetwork();

    assert.deepStrictEqual(
      network.definitionChain('relative-meta-logic', 'set-theory'),
      ['relative-meta-logic', 'links-theory', 'set-theory'],
    );
    assert.deepStrictEqual(
      network.definitionChain('relative-meta-logic', 'type-theory'),
      ['relative-meta-logic', 'links-theory', 'type-theory'],
    );
    assert.ok(
      network.definitionsFor('links-theory')
        .some(definition => definition.using === 'links-theory'),
      'Links Theory must contain an explicit definition in itself',
    );
    assert.strictEqual(
      network.definitionsFor('set-theory')
        .filter(definition => definition.using === 'links-theory').length,
      2,
      'set theory must have extensional and ordered-sequence link definitions',
    );
    assert.deepStrictEqual(
      network.definitionWitness('rml.definition.links.set-function'),
      {
        address: 'rml.definition.links.set-function',
        kind: 'set-theoretic-function',
        implementation: 'addressed-doublet-network',
        proof: 'rml.proof.links.set-function',
      },
    );
    assert.deepStrictEqual(
      network.definitionVerification('links-by-sets'),
      {
        definition: 'links-by-sets',
        witness: 'rml.definition.links.set-function',
        proof: 'rml.proof.links.set-function',
        implementation: 'addressed-doublet-network',
        kind: 'set-theoretic-function',
        obligations: ['address-function', 'ordered-pair'],
        verified: true,
      },
    );
    assert.deepStrictEqual(
      network.implementation('typed-doublet-network'),
      {
        name: 'typed-doublet-network',
        adapter: 'typed-doublet-network',
        kind: 'dependent-function',
        subject: 'links-theory',
        using: 'type-theory',
        obligations: [
          'reference-typing',
          'dependent-pair',
          'ill-typed-rejection',
          'typed-proof-replay',
        ],
      },
    );
    assert.deepStrictEqual(
      network.definitionsFor('graph-theory').map(definition => definition.using).sort(),
      ['set-theory', 'type-theory'],
    );
    assert.deepStrictEqual(
      network.definitionsFor('relational-algebra').map(definition => definition.using).sort(),
      ['set-theory', 'type-theory'],
    );
    assert.strictEqual(
      network.definitionVerification('graphs-by-finite-sets')?.verified,
      true,
    );
    assert.strictEqual(
      network.definitionVerification('relations-by-types')?.verified,
      true,
    );
  });

  it('maps terms from every theory into a shared concept address', () => {
    const network = bundledNetwork();
    const address = 'rml.concept.addressable-link';

    assert.strictEqual(network.resolveTerm('links-theory', 'link'), address);
    assert.strictEqual(network.resolveTerm('relative-meta-logic', 'expression'), address);
    assert.strictEqual(network.resolveTerm('set-theory', 'reference'), address);
    assert.strictEqual(network.resolveTerm('type-theory', 'term'), address);
    assert.strictEqual(
      network.resolveTerm('links-theory', 'network'),
      'rml.concept.link-network',
    );
    assert.strictEqual(
      network.resolveTerm('graph-theory', 'directed-graph'),
      'rml.concept.directed-graph',
    );
    assert.strictEqual(
      network.resolveTerm('relational-algebra', 'relation-network'),
      'rml.concept.finite-binary-relation',
    );
    assert.deepStrictEqual(network.termsAt(address), [
      { theory: 'graph-theory', term: 'vertex' },
      { theory: 'links-theory', term: 'link' },
      { theory: 'relational-algebra', term: 'element' },
      { theory: 'relative-meta-logic', term: 'expression' },
      { theory: 'set-theory', term: 'reference' },
      { theory: 'type-theory', term: 'term' },
    ]);
    assert.deepStrictEqual(
      network.translateTerm('set-theory', 'reference', 'links-theory'),
      ['link'],
    );
  });

  it('accepts user theories without hard-coded theory names', () => {
    const source = `${readFileSync(corePath, 'utf8')}
(theory user-theory (address user.theory))
(term user-theory entity rml.concept.addressable-link)
(implementation user-theory-network
  (adapter theory-network)
  (kind link-network-composition)
  (subject user-theory)
  (using relative-meta-logic)
  (obligation meta-language-round-trip)
  (obligation definition-link))
(witness user.definition.rml
  (kind link-network-composition)
  (implementation user-theory-network)
  (proof user.proof.rml))
(proof-object user.proof.rml
  (applies verified-theory-definition)
  (premise-by user.capability.theory-network)
  (conclusion
    (user-by-rml defines user-theory using relative-meta-logic
      via user-theory-network as link-network-composition)))
(definition user-by-rml
  (subject user-theory)
  (using relative-meta-logic)
  (witness user.definition.rml))
`;
    const trustedFoundation = `${foundationSource}
(axiom user.capability.theory-network
  (judgement (user-theory-network implements link-network-composition)))
`;
    const network = networkFrom(source, trustedFoundation);

    assert.strictEqual(
      network.resolveTerm('user-theory', 'entity'),
      'rml.concept.addressable-link',
    );
    assert.deepStrictEqual(
      network.definitionChain('user-theory', 'type-theory'),
      ['user-theory', 'relative-meta-logic', 'links-theory', 'type-theory'],
    );
  });

  it('rejects ambiguous term addresses', () => {
    assert.throws(
      () => networkFrom(`
(theory t (address theory.t))
(term t x concept.one)
(term t x concept.two)
`),
      /term t\.x maps to both concept\.one and concept\.two/,
    );
  });

  it('rejects definition links without a declared implementation witness', () => {
    assert.throws(
      () => networkFrom(`
(theory base (address theory.base))
(theory derived (address theory.derived))
(definition derived-by-base
  (subject derived)
  (using base)
  (witness missing.implementation))
`),
      /definition derived-by-base has unknown witness missing\.implementation/,
    );
  });

  it('rejects the bundled network when every definition witness reference is missing', () => {
    const source = readFileSync(corePath, 'utf8').replaceAll(
      /\(witness rml\.definition\.[^)]+\)\)/g,
      '(witness DOES_NOT_EXIST))',
    );
    assert.throws(
      () => networkFrom(source),
      /definition rml-by-links has unknown witness DOES_NOT_EXIST/,
    );
  });

  it('rejects the network when all declared implementations are non-executable', () => {
    const source = readFileSync(corePath, 'utf8').replaceAll(
      /  \(implementation [^\s()]+\)/g,
      '  (implementation DOES_NOT_EXIST)',
    );
    assert.throws(
      () => networkFrom(source),
      /witness rml\.definition\.relative-meta-logic\.links uses unknown implementation DOES_NOT_EXIST/,
    );
  });

  it('rejects an implementation rebound to a different theory definition', () => {
    const source = readFileSync(corePath, 'utf8').replace(
      `(implementation addressed-doublet-network
  (adapter addressed-doublet-network)
  (kind set-theoretic-function)
  (subject links-theory)`,
      `(implementation addressed-doublet-network
  (adapter addressed-doublet-network)
  (kind set-theoretic-function)
  (subject graph-theory)`,
    );
    assert.throws(
      () => networkFrom(source),
      /implementation addressed-doublet-network is declared for graph-theory using set-theory, not links-theory using set-theory/,
    );
  });

  it('rejects an implementation whose declared obligations are incomplete', () => {
    const source = readFileSync(corePath, 'utf8').replace(
      '  (obligation ordered-pair))',
      ')',
    );
    assert.throws(
      () => networkFrom(source),
      /implementation addressed-doublet-network obligations do not match adapter addressed-doublet-network/,
    );
  });

  it('rejects undeclared implementation contract clauses', () => {
    const source = readFileSync(corePath, 'utf8').replace(
      '  (adapter addressed-doublet-network)',
      `  (adapter addressed-doublet-network)
  (unchecked true)`,
    );
    assert.throws(
      () => networkFrom(source),
      /implementation addressed-doublet-network has unsupported clause unchecked/,
    );
  });

  it('rejects typed implementations when a kernel derivation no longer replays', () => {
    const source = readFileSync(corePath, 'utf8').replace(
      '(premise-by rml.type.beta-id-zero)',
      '(premise-by DOES_NOT_EXIST)',
    );
    assert.throws(
      () => networkFrom(source),
      /implementation typed-doublet-network failed typed enforcement or proof replay/,
    );
  });

  it('rejects valid typed witnesses that establish unrelated judgements', () => {
    let source = readFileSync(corePath, 'utf8');
    for (const name of [
      'pi-formation',
      'lambda-introduction',
      'application-elimination',
      'beta-conversion',
    ]) {
      const marker = `(proof-object rml.type.proof.${name}\n`;
      const start = source.indexOf(marker);
      const end = source.indexOf('\n\n', start);
      assert.notStrictEqual(start, -1, `bundled proof object ${name} must exist`);
      assert.notStrictEqual(end, -1, `bundled proof object ${name} must be closed`);
      const replacement = `(proof-object rml.type.proof.${name}
  (applies verified-theory-definition)
  (premise-by rml.capability.addressed-doublet-network)
  (conclusion
    (links-by-sets defines links-theory using set-theory
      via addressed-doublet-network as set-theoretic-function)))`;
      source = source.slice(0, start) + replacement + source.slice(end);
    }

    assert.throws(
      () => networkFrom(source),
      /implementation typed-doublet-network failed typed enforcement or proof replay/,
    );
  });

  it('rejects a witness whose proof object is missing or proves another definition', () => {
    const source = readFileSync(corePath, 'utf8');
    assert.throws(
      () => networkFrom(source.replace(
        '(proof rml.proof.links.set-function)',
        '(proof DOES_NOT_EXIST)',
      )),
      /witness rml\.definition\.links\.set-function has invalid proof DOES_NOT_EXIST: unknown proof-object DOES_NOT_EXIST/,
    );
    assert.throws(
      () => networkFrom(source.replace(
        '(links-by-sets defines links-theory using set-theory',
        '(links-by-sets defines type-theory using set-theory',
      )),
      /proof rml\.proof\.links\.set-function does not establish definition links-by-sets/,
    );
  });

  it('rejects a definition proof after one capability premise is corrupted', () => {
    const source = readFileSync(corePath, 'utf8');
    const trustedFoundation = foundationSource.replace(
      '(addressed-doublet-network implements set-theoretic-function)',
      '(addressed-doublet-network implements WRONG-KIND)',
    );
    assert.throws(
      () => networkFrom(source, trustedFoundation),
      /witness rml\.definition\.links\.set-function has invalid proof .* conclusion does not match rule verified-theory-definition/,
    );
  });

  it('rejects candidates that attempt to authorize their own proofs', () => {
    const source = `${readFileSync(corePath, 'utf8')}
(rule candidate-accepts-anything
  (conclusion
    (forged defines links-theory using set-theory
      via addressed-doublet-network as set-theoretic-function)))
(axiom candidate-capability
  (judgement (addressed-doublet-network implements set-theoretic-function)))
`;

    assert.throws(
      () => networkFrom(source),
      /candidate theory source cannot declare trusted rule forms/,
    );
  });
});

describe('graph theory as a constrained links-network subset', () => {
  it('enforces typed doublet endpoints and records the dependent pair type', () => {
    const links = new TypedLinkNetwork();
    links.declare('source.reference', 'Reference');
    links.declare('source.reference', 'Entity');
    links.declare('target.reference', 'Reference');
    links.declare('wrong.reference', 'Natural');
    links.define(
      'typed.link',
      'source.reference',
      'target.reference',
      'Reference',
      'Reference',
    );

    assert.deepStrictEqual(links.doublet('typed.link'), {
      source: 'source.reference',
      target: 'target.reference',
    });
    assert.strictEqual(links.typeOf('typed.link'), '(Pair Reference Reference)');
    assert.deepStrictEqual(links.typesOf('source.reference'), ['Entity', 'Reference']);
    assert.throws(
      () => links.define(
        'invalid.typed.link',
        'wrong.reference',
        'target.reference',
        'Reference',
        'Reference',
      ),
      /typed link source wrong\.reference has type Natural; expected Reference/,
    );
  });

  it('stores directed graphs as vertex-membership and typed edge links', () => {
    const links = new LinkNetwork();
    links.define('raw.link', 'vertex.a', 'vertex.b');
    assert.deepStrictEqual(
      links.doublet('raw.link'),
      { source: 'vertex.a', target: 'vertex.b' },
    );

    const graph = new LinkGraph('example.graph');
    graph.addVertex('vertex.c');
    graph.addVertex('vertex.a');
    graph.addVertex('vertex.b');
    graph.defineEdge('edge.ab', 'vertex.a', 'vertex.b');
    graph.defineEdge('edge.bc', 'vertex.b', 'vertex.c');

    assert.deepStrictEqual(graph.vertices(), ['vertex.a', 'vertex.b', 'vertex.c']);
    assert.deepStrictEqual(graph.edge('edge.ab'), {
      source: 'vertex.a',
      target: 'vertex.b',
    });
    assert.strictEqual(
      graph.edgeType('edge.ab'),
      '(Pair example.graph.vertex example.graph.vertex)',
    );
    assert.deepStrictEqual(graph.successors('vertex.a'), ['vertex.b']);
    assert.strictEqual(graph.reachable('vertex.a', 'vertex.c'), true);
    assert.strictEqual(graph.reachable('vertex.c', 'vertex.a'), false);
    assert.throws(
      () => graph.defineEdge('edge.invalid', 'vertex.a', 'vertex.missing'),
      /edge target vertex\.missing is not a vertex of example\.graph/,
    );
  });
});

describe('finite relational algebra represented by links', () => {
  it('executes converse, union, intersection, and typed composition', () => {
    const relation = new FiniteRelation(
      'relation.r',
      ['domain.a', 'domain.b'],
      ['middle.x', 'middle.y'],
    );
    relation.define('pair.ax', 'domain.a', 'middle.x');
    relation.define('pair.by', 'domain.b', 'middle.y');
    assert.strictEqual(
      relation.pairType('pair.ax'),
      '(Pair relation.r.domain relation.r.codomain)',
    );

    const extra = new FiniteRelation(
      'relation.extra',
      ['domain.a', 'domain.b'],
      ['middle.x', 'middle.y'],
    );
    extra.define('pair.ay', 'domain.a', 'middle.y');
    extra.define('pair.by.again', 'domain.b', 'middle.y');

    assert.deepStrictEqual(
      relation.converse('relation.converse').pairs(),
      [
        ['middle.x', 'domain.a'],
        ['middle.y', 'domain.b'],
      ],
    );
    assert.deepStrictEqual(
      relation.union(extra, 'relation.union').pairs(),
      [
        ['domain.a', 'middle.x'],
        ['domain.a', 'middle.y'],
        ['domain.b', 'middle.y'],
      ],
    );
    assert.deepStrictEqual(
      relation.intersection(extra, 'relation.intersection').pairs(),
      [['domain.b', 'middle.y']],
    );

    const next = new FiniteRelation(
      'relation.s',
      ['middle.x', 'middle.y'],
      ['codomain.one', 'codomain.two'],
    );
    next.define('pair.x1', 'middle.x', 'codomain.one');
    next.define('pair.y2', 'middle.y', 'codomain.two');
    assert.deepStrictEqual(
      relation.compose(next, 'relation.composed').pairs(),
      [
        ['domain.a', 'codomain.one'],
        ['domain.b', 'codomain.two'],
      ],
    );
    assert.throws(
      () => relation.define('pair.invalid', 'domain.missing', 'middle.x'),
      /relation left value domain\.missing is outside the declared domain/,
    );
  });
});

describe('doublet sequence representation', () => {
  it('executes the independent extensional-membership set interpretation', () => {
    const sets = new MembershipSetStore();
    sets.define('membership.1', 'concept.alpha', 'set.left');
    sets.define('membership.2', 'concept.beta', 'set.left');
    sets.define('membership.3', 'concept.beta', 'set.right');
    sets.define('membership.4', 'concept.alpha', 'set.right');

    assert.strictEqual(sets.has('set.left', 'concept.alpha'), true);
    assert.deepStrictEqual(sets.members('set.left'), ['concept.alpha', 'concept.beta']);
    assert.strictEqual(sets.equals('set.left', 'set.right'), true);
    assert.strictEqual(sets.isSubsetOf('set.left', 'set.right'), true);
    assert.deepStrictEqual(sets.pair('concept.beta', 'concept.alpha'), [
      'concept.alpha',
      'concept.beta',
    ]);

    sets.define('membership.5', 'set.left', 'set.collection');
    sets.define('membership.6', 'set.right', 'set.collection');
    assert.deepStrictEqual(sets.union('set.collection'), [
      'concept.alpha',
      'concept.beta',
    ]);
    assert.deepStrictEqual(
      sets.separation('set.left', member => member.endsWith('beta')),
      ['concept.beta'],
    );
    assert.deepStrictEqual(
      sets.replacement('set.left', member => `${member}.image`),
      ['concept.alpha.image', 'concept.beta.image'],
    );
  });

  it('encodes balanced, left-staircase, and right-staircase trees as links', () => {
    const values = ['concept.alpha', 'concept.beta', 'concept.gamma', 'concept.delta'];

    const balanced = new DoubletSequenceStore();
    const balancedHead = balanced.encodeSequence(values, 'balanced', 'balanced');
    assert.strictEqual(balancedHead, 'balanced.cell.0');
    assert.deepStrictEqual(
      balanced.doublet('balanced.cell.0'),
      { source: 'balanced.cell.1', target: 'balanced.cell.2' },
    );
    assert.deepStrictEqual(
      balanced.doublet('balanced.cell.1'),
      { source: 'concept.alpha', target: 'concept.beta' },
    );
    assert.deepStrictEqual(
      balanced.doublet('balanced.cell.2'),
      { source: 'concept.gamma', target: 'concept.delta' },
    );
    assert.deepStrictEqual(balanced.decodeSequence(balancedHead), values);

    const left = new DoubletSequenceStore();
    const leftHead = left.encodeSequence(values, 'left', 'left');
    assert.deepStrictEqual(left.decodeSequence(leftHead), values);
    assert.deepStrictEqual(
      left.doublet(leftHead),
      { source: 'left.cell.1', target: 'concept.delta' },
    );

    const right = new DoubletSequenceStore();
    const rightHead = right.encodeSequence(values, 'right', 'right');
    assert.deepStrictEqual(right.decodeSequence(rightHead), values);
    assert.deepStrictEqual(
      right.doublet(rightHead),
      { source: 'concept.alpha', target: 'right.cell.1' },
    );
  });

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

    const generated = new DoubletSequenceStore();
    const generatedHead = generated.encodeOrderedSet(
      (function* values() {
        yield 'concept.alpha';
        yield 'concept.beta';
      }()),
      'generated.set',
    );
    assert.deepStrictEqual(
      generated.decodeOrderedSet(generatedHead),
      ['concept.alpha', 'concept.beta'],
    );
  });

  it('canonicalizes an extensional set to one sorted unique link tree', () => {
    const store = new DoubletSequenceStore();
    const head = store.encodeSet(
      ['concept.gamma', 'concept.alpha', 'concept.beta', 'concept.alpha'],
      'example.canonical-set',
    );

    assert.deepStrictEqual(store.decodeSet(head), [
      'concept.alpha',
      'concept.beta',
      'concept.gamma',
    ]);
    assert.deepStrictEqual(
      store.doublet(head),
      { source: 'concept.alpha', target: 'example.canonical-set.cell.1' },
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
