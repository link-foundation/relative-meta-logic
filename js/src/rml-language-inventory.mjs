/** Construct inventory of the upstream native JavaScript, Rust, Lean and Rocq grammars.
 * Every grammar rule is classified on one coverage axis; observed exercise counts come
 * from actually building construct trees for a shared corpus. Acceptance by a native
 * grammar is recorded as such, never as compiler, kernel or runtime acceptance. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { languageSupport, nativeConstructTree, nativeGrammarRuleConcepts } from '#meta-language';
import { META_LANGUAGE_SOURCE_REVISION } from './rml-upstream-language.mjs';

export const LANGUAGE_CONSTRUCT_INVENTORY_SCHEMA = 'rml:language-construct-inventory:1';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLASSIFIER_PATH = 'docs/case-studies/issue-183/language-construct-classifier.json';
export const INVENTORY_PATH = 'docs/case-studies/issue-183/language-constructs.json';
export const CORPUS_PATH = 'test-corpus/meta-language/construct-corpus.json';
const readJson = path => JSON.parse(readFileSync(`${ROOT}${path}`, 'utf8'));
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

/** Fingerprint of the rule/concept list a runtime's grammar API reports. */
export function ruleConceptFingerprint(rules) {
  return sha256(rules.map(({ rule, concept }) => `${rule}\t${concept ?? ''}\n`).join(''));
}

/** First-match classification; reports unclassified rules and patterns that match nothing. */
export function classifyConstructs(patterns, rules) {
  const compiled = patterns.map(([axis, pattern]) => ({ axis, pattern, regex: new RegExp(pattern) }));
  const used = new Set();
  const unclassified = [];
  const constructs = rules.map(({ rule, concept }) => {
    const match = compiled.find(({ regex }) => regex.test(rule));
    if (!match) { unclassified.push(rule); return { rule, concept, axis: null }; }
    used.add(match.pattern);
    return { rule, concept, axis: match.axis };
  });
  return { constructs, unclassified, deadPatterns: compiled.filter(({ pattern }) => !used.has(pattern)).map(({ axis }) => axis) };
}

/** Rule kinds (normal, silent, token) read from the vendored grammar the API was built from. */
export function nativeRuleKinds(grammar) {
  const text = readFileSync(`${ROOT}js/vendor/meta-language/js/src/data/native-grammars/${grammar.replace(/^native-/, '')}.lino`, 'utf8');
  return { text, kinds: Object.fromEntries([...text.matchAll(/^\(rule (\S+) (\S+)/gm)].map(match => [match[1], match[2]])) };
}

/** Every corpus program with its language: vendored files, conformance sections, inline programs. */
export function constructCorpusPrograms(corpus = readJson(CORPUS_PATH)) {
  const programs = corpus.files.map(({ language, path }) => ({ language, name: path, source: readFileSync(`${ROOT}${path}`, 'utf8'), accepted: null }));
  const conformance = readJson(corpus.conformance.path);
  for (const section of corpus.conformance.sections) {
    conformance[section].forEach((item, index) => {
      const language = item.language ?? item.name;
      if (typeof item.source === 'string') programs.push({ language, name: `${section}[${index}]`, source: item.source, accepted: null });
    });
  }
  return [...programs, ...corpus.programs.map(program => ({ ...program }))];
}

function constructKinds(grammar, source) {
  let tree;
  try { tree = nativeConstructTree(grammar, source); } catch { return null; }
  if (!tree) return null;
  const counts = new Map();
  const walk = node => { counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1); node.children.forEach(walk); };
  walk(tree);
  return counts;
}

/** Build the inventory from the classifier, the upstream grammar API and the corpus. */
export function buildLanguageConstructInventory({ classifier = readJson(CLASSIFIER_PATH), corpus = readJson(CORPUS_PATH) } = {}) {
  const programs = constructCorpusPrograms(corpus);
  const languages = Object.entries(classifier.languages).map(([language, { grammar, patterns }]) => {
    const rules = nativeGrammarRuleConcepts(grammar);
    const { text, kinds } = nativeRuleKinds(grammar);
    const { constructs, unclassified, deadPatterns } = classifyConstructs(patterns, rules);
    const counts = new Map();
    const refused = [];
    const unexpected = [];
    for (const program of programs.filter(item => item.language === language)) {
      const seen = constructKinds(grammar, program.source);
      if (!seen) refused.push(program.name);
      if (program.accepted !== null && (seen !== null) !== program.accepted) unexpected.push(program.name);
      for (const [kind, count] of seen ?? []) counts.set(kind, (counts.get(kind) ?? 0) + count);
    }
    const rows = constructs.map(({ rule, concept, axis }) => [rule, concept ?? null, kinds[rule] ?? null, axis, counts.get(rule) ?? 0]);
    const observable = rows.filter(row => row[2] !== 'silent');
    const byAxis = Object.fromEntries(Object.keys(classifier.axes).map(axis => {
      const members = rows.filter(row => row[3] === axis);
      return [axis, { constructs: members.length, observable: members.filter(row => row[2] !== 'silent').length,
        exercised: members.filter(row => row[2] !== 'silent' && row[4] > 0).length }];
    }));
    const support = languageSupport(language);
    return {
      language, grammar, ruleConceptSha256: ruleConceptFingerprint(rules), grammarTextSha256: sha256(text),
      upstreamDeclaration: { version: support.version, edition: support.edition, sourceBytes: support.sourceBytes,
        concreteSyntax: support.concreteSyntax, bindingResolution: support.bindingResolution,
        typeElaboration: support.typeElaboration, dynamicExtensions: support.dynamicExtensions, proofSyntax: support.proofSyntax },
      rules: rows.length, observable: observable.length,
      exercised: observable.filter(row => row[4] > 0).length,
      programs: programs.filter(item => item.language === language).length,
      refusedPrograms: refused, unexpectedAcceptance: unexpected, unclassified, deadPatterns, byAxis,
      unexercised: observable.filter(row => row[4] === 0).map(row => row[0]),
      constructs: rows,
    };
  });
  return {
    schema: LANGUAGE_CONSTRUCT_INVENTORY_SCHEMA,
    metaLanguageRevision: META_LANGUAGE_SOURCE_REVISION,
    classifier: CLASSIFIER_PATH, corpus: CORPUS_PATH,
    columns: ['rule', 'concept', 'ruleKind', 'axis', 'corpusOccurrences'],
    boundary: 'Classification and native-grammar construct trees only. Exercised means the upstream native grammar built that construct for a corpus program; it does not establish compiler, kernel or runtime acceptance, resolution, elaboration, execution, verification or translation of the construct.',
    languages,
  };
}

export function renderLanguageConstructInventory(inventory) {
  const rows = language => language.constructs.map(row => `      ${JSON.stringify(row)}`).join(',\n');
  const languages = inventory.languages.map(language => {
    const { constructs, ...summary } = language;
    const head = JSON.stringify(summary, null, 2).replace(/\n}$/, '').replace(/\n/g, '\n    ');
    return `    ${head},\n      "constructs": [\n${rows(language)}\n      ]\n    }`;
  });
  const { languages: _, ...top } = inventory;
  return `${JSON.stringify(top, null, 2).replace(/\n}$/, '')},\n  "languages": [\n${languages.join(',\n')}\n  ]\n}\n`;
}
