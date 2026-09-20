// Explore the executable network connecting RML, Links Theory, set theory,
// type theory, graph theory, and relational algebra; build finite nested
// doublet trees; then unfold a cyclic right-spine sequence to a finite prefix.

import { readFileSync } from 'node:fs';
import {
  DoubletSequenceStore,
  FiniteRelation,
  LinkGraph,
  MembershipSetStore,
  TheoryNetwork,
} from '../js/src/rml-theory-network.mjs';

const network = TheoryNetwork.fromRml(
  readFileSync(new URL('../lib/meta-theory/core.lino', import.meta.url), 'utf8'),
);

const links = new DoubletSequenceStore();
const finiteRoot = links.encodeSequence(
  ['concept.alpha', 'concept.beta', 'concept.gamma', 'concept.delta'],
  'example.sequence',
  'balanced',
);
const setRoot = links.encodeSet(
  ['concept.gamma', 'concept.alpha', 'concept.beta', 'concept.alpha'],
  'example.set',
);
links.define('alternating.a', 'concept.alpha', 'alternating.b');
links.define('alternating.b', 'concept.beta', 'alternating.a');
const membershipSets = new MembershipSetStore();
membershipSets.define('membership.alpha', 'concept.alpha', 'example.members');
membershipSets.define('membership.beta', 'concept.beta', 'example.members');
const graph = new LinkGraph('example.graph');
graph.addVertex('concept.alpha');
graph.addVertex('concept.beta');
graph.defineEdge('example.edge', 'concept.alpha', 'concept.beta');
const relation = new FiniteRelation(
  'example.relation',
  ['concept.alpha'],
  ['concept.beta'],
);
relation.define('example.pair', 'concept.alpha', 'concept.beta');

console.log(JSON.stringify({
  rmlToTypeTheory: network.definitionChain('relative-meta-logic', 'type-theory'),
  setReferenceAsLink: network.translateTerm('set-theory', 'reference', 'links-theory'),
  setFunctionWitness: network.definitionWitness('rml.definition.links.set-function'),
  setFunctionVerification: network.definitionVerification('links-by-sets'),
  membershipSet: membershipSets.members('example.members'),
  graphReachability: graph.reachable('concept.alpha', 'concept.beta'),
  relationConverse: relation.converse('example.converse').pairs(),
  finiteSequence: links.decodeSequence(finiteRoot),
  canonicalSet: links.decodeSet(setRoot),
  cyclicObservation: links.walk('alternating.a', 5),
}, null, 2));
