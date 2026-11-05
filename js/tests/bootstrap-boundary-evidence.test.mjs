import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../../test-corpus/bootstrap-boundary/cases.json', import.meta.url), 'utf8',
));
const report = () => LinkedProgramRegistry.bootstrapKernelReport();
const node = (value, id) => value.trustGraph.nodes.find(item => item.id === id);
const mutations = {
  missing_primitive_reasons: fixture.operations.flatMap(id => ['', ' \n '].map(reason => value => {
    node(value, id).primitiveReason = reason;
  })),
  missing_dependency_targets: [value => { node(value, 'matching').dependsOn.push('missing-dependency'); }],
  dependency_cycles: ['matching', 'contract-s-link'].map(id => value => {
    node(value, id).dependsOn = [id];
  }),
  unterminated_public_paths: [value => {
    node(value, 'reduce-linked-program').dependsOn.push('detached-terminal');
    value.trustGraph.nodes.push({ id: 'detached-terminal', layer: 'links-defined-service', dependsOn: [] });
  }],
  forged_primitive_reasons: [value => {
    node(value, 'matching').dependsOn = [];
    node(value, 'matching').primitiveReason = 'A reason is not membership in K0.';
  }],
  missing_public_paths: [value => {
    value.trustGraph.nodes = value.trustGraph.nodes.filter(item => item.id !== 'load-linked-program');
  }],
  missing_boundary_nodes: [value => {
    value.trustGraph.nodes = value.trustGraph.nodes.filter(item => item.id !== 'contract-s-link');
  }],
  unreported_operations: [(_value, implemented) => { implemented.push('hidden-object-evaluator'); }],
  unimplemented_operations: [(_value, implemented) => { implemented.splice(0, 1); }],
  unsupported_irreducibility: [false, true].map(clearCriterion => value => {
    value.claimsIrreducible = true;
    if (clearCriterion) value.fixedPointCriterion = '';
  }),
  missing_criterion: [value => { value.fixedPointCriterion = ' \n '; }],
  missing_experiments: [value => {
    value.minimizationExperiments = value.minimizationExperiments.filter(item => item.operation !== 'contract-s-link');
  }],
  duplicate_nodes: [value => { value.trustGraph.nodes.push(structuredClone(node(value, 'contract-s-link'))); }],
  duplicate_operations: [
    value => { value.operations.push('contract-s-link'); },
    (_value, implemented) => { implemented.push('contract-s-link'); },
  ],
  unreported_bootstrap_nodes: [value => {
    value.trustGraph.nodes.push({
      id: 'hidden-object-evaluator', layer: 'bootstrap', dependsOn: [], primitiveReason: 'Forged authority.',
    });
  }],
  unsupported_scope: [value => { value.trustGraph.schema = 'unrecognized'; }],
};

test('accepts the current K0 report against an independent boundary inventory', () => {
  const actual = report();
  assert.deepEqual(actual.operations, fixture.operations);
  assert.equal(actual.claimsIrreducible, false);
  assert.ok(actual.fixedPointCriterion.trim().length > 0);
  assert.deepEqual(LinkedProgramRegistry.auditBootstrapReport(actual, fixture.operations), { ok: true });
  assert.deepEqual(LinkedProgramRegistry.auditBootstrapKernel(), { ok: true });
  assert.deepEqual(new Set(Object.keys(mutations)), new Set(fixture.cases.map(item => item.id)));
});

for (const sample of fixture.cases) {
  test(sample.name, () => {
    for (const mutate of mutations[sample.id]) {
      const value = report();
      const implemented = [...fixture.operations];
      mutate(value, implemented);
      assert.throws(
        () => LinkedProgramRegistry.auditBootstrapReport(value, implemented),
        error => error.message.includes(sample.error),
        sample.id,
      );
    }
  });
}

test('the default audit rejects an unreported implementation operation', () => {
  assert.throws(
    () => LinkedProgramRegistry.auditBootstrapKernel([...fixture.operations, 'hidden-object-evaluator']),
    /unreported host semantic operation hidden-object-evaluator/,
  );
});
