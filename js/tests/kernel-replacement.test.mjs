import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinkedProgramRegistry } from '../src/rml-linked-program.mjs';
import { createCombinatorKernel } from '../src/rml-combinator-kernel.mjs';
import defaultArtifact from '../src/rml-combinator-kernel-data.mjs';
import { serializeCombinatorSource } from '../../scripts/combinator-source.mjs';
import { K0_WITNESS_PROGRAM, mirroredSubstitutionSource } from '../../experiments/definition-replacement/k0-replacement.mjs';

const artifact = readFileSync(new URL('../../test-corpus/kernel-replacement/mirror-substitution.ski', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../lib/meta-theory/fixed-point-source.lino', import.meta.url), 'utf8');
const input = ['input', 'value'];

test('a runtime-loaded linked K0 substitution definition changes nested execution without host changes', () => {
  assert.equal(serializeCombinatorSource(mirroredSubstitutionSource(source)), artifact);
  const original = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM);
  const replacement = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM, { kernelArtifact: artifact });
  assert.deepEqual(original.reduce('kernel-witness', input).term, ['pair', ['nested', 'value'], 'done']);
  assert.deepEqual(replacement.reduce('kernel-witness', input).term, ['done', ['value', 'nested'], 'pair']);
  assert.equal(replacement.kernelSourceReport().artifact, 'runtime-linked-artifact');
  assert.equal(replacement.kernelSourceReport().roots, 25);
  // Alternating two live registries must not rebind process-global semantics.
  assert.deepEqual(original.reduce('kernel-witness', input).term, ['pair', ['nested', 'value'], 'done']);
  assert.deepEqual(LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM).reduce('kernel-witness', input).term,
    ['pair', ['nested', 'value'], 'done']);
});

test('loaded baseline preserves proof search, inference, imports and verification', () => {
  const program = `
(linked-program imported)
(linked-fact imported origin (judgement (holds seed)))
(linked-program proof (uses imported))
(linked-inference proof extend (premise (holds ?x)) (conclusion (reached ?x)))`;
  const original = LinkedProgramRegistry.fromRml(program);
  const loaded = LinkedProgramRegistry.fromRml(program, { kernelArtifact: defaultArtifact });
  assert.deepEqual(loaded.search('proof', [['reached', 'seed']]), original.search('proof', [['reached', 'seed']]));
});

test('replacement cannot bypass disabled contraction operations', () => {
  for (const operation of ['contract-s-link', 'contract-k-link']) {
    const registry = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM, {
      kernelArtifact: artifact, disabledOperations: [operation],
    });
    assert.throws(() => registry.reduce('kernel-witness', input), /disabled host semantic operation/);
  }
});

test('runtime-linked artifacts fail closed on missing roots, forged references and bounds', () => {
  assert.throws(() => createCombinatorKernel(''), /header/);
  assert.throws(() => createCombinatorKernel(defaultArtifact.replace('REWRITE_ONCE\t', 'UNUSED\t')), /missing fixed-point root REWRITE_ONCE/);
  assert.throws(() => createCombinatorKernel(defaultArtifact.replace('TRUE\t', 'FALSE\t')), /root/);
  assert.throws(() => createCombinatorKernel(defaultArtifact.replace('0\tK\tK', '0\tn999999\tK')), /unknown fixed-point node/);
  assert.throws(() => createCombinatorKernel('rml-addressed-link-dag-v1\n1000001\t25\n'), /resource bounds/);
  assert.throws(() => createCombinatorKernel(defaultArtifact + 'unexpected\n'), /unexpected/);
  assert.throws(() => LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM, {
    executionBasis: 'direct-structural', kernelArtifact: artifact,
  }), /requires the s-k/);
  const bounded = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM, {
    kernelArtifact: artifact, maxContractions: 1,
  });
  assert.throws(() => bounded.reduce('kernel-witness', input), /contraction limit/);
});
