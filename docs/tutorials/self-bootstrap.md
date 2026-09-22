# RML in RML Self-Bootstrap

This tutorial walks through the self-bootstrap layer in the order a new reader
should read it. The goal is to show how RML describes its own grammar,
evaluator, type layer, operators, metatheorem checker, and bootstrap test
contract as ordinary LiNo data.

Self-bootstrap does not mean the JavaScript and Rust hosts disappear. Today the
encoded files are data first: the host implementations import them, tests read
their `(rule ...)` links, and small rule-backed test drivers check that the
encoded surface agrees with the host. That gives RML a self-description before
the project replaces every host-side step with a fully self-hosted interpreter.

## Reading Order

Read the files in this order:

| Step | File | What it answers |
|------|------|-----------------|
| 1 | [`./lib/self/grammar.lino`](../../lib/self/grammar.lino) | What counts as LiNo source? |
| 2 | [`./lib/self/evaluator.lino`](../../lib/self/evaluator.lino) | How does RML evaluate links? |
| 3 | [`./lib/self/types.lino`](../../lib/self/types.lino) | How does the typed fragment synthesize and check types? |
| 4 | [`./lib/self/operators.lino`](../../lib/self/operators.lino) | How are aggregators and arithmetic recorded as relations? |
| 5 | [`./lib/self/metatheorem.lino`](../../lib/self/metatheorem.lino) | How are totality, coverage, termination, and mode checks described? |
| 6 | [`./.github/workflows/bootstrap.yml`](../../.github/workflows/bootstrap.yml) | How does CI prove the encoded evaluator still matches the host? |

The order matters because each layer gives vocabulary to the next one. The
grammar turns source into link-shaped data. The evaluator gives meaning to
links. The type layer and operators refine important evaluator cases. The
metatheorem checker describes the checks used for encoded systems. The
bootstrap workflow makes the whole chain a regression gate.

## 1. Grammar

Start with [`./lib/self/grammar.lino`](../../lib/self/grammar.lino). It declares
the grammar object and then records parsing rules as links:

```lino
(grammar lino-grammar matches links-notation version-0-13-0)
(grammar lino-grammar has start document)

(rule document
  (sequence skip-empty-lines links whitespace end-of-input)
  (produces flattened-link-list))
```

For a beginner, the important point is that grammar rules are not hidden inside
parser code. They are regular RML data. A future self-hosted parser can consume
the same `(rule ...)` links that the current tests inspect.

Two details are worth noticing:

- `source-for-evaluation` records the host preprocessing step that removes RML
  comments before parsing.
- `host-parser-presentation` records the printed AST shape used by the host
  parser so the encoded grammar can be compared against the current
  implementation.

The regression test in
[`js/tests/self-grammar.test.mjs`](../../js/tests/self-grammar.test.mjs) imports
the file, verifies the required rule names, and parses every `examples/*.lino`
file to the same AST presentation as the host parser.

## 2. Evaluator

Next read [`./lib/self/evaluator.lino`](../../lib/self/evaluator.lino). It is the
main "RML in RML" file because it records the host evaluator surface as rule
data:

```lino
(evaluator rml-evaluator matches relative-meta-logic version-0-21-0)

(rule (eval (? expression))
  (query (clamp (eval expression))))

(rule (eval (left + right))
  (decimal-round (+ (arith left) (arith right))))
```

The file is organized like the host evaluator:

- Truth-value environment: default range, truth constants, built-in operators,
  and aggregators.
- Top-level forms: definitions, probability assignments, queries, imports,
  namespaces, and domain plugin dispatch.
- Arithmetic and comparisons: decimal arithmetic, division by zero behavior,
  `<`, and `<=`.
- Logical forms: prefix, infix, and natural-language forms of `and`, `or`,
  `both`, and `neither`.
- Equality: explicit assignments first, then normalized assignments, structural
  equality, numeric equality, and finally `low`.
- Typed-kernel forms: `Type`, `Prop`, `Pi`, `lambda`, `apply`, substitution,
  freshness, normalization, and type queries.

A compact corpus for this layer is
[`./test-corpus/evaluator-operators.lino`](../../test-corpus/evaluator-operators.lino).
It sets custom operators, assigns probabilities to `p` and `q`, asks logical and
arithmetic queries, checks simple typed terms, changes the truth range, and then
tests valence quantization. The expected output is stored in
[`./test-corpus/expected.lino`](../../test-corpus/expected.lino), also in LiNo.

## 3. Types

Then read [`./lib/self/types.lino`](../../lib/self/types.lino). The type layer is
written around three judgement families:

```lino
(judgement (synth term type) reads context-synthesizes-term-as-type)
(judgement (check term type) reads context-checks-term-against-type)
(judgement (convert left right) reads left-and-right-are-definitionally-equal)
```

This mirrors the host bidirectional checker. "Synthesis" asks the checker to
infer a type from a term. "Checking" asks whether a term matches an expected
type. "Convertibility" normalizes both sides and compares the resulting shapes.

The beginner reading path is:

1. Look at `synth` rules for obvious terms such as symbols, numeric literals,
   universes, `Pi`, `lambda`, and `apply`.
2. Look at `check` rules for lambdas against `Pi` types.
3. Look at diagnostic rules `E020` through `E024`; these are the stable errors
   the host checker exposes.

The file is still data, not a standalone type checker. The value is that the
host type surface is now described in the same link format that the rest of RML
uses.

## 4. Operators

Read [`./lib/self/operators.lino`](../../lib/self/operators.lino) after the
evaluator and type layer. It records concrete operator and aggregator behavior
as relations and executable templates:

```lino
(relation probabilistic_sum
  (probabilistic_sum a b)
  (1 - ((1 - a) * (1 - b))))

(template (probabilistic_sum a b)
  (self.neither a b))
```

The file starts with private operator slots in the `self` namespace:

```lino
(not: not)
(and: avg)
(or: max)
(both: product)
(neither: probabilistic_sum)
```

That keeps the encoded operators local. Importing this file should not rewrite a
caller's unqualified `and` or `or` semantics. The `relation` entries are the
readable contract, while the `template` entries make the contract executable for
conformance tests.

The covered surface is deliberately small and central: `avg`, `min`, `max`,
`product`, `probabilistic_sum`, and decimal `+`, `-`, `*`, `/`.

## 5. Metatheorems

Now read [`./lib/self/metatheorem.lino`](../../lib/self/metatheorem.lino). This
file describes the current host metatheorem checker surface. It composes the
checks that were built earlier in the roadmap:

- Modes: which relation arguments are `+input` and which are `-output`.
- Coverage: every constructor of an input type must be handled.
- Totality: recursive relation calls must structurally decrease on an input.
- Termination: recursive `define` forms must decrease under the accepted
  structural measure.

The core shape is visible in rules such as:

```lino
(rule (check-metatheorems program)
  (let env (evaluate program))
  (let relation-names (sorted (keys (modes env))))
  (let definition-names (sorted (keys (definitions env))))
  (let relation-results (map relation-names (check-relation env)))
  (let definition-results (map definition-names (check-definition env)))
  (report relation-results definition-results))
```

The encoded checker also records diagnostic codes `E030`, `E031`, `E032`,
`E035`, and `E037`, plus formatting rules for CLI-style reports. Future world
declarations can extend this same pattern; the current encoded surface follows
the host checks that are available now.

## 6. Bootstrap Test

Finally read [`./.github/workflows/bootstrap.yml`](../../.github/workflows/bootstrap.yml).
The workflow runs the local bootstrap command on pull requests and main-branch
pushes that touch self-bootstrap code, JavaScript runtime code, the shared
corpus, or the README:

```bash
cd js
npm run test:bootstrap
```

That command runs the `replays self corpus` tests in
[`js/tests/self-evaluator.test.mjs`](../../js/tests/self-evaluator.test.mjs). For
each root `test-corpus/*.lino` file, the test evaluates the source twice:

1. With the host JavaScript evaluator.
2. With a small encoded evaluator driver backed by rules from
   `lib/self/evaluator.lino`.

The test fails if the result count, result kind, or numeric value differs. This
is the bootstrap contract: encoded RML must keep producing the same answers as
host RML on the shared corpus.

The broader `npm test` suite also checks the grammar, type layer, operators, and
metatheorem files. The dedicated bootstrap workflow is narrower on purpose: it
is the CI gate for evaluator divergence and for the measured K0/K1 boundary.
It executes the host-operation fault-injection test and prints the versioned
bootstrap metrics report.

The report now exposes the residual S/K semantic basis directly. The
authoritative program is the addressed-link network in
`lib/meta-theory/fixed-point-source.lino`; generation lowers it to the runtime
DAG shared by both runtimes. Matching, substitution, traversal,
import/rebinding, inference saturation, and result verification are derived
inside that network. S/K remain two explicitly external transition laws, and
the zero-transition experiment fails the complete probe. The report therefore
records zero external host-language semantic descriptions, 2/8 foundation
compression, 6/6 self-hosting closure, and no duplicated host/linked
semantics. Parsing and resource bounds remain visible as non-semantic boundary
layers.

Inspect the machine-readable evidence locally:

```bash
cd js
npm run report:bootstrap-metrics
```

See the [measured bootstrap boundary](../case-studies/issue-183/bootstrap-metrics.md)
for definitions, limitations, layer counts, and the previous/current table.

## A Concrete Trace

Use [`./test-corpus/evaluator-operators.lino`](../../test-corpus/evaluator-operators.lino)
as the first end-to-end file to study.

It starts by configuring logical operators:

```lino
(and: product)
(or: probabilistic_sum)
```

Then it declares terms, assigns probabilities, and asks queries:

```lino
(p: p is p)
(q: q is q)

((p = true) has probability 0.25)
((q = true) has probability 0.8)

(? ((p = true) and (q = true)))
(? ((p = true) or (q = true)))
```

The encoded evaluator finds those rules in `lib/self/evaluator.lino`, delegates
the configured operator behavior to the same aggregator semantics recorded in
`lib/self/operators.lino`, and compares the query output with
`test-corpus/expected.lino`.

Later in the same file, the corpus crosses into typed terms:

```lino
(Term: (Type 0) Term)
(zero: Term zero)
(identity: lambda (Term x) x)

(? (zero of Term))
(? (type of zero))
(? (apply identity 0.42))
```

Those queries exercise the typed-kernel entries in the evaluator and the
bidirectional type surface described in `lib/self/types.lino`.

## How to Verify Locally

Run the focused bootstrap gate:

```bash
cd js
npm run test:bootstrap
```

Run the self-bootstrap documentation and data-shape tests:

```bash
node --test ../scripts/docs.test.mjs \
  tests/self-grammar.test.mjs \
  tests/self-evaluator.test.mjs \
  tests/self-types.test.mjs \
  tests/self-operators.test.mjs \
  tests/self-metatheorem.test.mjs
```

Run the full JavaScript suite before changing encoded files:

```bash
npm test
```

For Rust parity on mirrored self-bootstrap tests:

```bash
cd ../rust
cargo test self_grammar
cargo test self_evaluator
cargo test self_types
cargo test self_operators
cargo test self_metatheorem
```

## Reading Checklist

After reading the six files, you should be able to explain:

- How a `.lino` file becomes a host parser presentation.
- Which evaluator rules handle definitions, assignments, queries, equality,
  arithmetic, logic, imports, and typed-kernel forms.
- Why the type layer has separate `synth`, `check`, and `convert` judgements.
- Why encoded operators live under the `self` namespace.
- Which metatheorem checks are encoded today, and which diagnostics they emit.
- How `npm run test:bootstrap` catches divergence between encoded RML and host
  RML.
- Why the measured semantic host surface is exactly S and K, why their
  necessity is scoped to the current representation/probe, and how the
  executable iota witness distinguishes one surface rule from a reduction in
  external semantic information.

That is the capstone claim of "RML in RML": the language now has a readable,
test-backed description of its own core behavior, written in the same notation
that users write.
