# Executable Meta-Theory

RML represents theories, their definitions, and their vocabulary as one
addressed network. The bundled candidate is
[`lib/meta-theory/core.lino`](../lib/meta-theory/core.lino), and its independent
trust profile is
[`lib/meta-theory/foundation.lino`](../lib/meta-theory/foundation.lino).
JavaScript and Rust load both through the `meta-language` bridge and expose
matching query and doublet-store APIs.

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

## Source vocabulary and executable contracts

The candidate network reader recognizes six generic LiNo forms (including
`proof-object`):

```lino
(theory theory-name (address stable.theory.address))

(term theory-name local-term shared.concept.address)

(implementation implementation-name
  (adapter host-adapter-name)
  (kind witness-kind)
  (subject theory-being-defined)
  (using defining-theory)
  (obligation executable-operation))

(witness stable.definition.address
  (kind witness-kind)
  (implementation implementation-name)
  (proof proof-object-name))

(definition definition-name
  (subject theory-being-defined)
  (using defining-theory)
  (witness stable.definition.address))

(proof-object proof-object-name
  (applies trusted-rule-name)
  (premise-by trusted-axiom-or-proof)
  (conclusion exact-judgement))
```

Theory names are data, not an enum. A consumer can append its own forms and
immediately use the same chain, witness, and address queries. Validation rejects
duplicate theory or witness addresses, ambiguous local-term mappings,
undeclared theories, definition links whose witness is undeclared, unsupported
implementation names or contract clauses, incomplete obligation sets,
implementations rebound to another subject/foundation pair, and proofs that do
not establish the exact link.

Adapter execution is extensible at the trust boundary as well. JavaScript
accepts an `adapterProbes` map in the third `fromRml` argument; Rust accepts an
`AdapterProbeRegistry` through `from_rml_with_adapter_probes`. A caller can
therefore implement a new links-declared adapter without modifying either RML
runtime. The callback receives the already matched definition, witness,
implementation, contract kind, and complete obligation set. Injection does not
let candidate data authorize itself: the independently selected foundation
must still declare the adapter contract and capability axiom, the candidate
must still carry its exact proof, and an adapter with no executable built-in or
caller-supplied probe is rejected.

A definition is admitted only when four independent checks agree:

1. its manifest matches the proposed subject/foundation pair and the host
   adapter's exact kind and complete obligation set;
2. the adapter executes every declared operation, including relevant negative
   cases such as ill-typed endpoints;
3. its proof object replays successfully through RML's proof checker;
4. the checked conclusion names the exact definition, subject, foundation,
   implementation, and kind on the proposed definition link.

For example, `links-by-sets` is backed by the executable addressed-doublet
mapping `address -> (source, target)` and by a checked proof conclusion naming
that implementation as a set-theoretic function. The implementation manifest
requires both address-function and ordered-pair behavior. Capability axioms
state the small trusted boundary between an implementation and its
interpretation; each shipped adapter completely implements its declared finite
contract, but this is not a proof that two unrestricted mathematical theories
are equivalent. Those axioms, the inference rules, the adapter contracts, and
the exact expected typed judgements live in `foundation.lino`, selected
separately by the caller. They cannot be declared by the candidate document.

Every source is first parsed and reconstructed by `meta-language`. The theory
reader consumes only reconstructed LiNo and reports whether the round trip was
byte-for-byte lossless.

## Complete upstream semantic corpus

The theory network is paired with a linked representation of the complete
compiler input for upstream meta-theory 0.0.3. The candidate
[`upstream-0.0.3.lino`](../lib/meta-theory/upstream-0.0.3.lino) contains the
normalized syntax of all nine Lean and nine Rocq modules as 8,815 typed UTF-8
token links. Its 229 declaration links point into that syntax with four exact
token ranges:

- the complete declaration syntax;
- the signature or theorem judgement;
- the definition body, including recursive equations; and
- the source proof object or proof script.

Each declaration also records its stable address, proof status, recursion
status, and resolved declaration dependencies. Recursive definitions must have
a self-dependency. The 510 dependency links form a queryable graph;
`dependencyClosure` / `dependency_closure` follows it transitively, and
`counterpart` finds the corresponding declaration in the other formalization.
For example, queries for `ListToBalancedTree`, `ReadSequence_`,
`set_sequence_equivalence`, and `meta_network_is_duplet_network` return their
actual source-level types, bodies or proofs—not only their names and kinds.

The independent
[`upstream-0.0.3-foundation.lino`](../lib/meta-theory/upstream-0.0.3-foundation.lino)
contract fixes the repository, revision, schema, module/declaration/token/
dependency counts, and a SHA-256 fingerprint over every token, range, status,
recursion marker, and dependency. `FormalCorpus.fromRml` /
`FormalCorpus::from_rml` validate that contract through `meta-language`. They
also derive theorem admission from the linked proof tokens, reject empty
judgements/bodies/proofs, unresolved dependencies, inconsistent recursion,
semantic mutations, omissions, and candidate-authored contracts. Four
upstream Lean theorems contain `sorry` and are therefore `admitted`; all named
Rocq theorems end in checked proof terminators and are `verified`.

The `formal-corpus` CI workflow independently checks out the pinned revision
and re-extracts the same module token streams, declaration ranges, proof
objects, recursion facts, and dependency graph. It compares those semantics
declaration by declaration with the linked corpus before building the exact
Lean and Rocq sources. Consequently the native kernels check the proof content
whose tokens RML stores, rather than a separate name inventory. The source
build also checks commands that are outside named declaration ranges.

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
const network = TheoryNetwork.fromRml(source, trustedFoundationSource);

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
//   kind: 'set-theoretic-function',
//   obligations: ['address-function', 'ordered-pair'], verified: true }
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

## Typed links and the executable type-theory fragment

`TypedLinkNetwork` adds reference declarations to the same addressed-doublet
model. A reference may inhabit more than one declared type. Creating a doublet
checks both endpoint types and records the result as `(Pair SourceType
TargetType)`; missing or mismatched declarations are rejected before the link
is stored.

The `typed-kernel-links` implementation is a compact executable fragment, not
only a foundation label. The independently selected `foundation.lino` trust
profile declares rules, axioms, adapter contracts, and the exact judgements
required for Pi formation, lambda introduction, application elimination, and
beta conversion. `core.lino` contains only the candidate proof objects. Every
type-backed implementation replays those four derivations, and typed graph
edges and relation pairs additionally expose their concrete pair types. A
candidate is rejected if it attempts to add a rule, axiom, contract, or
expected judgement to its own trust profile.

## Sets: canonical and order-preserving views

The bundled network records two definitions of set theory through links:

1. `sets-by-membership-links` is the conventional extensional presentation.
2. `sets-by-ordered-unique-links` uses a canonical ordered-unique sequence.

The two definitions have independent executable representations:

- `MembershipSetStore` represents membership by addressed `(element, set)`
  doublets. `has` queries membership, `members` returns the extension in
  stable reference order, and `equals` implements finite extensional equality.
  It also executes subset, pairing, finite union, separation, and replacement.
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
and cycle-safe reachability operations. The doublet is stored in a
`TypedLinkNetwork` and has type `(Pair graph.vertex graph.vertex)`. The checked
`graphs-by-finite-sets` and `graphs-by-types` definitions bind the complete
finite graph contract to set-theoretic and vertex-typed presentations.

`FiniteRelation` represents a relation `A -> B` as a finite set of addressed
ordered-pair links. Construction enforces membership in the declared domain
and codomain. It executes converse, union, intersection, and typed relational
composition. Every stored pair exposes `(Pair relation.domain
relation.codomain)`. The checked `relations-by-finite-sets` and
`relations-by-types` definitions bind that complete finite algebra contract
into the theory network.

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
| Parse with a caller adapter registry | `TheoryNetwork.fromRml(..., { adapterProbes })` | `TheoryNetwork::from_rml_with_adapter_probes` |
| Parse pinned formal corpus | `FormalCorpus.fromRml` | `FormalCorpus::from_rml` |
| Query a formal module | `module` | `module` |
| Query full declaration semantics | `declaration` / `declarationAt` | `declaration` / `declaration_at` |
| Follow declaration dependencies | `dependencyClosure` | `dependency_closure` |
| Find Lean/Rocq counterpart | `counterpart` | `counterpart` |
| Resolve local term | `resolveTerm` | `resolve_term` |
| Translate term | `translateTerm` | `translate_term` |
| Query implementation contract | `implementation` | `implementation` |
| Query definition witness | `definitionWitness` | `definition_witness` |
| Query checked definition evidence | `definitionVerification` | `definition_verification` |
| Find shortest definition chain | `definitionChain` | `definition_chain` |
| Store unrestricted links | `LinkNetwork` | `LinkNetwork` |
| Store and check typed links | `TypedLinkNetwork` | `TypedLinkNetwork` |
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

- exact accounting for all 18 pinned Lean/Rocq modules and all 229
  declarations, including 8,815 typed source-token links, complete signatures,
  bodies, recursive equations, proof objects, 510 dependency links,
  admitted/verified status, independent fingerprints, semantic mutation
  rejection, and rejection of candidate-authored contracts;
- lossless loading through `meta-language`;
- RML's Links Theory dependency and the set/type/self definition cycle;
- exact implementation manifests and checked proof witnesses, including
  rejection of an unknown clause, incomplete obligations, a rebound subject,
  a missing proof, a proof for the wrong definition, a corrupted premise, or
  an unsupported implementation;
- rejection of candidate-authored rules, axioms, contracts, and expected
  judgements, so a candidate cannot authorize its own proofs;
- shared-address lookup and address-mediated translation;
- arbitrary caller-defined theories and cycle-safe shortest definition chains;
- caller-injected adapter semantics, with rejection when the executable probe
  is absent;
- exact balanced, left-staircase, and right-staircase doublets;
- independent membership, subset, extensional equality, pairing, union,
  separation, replacement, canonical set normalization, and ordered-set
  uniqueness;
- replayed Pi/lambda/application/beta derivations, exact expected judgements,
  unrelated-proof substitution rejection, and typed-doublet rejection;
- graphs as vertex-constrained link-network subsets, including reachability,
  concrete edge types, and rejection of ill-typed endpoints;
- typed relation converse, union, intersection, composition, and pair types;
- rejection of finite-tree cycles; and
- bounded direct and indirect right-spine cycles.

These tests, semantic source-parity checks, and proof-assistant builds verify
that every linked source token and declaration view is the content accepted by
the native Lean/Rocq kernel, as well as every obligation in the finite
implementation contracts, theory-network algorithms, and explicitly derived
graph/relation algorithms shipped by RML. RML preserves source proof terms and
derivations as typed links and validates their structure and trusted
fingerprint; elaboration and kernel reduction remain delegated to the pinned
Lean and Rocq kernels. The boundary is intentionally precise: this finite
cross-check does not assert equivalence for arbitrary future Lean/Rocq
programs, treat the four upstream Lean admissions as proofs, or treat a finite
prefix as proof about an entire infinite sequence. See the
case study's
[`baseline-audit.md`](./case-studies/issue-183/baseline-audit.md) for the exact
upstream snapshot and formal-development boundary.
