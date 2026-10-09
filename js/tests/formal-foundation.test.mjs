import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormalCorpus } from '../src/rml-formal-corpus.mjs';
import { FormalFoundation, formalRecord } from '../src/rml-formal-foundation.mjs';
import { FoundationReader } from '../src/rml-formal-foundation-parser.mjs';
import { formalNatural, formalList } from '../src/rml-formal-semantics.mjs';
import { renderFormalCorpus, renderFormalCorpusFoundation } from '../../scripts/check-meta-theory-corpus.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../../lib/meta-theory/upstream-0.0.3.lino');
const foundation = read('../../lib/meta-theory/upstream-0.0.3-foundation.lino');
const kernels = { core: read('../../lib/meta-theory/formal-semantics.lino'), indexed: read('../../lib/meta-theory/formal-indexed.lino'), records: read('../../lib/meta-theory/formal-records.lino') };
const create = (s = source, f = foundation, k = kernels) => FormalFoundation.fromRml(s, f, k);
const address = (language, symbol) => `rml.formal.${language}.NetworkDefinitions.${symbol}`;
const natValue = n => n ? ['fs-v-successor', natValue(n - 1)] : 'fs-v-zero';
const listValue = values => values.reduceRight((tail, value) => ['fs-v-cons', value, tail], 'fs-v-nil');
function changed(change) {
  const corpus = FormalCorpus.fromRml(source, foundation);
  change(corpus);
  for (const declaration of corpus.declarations) declaration.dependencies.sort();
  const data = { modules: corpus.formalModules, declarations: corpus.declarations };
  return create(renderFormalCorpus(data), renderFormalCorpusFoundation(data));
}

describe('source-bound indexed and record foundation cluster', () => {
  const system = create();
  it('rechecks 62 definitions including all 42 NetworkDefinitions bodies and retains honest remaining scope', () => {
    const report = system.coverage();
    assert.equal(report.checkedDefinitions, 62);
    assert.equal(report.replayedProofs, 2);
    assert.equal(report.upstreamAdmissions, 4);
    assert.equal(report.declarations.length, 229);
    assert.equal(report.fullCorpusVerified, false);
    const network = report.declarations.filter(entry => entry.address.includes('.NetworkDefinitions.'));
    assert.equal(network.length, 42);
    assert(network.every(entry => entry.status === 'definition-checked'));
    assert.deepEqual(report.pendingGeneratedTraits.map(entry => entry.trait), ['Repr', 'BEq']);
    assert(report.pendingGeneratedTraits.every(entry => entry.status.endsWith('pending')));
  });

  for (const language of ['lean', 'rocq']) {
    it(`${language}: executes zero and positive indexed vectors and freshly replays the dependent obligation`, () => {
      const name = address(language, 'TupleOfReferencesDefault');
      for (const n of [0, 1, 4]) {
        const result = system.evaluate(name, [formalNatural(n)]);
        assert.equal(result.accepted, true);
        assert.deepEqual(result.result, ['fs-ok', ['fs-t-vector', 'fs-t-nat', natValue(n)], ['fs-v-vector', listValue(Array(n).fill('fs-v-zero'))]]);
        assert(result.trace.some(step => step.rule === 'application-pi-closure'));
      }
      const proof = system.verifyDefinition(name);
      assert(proof.trace.some(step => step.rule === 'check-vector-repeat-length'));
      assert.equal(create().replay(proof).accepted, true);
      assert.equal(system.evaluate(name, [formalList([formalNatural(0)])]).accepted, false);
    });

    it(`${language}: executes source record constructors, size, and the actual dimension predicate`, () => {
      const predicate = address(language, language === 'lean' ? 'AnyNetwork.isWellFormed' : 'anyNetworkIsWellFormed');
      const size = address(language, language === 'lean' ? 'AnyNetwork.size' : 'anyNetworkSize');
      const sample = ['fs-global', address(language, 'exampleAnyNetwork')];
      assert.deepEqual(system.evaluate(size, [sample]).result, ['fs-ok', 'fs-t-nat', natValue(3)]);
      assert.deepEqual(system.evaluate(predicate, [sample]).result, ['fs-ok', 'fs-t-bool', 'fs-v-true']);
      const malformed = formalRecord([formalNatural(2), formalList([formalList([formalNatural(1)])])]);
      assert.deepEqual(system.evaluate(predicate, [malformed]).result, ['fs-ok', 'fs-t-bool', 'fs-v-false']);
      const empty = formalRecord([formalNatural(5), formalList([])]);
      assert.deepEqual(system.evaluate(predicate, [empty]).result, ['fs-ok', 'fs-t-bool', 'fs-v-true']);
      const otherLanguage = language === 'lean' ? 'rocq' : 'lean';
      assert.equal(system.evaluate(predicate, [['fs-global', address(otherLanguage, 'exampleAnyNetwork')]]).accepted, false);
    });

    it(`${language}: semantically rejects body length, binder type, and result-index mutations after reauthorizing source`, () => {
      for (const mutation of ['length', 'binder', 'index']) {
        const altered = changed(corpus => {
          const declaration = corpus.declaration(language, 'NetworkDefinitions', 'TupleOfReferencesDefault');
          const token = mutation === 'length' ? declaration.body.find(token => token.text === 'n')
            : mutation === 'binder' ? declaration.signature.find(token => token.text === (language === 'lean' ? 'Nat' : 'nat'))
              : declaration.signature.at(-1);
          token.text = mutation === 'binder' ? (language === 'lean' ? 'Bool' : 'bool') : '0';
          token.kind = mutation === 'binder' ? 'identifier' : 'numeral';
        });
        const status = altered.coverage().declarations.find(entry => entry.address === address(language, 'TupleOfReferencesDefault'));
        assert.equal(status.status, 'unresolved', mutation);
        assert.throws(() => altered.verifyDefinition(status.address), /unchecked definition/);
      }
    });

    it(`${language}: does not grant missing dependency authority or silently coerce a changed record field`, () => {
      const missing = changed(corpus => {
        const declaration = corpus.declaration(language, 'NetworkDefinitions', 'TupleOfReferencesDefault');
        declaration.dependencies = declaration.dependencies.filter(name => !name.endsWith('.ReferenceDefault'));
      });
      assert.equal(missing.coverage().declarations.find(entry => entry.address === address(language, 'TupleOfReferencesDefault')).status, 'unsupported');
      const fields = changed(corpus => {
        const declaration = corpus.declaration(language, 'NetworkDefinitions', 'AnyNetwork');
        const position = declaration.body.findIndex(token => token.text === 'dimension');
        declaration.body[position + 2].text = language === 'lean' ? 'Bool' : 'bool';
      });
      assert.equal(fields.coverage().declarations.find(entry => entry.address === address(language, 'AnyNetwork')).status, 'definition-checked');
      assert.equal(fields.coverage().declarations.find(entry => entry.address === address(language, 'emptyNetwork')).status, 'unresolved');
    });

    it(`${language}: changing a well-typed example body changes its observed predicate instead of using a name whitelist`, () => {
      const altered = changed(corpus => {
        const declaration = corpus.declaration(language, 'NetworkDefinitions', 'exampleAnyNetwork');
        declaration.body.find(token => token.kind === 'numeral').text = '1';
      });
      const predicate = address(language, language === 'lean' ? 'AnyNetwork.isWellFormed' : 'anyNetworkIsWellFormed');
      assert.deepEqual(altered.evaluate(predicate, [['fs-global', address(language, 'exampleAnyNetwork')]]).result,
        ['fs-ok', 'fs-t-bool', 'fs-v-false']);
    });
  }

  it('resolves lexical t before the Rocq vector type constructor and refuses implicit-argument guessing', () => {
    const reader = new FoundationReader(['t'], { language: 'rocq', scope: ['t'], resolve() { throw new Error('must not resolve a local'); } });
    assert.deepEqual(reader.expression(), ['fs-variable', 'fs-index-zero']);
    reader.end();
    const implicit = new FoundationReader(['{', 'n', ':', 'Nat', '}'], { language: 'lean', resolve() { throw new Error('not reached'); } });
    assert.throws(() => implicit.binder(), /implicit arguments/);
  });

  it('detaches source obligations and global values from mutable receipts, rejecting replay tampering', () => {
    const name = address('lean', 'TupleOfReferencesDefault');
    const original = system.verifyDefinition(name), changed = system.verifyDefinition(name);
    changed.request[1].splice(0, changed.request[1].length, 'corrupted');
    assert.deepEqual(system.verifyDefinition(name), original);
    assert.equal(system.replay(changed).accepted, false);
    const falseContext = structuredClone(original); falseContext.dependencies = [];
    assert.equal(system.replay(falseContext).accepted, false);
    const cycle = structuredClone(original); cycle.trace = cycle;
    assert.throws(() => system.replay(cycle), /cyclic/);
    assert.throws(() => system.evaluate(name, [['fs-ok', 'fs-t-nat', 'fs-v-zero']]), /unsupported foundation argument/);
    assert.throws(() => system.evaluate(name, [['fs-global', 'unproved']]), /unchecked definition/);
  });
});
