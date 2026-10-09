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
This is structural transport coverage. The archive does not automatically lower
every existing host-side rule, substitution, proof or workspace record into this
links network; whole-product semantic projection remains open. Successful restoration
is not proof verification or a soundness certificate.

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

## Reproduce

```sh
node --test js/tests/semantic-archive.test.mjs js/tests/theory-network.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --jobs 2 --test semantic_archive_tests --test theory_network_tests
```

The tests also reject corrupted framing, out-of-bounds input, missing definitions,
conflicting identities and unsupported hidden metadata, while preserving explicit
open-network behavior outside the archive.
