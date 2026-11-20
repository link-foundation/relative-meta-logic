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
| Audit date | 2026-09-21 |
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

At the foundational level, the upstream network is an addressed doublet
function of the form `N² : Reference -> Reference × Reference` (with the Lean
and Rocq presentations spelling out the corresponding reference and network
types). `MetaDefinitions` establishes structural self-definition relationships.
Neither module introduces an execution or reduction transition. Consequently,
the current RML S/K contractions are not attributed to upstream Links Theory;
they are separately reported as externally primitive laws over the upstream
addressed-link structure.

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

## Complete linked semantics and formal builds

The audit is now machine-enforced rather than only narrative. The candidate
[`upstream-0.0.3.lino`](../../../lib/meta-theory/upstream-0.0.3.lino) records
the complete normalized compiler-input token stream for all nine Lean and nine
Rocq modules. Every one of the 229 declaration links supplies ranges for its
complete syntax, signature/judgement, definition body, and source proof
object, plus recursion and resolved dependency links. This is 8,815 typed
source-token links and 510 dependency links rather than an inventory of names.

A separately loaded contract pins the repository and revision together with
module, declaration, token, and dependency counts and a semantic SHA-256.
JavaScript and Rust independently validate the ranges and theorem/definition
invariants, derive admission status from proof content, resolve every
dependency, and reject an incomplete or modified candidate. The candidate
cannot supply its own contract.

The `formal-corpus` workflow checks out that exact revision, re-extracts the
full lexical semantics and dependency graph, and compares it declaration by
declaration with the LiNo corpus. It then builds the same complete source with
both proof assistants. This connects the linked RML representation to the
native kernel results and also covers source-level commands outside named
declarations.

## Verification boundary

The linked corpus preserves external source proof terms and tactic scripts and
validates their ranges, status, dependencies, and semantic fingerprint. Lean
and Rocq remain authoritative only for those pinned language-specific
artifacts. Four Lean obligations in the snapshot contain `sorry` and remain
reported as admitted.

RML reasoning has a different boundary. The shared `universal.lino` programs
define object theories with linked rewrites, facts, and inference rules.
JavaScript and Rust run those programs with the same theory-independent
structural machine. Contract conformance and witness proof replay never call a
Lean/Rocq kernel and never dispatch to theory-specific host callbacks.

The ambient representation is a **links network**, not a graph. Graph theory
is a derived program that adds vertex membership, endpoint closure,
reachability, and edge typing. Relational algebra is another derived program
over typed ordered-pair links. The host graph/relation stores remain convenient
public data structures, but they do not authorize theory definitions.

The external corpus therefore supplies provenance and regression comparison,
while linked-program execution supplies RML semantics. Neither finite corpus
parity nor a native build is presented as proof about arbitrary future
Lean/Rocq programs.
