# Executable Meta-Theory

RML represents theories, their definitions, and their vocabulary as one
addressed network. The bundled network is
[`lib/meta-theory/core.lino`](../lib/meta-theory/core.lino); JavaScript and Rust
load that same file through the `meta-language` bridge and expose matching
query APIs.

This closes the definition cycle proposed by Links Theory:

```text
Relative Meta-Logic -> Links Theory -> Set Theory
                                  \-> Type Theory
                                  \-> Links Theory

Set Theory  -> Links Theory
Type Theory -> Links Theory
```

An arrow means “the theory on the left has a definition using the theory on
the right.” The graph is cyclic by design. Breadth-first path queries keep a
visited set, so a self-definition or a longer definition cycle cannot make a
query diverge.

## Source vocabulary

The graph reader recognizes three generic LiNo forms:

```lino
(theory theory-name (address stable.theory.address))

(term theory-name local-term shared.concept.address)

(definition definition-name
  (subject theory-being-defined)
  (using defining-theory)
  (witness stable.definition.address))
```

Theory names are data, not an enum. A consumer can append its own `theory`,
`term`, and `definition` links and immediately use the same path and address
queries. Validation rejects duplicate theory addresses, ambiguous local-term
mappings, and references to undeclared theories.

Every source is first parsed and reconstructed by `meta-language`. The theory
reader consumes only the reconstructed LiNo, and exposes whether the source
round trip was byte-for-byte lossless. This makes the graph an actual consumer
of the repository's meta-language integration rather than a parallel parser.

## Unified concept addresses

Surface terms remain local to their theories. Their shared address supplies
the cross-theory identity:

| Theory | Local term | Shared address |
|--------|------------|----------------|
| Links Theory | `link` | `rml.concept.addressable-link` |
| Relative Meta-Logic | `expression` | `rml.concept.addressable-link` |
| Set Theory | `reference` | `rml.concept.addressable-link` |
| Type Theory | `term` | `rml.concept.addressable-link` |

This is an explicit correspondence, not a claim that the four surface terms
have identical native definitions. Algorithms join on the address while
presentations retain the vocabulary of their source theory.

JavaScript:

```js
import { readFileSync } from 'node:fs';
import { TheoryGraph } from './js/src/rml-theory-graph.mjs';

const graph = TheoryGraph.fromRml(
  readFileSync('./lib/meta-theory/core.lino', 'utf8'),
);

graph.resolveTerm('set-theory', 'reference');
// rml.concept.addressable-link

graph.definitionPath('relative-meta-logic', 'type-theory');
// [relative-meta-logic, links-theory, type-theory]
```

Rust:

```rust
use rml::theory_graph::TheoryGraph;

let source = std::fs::read_to_string("lib/meta-theory/core.lino")?;
let graph = TheoryGraph::from_rml(&source)?;

assert_eq!(
    graph.resolve_term("set-theory", "reference"),
    Some("rml.concept.addressable-link"),
);
```

## Links Theory in itself

The smallest bundled self-definition is the addressed doublet:

```lino
(template (doublet address source target)
  (address maps-to (source target)))
```

The address is itself a link reference, and `source` and `target` are link
references. No separate node, edge, set, or type primitive is required. A
triplet is encoded by nesting the same doublet template. The runnable
[`examples/meta-theory-graph.mjs`](../examples/meta-theory-graph.mjs) explores
the resulting graph and a cyclic sequence. The mirrored JavaScript and Rust
theory-graph suites check both template expansions through a real library
import.

The explicit `links-by-links` definition edge records that this presentation
is Links Theory's definition in itself. Separate `links-by-sets` and
`links-by-types` edges record its set-theoretic and type-theoretic
presentations.

## Sets and sequences

The network records two set interpretations using links:

1. `sets-by-membership-links` is the conventional extensional presentation.
2. `sets-by-ordered-unique-links` represents a set as an ordered sequence of
   concept addresses and rejects duplicate addresses.

`DoubletSequenceStore` implements the second presentation. A finite sequence
is a chain of addressed `(value, next-address)` doublets ending at
`rml.sequence.empty`. `encodeOrderedSet` / `encode_ordered_set` checks
uniqueness before mutating the store; `decodeOrderedSet` /
`decode_ordered_set` checks both node cycles and repeated values.

Links may point directly or indirectly to themselves. Such a chain denotes a
potentially infinite sequence. `walk` therefore always requires a maximum
item count and returns `complete`, `cyclic`, and the first observed cycle
position. It never attempts to decide arbitrary termination.

```js
const store = new DoubletSequenceStore();
store.define('a', 'concept.alpha', 'b');
store.define('b', 'concept.beta', 'a');
store.walk('a', 5);
// values: alpha, beta, alpha, beta, alpha; cyclic: true; cycleAt: 0
```

## Verification boundary

Mirrored tests in `js/tests/theory-graph.test.mjs` and
`rust/tests/theory_graph_tests.rs` verify:

- lossless loading through `meta-language`;
- the RML → Links Theory dependency and Links Theory's set/type/self
  definitions;
- both set-theory interpretations using links;
- shared concept resolution in every bundled theory;
- arbitrary user-defined theories and shortest definition paths;
- rejection of ambiguous addresses and duplicate ordered-set values;
- bounded direct and indirect self-reference.

These tests verify the finite representations and graph algorithms shipped by
RML. They do not assert that all mathematical theories are equivalent, nor do
they treat a finite prefix as a proof about an entire infinite sequence.
