// Executable meta-theory acceptance tests for issue #183.
// Mirrors rust/tests/theory_network_tests.rs so both runtimes expose the same
// theory network, unified-address, and self-referential sequence semantics.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import {
  DoubletSequenceStore,
  FiniteRelation,
  LinkGraph,
  LinkNetwork,
  MembershipSetStore,
  TheoryNetwork,
  TypedLinkNetwork,
} from '../src/rml-theory-network.mjs';
import { FormalCorpus } from '../src/rml-formal-corpus.mjs';
import { evaluate } from '../src/rml-links.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const corePath = join(repoRoot, 'lib', 'meta-theory', 'core.lino');
const universalPath = join(repoRoot, 'lib', 'meta-theory', 'universal.lino');
const foundationPath = join(repoRoot, 'lib', 'meta-theory', 'foundation.lino');
const virtualRootFile = join(repoRoot, 'inline-meta-theory-test.lino');
const foundationSource = readFileSync(foundationPath, 'utf8');
const universalSource = readFileSync(universalPath, 'utf8');
const upstreamCorpusPath = join(repoRoot, 'lib', 'meta-theory', 'upstream-0.0.3.lino');
const upstreamCorpusFoundationPath = join(
  repoRoot,
  'lib',
  'meta-theory',
  'upstream-0.0.3-foundation.lino',
);

function networkFrom(source, trustedFoundation = foundationSource) {
  return TheoryNetwork.fromRml(`${universalSource}\n${source}`, trustedFoundation);
}

function bundledNetwork() {
  return networkFrom(readFileSync(corePath, 'utf8'));
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('meta-theory network', () => {
  it('accounts for the complete pinned Lean and Rocq declaration corpus', () => {
    const corpus = FormalCorpus.fromRml(
      readFileSync(upstreamCorpusPath, 'utf8'),
      readFileSync(upstreamCorpusFoundationPath, 'utf8'),
    );

    assert.strictEqual(corpus.metaLanguageRoundTripOk, true);
    assert.strictEqual(corpus.trustedFoundationRoundTripOk, true);
    assert.strictEqual(corpus.revision, '087f4515d0652925eecc54bcade724445c3978f1');
    assert.strictEqual(corpus.schema, 'linked-source-v1');
    assert.strictEqual(corpus.formalModules.length, 18);
    assert.strictEqual(corpus.declarations.length, 229);
    assert.strictEqual(corpus.semanticTokenCount, 8815);
    assert.strictEqual(corpus.dependencyCount, 510);
    assert.deepStrictEqual(corpus.languages(), ['lean', 'rocq']);
    assert.deepStrictEqual(corpus.modules('lean'), [
      'MetaDefinitions',
      'NetworkConversions',
      'NetworkDefinitions',
      'NetworkEquivalence',
      'NetworkExamples',
      'NetworkLemmas',
      'SequenceDefinitions',
      'SetDefinitions',
      'SetSequenceEquivalence',
    ]);
    assert.deepStrictEqual(
      corpus.declarations.filter(declaration => declaration.proofStatus === 'admitted')
        .map(declaration => `${declaration.language}.${declaration.symbol}`),
      [
        'lean.insertSorted_preserves_ascending',
        'lean.mem_insertSorted',
        'lean.mem_toOrderedUnique',
        'lean.strictly_ascending_implies_no_dup',
      ],
    );
    const balanced = corpus.declaration('lean', 'SequenceDefinitions', 'ListToBalancedTree');
    assert.strictEqual(balanced.recursive, true);
    assert.ok(balanced.signature.map(token => token.text).includes('Option'));
    assert.ok(balanced.body.map(token => token.text).includes('ListToBalancedTree'));
    assert.ok(balanced.dependencies.includes(balanced.address));

    const readSequence = corpus.declaration('lean', 'SequenceDefinitions', 'ReadSequence_');
    assert.strictEqual(readSequence.recursive, true);
    assert.ok(readSequence.body.map(token => token.text).includes('ReadSequence_'));

    const theorem = corpus.declaration(
      'lean',
      'SetSequenceEquivalence',
      'set_sequence_equivalence',
    );
    assert.ok(theorem.signature.map(token => token.text).includes('∃'));
    assert.ok(theorem.proof.map(token => token.text).includes('mem_toOrderedUnique'));
    assert.ok(theorem.dependencies.includes(
      'rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending',
    ));
    assert.strictEqual(
      corpus.counterpart(theorem).address,
      'rml.formal.rocq.SetSequenceEquivalence.set_sequence_equivalence',
    );
    assert.ok(corpus.dependencyClosure(theorem.address).includes(
      'rml.formal.lean.SetSequenceEquivalence.insertSorted',
    ));

    const rocqProof = corpus.declaration(
      'rocq',
      'MetaDefinitions',
      'meta_network_is_duplet_network',
    );
    assert.deepStrictEqual(
      rocqProof.proof.slice(0, 2).map(token => token.text),
      ['Proof', '.'],
    );
  });

  it('rejects an incomplete or self-authorized formal corpus', () => {
    const source = readFileSync(upstreamCorpusPath, 'utf8');
    const foundation = readFileSync(upstreamCorpusFoundationPath, 'utf8');
    const omitted = source.replace(
      /\n  \(declaration definition ReferenceDefault\n(?:    .*\n)*?  \)\n/,
      '\n',
    );
    assert.throws(
      () => FormalCorpus.fromRml(omitted, foundation),
      /unknown dependency|declaration count 228 does not match trusted count 229/,
    );
    const changedBody = source.replace(
      /(formal-module meta-theory-0\.0\.3 lean NetworkDefinitions[\s\S]*?)(\(token numeral )30(\))/,
      (_match, prefix, open, close) => `${prefix}${open}31${close}`,
    );
    assert.notStrictEqual(changedBody, source);
    assert.throws(
      () => FormalCorpus.fromRml(changedBody, foundation),
      /fingerprint .* does not match trusted fingerprint/,
    );
    assert.throws(
      () => FormalCorpus.fromRml(`${source}\n${foundation}`, foundation),
      /candidate formal corpus cannot declare trusted formal-corpus-contract forms/,
    );
  });

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
        contract: 'typed-doublet-network',
        program: 'dependent-type-theory',
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
  (contract theory-network)
  (program links-meta-theory)
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

  it('accepts user-defined linked semantics without host source changes', () => {
    const source = `
(linked-program user-counter-program)
(linked-rewrite user-counter-program evaluate-linked-contract
  (from (counter (successor ?value)))
  (to ?value))
(theory source-theory (address user.source-theory))
(theory target-theory (address user.target-theory))
(term source-theory entity user.concept.entity)
(term target-theory entity user.concept.entity)
(implementation user-counter
  (contract user-counter-contract)
  (program user-counter-program)
  (kind user-defined-semantics)
  (subject source-theory)
  (using target-theory)
  (obligation evaluates-linked-contract))
(witness user.definition.counter
  (kind user-defined-semantics)
  (implementation user-counter)
  (proof user.proof.counter))
(proof-object user.proof.counter
  (applies verified-theory-definition)
  (premise-by user.capability.counter)
  (conclusion
    (source-by-target defines source-theory using target-theory
      via user-counter as user-defined-semantics)))
(definition source-by-target
  (subject source-theory)
  (using target-theory)
  (witness user.definition.counter))
`;
    const trustedFoundation = `${foundationSource}
(implementation-contract user-counter-contract
  (kind user-defined-semantics)
  (obligation evaluates-linked-contract))
(conformance-case user-counter-contract evaluates-linked-contract
  (program user-counter-program)
  (input (counter (successor zero)))
  (expected zero))
(axiom user.capability.counter
  (judgement (user-counter implements user-defined-semantics)))
`;
    const network = networkFrom(source, trustedFoundation);

    assert.strictEqual(network.definitionVerification('source-by-target').verified, true);
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
  (contract addressed-doublet-network)
  (program links-meta-theory)
  (kind set-theoretic-function)
  (subject links-theory)`,
      `(implementation addressed-doublet-network
  (contract addressed-doublet-network)
  (program links-meta-theory)
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
      /implementation addressed-doublet-network obligations do not match contract addressed-doublet-network/,
    );
  });

  it('rejects undeclared implementation contract clauses', () => {
    const source = readFileSync(corePath, 'utf8').replace(
      '  (contract addressed-doublet-network)',
      `  (contract addressed-doublet-network)
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
      /proof-obligation typed-kernel-links.beta-conversion failed proof replay/,
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
      /proof-obligation typed-kernel-links.pi-formation failed proof replay/,
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
    assert.deepStrictEqual(links.typeFacts(), [
      {
        address: 'rml.type-fact.0',
        subject: 'source.reference',
        type: 'Reference',
      },
      {
        address: 'rml.type-fact.1',
        subject: 'source.reference',
        type: 'Entity',
      },
      {
        address: 'rml.type-fact.2',
        subject: 'target.reference',
        type: 'Reference',
      },
      {
        address: 'rml.type-fact.3',
        subject: 'wrong.reference',
        type: 'Natural',
      },
      {
        address: 'rml.type-fact.4',
        subject: 'typed.link',
        type: '(Pair Reference Reference)',
      },
    ]);
    const snapshot = links.snapshot();
    links.clearTypeIndex();
    assert.deepStrictEqual(links.typesOf('source.reference'), ['Entity', 'Reference']);
    links.rebuildTypeIndex();
    assert.deepStrictEqual(links.snapshot(), snapshot);
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

  it('provides a selectable recursively linked default type ontology', () => {
    const bare = new TypedLinkNetwork();
    assert.strictEqual(bare.doublet('Type'), null);

    const links = TypedLinkNetwork.withDefaultOntology();
    assert.deepStrictEqual(links.doublet('Type'), { source: 'Type', target: 'Type' });
    assert.deepStrictEqual(
      links.doublet('SubType'),
      { source: 'Type', target: 'SubType' },
    );
    assert.deepStrictEqual(
      links.doublet('Value'),
      { source: 'SubType', target: 'Value' },
    );
    assert.deepStrictEqual(links.typesOf('Type'), ['Type']);
    assert.deepStrictEqual(links.typesOf('SubType'), ['Type']);
    assert.deepStrictEqual(links.typesOf('Value'), ['SubType']);
    assert.deepStrictEqual(links.validateClosure(), {
      closed: true,
      missingReferences: [],
    });

    const interop = links.linkCliInteropProfile();
    assert.strictEqual(interop.revision, 'e801cb877f8ed90a103ee253add6f702da89ee40');
    assert.deepStrictEqual(
      interop.pinnedTypes.map(mapping => [mapping.rmlAddress, mapping.exactShape]),
      [['Type', true], ['SubType', true], ['Value', false]],
    );
    assert.deepStrictEqual(interop.pinnedTypes[2], {
      rmlAddress: 'Value',
      mappedRmlShape: { address: 3, source: 2, target: 3 },
      linkCliShape: { address: 3, source: 1, target: 3 },
      exactShape: false,
    });
    assert.deepStrictEqual(interop.unicode, {
      linkCliShape: ['raw-number', 'unicode-symbol-type'],
      mapsToRml: ['type-fact-subject', 'type-fact-type'],
      typeFactOrientationCompatible: true,
      canonicalDefinitionOrientationCompatible: false,
    });
    assert.strictEqual(interop.names.numericIdentityRequired, false);
  });

  it('leaves the default type ontology to the callers that select it', () => {
    // The ontology's `Type: (Type, Type)` link is not a `Type : Type` rule of
    // the evaluator, whose universes stay stratified and which answers
    // `Type of Type` only for a source that declares it.
    const ontology = TypedLinkNetwork.withDefaultOntology();
    assert.deepStrictEqual(ontology.doublet('Type'), { source: 'Type', target: 'Type' });
    const out = evaluate(`
(? (Type of Type))
(? ((Type 0) of (Type 1)))
(? ((Type 1) of (Type 0)))
`);
    assert.deepStrictEqual(out.diagnostics, []);
    assert.deepStrictEqual(out.results, [0, 1, 0]);
    assert.deepStrictEqual(evaluate('(Type: Type Type)\n(? (Type of Type))').results, [1]);

    // No runtime module selects the ontology: its definition is the only line
    // under `js/src` that names it.
    const sourceDirectory = join(repoRoot, 'js', 'src');
    const selections = filesUnder(sourceDirectory)
      .sort()
      .flatMap(path => readFileSync(path, 'utf8')
        .split('\n')
        .filter(line => line.includes('withDefaultOntology'))
        .map(line => `${relative(sourceDirectory, path)}: ${line.trim()}`));
    assert.deepStrictEqual(selections, [
      'rml-theory-network.mjs: static withDefaultOntology() {',
    ]);
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

describe('requirement-specific representation boundaries', () => {
  it('keeps nested membership-set addresses distinct and rejects extensional non-members', () => {
    const sets = new MembershipSetStore();
    sets.define('inner.a', 'a', 'inner');
    sets.define('inner.b', 'b', 'inner');
    sets.define('outer.inner', 'inner', 'outer');
    assert.deepStrictEqual(sets.members('outer'), ['inner']);
    assert.deepStrictEqual(sets.members('inner'), ['a', 'b']);
    assert.strictEqual(sets.has('outer', 'a'), false);
    assert.strictEqual(sets.equals('inner', 'outer'), false);
    assert.strictEqual(sets.isSubsetOf('inner', 'outer'), false);
    assert.deepStrictEqual(sets.union('outer'), ['a', 'b']);
    assert.deepStrictEqual(sets.members('missing'), []);
    assert.throws(() => sets.define('inner.a', 'other', 'inner'), /already defined/);
    assert.deepStrictEqual(sets.members('inner'), ['a', 'b']);
  });

  it('round-trips empty singleton and repeated finite leaves in every sequence layout', () => {
    for (const layout of ['balanced', 'left', 'right']) {
      for (const values of [[], ['only'], ['a', 'a', 'b', 'a', 'c']]) {
        const store = new DoubletSequenceStore();
        const head = store.encodeSequence(values, 'sequence', layout);
        assert.deepStrictEqual(store.decodeSequence(head), values);
      }
    }
  });

  it('rejects cyclic finite decoding and colliding sequence addresses without partial writes', () => {
    for (const layout of ['balanced', 'left', 'right']) {
      const store = new DoubletSequenceStore();
      assert.throws(() => store.encodeSequence(['sequence.cell.0', 'a'], 'sequence', layout), /collides with an internal link/);
      assert.strictEqual(store.doublet('sequence.cell.0'), null);
      store.define('sequence.cell.0', 'existing', 'leaf');
      const before = store.entries();
      assert.throws(() => store.encodeSequence(['a', 'b', 'c'], 'sequence', layout), /already defined/);
      assert.deepStrictEqual(store.entries(), before);
    }
    const cyclic = new DoubletSequenceStore();
    cyclic.define('self', 'a', 'self');
    cyclic.define('first', 'b', 'second');
    cyclic.define('second', 'c', 'first');
    assert.throws(() => cyclic.decodeSequence('self'), /sequence self is cyclic/);
    assert.throws(() => cyclic.decodeSequence('first'), /sequence first is cyclic/);
  });

  it('rejects non-vertex graph endpoints without creating edges or reachability', () => {
    const graph = new LinkGraph('graph');
    graph.addVertex('a'); graph.addVertex('b');
    assert.throws(() => graph.defineEdge('bad.source', 'missing', 'b'), /edge source missing is not a vertex/);
    assert.throws(() => graph.defineEdge('bad.target', 'a', 'missing'), /edge target missing is not a vertex/);
    assert.strictEqual(graph.edge('bad.source'), null);
    assert.strictEqual(graph.edge('bad.target'), null);
    assert.strictEqual(graph.edgeType('bad.target'), null);
    assert.strictEqual(graph.reachable('a', 'b'), false);
    assert.strictEqual(graph.reachable('missing', 'missing'), false);
    assert.deepStrictEqual(graph.successors('a'), []);
    graph.defineEdge('valid', 'a', 'b');
    assert.strictEqual(graph.reachable('a', 'b'), true);
  });

  it('rejects relational signature mismatches and out-of-carrier pairs without mutation', () => {
    const relation = new FiniteRelation('r', ['a'], ['b']);
    relation.define('ab', 'a', 'b');
    assert.throws(() => relation.define('bad.left', 'missing', 'b'), /outside the declared domain/);
    assert.throws(() => relation.define('bad.right', 'a', 'missing'), /outside the declared codomain/);
    assert.throws(() => relation.define('duplicate', 'a', 'b'), /already contains/);
    assert.throws(() => relation.union(new FiniteRelation('other', ['a'], ['c']), 'union'), /equal domains and codomains/);
    assert.throws(() => relation.intersection(new FiniteRelation('other', ['c'], ['b']), 'intersection'), /equal domains and codomains/);
    assert.throws(() => relation.compose(new FiniteRelation('other', ['c'], ['d']), 'composition'), /first codomain to equal the next domain/);
    assert.deepStrictEqual(relation.pairs(), [['a', 'b']]);
    for (const address of ['bad.left', 'bad.right', 'duplicate']) assert.strictEqual(relation.pairType(address), null);
  });

  it('keeps typing and validation invariant when the derived index is deleted and rebuilt', () => {
    const outcomes = [];
    for (const mode of ['present', 'deleted', 'rebuilt']) {
      const links = TypedLinkNetwork.withDefaultOntology();
      const before = links.snapshot();
      if (mode !== 'present') links.clearTypeIndex();
      if (mode === 'rebuilt') links.rebuildTypeIndex();
      assert.deepStrictEqual(links.snapshot(), before);
      assert.deepStrictEqual(links.typesOf('Value'), ['SubType']);
      assert.strictEqual(links.validateClosure().closed, true);
      assert.throws(() => links.define('invalid', 'Value', 'Type', 'Type', 'Type'), /expected Type/);
      assert.strictEqual(links.doublet('invalid'), null);
      links.define('valid', 'Value', 'Type', 'SubType', 'Type');
      assert.strictEqual(links.typeOf('valid'), '(Pair SubType Type)');
      links.declare('Value', 'Type');
      assert.deepStrictEqual(links.typesOf('Value'), ['SubType', 'Type']);
      outcomes.push(links.snapshot());
    }
    assert.deepStrictEqual(outcomes[1], outcomes[0]);
    assert.deepStrictEqual(outcomes[2], outcomes[0]);
  });

  it('does not authorize a typed link after its authoritative type fact is removed', () => {
    const snapshot = TypedLinkNetwork.withDefaultOntology().snapshot();
    snapshot.typeFacts = snapshot.typeFacts.filter(fact => fact.subject !== 'Value');
    const links = TypedLinkNetwork.fromSnapshot(snapshot, { requireClosed: true });
    links.typeIndex.set('Value', new Set(['SubType']));
    for (const mode of ['forged', 'deleted', 'rebuilt']) {
      if (mode === 'deleted') links.clearTypeIndex();
      if (mode === 'rebuilt') links.rebuildTypeIndex();
      assert.deepStrictEqual(links.typesOf('Value'), []);
      assert.throws(() => links.define('forged', 'Value', 'Type', 'SubType', 'Type'), /has no declared type/);
      assert.strictEqual(links.doublet('forged'), null);
      assert.deepStrictEqual(links.snapshot(), snapshot);
    }
  });

  it('rejects default ontology closure when a canonical classifier link is missing', () => {
    for (const address of ['Type', 'SubType', 'Value']) {
      const snapshot = TypedLinkNetwork.withDefaultOntology().snapshot();
      snapshot.links = snapshot.links.filter(link => link.address !== address);
      const open = TypedLinkNetwork.fromSnapshot(snapshot);
      assert.strictEqual(open.validateClosure().closed, false);
      assert.deepStrictEqual(open.validateClosure().missingReferences, [address]);
      assert.throws(() => TypedLinkNetwork.fromSnapshot(snapshot, { requireClosed: true }), /dangling references/);
    }
  });

  it('does not report missing or reversed ontology links as exact link-cli pinned types', () => {
    const absent = new TypedLinkNetwork().linkCliInteropProfile();
    assert.ok(absent.pinnedTypes.every(mapping => mapping.mappedRmlShape === null && !mapping.exactShape));
    const snapshot = TypedLinkNetwork.withDefaultOntology().snapshot();
    const subtype = snapshot.links.find(link => link.address === 'SubType');
    [subtype.source, subtype.target] = [subtype.target, subtype.source];
    const profile = TypedLinkNetwork.fromSnapshot(snapshot, { requireClosed: true }).linkCliInteropProfile();
    assert.deepStrictEqual(profile.pinnedTypes[1].mappedRmlShape, { address: 2, source: 2, target: 1 });
    assert.strictEqual(profile.pinnedTypes[1].exactShape, false);
    assert.strictEqual(profile.pinnedTypes[0].exactShape, true);
    assert.strictEqual(profile.pinnedTypes[2].exactShape, false);
  });
});

describe('versioned opaque reference sequences and sets', () => {
  const fixture = JSON.parse(readFileSync(join(repoRoot, 'test-corpus/reference-sequences/v1.json'), 'utf8'));
  const restore = triples => {
    const store = new DoubletSequenceStore();
    for (const triple of triples) store.define(...triple);
    return store;
  };
  const triples = store => store.entries().map(({ address, source, target }) => [address, source, target]);

  it('preserves nested shared and cyclic element identities in every versioned layout after linked transport', () => {
    for (const layout of ['balanced', 'left', 'right']) {
      const store = restore(fixture.links);
      for (const [name, values] of [['empty', []], ['singleton', ['inner']], ['sequence', fixture.values]]) {
        const head = store.encodeReferenceSequence(values, name, layout);
        assert.deepStrictEqual(store.decodeReferenceSequence(head), values);
        assert.deepStrictEqual(restore(triples(store)).decodeReferenceSequence(head), values);
      }
      const pair = store.encodeReferenceSequence(['inner', 'direct-cycle'], 'example', layout);
      assert.strictEqual(pair, 'example.cell.0');
      assert.deepStrictEqual(triples(store).filter(([address]) => address.startsWith('example.')), fixture.twoElementEncoding);
      for (const [address, source, target] of fixture.links) assert.deepStrictEqual(store.doublet(address), { source, target });
    }
    const supplied = restore([...fixture.links, ...fixture.nonGeneratedStructure]);
    assert.deepStrictEqual(supplied.decodeReferenceSequence('root'), ['direct-cycle', 'direct-cycle']);
    // Raw upstream trees keep their explicit, separate interpretation.
    assert.deepStrictEqual(supplied.decodeSequence('inner'), ['a', 'b']);
  });

  it('rejects malformed or cyclic versioned structure and generated-address collisions atomically', () => {
    for (const layout of ['balanced', 'left', 'right']) {
      for (const collision of ['reserved.cell.0', 'reserved.children.0']) {
        const store = restore(fixture.links);
        const before = triples(store);
        assert.throws(() => store.encodeReferenceSequence([collision, 'inner'], 'reserved', layout), /collides with an internal link/);
        assert.deepStrictEqual(triples(store), before);
        store.define(collision, 'original', 'value');
        const occupied = triples(store);
        assert.throws(() => store.encodeReferenceSequence(['inner', 'direct-cycle'], 'reserved', layout), /already defined/);
        assert.deepStrictEqual(triples(store), occupied);
      }
    }
    const store = restore(fixture.links);
    assert.throws(() => store.decodeReferenceSequence('missing'), /unknown reference sequence address/);
    assert.throws(() => store.decodeReferenceSequence('inner'), /invalid reference sequence constructor/);
    store.define('broken', 'rml.reference-sequence.v1.branch', 'absent-children');
    assert.throws(() => store.decodeReferenceSequence('broken'), /unknown reference sequence children/);
    store.define('cycle', 'rml.reference-sequence.v1.branch', 'cycle-children');
    store.define('cycle-children', 'cycle', 'cycle');
    assert.throws(() => store.decodeReferenceSequence('cycle'), /reference sequence cycle is cyclic/);
    assert.throws(() => store.encodeReferenceSequence([''], 'invalid'), /non-empty reference/);
    assert.throws(() => store.encodeReferenceSequence([], 'invalid', 'unknown'), /layout must/);
  });

  it('represents nested ordered and extensional sets without flattening their member links', () => {
    const store = restore(fixture.links);
    const inner = store.encodeReferenceSet(['b', 'a', 'b'], 'set.inner');
    const outer = store.encodeReferenceSet([inner], 'set.outer');
    assert.notStrictEqual(outer, inner);
    assert.deepStrictEqual(store.decodeReferenceSet(inner), ['a', 'b']);
    assert.deepStrictEqual(store.decodeReferenceSet(outer), [inner]);
    const ordered = store.encodeReferenceOrderedSet(['indirect-a', inner, 'direct-cycle'], 'ordered');
    assert.deepStrictEqual(store.decodeReferenceOrderedSet(ordered), ['indirect-a', inner, 'direct-cycle']);
    const canonical = store.encodeReferenceSet(['indirect-a', inner, 'direct-cycle', inner], 'canonical');
    assert.deepStrictEqual(store.decodeReferenceSet(canonical), ['direct-cycle', 'indirect-a', inner]);
    const restored = restore(triples(store));
    assert.deepStrictEqual(restored.decodeReferenceSet(outer), [inner]);
    assert.deepStrictEqual(restored.decodeReferenceOrderedSet(ordered), ['indirect-a', inner, 'direct-cycle']);
  });

  it('rejects duplicate reference-set members and noncanonical linked order', () => {
    const store = restore(fixture.links);
    const before = triples(store);
    assert.throws(() => store.encodeReferenceOrderedSet(['inner', 'inner'], 'duplicate'), /ordered set contains duplicate inner/);
    assert.deepStrictEqual(triples(store), before);
    const duplicate = store.encodeReferenceSequence(['inner', 'inner'], 'duplicate');
    assert.throws(() => store.decodeReferenceOrderedSet(duplicate), /ordered set contains duplicate inner/);
    assert.throws(() => store.decodeReferenceSet(duplicate), /strict canonical order/);
    const unordered = store.encodeReferenceOrderedSet(['inner', 'direct-cycle'], 'unordered');
    assert.throws(() => store.decodeReferenceSet(unordered), /strict canonical order/);
  });
});

describe('bounded iterative reference traversal', () => {
  it('handles large versioned left and right sequences without host recursion', () => {
    const values = Array.from({ length: 20_000 }, (_, index) => `item.${index}`);
    for (const layout of ['balanced', 'left', 'right']) {
      const store = new DoubletSequenceStore();
      const head = store.encodeReferenceSequence(values, 'large', layout);
      assert.strictEqual(head, 'large.cell.0');
      assert.deepStrictEqual(store.decodeReferenceSequence(head), values);
      assert.strictEqual(store.nodes.size, 3 * values.length - 2);
    }
  });

  it('bounds deep and shared versioned structure by expanded visits and output count', () => {
    const store = new DoubletSequenceStore();
    const element = 'rml.reference-sequence.v1.element';
    const branch = 'rml.reference-sequence.v1.branch';
    const empty = 'rml.sequence.empty';
    store.define('opaque', 'opaque', 'opaque');
    store.define('leaf', element, 'opaque');
    let root = 'leaf';
    for (let index = 0; index < 20_000; index++) {
      store.define(`deep.${index}`, branch, `deep.children.${index}`);
      store.define(`deep.children.${index}`, root, empty);
      root = `deep.${index}`;
    }
    assert.deepStrictEqual(store.decodeReferenceSequence(root), ['opaque']);
    assert.throws(() => store.decodeReferenceSequence(root, { maxVisits: 100 }), /visit limit exceeded/);
    assert.throws(() => store.decodeReferenceSequence(root, { maxValues: 0 }), /value limit exceeded/);
    store.define('shared', branch, 'shared.children');
    store.define('shared.children', 'leaf', 'leaf');
    assert.deepStrictEqual(store.decodeReferenceSequence('shared', { maxVisits: 3, maxValues: 2 }), ['opaque', 'opaque']);
    assert.throws(() => store.decodeReferenceSequence('shared', { maxVisits: 2 }), /visit limit exceeded/);
    assert.throws(() => store.decodeReferenceSequence('shared', { maxValues: 1 }), /value limit exceeded/);
    assert.throws(() => store.decodeReferenceOrderedSet('shared', { maxVisits: 2 }), /visit limit exceeded/);
    assert.throws(() => store.decodeReferenceSet('shared', { maxValues: 1 }), /value limit exceeded/);
    let sharedRoot = 'leaf';
    for (let index = 0; index < 40; index++) {
      store.define(`dag.${index}`, branch, `dag.children.${index}`);
      store.define(`dag.children.${index}`, sharedRoot, sharedRoot);
      sharedRoot = `dag.${index}`;
    }
    // Only 81 structural links describe 2^40 emitted values. Count revisits,
    // rather than just distinct addresses, before that expansion can occur.
    assert.throws(() => store.decodeReferenceSequence(sharedRoot, { maxVisits: 1000, maxValues: 1000 }), /visit limit exceeded/);
    assert.throws(() => store.decodeReferenceSequence(sharedRoot, { maxVisits: 1000, maxValues: 3 }), /value limit exceeded/);
    assert.throws(() => store.decodeReferenceSequence('leaf', { maxVisits: -1 }), /non-negative safe integers/);
    assert.throws(() => store.decodeReferenceSequence('leaf', { maxValues: Infinity }), /non-negative safe integers/);
    assert.deepStrictEqual(store.decodeReferenceSequence(empty, { maxVisits: 1, maxValues: 0 }), []);
    assert.throws(() => store.decodeReferenceSequence(empty, { maxVisits: 0 }), /visit limit exceeded/);
  });
});
