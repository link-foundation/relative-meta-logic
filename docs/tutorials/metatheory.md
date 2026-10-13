# Metatheory Tutorial

Metatheory asks whether an encoded system has the structural properties its
rules claim to have. In RML, the current metatheorem checker focuses on
Twelf-style relation checks: modes, coverage, totality, and termination.

Start by reading the typed example from the previous tutorial, especially the
HOAS-oriented source in
[`../../examples/lambda-calculus.lino`](../../examples/lambda-calculus.lino).
Then read the reference document:
[`../../docs/METATHEOREMS.md`](../../docs/METATHEOREMS.md).

Run the canonical metatheorem example:

```bash
cd js
node src/rml-meta.mjs ../experiments/metatheorem-plus.lino
cd ..
```

## 1. Relations Are Link Clauses

The reference example encodes addition on natural numbers:

```lino
(inductive Natural
  (constructor zero)
  (constructor (succ (Pi (Natural n) Natural))))
(mode plus +input +input -output)
(relation plus
  (plus zero n n)
  (plus (succ m) n (succ (plus m n))))
```

The `relation` clauses are data. They describe how `plus` behaves over the
constructors of `Natural`.

## 2. Modes Explain Direction

The mode declaration says which arguments are inputs and which are outputs:

```lino
(mode plus +input +input -output)
```

For `plus`, the first two slots are inputs and the third slot is the output.
The checker uses this information when deciding whether a recursive call is
structurally smaller and whether all input constructors are covered.

## 3. Coverage Checks Constructor Cases

Coverage asks whether every input constructor has a matching relation clause.
For `Natural`, a complete recursive relation usually needs:

- a `zero` case;
- a `succ` case.

If a relation omits the `succ` case, the checker reports a stable diagnostic
such as `E037`. The full error shape is documented in
[`../../docs/METATHEOREMS.md`](../../docs/METATHEOREMS.md).

## 4. Totality Checks Recursive Calls

Totality asks whether the relation can produce an output for every covered
input shape. For structurally recursive relations, this means recursive calls
must make progress on an input argument.

The `plus` relation passes because the recursive clause changes:

```lino
(plus (succ m) n (succ (plus m n)))
```

into a recursive call on `m`, which is smaller than `(succ m)`.

## 5. Termination Checks Definitions

The metatheorem checker also iterates `(define ...)` forms and runs the
termination checker. This catches recursive definitions that do not decrease
under the accepted structural measure.

This matters for larger encoded systems: a relation can have complete-looking
clauses but still be unsafe if a helper definition loops.

## 6. Use the CLI in CI

The JavaScript CLI:

```bash
cd js
node src/rml-meta.mjs ../experiments/metatheorem-plus.lino
```

The Rust CLI (compiles Rust, which repository policy reserves for hosted CI;
see [BUILD_CACHE.md](../BUILD_CACHE.md)):

```bash
cd rust
cargo run --bin rml-meta -- ../experiments/metatheorem-plus.lino
```

Both CLIs print the same report and exit with status `0` only when all checks
pass. A successful run includes:

```text
Relations:
  OK: plus
  - totality: pass
  - coverage: pass
All metatheorems hold.
```

## 7. Connect Back To Typed LiNo

Metatheory depends on the earlier typed layer:

- Inductive constructors name the input shapes.
- `Pi` appears inside constructor types.
- Relation clauses are links over those constructors.
- Mode declarations tell the checker which slots are structurally meaningful.

That is why this tutorial comes after
[`./typed.md`](./typed.md) and before
[`./self-bootstrap.md`](./self-bootstrap.md). The self-bootstrap tutorial shows
how the same style is used to describe RML's own grammar, evaluator, operators,
typed layer, and metatheorem surface.

## What To Remember

The metatheorem checker is a structural guardrail for encoded systems:

1. `mode` tells the checker how to read relation arguments.
2. Coverage checks constructor cases.
3. Totality checks relation behavior over input shapes.
4. Termination checks recursive definitions.
5. The `rml-meta` CLI turns those checks into a local and CI-friendly gate.
