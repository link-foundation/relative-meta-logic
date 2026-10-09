import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TypedLinkNetwork } from '../src/rml-theory-network.mjs';
import { FoundationWorkspace } from '../src/rml-foundation-workspace.mjs';
import { TypedSemanticArchive } from '../src/rml-semantic-archive.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../test-corpus/semantic-archive/graph.json', import.meta.url), 'utf8'));
const archive = () => new TypedSemanticArchive(fixture.snapshot, { roots: fixture.roots });

describe('recursive typed semantic archive', () => {
  it('round trips linked semantic categories sharing identity and cycles without host caches', () => {
    const before = archive();
    const bytes = before.serialize();
    assert.equal(Buffer.from(bytes).toString('hex'), readFileSync(new URL('../../test-corpus/semantic-archive/expected.hex', import.meta.url), 'utf8').trim());
    const after = TypedSemanticArchive.deserialize(bytes);
    assert.deepEqual(after.snapshot(), before.snapshot());
    assert.deepEqual(after.roots, fixture.roots);
    assert.deepEqual(after.serialize(), bytes);
    assert.deepEqual(after.doublet('proof'), { source: 'rule', target: 'judgement' });
    assert.deepEqual(after.doublet('judgement'), { source: 'term', target: 'proof' });
    assert.deepEqual(after.doublet('类型\n:🌍'), { source: '类型\n:🌍', target: '类型\n:🌍' });
    for (const address of ['\ufeffleading', 'nul\0id']) assert.deepEqual(after.doublet(address), { source: address, target: address });
    const restored = after.toTypedNetwork();
    assert.equal(restored.validateClosure().closed, true);
    assert.deepEqual(restored.typesOf('tf.rule'), ['type']);
    assert.equal(restored.typeOf('missing'), null);
    restored.typeIndex.set('ghost', new Set(['forged-type']));
    assert.deepEqual(restored.typesOf('ghost'), []);
    restored.clearTypeIndex();
    assert.deepEqual(restored.typesOf('proof'), ['type']);
    restored.rebuildTypeIndex();
    assert.deepEqual(restored.snapshot(), before.toTypedNetwork().snapshot());
  });

  it('rejects duplicate roles and dangling metadata instead of reporting false closure', () => {
    const graph = TypedLinkNetwork.withDefaultOntology();
    graph.links.define('rml.type-fact.0', 'Value', 'Value');
    assert.equal(graph.validateClosure().closed, false);
    assert.deepEqual(graph.identityConflicts(), ['rml.type-fact.0']);
    assert.throws(() => TypedSemanticArchive.fromNetwork(graph), /conflicting roles/);
    const missing = structuredClone(fixture.snapshot); missing.links = missing.links.filter(row => row.address !== 'term');
    assert.throws(() => new TypedSemanticArchive(missing), /dangling references: term/);
    const hidden = { ...fixture.snapshot, assumptions: ['unrepresented'] };
    assert.throws(() => new TypedSemanticArchive(hidden), /unrepresented metadata/);
    assert.throws(() => new TypedSemanticArchive(fixture.snapshot, { roots: ['missing'] }), /root missing is undefined/);
    assert.throws(() => new TypedSemanticArchive(fixture.snapshot, { roots: ['proof', 'proof'] }), /repeats a root/);
  });

  it('preserves explicit open boundaries and never invents definitions for textual pair types', () => {
    const open = new TypedLinkNetwork(); open.declare('left', 'A'); open.declare('right', 'B');
    open.define('pair', 'left', 'right', 'A', 'B');
    assert.ok(open.validateClosure().missingReferences.includes('(Pair A B)'));
    const restored = TypedLinkNetwork.fromSnapshot(open.snapshot());
    assert.deepEqual(restored.snapshot(), open.snapshot());
    assert.throws(() => TypedSemanticArchive.fromNetwork(open), /dangling references/);
    const blank = TypedSemanticArchive.fromNetwork(new TypedLinkNetwork());
    assert.equal(blank.doublet('Type'), null);
    assert.equal(blank.toTypedNetwork().typeOf('Type'), null);
  });

  it('reserves generated type-fact identities and rejects colliding definitions atomically', () => {
    const graph = TypedLinkNetwork.withDefaultOntology();
    graph.links.define('rml.type-fact.3', 'Type', 'Type');
    graph.declare('Value', 'Type');
    assert.equal(graph.typeFacts().at(-1).address, 'rml.type-fact.4');
    const before = graph.snapshot();
    assert.throws(() => graph.define('rml.type-fact.0', 'Type', 'Type', 'Type', 'Type'), /conflicting roles/);
    assert.deepEqual(graph.snapshot(), before);
  });

  it('bounds decoding and rejects truncation malformed lengths UTF-8 and trailing content', () => {
    const bytes = archive().serialize();
    for (const cut of [0, 1, 20, bytes.length - 1]) assert.throws(() => TypedSemanticArchive.deserialize(bytes.slice(0, cut)));
    assert.throws(() => TypedSemanticArchive.deserialize(new Uint8Array([...bytes, 0])), /trailing bytes/);
    assert.throws(() => TypedSemanticArchive.deserialize(bytes, { maxBytes: 16 }), /byte limit/);
    assert.throws(() => TypedSemanticArchive.deserialize(bytes, { maxLinks: 2 }), /link limit/);
    assert.throws(() => TypedSemanticArchive.deserialize(bytes, { maxFieldBytes: 3 }), /field limit/);
    assert.throws(() => TypedSemanticArchive.deserialize(new TextEncoder().encode('RML-TYPED-LINKS/1\n01\n')), /non-canonical/);
    assert.throws(() => TypedSemanticArchive.deserialize(new TextEncoder().encode('RML-TYPED-LINKS/1\n99999999999999999999\n')), /invalid archive length/);
    const invalid = new Uint8Array([...new TextEncoder().encode('RML-TYPED-LINKS/1\n1\n1:'), 255, 10]);
    assert.throws(() => TypedSemanticArchive.deserialize(invalid));
    assert.throws(() => new TypedSemanticArchive({ links: [{ address: '\ud800', source: '\ud800', target: '\ud800' }], typeFacts: [] }), /valid Unicode/);
  });
  it('keeps a selected graph ontology separate from foundation-defined universes and soundness obligations', () => {
    const ontology = TypedSemanticArchive.fromNetwork(TypedLinkNetwork.withDefaultOntology(), { roots: ['Type'] });
    assert.deepEqual(ontology.doublet('Type'), { source: 'Type', target: 'Type' });
    const source = readFileSync(new URL('../../test-corpus/semantic-archive/universe-contracts.lino', import.meta.url), 'utf8');
    for (const executionBasis of ['direct-structural', 's-k']) {
      const workspace = FoundationWorkspace.fromRml(source, { executionBasis });
      assert.equal(workspace.ask('stratified-universes', ['has-type', 'Type', 'Type']).status, 'unknown');
      assert.equal(workspace.ask('stratified-universes', ['has-type', 'Type', 'U1']).status, 'proved');
      assert.equal(workspace.ask('recursive-universes', ['has-type', 'Type', 'Type']).status, 'proved');
      assert.equal(workspace.ask('recursive-universes', ['soundness-obligation', 'consistency-unestablished']).status, 'proved');
      for (const instance of ['stratified-universes', 'recursive-universes']) {
        assert.equal(workspace.ask(instance, ['soundness', 'certified']).status, 'unknown');
      }
      const recursive = workspace.ask('recursive-universes', ['has-type', 'Type', 'Type']);
      const removed = workspace.revise([recursive], { removeRule: ['recursive-contract', 'explicit-self-universe'] });
      assert.equal(removed.revisions[0].after.status, 'unknown');
      assert.deepEqual(ontology.doublet('Type'), { source: 'Type', target: 'Type' });
    }
  });

});
