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

Repository policy compiles Rust only on hosted CI, so the Rust commands are for
CI or a deliberate local exception; see
[`../docs/BUILD_CACHE.md`](../docs/BUILD_CACHE.md).

The `.mjs` files are Node walkthroughs of the public JavaScript API; they are
not part of `expected.lino`:

```bash
node examples/meta-theory-network.mjs
node examples/meta-theory-workflow.mjs
node examples/researcher-workflow.mjs
node examples/cst-roundtrip-demo.mjs
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
| [`meta-theory-network.mjs`](./meta-theory-network.mjs) | Audited K0 trust graph, K1 self-interpretation, replaceable set foundations, checked cross-theory chains, graph/relation operations, and a bounded cyclic sequence |
| [`meta-theory-workflow.mjs`](./meta-theory-workflow.mjs) | Researcher recipe over the pinned upstream meta-theory corpus, an unseen user-defined logic, and the type, graph, and relational-algebra specifications (Rust mirror: `rust/examples/meta_theory_workflow.rs`) |
| [`researcher-workflow.mjs`](./researcher-workflow.mjs) | Public-API research lifecycle |
| [`cst-roundtrip-demo.mjs`](./cst-roundtrip-demo.mjs) | CST round trip for Rust, JavaScript, Lean, and Rocq snippets |
| [`self-reasoning.lino`](./self-reasoning.lino) | Meta-logic reasoning about its own logic system |
| [`dependent-types.lino`](./dependent-types.lino) | Dependent type system with universes, Π-types, λ |
| [`nat-links.lino`](./nat-links.lino) | Links-defined natural-number foundation (Peano rules on the proof substrate) |
| [`lean-export-basic.lino`](./lean-export-basic.lino) | Typed subset accepted by `rml export lean` (output: [`lean-export-basic.lean`](./lean-export-basic.lean)) |
| [`rocq-export.lino`](./rocq-export.lino) | Typed subset accepted by `rml export rocq` |
| [`isabelle-typed-fragment.lino`](./isabelle-typed-fragment.lino) | Simply typed fragment accepted by `rml export isabelle` (output: [`isabelle-typed-fragment.thy`](./isabelle-typed-fragment.thy)) |
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
(cd js && npm test)
node scripts/cargo.mjs test --all-targets --manifest-path rust/Cargo.toml   # hosted CI only
```

Both must pass before the change can be merged.
