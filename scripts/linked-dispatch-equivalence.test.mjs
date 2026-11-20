import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { test, after } from 'node:test';
import { LinkedProgramRegistry as Baseline } from '../js/tests/fixtures/linked-program-before-dispatch.mjs';
import { LinkedProgramRegistry as Candidate } from '../js/src/rml-linked-program.mjs';
const cases = JSON.parse(readFileSync(new URL('../test-corpus/linked-dispatch/typed-recursion-cases.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../test-corpus/linked-dispatch/typed-recursion-source.lino', import.meta.url), 'utf8');
const measuredCases = [];
for (const example of cases.cases) {
 test(example.name, () => {
   const before = Baseline.fromRml(source, { executionBasis: 'direct-structural' });
   const after = Candidate.fromRml(source, { executionBasis: 'direct-structural' });
   const started = performance.now();
   const expected = before.reduce(cases.program, example.request, { maxSteps: cases.maxSteps });
   const baselineMs = performance.now() - started;
   const candidateStarted = performance.now();
   const actual = after.reduce(cases.program, example.request, { maxSteps: cases.maxSteps });
   const candidateMs = performance.now() - candidateStarted;
   assert.deepEqual(actual, expected);
   assert.deepEqual(after.runtimeSemanticTrace(), before.runtimeSemanticTrace());
   measuredCases.push({ name: example.name, steps: expected.steps, baselineMs, candidateMs, exactResultAndFullTrace: true, exactObserver: true });
 });
}
after(() => {
  if (process.env.RML_DISPATCH_JS_REPORT) {
    writeFileSync(process.env.RML_DISPATCH_JS_REPORT, `${JSON.stringify({ expectedCases: cases.cases.length, completedCases: measuredCases.length, cases: measuredCases }, null, 2)}\n`);
  }
});
