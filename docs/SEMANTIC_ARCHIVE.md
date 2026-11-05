# Closed typed links-network archives and relative universe contracts

`TypedSemanticArchive` in `js/src/rml-semantic-archive.mjs` and
`rml::semantic_archive::TypedSemanticArchive` provides strict, bounded,
identity-preserving transport for addressed typed links networks. The network remains a
finite table of doublets: cycles and shared references are stored by address,
never unfolded into an infinite tree.

## Closure and identity

Ordinary links and linked type facts occupy one address namespace. An address
cannot have conflicting ordinary-link/type-fact roles. Every endpoint,
including a reference to another type fact, must resolve in that namespace.
All supplied roots must resolve and must be distinct. Duplicate definitions,
dangling endpoints and unrepresented fields are rejected by the strict archive.

`TypedLinkNetwork.fromSnapshot` / `from_snapshot` restores exact addresses and
rebuilds its disposable type index. General snapshots can still be explicitly
open; the archive requires closure. Missing textual pair-type references are
reported, not silently converted into new definitions. New type-fact addresses
skip existing ordinary addresses, and typed definitions reject collisions before
changing the network. `identityConflicts` / `identity_conflicts` reports storage
role conflicts, and the existing closure report returns `closed: false` for
these conflicts without changing its public field layout.

Typing queries read the linked facts as their authority. Editing a JavaScript
cache cannot add a typing judgement. Restoring or discarding that cache does not
change the semantic snapshot. Querying an absent type returns `null` / `None`,
including in Rust, where an eager empty-vector index previously panicked.

## Portable framing

The version-one byte stream consists of:

1. ASCII header `RML-TYPED-LINKS/1` followed by a newline
2. Decimal root count and newline, then one framed root per line
3. Decimal ordinary-link count and newline, then one addressed triple per line
4. Decimal type-fact count and newline, then one addressed triple per line

A field is its UTF-8 byte length in canonical decimal, `:`, then exactly that
many bytes. Triple lines contain three consecutive fields followed by a newline.
Type-fact triples use address, subject and type. Rows are sorted by address;
root order is preserved. UTF-8 labels, leading byte-order marks, newlines, colons
and NUL characters round-trip without changing address identity. Invalid Unicode,
non-canonical/overflowing lengths, truncation and trailing bytes are rejected.

Defaults are 8 MiB per byte stream, 100,000 links and 65,536 bytes per field.
Callers can supply explicit positive limits. Decoders check input size, counts,
field lengths and remaining bytes before constructing a closed links network. The codec
has no dependency on JSON, a platform-specific pointer layout or a host object
identity. Its framing and the two Link roles are explicit representation
conventions, not a claim that their meanings follow intrinsically from links.

The shared corpus `test-corpus/semantic-archive/graph.json` includes term,
address, type, value, rule, substitution, judgement, proof, foundation and
ontology addresses, shared references and cycles. Both runtimes independently
produce the same 618 bytes recorded in `expected.hex`, and restore those bytes.
This fixture is structural transport coverage. Projection of actual host
records is provided separately by the semantic closure below. Successful
restoration is not proof verification or a soundness certificate.

## Universe and soundness separation

No constructor selects an ontology implicitly. An empty typed archive contains
no `Type` link. An explicitly selected links-network ontology can contain
`Type = (Type, Type)` without adding any logical `Type : Type` rule.

`test-corpus/semantic-archive/universe-contracts.lino` supplies two relative
universe policies as ordinary linked programs over the same unchanged theory.
One derives typing only from declared higher-level relationships; the other
explicitly adds a self-universe axiom. Their soundness obligations are separate
linked judgements. Neither declares or proves a global soundness certificate.
The example's higher-level relationship is a supplied premise, not an automatic
well-foundedness checker.

Mirrored tests load both policies through the public direct-structural and
closed-S/K workspaces. Keeping the links-network self-cycle fixed while removing the
self-universe axiom changes the logical judgement from proved to unknown. This
prevents archive/ontology structure from silently granting logical authority.

## Recursive semantic closure

`projectSemanticClosure` in `js/src/rml-semantic-closure.mjs` and
`rml::semantic_closure::project_semantic_closure` lower actual host objects into
one archive rooted at `rml.closure`:

- every program of a `LinkedProgramRegistry`, with its imports, rebindings and
  rewrite, fact and inference rules;
- `describe` foundation packages, with versions, dependencies, roles,
  signatures, cycle policies and guard rules;
- `ask` results, with instance, foundation, query, status, reason, assumptions,
  proof tree and every pattern answer's substitution and proof;
- reduction values, with program, input, normal form and step count; and
- an explicitly selected ontology, such as the `Type`/`SubType`/`Value` links.

Terms are cons lists of atom links ending in `rml.nil`. Every anonymous record
(list cell, proof, substitution, judgement, value) is addressed by the SHA-256
of its length-framed endpoints, so equal subterms and shared subproofs have
exactly one address. Programs, rules and foundations keep declared addresses,
so a program lists its rules and each rule links back to its program: these
cycles are stored as finite addressed doublets. Proof steps refer to rule links;
assumption and coinductive-hypothesis leaves keep their labels.

Eleven categories (`term`, `address`, `type`, `value`, `rule`, `substitution`,
`judgement`, `proof`, `foundation`, `ontology`, `program`) are themselves links
classified by the `rml.category` self-link. Membership is a content-addressed
type fact, not a host enum field. Atoms are addresses; categories and ontology
classifiers are types.

`validateSemanticClosure` / `validate_semantic_closure` requires the single
root, recomputes every content address, checks atom/nil self-links, proper
lists, named identities, record arity and reference kinds, program/rule back
references in both directions, reachability from the root, the allowed
categories for each structural kind, and at least one member per category. It
then reconstructs programs, foundations, judgements, proofs, substitutions,
values and the ontology. A reconstructed program set is executable again by an
unchanged `LinkedProgramRegistry`. Shared subproofs reconstruct to one object in
JavaScript.

Both runtimes load `test-corpus/semantic-archive/closure-programs.lino` and
`closure-foundations.lino`, project the same host results and must produce the
60,979 bytes and SHA-256 recorded in `closure-expected.json`; the direct and
closed S/K execution bases produce identical bytes. Negative tests reject
dangling references, hidden snapshot or row fields, extra record fields,
unrepresented nodes, category spoofing, missing category facts, forged fact
addresses, identity splitting, merged duplicate identities, renamed rule
identities, and broken program/rule cycles in either direction. Without a
selected ontology the closure is reported incomplete and no `Type` link is
invented.

The projection covers the record types listed above. Refutation and coinduction
details of a result, rewrite traces, host-operation observations, bootstrap
reports, language-source networks and the compiled S/K kernel are not yet
lowered. The SHA-256 addressing, record layouts and category vocabulary are
declared representation conventions executed by host code; they are not
derived from links and do not remove the host from the trust boundary.

## Foundation-declared universe and soundness contracts

`validateUniverseContract` / `validate_universe_contract` reads a foundation's
contract only through public pattern queries of one instance:

- `(universe-policy P)`: `stratified` or `type-in-type`;
- `(universe-typing-judgement NAME)`: the foundation's own typing predicate;
- `(universe-below LOWER UPPER)`: the declared universe order;
- `(universe-cumulativity cumulative)`: optional transitive typing; and
- `(soundness-contract OBLIGATION)`: additional declared obligations.

A stratified policy implies `well-founded-universe-order` (the finite declared
order is acyclic) and `typing-respects-universe-order` (each derived typing
judgement between universes follows a declared edge, or a path when cumulative).
`no-universe-self-typing` can be declared. Each obligation reports `holds`,
`violated` with a judgement and/or cycle witness, or `unsupported` when the
validator has no check for it, such as `global-consistency`. The report status
is `accepted`, `violated`, `not-declared`, `unsupported` or `incomplete`, and
`consistency` is always `not-established`.

`universe-soundness-contracts.lino` executes nine instances on both public
bases. The stratified foundation is accepted. A version that smuggles in
`(has-type Type Type)` is violated with the `Type, Type` cycle. A circular order
is violated with `U1, U2, U1`. Derived `Type : U2` is violated without the
cumulativity fact and accepted with it; removing that one linked fact changes
the verdict. The `type-in-type` foundation is accepted and labelled
`accepted-relative-to-declared-type-in-type`. A foundation with no policy, or
whose signature excludes it, is `not-declared`; no default policy is imposed. A
search bounded at one round is `incomplete`.

The default ontology's graph facts are not typing judgements. Supplying them
explicitly as extra judgements makes the stratified foundation report the
`Type : Type` self-cycle, while the type-in-type foundation accepts the same
promotion. The `Type = (Type, Type)` link is unchanged either way.

This validates a declared contract relative to the foundation's own derived
judgements. It is not a universal well-foundedness, normalization or
consistency checker, and an accepted report is not a soundness proof.

## Reproduce

```sh
node --test js/tests/semantic-archive.test.mjs js/tests/semantic-closure.test.mjs js/tests/theory-network.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --jobs 2 --test semantic_archive_tests --test semantic_closure_tests --test theory_network_tests
```

The tests also reject corrupted framing, out-of-bounds input, missing definitions,
conflicting identities and unsupported hidden metadata, while preserving explicit
open-network behavior outside the archive.
