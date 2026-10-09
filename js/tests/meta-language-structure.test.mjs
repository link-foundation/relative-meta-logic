import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LinkMetadata, LinkNetwork, LinkType, SubstitutionRule } from '#meta-language';
import {
  attachRmlStructure, deserializeRmlStructure, emitRmlFromStructure, parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage, rmlRepresentationStages, rmlStructuredDocument,
  rmlStructuredForms, rmlStructureOnly, serializeRmlStructure,
} from '../src/rml-meta-language.mjs';
import { parseLinoDocument } from '../src/rml-lino-frontend.mjs';
const corpus = JSON.parse(readFileSync(new URL('../../test-corpus/meta-language/rml-structure.json', import.meta.url), 'utf8'));
const frontend = JSON.parse(readFileSync(new URL('../../test-corpus/lino-frontend/cases.json', import.meta.url), 'utf8'));
const expand = value => Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : part.repeat.repeat(part.times)).join('') : value;

describe('registered RML syntax extension', () => {
  for (const item of corpus.cases) it(item.name, () => {
    const network = parseRmlToMetaLanguage(item.source);
    assert.equal(reconstructRmlFromMetaLanguage(network), item.source);
    const stages = rmlRepresentationStages(network);
    assert.equal(stages.resolution, 'not-run');
    assert.equal(stages.elaboration, 'not-run');
    assert.equal(stages.execution, 'not-run');
    assert.equal(stages.verification, 'not-run');
    if (item.error) {
      assert.equal(stages.parsing, 'rejected');
      assert.equal(stages.diagnostic, item.error);
      assert.throws(() => rmlStructureOnly(network), { message: item.error });
      return;
    }
    assert.equal(stages.parsing, 'parsed');
    assert.deepEqual(rmlStructuredDocument(network).map(form => form.category), item.categories);
    const stripped = rmlStructureOnly(network);
    assert.ok(stripped.links().every(link => link.metadata().linkType !== LinkType.SourceToken));
    assert.equal(stripped.renderSource('RML'), '');
    const restored = deserializeRmlStructure(serializeRmlStructure(stripped));
    assert.deepEqual(rmlStructuredDocument(restored).map(({ form }) => form), parseLinoDocument(item.source));
    const canonical = emitRmlFromStructure(restored);
    assert.deepEqual(parseLinoDocument(canonical).map(form => form.text), rmlStructuredForms(restored));
  });

  it('retains the entire shared frontend semantic/diagnostic corpus without token parsing', () => {
    for (const item of frontend.cases) {
      const source = expand(item.source);
      const network = new LinkNetwork();
      attachRmlStructure(network, source);
      if (item.error) {
        assert.throws(() => rmlStructuredDocument(network), error =>
          error.message === `LiNo parse failure: ${item.error.detail}` || error.message === item.error.message,
        item.name);
      } else {
        assert.deepEqual(rmlStructuredDocument(network).map(({ form }) => form), item.forms, item.name);
        assert.deepEqual(rmlStructuredForms(deserializeRmlStructure(serializeRmlStructure(network))), item.forms.map(form => form.text), item.name);
      }
    }
  });

  it('edits shared graph references and emits changed structure after discarding all source tokens', () => {
    const network = rmlStructureOnly(parseRmlToMetaLanguage('(proof p (premise α) (conclusion α))\n'));
    const old = network.links().find(link => link.metadata().term === 'α' && link.metadata().definition === 'rml:structure:1:reference');
    const replacement = network.insertLink([], LinkMetadata.new().withLinkType(LinkType.Syntax).withLanguage('RML')
      .withDefinition('rml:structure:1:reference').withTerm('β'));
    const parent = network.links().find(link => link.references().some(id => Number(id) === Number(old.id())));
    network.applySubstitution(new SubstitutionRule(parent.references(), parent.references().map(id => Number(id) === Number(old.id()) ? replacement : id)));
    assert.equal(emitRmlFromStructure(network), '(proof p (premise β) (conclusion α))\n');
    assert.equal(rmlRepresentationStages(network).verification, 'not-run');
  });

  it('rejects cycles, dangling references, duplicate document roots, and unknown schema', () => {
    const fresh = () => rmlStructureOnly(parseRmlToMetaLanguage('(a (b c))'));
    const cycle = fresh();
    const reference = cycle.links().find(link => link.metadata().linkType === LinkType.Syntax && link.metadata().definition === 'rml:structure:1:link');
    reference.setReferences([reference.id()]);
    assert.throws(() => emitRmlFromStructure(cycle), /Cyclic/);
    const dangling = fresh();
    dangling.links().find(link => link.metadata().linkType === LinkType.Syntax && link.metadata().definition === 'rml:structure:1:link').setReferences([999999]);
    assert.throws(() => emitRmlFromStructure(dangling), /Invalid.*reference/);
    const duplicate = fresh();
    const document = duplicate.links().find(link => link.metadata().definition === 'rml:structure:1:document' && link.metadata().linkType === LinkType.Syntax);
    duplicate.insertLink(document.references(), document.metadata());
    assert.throws(() => emitRmlFromStructure(duplicate), /exactly one/);
    assert.throws(() => deserializeRmlStructure('{"schema":"future"}'), /Unsupported/);
  });
});

describe('cross-language unsupported obligations', () => {
  it('preserves source and refuses to fabricate code or proofs for all 12 directed paths', async () => {
    const { languageTranslationObligation } = await import('../src/rml-meta-language.mjs');
    const sources = { JavaScript: 'throw new Error("retain effects");', Rust: 'fn f() { panic!("retain effects"); }',
      Lean: 'axiom impossible : False\ntheorem demo : False := impossible', Rocq: 'Axiom impossible : False.\nTheorem demo : False. exact impossible. Qed.' };
    let checked = 0;
    for (const from of Object.keys(sources)) for (const to of Object.keys(sources)) {
      if (from === to) continue;
      const result = languageTranslationObligation(sources[from], from, to);
      assert.equal(result.status, 'unsupported');
      assert.equal(result.preservedSource, sources[from]);
      assert.equal(result.targetSource, null);
      assert.equal(result.obligations[0].code, 'RML_TRANSLATION_UNIMPLEMENTED');
      checked += 1;
    }
    assert.equal(checked, 12);
  });
});

describe('bounded reconstruction of compact shared syntax graphs', () => {
  const cases = JSON.parse(readFileSync(new URL('../../test-corpus/meta-language/expansion-cases.json', import.meta.url), 'utf8')).cases;
  for (const item of cases) it(item.name, () => {
    const records = [];
    const add = (kind, refs, term) => {
      const id = records.length + 1;
      records.push({ id, references: refs, metadata: { linkType: 'Syntax', language: 'RML',
        definition: `rml:structure:1:${kind}`, ...(term === undefined ? {} : { term }) } });
      return id;
    };
    let tree = add('reference', [], item.text.repeat(item.repeat));
    for (let depth = 0; depth < item.depth; depth += 1) tree = add('link', Array(item.fanout).fill(tree));
    const location = add('location', [], '1:1:1');
    const form = add('form', [tree, location], 'form');
    add('document', [form], 'rml:structure:1');
    const snapshot = JSON.stringify({ schema: 'rml:structure:1', language: 'RML', links: records });
    if (item.accepted) {
      const network = deserializeRmlStructure(snapshot);
      assert.ok(emitRmlFromStructure(network).includes(item.text));
      // Import retains the shared references. Structure-only re-encoding is
      // an occurrence-tree projection, not a generic graph identity archive.
      const branch = network.link(item.depth + 1);
      assert.equal(Number(branch.references()[0]), Number(branch.references()[1]));
    } else {
      assert.throws(() => deserializeRmlStructure(snapshot), /RML syntax expansion limit exceeded/);
    }
  });
});
