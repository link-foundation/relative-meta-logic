# Case study: make Relative Meta-Logic genuinely meta

Issue [#183](https://github.com/link-foundation/relative-meta-logic/issues/183)
asks RML to connect its Links Theory, set theory, type theory, and
self-bootstrap work into one functional, tested meta-theory.

## Research baseline

The baseline was re-audited on 2026-09-20 after review feedback. The latest
`link-foundation/meta-theory` default-branch revision was
[`087f451`](https://github.com/link-foundation/meta-theory/commit/087f4515d0652925eecc54bcade724445c3978f1),
which contains article and executable source version **0.0.3**, not 0.0.2.
Version 0.0.3 adds the work developed in upstream PRs
[#40](https://github.com/link-foundation/meta-theory/pull/40) and
[#44](https://github.com/link-foundation/meta-theory/pull/44):

- sequences are references to recursively nested doublet trees;
- balanced, left-staircase, and right-staircase layouts preserve the same
  leaf sequence;
- finite sets are canonical balanced trees of sorted unique references;
- references, links, sequences, and sets share one reference space; and
- Links Theory closes its definition cycle in itself.

The upstream source includes parallel Lean and Rocq developments. This project
does not copy those proof-assistant sources or claim a new formal proof. It
implements their runtime representation contract in RML's JavaScript and Rust
APIs and tests observable parity. The detailed audit, including the correction
from the first implementation draft, is in
[`baseline-audit.md`](./baseline-audit.md).

RML already had related components:

- [`docs/META-THEORY-MAPPING.md`](../../META-THEORY-MAPPING.md) maps RML links,
  proofs, and foundations to references, doublets, and triplets;
- [`lib/set-theory/core.lino`](../../../lib/set-theory/core.lino) provides
  reusable set schemas;
- [`lib/self/`](../../../lib/self/) encodes the grammar, evaluator, types,
  operators, metatheorem checker, and foundation catalogue as links; and
- PR [#182](https://github.com/link-foundation/relative-meta-logic/pull/182)
  added tested JavaScript and Rust `meta-language` bridges.

The missing element was an executable, inspectable relation between those
parts.

## Requirements and evidence

| ID | Requirement | Implementation evidence | Automated evidence |
|----|-------------|-------------------------|--------------------|
| R1 | Base RML on Links Theory/meta-theory. | `rml-by-links` in `lib/meta-theory/core.lino`. | Both suites require the RML → Links Theory definition link and derived chains. |
| R2 | Define Links Theory through set theory and type theory. | `links-by-sets` and `links-by-types`, each backed by an exact implementation manifest; typed doublets enforce endpoint types and replay Pi/lambda/application/beta derivations. Contracts, proof rules, axioms, and exact expected judgements come from the independently selected `foundation.lino` trust profile. | Both suites query contracts and proof evidence, execute positive and negative conformance cases, reject unknown, incomplete, or rebound implementations, reject unrelated typed judgements, and reject candidate-authored trust declarations. |
| R3 | Give the simplest direct definition of Links Theory in itself. | `links-by-links` plus the addressed `doublet` template. | Both suites require the self-definition and check template expansion through an import. |
| R4 | Introduce set theory in more than one way. | `MembershipSetStore` implements addressed membership links, subset, extensional equality, pairing, union, separation, and replacement; the sequence store implements canonical ordered-unique sets. | Both suites execute the set operations and canonical-tree behavior, and require both checked definition links. |
| R5 | Represent strict sets as ordered sequences without duplicates. | `encodeSet` / `encode_set` sort and deduplicate references, then create a balanced doublet tree; the ordered-set API rejects duplicates. | Canonicalization, exact doublets, round trips, strict-order checks, and duplicate rejection in JS and Rust. |
| R6 | Implement sequences through doublet links. | `encodeSequence` / `encode_sequence` create balanced, left, or right nested trees whose root and branches are link addresses. | Both suites assert exact four-element trees and decode all layouts to the same leaves. |
| R7 | Support directly and indirectly self-referential, potentially infinite sequences. | Addressed doublets plus bounded right-spine `walk`. | Direct-cycle and two-node-cycle tests in JS and Rust. |
| R8 | Unify concepts/terms/addresses. | `(term theory local-name shared-address)` links and address-mediated translation. | Six-theory resolution, reverse lookup, and cross-theory translation tests. |
| R9 | Reason algorithmically about selected theories. | Generic `TheoryNetwork`, exact implementation manifests, complete finite conformance checks, proof replay, exact-conclusion checking, shared-address translation, and cycle-safe shortest definition-chain search. | Tests append an unknown user theory with its own contract/proof; reject unwitnessed, unsupported, incomplete, rebound, or misproved definitions; corrupt typed and definition premises; and query through the bundled cycle. |
| R10 | Use `meta-language` for representation. | Both readers parse and reconstruct through the existing bridge first. | Both suites require a byte-lossless round trip. |
| R11 | Keep JS/Rust behavior consistent, documented, and logged. | Mirrored modules/tests, shared LiNo source, executable example, this case study, and `docs/META_THEORY.md`. | Full language suites, focused parity tests, corpus parity, and CI. |
| R12 | Treat graphs as a subset of links networks, not as the ambient meta-theory. | The public surface is `TheoryNetwork` over `LinkNetwork`; `LinkGraph` separately constrains edges to a membership-link vertex set. | Naming scan plus mirrored raw-link, endpoint validation, successor, and reachability tests. |
| R13 | Implement graph theory and relational algebra over set/type/link foundations. | Checked set/type definitions for graph theory and relational algebra; graph edges and relation pairs are actual typed links with concrete pair types. | Both suites execute graph reachability and relation converse, union, intersection, composition, pair typing, and invalid-domain rejection. |

## Architecture

### The theory network is data-driven and witnessed

The API does not enumerate known theories. It recognizes the generic
`theory`, `term`, `implementation`, `witness`, and `definition` shapes. A
domain theory can be added without recompiling RML and queried with the same
algorithms. A definition link is invalid unless its implementation manifest
matches the proposed subject/foundation pair and the adapter's exact kind and
obligation set; every operation conforms; its proof object replays; and the
proof conclusion exactly matches the link. Unknown clauses, incomplete
obligations, rebinding a
passing adapter to another theory, or reusing a proof whose subject differs
therefore makes network construction fail.

The implementation-capability axioms are an explicit trust boundary in
`lib/meta-theory/foundation.lino`, selected independently from the candidate
`core.lino`. The same profile supplies adapter contracts, inference rules, and
the exact judgement required for every typed obligation. Candidate documents
may supply proof objects but cannot add any of those trusted forms. The checks
establish that the shipped executable representation completely backs the
exact finite contract stated by its manifest. They do not claim equivalence of
unrestricted mathematical theories.

### Local names share addresses without being collapsed

A set-theoretic `reference`, a type-theoretic `term`, and a Links Theory
`link` retain their native names. Their shared address records an explicit
correspondence. `translateTerm` / `translate_term` follows that address into a
selected target theory rather than relying on hard-coded vocabulary.

### Finite trees and productive cycles are separate contracts

Finite sequences follow meta-theory 0.0.3: the sequence is the root reference
of a nested binary tree, internal nodes are addressed doublets, and leaves are
the sequence values. The balanced, left, and right layouts differ only in
shape. A canonical finite set sorts and deduplicates values before using the
balanced layout.

Potentially infinite sequences instead use a designated right-spine
interpretation `(current-value, next-reference)`. They may cycle directly or
indirectly and can only be observed through a caller-supplied bound. Keeping
this API distinct avoids treating a finite tree traversal as an unbounded
stream traversal.

### Graphs and relations are explicit derived interpretations

The meta-logic and meta-theory use links networks as their ambient term. A
graph is introduced only by adding a finite vertex set and requiring every
edge's two endpoints to inhabit its vertex type. A binary relation similarly
declares domain and codomain sets and admits only typed ordered-pair links.
Edges and pairs expose the pair types recorded in the underlying
`TypedLinkNetwork`. This makes graph theory and relational algebra executable
specializations rather than names applied to the whole links network.

## Result compared with the latest draft

RML now executes the 0.0.3 finite sequence/set representation, exposes all
three tree layouts, supplies a second extensional-membership set
representation, admits definition links only after exact contract conformance
and proof checks, translates terms through one address space, adds bounded
cyclic observation, and includes verified graph-theory and relational-algebra
layers.
The general theory network accepts caller-selected theories without
hard-coding the six bundled names.

The verification boundary is deliberately narrow: tests prove that the
shipped parsers, proof-witness binding, exact manifests, finite contract
conformance, theory-network traversal, typed graph/relation algorithms,
doublet layouts, finite set algebra, canonicalization, and bounded observations
behave as documented. Upstream Lean/Rocq files supply the formal-development
baseline; this PR does not imply that RML has mechanically proved unrestricted
equivalence of all theories.
