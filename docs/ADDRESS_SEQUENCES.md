# Sequences and sets of link addresses

`AddressSequence` in `js/src/rml-address-sequence.mjs` and
`rml::address_sequence::AddressSequence` supplies a lossless finite sequence
view over arbitrary link addresses. An element may name another sequence,
a direct or indirect cycle, an existing doublet, or an external address whose
link definition arrives later. Decoding never opens an element's definition.

The older `DoubletSequenceStore.encodeSequence` / `encode_sequence` APIs retain
their documented bare nested-tree interpretation: every stored doublet is a
branch. They therefore flatten a link-valued leaf. Use `AddressSequence` when
an address must remain one element. This is an explicit representation choice;
it is not a claim that links have intrinsic element or branch roles.

## Every boundary is a doublet

For a selected namespace `N`, three self-referential constructor addresses are
stored as ordinary doublets:

- `N:empty = (N:empty, N:empty)`
- `N:element = (N:element, N:element)`
- `N:branch = (N:branch, N:branch)`

An element occurrence is `(N:element, value-address)`. A branch is
`(N:branch, pair-address)`, and its pair is `(left-sequence, right-sequence)`.
`N:empty` denotes the empty sequence. An occurrence of that same address as an
element is wrapped and remains an element. Balanced, left and right layouts
use these same constructors. A singleton has an explicit element occurrence;
its root is never silently identified with the value it contains.

The snapshot schema `rml-address-sequence/v1` contains only the selected
namespace and the addressed doublets. Reconstructing it restores the same
boundaries, shared references and element cycles without a host-only role map.
The decoder follows branch links, bounds shared expansion and rejects cycles
in sequence structure. Element cycles remain opaque addresses.

## Set interpretation

`encodeSet` / `encode_set` removes repeated addresses and sorts them by Unicode
scalar order. `decodeSet` / `decode_set` requires that strict order. The ordered
set methods retain caller order and reject repeated addresses instead.

For example, encode `['a']` as `inner`, then encode `[inner]` as `outer`.
The roots differ; decoding the first yields `['a']`, and decoding the second
yields `[inner]`. Repeating `inner` in the outer set removes that repeated
address without flattening its contents. Addresses remain the chosen identity
contract: two independently addressed equal-content sets are not automatically
quotiented into one address.

The separate extensional-membership interpretation remains available through
`MembershipSetStore` and the linked set programs. Finite address codecs do not
by themselves implement all axioms or theorems of classical set theory.

## Bounds and validation

Input and output default to at most 10,000 elements, with at most 100,000 stored
or visited links. Stored snapshots and each encoding operation have a
1,048,576 Unicode-scalar text bound. Each reference is a nonempty Unicode string
of at most 4,096 scalars. Explicit decode bounds must be positive. The decoder
uses an explicit work stack, including for left and right trees.

Generated identities must neither replace existing links nor capture an input
address. Encoding checks the entire proposed allocation before inserting it.
Snapshot reload rejects duplicate identities, absent/corrupt constructor links
and malformed records. Decoding rejects unknown constructors, missing branch
payloads, missing sequence nodes, structural cycles, excess shared expansion,
and noncanonical or duplicate set views. External element references are allowed
and remain distinguishable from dangling structural references.

The mirrored `address-sequence` tests consume
`test-corpus/address-sequences/cases.json`, including nested singleton sets,
link-valued and cyclic elements, later definitions, all three layouts, Unicode
ordering, snapshot corruption and finite resource limits.
