import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NATIVE_CASES_PATH, NATIVE_CONVERSION_PATH, NATIVE_COVERAGE_PATH, NATIVE_PRELUDE_PATH, NATIVE_PROGRAM_PATH,
  ablationOutcome, executeNative, expandRequest, metaTheoryNativeArtifacts, validateNativeEvidence,
} from './generate-meta-theory-native.mjs';
import {
  binaryNatural, compactNative, nativeClosure, nativeRegistry, naturalValue, sliceNativeProgram,
} from '../js/src/rml-meta-theory-native.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const prelude = read(NATIVE_PRELUDE_PATH);
const program = read(NATIVE_PROGRAM_PATH);
const cases = JSON.parse(read(NATIVE_CASES_PATH));
const coverage = JSON.parse(read(NATIVE_COVERAGE_PATH));
const clone = value => JSON.parse(JSON.stringify(value));

describe('native linked execution of the pinned meta-theory corpus', () => {
  it('regenerates the program, cases and coverage byte-for-byte from the preserved tokens', () => {
    const artifacts = metaTheoryNativeArtifacts();
    assert.equal(artifacts.program, program);
    assert.equal(artifacts.conversion, read(NATIVE_CONVERSION_PATH));
    assert.equal(`${JSON.stringify(artifacts.cases, null, 2)}\n`, read(NATIVE_CASES_PATH));
    assert.equal(`${JSON.stringify(artifacts.coverage, null, 2)}\n`, read(NATIVE_COVERAGE_PATH));
  });

  it('elaborates every declaration and command with exact dependency links', () => {
    assert.equal(coverage.declarationCount, 229);
    assert.equal(coverage.elaborated, 229);
    assert.equal(coverage.exactDependencies, 229);
    assert.equal(coverage.commandCount, 197);
    assert.equal(coverage.commandsElaborated, 197);
    for (const entry of coverage.declarations) {
      assert.equal(entry.status, 'elaborated', entry.address);
      assert.deepEqual(entry.dependencyCheck.unrecorded, [], entry.address);
      assert.deepEqual(entry.dependencyCheck.unused, [], entry.address);
    }
  });

  it('executes all 90 evaluation commands to values that match the source-stated results', () => {
    const executions = cases.cases.filter(item => item.kind === 'command-execution');
    assert.equal(executions.length, 90);
    assert.equal(executions.every(item => item.value), true);
    assert.equal(coverage.evaluationsExecuted, 90);
    assert.equal(coverage.sourceExpectationsMatched, 52);
    assert.deepEqual(coverage.sourceExpectationsDiffering, []);
    assert.equal(executions.filter(item => item.sourceExpectationNumbersMatch === true).length, 52);
    // Lean returns Option (List Nat) where the Rocq counterparts return list nat.
    assert.equal(coverage.counterpartsAgreeing, 84);
    assert.deepEqual(coverage.counterpartsDiffering, [
      'rml.formal.lean.SequenceDefinitions#command-5-execution', 'rml.formal.lean.SequenceDefinitions#command-6-execution',
      'rml.formal.lean.SequenceDefinitions#command-7-execution', 'rml.formal.rocq.SequenceDefinitions#command-10-execution',
      'rml.formal.rocq.SequenceDefinitions#command-11-execution', 'rml.formal.rocq.SequenceDefinitions#command-12-execution',
    ]);
    const network = executions.find(item => item.id === 'rml.formal.lean.NetworkExamples#command-17-execution');
    assert.equal(network.rendered, '[(121, 1), (21, 2), (1343, 2)]');
  });

  it('re-executes every recorded case and every ablation witness independently', () => {
    assert.deepEqual(validateNativeEvidence({ prelude, program, cases, coverage }), []);
    assert.equal(coverage.executionWitnessed, 150);
    assert.equal(coverage.declarations.filter(entry => entry.executionWitness).length, 150);
  });

  it('rejects a corrupted definition body in the executable program', () => {
    const marker = '# rml.formal.lean.NetworkExamples.';
    const start = program.indexOf(marker);
    assert.notEqual(start, -1);
    const corrupted = program.slice(0, start) + program.slice(start).replace('(mt-add ', '(mt-mul ');
    assert.notEqual(corrupted, program);
    const recorded = { ...cases, programHash: undefined };
    const problems = validateNativeEvidence({ prelude, program: corrupted, cases: recorded, coverage: { ...coverage, programHash: undefined } }, { addresses: [] });
    assert.ok(problems.some(problem => /re-execution differs/.test(problem)), problems.join('\n'));
  });

  it('rejects corrupted prelude semantics', () => {
    const corrupted = prelude.replace('(to (mt-v (mt-b1 ?n))))', '(to (mt-v (mt-b0 ?n))))');
    assert.notEqual(corrupted, prelude);
    const problems = validateNativeEvidence({ prelude: corrupted, program, cases, coverage }, { addresses: [] });
    assert.ok(problems.includes('prelude hash differs from the recorded evidence'));
    assert.ok(problems.some(problem => /re-execution differs/.test(problem)));
  });

  it('rejects forged, unreachable and relabelled execution witnesses', () => {
    const check = (forged, address) => validateNativeEvidence({ prelude, program, cases, coverage: forged },
      { reexecuteCases: false, addresses: [address] });
    // A declaration in a case's closure whose rules that case never needs.
    const unused = clone(coverage);
    const passive = 'rml.formal.lean.NetworkDefinitions.TupleOfReferencesDefault';
    const reaching = cases.cases.find(item => item.value && item.closure.includes(passive));
    assert.ok(reaching, 'some value case reaches TupleOfReferencesDefault statically');
    unused.declarations.find(entry => entry.address === passive).executionWitness = { case: reaching.id, ablation: 'stuck' };
    assert.deepEqual(check(unused, passive), [`${passive}: removing its rules leaves ${reaching.id} unchanged`]);

    // A declaration no executed case reaches at all.
    const unreachable = clone(coverage);
    const isolated = 'rml.formal.lean.SequenceDefinitions.listGetD';
    const other = cases.cases.find(item => item.value && !item.closure.includes(isolated));
    unreachable.declarations.find(entry => entry.address === isolated).executionWitness = { case: other.id, ablation: 'stuck' };
    assert.deepEqual(check(unreachable, isolated), [`${isolated}: witness case does not reach the declaration`]);

    const relabelled = clone(coverage);
    const witnessed = relabelled.declarations.find(entry => entry.executionWitness);
    witnessed.executionWitness.ablation = 'different-value';
    assert.match(check(relabelled, witnessed.address).join('\n'), /ablation outcome stuck differs from different-value/);

    const missing = clone(coverage);
    missing.declarations.find(entry => entry.address === witnessed.address).executionWitness.case = 'no-such-case';
    assert.match(check(missing, witnessed.address).join('\n'), /is missing/);
  });

  it('rejects a case whose recorded result or step count was edited', () => {
    const edited = clone(cases);
    const target = edited.cases.find(item => item.id === 'rml.formal.rocq.NetworkExamples#command-40-execution');
    target.expected = ['mt-v', ['mt-natural', '13']];
    edited.cases.find(item => item.kind === 'closed-normalization').steps += 1;
    const problems = validateNativeEvidence({ prelude, program, cases: edited, coverage }, { addresses: [] });
    assert.equal(problems.filter(problem => /re-execution differs/.test(problem)).length, 2);
  });

  it('slices the program to static closures, and an ablation removes exactly one declaration', () => {
    const item = cases.cases.find(entry => entry.id === 'rml.formal.lean.NetworkExamples#command-17-execution');
    assert.deepEqual(nativeClosure(coverage.declarations, item.references), item.closure);
    const slice = sliceNativeProgram(program, item.closure);
    assert.ok(slice.length < program.length);
    const request = expandRequest(item.request);
    const local = executeNative(nativeRegistry(prelude, slice), request);
    assert.deepEqual(compactNative(local.term), item.expected);
    const removed = item.closure[0];
    const ablated = sliceNativeProgram(program, item.closure.slice(1));
    assert.equal(ablated.includes(`# ${removed}\n`), false);
    assert.notEqual(ablationOutcome(item.expected, executeNative(nativeRegistry(prelude, ablated), request)), 'unchanged');
  });

  it('encodes naturals as canonical little-endian binary links', () => {
    for (const number of [0, 1, 2, 5, 12, 121, 1343, 999_999, 2 ** 40]) {
      assert.equal(naturalValue(binaryNatural(number)), number);
    }
    assert.equal(naturalValue(['mt-b0', 'mt-zero']), undefined);
    assert.deepEqual(binaryNatural(6), ['mt-b0', ['mt-b1', ['mt-b1', 'mt-zero']]]);
    assert.throws(() => binaryNatural(-1), /non-negative/);
    const registry = nativeRegistry(prelude, sliceNativeProgram(program, []));
    const run = term => compactNative(registry.reduceResult('upstream-0.0.3-native', term, { maxSteps: 10_000 }).term);
    const n = number => ['mt-v', binaryNatural(number)];
    assert.deepEqual(run(['mt-add', n(1343), n(999)]), ['mt-v', ['mt-natural', '2342']]);
    assert.deepEqual(run(['mt-sub', n(1343), n(999)]), ['mt-v', ['mt-natural', '344']]);
    assert.deepEqual(run(['mt-sub', n(3), n(9)]), ['mt-v', 'mt-zero']);
    assert.deepEqual(run(['mt-mul', n(121), n(11)]), ['mt-v', ['mt-natural', '1331']]);
    assert.deepEqual(run(['mt-div', n(1343), n(10)]), ['mt-v', ['mt-natural', '134']]);
    assert.deepEqual(run(['mt-div', n(7), n(0)]), ['mt-v', 'mt-zero']);
    assert.deepEqual(run(['mt-less', n(4), n(8)]), ['mt-v', 'mt-true']);
    assert.deepEqual(run(['mt-less-equal', n(8), n(8)]), ['mt-v', 'mt-true']);
    assert.deepEqual(run(['mt-nat-equal', n(8), n(9)]), ['mt-v', 'mt-false']);
    assert.deepEqual(run(['mt-nat-view', binaryNatural(8)]), ['mt-v', ['mt-view-succ', ['mt-natural', '7']]]);
  });
});
