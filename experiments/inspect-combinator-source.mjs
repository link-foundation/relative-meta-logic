import { readFileSync } from 'node:fs';

import {
  compileCombinatorSource,
  serializeCombinatorSource,
} from '../scripts/combinator-source.mjs';

// Reusable provenance experiment: measure the authoritative addressed-link
// source and verify that generation produces the checked-in runtime artifact.
const source = readFileSync(
  new URL('../lib/meta-theory/fixed-point-source.lino', import.meta.url),
  'utf8',
);
const artifact = readFileSync(
  new URL('../lib/meta-theory/fixed-point.ski', import.meta.url),
  'utf8',
);
const { metadata, roots } = compileCombinatorSource(source);
const [runtimeSchema, counts] = artifact.split('\n', 2);
const [runtimeNodes, runtimeRoots] = counts.split('\t').map(Number);

console.log(JSON.stringify({
  source: {
    schema: metadata.schema,
    representation: metadata.representation,
    upstreamModel: metadata.upstreamModel,
    nodes: metadata.declaredNodeCount,
    roots: Object.keys(roots).length,
  },
  runtime: {
    schema: runtimeSchema,
    nodes: runtimeNodes,
    roots: runtimeRoots,
  },
  artifactMatchesGeneratedSource: artifact === serializeCombinatorSource(source),
}, null, 2));
