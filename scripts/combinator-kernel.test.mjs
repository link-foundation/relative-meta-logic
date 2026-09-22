import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import generatedKernel from '../js/src/rml-combinator-kernel-data.mjs';
import { serializeCombinatorKernel } from '../js/src/rml-combinator-kernel.mjs';

test('the checked-in S/K artifacts are generated from the executable closed terms', () => {
  const artifact = readFileSync(
    new URL('../lib/meta-theory/fixed-point.ski', import.meta.url),
    'utf8',
  );
  const serializedKernel = serializeCombinatorKernel();

  assert.equal(artifact, serializedKernel);
  assert.equal(generatedKernel, serializedKernel);
});
