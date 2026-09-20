// Explore the executable network connecting RML, Links Theory, set theory,
// and type theory, then unfold a self-referential sequence to a finite prefix.

import { readFileSync } from 'node:fs';
import {
  DoubletSequenceStore,
  TheoryGraph,
} from '../js/src/rml-theory-graph.mjs';

const graph = TheoryGraph.fromRml(
  readFileSync(new URL('../lib/meta-theory/core.lino', import.meta.url), 'utf8'),
);

const sequence = new DoubletSequenceStore();
sequence.define('alternating.a', 'concept.alpha', 'alternating.b');
sequence.define('alternating.b', 'concept.beta', 'alternating.a');

console.log(JSON.stringify({
  rmlToTypeTheory: graph.definitionPath('relative-meta-logic', 'type-theory'),
  sharedAddress: graph.resolveTerm('set-theory', 'reference'),
  finiteObservation: sequence.walk('alternating.a', 5),
}, null, 2));
