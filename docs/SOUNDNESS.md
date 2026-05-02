# Soundness Statement

This document states the soundness claim for the current trusted kernel and
proof-replay surface. It is intentionally an implementation contract, not a
claim that RML has a fully mechanised metatheory.

RML is a configurable, paradox-tolerant meta-logic. Its connectives and truth
range are not fixed in the style of Lean, Rocq, or Isabelle. A soundness claim
therefore always has this shape:

```text
For a fixed program P and the effective runtime configuration C selected by P,
accepted derivations justify the corresponding queries according to the RML
kernel rules and the aggregator family installed in C.
```

The configuration `C` includes the current truth range, valence, truth
constants, operator table, probability assignments, type facts, lambda facts,
and aggregator selections after processing source forms in textual order.

## Trusted Guarantee

For a `.lino` program parsed successfully by both implementations:

1. The evaluator processes top-level forms in source order and updates one
   environment.
2. A query result is computed from the current environment using the reduction
   rules documented in [KERNEL.md](./KERNEL.md), the configurable semantics
   documented in [CONFIGURABILITY.md](./CONFIGURABILITY.md), and the evaluator
   rules implemented in JavaScript and Rust.
3. When proof production is enabled, each proof is a LiNo link of the form
   `(by <rule> <subderivation>...)` whose printed form round-trips through the
   same parser.
4. The independent proof-replay checker validates that every proof tree matches
   the corresponding query shape, rule name, arity, operands, and source-level
   facts it needs.

The checker is the C2 proof-replay surface:

- JavaScript library: [`js/src/check.mjs`](../js/src/check.mjs)
- JavaScript CLI: [`js/src/rml-check.mjs`](../js/src/rml-check.mjs)
- Rust library: [`rust/src/check.rs`](../rust/src/check.rs)
- Rust CLI: [`rust/src/bin/rml-check.rs`](../rust/src/bin/rml-check.rs)

If `rml-check` accepts a proof file for a program, the trusted statement is
that each accepted derivation replays against the query at the same index under
the kernel-facing structural rules. Replay does not call `evaluate()`.

## Trusted Base

The trusted base is deliberately small, but it is not empty. It includes:

- LiNo parsing into top-level forms and AST nodes.
- Canonical printing with `keyOf` / `key_of` and reparsing of proof links.
- The proof-replay checker modules listed above.
- The built-in rule classifier used by the checker.
- The evaluator's implementations of arithmetic, equality, type facts,
  lambda reduction, truth-range clamping, valence quantization, and aggregators.
- The source program's own declarations and assignments, treated as axioms of
  the current run.

The source program is part of the basis for the claim. For example,
`((a = b) has probability 0.7)` is not proven from outside mathematics; it is
an assumption installed into the environment and later replayed as an assigned
equality or assigned probability fact.

## Kernel Rules And Operators

The proof language currently trusts these rule families:

| Family | Rule names |
|--------|------------|
| Leaves | `literal`, `symbol` |
| Source forms | `definition`, `assigned-probability`, `configuration` |
| Arithmetic | `sum`, `difference`, `product`, `quotient` |
| Logical operators | `not`, `and`, `or`, `both`, `neither` |
| Equality | `assigned-equality`, `structural-equality`, `numeric-equality` |
| Inequality | `assigned-inequality`, `structural-inequality`, `numeric-inequality` |
| Type kernel | `type-universe`, `prop`, `pi-formation`, `lambda-formation`, `beta-reduction`, `type-query`, `type-check` |
| Fallback | `reduce` for expressions outside a more specific proof rule |

The operator names in the trusted base are the built-ins plus operators
introduced by source definitions. For built-in prefix and infix operators, the
checker validates that subderivations line up with the expression being
checked. For user-introduced operators, the checker validates structural use of
the operator name; the meaning of that operator is whatever the source program
installed before the query.

## Aggregator-Relative Soundness

RML does not claim one global meaning for conjunction, disjunction, or Belnap
operators. The trusted claim is relative to the chosen aggregator family.

The built-in aggregator selectors are:

| Selector | Meaning |
|----------|---------|
| `avg` | Arithmetic mean of arguments |
| `min` | Minimum argument |
| `max` | Maximum argument |
| `product` / `prod` | Product of arguments |
| `probabilistic_sum` / `ps` | `1 - product(1 - xi)` |

The default family after environment initialization is:

| Operator | Default aggregator |
|----------|--------------------|
| `and` | `avg` |
| `or` | `max` |
| `both` | `avg` |
| `neither` | `product` |

A program may replace these defaults with forms such as `(and: min)` or
`(or: probabilistic_sum)`. From that point forward, soundness is relative to
the new selection until a later source form changes it again. Unknown
aggregator selectors are rejected with diagnostic `E004`; they do not enter
the trusted family.

This means:

- A classical Boolean file usually chooses `(valence: 2)`, `(and: min)`, and
  `(or: max)`. Its accepted derivations are sound relative to those choices.
- A probabilistic file may choose `(and: product)` and
  `(or: probabilistic_sum)`. Its accepted derivations are sound relative to
  independent-event product and probabilistic-sum aggregation.
- A paradox-tolerant Belnap-style file may rely on `both` and `neither`.
  Its accepted derivations are sound relative to the configured contradiction
  and gap aggregators.

Changing aggregators changes the logic being hosted. It does not invalidate
RML's checker; it changes the semantic family under which the checker result
is read.

## What Is Not Claimed

The current implementation does not claim:

- A mechanised proof of soundness in an external prover.
- Soundness for all possible object logics independently of the selected
  aggregators.
- Consistency in the classical sense. RML is explicitly designed to tolerate
  self-reference and paradox by using many-valued truth ranges.
- That source-level probability assignments are independently true.
- That proof replay recomputes numeric query results. Replay validates the
  derivation structure and rule compatibility; numeric evaluator functions and
  aggregator implementations remain trusted code.
- Full bidirectional type checking. The implemented typed-kernel surface is
  documented in [KERNEL.md](./KERNEL.md), and stricter type checking belongs to
  later work.

## Practical Check

A produced proof stream can be checked independently:

```sh
node js/src/rml-check.mjs program.lino proofs.lino
cargo run --manifest-path rust/Cargo.toml --bin rml-check -- program.lino proofs.lino
```

On success, both CLIs print:

```text
OK: N derivations replayed.
```

That message is the operational form of the current soundness guarantee:
the supplied derivations replay under the trusted kernel rules for the chosen
runtime configuration and aggregator family.
