# RML Tutorial Path

This directory is the beginner path for Relative Meta-Logic. Read the
tutorials in order: each one adds one idea that the next tutorial relies on.

The tutorials use runnable source files from [`../../examples/`](../../examples/)
and reusable libraries from [`../../lib/`](../../lib/). Commands are written for
the repository root unless a section says otherwise.

| Step | Tutorial | What it introduces | Runnable source |
|------|----------|--------------------|-----------------|
| 1 | [Classical logic tutorial](./classical.md) | Boolean truth, assignments, queries, and classical laws | [`../../examples/classical-logic.lino`](../../examples/classical-logic.lino) |
| 2 | [Fuzzy logic tutorial](./fuzzy.md) | Continuous truth values and degree-based predicates | [`../../examples/fuzzy-logic.lino`](../../examples/fuzzy-logic.lino) |
| 3 | [Probabilistic reasoning tutorial](./probabilistic.md) | Product, probabilistic sum, networks, and Bayes-style calculations | [`../../examples/bayesian-network.lino`](../../examples/bayesian-network.lino) |
| 4 | [Typed LiNo tutorial](./typed.md) | Type facts, universes, dependent products, lambdas, and applications | [`../../examples/dependent-types.lino`](../../examples/dependent-types.lino) |
| 5 | [Metatheory tutorial](./metatheory.md) | Modes, coverage, totality, termination, and the metatheorem checker | [`../../docs/METATHEOREMS.md`](../../docs/METATHEOREMS.md) |
| 6 | [RML in RML self-bootstrap tutorial](./self-bootstrap.md) | The encoded grammar, evaluator, type layer, operators, and bootstrap gate | [`../../lib/self/evaluator.lino`](../../lib/self/evaluator.lino) |

## Quick Setup

Install the JavaScript dependencies once:

```bash
cd js
npm install
cd ..
```

Then run any tutorial example from the repository root:

```bash
node js/src/rml-links.mjs examples/classical-logic.lino
```

For parity with the Rust implementation, the same file runs through the Rust
CLI. Repository policy compiles Rust only on hosted CI, so outside CI this is a
deliberate local exception (see [`../BUILD_CACHE.md`](../BUILD_CACHE.md)):

```bash
cargo run --manifest-path rust/Cargo.toml -- examples/classical-logic.lino
```

## What To Read Afterward

After the tutorial path, the main reference documents are:

- [`../../README.md`](../../README.md) for the language overview and examples.
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the JavaScript/Rust
  parity design.
- [`../../docs/KERNEL.md`](../../docs/KERNEL.md) for the typed-kernel rules.
- [`../../docs/METATHEOREMS.md`](../../docs/METATHEOREMS.md) for metatheorem
  checking details.
- [`../../docs/CONCEPTS-COMPARISON.md`](../../docs/CONCEPTS-COMPARISON.md)
  and [`../../docs/FEATURE-COMPARISON.md`](../../docs/FEATURE-COMPARISON.md)
  for positioning against nearby systems.
