# Case study: make Relative Meta-Logic genuinely meta

Issue [#183](https://github.com/link-foundation/relative-meta-logic/issues/183)
asks RML to connect its existing Links Theory, set theory, type theory, and
self-bootstrap work into one functional, tested meta-theory.

## Research baseline

The latest `link-foundation/meta-theory` default-branch draft reviewed for this
work was commit `087f451` and article version 0.0.2, published April 1, 2025 and
updated August 10, 2025. Its executable mathematical contribution is the
family of associative networks
`lambda: L -> L^n`, including doublets, triplets, arbitrary sequences, and
sequence-to-nested-pair conversion. It provides definitions of Links Theory
inside set theory and a Coq/type-theory projection through set theory.

The draft explicitly lists the reverse projections—Links Theory in itself,
set theory in Links Theory, and type theory in Links Theory—as future work.
RML already had the ingredients in separate places:

- [`docs/META-THEORY-MAPPING.md`](../../META-THEORY-MAPPING.md) maps RML links,
  proofs, and foundations to references/doublets/triplets;
- [`lib/set-theory/core.lino`](../../../lib/set-theory/core.lino) provides
  reusable set schemas;
- [`lib/self/`](../../../lib/self/) encodes the grammar, evaluator, types,
  operators, metatheorem checker, and foundation catalogue as links;
- PR [#182](https://github.com/link-foundation/relative-meta-logic/pull/182)
  added tested JavaScript and Rust `meta-language` bridges.

The missing element was an executable relation between those parts.

## Requirements and evidence

| ID | Requirement | Implementation evidence | Automated evidence |
|----|-------------|-------------------------|--------------------|
| R1 | Base RML on Links Theory/meta-theory. | `rml-by-links` in `lib/meta-theory/core.lino`. | Both suites require the RML → Links Theory edge and derived paths. |
| R2 | Define Links Theory through set theory and type theory. | `links-by-sets`, `links-by-types`. | Both suites query paths from RML to each defining theory. |
| R3 | Give the simplest direct definition of Links Theory in itself. | `links-by-links` plus the `doublet` template. | Both suites require the self edge and check template expansion through an import. |
| R4 | Introduce set theory in more than one way. | Extensional-membership and ordered-unique-sequence definition edges. | Both suites require exactly two link-based set definitions. |
| R5 | Represent strict sets as ordered sequences without duplicates. | `DoubletSequenceStore` finite chain encoding. | Round-trip and duplicate-rejection tests in JS and Rust. |
| R6 | Support directly and indirectly self-referential, potentially infinite sequences. | Addressed doublets plus bounded `walk`. | Direct-cycle and two-node-cycle tests in JS and Rust. |
| R7 | Unify concepts/terms in one address space. | `(term theory local-name shared-address)` links. | Four-theory resolution and reverse lookup tests. |
| R8 | Reason algorithmically about user-selected theories. | Generic `TheoryGraph`, validation, and cycle-safe shortest-path search. | Tests append an unknown user theory and query through the bundled cycle. |
| R9 | Use `meta-language` for representation. | Both readers parse/reconstruct through the existing bridge first. | Both suites require a byte-lossless round trip. |
| R10 | Keep JS/Rust behavior consistent and documented. | Mirrored modules, tests, shared LiNo source, executable example, and `docs/META_THEORY.md`. | Full language suites, focused parity tests, corpus parity, and CI. |

## Design decisions

### The graph is data-driven

The API does not enumerate known theories. It recognizes only the generic
`theory`, `term`, and `definition` shapes. That is what lets a caller add a
domain theory without recompiling RML and then ask the same path and address
questions.

### Local names are not collapsed

A set-theoretic `reference`, a type-theoretic `term`, and a Links Theory
`link` retain their native names. Their shared address records an explicit
correspondence. This avoids silently claiming more equivalence than the
network states.

### Infinite structures are observed productively

Direct and indirect cycles are valid sequence structures. All traversal is
bounded by the caller, which prevents nontermination. Materializing an
ordered set rejects cycles because a completed finite set and a potentially
infinite sequence have different contracts.

## Result compared with the draft

RML keeps the draft's set and type projections and adds working reverse and
self projections. It also adds executable cross-theory address lookup,
cycle-safe reasoning, two set interpretations, and mirrored runtime tests.
That completes the definition cycle described in the draft's future-work
section while stating the verification boundary precisely: the implementation
proves its data and algorithms behave as specified, not that all external
theories are mathematically equivalent.
