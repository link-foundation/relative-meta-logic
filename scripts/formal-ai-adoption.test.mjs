import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ownedRuntimeSources, projectSources, projectionReport, serializeSourceNetwork, restoreSourceNetwork } from './researcher-source-projection.mjs';
import { parseRmlToMetaLanguage, LinkNetwork, LinkType } from '../js/src/rml-meta-language.mjs';
import { LinkMetadata, SourceSpan, ByteRange, Point } from '../js/vendor/meta-language/js/src/index.js';
import { TypedSemanticArchive } from '../js/src/rml-semantic-archive.mjs';
import { TypedLinkNetwork } from '../js/src/rml-theory-network.mjs';
import { runResearcherWorkflow } from '../examples/researcher-workflow.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('formal-ai map explicitly evaluates all four requested upstream ideas against pinned source', () => {
  const map = JSON.parse(read('docs/case-studies/issue-183/formal-ai-adoption.json'));
  assert.equal(map.upstream.revision, 'efb6ddb603e870253d7cb36b4ce31b292b215255');
  assert.deepEqual(map.decisions.map(item => item.topic), ['whole-source-projection', 'typed-events', 'context-separation', 'dependency-recalculation']);
  for (const item of map.decisions) {
    assert.ok(item.adopted.length && item.rejected.length && item.rationale.length);
    assert.ok(item.sources.every(source => source.startsWith(`https://github.com/link-assistant/formal-ai/blob/${map.upstream.revision}/`)));
    for (const path of item.implementation) assert.ok(read(path).length > 0);
    for (const evidence of item.tests) assert.ok(read(evidence.path).includes(evidence.name));
  }
});

test('whole-source projection preserves every explicit module independently of syntax validity', () => {
  const files = [{ path: 'first.mjs', language: 'JavaScript', source: '// comment stays\nconst amount = 1;\n' },
    { path: 'second.rs', language: 'Rust', source: 'fn value() -> u64 { 7 }\n' },
    { path: 'bad.mjs', language: 'JavaScript', source: 'function ( {' }];
  const report = projectionReport(files);
  assert.equal(report.moduleCount, 3); assert.equal(report.preservedCount, 3);
  assert.equal(report.modules[2].syntaxClean, false);
  assert.ok(report.modules[2].diagnostics.length > 0);
  for (const row of report.modules) {
    assert.equal(row.sourceSha256, row.reconstructedSha256);
    assert.equal(row.elaboration, 'not-run'); assert.equal(row.verification, 'not-run');
  }
  const changed = projectSources([{ ...files[0], source: files[0].source.replace('1;', '2;') }]);
  assert.notEqual(changed[0].sourceSha256, report.modules[0].sourceSha256);
  assert.throws(() => projectSources([]), /nonempty/);
  assert.throws(() => projectSources([{ ...files[0], language: 'Unknown' }]), /unsupported source projection language/);
  assert.throws(() => projectSources([files[0], files[0]]), /unique/);
  assert.throws(() => projectSources([{ path: 'missing.mjs', language: 'JavaScript' }]), /source text missing/);
});

test('linked runtime source projection preserves comments and structured roles after network serialization', () => {
  const source = '# Preserve this source comment.\n(linked-program sample)\n(linked-fact sample seed (judgement (ready)))\n';
  const [result] = projectSources([{ path: 'lib/sample.lino', language: 'RML', source }]);
  assert.equal(result.sourcePreserved, true); assert.equal(result.syntaxClean, true);
  assert.ok(result.syntaxNodes > 2); assert.equal(result.execution, 'not-run');
  const [malformed] = projectSources([{ path: 'lib/bad.lino', language: 'RML', source: '(linked-program sample' }]);
  assert.equal(malformed.sourcePreserved, true); assert.equal(malformed.syntaxClean, false);
});

test('owned source inventory includes nested modules and refuses symbolic-link substitution', () => {
  const root = mkdtempSync(join(tmpdir(), 'rml-source-inventory-'));
  try {
    mkdirSync(join(root, 'js/src/nested'), { recursive: true }); mkdirSync(join(root, 'rust/src'), { recursive: true }); mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'js/src/nested/first.mjs'), 'const a = 1;');
    writeFileSync(join(root, 'rust/src/lib.rs'), 'fn main() {}');
    assert.deepEqual(ownedRuntimeSources(root).map(item => item.path), ['js/src/nested/first.mjs', 'rust/src/lib.rs']);
    writeFileSync(join(root, 'js/src/bad.mjs'), Buffer.from([255]));
    assert.throws(() => ownedRuntimeSources(root), /encoded data|UTF-8/);
    rmSync(join(root, 'js/src/bad.mjs'));
    symlinkSync('lib.rs', join(root, 'rust/src/alias.rs'));
    assert.throws(() => ownedRuntimeSources(root), /refuses symlinks/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('typed record transport rejects hidden event metadata and does not impose an ontology', () => {
  const blank = TypedSemanticArchive.fromNetwork(new TypedLinkNetwork());
  assert.equal(blank.doublet('Type'), null);
  const fixture = JSON.parse(read('test-corpus/semantic-archive/graph.json'));
  const archive = new TypedSemanticArchive(fixture.snapshot, { roots: fixture.roots });
  const restored = TypedSemanticArchive.deserialize(archive.serialize());
  assert.deepEqual(restored.snapshot(), archive.snapshot());
  assert.throws(() => new TypedSemanticArchive({ ...fixture.snapshot, eventKind: 'implicit-authority' }), /unrepresented metadata/);
  const missing = structuredClone(fixture.snapshot); missing.links = missing.links.filter(item => item.address !== 'proof');
  assert.throws(() => new TypedSemanticArchive(missing, { roots: fixture.roots }), /dangling/);
});

test('context-local recalculation leaves another version and the original workspace intact', () => {
  const { report } = runResearcherWorkflow({ executionBasis: 'direct-structural' });
  assert.deepEqual(report.invalidation, [
    { action: 'rechecked', changed: true, status: 'unknown' },
    { action: 'kept', changed: false, status: 'refuted' },
  ]);
  assert.equal(report.originalStatus, 'proved');
  assert.equal(report.proof.accepted, true); assert.equal(report.proof.replayMatches, true);
});


test('source graph JSON transport preserves metadata and named points while rejecting corruption', () => {
  const network = parseRmlToMetaLanguage('# exact comment\n(linked-program sample)\n');
  const snapshot = serializeSourceNetwork(network);
  assert.equal(serializeSourceNetwork(restoreSourceNetwork(snapshot)), snapshot);
  const mutate = update => { const value = JSON.parse(snapshot); update(value); return JSON.stringify(value); };
  assert.throws(() => restoreSourceNetwork(mutate(value => value.links.push(value.links[0]))), /identity/);
  assert.throws(() => restoreSourceNetwork(mutate(value => { value.links[0].references = [999999]; })), /dangling/);
  assert.throws(() => restoreSourceNetwork(mutate(value => { value.links[0].metadata.hiddenAuthority = true; })), /fields/);
  assert.throws(() => restoreSourceNetwork(mutate(value => { value.links[0].metadata.flags.isError = 'true'; })), /flags/);
  assert.throws(() => restoreSourceNetwork(mutate(value => { value.links.find(row => row.metadata.span).metadata.span.byteRange.end = -1; })), /coordinate/);
  assert.throws(() => restoreSourceNetwork(snapshot, { maxBytes: 16 }), /byte bound/);
  assert.throws(() => serializeSourceNetwork(network, { maxBytes: 16 }), /byte bound/);
  const point = new LinkNetwork(); point.insertPoint('named');
  const invalid = JSON.parse(serializeSourceNetwork(point)); invalid.links[0].id = 2; invalid.links[0].references = [2];
  assert.throws(() => restoreSourceNetwork(JSON.stringify(invalid)), /point allocation/);
});

test('source JSON transport restores a network larger than the LiNo reader bound without raising that bound', () => {
  const source = '"'.repeat(5 * 1024 * 1024);
  const network = new LinkNetwork();
  network.insertLink([], new LinkMetadata({ linkType: LinkType.SourceToken, language: 'RML', term: source,
    span: new SourceSpan(new ByteRange(0, source.length), new Point(0, 0), new Point(0, source.length)) }));
  const snapshot = serializeSourceNetwork(network);
  assert.ok(Buffer.byteLength(snapshot) > 10 * 1024 * 1024);
  assert.equal(restoreSourceNetwork(snapshot).renderSource('RML'), source);
});
