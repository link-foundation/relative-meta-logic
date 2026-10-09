# Linked proof verification

`lib/meta-theory/proof-verifier.lino` is a reusable, executable verifier for
finite inductive proof certificates. It runs on the existing
`LinkedProgramRegistry.reduce` path. It does not call the host proof searcher,
match theorem names to callbacks, or treat a declaration's presence as proof.
The same linked program runs on the closed S/K runtime and the independently
implemented direct structural runtime.

This is a concrete proof-verification capability, not a claim that the complete
formal corpus, every foundation policy, the implementation stack, or semantic
authority is closed. In particular, it does not elaborate Lean/Rocq proofs, do
definitional conversion, or validate guarded coinduction. Foundation workspace
proofs involving those features cannot simply be relabeled as these certificates.

## Public APIs

JavaScript imports `verifyLinkedProof`, `replayLinkedProof`,
`encodeLinkedProofData`, and `decodeLinkedProofData` from
`js/src/rml-linked-proof.mjs`. Rust exposes the matching functions, options,
receipt and replay types in `rml::linked_proof`.

Load `universal.lino` and `proof-verifier.lino` in an existing registry:

```js
const programs = LinkedProgramRegistry.fromRml(universal + '\n' + verifier);
const receipt = verifyLinkedProof(programs, context, goal, candidate);
const replay = replayLinkedProof(freshPrograms, context, goal, receipt);
// receipt.accepted: the selected linked verifier accepts this proof.
// replay.matches: request, terminal result, and every reduction match exactly.
```

The matching Rust functions take `&LinkedProofOptions` after their arguments.
The selected program defaults to `linked-proof-verifier`; callers may explicitly
choose another loaded linked program. Resource exhaustion remains a reducer
error, rather than becoming a rejection or a proof of falsity.

## Certificate data

All following forms are data, represented by nested arrays/string leaves in
JavaScript or `Node::List`/`Node::Leaf` in Rust. Empty lists are significant.

```text
(proof-context IDENTITY
  ((rule RULE-ID (PREMISE-PATTERN ...) CONCLUSION-PATTERN) ...))

(proof EXACT-CONTEXT GOAL ROOT-ID
  ((node NODE-ID RULE-ID CONCLUSION
     ((VARIABLE-NAME VALUE) ...)
     (PREMISE-NODE-ID ...)
     (DEPENDENCY-RULE-ID ...)) ...)
  (ROOT-DEPENDENCY-RULE-ID ...))
```

A pattern's explicit `(variable NAME)` form binds an entire term. Other terms
are literal structural data. Variable names are string leaves. Facts and explicit
assumptions are zero-premise rules. An identity may include a foundation name,
version, theory identity, assumptions and any other context the caller needs.
The complete rule catalog, rather than just that identity, is repeated in and
checked against the certificate. The caller must independently supply the trusted
context and requested goal to both verification and replay.

Premises are ordered and must have exactly the declared arity. Binding claims
must equal the complete environment produced by the existing linked matcher:
new bindings are prepended, so the order is reverse first discovery across
premises. Repeated variables must agree. The conclusion is obtained by linked
substitution, then compared structurally with the submitted conclusion. Unbound
conclusion variables cannot produce a verified result.

Dependencies have one canonical order: the current rule first, followed by each
premise's dependencies in premise order, dropping an identifier already seen.
Both every node and the root claim this exact list. Extraneous, omitted, repeated,
or reordered dependencies fail. Nodes may share a premise: repeated use does not
create a repeated dependency. Rule and node identities must be unique. Every
listed node must be reachable from the root; all reachable references must exist,
and no ancestor may be revisited. The rule and node list ordering does not affect
validity. This is an inductive policy; a cycle is rejected even if another user
foundation would assign it a coinductive meaning.

`test-corpus/linked-proof/modus-ponens.json` is a complete runnable three-node
example over a user-supplied inference rule, with two assumptions and explicit
bindings. `cases.json` is shared by both runtimes and adds missing, forged,
duplicate, circular, context-swapped, shared-acyclic-network and quotation-adversary cases.

## Executable decomposition

The verifier's rules perform structural membership, ordered unique union,
lookup, duplicate detection, ancestor tracking, pattern interpretation, staged
substitution, premise matching, exact binding/conclusion/dependency comparison,
and reachability. These are reusable linked operations. Matching and substitution
reuse `links-meta-foundation` from `universal.lino`; two local extensions handle
the injective empty-list representation.

The input adapter performs only generic quotation:

```text
string       -> (atom string)
[]           -> (list-end)
[head, ...]  -> (pair quote(head) quote(rest))
```

This is injective, including empty lists. It is important that arbitrary input
constructors are quoted: otherwise an input that spells a verifier operation
could execute during the generic reducer's traversal. No input list becomes an
active operation. Only linked verifier definitions create those operations.
JavaScript rejects cyclic host arrays before quotation; Rust's owned `Node` is
finite. This ingress validation is not a theorem judgement.

Changing the `root-reachable` linked definition from acceptance to rejection
changes the result for the exact same candidate and unchanged runtime. Removing
the linked empty-list matching rule also breaks the inference witness. Tests
exercise both replacement cases. The closed S/K witness also runs with the six
named direct-host semantic services disabled (import resolution, traversal,
matching, structural comparison, substitution and saturation). Disabling either
S or K stops verification, and disabling those direct services stops the direct
control. This tests the registered semantic operations; it does not pretend
to remove every physical host instruction or generic container operation. The verifier is not a host algorithm merely
serialized alongside its implementation.

## Bounded ingress and replay metadata

Quotation and decoding have explicit external resource limits. These are checked
before reduction and before expanding shared input trees. A shared JavaScript
subtree is counted every time it would be unfolded, so a tiny shared acyclic links network cannot cause
exponential allocation before the reducer's step bound is consulted.

- Input defaults: quoted depth 128, 10,000 unfolded nodes, and 1 MiB of UTF-8 text
- Request encoding shares that budget across context, goal and candidate
- Quoted depth includes binary list spines: a shallow wide input cannot create
  an unbounded recursively owned Rust `Node` chain
- Replay metadata defaults: structural depth 256, 1,000,000 unfolded nodes,
  and 16 MiB of UTF-8 text, shared across request, result and trace
- Every configurable depth has a hard ceiling of 256

JavaScript accepts `inputLimits` and `receiptLimits` in verification/replay
options; the codec functions take an optional limits object. Fields are
`maxDepth`, `maxNodes`, and `maxTextBytes`. Rust uses `LinkedProofLimits` with
snake-case fields in `LinkedProofOptions`, and exposes explicit
`encode_linked_proof_data_with_limits` / `decode_linked_proof_data_with_limits`.
Exceeded bounds throw or return an error, never a logical rejection verdict.

Untrusted replay metadata is bounded and checked for cycles before comparison.
JavaScript compares structure without `JSON.stringify`, so forged shared or deep
receipts cannot cause serialization expansion. The complete original inference
trace is retained, and the same cross-runtime golden hashes still apply. These
limits constrain the adapter; execution remains subject to the separate existing
reduction and contraction bounds.

## Trace and independent replay

A receipt includes the exact quoted request, terminal result, number of
reductions, and an ordinary linked trace:

```text
(linked-execution
  (step PROGRAM RULE BEFORE AFTER)
  ...)
```

Acceptance additionally contains a linked tree of `verified-node` evidence with
rule identity, instantiated conclusion, complete bindings and dependencies.
Replay runs the same quoted candidate again in a caller-supplied fresh registry;
it never trusts the receipt's accepted flag, cached proof-search evidence, or
submitted trace. It compares the request, result, every trace step, and derived acceptance/step
metadata. Shared SHA-256 golden observations require both runtimes to produce
identical terminal results for every corpus case and the identical full request
and trace for the inference witness. A forged
executable request or noncanonical quotation is rejected before replay. The
caller supplies the context, goal, and selected verifier again, so a receipt
cannot authorize itself under substituted assumptions or select a different
verifier. Tests compare S/K execution with independent direct-structural replay.

## Remaining trust boundary

The supplied context determines which axioms and inference rules apply. A proof
can establish a consequence relative to that context; it cannot establish why
that context, verifier policy, or interpretation should be authoritative. The
selected registry and its linked kernel are part of this explicit boundary.

The host still handles text parsing, data quotation/unquotation, external resource
bounds, the selected runtime bootstrap, and result/trace presentation. The direct
structural control additionally uses host matching, substitution and traversal;
it is an independent check, not a second closed minimal meta-foundation. S/K
retains the repository's documented bootstrap and artifact/compiler boundary.
The receipt comparison uses host structural equality only to compare replay
artifacts, not to decide a theorem.

This deliverable advances R63 and the execution/replay portion of R143. It does
not close the whole-corpus R122 requirement, foundation-selection authority,
minimality, multiple minimal foundations, or whole-product closure. Those need
separate executable evidence at their declared scope.
