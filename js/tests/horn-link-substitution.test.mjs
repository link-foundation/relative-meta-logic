import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HORN_OPERATIONS } from '../src/rml-horn-resolution.mjs';
import {
  createHornLinkSubstitutionKernel,
  HORN_LINK_SUBSTITUTION_SOURCE,
} from '../src/rml-horn-link-substitution.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { hornObservations } from '../../experiments/definition-replacement/mechanism-matrix.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../../lib/meta-theory/fixed-point-source.lino');
const workload = read('../../test-corpus/lambda-kernel/workload.lino');
const cases = JSON.parse(read('../../test-corpus/lambda-kernel/cases.json'));
const shared = JSON.parse(read('../../test-corpus/kernel-replacement/mechanism-observations.json'));
const replacements = JSON.parse(read('../../test-corpus/kernel-replacement/link-substitution-replacements.json'));
const programs = LinkedProgramRegistry.fromRml(workload).programs;

function replaceClauses(text, replacement) {
  let changed = text;
  for (const [before, after] of replacement.replace) {
    if (changed.split(before).length !== 2) throw new Error(`stale linked clause in ${replacement.id}`);
    changed = changed.replace(before, after);
  }
  return changed;
}
function probe(kernel, term) {
  try {
    return kernel.evaluate(term, { maxSteps: 100_000 }).head;
  } catch (error) {
    if (error.message === 'Horn resolution step bound exceeded') return 'bound-exceeded';
    throw error;
  }
}

test('Horn foundation executes the unchanged lambda-link meta-semantics with the shared observations', () => {
  const observations = hornObservations(source);
  assert.deepEqual(observations, shared.baseline);
  assert.deepEqual(observations.reductions.map(item => item.term), cases.reductions.map(item => item.output));
  assert.deepEqual(observations.proof, cases.proof);
  assert.equal(observations.absentProof, null);
  assert.equal(observations.known, 3);
  assert.equal(observations.derivations.length, 2);
  const baseline = LinkedProgramRegistry.fromRml(workload);
  for (const [index, item] of cases.reductions.entries()) {
    assert.deepEqual(observations.reductions[index].trace,
      baseline.reduce(item.program, item.input).trace.map(({ program, rule }) => ({ program, name: rule })));
  }
});

test('the generic Horn resolver contains none of the linked substitution or workflow predicates', () => {
  const resolver = read('../src/rml-horn-resolution.mjs');
  const host = read('../src/rml-horn-link-substitution.mjs');
  for (const name of ['whnf', 'environment-lookup', 'resolve-binders', 'scope-index', 'machine-',
    'observe-2', 'encode-node', 'decode-node', 'REWRITE_ONCE', 'FIND_KNOWN_PROOF', 'lambda', 'closure']) {
    assert.equal(resolver.includes(name), false, `generic resolver mentions ${name}`);
  }
  for (const name of ['whnf', 'environment-lookup', 'scope-index', 'machine-', 'observe-2', 'REWRITE_ONCE']) {
    assert.equal(host.includes(name), false, `codec host mentions ${name}`);
  }
  const report = createHornLinkSubstitutionKernel(source).trustReport();
  assert.equal(report.bracketAbstraction, false);
  assert.equal(report.combinatorContraction, false);
  assert.equal(report.lambdaMachineHostBranches, false);
  assert.equal(report.fullImplementationClosure, false);
  assert.equal(report.roots, 25);
  assert.equal(report.linkedMechanisms.length, 6);
});

test('linked binder resolution and the linked machine obey lexical scope and call by name', () => {
  const kernel = createHornLinkSubstitutionKernel(source);
  for (const item of replacements.probes) {
    assert.equal(probe(kernel, item.term), replacements.baseline[item.name], item.name);
  }
});

test('replacing linked Link-as-substitution clauses changes execution on the unchanged resolver', () => {
  const original = createHornLinkSubstitutionKernel(source);
  for (const replacement of replacements.replacements) {
    const hornSource = replaceClauses(HORN_LINK_SUBSTITUTION_SOURCE, replacement);
    assert.notEqual(hornSource, HORN_LINK_SUBSTITUTION_SOURCE);
    const changed = createHornLinkSubstitutionKernel(source, { hornSource });
    const observed = Object.fromEntries(replacements.probes.map(item => [item.name, probe(changed, item.term)]));
    assert.deepEqual(observed, replacement.probes, replacement.id);
    assert.notDeepEqual(observed, replacements.baseline, replacement.id);
  }
  // The concurrently live baseline kernel keeps its own linked definition.
  for (const item of replacements.probes) {
    assert.equal(probe(original, item.term), replacements.baseline[item.name]);
  }
});

test('open probe terms, stale clause edits and removed linked clauses are rejected', () => {
  const kernel = createHornLinkSubstitutionKernel(source);
  assert.throws(() => kernel.evaluate({ variable: 'free' }), /no answer/);
  assert.throws(() => kernel.evaluate({ lambda: 'x', body: { variable: 'y' } }), /no answer/);
  assert.throws(() => replaceClauses(HORN_LINK_SUBSTITUTION_SOURCE,
    { id: 'stale', replace: [['(horn-clause missing (missing))', '']] }), /stale linked clause/);
  const withoutLookup = HORN_LINK_SUBSTITUTION_SOURCE.replace(
    '(horn-clause lookup-here (environment-lookup zero (cons ?closure ?environment) ?closure))', '');
  assert.notEqual(withoutLookup, HORN_LINK_SUBSTITUTION_SOURCE);
  const broken = createHornLinkSubstitutionKernel(source, { hornSource: withoutLookup });
  assert.throws(() => broken.reduce(programs, 'rules', ['choose', 'a'], { maxSteps: 2_000_000 }), /no answer|step bound/);
  const withoutBinders = HORN_LINK_SUBSTITUTION_SOURCE.replace(
    '(horn-clause scope-here (scope-choice yes ?name ?scope zero))', '');
  assert.throws(() => createHornLinkSubstitutionKernel(source, { hornSource: withoutBinders }),
    /binder resolution rejected/);
  assert.throws(() => kernel.reduce(programs, 'missing', ['choose', 'a']), /missing/);
  assert.throws(() => kernel.reduce(programs, 'rules', ['choose', 'a'], { fuel: -1 }), /fuel/);
});

test('each generic Horn operation is required by the linked substitution workflow', () => {
  const kernel = createHornLinkSubstitutionKernel(source);
  for (const operation of HORN_OPERATIONS) {
    assert.throws(() => kernel.reduce(programs, 'rules', ['choose', 'a'], { disabledOperations: [operation] }),
      error => error.message === `disabled host semantic operation ${operation}`);
  }
  assert.throws(() => kernel.reduce(programs, 'rules', ['choose', 'a'], { maxSteps: 1000 }), /step bound/);
});
