import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import generatedKernel from '../js/src/rml-combinator-kernel-data.mjs';
import { combinatorIotaEquivalenceReport } from '../js/src/rml-combinator-kernel.mjs';
import {
  compileCombinatorSource,
  serializeCombinatorSource,
} from './combinator-source.mjs';

test('the runtime graph is compiled from authoritative addressed-link source', () => {
  const source = readFileSync(
    new URL('../lib/meta-theory/fixed-point-source.lino', import.meta.url),
    'utf8',
  );
  const artifact = readFileSync(
    new URL('../lib/meta-theory/fixed-point.ski', import.meta.url),
    'utf8',
  );
  const runtime = readFileSync(
    new URL('../js/src/rml-combinator-kernel.mjs', import.meta.url),
    'utf8',
  );
  const compiled = compileCombinatorSource(source);
  const serializedKernel = serializeCombinatorSource(source);

  assert.equal(compiled.metadata.schema, 'rml-lambda-link-dag-v1');
  assert.equal(compiled.metadata.representation, 'addressed-doublet-network');
  assert.equal(compiled.metadata.upstreamModel, 'network-duplet-function');
  assert.equal(compiled.metadata.declaredNodeCount, 1446);
  assert.equal(Object.keys(compiled.roots).length, 25);
  assert.match(artifact, /^rml-addressed-link-dag-v1\n/);
  assert.equal(artifact, serializedKernel);
  assert.equal(generatedKernel, serializedKernel);
  assert.doesNotMatch(runtime, /buildSourceKernel/);
});

test('the Rust container preserves the shared source paths at compile time', () => {
  const dockerfile = readFileSync(
    new URL('../docker/Dockerfile.rust', import.meta.url),
    'utf8',
  );

  assert.match(dockerfile, /^WORKDIR \/build\/rust$/m);
  assert.match(
    dockerfile,
    /^COPY lib\/meta-theory \/build\/lib\/meta-theory$/m,
  );
});

test('the one-name iota basis exposes the same two residual contractions', () => {
  assert.deepEqual(combinatorIotaEquivalenceReport(), {
    schema: 'rml-basis-equivalence-witness/v1',
    candidate: 'iota',
    surfaceLaw: 'ι f -> f S K',
    surfaceLawCount: 1,
    witnessCases: ['identity', 'discard', 'duplicate'],
    baselinePreserved: true,
    observedExternalOperations: ['contract-k-link', 'contract-s-link'],
    semanticInformationReduced: false,
  });
});
