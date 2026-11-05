import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

const source = readFileSync(new URL('../../lib/meta-theory/universal.lino', import.meta.url), 'utf8');
const report = LinkedProgramRegistry.bootstrapMetricsReport(source);
const kernel = LinkedProgramRegistry.bootstrapKernelReport();
const observed = report.runtimeTrustGraphCoverage.trace;
const clone = value => JSON.parse(JSON.stringify(value));

describe('runtime trace compared with the kernel trust graph', () => {
  it('documents every path, operation and segment of the executed probe trace', () => {
    const coverage = LinkedProgramRegistry.runtimeTrustGraphCoverage(observed, kernel);
    assert.equal(coverage.totalObservedPaths, 4);
    assert.equal(coverage.totalObservedPathSegments, 10);
    assert.deepEqual([coverage.undocumentedPaths, coverage.undocumentedOperations, coverage.undocumentedPathSegments], [[], [], []]);
    assert.deepEqual(coverage, report.runtimeTrustGraphCoverage);
  });

  it('reports an undocumented runtime path, operation and segment injected into the executed trace', () => {
    const trace = clone(observed);
    const documentedPath = trace.observedPaths[0];
    trace.observedPaths.push('host-shortcut-path');
    trace.observedOperations.push('host-shortcut-operation');
    trace.observedPathSegments.push({ path: documentedPath, operation: 'host-shortcut-operation' });
    trace.observedPathSegments.push({ path: 'host-shortcut-path', operation: kernel.operations[0] });
    const coverage = LinkedProgramRegistry.runtimeTrustGraphCoverage(trace, kernel);
    assert.deepEqual(coverage.undocumentedPaths, ['host-shortcut-path']);
    assert.deepEqual(coverage.undocumentedOperations, ['host-shortcut-operation']);
    assert.deepEqual(coverage.undocumentedPathSegments, [
      { path: documentedPath, operation: 'host-shortcut-operation' },
      { path: 'host-shortcut-path', operation: kernel.operations[0] },
    ]);
    assert.equal(coverage.documentedObservedPaths, coverage.totalObservedPaths - 1);
    assert.equal(coverage.documentedObservedPathSegments, coverage.totalObservedPathSegments - 2);
  });

  it('reports a real path as undocumented once its trust-graph node or edge is removed', () => {
    const path = observed.observedPaths[0];
    const withoutNode = clone(kernel);
    withoutNode.trustGraph.nodes = withoutNode.trustGraph.nodes.filter(node => node.id !== path);
    const missing = LinkedProgramRegistry.runtimeTrustGraphCoverage(observed, withoutNode);
    assert.deepEqual(missing.undocumentedPaths, [path]);
    assert.ok(missing.undocumentedPathSegments.some(segment => segment.path === path));

    const withoutEdges = clone(kernel);
    for (const node of withoutEdges.trustGraph.nodes) if (node.id === path) node.dependsOn = [];
    const unreachable = LinkedProgramRegistry.runtimeTrustGraphCoverage(observed, withoutEdges);
    assert.deepEqual(unreachable.undocumentedPaths, []);
    assert.ok(unreachable.undocumentedPathSegments.some(segment => segment.path === path && segment.operation !== path));

    const withoutOperation = clone(kernel);
    const operation = observed.observedOperations[0];
    withoutOperation.operations = withoutOperation.operations.filter(item => item !== operation);
    withoutOperation.derivedHostServices = withoutOperation.derivedHostServices.filter(item => item !== operation);
    assert.deepEqual(LinkedProgramRegistry.runtimeTrustGraphCoverage(observed, withoutOperation).undocumentedOperations, [operation]);
  });
});
