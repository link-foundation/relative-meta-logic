# Executable Meta-Theory

RML represents theories, their definitions, and their vocabulary as one
addressed network. The bundled network is
[`lib/meta-theory/core.lino`](../lib/meta-theory/core.lino); JavaScript and Rust
load the same file through the `meta-language` bridge and expose matching query
and doublet-store APIs.

This links network is cyclic by design:

```text
Relative Meta-Logic -> Links Theory -> Set Theory
                                  \-> Type Theory
                                  \-> Links Theory

Set Theory  -> Links Theory
Type Theory -> Links Theory

Graph Theory       -> Set Theory, Type Theory
Relational Algebra -> Set Theory, Type Theory
```

An arrow means “the theory on the left has a definition using the theory on
the right.” Path queries keep a visited set, so self-definition and longer
cycles cannot make a query diverge.

## Source vocabulary and witnesses

The network reader recognizes four generic LiNo forms:

```lino
(theory theory-name (address stable.theory.address))

(term theory-name local-term shared.concept.address)

(witness stable.definition.address
  (kind witness-kind)
  (implementation implementation-name)
  (proof proof-object-name))

(definition definition-name
  (subject theory-being-defined)
  (using defining-theory)
  (witness stable.definition.address))
```

Theory names are data, not an enum. A consumer can append its own forms and
immediately use the same chain, witness, and address queries. Validation rejects
duplicate theory or witness addresses, ambiguous local-term mappings,
undeclared theories, definition links whose witness is undeclared, unsupported
implementation names, and proofs that do not establish the exact link.

A definition is admitted only when three independent checks agree:

1. its implementation name and kind match the host's supported capability
   registry, and a deterministic runtime probe for that implementation passes;
2. its proof object replays successfully through RML's existing proof checker;
3. the checked conclusion names the exact definition, subject, foundation,
   implementation, and kind on the proposed definition link.

For example, `links-by-sets` is backed by the executable addressed-doublet
mapping `address -> (source, target)` and by a checked proof conclusion naming
that implementation as a set-theoretic function. Capability axioms state the
small trusted boundary between an implementation and its interpretation; they
are not a proof that two complete mathematical theories are equivalent.

Every source is first parsed and reconstructed by `meta-language`. The theory
reader consumes only reconstructed LiNo and reports whether the round trip was
byte-for-byte lossless.

## Unified concept addresses

Surface terms remain local to their theories. Their shared address supplies
the cross-theory identity:

| Shared concept | Links Theory | RML | Set theory | Type theory |
|----------------|--------------|-----|------------|-------------|
| addressable link | `link` | `expression` | `reference` | `term` |
| ordered sequence | `tuple` | `sequence` | `ordered-set` | `tuple-type` |
| source position | `source` | `left-operand` | `ordered-pair-left` | `product-left` |
| target position | `target` | `right-operand` | `ordered-pair-right` | `product-right` |

Graph theory adds `vertex`, `directed-edge`, and `directed-graph`; relational
algebra adds `element`, `ordered-pair`, and `relation-network`. Vertices and
elements share the addressable-reference concept, and directed edges and
ordered pairs share the binary-relation concept. Whole graphs, whole
relations, sets, types, and unrestricted links networks retain distinct
concept addresses; their checked definitions connect them without collapsing
one structure into another.

This is an explicit correspondence, not a claim that the surface terms have
identical native definitions. `translateTerm` / `translate_term` resolves a
source term to its address, then returns terms at that address in the selected
target theory.

```js
const network = TheoryNetwork.fromRml(source);

network.translateTerm('set-theory', 'reference', 'links-theory');
// ['link']

network.definitionChain('relative-meta-logic', 'type-theory');
// ['relative-meta-logic', 'links-theory', 'type-theory']

network.definitionWitness('rml.definition.links.set-function');
// { address: ..., kind: 'set-theoretic-function',
//   implementation: 'addressed-doublet-network', proof: ... }

network.definitionVerification('links-by-sets');
// { definition: 'links-by-sets', witness: ..., proof: ...,
//   implementation: 'addressed-doublet-network',
//   kind: 'set-theoretic-function', verified: true }
```

Rust exposes the matching `translate_term`, `definition_chain`, and
`definition_witness` / `definition_verification` methods.

## Links Theory in itself

The smallest bundled self-definition is the addressed doublet:

```lino
(template (doublet address source target)
  (address maps-to (source target)))
```

The address, source, and target are all link references. No separate node,
graph edge, set, or type primitive is required. A triplet is encoded by nesting
the same doublet template. The explicit `links-by-links` definition records this
self-presentation; `links-by-sets` and `links-by-types` record the independent
set- and type-theoretic presentations.

## Finite sequences are nested doublet trees

This contract follows the latest meta-theory 0.0.3 design. The finite sequence
itself is the root reference. Each internal reference addresses one
`(source, target)` doublet; reading leaves from left to right recovers the
sequence. There are no wrapper leaf/node terms in the stored network.

For `[a, b, c, d]`:

```text
balanced: ((a, b), (c, d))
left:     (((a, b), c), d)
right:    (a, (b, (c, d)))
```

JavaScript:

```js
const store = new DoubletSequenceStore();
const root = store.encodeSequence(
  ['concept.a', 'concept.b', 'concept.c', 'concept.d'],
  'example.sequence',
  'balanced',
);

store.doublet(root);
// { source: 'example.sequence.cell.1',
//   target: 'example.sequence.cell.2' }

store.decodeSequence(root);
// ['concept.a', 'concept.b', 'concept.c', 'concept.d']
```

Rust uses `encode_sequence(values, address, SequenceLayout::Balanced)`,
`doublet`, and `decode_sequence`. Empty sequences return
`rml.sequence.empty`; a singleton sequence is its sole leaf reference. A cycle
encountered during finite decoding is rejected.

Because references and links occupy one space, a reference that is defined as
a doublet in the same store is recursively interpreted as a branch. Callers
choose the network context in which a reference is a leaf or an expanded link.

## Sets: canonical and order-preserving views

The bundled network records two definitions of set theory through links:

1. `sets-by-membership-links` is the conventional extensional presentation.
2. `sets-by-ordered-unique-links` uses a canonical ordered-unique sequence.

The two definitions have independent executable representations:

- `MembershipSetStore` represents membership by addressed `(element, set)`
  doublets. `has` queries membership, `members` returns the extension in
  stable reference order, and `equals` implements finite extensional equality.
- `DoubletSequenceStore.encodeSet` / `encode_set` sorts references, removes
  duplicates, and writes a balanced tree. `decodeSet` / `decode_set` verifies
  strict canonical order.

The sequence store also exposes an order-preserving finite-set view:

- `encodeOrderedSet` / `encode_ordered_set` preserves caller order and rejects
  duplicates, then writes a balanced tree. Its decoder checks uniqueness.

Canonical ordering is lexicographic over reference strings. It gives the same
leaf sequence for any permutation or repetition of the same input set; the
caller-supplied root namespace determines the generated branch addresses.
Both encoders check for address conflicts before mutating the store.

## Graph theory and relational algebra are derived link interpretations

The ambient representation is a `LinkNetwork`: an unrestricted mapping from a
link address to `(source, target)` references. It is not called a graph in the
meta-logic or meta-theory APIs.

`LinkGraph` is an explicitly narrower interpretation. Its vertices are stored
as membership links in a finite set, and every edge is an addressed doublet
whose source and target must inhabit that vertex set. It supplies successor
and cycle-safe reachability operations. The checked `graphs-by-finite-sets`
and `graphs-by-types` definitions bind this implementation to set-theoretic
and vertex-typed presentations.

`FiniteRelation` represents a relation `A -> B` as a finite set of addressed
ordered-pair links. Construction enforces membership in the declared domain
and codomain. It executes converse, union, intersection, and typed relational
composition. The checked `relations-by-finite-sets` and `relations-by-types`
definitions bind those semantics into the theory network.

```js
const graph = new LinkGraph('example.graph');
graph.addVertex('a');
graph.addVertex('b');
graph.defineEdge('edge.ab', 'a', 'b');
graph.reachable('a', 'b'); // true

const relation = new FiniteRelation('r', ['a'], ['b']);
relation.define('pair.ab', 'a', 'b');
relation.converse('r.converse').pairs(); // [['b', 'a']]
```

## Potentially infinite sequences use bounded right spines

Direct or indirect link cycles can denote potentially infinite sequences. The
`walk` operation interprets each doublet as `(current-value, next-reference)`,
requires a maximum item count, and returns `complete`, `cyclic`, and the first
observed cycle position. It never attempts to decide arbitrary termination.

```js
const store = new DoubletSequenceStore();
store.define('a', 'concept.alpha', 'b');
store.define('b', 'concept.beta', 'a');
store.walk('a', 5);
// { values: ['concept.alpha', 'concept.beta', 'concept.alpha',
//            'concept.beta', 'concept.alpha'],
//   complete: false, cyclic: true, cycleAt: 0 }
```

This right-spine interpretation is intentionally separate from finite-tree
decoding: a finite tree recursively follows both sides, while a productive
walk emits the source and follows only the target.

## API correspondence

| Purpose | JavaScript | Rust |
|---------|------------|------|
| Parse theory network | `TheoryNetwork.fromRml` | `TheoryNetwork::from_rml` |
| Resolve local term | `resolveTerm` | `resolve_term` |
| Translate term | `translateTerm` | `translate_term` |
| Query definition witness | `definitionWitness` | `definition_witness` |
| Query checked definition evidence | `definitionVerification` | `definition_verification` |
| Find shortest definition chain | `definitionChain` | `definition_chain` |
| Store unrestricted links | `LinkNetwork` | `LinkNetwork` |
| Execute finite directed graphs | `LinkGraph` | `LinkGraph` |
| Execute finite relational algebra | `FiniteRelation` | `FiniteRelation` |
| Extensional membership sets | `MembershipSetStore` | `MembershipSetStore` |
| Encode finite sequence | `encodeSequence` | `encode_sequence` |
| Decode finite sequence | `decodeSequence` | `decode_sequence` |
| Encode/decode canonical set | `encodeSet` / `decodeSet` | `encode_set` / `decode_set` |
| Encode/decode ordered set | `encodeOrderedSet` / `decodeOrderedSet` | `encode_ordered_set` / `decode_ordered_set` |
| Observe right-spine sequence | `walk` | `walk` |

## Verification boundary

Mirrored tests in `js/tests/theory-network.test.mjs` and
`rust/tests/theory_network_tests.rs` verify:

- lossless loading through `meta-language`;
- RML's Links Theory dependency and the set/type/self definition cycle;
- checked implementation/proof witnesses, including rejection of a missing
  proof, a proof for the wrong definition, a corrupted premise, or an
  unsupported implementation;
- shared-address lookup and address-mediated translation;
- arbitrary caller-defined theories and cycle-safe shortest definition chains;
- exact balanced, left-staircase, and right-staircase doublets;
- independent membership-set equality, canonical set normalization, and
  ordered-set uniqueness;
- graphs as vertex-constrained link-network subsets, including reachability
  and rejection of ill-typed endpoints;
- typed relation converse, union, intersection, and composition;
- rejection of finite-tree cycles; and
- bounded direct and indirect right-spine cycles.

These tests verify the runtime representations, theory-network algorithms,
and explicitly derived graph/relation algorithms shipped by RML. They do not
assert that all theories are equivalent, mechanize every
meta-theory theorem, or treat a finite prefix as proof about an entire infinite
sequence. See the case study's
[`baseline-audit.md`](./case-studies/issue-183/baseline-audit.md) for the exact
upstream snapshot and formal-development boundary.
