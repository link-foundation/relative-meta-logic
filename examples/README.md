# Shared Examples

Every `.lino` file in this folder is a self-contained Relative Meta-Logic (RML)
knowledge base. They are language-agnostic: the **same file** is executed by
both the JavaScript and the Rust implementations and is required to produce
identical output.

The canonical expected output for each file lives in
[`expected.lino`](./expected.lino), itself written in Links Notation so the
contract between implementations is expressed in the same language as the
examples. Both implementations have automated tests that walk this folder
and assert their results against that file, so any implementation drift
fails CI in both languages.

## Running an example

```bash
# JavaScript
node js/src/rml-links.mjs examples/classical-logic.lino

# Rust (debug)
cargo run --manifest-path rust/Cargo.toml -- examples/classical-logic.lino

# Rust (release)
cargo build --release --manifest-path rust/Cargo.toml
./rust/target/release/rml examples/classical-logic.lino
```

The meta-theory graph also has a JavaScript API walkthrough:

```bash
node examples/meta-theory-graph.mjs
```

## Index

| File | Topic |
|------|-------|
| [`classical-logic.lino`](./classical-logic.lino) | Standard Boolean (2-valued) logic |
| [`automatic-sequences.lino`](./automatic-sequences.lino) | Pecan-style automatic-sequence theorem decision |
| [`propositional-logic.lino`](./propositional-logic.lino) | Probabilistic propositional logic with independent events |
| [`fuzzy-logic.lino`](./fuzzy-logic.lino) | Continuous-valued (Zadeh) fuzzy logic |
| [`ternary-kleene.lino`](./ternary-kleene.lino) | Three-valued Kleene logic |
| [`belnap-four-valued.lino`](./belnap-four-valued.lino) | Belnap four-valued logic with `both`/`neither` |
| [`liar-paradox.lino`](./liar-paradox.lino) | Liar paradox in `[0, 1]` (resolves to 0.5) |
| [`liar-paradox-balanced.lino`](./liar-paradox-balanced.lino) | Liar paradox in `[-1, 1]` (resolves to 0) |
| [`bayesian-inference.lino`](./bayesian-inference.lino) | Bayes' theorem on a medical-test scenario |
| [`bayesian-network.lino`](./bayesian-network.lino) | Directed acyclic Bayesian network |
| [`markov-chain.lino`](./markov-chain.lino) | Weather-state Markov chain |
| [`markov-network.lino`](./markov-network.lino) | Cyclic Markov network with three-way cliques |
| [`meta-theory-graph.mjs`](./meta-theory-graph.mjs) | Cross-theory paths, shared concept addresses, and a bounded cyclic sequence |
| [`self-reasoning.lino`](./self-reasoning.lino) | Meta-logic reasoning about its own logic system |
| [`dependent-types.lino`](./dependent-types.lino) | Dependent type system with universes, Π-types, λ |
| [`lambda-calculus.lino`](./lambda-calculus.lino) | Lambda calculus via HOAS, with `forall` desugaring to `Pi` |
| [`typed-kernel-links.lino`](./typed-kernel-links.lino) | Links-checked dependent-kernel typing derivation |
| [`proof-checking-relation.lino`](./proof-checking-relation.lino) | Links-level proof-checking relation checked by proof replay |
| [`mtc-anum-theory.lino`](./mtc-anum-theory.lino) | MTC/anum theory fragment kept separate from serialization |
| [`foundation-boolean-kleene.lino`](./foundation-boolean-kleene.lino) | Foundation-scoped Boolean/Kleene truth-table semantics |
| [`foundation-with-min.lino`](./foundation-with-min.lino) | Foundation-scoped aggregator override |
| [`demo.lino`](./demo.lino) | Custom operator configuration (`avg`-based AND) |
| [`flipped-axioms.lino`](./flipped-axioms.lino) | Arbitrary probability assignments |

## Updating expected outputs

If you intentionally change an example or fix a real difference between the two
implementations, regenerate the canonical fixtures:

```bash
node examples/generate-expected.mjs
```

Then rerun both test suites:

```bash
(cd js   && npm test)
(cd rust && cargo test)
```

Both must pass before the change can be merged.
