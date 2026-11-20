import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {FormalCorpus} from '../src/rml-formal-corpus.mjs';

const read = name => readFileSync(new URL(`../../lib/meta-theory/${name}`, import.meta.url), 'utf8');
const source = read('upstream-0.0.3.lino');
const foundation = read('upstream-0.0.3-foundation.lino');

test('keeps the four source sorry declarations explicitly admitted', () => {
  const corpus = FormalCorpus.fromRml(source, foundation);
  const admissions = corpus.declarations.filter(item => item.proofStatus === 'admitted');
  assert.deepEqual(admissions.map(item => `${item.language}.${item.symbol}`).sort(), [
    'lean.insertSorted_preserves_ascending', 'lean.mem_insertSorted',
    'lean.mem_toOrderedUnique', 'lean.strictly_ascending_implies_no_dup',
  ]);
  for (const item of admissions) assert.ok(item.proof.some(token => token.text === 'sorry'));
});

test('rejects relabelling an admitted source proof as verified', () => {
  const altered = source.replaceAll('(proof-status admitted)', '(proof-status verified)');
  assert.notEqual(altered, source);
  assert.throws(() => FormalCorpus.fromRml(altered, foundation), /proof status disagrees with its proof object/);
});

test('rejects changed admission proof tokens without corresponding checked source', () => {
  const altered = source.replaceAll('(token identifier 736f727279)', '(token identifier 72666c)');
  assert.notEqual(altered, source);
  assert.throws(() => FormalCorpus.fromRml(altered, foundation), /proof status disagrees with its proof object/);
});

test('rejects inventing admissions for non-admitted source proof objects', () => {
  const altered = source.replaceAll('(proof-status verified)', '(proof-status admitted)');
  assert.notEqual(altered, source);
  assert.throws(() => FormalCorpus.fromRml(altered, foundation), /proof status disagrees with its proof object/);
});
