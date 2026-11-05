import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLambdaKernel, LAMBDA_MACHINE_OPERATIONS } from '../src/rml-lambda-kernel.mjs';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { comparisonReport, runWorkload, source, replacement, workload, cases } from '../../experiments/lambda-kernel/compare.mjs';

const rules = LinkedProgramRegistry.fromRml(workload).programs.get('rules').rewrites;

test('direct lambda source preserves the shared S/K reductions judgements and full proof trees', () => {
  const report = comparisonReport();
  assert.equal(report.sameObservations, true);
  assert.deepEqual(report.lambda.observations.reductions.map(item => item.term), cases.reductions.map(item => item.output));
  assert.deepEqual(report.lambda.observations.proof, cases.proof);
  assert.equal(report.lambda.observations.absentProof, null);
  assert.equal(report.lambda.observations.fixedPoint, true);
  assert.equal(report.lambda.observations.known, 3);
  assert.equal(report.lambda.observations.derivations.length, 2);
  assert.deepEqual(report.lambda.observedOperations, [...LAMBDA_MACHINE_OPERATIONS].sort());
  assert.equal(report.lambda.linkedCapabilities.length, 6);
  assert.deepEqual(report.sk.observedOperations, ['contract-k-link', 'contract-s-link']);
  assert.ok(report.lambda.transitionCount > 0 && report.sk.transitionCount > 0);
});

test('direct D to D prime recursively replaces substitution without compiling or rebinding another kernel', () => {
  const original = createLambdaKernel(source);
  const changed = createLambdaKernel(replacement);
  const request = ['input', 'value'];
  const before = original.lambdaRewriteOnce(request, rules);
  const after = changed.lambdaRewriteOnce(request, rules);
  assert.deepEqual(before.step.term, ['pair', ['nested', 'value'], 'done']);
  assert.deepEqual(after.step.term, ['done', ['value', 'nested'], 'pair']);
  assert.deepEqual(before.observedOperations, after.observedOperations);
  assert.deepEqual(original.lambdaRewriteOnce(request, rules).step, before.step);
  assert.equal(changed.lambdaKernelSourceReport().runtimeNodes, 1449);
  assert.equal(original.lambdaKernelSourceReport().runtimeNodes, 1446);
  assert.equal(changed.lambdaKernelSourceReport().bracketAbstraction, false);
});

test('each declared external lambda transition is required by the measured workload', () => {
  const kernel = createLambdaKernel(source);
  for (const operation of LAMBDA_MACHINE_OPERATIONS) {
    assert.throws(() => runWorkload(kernel, 'lambda', { disabledOperations: [operation] }),
      error => error.message === `disabled host semantic operation ${operation}`);
  }
  const report = kernel.lambdaTrustReport();
  assert.equal(report.minimalityEstablished, false);
  assert.equal(report.genuinelyDifferentFoundationEstablished, false);
  assert.equal(report.fullImplementationClosure, false);
  assert.equal(report.externalSemanticServices.length, 5);
  assert.equal(report.externalBoundaryServices.length, 5);
});

test('lambda environments preserve lexical capture shadowing and lazy argument evaluation', () => {
  const { LambdaRunner } = createLambdaKernel(source);
  const v = variable => ({ variable });
  const l = (lambda, body) => ({ lambda, body });
  const a = (left, right) => [left, right];
  const runner = new LambdaRunner();
  // ((λx.λy.x) outer) inner keeps the binding captured before y arrived.
  assert.equal(runner.headNormalize(a(a(l('x', l('y', v('x'))), 'outer'), 'inner')), 'outer');
  assert.equal(runner.headNormalize(a(a(l('x', l('x', v('x'))), 'outer'), 'inner')), 'inner');
  const omegaHalf = l('x', a(v('x'), v('x')));
  const omega = a(omegaHalf, omegaHalf);
  assert.equal(runner.headNormalize(a(a(l('x', l('y', v('x'))), 'kept'), omega)), 'kept');
  assert.throws(() => new LambdaRunner({ maxTransitions: 50 }).headNormalize(omega), /transition limit/);
  assert.throws(() => runner.headNormalize(v('unbound')), /unbound lambda variable/);
});

test('lambda source loader rejects malformed references roots cycles free variables and counts', () => {
  const invalid = [
    ['', /declaration/],
    [source.replace('rml-lambda-link-dag-v1', 'forged-schema'), /metadata/],
    [source.replace('(node-count 1446)', '(node-count 100001)'), /resource bounds/],
    [source.replace('(node-count 1446)', '(node-count 1447)'), /counts/],
    [source.replace('(bootstrap-source-root TRUE n2)', '(bootstrap-source-root FALSE n2)'), /duplicate.*root/],
    [source.replace('(bootstrap-source-root FIND_KNOWN_PROOF n1445)', '(bootstrap-source-root UNKNOWN n1445)'), /missing.*FIND_KNOWN_PROOF/],
    [source.replace('(lambda yes n1)', '(lambda yes n999999)'), /unknown.*node/],
    [source.replace('(lambda yes n1)', '(lambda yes n2)'), /cyclic/],
    [source.replace('(variable yes)', '(variable unbound)'), /unbound.*root/],
    [source.replace('(lambda yes n1)', '(lambda yes rMISSING)'), /unknown earlier.*root/],
    [source + '\n(unrecognized payload)\n', /form/],
    [source + '\n(bootstrap-source-node n0 (variable yes))\n', /duplicate.*node/],
  ];
  for (const [text, expected] of invalid) assert.throws(() => createLambdaKernel(text), expected);
});

test('lambda runtime refuses zero invalid and exhausted transition budgets', () => {
  const kernel = createLambdaKernel(source);
  for (const maxTransitions of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => kernel.lambdaRewriteOnce(['input', 'value'], rules, { maxTransitions }), /positive safe integer/);
  }
  assert.throws(() => kernel.lambdaRewriteOnce(['input', 'value'], rules, { maxTransitions: 1 }),
    error => error.reductionFailure === 'transition-limit');
});

test('direct lambda module runs with the compiler and combinator modules unavailable', () => {
  const module = new URL('../src/rml-lambda-kernel.mjs', import.meta.url).href;
  const sourceUrl = new URL('../../test-corpus/lambda-kernel/mirror-substitution.lino', import.meta.url).href;
  const loader = `export async function resolve(specifier, context, next) {
    if (/combinator|\\.ski(?:$|[?#])/.test(specifier)) throw new Error('compiler/SK unavailable');
    return next(specifier, context);
  }`;
  const script = `import { readFileSync } from 'node:fs';
    import { createLambdaKernel } from ${JSON.stringify(module)};
    const kernel = createLambdaKernel(readFileSync(new URL(${JSON.stringify(sourceUrl)}), 'utf8'));
    console.log(JSON.stringify(kernel.lambdaRewriteOnce(['input', 'value'], [{ program: 'p', name: 'r',
      pattern: ['input', '?x'], replacement: ['pair', ['nested', '?x'], 'done'] }]).step.term));`;
  const child = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader',
    `data:text/javascript,${encodeURIComponent(loader)}`, '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['done', ['value', 'nested'], 'pair']);
  const implementation = readFileSync(new URL('../src/rml-lambda-kernel.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(implementation, /serializeCombinatorSource|compileCombinatorSource|contract-s-link|contract-k-link/);
});
