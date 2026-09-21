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
  TypedLinkNetwork,
} from '../js/src/rml-theory-network.mjs';
import { FormalCorpus } from '../js/src/rml-formal-corpus.mjs';

const universalSource = readFileSync(
  new URL('../lib/meta-theory/universal.lino', import.meta.url),
  'utf8',
);
const networkSource = readFileSync(
  new URL('../lib/meta-theory/core.lino', import.meta.url),
  'utf8',
);
const network = TheoryNetwork.fromRml(
  `${universalSource}\n${networkSource}`,
  readFileSync(new URL('../lib/meta-theory/foundation.lino', import.meta.url), 'utf8'),
);
const formalCorpus = FormalCorpus.fromRml(
  readFileSync(new URL('../lib/meta-theory/upstream-0.0.3.lino', import.meta.url), 'utf8'),
  readFileSync(
    new URL('../lib/meta-theory/upstream-0.0.3-foundation.lino', import.meta.url),
    'utf8',
  ),
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
const typedLinks = new TypedLinkNetwork();
typedLinks.declare('concept.alpha', 'Example');
typedLinks.declare('concept.beta', 'Example');
typedLinks.define(
  'example.typed-link',
  'concept.alpha',
  'concept.beta',
  'Example',
  'Example',
);
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
  formalCorpus: {
    revision: formalCorpus.revision,
    declarations: formalCorpus.declarations.length,
    admitted: formalCorpus.declarations
      .filter(declaration => declaration.proofStatus === 'admitted')
      .map(declaration => `${declaration.language}.${declaration.symbol}`),
  },
  rmlToTypeTheory: network.definitionChain('relative-meta-logic', 'type-theory'),
  setReferenceAsLink: network.translateTerm('set-theory', 'reference', 'links-theory'),
  setFunctionWitness: network.definitionWitness('rml.definition.links.set-function'),
  setFunctionVerification: network.definitionVerification('links-by-sets'),
  typedLinksContract: network.implementation('typed-doublet-network'),
  membershipSet: membershipSets.members('example.members'),
  membershipPair: membershipSets.pair('concept.alpha', 'concept.beta'),
  membershipReplacement: membershipSets.replacement(
    'example.members',
    member => `${member}.image`,
  ),
  typedDoubletType: typedLinks.typeOf('example.typed-link'),
  graphReachability: graph.reachable('concept.alpha', 'concept.beta'),
  graphEdgeType: graph.edgeType('example.edge'),
  relationConverse: relation.converse('example.converse').pairs(),
  relationPairType: relation.pairType('example.pair'),
  finiteSequence: links.decodeSequence(finiteRoot),
  canonicalSet: links.decodeSet(setRoot),
  cyclicObservation: links.walk('alternating.a', 5),
}, null, 2));
