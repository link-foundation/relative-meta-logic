import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeCombinatorSource } from '../../scripts/combinator-source.mjs';
import { LinkedProgramRegistry } from '../../js/src/rml-linked-program.mjs';

const sourceUrl = new URL('../../lib/meta-theory/fixed-point-source.lino', import.meta.url);
const fixtureUrl = new URL('../../test-corpus/kernel-replacement/mirror-substitution.ski', import.meta.url);

/** Replace the linked list-substitution constructor, including recursive calls. */
export function mirroredSubstitutionSource(source) {
  const original = '(bootstrap-source-node n880 (application n878 n879))';
  if (source.split(original).length !== 2 || !source.includes('(node-count 1446)')) {
    throw new Error('the declared K0 substitution source has changed; inspect this witness');
  }
  return source.replace('(node-count 1446)', '(node-count 1449)')
    .replace(original, '(bootstrap-source-node n880 (application n1448 n1447))') + '\n' +
    '(bootstrap-source-node n1446 (application rCONS n877))\n' +
    '(bootstrap-source-node n1447 (application n1446 rNIL))\n' +
    '(bootstrap-source-node n1448 (application rAPPEND n879))\n';
}

export const K0_WITNESS_PROGRAM = `
(linked-program kernel-witness)
(linked-rewrite kernel-witness substitute
  (from (input ?value))
  (to (pair (nested ?value) done)))
`;

export function kernelReplacementWitness() {
  const baseline = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM);
  const replacement = LinkedProgramRegistry.fromRml(K0_WITNESS_PROGRAM, {
    kernelArtifact: readFileSync(fixtureUrl, 'utf8'),
  });
  const request = ['input', 'value'];
  return {
    schema: 'rml-k0-definition-replacement/v1',
    source: fileURLToPath(sourceUrl),
    changedDefinition: 'linked recursive list substitution, node n880',
    baseline: baseline.reduce('kernel-witness', request),
    replacement: replacement.reduce('kernel-witness', request),
    replacementKernel: replacement.kernelSourceReport(),
    unchangedHostOperations: ['contract-s-link', 'contract-k-link'],
    trustBoundary: [
      'S/K contraction equations remain external primitives',
      'the existing host bracket-abstraction compiler compiles both linked sources',
      'text ingress, node encoding/decoding and resource control remain host operations',
    ],
    claimsFullImplementationClosure: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    writeFileSync(fixtureUrl, serializeCombinatorSource(
      mirroredSubstitutionSource(readFileSync(sourceUrl, 'utf8')),
    ));
  }
  console.log(JSON.stringify(kernelReplacementWitness(), null, 2));
}
