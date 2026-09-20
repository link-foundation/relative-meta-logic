# Upstream baseline audit

This log records the source review used for issue
[#183](https://github.com/link-foundation/relative-meta-logic/issues/183).
It exists because an initial pass identified the current repository commit
correctly but treated article 0.0.2 as the latest design. Re-reading the entire
default branch and recent merged work showed that version 0.0.3 materially
changes the sequence and set representation.

## Snapshot

| Field | Value |
|-------|-------|
| Repository | [`link-foundation/meta-theory`](https://github.com/link-foundation/meta-theory) |
| Default-branch commit reviewed | [`087f4515d0652925eecc54bcade724445c3978f1`](https://github.com/link-foundation/meta-theory/commit/087f4515d0652925eecc54bcade724445c3978f1) |
| Commit date | 2026-04-17 |
| Audit date | 2026-09-20 |
| Latest draft directory | [`drafts/0.0.3`](https://github.com/link-foundation/meta-theory/tree/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3) |
| Sequence/set development | [PR #40](https://github.com/link-foundation/meta-theory/pull/40) |
| Unified reference-space development | [PR #44](https://github.com/link-foundation/meta-theory/pull/44) |

The issue and all comments were reviewed, along with the PR conversation,
review, and inline-comment channels for the relevant upstream work.

## Source findings

The following upstream files define the baseline used here:

- [`SequenceDefinitions.lean`](https://github.com/link-foundation/meta-theory/blob/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3/src/lean/SequenceDefinitions.lean)
  and its Rocq counterpart define leaf/node link trees, balanced trees, and
  left/right staircases.
- [`SetDefinitions.lean`](https://github.com/link-foundation/meta-theory/blob/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3/src/lean/SetDefinitions.lean)
  sorts and deduplicates a list before building a balanced set tree.
- [`SetSequenceEquivalence.v`](https://github.com/link-foundation/meta-theory/blob/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3/src/rocq/SetSequenceEquivalence.v)
  establishes the strictly ascending, membership-preserving sequence result in
  Rocq.
- [`MetaDefinitions.lean`](https://github.com/link-foundation/meta-theory/blob/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3/src/lean/MetaDefinitions.lean)
  and the Rocq counterpart express the self-definition layer.
- [`NetworkDefinitions.v`](https://github.com/link-foundation/meta-theory/blob/087f4515d0652925eecc54bcade724445c3978f1/drafts/0.0.3/src/rocq/NetworkDefinitions.v)
  gives references, doublets, tuple networks, and the network-of-networks
  representation.

For four leaves `[1, 2, 3, 4]`, the three required shapes are:

```text
balanced: ((1, 2), (3, 4))
left:     (((1, 2), 3), 4)
right:    (1, (2, (3, 4)))
```

The sequence/set is the root link reference. Internal branches are ordinary
addressed doublets; the representation does not introduce a second kind of
node object.

## Correction applied in this PR

The first RML draft encoded a finite sequence as a linked list of
`(value, next)` cells. That shape supports productive cyclic observation but
does not implement the nested finite representation requested in upstream PR
#40. The review therefore produced a failing test first and then replaced the
finite encoder/decoder with nested trees in both runtimes.

The right-spine linked interpretation remains available only through bounded
`walk`, where it is useful for direct and indirect cycles. The public contract
now makes the two interpretations explicit:

| Contract | Shape | Termination behavior |
|----------|-------|----------------------|
| `encodeSequence` / `encode_sequence` | finite nested binary tree | complete recursive decode; cycles rejected |
| `encodeSet` / `encode_set` | sorted unique balanced tree | canonical finite decode; strict order checked |
| `encodeOrderedSet` / `encode_ordered_set` | caller order, unique balanced tree | finite decode; duplicates rejected |
| `walk` | `(value, next-reference)` right spine | caller-bounded; direct/indirect cycles reported |

## Verification boundary

The upstream Lean and Rocq directories are formal developments, but they are
not part of RML's trusted kernel and are not re-proved by this change. Some
Lean proof obligations in the reviewed snapshot remain admitted with `sorry`;
the corresponding status must not be summarized as a blanket machine-checked
proof of every 0.0.3 claim. RML's acceptance evidence is instead mirrored
runtime tests for exact doublets, tree round trips, two independent finite-set
representations, canonical ordering, graph traversal, and bounded cycles.
Definition witnesses additionally reuse RML's proof checker: each link must
name a supported executable implementation, pass its implementation probe,
and carry a checked proof whose conclusion binds that exact link. The explicit
implementation-capability axioms remain the host trust boundary; this is not a
proof of full theory equivalence.

The ambient representation is a **links network**, not a graph. Graph theory
is implemented only as a derived interpretation that adds a finite vertex set
and admits links whose endpoints belong to that set. Relational algebra is a
second derived interpretation over typed ordered-pair links, with executable
converse, union, intersection, and composition. This distinction follows the
maintainer review and prevents graph vocabulary from narrowing the more
general links substrate.
