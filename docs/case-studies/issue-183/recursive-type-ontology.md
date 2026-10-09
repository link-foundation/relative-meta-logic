# Selectable recursive type ontology

RML exposes a small, selectable linked ontology for experiments that need the
requested recursive default. It is a construction over addressed doublets, not
an assertion that every foundation must use this type theory.

## Orientation and identity

`TypedLinkNetwork.withDefaultOntology()` in JavaScript and
`TypedLinkNetwork::with_default_ontology()` in Rust construct these links:

| Address | Source | Target | Linked type fact |
| --- | --- | --- | --- |
| `Type` | `Type` | `Type` | `Type` has type `Type` |
| `SubType` | `Type` | `SubType` | `SubType` has type `Type` |
| `Value` | `SubType` | `Value` | `Value` has type `SubType` |

The arrow is oriented from classifier to classified term. Each canonical
term's address is also the target of its defining link. Consequently the
construction preserves address identity and terminates productively as a
finite cyclic graph: inspecting `Type` returns its self-link instead of
recursively expanding an infinite host object.

All three named terms are types represented by ordinary links. `Value` names
the third type in this selectable ontology; it is not an irreducible host value
category. Subtype and instance roles come from the chosen classifier relation:
`SubType` is classified by `Type`, and `Value` by `SubType`. Additional terms
receive their declared types through linked `(subject, type)` facts.

Type declarations are themselves addressed doublets. For example, the first
fact is `rml.type-fact.0: (Type, Type)`, where the source is the subject and the
target is its type. These type-fact links are the authority. The host
`Map`/`BTreeMap` is a disposable compatibility index: typing queries read the
authoritative linked facts, so even a stale or forged JavaScript cache cannot
add a typing judgement. Clearing or rebuilding it does not change the semantic
snapshot. Mirrored tests exercise that invariant.

The invariant follows directly from the public operations: `typesOf` reads
only type-fact links; `typeOf` and endpoint validation call that query; snapshots
and closure validation inspect only links and type facts. No semantic read
uses the index. Tests compare accepted/rejected definitions, newly declared
facts, closure, queries, and snapshots with the index present, deleted, and
rebuilt. Removing an authoritative fact prevents the corresponding typing even
if a JavaScript caller forges the cache. This is an invariant of these typed
network operations, not a soundness theorem for every logical foundation.

`validateClosure`/`validate_closure` reports references that lack defining
links. The three-link default is recursively closed, including its type facts.
General `TypedLinkNetwork` instances remain open by design, so existing graph
and finite-relation clients can refer to externally defined terms. Their
closure report makes that boundary explicit.

## Foundation boundary

The default is opt-in. A bare `TypedLinkNetwork` contains no `Type` link, and
no evaluator or proof checker consults this graph unless a caller selects it.
In particular, the graph-level `Type: (Type, Type)` cycle is not silently
promoted to an impredicative logical `Type : Type` rule. A logical foundation
must separately declare its universes, inference rules, assumptions, and
soundness conditions.

This ontology and its link-cli mapping below are therefore a candidate default
construction, not a premise that settles what links intrinsically are.
Mirrored tests check both sides of that boundary. The constructor's definition
is the only line of either runtime's sources that names it. The evaluator keeps
its stratified universes: `(? (Type of Type))` is `0` unless the source
declares `(Type: Type Type)`, and `(Type 1)` is not of type `(Type 0)`.

## link-cli interoperability

The comparison is pinned to link-cli revision
[`e801cb8`](https://github.com/link-foundation/link-cli/tree/e801cb877f8ed90a103ee253add6f702da89ee40).
Its [`PinnedTypes::next_type`](https://github.com/link-foundation/link-cli/blob/e801cb877f8ed90a103ee253add6f702da89ee40/rust/src/pinned_types.rs#L35) reserves numeric address `n` with shape
`n: (1, n)`. Applying the explicit symbolic mapping `Type = 1`, `SubType = 2`,
and `Value = 3` gives:

| RML term | Mapped RML shape | link-cli pinned shape | Exact |
| --- | --- | --- | --- |
| `Type` | `1: (1, 1)` | `1: (1, 1)` | yes |
| `SubType` | `2: (1, 2)` | `2: (1, 2)` | yes |
| `Value` | `3: (2, 3)` | `3: (1, 3)` | no |

The third pinned identity therefore cannot be copied as RML `Value`. An
adapter must create the `(2, 3)` definition at a non-conflicting address or
retain a separate name-to-address binding. link-cli's named-type decorator
stores names in a separate links database, so no RML symbolic name implies a
numeric identity.

The upstream [pinned-type tests](https://github.com/link-foundation/link-cli/blob/e801cb877f8ed90a103ee253add6f702da89ee40/rust/tests/pinned_types_decorator_tests.rs)
check reserved identities and rejection of an incompatible reserved shape.
Its [named-type implementation](https://github.com/link-foundation/link-cli/blob/e801cb877f8ed90a103ee253add6f702da89ee40/rust/src/named_types.rs)
keeps the name database separate. The [Unicode converter](https://github.com/link-foundation/link-cli/blob/e801cb877f8ed90a103ee253add6f702da89ee40/rust/src/sequences/char_to_unicode_symbol_converter.rs)
and [converter tests](https://github.com/link-foundation/link-cli/blob/e801cb877f8ed90a103ee253add6f702da89ee40/rust/tests/unicode_sequence_converter_tests.rs)
provide the independent endpoint-orientation reference used below.

link-cli encodes a Unicode code unit as `(raw-number,
unicode-symbol-type)`. That instance-first shape agrees with RML's linked type
facts `(subject, type)`, but not with the canonical ontology-definition links,
which are classifier-first. The interop profile exposes both booleans so an
adapter cannot silently reverse endpoints. `linkCliInteropProfile` and
`link_cli_interop_profile` compute and test this mapping in both runtimes.

This finite ontology does not yet recursively close every RML rule,
substitution, judgement, proof, foundation, or physical encoding. Pair types
created by general typed networks are still textual references until their
own links are supplied. Strict identity- and cycle-preserving serialization,
restoration, unified-address closure checks and explicit linked universe-policy
witnesses are now available for typed graphs; see
[Semantic archives](../../SEMANTIC_ARCHIVE.md). Automatic projection of the
entire host-side semantic surface remains open, and graph closure does not
certify logical soundness.
