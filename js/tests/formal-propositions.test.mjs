import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { linkedPropositionSource } from '../src/rml-formal-propositions.mjs';
import { FormalCorpus } from '../src/rml-formal-corpus.mjs';
import { elaboratePropositionDeclaration } from '../src/rml-formal-propositions-parser.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const kernels = { core: read('../../lib/meta-theory/formal-semantics.lino'), indexed: read('../../lib/meta-theory/formal-indexed.lino'),
  records: read('../../lib/meta-theory/formal-records.lino'), propositions: read('../../lib/meta-theory/formal-propositions.lino') };
const data = JSON.parse(read('../../test-corpus/formal-propositions/cases.json'));
const registry = LinkedProgramRegistry.fromRml(linkedPropositionSource(kernels), { executionBasis: 'direct-structural' });

function checkedEnvironment(environment, checked) {
  const seen = new Set();
  while (Array.isArray(environment) && environment[0] === 'fs-global-bind') {
    const [, address, type, value, rest] = environment;
    if (seen.has(address) || !checked.has(address)) return false;
    if (JSON.stringify([type, value]) !== JSON.stringify(checked.get(address))) return false;
    seen.add(address); environment = rest;
  }
  return environment === 'fs-empty';
}

describe('independent linked proposition obligation replay', () => {
  it('rechecks every dependency before all 88 requests, including actual raw-source mutations', () => {
    const checked = new Map();
    for (const sample of data.cases) {
      assert.equal(checkedEnvironment(sample.request.at(-1), checked), true, `unchecked environment ${sample.name}`);
      const result = registry.reduce('formal-proposition-checker', sample.request, { maxSteps: 50_000 });
      assert.deepEqual(result.term, sample.expected, sample.name);
      assert.equal(result.steps, sample.steps, sample.name);
      assert.equal(sample.kind === 'conversion-proof' ? result.term === 'fs-proof-accepted' : result.term?.[0] === 'fs-ok', sample.accepted, sample.name);
      if (sample.kind === 'definition') {
        assert.equal(checked.has(sample.address), false);
        checked.set(sample.address, result.term.slice(1));
      }
    }
    assert.equal(checked.size, 70);
    const address = checked.keys().next().value;
    assert.equal(checkedEnvironment(['fs-global-bind', address, 'forged-type', 'forged-value', 'fs-empty'], checked), false);
  });

  it('needs linked proposition rules to check the retained predicate source', () => {
    const without = LinkedProgramRegistry.fromRml(linkedPropositionSource({ ...kernels, propositions: '(linked-program formal-propositions)' }), { executionBasis: 'direct-structural' });
    const sample = data.cases.find(entry => entry.kind === 'definition' && entry.address.endsWith('.lean.NetworkEquivalence.TupleFunctionEquivalence'));
    const result = without.reduce('formal-proposition-checker', sample.request, { maxSteps: 50_000 });
    assert.notEqual(result.term?.[0], 'fs-ok');
  });

  it('elaborates Lean grouped and Rocq separate binders to the same dependent source obligations', () => {
    const corpus = FormalCorpus.fromRml(read('../../lib/meta-theory/upstream-0.0.3.lino'), read('../../lib/meta-theory/upstream-0.0.3-foundation.lino'));
    for (const symbol of ['TupleFunctionEquivalence', 'TupleListEquivalence', 'DupletFunctionEquivalence', 'DupletListEquivalence']) {
      const lean = elaboratePropositionDeclaration(corpus.declaration('lean', 'NetworkEquivalence', symbol), name => name);
      const rocq = elaboratePropositionDeclaration(corpus.declaration('rocq', 'NetworkEquivalence', symbol), name => name);
      assert.deepEqual(lean, rocq);
    }
  });
});
