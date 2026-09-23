import {
  LinkMetadata,
  LinkNetwork,
  LinkQuery,
  LinkType,
  ParseConfiguration,
  Probability,
  ProbabilisticTruthValue,
  ReplacementRule,
  SubstitutionRule,
  TranslationRule,
  TranslationRuleSet,
  TruthValue,
} from 'meta-language';
import { leaves } from './cst.mjs';
import { parseJs, printJs } from './cst-js.mjs';
import { evaluate, parseLino } from './rml-links.mjs';

const RML_META_LANGUAGE = 'RML';
const JAVA_SCRIPT_LANGUAGE = 'JavaScript';
const JS_IDENTIFIER_RE = /^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u;
const JS_IDENTIFIER_TAG = 'lino-cst.js.ident';

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertJavaScriptIdentifier(value, role) {
  if (!JS_IDENTIFIER_RE.test(value)) {
    throw new Error(`${role} must be a JavaScript identifier`);
  }
}

function defaultConfiguration(configuration) {
  return configuration ?? ParseConfiguration.default();
}

function linkIdValue(id) {
  return typeof id?.asU64 === 'function' ? id.asU64() : Number(id);
}

function advanceSourceLocation(location, text) {
  const next = { ...location };

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    const character = String.fromCodePoint(codePoint);

    if (character === '\r' && text[index + 1] === '\n') {
      next.offset += 2;
      next.line += 1;
      next.column = 1;
      index += 1;
    } else if (character === '\r' || character === '\n') {
      next.offset += 1;
      next.line += 1;
      next.column = 1;
    } else {
      next.offset += character.length;
      next.column += 1;
      index += character.length - 1;
    }
  }

  return next;
}

/**
 * Parse RML source into the shared meta-language lossless network.
 */
function parseRmlToMetaLanguage(source, options = {}) {
  return LinkNetwork.parse(
    String(source),
    options.language ?? RML_META_LANGUAGE,
    defaultConfiguration(options.configuration),
  );
}

function reconstructRmlFromMetaLanguage(network) {
  return network.reconstructText();
}

function parseRmlLinksViaMetaLanguage(source, options = {}) {
  return parseLino(reconstructRmlFromMetaLanguage(parseRmlToMetaLanguage(source, options)));
}

function rmlMetaLanguageParityReport(source, options = {}) {
  const text = String(source);
  const language = options.language ?? RML_META_LANGUAGE;
  const network = parseRmlToMetaLanguage(text, options);
  const reconstructed = reconstructRmlFromMetaLanguage(network);
  const directLinks = parseLino(text);
  const metaLinks = parseLino(reconstructed);
  const direct = evaluate(text, options.evaluationOptions ?? {});
  const meta = evaluate(reconstructed, options.evaluationOptions ?? {});

  return {
    language,
    reconstructed,
    networkLinkCount: network.len(),
    roundTripOk: reconstructed === text,
    directLinks,
    metaLinks,
    linkParityOk: sameJson(directLinks, metaLinks),
    directResults: direct.results,
    metaResults: meta.results,
    directDiagnostics: direct.diagnostics,
    metaDiagnostics: meta.diagnostics,
    evaluationParityOk: sameJson(direct.results, meta.results) &&
      sameJson(direct.diagnostics, meta.diagnostics),
  };
}

function rewriteJavaScriptIdentifierViaMetaLanguage(source, from, to) {
  assertJavaScriptIdentifier(from, 'from');
  assertJavaScriptIdentifier(to, 'to');

  // Keep the package boundary explicit: meta-language owns the lossless
  // source network, while RML's JavaScript CST supplies the lexical precision
  // that meta-language 0.46 does not yet expose for strings and comments.
  const network = LinkNetwork.parse(
    String(source),
    JAVA_SCRIPT_LANGUAGE,
    ParseConfiguration.default(),
  );
  const cst = parseJs(network.reconstructText());
  const matches = [];
  let location = { offset: 0, line: 1, column: 1 };

  for (const leaf of leaves(cst)) {
    const originalText = leaf.text;

    if (leaf.kind === 'token' && leaf.tag === JS_IDENTIFIER_TAG && originalText === from) {
      const start = { ...location };
      const end = advanceSourceLocation(start, originalText);
      matches.push({ from, to, start, end });
      leaf.text = to;
    }

    location = advanceSourceLocation(location, originalText);
  }

  const report = {
    replacements: matches,
    isEmpty() {
      return this.replacements.length === 0;
    },
    substitution() {
      return undefined;
    },
  };

  return {
    source: printJs(cst),
    matchCount: matches.length,
    changed: matches.length > 0,
    matches,
    report,
  };
}

function metaLanguageSubstitutionSmoke() {
  const network = new LinkNetwork();
  const a = network.insertPoint('a');
  const b = network.insertPoint('b');
  const relation = network.insertLink(
    [a],
    LinkMetadata.new().withLinkType(LinkType.Relation),
  );
  const report = network.applySubstitution(new SubstitutionRule([a], [b]));
  const changed = network.link(relation)
    ?.references()
    .some(reference => linkIdValue(reference) === linkIdValue(b)) ?? false;

  return {
    updated: report.updated().length,
    changed,
  };
}

function renderMetaLanguageTranslationSmoke(source = '(namespace self)') {
  const network = parseRmlToMetaLanguage(source);
  const rules = new TranslationRuleSet('rml-smoke').withRule(
    new TranslationRule(
      'any-source-token',
      LinkQuery.byType(LinkType.SourceToken).withTerm('('),
    ).withTemplate('text', 'translated'),
  );

  return network.reconstructTextAsWithRules('text', ParseConfiguration.default(), rules);
}

function metaLanguageTruthSmoke() {
  const half = ProbabilisticTruthValue.fromRatio(1, 2);

  return {
    conjunction: TruthValue.True.and(TruthValue.Unknown).toString(),
    probabilityBasisPoints: Probability.fromRatio(1, 4).basisPoints(),
    probabilisticAndBasisPoints: half.and(half).trueProbability().basisPoints(),
  };
}

function metaLanguageFeatureReport(source = '(namespace self)\n(? (a = a))\n') {
  return {
    packageName: 'meta-language',
    rml: rmlMetaLanguageParityReport(source),
    substitution: metaLanguageSubstitutionSmoke(),
    translation: renderMetaLanguageTranslationSmoke('(namespace self)'),
    truth: metaLanguageTruthSmoke(),
  };
}

export {
  LinkNetwork,
  LinkQuery,
  LinkType,
  ParseConfiguration,
  Probability,
  ProbabilisticTruthValue,
  ReplacementRule,
  SubstitutionRule,
  TranslationRule,
  TranslationRuleSet,
  TruthValue,
  metaLanguageFeatureReport,
  metaLanguageSubstitutionSmoke,
  metaLanguageTruthSmoke,
  parseRmlLinksViaMetaLanguage,
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
  renderMetaLanguageTranslationSmoke,
  rewriteJavaScriptIdentifierViaMetaLanguage,
  rmlMetaLanguageParityReport,
};
