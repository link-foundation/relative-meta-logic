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

Type declarations are themselves addressed doublets. For example, the first
fact is `rml.type-fact.0: (Type, Type)`, where the source is the subject and the
target is its type. These type-fact links are the authority. The host
`Map`/`BTreeMap` is only an acceleration index: it can be cleared, queries still
read the same linked facts, and rebuilding it does not change the semantic
snapshot. Mirrored tests exercise that invariant.

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

This finite ontology does not yet recursively close every RML rule,
substitution, judgement, proof, foundation, or physical encoding. Pair types
created by general typed networks are still textual references until their
own links are supplied. Identity- and cycle-preserving serialization of the
entire semantic surface, and the explicit link-cli interoperability mapping,
remain separate open requirements.
