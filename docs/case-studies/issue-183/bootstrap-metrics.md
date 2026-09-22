# Measured bootstrap boundary

This report measures how much semantic machinery remains outside the closed
linked terms used by the current acceptance task. JavaScript and Rust execute
the same addressed-link runtime DAG and check the same metrics independently.

The probe loads textual LiNo, resolves and rebinds an imported rewrite
program, derives a judgement by finite inference, and executes
`links-meta-foundation` through result verification. It is repeated with each
of the four boundary operations disabled and with S and K disabled together.
Parsing and resource control remain reported for auditability but are not
counted as semantic contractions.

## Current metrics

The previous column is the last reviewed foundation report at
`8b39df510a083e5cbe2a56a72e6595aae7b48146`. A dash means that revision did
not measure the value; it is not silently treated as zero.

| Metric | Previous | Current | Delta |
|---|---:|---:|---:|
| Total host semantic operations | 2 | 2 | 0 |
| Confirmed independent host primitives | 2 confirmed; 0 unknown | 2 confirmed; 0 unknown | — |
| Derived host semantic services | 0 | 0 | 0 |
| Host/linked duplicated semantics | 0 | 0 | 0 |
| Object-specific host semantics | 0 | 0 | 0 |
| Undocumented runtime semantic paths | 0 | 0 | 0 |
| Self-hosting closure | 6/6 | 6/6 | — |
| Foundation compression ratio | 2/8 | 2/8 | — |
| Independent external semantic laws | — | 2 | — |
| External semantic source descriptions | 1 | 0 | -1 |

The residual semantic basis is `contract-s-link` and `contract-k-link`.
Disabling either contraction while keeping the other makes the complete probe
fail, so both are classified `INDEPENDENT` relative to this representation and
probe. This is falsifiable experimental necessity, not global mathematical
irreducibility. The report also executes Barker's iota encoding. Its one
surface equation reconstructs identity, K, and S and preserves identity,
discard, and duplication witnesses, but the run observes both residual S/K
contractions. This records an `EQUIVALENT_REENCODING`: changing the surface
vocabulary does not remove external semantic information. Disabling both
contractions is the explicit zero-transition candidate. It fails the complete
probe, recording the actual runtime error.

Schema v3 keeps those quantities separate: iota has `surfaceLawCount: 1` and
`residualExternalSemanticLawCount: 2`. The S/K control has 2 and 2, while the
failing zero-transition candidate has 0 and 0. A smaller first number is not
reported as a smaller foundation unless the second number also decreases in a
successful probe.

The versioned schema publishes the complete classification vocabulary:
`INDEPENDENT`, `DERIVABLE`, `EQUIVALENT_REENCODING`, and `UNKNOWN`. Parsing and
resource control are `UNKNOWN` because they are retained non-semantic boundary
layers, not candidates in the two-operation semantic basis.

The schema also publishes provenance using four non-overlapping labels:
`link-native`, `derived-inside-system`,
`compiled-from-external-semantic-description`, and `externally-primitive`.
These classify the source of independent semantic information, separately
from the removal experiment classifications above.

## Authoritative source and external laws

The checked-in
[`fixed-point-source.lino`](../../../lib/meta-theory/fixed-point-source.lino)
is the authoritative 1,446-node, 25-root semantic program. It is an addressed
doublet network aligned with the upstream `network-duplet-function` model and
is classified `link-native`. A generation-only bracket-abstraction step lowers
it to the runtime graph. The former host-side `buildSourceKernel` semantic
description is absent and recorded as an eliminated
`compiled-from-external-semantic-description` source.

The upstream addressed network supplies structure, not a transition rule. The
runtime therefore names both residual laws without hiding their provenance:

| Law | Provenance |
|---|---|
| `S x y z -> x z (y z)` | `externally-primitive` |
| `K x y -> x` | `externally-primitive` |

Matching, substitution, traversal, import/rebinding, inference, and result
verification are each `derived-inside-system`. The executable one-symbol iota
witness still exercises `contract-s-link` and `contract-k-link`, so the report
sets `semanticInformationReduced` to `false` instead of presenting a shorter
name as a deeper foundation.

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

The generated 35,674-node
[`fixed-point.ski`](../../../lib/meta-theory/fixed-point.ski) artifact contains
closed roots for matching, substitution, ordered rule
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

The output schema is `rml-bootstrap-metrics/v3`. The bootstrap workflow prints
the full JSON report, while the JavaScript and Rust tests independently assert
the counts, removal outcomes, closure, compression, runtime coverage, and
generated-artifact parity. Run the focused equivalence experiment with
`node experiments/iota-bootstrap.mjs` from the repository root.
