import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewriteJavaScriptIdentifierViaMetaLanguage } from '../src/rml-meta-language.mjs';
const corpus = JSON.parse(readFileSync(new URL('../../test-corpus/meta-language/identifier-rewrites.json', import.meta.url), 'utf8'));
describe('shared capture/shadowing-aware conservative rename corpus', () => {
  for (const item of corpus.cases) it(item.name, () => {
    if (item.error) {
      assert.throws(() => rewriteJavaScriptIdentifierViaMetaLanguage(item.source, item.from, item.to), error => error.code === item.error);
      return;
    }
    const result = rewriteJavaScriptIdentifierViaMetaLanguage(item.source, item.from, item.to);
    assert.equal(result.source, item.expected);
    assert.equal(result.matchCount, item.count);
    assert.equal(result.changed, item.count > 0);
    assert.equal(result.syntaxValidated, false);
    if (item.starts) assert.deepEqual(result.matches.map(match => match.start), item.starts);
  });
  it('rejects a reserved word as the new binding name', () => {
    assert.throws(() => rewriteJavaScriptIdentifierViaMetaLanguage('let x = 1;', 'x', 'class'), /must be a JavaScript identifier/);
  });
});
