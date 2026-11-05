import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  metaLanguageFeatureReport,
  metaLanguageSubstitutionSmoke,
  metaLanguageTruthSmoke,
  parseRmlLinksViaMetaLanguage,
  parseRmlToMetaLanguage,
  reconstructRmlFromMetaLanguage,
  renderMetaLanguageTranslationSmoke,
  rewriteJavaScriptIdentifierViaMetaLanguage,
  rmlMetaLanguageParityReport,
} from '../src/rml-meta-language.mjs';

const RML_SAMPLE = [
  '(a: a is a)',
  '((a = a) has probability 1)',
  '(? (a = a))',
].join('\n') + '\n';

describe('meta-language support', () => {
  it('represents RML source losslessly through meta-language', () => {
    const network = parseRmlToMetaLanguage(RML_SAMPLE);

    assert.ok(network.len() >= RML_SAMPLE.length);
    assert.strictEqual(reconstructRmlFromMetaLanguage(network), RML_SAMPLE);
    assert.deepStrictEqual(parseRmlLinksViaMetaLanguage(RML_SAMPLE), [
      '(a: a is a)',
      '((a = a) has probability 1)',
      '(? (a = a))',
    ]);
  });

  it('keeps RML parser and evaluator results identical after meta-language round trip', () => {
    const report = rmlMetaLanguageParityReport(RML_SAMPLE);

    assert.strictEqual(report.language, 'RML');
    assert.strictEqual(report.roundTripOk, true);
    assert.strictEqual(report.linkParityOk, true);
    assert.strictEqual(report.evaluationParityOk, true);
    assert.deepStrictEqual(report.directResults, [1]);
    assert.deepStrictEqual(report.metaResults, report.directResults);
    assert.deepStrictEqual(report.metaDiagnostics, report.directDiagnostics);
  });

  it('keeps an unmatched parenthesis inside a quote or a comment through the round trip', () => {
    const source = "# it's (\n(a \"(\" b)\n";
    const report = rmlMetaLanguageParityReport(source);

    assert.strictEqual(reconstructRmlFromMetaLanguage(parseRmlToMetaLanguage(source)), source);
    assert.deepStrictEqual(parseRmlLinksViaMetaLanguage(source), ["(a '(' b)"]);
    assert.strictEqual(report.roundTripOk, true);
    assert.strictEqual(report.linkParityOk, true);
    assert.strictEqual(report.evaluationParityOk, true);
  });

  it('rejects source that is not LiNo with the position of the failure', () => {
    for (const read of [parseRmlLinksViaMetaLanguage, rmlMetaLanguageParityReport, metaLanguageFeatureReport]) {
      assert.throws(() => read('(a: a is a)\n(? (a = a)'), {
        name: 'LinoParseError',
        message: 'LiNo parse failure: unexpected end of input',
        line: 2,
        col: 11,
      });
    }
  });

  it('rewrites JavaScript identifiers through meta-language query and replace', () => {
    const rewritten = rewriteJavaScriptIdentifierViaMetaLanguage(
      'const oldName = call(oldName);\n',
      'oldName',
      'newName',
    );

    assert.strictEqual(rewritten.matchCount, 2);
    assert.strictEqual(rewritten.changed, true);
    assert.strictEqual(rewritten.source, 'const newName = call(newName);\n');
  });

  it('does not rewrite identifier spellings inside JavaScript strings or comments', () => {
    const rewritten = rewriteJavaScriptIdentifierViaMetaLanguage(
      'const x = 1; const s = "x"; // x\n',
      'x',
      'y',
    );

    assert.strictEqual(rewritten.matchCount, 1);
    assert.strictEqual(rewritten.changed, true);
    assert.strictEqual(rewritten.report.isEmpty(), false);
    assert.strictEqual(rewritten.source, 'const y = 1; const s = "x"; // x\n');
    assert.deepStrictEqual(rewritten.matches, [{
      from: 'x',
      to: 'y',
      start: { offset: 6, line: 1, column: 7 },
      end: { offset: 7, line: 1, column: 8 },
    }]);
  });

  it('rewrites Unicode JavaScript identifiers and preserves literal spellings', () => {
    const rewritten = rewriteJavaScriptIdentifierViaMetaLanguage(
      'const α = α + 1; const literal = "α";\n',
      'α',
      'β',
    );

    assert.strictEqual(rewritten.matchCount, 2);
    assert.strictEqual(rewritten.changed, true);
    assert.strictEqual(
      rewritten.source,
      'const β = β + 1; const literal = "α";\n',
    );
    assert.deepStrictEqual(rewritten.matches.map(match => match.start), [
      { offset: 6, line: 1, column: 7 },
      { offset: 10, line: 1, column: 11 },
    ]);
  });

  it('exposes structural substitution support from meta-language', () => {
    const report = metaLanguageSubstitutionSmoke();

    assert.ok(report.updated >= 1);
    assert.strictEqual(report.changed, true);
  });

  it('renders through meta-language translation rules', () => {
    assert.strictEqual(
      renderMetaLanguageTranslationSmoke('(namespace self)'),
      'translated',
    );
  });

  it('exposes meta-language truth semantics used by RML planning', () => {
    assert.deepStrictEqual(metaLanguageTruthSmoke(), {
      conjunction: 'Unknown',
      probabilityBasisPoints: 2500,
      probabilisticAndBasisPoints: 2500,
    });
  });

  it('summarizes the available meta-language features for issue 181', () => {
    const report = metaLanguageFeatureReport(RML_SAMPLE);

    assert.strictEqual(report.packageName, 'meta-language');
    assert.strictEqual(report.rml.roundTripOk, true);
    assert.strictEqual(report.rml.evaluationParityOk, true);
    assert.strictEqual(report.substitution.changed, true);
    assert.strictEqual(report.translation, 'translated');
    assert.strictEqual(report.truth.probabilisticAndBasisPoints, 2500);
  });
});
