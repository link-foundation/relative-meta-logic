/** Versioned RML syntax extension over the published meta-language public API.
 * These links represent LiNo structure, not elaborated judgements or proofs. */
import { LanguageProfile, LinkMetadata, LinkNetwork, LinkType } from 'meta-language';
import {
  formatParsedLink, LinoParseError, MAX_LINO_NESTING_DEPTH,
  parseLinoLinkDocument,
} from './rml-lino-frontend.mjs';

export const RML_STRUCTURE_SCHEMA = 'rml:structure:1';
const definition = kind => `${RML_STRUCTURE_SCHEMA}:${kind}`;
const kinds = ['document', 'form', 'location', 'reference', 'link', 'compound', 'diagnostic'];

/** Register the extension vocabulary as inspectable upstream profile links. */
export function registerRmlExtension(network, language = 'RML') {
  let profile = LanguageProfile.new(RML_STRUCTURE_SCHEMA, language);
  for (const type of [LinkType.Syntax, LinkType.Semantic, LinkType.SourceToken, LinkType.Trivia]) {
    profile = profile.withLinkType(type);
  }
  for (const kind of kinds) profile = profile.withConcept(definition(kind));
  return profile.declareIn(network);
}

function insert(network, kind, term, children = [], language = 'RML') {
  return network.insertLink(children, LinkMetadata.new()
    .withLinkType(LinkType.Syntax).withLanguage(language)
    .withDefinition(definition(kind)).withTerm(term));
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

/** Keep invalid input as source, but record its parse diagnostic, never a parsed document. */
export function attachRmlStructure(network, source, language = 'RML') {
  registerRmlExtension(network, language);
  try {
    return insertForms(network, parseLinoLinkDocument(source), language);
  } catch (error) {
    if (!(error instanceof LinoParseError)) throw error;
    const location = insert(network, 'location', `${error.line}:${error.col}:${error.length}`, [], language);
    return insert(network, 'diagnostic', error.message.slice('LiNo parse failure: '.length), [location], language);
  }
}

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
  const kind = kinds.find(kind => meta.definition === definition(kind));
  if (!['reference', 'link', 'compound'].includes(kind) ||
      (kind === 'reference' && (meta.term === undefined || link.references().length))) {
    throw new Error('Invalid RML syntax node');
  }
  const values = link.references().map(child => readTree(network, child, language, active, depth + 1, budget));
  active.delete(Number(id));
  return { id: meta.term ?? null, values, _isFromPathCombination: kind === 'compound' };
}

/** Decode solely from ordered graph links. No source token or parser is consulted. */
export function rmlStructuredDocument(network, language = 'RML') {
  const links = network.links().filter(link => link.metadata().linkType === LinkType.Syntax && link.metadata().language === language);
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

/** Emit canonical LiNo from syntax links. Original formatting lives in the separate source plane. */
export function emitRmlFromStructure(network, language = 'RML') {
  const forms = rmlStructuredForms(network, language);
  return forms.length ? `${forms.join('\n')}\n` : '';
}

/** Construct an independent network with no source text/tokens/buffer, including after edits. */
export function rmlStructureOnly(network, language = 'RML') {
  const structured = new LinkNetwork();
  registerRmlExtension(structured, language);
  insertForms(structured, rmlStructuredDocument(network, language), language);
  return structured;
}

/** A JSON-safe graph snapshot. Unlike upstream npm 0.46 toLino, it retains metadata. */
export function serializeRmlStructure(network, language = 'RML') {
  const structured = rmlStructureOnly(network, language);
  return JSON.stringify({ schema: RML_STRUCTURE_SCHEMA, language, links: structured.links().map(link => ({
    id: Number(link.id()), references: link.references().map(Number),
    metadata: { linkType: link.metadata().linkType, language: link.metadata().language,
      definition: link.metadata().definition, term: link.metadata().term },
  })) });
}

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
    if (!metadata || ![LinkType.Syntax, LinkType.Semantic].includes(metadata.linkType) ||
        metadata.language !== snapshot.language || typeof metadata.definition !== 'string' ||
        (metadata.term !== undefined && typeof metadata.term !== 'string')) {
      throw new Error('Invalid RML structure metadata');
    }
    network.insertLinkWithOptionalId(record.id, record.references, new LinkMetadata(metadata));
  }
  rmlStructuredDocument(network, snapshot.language);
  return network;
}

export function rmlRepresentationStages(network, language = 'RML') {
  let parsing = 'parsed';
  let diagnostic = null;
  try { rmlStructuredDocument(network, language); } catch (error) {
    parsing = 'rejected'; diagnostic = error.message;
  }
  const preservation = network.links().some(link => link.metadata().linkType === LinkType.SourceToken)
    ? 'source-token-plane' : 'canonical-structure';
  return { schema: RML_STRUCTURE_SCHEMA, preservation, parsing,
    resolution: 'not-run', elaboration: 'not-run', execution: 'not-run', verification: 'not-run', diagnostic };
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
