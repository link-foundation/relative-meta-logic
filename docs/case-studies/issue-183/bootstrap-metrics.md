# Measured bootstrap boundary

This report measures how much semantic machinery remains outside the closed
linked terms used by the current acceptance task. JavaScript and Rust execute
the same generated S/K DAG and check the same metrics independently.

The probe loads textual LiNo, resolves and rebinds an imported rewrite
program, derives a judgement by finite inference, and executes
`links-meta-foundation` through result verification. It is repeated with each
of the four boundary operations disabled. Parsing and resource control remain
reported for auditability but are not counted as semantic contractions.

## Current metrics

The previous column is the last reviewed foundation report at
`e2e9f7b2a87d4b128bb736d693d5512509974860`. A dash means that revision did
not measure the value; it is not silently treated as zero.

| Metric | Previous | Current | Delta |
|---|---:|---:|---:|
| Total host semantic operations | 8 | 2 | -6 |
| Confirmed independent host primitives | — | 2 confirmed; 0 unknown | — |
| Derived host semantic services | 2 | 0 | -2 |
| Host/linked duplicated semantics | — | 0 | — |
| Object-specific host semantics | 0 | 0 | 0 |
| Undocumented runtime semantic paths | — | 0 | — |
| Self-hosting closure | — | 6/6 | — |
| Foundation compression ratio | — | 2/8 | — |

The residual semantic basis is `contract-s-link` and `contract-k-link`.
Disabling either contraction while keeping the other makes the complete probe
fail, so both are classified `INDEPENDENT` relative to this representation and
probe. This is falsifiable experimental necessity, not global mathematical
irreducibility. The report explicitly names iota as an equivalent one-rule
re-encoding; moving to it would change representation, not erase universal
computation.

The versioned schema publishes the complete classification vocabulary:
`INDEPENDENT`, `DERIVABLE`, `EQUIVALENT_REENCODING`, and `UNKNOWN`. Parsing and
resource control are `UNKNOWN` because they are retained non-semantic boundary
layers, not candidates in the two-operation semantic basis.

## Host information by layer

| Layer | Count | Operations |
|---|---:|---|
| Semantic bootstrap | 2 | S contraction, K contraction |
| Derived host semantics | 0 | none |
| Representation/parsing | 1 | linked-form parsing |
| Execution control/resource bounds | 1 | cycle and resource bounds |
| Debugging/observability | 0 | none counted as semantic operations |
| Object-specific host semantics | 0 | none |

Only the semantic-bootstrap row contributes to the two-operation semantic
surface. The other non-zero rows make the input and partial computation
observable but cannot create a match, substitution, rewrite, import,
derivation, or proof.

## Shared closed terms and closure

The generated [`fixed-point.ski`](../../../lib/meta-theory/fixed-point.ski)
artifact contains closed roots for matching, substitution, ordered rule
selection/traversal, import/rebinding, inference saturation, and result
verification. Both runtimes provide only S/K contraction around those roots;
none of the six capabilities has a duplicate host implementation.

For the named
`linked-load-import-reduce-infer-and-self-verify-above-residual-basis` task,
all six semantic capabilities are links-defined and zero are host-defined.
Self-hosting closure is therefore `6 / (6 + 0) = 6/6`. The metric is scoped to
the acceptance probe and does not claim that each capability has equal
mathematical complexity.

## Runtime trust coverage

The current run observes four public semantic paths and 10 distinct
path/operation segments. All 4/4 paths and 10/10 segments are reachable in the
declared trust graph. Undocumented paths, operations, and path segments must
all remain zero. This check uses execution events rather than only comparing
two manually maintained lists.

Run the machine-readable report with:

```bash
cd js
npm run report:bootstrap-metrics
```

Regenerate the shared closed-term artifact and its browser-safe JavaScript
data module with:

```bash
node scripts/generate-combinator-kernel.mjs
```

The output schema is `rml-bootstrap-metrics/v1`. The bootstrap workflow prints
the full JSON report, while the JavaScript and Rust tests independently assert
the counts, removal outcomes, closure, compression, runtime coverage, and
generated-artifact parity.
