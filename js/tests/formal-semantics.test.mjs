import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FormalCorpus } from '../src/rml-formal-corpus.mjs';
import { FormalSemantics, formalNatural, formalList } from '../src/rml-formal-semantics.mjs';
import { renderFormalCorpus, renderFormalCorpusFoundation, lexFormalSource } from '../../scripts/check-meta-theory-corpus.mjs';

const source = readFileSync(new URL('../../lib/meta-theory/upstream-0.0.3.lino', import.meta.url), 'utf8');
const foundation = readFileSync(new URL('../../lib/meta-theory/upstream-0.0.3-foundation.lino', import.meta.url), 'utf8');
const kernel = readFileSync(new URL('../../lib/meta-theory/formal-semantics.lino', import.meta.url), 'utf8');
const create = (s = source, f = foundation, k = kernel) => FormalSemantics.fromRml(s, f, k);
const address = (language, module, name) => `rml.formal.${language}.${module}.${name}`;
const theorem = language => address(language, 'MetaDefinitions', 'meta_network_is_duplet_network');

function changed(change) {
  const corpus = FormalCorpus.fromRml(source, foundation);
  change(corpus);
  for (const declaration of corpus.declarations) declaration.dependencies.sort();
  const data = { modules: corpus.formalModules, declarations: corpus.declarations };
  const changedSource = renderFormalCorpus(data);
  // Intentionally authorize the changed source contract too: the next check
  // must reject its semantics, rather than only detecting an obsolete hash.
  const changedFoundation = renderFormalCorpusFoundation(data);
  return create(changedSource, changedFoundation);
}

function smallSource(language, signature, proof) {
  const prefix = lexFormalSource(`${language === 'lean' ? 'theorem' : 'Theorem'} identity`, language).tokens;
  const sig = lexFormalSource(signature, language).tokens;
  const separator = lexFormalSource(language === 'lean' ? ':=' : '.', language).tokens;
  const body = lexFormalSource(proof, language).tokens;
  const tokens = [...prefix, ...sig, ...separator, ...body];
  const beginProof = prefix.length + sig.length + separator.length;
  const declaration = {
    language, module: 'BinderExamples', kind: 'theorem', symbol: 'identity',
    address: address(language, 'BinderExamples', 'identity'),
    proofStatus: 'verified', recursive: false,
    syntaxRange: [0, tokens.length], signatureRange: [prefix.length, prefix.length + sig.length],
    bodyRange: [beginProof, beginProof], proofRange: [beginProof, tokens.length],
    dependencies: [],
  };
  const data = { modules: [{ language, name: 'BinderExamples', tokens }], declarations: [declaration] };
  return create(renderFormalCorpus(data), renderFormalCorpusFoundation(data));
}

describe('source-bound native linked semantic fragment', () => {
  const semantics = create();
  it('reports exact finite-corpus coverage without relabeling source preservation as verification', () => {
    const report = semantics.coverage();
    assert.equal(report.declarationCount, 229);
    assert.equal(report.declarations.length, 229);
    assert.equal(report.checkedDefinitions, 38);
    assert.equal(report.replayedProofs, 2);
    assert.equal(report.upstreamAdmissions, 4);
    assert.equal(report.fullCorpusVerified, false);
    assert.equal(report.declarations.filter(item => item.status === 'unsupported' || item.status === 'unresolved').length, 185);
  });

  for (const language of ['lean', 'rocq']) {
    it(`${language}: executes the actual identity body and concrete network constructors`, () => {
      const network = formalList([[1, 2], [2, 3], [3, 1]].map(pair => ['fs-pair', ...pair.map(formalNatural)]));
      const identity = semantics.evaluate(address(language, 'MetaDefinitions', 'MetaNetworkToDupletList'), [network]);
      const literal = semantics.evaluate(address(language, 'MetaDefinitions', 'exampleMetaNetwork'));
      assert.equal(identity.accepted, true);
      assert.deepEqual(identity.result, literal.result);
      assert(identity.trace.some(step => step.rule === 'application-closure'));
      assert(identity.trace.some(step => step.rule === 'local-head'));
      const singleton = semantics.evaluate(address(language, 'SetDefinitions', 'SingletonSet'), [formalNatural(5)]);
      assert.equal(singleton.accepted, true);
      assert.equal(singleton.result[1], 'fs-t-nat');
      const wrong = semantics.evaluate(address(language, 'SetDefinitions', 'SingletonSet'), [network]);
      assert.equal(wrong.accepted, false);
    });

    it(`${language}: checks the universally quantified upstream proof and replays it in a fresh runtime`, () => {
      const receipt = semantics.verifyTheorem(theorem(language));
      assert.equal(receipt.accepted, true);
      assert(receipt.trace.some(step => step.rule === 'proof-introduction'));
      assert(receipt.trace.some(step => step.rule === 'proof-equal'));
      const replay = create().replay(receipt);
      assert.equal(replay.accepted, true);
      assert.equal(replay.matches, true);
      assert.equal(semantics.verifyTheorem(theorem(language), ['fs-proof-refl']).accepted, false);
      assert.equal(semantics.verifyTheorem(theorem(language), ['fs-proof-intro', ['fs-proof-intro', ['fs-proof-refl']]]).accepted, false);
    });

    it(`${language}: rejects a changed definition body even with a freshly authorized source fingerprint`, () => {
      const altered = changed(corpus => {
        const definition = corpus.declaration(language, 'MetaDefinitions', 'MetaNetworkToDupletList');
        definition.body[0].text = 'exampleMetaNetwork';
        definition.dependencies.push(address(language, 'MetaDefinitions', 'exampleMetaNetwork'));
      });
      assert.equal(altered.coverage().declarations.find(item => item.address === theorem(language)).status, 'unresolved');
      assert.equal(altered.verifyTheorem(theorem(language)).accepted, false);
    });

    it(`${language}: rejects a changed theorem binder, premise and conclusion semantically`, () => {
      for (const mutation of ['binder', 'premise', 'conclusion']) {
        const altered = changed(corpus => {
          const declaration = corpus.declarationAt(theorem(language));
          if (mutation === 'binder') {
            declaration.signature.find(token => token.text === 'MetaNetworkList').text = language === 'lean' ? 'Nat' : 'nat';
            declaration.dependencies = declaration.dependencies.filter(name => !name.endsWith('.MetaNetworkList'));
          } else if (mutation === 'premise') {
            declaration.signature.find(token => token.text === '=').text = language === 'lean' ? '→' : '->';
          } else {
            declaration.signature.at(-1).text = '0';
            declaration.signature.at(-1).kind = 'numeral';
          }
        });
        assert.notEqual(altered.coverage().declarations.find(item => item.address === theorem(language)).status, 'conversion-proof-replayed', mutation);
        assert.equal(altered.verifyTheorem(theorem(language)).accepted, false, mutation);
      }
    });

    it(`${language}: rejects missing, extra and substituted dependency authority`, () => {
      for (const mutation of ['missing', 'extra', 'substituted']) {
        const altered = changed(corpus => {
          const declaration = corpus.declarationAt(theorem(language));
          if (mutation === 'missing') declaration.dependencies = declaration.dependencies.filter(name => !name.endsWith('.MetaNetworkToDupletList'));
          if (mutation === 'extra') declaration.dependencies.push(address(language, 'NetworkDefinitions', 'ReferenceDefault'));
          if (mutation === 'substituted') declaration.dependencies = declaration.dependencies.map(name => name.endsWith('.MetaNetworkToDupletList') ? address(language === 'lean' ? 'rocq' : 'lean', 'MetaDefinitions', 'MetaNetworkToDupletList') : name);
        });
        assert.equal(altered.coverage().declarations.find(item => item.address === theorem(language)).status, 'unsupported', mutation);
        assert.throws(() => altered.verifyTheorem(theorem(language)), /not in the supported proof fragment/);
      }
    });
  }

  it('binds every replay field to authoritative source, context, dependencies, result and trace', () => {
    const original = semantics.verifyTheorem(theorem('lean'));
    for (const field of ['dependencies', 'result', 'trace', 'steps', 'accepted', 'request']) {
      const forged = structuredClone(original);
      forged[field] = field === 'accepted' ? false : field === 'steps' ? original.steps + 1 : [];
      const replay = semantics.replay(forged);
      assert.equal(replay.accepted, false);
      assert.equal(replay.executionAccepted, true);
      assert.equal(replay.matches, false, field);
    }
    for (const field of ['corpusFingerprint', 'kernelHash']) {
      const forged = structuredClone(original); forged[field] = 'forged';
      assert.throws(() => semantics.replay(forged), /authoritative source and kernel/);
    }
  });

  it('keeps public receipt mutations detached from private checked definitions and source goals', () => {
    const pristine = semantics.verifyTheorem(theorem('lean'));
    const changedReceipt = semantics.verifyTheorem(theorem('lean'));
    changedReceipt.request[1].splice(0, changedReceipt.request[1].length, 'fs-equal', ['fs-zero'], ['fs-successor', ['fs-zero']]);
    const call = semantics.evaluate(address('lean', 'SetDefinitions', 'SingletonSet'), [formalNatural(3)]);
    const mutateArrays = value => {
      if (!Array.isArray(value)) return;
      if (value[0] === 'fs-t-arrow') value.splice(1, 1, 'forged-type');
      else if (value[0] === 'fs-closure') value[1].splice(0, value[1].length, 'forged-body');
      else value.forEach(mutateArrays);
    };
    mutateArrays(call.request[3]);
    assert.deepEqual(semantics.verifyTheorem(theorem('lean')), pristine);
    assert.equal(semantics.evaluate(address('lean', 'SetDefinitions', 'SingletonSet'), [formalNatural(3)]).accepted, true);
    assert.equal(semantics.replay(changedReceipt).matches, false);
  });

  it('does not silently reinterpret cross-language spellings or list separators', () => {
    for (const language of ['lean', 'rocq']) {
      const altered = changed(corpus => {
        const declaration = corpus.declaration(language, 'NetworkDefinitions', 'Reference');
        declaration.body[0].text = language === 'lean' ? 'nat' : 'Nat';
      });
      assert.equal(altered.coverage().declarations.find(item => item.address === address(language, 'NetworkDefinitions', 'Reference')).status, 'unsupported');
      const separators = changed(corpus => {
        const declaration = corpus.declaration(language, 'MetaDefinitions', 'exampleMetaNetwork');
        const values = declaration.body;
        // Change only the separator between pairs, not their inner comma.
        values[6].text = language === 'lean' ? ';' : ',';
      });
      assert.equal(separators.coverage().declarations.find(item => item.address === address(language, 'MetaDefinitions', 'exampleMetaNetwork')).status, 'unsupported');
    }
  });

  it('does not accept execution payloads, cyclic data, resource overflows or admissions as proof', () => {
    const singleton = address('lean', 'SetDefinitions', 'SingletonSet');
    assert.throws(() => semantics.evaluate(singleton, [['fs-ok', 'fs-t-nat', 'fs-v-zero']]), /unsupported formal argument/);
    assert.throws(() => semantics.verifyTheorem(theorem('lean'), ['fs-prove-equal', ['fs-ok'], ['fs-ok']]), /unsupported conversion proof/);
    const cycle = ['fs-successor']; cycle.push(cycle);
    assert.throws(() => semantics.evaluate(singleton, [cycle]), /resource limit/);
    const receipt = semantics.verifyTheorem(theorem('lean')); receipt.trace = receipt;
    assert.throws(() => semantics.replay(receipt), /acyclic/);
    assert.throws(() => formalNatural(513), /integer from 0 through 512/);
    assert.throws(() => semantics.evaluate(singleton, Array(33).fill(['fs-zero'])), /at most 32 arguments/);
    assert.throws(() => semantics.verifyTheorem(address('lean', 'SetSequenceEquivalence', 'mem_insertSorted')), /not in the supported proof fragment/);
  });

  it('distinguishes declaration parameters, quantified introductions and different bound variables', () => {
    for (const language of ['lean', 'rocq']) {
      const nat = language === 'lean' ? 'Nat' : 'nat';
      const header = smallSource(language, `(x : ${nat}) : x = x`, language === 'lean' ? 'by rfl' : 'Proof. reflexivity. Qed.');
      assert.equal(header.coverage().replayedProofs, 1);
      const extraIntro = smallSource(language, `(x : ${nat}) : x = x`, language === 'lean' ? 'by intro x rfl' : 'Proof. intro x. reflexivity. Qed.');
      assert.equal(extraIntro.coverage().replayedProofs, 0);
      const falseEquality = smallSource(language,
        `: ${language === 'lean' ? '∀' : 'forall'} (x : ${nat}) (y : ${nat}), x = y`,
        language === 'lean' ? 'by intro x intro y rfl' : 'Proof. intro x. intro y. reflexivity. Qed.');
      assert.equal(falseEquality.coverage().replayedProofs, 0);
      assert.equal(falseEquality.verifyTheorem(address(language, 'BinderExamples', 'identity')).accepted, false);
      const hole = smallSource(language, `(_ : ${nat}) : _ = _`, language === 'lean' ? 'by rfl' : 'Proof. reflexivity. Qed.');
      assert.equal(hole.coverage().replayedProofs, 0);
      assert.match(hole.coverage().declarations[0].reason, /anonymous binders/);
      const implicit = smallSource(language, `{x : ${nat}} : x = x`, language === 'lean' ? 'by rfl' : 'Proof. reflexivity. Qed.');
      assert.match(implicit.coverage().declarations[0].reason, /implicit binder/);
    }
  });

  it('can replay its own maximum-depth argument receipt and rejects the next level', () => {
    const singleton = address('lean', 'SetDefinitions', 'SingletonSet');
    const receipt = semantics.evaluate(singleton, [formalNatural(127)]);
    assert.equal(receipt.accepted, true);
    assert.equal(semantics.replay(receipt).accepted, true);
    assert.throws(() => semantics.evaluate(singleton, [formalNatural(128)]), /resource limit/);
  });

  it('selects semantics from linked definitions and detects a changed verifier policy', () => {
    const changedKernel = kernel.replace('(to fs-proof-accepted)', '(to (fs-error disabled-proof-rule))');
    assert.notEqual(changedKernel, kernel);
    const altered = create(source, foundation, changedKernel);
    assert.equal(altered.verifyTheorem(theorem('lean')).accepted, false);
    assert.throws(() => altered.replay(semantics.verifyTheorem(theorem('lean'))), /authoritative source and kernel/);
  });
});
