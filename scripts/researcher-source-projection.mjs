#!/usr/bin/env node
/** Exhaustive, read-only source projection. Preservation is not elaboration or execution. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseRmlToMetaLanguage, reconstructRmlFromMetaLanguage, rmlRepresentationStages, LinkNetwork, LinkType } from '../js/src/rml-meta-language.mjs';
import { LinkMetadata, SourceSpan, ByteRange, Point } from '../js/src/rml-meta-language.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = source => createHash('sha256').update(source).digest('hex');

export function ownedRuntimeSources(repository = root) {
  const files = [];
  const visit = (directory, language, extension) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`owned source enumeration refuses symlinks: ${path}`);
      if (entry.isDirectory()) visit(path, language, extension);
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push({ path: relative(repository, path).replaceAll('\\', '/'), language, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path)) });
    }
  };
  visit(resolve(repository, 'js/src'), 'JavaScript', '.mjs');
  visit(resolve(repository, 'rust/src'), 'Rust', '.rs');
  visit(resolve(repository, 'lib'), 'RML', '.lino');
  return files;
}

const SNAPSHOT_SCHEMA = 'rml-source-network/v1';
const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;
const SNAPSHOT_MAX_LINKS = 500_000;
function ownKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error('invalid source network snapshot fields');
}
function natural(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid source network coordinate');
  return value;
}
function metadataFromJson(data) {
  ownKeys(data, ['linkType', 'term', 'language', 'named', 'definition', 'span', 'flags'], ['named', 'flags']);
  for (const key of ['linkType', 'term', 'language', 'definition']) if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error('invalid source network metadata text');
  if (typeof data.named !== 'boolean') throw new Error('invalid source network named flag');
  ownKeys(data.flags, ['isError', 'hasError', 'isMissing', 'isExtra']);
  if (Object.values(data.flags).some(value => typeof value !== 'boolean')) throw new Error('invalid source network recovery flags');
  let span;
  if (data.span !== undefined) {
    ownKeys(data.span, ['byteRange', 'start', 'end']);
    ownKeys(data.span.byteRange, ['start', 'end']);
    ownKeys(data.span.start, ['row', 'column']); ownKeys(data.span.end, ['row', 'column']);
    const start = natural(data.span.byteRange.start), end = natural(data.span.byteRange.end);
    if (end < start) throw new Error('invalid source network span');
    span = new SourceSpan(new ByteRange(start, end), new Point(natural(data.span.start.row), natural(data.span.start.column)), new Point(natural(data.span.end.row), natural(data.span.end.column)));
  }
  return new LinkMetadata({ ...data, span });
}
export function serializeSourceNetwork(network, { maxBytes = SNAPSHOT_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('snapshot byte bound must be positive');
  const links = network.links().map(link => ({ id: Number(link.id()), references: link.references().map(Number), metadata: link.metadata(), registered: link.metadata().term !== undefined && Number(network.findTerm(link.metadata().term)) === Number(link.id()) })).sort((a, b) => a.id - b.id);
  if (links.length > SNAPSHOT_MAX_LINKS) throw new Error('source network link bound exceeded');
  const serialized = JSON.stringify({ schema: SNAPSHOT_SCHEMA, links });
  if (Buffer.byteLength(serialized) > maxBytes) throw new Error('source network snapshot byte bound exceeded');
  return serialized;
}
export function restoreSourceNetwork(serialized, { maxBytes = SNAPSHOT_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('snapshot byte bound must be positive');
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > maxBytes) throw new Error('source network snapshot byte bound exceeded');
  const snapshot = JSON.parse(serialized);
  ownKeys(snapshot, ['schema', 'links']);
  if (snapshot.schema !== SNAPSHOT_SCHEMA || !Array.isArray(snapshot.links) || snapshot.links.length > SNAPSHOT_MAX_LINKS) throw new Error('invalid source network snapshot schema or link bound');
  const ids = new Set(); let previous = 0; let references = 0;
  for (const record of snapshot.links) {
    ownKeys(record, ['id', 'references', 'metadata', 'registered']);
    if (!Number.isSafeInteger(record.id) || record.id <= previous || typeof record.registered !== 'boolean' || !Array.isArray(record.references)) throw new Error('invalid or duplicate source network identity');
    previous = record.id; ids.add(record.id); references += record.references.length;
    if (references > 2_000_000) throw new Error('source network reference bound exceeded');
  }
  const restored = new LinkNetwork();
  for (const record of snapshot.links) {
    if (record.references.some(id => !Number.isSafeInteger(id) || !ids.has(id))) throw new Error('dangling source network reference');
    const metadata = metadataFromJson(record.metadata);
    if (record.registered) {
      if (metadata.term === undefined) throw new Error('registered source network point has no term');
      const id = restored.insertTypedPoint(metadata.linkType, metadata.term, metadata.definition);
      if (Number(id) !== record.id) throw new Error('unsupported registered point allocation in source snapshot');
      restored.link(id).setReferences(record.references); restored.link(id).setMetadata(metadata);
    } else restored.insertLinkWithOptionalId(record.id, record.references, metadata);
  }
  return restored;
}

export function projectSources(files, { onModule = () => {} } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('source projection requires a nonempty explicit file inventory');
  const seen = new Set();
  return files.map(({ path, language, source }, index) => {
    if (typeof path !== 'string' || !path || seen.has(path)) throw new Error('source paths must be nonempty and unique');
    if (typeof source !== 'string') throw new Error(`source text missing: ${path}`);
    if (!['JavaScript', 'Rust', 'RML'].includes(language)) throw new Error(`unsupported source projection language: ${language}`);
    if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error(`source file byte bound exceeded: ${path}`);
    seen.add(path); onModule({ phase: 'start', path, index, total: files.length });
    let emitted; let syntaxClean; let syntaxNodes; let diagnostics;
    try {
      const representation = language === 'RML' ? parseRmlToMetaLanguage(source) : LinkNetwork.parse(source, language);
      const snapshot = serializeSourceNetwork(representation);
      const restored = restoreSourceNetwork(snapshot);
      // Preserve every public graph field and the named-point registration map,
      // not only text. Reconstruction reads the independently restored graph.
      if (serializeSourceNetwork(restored) !== snapshot) throw new Error('source network metadata round trip differs');
      emitted = language === 'RML' ? reconstructRmlFromMetaLanguage(restored) : restored.renderSource(language);
      syntaxNodes = restored.links().filter(link => link.metadata().linkType === LinkType.Syntax).length;
      if (language === 'RML') {
        const stages = rmlRepresentationStages(restored);
        syntaxClean = stages.parsing === 'parsed'; diagnostics = stages.diagnostic ? [stages.diagnostic] : [];
      } else {
        const verification = restored.verifyFullMatch(); syntaxClean = verification.isClean();
        diagnostics = verification.issues.map(issue => ({ link: Number(issue.linkId), flags: issue.flags }));
      }
    } catch (error) { throw new Error(`source projection failed for ${path}: ${error.message}`, { cause: error }); }
    const result = { path, language, byteLength: Buffer.byteLength(source), sourceSha256: sha256(source), reconstructedSha256: sha256(emitted),
      sourcePreserved: emitted === source, syntaxClean, syntaxNodes, diagnostics,
      elaboration: 'not-run', execution: 'not-run', verification: 'not-run' };
    onModule({ phase: 'end', path, index, total: files.length, result });
    return result;
  });
}
export function projectionReport(files = ownedRuntimeSources(), options = {}) {
  const modules = projectSources(files, options);
  return { schema: 'rml-owned-runtime-projection/v1', scope: ['js/src/**/*.mjs', 'rust/src/**/*.rs', 'lib/**/*.lino'],
    moduleCount: modules.length, preservedCount: modules.filter(item => item.sourcePreserved).length,
    syntaxCleanCount: modules.filter(item => item.syntaxClean).length,
    allSourcesPreserved: modules.every(item => item.sourcePreserved), modules };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/researcher-source-projection.mjs');
  const report = projectionReport(undefined, { onModule: ({ phase, path, index, total }) => {
    if (phase === 'start') console.error(`source projection ${index + 1}/${total}: ${path}`);
  } });
  console.log(JSON.stringify(report, null, 2));
  if (!report.allSourcesPreserved) process.exitCode = 1;
}
