/** Versioned RML extension over the published meta-language public API.
 * Syntax links represent LiNo structure. Layout links carry every source
 * character as structure, bound to the syntax occurrence it spells, so exact
 * source is emitted without a source buffer. Semantic links carry checked RML
 * declarations, binders, roles and reference resolutions; they are recomputed
 * from syntax on every read and never trusted as authority. */
import { createHash } from 'node:crypto';
import { Link } from 'links-notation';
import { LanguageProfile, LinkMetadata, LinkNetwork, LinkType } from '#meta-language';
import {
  formatParsedLink, LinoParseError, MAX_LINO_NESTING_DEPTH,
  parseLinoLinkDocument, prepareLinoSource,
} from './rml-lino-frontend.mjs';

export const RML_STRUCTURE_SCHEMA = 'rml:structure:1';
const definition = kind => `${RML_STRUCTURE_SCHEMA}:${kind}`;
const syntaxKinds = ['document', 'form', 'location', 'reference', 'link', 'compound', 'diagnostic'];
const layoutKinds = ['layout', 'trivia', 'token', 'token-value'];
const semanticKinds = ['provenance', 'layout-refusal', 'semantics', 'declaration', 'binder', 'role', 'resolution'];
const kinds = [...syntaxKinds, ...layoutKinds, ...semanticKinds];

/** Register the extension vocabulary as inspectable upstream profile links. */
export function registerRmlExtension(network, language = 'RML') {
  let profile = LanguageProfile.new(RML_STRUCTURE_SCHEMA, language);
  for (const type of [LinkType.Syntax, LinkType.Semantic, LinkType.SourceToken, LinkType.Trivia]) {
    profile = profile.withLinkType(type);
  }
  for (const kind of kinds) profile = profile.withConcept(definition(kind));
  return profile.declareIn(network);
}

// links() sorts the whole network on every call. Read-only operations scan it
// once per scope; any write happens outside a scope, so no scan goes stale.
let scanned = null;
function linksOf(network) {
  return scanned?.network === network ? scanned.links : network.links();
}

function scoped(network, read) {
  if (scanned) return read();
  scanned = { network, links: network.links() };
  try { return read(); } finally { scanned = null; }
}

function insertAs(network, linkType, kind, term, children = [], language = 'RML') {
  let metadata = LinkMetadata.new().withLinkType(linkType).withLanguage(language).withDefinition(definition(kind));
  if (term !== undefined && term !== null) metadata = metadata.withTerm(term);
  return network.insertLink(children, metadata);
}

function insert(network, kind, term, children = [], language = 'RML') {
  return insertAs(network, LinkType.Syntax, kind, term, children, language);
}

function insertTree(network, tree, language) {
  const kind = tree._isFromPathCombination === true ? 'compound'
    : tree.id !== null && tree.values.length === 0 ? 'reference' : 'link';
  return insert(network, kind, tree.id ?? undefined,
    tree.values.map(child => insertTree(network, child, language)), language);
}

function category(tree) {
  if (tree.id !== null) return 'declaration';
  const head = tree.values[0]?.id;
  if (['namespace', 'theory', 'linked-program', 'foundation'].includes(head)) return 'theory';
  if (['rule', 'linked-rewrite', 'linked-inference'].includes(head)) return 'rule';
  if (['assumption', 'proof-assumption', 'linked-fact', 'axiom'].includes(head)) return 'assumption';
  if (['proof', 'proof-object', 'theorem'].includes(head)) return 'proof';
  if (['substitution', 'substitute', 'rebind'].includes(head)) return 'substitution';
  return 'form';
}

function insertForms(network, forms, language) {
  const roots = forms.map(({ form, link }) => {
    const tree = insertTree(network, link, language);
    const location = insert(network, 'location', `${form.line}:${form.col}:${form.length}`, [], language);
    return insert(network, 'form', category(link), [tree, location], language);
  });
  return insert(network, 'document', RML_STRUCTURE_SCHEMA, roots, language);
}

function sourceProvenance(raw, derivedFrom) {
  const bytes = Buffer.from(raw, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `source-sha256:${digest} utf8-bytes:${bytes.length}${derivedFrom ? ` derived-from:${derivedFrom}` : ''}`;
}

/** Keep invalid input as source, but record its parse diagnostic, never a parsed document. */
export function attachRmlStructure(network, source, language = 'RML') {
  registerRmlExtension(network, language);
  const raw = String(source);
  let forms;
  try {
    forms = parseLinoLinkDocument(raw);
  } catch (error) {
    if (!(error instanceof LinoParseError)) throw error;
    const location = insert(network, 'location', `${error.line}:${error.col}:${error.length}`, [], language);
    return insert(network, 'diagnostic', error.message.slice('LiNo parse failure: '.length), [location], language);
  }
  const document = insertForms(network, forms, language);
  attachLayout(network, raw, document, language);
  return document;
}

// ---------- Exact source layout ----------

// Normalized UTF-16 offset to raw offset: a leading BOM is dropped and CRLF
// or a lone CR reads as one LF, exactly as normalizeLinoSource does.
function rawOffsets(raw) {
  const map = [];
  let at = raw.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (at < raw.length) {
    map.push(at);
    at += raw[at] === '\r' && raw[at + 1] === '\n' ? 2 : 1;
  }
  map.push(raw.length);
  return map;
}

const LAYOUT_SPACE = new Set([' ', '\t', '\n']);
const LAYOUT_BOUNDARY = new Set([' ', '\t', '\n', '(', ')', ':']);

/** Lex every source character into trivia, punctuation, and reference tokens. */
function lexLayout(raw) {
  const { source, prepared, lines, quotes } = prepareLinoSource(raw);
  const at = rawOffsets(raw);
  const quoted = new Map(quotes.map(quote => [quote.start, quote]));
  const segments = raw.charCodeAt(0) === 0xfeff ? [{ kind: 'trivia', start: -1, text: '﻿' }] : [];
  const push = (kind, start, end, value) => segments.push({ kind, start, value, text: raw.slice(at[start], at[end]) });
  let index = 0;
  while (index < source.length) {
    const quote = quoted.get(index);
    if (quote) { push('token', index, quote.end, quote.value); index = quote.end; continue; }
    const character = prepared[index];
    let end = index + 1;
    if (LAYOUT_SPACE.has(character)) {
      while (end < source.length && !quoted.has(end) && LAYOUT_SPACE.has(prepared[end])) end += 1;
      push('trivia', index, end);
    } else if (character === '(' || character === ')' || character === ':') {
      push('trivia', index, end);
    } else {
      while (end < source.length && !quoted.has(end) && !LAYOUT_BOUNDARY.has(prepared[end])) end += 1;
      push('token', index, end, source.slice(index, end));
    }
    index = end;
  }
  return { segments, lines };
}

// Profile capability links name each concept as their definition; they are vocabulary, not records.
const isProfileLink = metadata => (metadata.term ?? '').startsWith('language-profile');

function own(link, language, linkType, kind) {
  const metadata = link?.metadata();
  return Boolean(metadata) && metadata.language === language && metadata.linkType === linkType &&
    metadata.definition === definition(kind) && !isProfileLink(metadata);
}

function ownLinks(network, language, linkType, kind) {
  return linksOf(network).filter(link => own(link, language, linkType, kind));
}

/** The syntax occurrences a source token spells: pre-order, skipping the
 * repeated path prefix that a compound link shares with an earlier line. */
function bindableOccurrences(network, id, out = []) {
  const link = network.link(id);
  const metadata = link.metadata();
  if (metadata.term !== undefined) out.push({ id: Number(id), term: metadata.term });
  const compound = metadata.definition === definition('compound');
  link.references().forEach((child, index) => {
    if (!(compound && index === 0)) bindableOccurrences(network, child, out);
  });
  return out;
}

function planLayout(raw, network, document, language) {
  const { segments, lines } = lexLayout(raw);
  const forms = network.link(document).references().map(id => network.link(id));
  const offsets = new Map(lines.map(entry => [`${entry.line}:${entry.col}`, entry.offset]));
  const starts = [];
  for (const form of forms) {
    const [line, col, length] = network.link(form.references()[1]).metadata().term.split(':').map(Number);
    const start = offsets.get(`${line}:${col}`);
    if (length === 0 || start === undefined || (starts.length && start <= starts[starts.length - 1])) {
      return { refusal: `form ${starts.length + 1} has no traced source position` };
    }
    starts.push(start);
  }
  const tokens = segments.filter(segment => segment.kind === 'token');
  let next = 0;
  for (let index = 0; index < forms.length; index += 1) {
    const expected = bindableOccurrences(network, forms[index].references()[0]);
    while (next < tokens.length && tokens[next].start < starts[index]) next += 1;
    const end = index + 1 === forms.length ? Infinity : starts[index + 1];
    const region = [];
    for (let at = next; at < tokens.length && tokens[at].start < end && region.length < expected.length; at += 1) region.push(tokens[at]);
    for (let occurrence = 0; occurrence < expected.length; occurrence += 1) {
      if (region[occurrence]?.value !== expected[occurrence].term) {
        return { refusal: `form ${index + 1} occurrence ${occurrence + 1} expected ${JSON.stringify(expected[occurrence].term)} but the source token reads ${JSON.stringify(region[occurrence]?.value ?? null)}` };
      }
      region[occurrence].node = expected[occurrence].id;
    }
  }
  return { segments };
}

function insertLayout(network, segments, language) {
  const ids = segments.map(segment => {
    if (segment.kind === 'trivia') return insertAs(network, LinkType.Trivia, 'trivia', segment.text, [], language);
    const value = insertAs(network, LinkType.Trivia, 'token-value', segment.value, [], language);
    return insertAs(network, LinkType.Trivia, 'token', segment.text,
      segment.node === undefined ? [value] : [value, segment.node], language);
  });
  return insertAs(network, LinkType.Trivia, 'layout', RML_STRUCTURE_SCHEMA, ids, language);
}

function attachLayout(network, raw, document, language) {
  const plan = planLayout(raw, network, document, language);
  if (plan.refusal) insertAs(network, LinkType.Semantic, 'layout-refusal', plan.refusal, [document], language);
  else insertLayout(network, plan.segments, language);
  insertAs(network, LinkType.Semantic, 'provenance', sourceProvenance(raw), [document], language);
}

/** Read the layout plane without any parser. Bound tokens must spell every
 * bindable syntax occurrence exactly once, in order; they follow edits to it. */
function readLayout(network, language, bindable) {
  const layouts = ownLinks(network, language, LinkType.Trivia, 'layout');
  if (layouts.length === 0) return null;
  if (layouts.length > 1 || layouts[0].metadata().term !== RML_STRUCTURE_SCHEMA) {
    throw new Error('Expected at most one supported RML exact source layout');
  }
  const occurrences = new Set(bindable);
  const order = [];
  let edited = false;
  const segments = layouts[0].references().map(id => {
    const link = network.link(id);
    const term = link?.metadata().term;
    if (own(link, language, LinkType.Trivia, 'trivia') && link.references().length === 0 && typeof term === 'string') {
      return { kind: 'trivia', text: term };
    }
    const refs = link?.references() ?? [];
    const value = network.link(refs[0]);
    if (!own(link, language, LinkType.Trivia, 'token') || typeof term !== 'string' || refs.length < 1 || refs.length > 2 ||
        !own(value, language, LinkType.Trivia, 'token-value') || value.references().length ||
        typeof value.metadata().term !== 'string') {
      throw new Error(`Invalid RML layout segment ${id}`);
    }
    if (refs.length === 1) return { kind: 'token', text: term, value: value.metadata().term };
    const node = Number(refs[1]);
    if (!occurrences.has(node)) throw new Error(`Dangling or forged RML layout binding ${id} -> ${node}`);
    order.push(node);
    const current = network.link(node).metadata().term;
    const changed = current !== value.metadata().term;
    edited ||= changed;
    return { kind: 'token', node, value: value.metadata().term, text: changed ? Link.escapeReference(current) : term };
  });
  if (order.length !== bindable.length || order.some((node, index) => node !== bindable[index])) {
    throw new Error('Dangling or forged RML layout binding: tokens do not spell the syntax occurrences in order');
  }
  return { segments, edited };
}

function layoutRefusal(network, language) {
  const refusals = ownLinks(network, language, LinkType.Semantic, 'layout-refusal');
  return refusals.length ? refusals[0].metadata().term : null;
}

export function rmlProvenance(network, language = 'RML') {
  return scoped(network, () => rmlProvenanceUnscoped(network, language));
}

function rmlProvenanceUnscoped(network, language) {
  const records = ownLinks(network, language, LinkType.Semantic, 'provenance');
  if (records.length === 0) return null;
  const match = /^source-sha256:([0-9a-f]{64}) utf8-bytes:(\d+)(?: derived-from:([0-9a-f]{64}))?$/.exec(records[0].metadata().term ?? '');
  if (records.length > 1 || !match) throw new Error('Invalid RML source provenance');
  return { sourceSha256: match[1], utf8Bytes: Number(match[2]), derivedFrom: match[3] ?? null };
}

// ---------- Syntax decoding ----------

function locate(network, id, language, kind) {
  const link = network.link(id);
  if (!link || link.metadata().linkType !== LinkType.Syntax || link.metadata().language !== language ||
      (kind && link.metadata().definition !== definition(kind))) {
    throw new Error(`Invalid ${RML_STRUCTURE_SCHEMA} ${kind ?? 'link'} reference ${id}`);
  }
  return link;
}

function locationOf(network, id, language) {
  const link = locate(network, id, language, 'location');
  const match = /^(\d+):(\d+):(\d+)$/.exec(link.metadata().term ?? '');
  if (!match || link.references().length) throw new Error('Invalid RML source location');
  const [line, col, length] = match.slice(1).map(Number);
  if (![line, col, length].every(Number.isSafeInteger) || line < 1 || col < 1) {
    throw new Error('Invalid RML source location');
  }
  return { line, col, length };
}

function readTree(network, id, language, active, depth, budget) {
  if (depth > MAX_LINO_NESTING_DEPTH + 2 || active.has(Number(id))) {
    throw new Error('Cyclic or over-deep RML syntax network');
  }
  active.add(Number(id));
  const link = locate(network, id, language);
  const meta = link.metadata();
  budget.nodes -= 1;
  budget.units -= (meta.term?.length ?? 0) + 1;
  if (budget.nodes < 0 || budget.units < 0) throw new Error('RML syntax expansion limit exceeded');
  const kind = syntaxKinds.find(kind => meta.definition === definition(kind));
  if (!['reference', 'link', 'compound'].includes(kind) ||
      (kind === 'reference' && (meta.term === undefined || link.references().length))) {
    throw new Error('Invalid RML syntax node');
  }
  const values = link.references().map(child => readTree(network, child, language, active, depth + 1, budget));
  active.delete(Number(id));
  return { id: meta.term ?? null, values, _isFromPathCombination: kind === 'compound' };
}

/** Decode solely from ordered Link references. No source token or parser is consulted. */
export function rmlStructuredDocument(network, language = 'RML') {
  return scoped(network, () => rmlStructuredDocumentUnscoped(network, language));
}

function rmlStructuredDocumentUnscoped(network, language) {
  const links = linksOf(network).filter(link => link.metadata().linkType === LinkType.Syntax && link.metadata().language === language);
  const diagnostics = links.filter(link => link.metadata().definition === definition('diagnostic'));
  if (diagnostics.length) {
    const diagnostic = diagnostics[0];
    throw new LinoParseError(diagnostic.metadata().term, locationOf(network, diagnostic.references()[0], language));
  }
  const documents = links.filter(link => link.metadata().definition === definition('document'));
  if (documents.length !== 1 || documents[0].metadata().term !== RML_STRUCTURE_SCHEMA) {
    throw new Error('Expected exactly one supported RML structure document');
  }
  const syntax = links.filter(link => link.metadata().definition?.startsWith(`${RML_STRUCTURE_SCHEMA}:`));
  const budget = { nodes: Math.max(1024, syntax.length * 4),
    units: Math.max(4096, syntax.reduce((total, link) => total + (link.metadata().term?.length ?? 0) + 1, 0) * 4) };
  return documents[0].references().map(id => {
    const form = locate(network, id, language, 'form');
    const refs = form.references();
    if (refs.length !== 2) throw new Error('Invalid RML form arity');
    const link = readTree(network, refs[0], language, new Set(), 0, budget);
    return { category: form.metadata().term, link,
      form: { text: formatParsedLink(link), ...locationOf(network, refs[1], language) } };
  });
}

export function rmlStructuredForms(network, language = 'RML') {
  return rmlStructuredDocument(network, language).map(({ form }) => form.text);
}

/** Emit canonical LiNo from syntax links. Exact formatting lives in the layout plane. */
export function emitRmlFromStructure(network, language = 'RML') {
  const forms = rmlStructuredForms(network, language);
  return forms.length ? `${forms.join('\n')}\n` : '';
}

/** Address-indexed occurrence tree. Every occurrence must have exactly one
 * address; a shared syntax DAG has none and cannot carry identities. */
function syntaxOccurrences(network, language) {
  rmlStructuredDocument(network, language);
  const document = linksOf(network).find(link => own(link, language, LinkType.Syntax, 'document'));
  const nodes = new Map();
  const visit = (id, address, parent, index) => {
    const key = Number(id);
    if (nodes.has(key)) throw new Error(`Shared RML syntax occurrence ${key} has no unique address`);
    const link = network.link(id);
    const metadata = link.metadata();
    const node = { id: key, address, parent, index, term: metadata.term ?? null,
      compound: metadata.definition === definition('compound'), children: [] };
    nodes.set(key, node);
    node.children = link.references().map((child, position) => visit(child, `${address}.${position}`, node, position));
    return node;
  };
  const forms = document.references().map((formId, index) => {
    const form = network.link(formId);
    const root = visit(form.references()[0], String(index), null, 0);
    return { root, category: form.metadata().term };
  });
  return { document, forms, nodes, byAddress: new Map([...nodes.values()].map(node => [node.address, node])) };
}

function bindableList(network, occurrences) {
  return occurrences.forms.flatMap(({ root }) => bindableOccurrences(network, root.id).map(({ id }) => id));
}

/** Exact original source, emitted from layout links alone; edited occurrences use their new spelling. */
export function emitRmlExactSource(network, language = 'RML') {
  return scoped(network, () => emitRmlExactSourceUnscoped(network, language));
}

function emitRmlExactSourceUnscoped(network, language) {
  const occurrences = syntaxOccurrences(network, language);
  const layout = readLayout(network, language, bindableList(network, occurrences));
  if (!layout) {
    const refusal = layoutRefusal(network, language);
    throw new Error(refusal ? `RML exact source layout refused: ${refusal}` : 'No RML exact source layout');
  }
  return layout.segments.map(segment => segment.text).join('');
}

/** 1-based line and code-point column where each bound token starts. */
function layoutPositions(layout) {
  const positions = new Map();
  let line = 1;
  let col = 1;
  layout.segments.forEach((segment, index) => {
    if (index === 0 && segment.text === '﻿') return;
    if (segment.node !== undefined) positions.set(segment.node, { line, col });
    const points = [...segment.text];
    for (let at = 0; at < points.length; at += 1) {
      if (points[at] === '\r' && points[at + 1] === '\n') continue;
      if (points[at] === '\n' || points[at] === '\r') { line += 1; col = 1; } else col += 1;
    }
  });
  return positions;
}

/** Construct an independent network with no source text/tokens/buffer, including after edits.
 * Layout and provenance are carried by occurrence address; checked semantics are recomputed. */
export function rmlStructureOnly(network, language = 'RML') {
  return scoped(network, () => rmlStructureOnlyUnscoped(network, language));
}

function rmlStructureOnlyUnscoped(network, language) {
  const structured = new LinkNetwork();
  registerRmlExtension(structured, language);
  const document = insertForms(structured, rmlStructuredDocument(network, language), language);
  const hasLayout = ownLinks(network, language, LinkType.Trivia, 'layout').length > 0;
  const semantics = rmlSemanticIdentities(network, language);
  if (hasLayout) {
    const before = syntaxOccurrences(network, language);
    const layout = readLayout(network, language, bindableList(network, before));
    const after = syntaxOccurrences(structured, language);
    insertLayout(structured, layout.segments.map(segment => (segment.node === undefined ? segment : {
      ...segment, text: segment.text, value: segment.value,
      node: after.byAddress.get(before.nodes.get(segment.node).address).id,
    })), language);
  }
  const refusal = layoutRefusal(network, language);
  if (refusal) insertAs(structured, LinkType.Semantic, 'layout-refusal', refusal, [document], language);
  const provenance = ownLinks(network, language, LinkType.Semantic, 'provenance');
  if (provenance.length) {
    rmlProvenance(network, language);
    insertAs(structured, LinkType.Semantic, 'provenance', provenance[0].metadata().term, [document], language);
  }
  if (semantics) resolveRmlStructure(structured, language);
  return structured;
}

const SNAPSHOT_TYPES = [LinkType.Syntax, LinkType.Semantic, LinkType.Trivia];

/** A JSON-safe links-network snapshot. Unlike upstream npm 0.46 toLino, it retains metadata. */
export function serializeRmlStructure(network, language = 'RML') {
  const structured = rmlStructureOnly(network, language);
  return JSON.stringify({ schema: RML_STRUCTURE_SCHEMA, language, links: structured.links().map(link => ({
    id: Number(link.id()), references: link.references().map(Number),
    metadata: { linkType: link.metadata().linkType, language: link.metadata().language,
      definition: link.metadata().definition, term: link.metadata().term },
  })) });
}

/** Read a snapshot and check every plane: syntax, layout bindings, provenance and semantic identities. */
export function deserializeRmlStructure(serialized) {
  const snapshot = JSON.parse(serialized);
  if (snapshot.schema !== RML_STRUCTURE_SCHEMA || typeof snapshot.language !== 'string' || !Array.isArray(snapshot.links)) {
    throw new Error('Unsupported RML structure snapshot');
  }
  const network = new LinkNetwork();
  const seen = new Set();
  for (const record of snapshot.links) {
    if (!Number.isSafeInteger(record.id) || record.id < 1 || seen.has(record.id) ||
        !Array.isArray(record.references) || !record.references.every(id => Number.isSafeInteger(id) && id > 0)) {
      throw new Error('Invalid RML structure record');
    }
    seen.add(record.id);
    const metadata = record.metadata;
    if (!metadata || !SNAPSHOT_TYPES.includes(metadata.linkType) ||
        metadata.language !== snapshot.language || typeof metadata.definition !== 'string' ||
        (metadata.term !== undefined && typeof metadata.term !== 'string')) {
      throw new Error('Invalid RML structure metadata');
    }
    network.insertLinkWithOptionalId(record.id, record.references, new LinkMetadata(metadata));
  }
  checkRmlPlanes(network, snapshot.language);
  return network;
}

/** Validate syntax, layout, provenance and semantics, and reject unaccounted extension links. */
export function checkRmlPlanes(network, language = 'RML') {
  return scoped(network, () => checkRmlPlanesUnscoped(network, language));
}

function checkRmlPlanesUnscoped(network, language) {
  rmlStructuredDocument(network, language);
  // Identity planes need an occurrence tree; a bare shared syntax DAG carries none.
  const planes = ['layout', 'semantics'].some(kind => linksOf(network).some(link => link.metadata().language === language &&
    link.metadata().definition === definition(kind) && !isProfileLink(link.metadata())));
  const occurrences = planes ? syntaxOccurrences(network, language) : null;
  const layout = occurrences ? readLayout(network, language, bindableList(network, occurrences)) : null;
  rmlProvenance(network, language);
  rmlSemanticIdentities(network, language);
  const reachable = new Set();
  const mark = id => {
    const key = Number(id);
    if (reachable.has(key)) return;
    reachable.add(key);
    const link = network.link(id);
    if (link?.metadata().definition?.startsWith(`${RML_STRUCTURE_SCHEMA}:`) && link.metadata().linkType !== LinkType.Syntax) {
      link.references().forEach(mark);
    }
  };
  for (const kind of ['layout', 'provenance', 'layout-refusal', 'semantics']) {
    for (const link of linksOf(network)) {
      if (link.metadata().language === language && link.metadata().definition === definition(kind) && !isProfileLink(link.metadata())) mark(link.id());
    }
  }
  for (const link of linksOf(network)) {
    const metadata = link.metadata();
    if (metadata.language === language && metadata.linkType !== LinkType.Syntax && !isProfileLink(metadata) &&
        [...layoutKinds, ...semanticKinds].some(kind => metadata.definition === definition(kind)) && !reachable.has(Number(link.id()))) {
      throw new Error(`Unaccounted RML ${metadata.definition} link ${Number(link.id())}`);
    }
  }
  return { occurrences: occurrences ? occurrences.nodes.size : null, layout: layout ? (layout.edited ? 'edited' : 'exact') : null };
}

// ---------- Semantic identities: declarations, binders, roles, resolutions ----------

const RML_KEYWORDS = new Set([
  'lambda', 'Pi', 'fresh', 'in', 'subst', 'apply', 'type', 'of', 'has', 'probability', 'with', 'proof', 'range',
  'valence', 'namespace', 'import', 'as', 'is', '?', 'mode', 'relation', 'total', 'coverage', 'world', 'inductive',
  'coinductive', 'constructor', 'define', 'case', 'measure', 'lex', 'terminating', 'whnf', 'nf', 'normal-form',
  'template', '+', '-', '*', '/', '<', '<=', '=', '!=', 'and', 'or', 'not', 'both', 'neither', 'nor',
  'rule', 'premise', 'conclusion', 'assumption', 'proof-assumption', 'linked-fact', 'axiom', 'proof-object',
  'theorem', 'step', 'substitution', 'substitute', 'rebind', 'theory', 'linked-program', 'foundation',
  'linked-rewrite', 'linked-inference', 'forall', 'exists', 'Type', 'Prop',
]);
const isLiteral = term => /^-?(\d+(\.\d+)?|\.\d+)$/.test(term);
const isPlain = node => node && node.term !== null && node.children.length === 0;
const isName = term => !RML_KEYWORDS.has(term) && !isLiteral(term);

function bindingParams(binding) {
  if (!binding) return null;
  const children = binding.children;
  if (binding.term !== null && children.length === 1) return [{ site: binding, name: binding.term, types: [children[0]] }];
  if (binding.term !== null) return null;
  if (children.length === 2 && isPlain(children[1]) && !children[1].term.endsWith(',')) {
    if (isPlain(children[0]) ? /^\p{Uppercase}/u.test(children[0].term) : true) {
      return [{ site: children[1], name: children[1].term, types: [children[0]] }];
    }
  }
  if (children.length >= 4 && children.length % 2 === 0 && children.every(isPlain)) {
    const params = [];
    for (let index = 0; index < children.length; index += 2) {
      const [type, name] = [children[index], children[index + 1]];
      const last = index + 2 === children.length;
      if (!/^\p{Uppercase}/u.test(type.term) || name.term.endsWith(',') === last) return null;
      params.push({ site: name, name: last ? name.term : name.term.slice(0, -1), types: [type] });
    }
    return params;
  }
  return null;
}

function binderShape(node) {
  const [head, ...rest] = node.children;
  if (node.term !== null || !isPlain(head)) return null;
  if (['lambda', 'Pi', 'forall', 'exists'].includes(head.term) && rest.length === 2) {
    const params = bindingParams(rest[0]);
    if (params && params.every(param => isName(param.name))) return { kind: head.term, params, body: rest[1] };
  }
  if (head.term === 'fresh' && rest.length === 3 && isPlain(rest[0]) && isName(rest[0].term) && isPlain(rest[1]) && rest[1].term === 'in') {
    return { kind: 'fresh', params: [{ site: rest[0], name: rest[0].term, types: [] }], body: rest[2] };
  }
  return null;
}

const headOf = node => (isPlain(node.children[0]) ? node.children[0].term : null);

/** Recompute RML semantic identities from the occurrence tree. Pure; deterministic in both runtimes. */
function resolveOccurrences(occurrences) {
  const declarations = [];
  const binders = [];
  const roles = [];
  const references = [];
  const declarationSites = new Set();
  occurrences.forms.forEach(({ root, category: kind }) => {
    if (root.term !== null) {
      declarations.push({ kind: 'definition', name: root.term, site: root.address, form: root.address });
      declarationSites.add(root.address);
    } else if (['theory', 'rule', 'assumption', 'proof'].includes(kind) && isPlain(root.children[1]) && isName(root.children[1].term)) {
      declarations.push({ kind, name: root.children[1].term, site: root.children[1].address, form: root.address });
      declarationSites.add(root.children[1].address);
    }
  });
  let theory = null;
  occurrences.forms.forEach(({ root, category: kind }) => {
    if (kind === 'theory') theory = root;
    else if (theory) roles.push({ role: 'theory-member', owner: theory.address, nodes: [root.address] });
    const after = declarationSites.has(root.children[1]?.address) ? 2 : 1;
    root.children.slice(after).forEach(child => {
      if (kind === 'rule') {
        const head = child.children.length ? headOf(child) : null;
        roles.push({ role: head === 'premise' || head === 'conclusion' ? head : 'component', owner: root.address, nodes: [child.address] });
      } else if (kind === 'proof') roles.push({ role: 'proof-step', owner: root.address, nodes: [child.address] });
      else if (kind === 'assumption') roles.push({ role: 'statement', owner: root.address, nodes: [child.address] });
      else if (kind === 'substitution') {
        roles.push(child.term === null && child.children.length === 2
          ? { role: 'substitution-entry', owner: root.address, nodes: child.children.map(entry => entry.address) }
          : { role: 'component', owner: root.address, nodes: [child.address] });
      }
    });
  });
  const named = new Map();
  for (const declaration of declarations) named.set(declaration.name, [...(named.get(declaration.name) ?? []), declaration.site]);
  const resolveName = (node, scope, rule) => {
    if (declarationSites.has(node.address) || !isName(node.term)) return;
    if (rule && /^\?./u.test(node.term)) {
      const local = [...scope].reverse().find(entry => entry.name === node.term) ?? rule.get(node.term);
      if (!local) {
        const binder = { kind: 'pattern', name: node.term, site: node.address, scope: rule.scope };
        binders.push(binder);
        rule.set(node.term, binder);
        return;
      }
      references.push({ address: node.address, name: node.term, status: 'bound', targets: [local.site] });
      return;
    }
    const local = [...scope].reverse().find(entry => entry.name === node.term);
    if (local) { references.push({ address: node.address, name: node.term, status: 'bound', targets: [local.site] }); return; }
    const sites = named.get(node.term) ?? [];
    references.push({ address: node.address, name: node.term,
      status: sites.length === 0 ? 'free' : sites.length === 1 ? 'global' : 'ambiguous', targets: sites });
  };
  const visit = (node, scope, rule) => {
    if (node.children.length === 0) { if (node.term !== null) resolveName(node, scope, rule); return; }
    const shape = binderShape(node);
    if (shape) {
      let inner = scope;
      for (const param of shape.params) {
        for (const type of param.types) visit(type, scope, rule);
        const binder = { kind: shape.kind, name: param.name, site: param.site.address, scope: node.address };
        binders.push(binder);
        inner = [...inner, binder];
      }
      visit(shape.body, inner, rule);
      return;
    }
    for (const child of node.children) visit(child, scope, rule);
  };
  occurrences.forms.forEach(({ root, category: kind }) => {
    const rule = kind === 'rule' ? Object.assign(new Map(), { scope: root.address }) : null;
    visit(root, [], rule);
  });
  return { declarations, binders, roles, references };
}

/** Compute semantic identities from syntax without writing them. */
export function computeRmlSemantics(network, language = 'RML') {
  return scoped(network, () => computeRmlSemanticsUnscoped(network, language));
}

function computeRmlSemanticsUnscoped(network, language) {
  return resolveOccurrences(syntaxOccurrences(network, language));
}

function materialize(network, occurrences, semantics, language) {
  const node = address => occurrences.byAddress.get(address).id;
  const records = new Map();
  const declarations = semantics.declarations.map(item => {
    const id = insertAs(network, LinkType.Semantic, 'declaration', `${item.kind}:${item.name}`, [node(item.site), node(item.form)], language);
    records.set(item.site, id);
    return id;
  });
  const binders = semantics.binders.map(item => {
    const id = insertAs(network, LinkType.Semantic, 'binder', `${item.kind}:${item.name}`, [node(item.site), node(item.scope)], language);
    records.set(item.site, id);
    return id;
  });
  const roles = semantics.roles.map(item => insertAs(network, LinkType.Semantic, 'role', item.role,
    [node(item.owner), ...item.nodes.map(node)], language));
  const references = semantics.references.map(item => insertAs(network, LinkType.Semantic, 'resolution', item.status,
    [node(item.address), ...item.targets.map(site => records.get(site))], language));
  return insertAs(network, LinkType.Semantic, 'semantics', RML_STRUCTURE_SCHEMA,
    [...declarations, ...binders, ...roles, ...references], language);
}

/** Resolution stage: write checked declaration, binder, role and resolution identities. */
export function resolveRmlStructure(network, language = 'RML') {
  const { occurrences, semantics } = scoped(network, () => {
    if (ownLinks(network, language, LinkType.Semantic, 'semantics').length) {
      throw new Error('RML semantic identities are already attached');
    }
    const occurrences = syntaxOccurrences(network, language);
    return { occurrences, semantics: resolveOccurrences(occurrences) };
  });
  materialize(network, occurrences, semantics, language);
  return semantics;
}

function splitKind(term) {
  const at = typeof term === 'string' ? term.indexOf(':') : -1;
  return at < 1 ? null : { kind: term.slice(0, at), name: term.slice(at + 1) };
}

function firstDifference(stored, expected) {
  for (const section of ['declarations', 'binders', 'roles', 'references']) {
    const count = Math.max(stored[section].length, expected[section].length);
    for (let index = 0; index < count; index += 1) {
      const left = JSON.stringify(stored[section][index] ?? null);
      const right = JSON.stringify(expected[section][index] ?? null);
      if (left !== right) return `${section}[${index}]: stored ${left}, resolution requires ${right}`;
    }
  }
  return null;
}

/** Read stored identities and check them against fresh resolution of the syntax.
 * Returns null when the resolution stage has not run. Never trusts stored links. */
export function rmlSemanticIdentities(network, language = 'RML') {
  return scoped(network, () => rmlSemanticIdentitiesUnscoped(network, language));
}

function rmlSemanticIdentitiesUnscoped(network, language) {
  const roots = ownLinks(network, language, LinkType.Semantic, 'semantics');
  if (roots.length === 0) return null;
  if (roots.length > 1 || roots[0].metadata().term !== RML_STRUCTURE_SCHEMA) throw new Error('Expected one supported RML semantic root');
  const occurrences = syntaxOccurrences(network, language);
  const address = (id, record) => {
    const node = occurrences.nodes.get(Number(id));
    if (!node) throw new Error(`Dangling or forged RML semantic identity ${record}: ${Number(id)} is not a syntax occurrence`);
    return node.address;
  };
  const stored = { declarations: [], binders: [], roles: [], references: [] };
  const sites = new Map();
  const records = roots[0].references().map(id => ({ id: Number(id), link: network.link(id) }));
  for (const { id, link } of records) {
    const kind = semanticKinds.find(kind => own(link, language, LinkType.Semantic, kind));
    const refs = link?.references() ?? [];
    if (kind === 'declaration' || kind === 'binder') {
      const parts = splitKind(link.metadata().term);
      if (!parts || refs.length !== 2) throw new Error(`Invalid RML ${kind} identity ${id}`);
      const site = address(refs[0], id);
      sites.set(id, { kind, site });
      stored[`${kind}s`].push(kind === 'declaration'
        ? { kind: parts.kind, name: parts.name, site, form: address(refs[1], id) }
        : { kind: parts.kind, name: parts.name, site, scope: address(refs[1], id) });
    } else if (kind === 'role') {
      if (refs.length < 2) throw new Error(`Invalid RML role identity ${id}`);
      stored.roles.push({ role: link.metadata().term, owner: address(refs[0], id), nodes: refs.slice(1).map(ref => address(ref, id)) });
    } else if (kind !== 'resolution') {
      throw new Error(`Unsupported RML semantic record ${id}`);
    }
  }
  for (const { id, link } of records) {
    if (!own(link, language, LinkType.Semantic, 'resolution')) continue;
    const refs = link.references();
    if (refs.length < 1) throw new Error(`Invalid RML resolution identity ${id}`);
    const at = address(refs[0], id);
    const status = link.metadata().term;
    const targets = refs.slice(1).map(ref => {
      const target = sites.get(Number(ref));
      if (!target) throw new Error(`Dangling or forged RML semantic identity ${id}: ${Number(ref)} is not a declaration or binder record`);
      if ((status === 'bound') !== (target.kind === 'binder')) throw new Error(`RML resolution ${id} status ${status} contradicts its ${target.kind} target`);
      return target.site;
    });
    stored.references.push({ address: at, name: occurrences.byAddress.get(at).term, status, targets });
  }
  const expected = resolveOccurrences(occurrences);
  const difference = firstDifference(stored, expected);
  if (difference) throw new Error(`RML semantic identity mismatch in ${difference}`);
  return expected;
}

// ---------- Stages ----------

export function rmlRepresentationStages(network, language = 'RML') {
  return scoped(network, () => rmlRepresentationStagesUnscoped(network, language));
}

function rmlRepresentationStagesUnscoped(network, language) {
  let parsing = 'parsed';
  let diagnostic = null;
  try { rmlStructuredDocument(network, language); } catch (error) {
    parsing = 'rejected'; diagnostic = error.message;
  }
  const sourceTokens = linksOf(network).some(link => link.metadata().linkType === LinkType.SourceToken);
  let exactSource = 'absent';
  let resolution = 'not-run';
  let openReferences = 0;
  let provenance = null;
  if (parsing === 'parsed') {
    try {
      provenance = rmlProvenance(network, language);
      if (layoutRefusal(network, language)) exactSource = 'refused';
      else if (ownLinks(network, language, LinkType.Trivia, 'layout').length) {
        const layout = readLayout(network, language, bindableList(network, syntaxOccurrences(network, language)));
        const exact = layout.segments.map(segment => segment.text).join('');
        exactSource = !provenance ? 'unverified'
          : sourceProvenance(exact).startsWith(`source-sha256:${provenance.sourceSha256} `) ? 'verified'
            : layout.edited ? 'edited' : 'provenance-mismatch';
      }
    } catch (error) { exactSource = 'rejected'; diagnostic ??= error.message; }
    try {
      const semantics = rmlSemanticIdentities(network, language);
      if (semantics) {
        openReferences = semantics.references.filter(item => item.status === 'free' || item.status === 'ambiguous').length;
        resolution = openReferences ? 'resolved-with-open-references' : 'resolved';
      }
    } catch (error) { resolution = 'rejected'; diagnostic ??= error.message; }
  }
  const preservation = sourceTokens ? 'source-token-plane'
    : ['verified', 'edited', 'unverified', 'provenance-mismatch'].includes(exactSource) ? 'exact-source-structure' : 'canonical-structure';
  return { schema: RML_STRUCTURE_SCHEMA, preservation, exactSource, provenance, parsing, resolution, openReferences,
    elaboration: 'not-run', execution: 'not-run', verification: 'not-run', diagnostic };
}

// ---------- Capture-checked binding rename ----------

function renameError(code, message) {
  return Object.assign(new Error(message), { code });
}

const compareAddress = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length;
};

function renamedTree(tree, address, renames) {
  const id = renames.has(address) ? renames.get(address) : tree.id;
  return { id, values: tree.values.map((child, index) => renamedTree(child, `${address}.${index}`, renames)),
    _isFromPathCombination: tree._isFromPathCombination };
}

/** Rename one declaration or binder (by occurrence address) and every reference resolved to it.
 * The result is accepted only when fresh resolution of the edited structure assigns every
 * occurrence the same status and targets: capture and ambiguity are refused, never repaired. */
export function renameRmlBinding(network, site, replacement, language = 'RML') {
  return scoped(network, () => renameRmlBindingUnscoped(network, site, replacement, language));
}

function renameRmlBindingUnscoped(network, site, replacement, language) {
  const occurrences = syntaxOccurrences(network, language);
  const semantics = rmlSemanticIdentities(network, language) ?? resolveOccurrences(occurrences);
  const target = semantics.binders.find(item => item.site === site) ?? semantics.declarations.find(item => item.site === site);
  if (!target) throw renameError('RML_RENAME_NOT_BINDING', `No RML declaration or binder at ${site}`);
  const name = String(replacement);
  const pattern = target.kind === 'pattern';
  if (!name || !isName(name) || /^\?./u.test(name) !== pattern || name.endsWith(',')) {
    throw renameError('RML_RENAME_INVALID_NAME', `${JSON.stringify(name)} cannot name ${pattern ? 'a rule pattern variable' : 'an RML binding'}`);
  }
  if (semantics.references.some(item => item.status === 'ambiguous' && item.targets.includes(site))) {
    throw renameError('RML_RENAME_AMBIGUOUS', `References to ${target.name} are ambiguous`);
  }
  const renames = new Map();
  const siteNode = occurrences.byAddress.get(site);
  renames.set(site, siteNode.term.endsWith(',') && siteNode.term.slice(0, -1) === target.name ? `${name},` : name);
  for (const item of semantics.references) if (item.targets.length === 1 && item.targets[0] === site) renames.set(item.address, name);
  const documentForms = rmlStructuredDocument(network, language);
  const edited = new LinkNetwork();
  registerRmlExtension(edited, language);
  const document = insertForms(edited, documentForms.map(({ link, form }, index) => ({ form, link: renamedTree(link, String(index), renames) })), language);
  const after = syntaxOccurrences(edited, language);
  const resolved = resolveOccurrences(after);
  const expected = JSON.stringify({ ...semantics, declarations: semantics.declarations.map(item => (item.site === site ? { ...item, name } : item)),
    binders: semantics.binders.map(item => (item.site === site ? { ...item, name } : item)),
    references: semantics.references.map(item => (renames.has(item.address) ? { ...item, name } : item)) });
  if (JSON.stringify(resolved) !== expected) {
    const captured = resolved.references.find((item, index) => JSON.stringify(item) !== JSON.stringify(JSON.parse(expected).references[index]));
    throw renameError('RML_RENAME_CAPTURE', `Renaming ${target.name} to ${name} changes the binding of ${captured ? `${captured.name} at ${captured.address}` : 'an occurrence'}`);
  }
  const layoutBefore = ownLinks(network, language, LinkType.Trivia, 'layout').length
    ? readLayout(network, language, bindableList(network, occurrences)) : null;
  const positions = layoutBefore ? layoutPositions(layoutBefore) : new Map();
  const provenance = rmlProvenance(network, language);
  let source = null;
  if (layoutBefore) {
    insertLayout(edited, layoutBefore.segments.map(segment => {
      if (segment.node === undefined) return segment;
      const at = occurrences.nodes.get(segment.node).address;
      if (!renames.has(at)) return { ...segment, node: after.byAddress.get(at).id };
      return { kind: 'token', text: Link.escapeReference(renames.get(at)), value: renames.get(at), node: after.byAddress.get(at).id };
    }), language);
    source = emitRmlExactSource(edited, language);
    insertAs(edited, LinkType.Semantic, 'provenance', sourceProvenance(source, provenance?.sourceSha256), [document], language);
  }
  materialize(edited, after, resolved, language);
  const edits = [...renames.entries()].filter(([address, term]) => occurrences.byAddress.get(address).term !== term)
    .sort(([a], [b]) => compareAddress(a, b)).map(([address, term]) => {
    const node = occurrences.byAddress.get(address);
    const position = positions.get(node.id) ?? null;
    return { address, from: node.term, to: term, line: position?.line ?? null, col: position?.col ?? null };
  });
  return { network: edited, source, canonical: emitRmlFromStructure(edited, language), edits, semantics: resolved };
}

/** An explicit pending obligation, never target-labelled source or an invented proof. */
export function languageTranslationObligation(source, sourceLanguage, targetLanguage) {
  const languages = ['JavaScript', 'Rust', 'Rocq', 'Lean'];
  if (!languages.includes(sourceLanguage) || !languages.includes(targetLanguage) || sourceLanguage === targetLanguage) {
    throw new Error('Expected two distinct supported language names: JavaScript, Rust, Rocq, Lean');
  }
  return {
    schema: 'rml:translation-obligation:1', status: 'unsupported',
    sourceLanguage, targetLanguage, preservedSource: String(source), targetSource: null,
    obligations: [{ code: 'RML_TRANSLATION_UNIMPLEMENTED',
      stage: 'semantic-lowering',
      description: `No full-language ${sourceLanguage}-to-${targetLanguage} translation is implemented; the portable-natural fragment is separate`,
      requires: ['complete-source-structure', 'binding-and-type-resolution', 'faithful-target-encoding', 'behavior-or-proof-preservation'] }],
  };
}
