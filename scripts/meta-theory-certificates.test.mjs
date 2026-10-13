import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CERTIFICATES_PATH, certificateSources, loadCorpus, metaTheoryCertificateArtifacts, theoremDependencies,
} from './generate-meta-theory-certificates.mjs';
import {
  checkEigenScopes, checkMetaTheoryCertificate, metaTheoryCertificateRegistries, produceMetaTheoryCertificate,
} from '../js/src/rml-meta-theory-certificates.mjs';
import { MetaTheoryNative } from '../js/src/rml-meta-theory-native.mjs';

const data = JSON.parse(readFileSync(new URL(`../${CERTIFICATES_PATH}`, import.meta.url), 'utf8'));
const sources = certificateSources();
const registries = metaTheoryCertificateRegistries(sources);
const corpus = loadCorpus();
const clone = value => JSON.parse(JSON.stringify(value));
const record = address => data.theorems.find(item => item.theorem === address);
const LEAN_SET = 'rml.formal.lean.SetSequenceEquivalence.set_sequence_equivalence';
const ROCQ_HEAD = 'rml.formal.rocq.SetSequenceEquivalence.strictly_ascending_head';
const ROCQ_INDUCTION = 'rml.formal.rocq.SetSequenceEquivalence.toOrderedUnique_is_ascending';
const LEAN_INDUCTION = 'rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending';
const ROCQ_CASES = 'rml.formal.rocq.SetSequenceEquivalence.strictly_ascending_tail';
const check = (certificate, address = certificate.theorem, options = {}) => checkMetaTheoryCertificate(
  options.registries ?? registries, certificate, { theoremDependencies: options.dependencies ?? theoremDependencies(corpus, address) });
const rejected = (certificate, pattern, options) => {
  const result = check(certificate, certificate.theorem, options);
  assert.equal(result.accepted, false);
  if (pattern) assert.match(result.problems.join('\n'), pattern);
  return result;
};
const nodes = certificate => certificate.candidate[4];

describe('replayable linked proof certificates for the pinned meta-theory', () => {
  it('regenerates every certificate and status byte-for-byte from preserved proofs', () => {
    assert.equal(`${JSON.stringify(metaTheoryCertificateArtifacts(), null, 2)}\n`,
      readFileSync(new URL(`../${CERTIFICATES_PATH}`, import.meta.url), 'utf8'));
  });

  it('independently re-checks all certified theorems with the linked proof verifier', () => {
    assert.equal(data.theoremCount, 36);
    const certified = data.theorems.filter(item => item.status === 'certified');
    assert.equal(certified.length, data.certified);
    assert.equal(data.certified, 17);
    assert.equal(data.certifiedClosed, 5);
    for (const item of certified) {
      const result = check(item.certificate);
      assert.equal(result.accepted, true, `${item.theorem}: ${result.problems.join('; ')}`);
      assert.equal(result.steps, item.verifierSteps, item.theorem);
    }
    assert.deepEqual(['lean', 'rocq'].map(language => certified.filter(item => item.language === language).length), [7, 10]);
  });

  it('never certifies an admitted proof and states why every other theorem is outside the fragment', () => {
    for (const item of data.theorems) {
      if (item.upstreamProofStatus === 'admitted') assert.equal(item.status, 'outside-fragment', item.theorem);
      if (item.status === 'outside-fragment') {
        assert.equal(typeof item.reason, 'string');
        assert.equal(item.certificate, undefined);
      }
    }
    assert.match(record('rml.formal.lean.SetSequenceEquivalence.mem_toOrderedUnique').reason, /sorry/);
    // A chain that cites an admitted lemma is relative to that admission.
    const relative = record('rml.formal.lean.SetDefinitions.ListToSet_membership').chain;
    assert.equal(relative.status, 'relative');
    assert.deepEqual(relative.relativeTo.map(item => [item.address, item.upstreamProofStatus]),
      [['rml.formal.lean.SetSequenceEquivalence.mem_toOrderedUnique', 'admitted']]);
    assert.equal(record('rml.formal.rocq.MetaDefinitions.meta_network_is_duplet_network').chain.status, 'closed');
  });

  it('rejects a corrupted definition body used by a conversion', () => {
    const body = '(to (rml.formal.lean.SetSequenceEquivalence.StrictlyAscending ?v0)))';
    assert.ok(sources.conversion.includes(body));
    const corrupted = metaTheoryCertificateRegistries({ ...sources,
      conversion: sources.conversion.replace(body, '(to (rml.formal.lean.SetSequenceEquivalence.NoDuplicates ?v0)))') });
    rejected(record(LEAN_SET).certificate, /not convertible/, { registries: corrupted });
  });

  it('rejects binder mutations in eigen-constants and lemma instances', () => {
    const opened = clone(record(LEAN_SET).certificate);
    const forall = opened.instanceRules.find(entry => entry.kind === 'forall-intro');
    forall.rule[2] = JSON.parse(JSON.stringify(forall.rule[2]).replaceAll('"mt-bound-2"', '"mt-bound-0"'));
    rejected(opened, /forall-intro:1: premise is not the opened body/);

    const instance = clone(record(LEAN_SET).certificate);
    const fact = instance.instanceRules.find(entry => entry.kind === 'instance' && entry.rule[3][1] !== 'refl');
    fact.rule[3][2] = fact.rule[3][2] === 'mt-bound-0' ? 'mt-bound-1' : 'mt-bound-0';
    rejected(instance, /verifier rejected/);
  });

  it('rejects removed premises, substituted rules and edited node conclusions', () => {
    const premise = clone(record(LEAN_SET).certificate);
    const withPremises = nodes(premise).find(node => node[5].length > 1);
    withPremises[5] = withPremises[5].slice(1);
    rejected(premise, /verifier rejected/);

    const swapped = clone(record(LEAN_SET).certificate);
    const lemmaNode = nodes(swapped).find(node => node[2].startsWith('lemma:'));
    lemmaNode[2] = lemmaNode[2].endsWith('mem_toOrderedUnique')
      ? 'lemma:rml.formal.lean.SetSequenceEquivalence.toOrderedUnique_is_ascending'
      : 'lemma:rml.formal.lean.SetSequenceEquivalence.mem_toOrderedUnique';
    rejected(swapped, /verifier rejected/);

    const conclusion = clone(record(ROCQ_HEAD).certificate);
    const leaf = nodes(conclusion).find(node => node[2].startsWith('hypothesis:'));
    leaf[3] = ['holds', ['mt-v', 'mt-true']];
    rejected(conclusion, /verifier rejected/);
  });

  it('rejects edited goals, statements and forged conversions', () => {
    const goal = clone(record(ROCQ_HEAD).certificate);
    goal.goal = ['holds', ['mt-v', 'mt-true']];
    rejected(goal, /goal differs/);

    const statement = clone(record(ROCQ_HEAD).certificate);
    statement.statement = ['mt-v', 'mt-true'];
    rejected(statement, /statement differs/);

    const forged = clone(record(ROCQ_HEAD).certificate);
    const conversion = forged.instanceRules.find(entry => entry.kind === 'conversion');
    conversion.rule[2] = [['holds', ['mt-v', 'mt-true']]];
    rejected(forged, /not convertible/);
  });

  it('rejects undeclared dependencies, self-citation and edited dependency lists', () => {
    const certificate = record(LEAN_SET).certificate;
    const dependencies = theoremDependencies(corpus, LEAN_SET);
    rejected(certificate, /not a recorded theorem dependency/,
      { dependencies: dependencies.filter(item => !item.endsWith('mem_toOrderedUnique')) });
    rejected(certificate, /cannot cite itself/, { dependencies: [...dependencies, LEAN_SET] });

    const edited = clone(certificate);
    edited.candidate[5] = edited.candidate[5].slice(0, -1);
    rejected(edited, /verifier rejected/);
  });

  it('certifies list induction and case analysis through discharged locals and checked rewrites', () => {
    for (const address of [ROCQ_INDUCTION, LEAN_INDUCTION, ROCQ_CASES]) {
      const item = record(address);
      assert.equal(item.status, 'certified', `${address}: ${item.reason}`);
      const kinds = new Set(item.certificate.instanceRules.map(entry => entry.kind));
      assert.ok(kinds.has('local'), address);
      assert.ok(kinds.has(address === ROCQ_CASES ? 'cases' : 'induction'), address);
      const structural = item.certificate.instanceRules.find(entry => entry.kind === 'induction' || entry.kind === 'cases');
      assert.ok(structural.rule[2].some(premise => premise[0] === 'discharge'), address);
      // The local is used by a node and discharged by the structural rule, so no root dependency keeps it.
      assert.ok(nodes(item.certificate).some(node => node[2].startsWith('local:')), address);
      assert.ok(!item.certificate.candidate[5].some(dependency => dependency.startsWith('local:')), address);
    }
    assert.ok(record(ROCQ_CASES).certificate.instanceRules.some(entry => entry.kind === 'rewrite'));
  });

  it('rejects a missing, ownerless, misstated or doubly discharged local', () => {
    const missing = clone(record(ROCQ_INDUCTION).certificate);
    missing.instanceRules = missing.instanceRules.filter(entry => entry.kind !== 'local');
    rejected(missing, /missing local/);

    const ownerless = clone(record(ROCQ_INDUCTION).certificate);
    ownerless.instanceRules.push({ kind: 'local', rule: ['local', 'local:extra', ['holds', ['mt-v', 'mt-true']]] });
    rejected(ownerless, /local:extra: local has no discharging rule/);

    const misstated = clone(record(ROCQ_CASES).certificate);
    const cases = misstated.instanceRules.find(entry => entry.kind === 'cases');
    const zero = misstated.instanceRules.find(entry => entry.kind === 'local' && entry.rule[1] === cases.equations[0]);
    zero.rule[2] = misstated.instanceRules.find(entry => entry.kind === 'local' && entry.rule[1] === cases.equations[1]).rule[2];
    rejected(misstated, /local does not state what/);

    const twice = clone(record(ROCQ_CASES).certificate);
    const both = twice.instanceRules.find(entry => entry.kind === 'cases');
    both.equations[1] = both.equations[0];
    both.rule[2][1][1] = both.equations[0];
    rejected(twice, /discharged by more than one rule|premises are not the two discharged cases/);
  });

  it('rejects an induction with a wrong motive, a mistyped target or stale eigen-constants', () => {
    const motive = clone(record(ROCQ_INDUCTION).certificate);
    const induction = motive.instanceRules.find(entry => entry.kind === 'induction');
    induction.rule[2][0] = ['holds', ['mt-v', 'mt-true']];
    rejected(motive, /premises are not the base and step cases of the motive/);

    const typed = clone(record(ROCQ_INDUCTION).certificate);
    const retyped = typed.instanceRules.find(entry => entry.kind === 'induction');
    retyped.domain = ['mt-v', ['mt-list-type', ['mt-v', 'mt-prop-type']]];
    rejected(typed, /is not of type|is not declared/);

    const stale = clone(record(ROCQ_INDUCTION).certificate);
    const restep = stale.instanceRules.find(entry => entry.kind === 'induction');
    restep.head = restep.target[1][1];
    rejected(stale, /must be distinct names/);

    const shared = clone(record(ROCQ_INDUCTION).certificate);
    const reuse = shared.instanceRules.find(entry => entry.kind === 'induction');
    const goalEigen = JSON.stringify(shared.goal).match(/"mt-eigen","([^"]+)"/)?.[1];
    const other = goalEigen === reuse.target[1][1] ? undefined : goalEigen;
    if (other) {
      reuse.tail = other;
      rejected(shared, /not fresh|distinct names/);
    }
  });

  it('rejects a forged rewrite: the linked verifier checks the congruence side condition', () => {
    const forged = clone(record(ROCQ_CASES).certificate);
    const rewrite = forged.instanceRules.find(entry => entry.kind === 'rewrite');
    const [, , [equation, source], , side] = rewrite.rule;
    const bogus = ['mt-v', 'mt-false'];
    rewrite.rule[3] = ['holds', bogus];
    rewrite.rule[4] = [side[0], side[1], side[2], side[3], bogus];
    for (const node of nodes(forged)) if (node[2] === rewrite.rule[1]) node[3] = ['holds', bogus];
    rejected(forged, /verifier rejected/);

    const restated = clone(record(ROCQ_CASES).certificate);
    const loose = restated.instanceRules.find(entry => entry.kind === 'rewrite');
    loose.rule[4] = ['congruent', source[1], source[1], source[1], loose.rule[3][1]];
    rejected(restated, /side condition does not restate the rewrite/);
    assert.equal(equation[0], 'holds');
  });

  it('rejects an eigen-constant escaping through an undischarged local', () => {
    const escaped = clone(record(ROCQ_INDUCTION).certificate);
    const induction = escaped.instanceRules.find(entry => entry.kind === 'induction');
    const node = nodes(escaped).find(item => item[2] === induction.rule[1]);
    node[6] = [...node[6], induction.hypothesis];
    const result = check(escaped);
    assert.equal(result.accepted, false);
    // The eigenvariable condition alone also catches it: the hypothesis mentions the step tail.
    assert.match(checkEigenScopes(escaped.instanceRules, escaped.candidate).join('\n'),
      /eigen-constant escapes through undischarged/);
    assert.deepEqual(checkEigenScopes(record(ROCQ_INDUCTION).certificate.instanceRules, record(ROCQ_INDUCTION).certificate.candidate), []);
  });

  it('rejects a mutated source proof that cites the wrong lemma', () => {
    const fresh = loadCorpus();
    const native = MetaTheoryNative.fromCorpus(fresh, { braceListModules: ['rocq.NetworkExamples'] });
    const declaration = fresh.declarationAt('rml.formal.lean.SetDefinitions.ListToSet_elements_valid');
    const original = produceMetaTheoryCertificate(native, registries, declaration.address);
    assert.equal(original.status, 'produced');
    declaration.proof = declaration.proof.map(token => (token.text === 'toOrderedUnique_is_ascending'
      ? { ...token, text: 'ordered_unique_has_no_dup' } : token));
    const mutated = produceMetaTheoryCertificate(native, registries, declaration.address);
    if (mutated.status === 'produced') {
      const result = check(mutated.certificate, declaration.address, { dependencies: theoremDependencies(fresh, declaration.address) });
      assert.equal(result.accepted, false);
    } else {
      assert.match(mutated.reason, /not a recorded dependency|not a cited theorem/);
    }
  });
});
