import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LinkMetadata, LinkType, SubstitutionRule } from '#meta-language';
import { deserializeRmlStructure, emitRmlFromStructure, serializeRmlStructure } from '../src/rml-meta-language.mjs';
import { parsePortableNatural, emitPortableNatural, translatePortableNatural, evaluatePortableNatural, PORTABLE_NATURAL_CONTRACT } from '../src/rml-portable-natural.mjs';
const corpus = JSON.parse(readFileSync(new URL('../../test-corpus/portable-natural/cases.json', import.meta.url), 'utf8'));

describe('portable natural semantics through registered RML structure', () => {
  for (const [from, source] of Object.entries(corpus.sources)) for (const to of Object.keys(corpus.sources)) {
    if (from === to) continue;
    it(`${from} → RML → ${to} preserves the fragment graph and observed results`, () => {
      const translated = translatePortableNatural(source, from, to);
      assert.equal(translated.status, 'translated-fragment');
      assert.equal(translated.targetSource, corpus.targets[to]);
      assert.equal(translated.preservedSource, source);
      assert.equal(translated.contract, PORTABLE_NATURAL_CONTRACT);
      assert.equal(translated.obligations[0].code, 'RML_PORTABLE_NUMERIC_DOMAIN');
      assert.equal(translated.stages.verification, 'not-proved');
      const sourceFree = deserializeRmlStructure(serializeRmlStructure(translated.network));
      assert.equal(sourceFree.renderSource('RML'), '');
      assert.equal(emitPortableNatural(sourceFree, to), translated.targetSource);
      const reimported = parsePortableNatural(translated.targetSource, to).network;
      assert.equal(emitRmlFromStructure(sourceFree), emitRmlFromStructure(reimported));
      for (const vector of corpus.vectors) {
        assert.equal(evaluatePortableNatural(reimported, vector.function, vector.arguments).toString(), vector.expected);
      }
      if (to === 'JavaScript') {
        for (const vector of corpus.vectors) {
          const result = vm.runInNewContext(translated.targetSource + `\n${vector.function}(${vector.arguments.join(',')})`, Object.create(null), { timeout: 1000 });
          assert.equal(String(result), vector.expected);
        }
      }
    });
  }
  for (const item of corpus.negatives) it(`source-preserving unsupported obligation: ${item.name}`, () => {
    for (const to of Object.keys(corpus.sources)) {
      if (to === item.language) continue;
      const result = translatePortableNatural(item.source, item.language, to);
      assert.equal(result.status, 'unsupported');
      assert.equal(result.targetSource, null);
      assert.equal(result.preservedSource, item.source);
      assert.match(result.obligations[0].code, /^RML_PORTABLE_/);
    }
  });
  it('refuses out-of-domain runtime values and arithmetic overflow, and evaluates only the chosen branch', () => {
    const parsed = parsePortableNatural('function bound(x) { return x === 0 ? 7 : 9007199254740991 + x; }', 'JavaScript');
    assert.equal(evaluatePortableNatural(parsed.network, 'bound', [0]), 7n);
    assert.throws(() => evaluatePortableNatural(parsed.network, 'bound', [1]), { code: 'RML_PORTABLE_DOMAIN' });
    assert.throws(() => evaluatePortableNatural(parsed.network, 'bound', [-1]), { code: 'RML_PORTABLE_DOMAIN' });
    assert.throws(() => evaluatePortableNatural(parsed.network, 'bound', [9007199254740992n]), { code: 'RML_PORTABLE_DOMAIN' });
  });
  it('a real graph substitution changes target source and results without consulting original source', () => {
    const network = parsePortableNatural('function offset(x) { return x + 1; }', 'JavaScript').network;
    const old = network.links().find(link => link.metadata().linkType === LinkType.Syntax && link.metadata().definition === 'rml:structure:1:reference' && link.metadata().term === '1');
    const parent = network.links().find(link => link.references().some(id => Number(id) === Number(old.id())));
    const replacement = network.insertLink([], LinkMetadata.new().withLinkType(LinkType.Syntax).withLanguage('RML').withDefinition('rml:structure:1:reference').withTerm('2'));
    network.applySubstitution(new SubstitutionRule(parent.references(), parent.references().map(id => Number(id) === Number(old.id()) ? replacement : id)));
    assert.equal(evaluatePortableNatural(network, 'offset', [3]), 5n);
    assert.match(emitPortableNatural(network, 'Rust'), /x \+ 2/);
  });
});
