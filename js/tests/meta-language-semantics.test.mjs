import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LinkType } from '#meta-language';
import {
  checkRmlPlanes, computeRmlSemantics, deserializeRmlStructure, emitRmlExactSource, emitRmlFromStructure,
  parseRmlToMetaLanguage, renameRmlBinding, rmlProvenance, rmlRepresentationStages, rmlSemanticIdentities,
  rmlStageReport, rmlStructureOnly, rmlStructuredForms, serializeRmlStructure,
} from '../src/rml-meta-language.mjs';
import { parseLinoDocument } from '../src/rml-lino-frontend.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../../test-corpus/meta-language/${name}`, import.meta.url), 'utf8'));
const corpus = read('rml-semantics.json');
const rewrites = read('rml-binding-rewrites.json');
const frontend = JSON.parse(readFileSync(new URL('../../test-corpus/lino-frontend/cases.json', import.meta.url), 'utf8'));
const expand = value => Array.isArray(value) ? value.map(part => typeof part === 'string' ? part : part.repeat.repeat(part.times)).join('') : value;

describe('rml:structure:1 semantic identities and exact source after discarding the buffer', () => {
  for (const item of corpus.cases) it(item.name, () => {
    const network = parseRmlToMetaLanguage(item.source);
    const stages = rmlRepresentationStages(network);
    assert.equal(stages.resolution, item.resolution);
    assert.equal(stages.exactSource, item.exactSource);
    assert.equal(stages.elaboration, 'not-run');
    assert.equal(stages.execution, 'not-run');
    assert.equal(stages.verification, 'not-run');
    if (item.error) {
      assert.equal(stages.parsing, 'rejected');
      assert.equal(stages.diagnostic, item.error);
      assert.equal(rmlSemanticIdentities(network), null);
      return;
    }
    assert.deepEqual(rmlSemanticIdentities(network), item.semantics);
    // Discard every source token and the buffer: only syntax, layout, provenance and semantic links remain.
    const restored = deserializeRmlStructure(serializeRmlStructure(rmlStructureOnly(network)));
    assert.ok(restored.links().every(link => link.metadata().linkType !== LinkType.SourceToken));
    assert.equal(restored.renderSource('RML'), '');
    assert.equal(emitRmlExactSource(restored), item.source);
    assert.deepEqual(rmlSemanticIdentities(restored), item.semantics);
    const restoredStages = rmlRepresentationStages(restored);
    assert.equal(restoredStages.preservation, 'exact-source-structure');
    assert.equal(restoredStages.exactSource, 'verified');
    assert.equal(restoredStages.resolution, item.resolution);
    assert.equal(rmlProvenance(restored).utf8Bytes, Buffer.byteLength(item.source));
    assert.deepEqual(rmlStructuredForms(restored), parseLinoDocument(item.source).map(form => form.text));
  });

  it('round-trips the whole shared frontend corpus byte-exactly from layout links', () => {
    let exact = 0;
    for (const item of frontend.cases) {
      const source = expand(item.source);
      if (item.error || source.length > 100000) continue;
      const restored = deserializeRmlStructure(serializeRmlStructure(parseRmlToMetaLanguage(source)));
      assert.equal(emitRmlExactSource(restored), source, item.name);
      assert.equal(rmlRepresentationStages(restored).exactSource, 'verified', item.name);
      exact += 1;
    }
    assert.ok(exact > 60);
  });

  it('separates parsing, resolution, elaboration, execution and verification outcomes', () => {
    const network = parseRmlToMetaLanguage('(a: a is a)\n(? (a = a))\n(lambda (Natural x) (+ x y))\n');
    const parsed = rmlStageReport(network);
    assert.equal(parsed.parsing, 'parsed');
    assert.equal(parsed.resolution, 'resolved-with-open-references');
    assert.equal(parsed.execution, 'not-run');
    const executed = rmlStageReport(network, { execute: true });
    assert.equal(executed.execution, 'executed');
    assert.equal(executed.executionInput, 'exact-source');
    assert.equal(executed.executionResults, 1);
    assert.equal(executed.elaboration, 'not-run');
    assert.equal(executed.verification, 'not-run');
    const rejected = rmlStageReport(parseRmlToMetaLanguage('(a'), { execute: true });
    assert.equal(rejected.parsing, 'rejected');
    assert.equal(rejected.resolution, 'not-run');
    assert.equal(rejected.execution, 'not-run');
  });

  it('computes identities from syntax alone without writing links', () => {
    const network = rmlStructureOnly(parseRmlToMetaLanguage('(lambda (Natural x) x)\n'));
    const before = network.len();
    assert.deepEqual(computeRmlSemantics(network).references, [
      { address: '0.1.0', name: 'Natural', status: 'free', targets: [] },
      { address: '0.2', name: 'x', status: 'bound', targets: ['0.1.1'] },
    ]);
    assert.equal(network.len(), before);
    assert.deepEqual(checkRmlPlanes(network), { occurrences: 6, layout: 'exact' });
  });
});

function addresses(snapshot) {
  const byId = new Map(snapshot.links.map(record => [record.id, record]));
  const document = snapshot.links.find(record => record.metadata.linkType === 'Syntax' && record.metadata.definition === 'rml:structure:1:document');
  const out = new Map();
  const walk = (id, address) => {
    out.set(address, id);
    byId.get(id).references.forEach((child, index) => walk(child, `${address}.${index}`));
  };
  document.references.forEach((form, index) => walk(byId.get(form).references[0], String(index)));
  return { out, document };
}

const records = (snapshot, kind) => snapshot.links.filter(record => record.metadata.definition === `rml:structure:1:${kind}` &&
  !(record.metadata.term ?? '').startsWith('language-profile'));

export function mutateSnapshot(snapshot, mutation) {
  const { out: at, document } = addresses(snapshot);
  const resolution = () => records(snapshot, 'resolution').find(record => record.references[0] === at.get(mutation.address));
  switch (mutation.kind) {
    case 'retarget':
      resolution().references[1] = records(snapshot, 'binder').find(record => record.references[0] === at.get(mutation.site)).id;
      break;
    case 'retarget-record':
      resolution().references[1] = records(snapshot, 'resolution').find(record => record !== resolution()).id;
      break;
    case 'forge-occurrence':
      resolution().references[0] = records(snapshot, 'layout')[0].id;
      break;
    case 'dangling':
      resolution().references[1] = 999999;
      break;
    case 'status':
      resolution().metadata.term = mutation.status;
      break;
    case 'unaccounted':
      snapshot.links.push({ id: Math.max(...snapshot.links.map(record => record.id)) + 1, references: [at.get('0')],
        metadata: { linkType: 'Semantic', language: 'RML', definition: 'rml:structure:1:resolution', term: 'free' } });
      break;
    case 'layout-swap': {
      const [first, second] = records(snapshot, 'token').filter(record => record.references.length === 2);
      [first.references[1], second.references[1]] = [second.references[1], first.references[1]];
      break;
    }
    case 'refusal':
      snapshot.links = snapshot.links.filter(record => !['layout', 'trivia', 'token', 'token-value']
        .some(kind => record.metadata.definition === `rml:structure:1:${kind}` && record.metadata.linkType === 'Trivia'));
      snapshot.links.push({ id: Math.max(...snapshot.links.map(record => record.id)) + 1, references: [document.id],
        metadata: { linkType: 'Semantic', language: 'RML', definition: 'rml:structure:1:layout-refusal', term: mutation.reason } });
      break;
    case 'provenance': {
      const record = records(snapshot, 'provenance')[0];
      record.metadata.term = record.metadata.term.replace(/source-sha256:(.)/, (_, digit) => `source-sha256:${digit === '0' ? '1' : '0'}`);
      break;
    }
    default:
      throw new Error(`unknown mutation ${mutation.kind}`);
  }
  return JSON.stringify(snapshot);
}

describe('forged, dangling and wrong-binder identities are rejected, never trusted', () => {
  for (const mutation of corpus.mutations) it(mutation.name, () => {
    const snapshot = JSON.parse(serializeRmlStructure(parseRmlToMetaLanguage(mutation.source)));
    const mutated = mutateSnapshot(snapshot, mutation);
    if (mutation.exactSource) {
      const network = deserializeRmlStructure(mutated);
      assert.equal(rmlRepresentationStages(network).exactSource, mutation.exactSource);
      assert.equal(emitRmlFromStructure(network), emitRmlFromStructure(parseRmlToMetaLanguage(mutation.source)));
      if (mutation.error) assert.throws(() => emitRmlExactSource(network), { message: mutation.error });
      return;
    }
    assert.throws(() => deserializeRmlStructure(mutated), error => error.message.includes(mutation.error), mutation.name);
  });
});

describe('capture-checked RML binding rewrites over the exact layout', () => {
  for (const item of rewrites.cases) it(item.name, () => {
    const network = parseRmlToMetaLanguage(item.source);
    if (item.error) {
      assert.throws(() => renameRmlBinding(network, item.site, item.to), error => error.code === item.error);
      return;
    }
    const result = renameRmlBinding(network, item.site, item.to);
    assert.equal(result.source, item.expected);
    assert.equal(result.canonical, item.canonical);
    assert.deepEqual(result.edits, item.edits);
    // The edited network is itself checked: identities, layout and a derived provenance.
    const restored = deserializeRmlStructure(serializeRmlStructure(result.network));
    assert.equal(emitRmlExactSource(restored), item.expected);
    assert.equal(rmlRepresentationStages(restored).exactSource, 'verified');
    assert.equal(rmlProvenance(restored).derivedFrom, rmlProvenance(network).sourceSha256);
    assert.deepEqual(rmlSemanticIdentities(restored), result.semantics);
    const reparsed = parseRmlToMetaLanguage(item.expected);
    assert.deepEqual(rmlSemanticIdentities(reparsed), result.semantics);
  });
});
