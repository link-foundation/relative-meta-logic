# Architecture

This document describes the internal architecture of **Relative Meta-Logic (RML, formerly Associative-Dependent Logic / ADL)**, a minimal probabilistic logic framework built on [LiNo (Links Notation)](https://github.com/link-foundation/links-notation).

## Project Structure

```
.
├── ARCHITECTURE.md          # This file
├── README.md                # Project overview, syntax, and examples
├── LICENSE                  # Unlicense (public domain)
├── examples/                # Shared .lino knowledge bases (run by both langs)
│   ├── README.md
│   ├── expected.lino        # Canonical outputs both implementations must match (Links Notation)
│   ├── classical-logic.lino
│   ├── propositional-logic.lino
│   ├── fuzzy-logic.lino
│   ├── ternary-kleene.lino
│   ├── belnap-four-valued.lino
│   ├── liar-paradox.lino
│   ├── liar-paradox-balanced.lino
│   ├── bayesian-inference.lino
│   ├── bayesian-network.lino
│   ├── markov-chain.lino
│   ├── markov-network.lino
│   ├── self-reasoning.lino
│   ├── dependent-types.lino
│   ├── demo.lino
│   └── flipped-axioms.lino
├── js/                      # JavaScript implementation
│   ├── package.json
│   ├── src/
│   │   └── rml-links.mjs    # Core implementation
│   └── tests/
│       ├── rml-links.test.mjs
│       └── shared-examples.test.mjs   # Runs every /examples/*.lino file
└── rust/                    # Rust implementation
    ├── Cargo.toml
    ├── Cargo.lock
    ├── src/
    │   ├── lib.rs           # Core implementation
    │   └── main.rs          # CLI entry point
    └── tests/
        ├── rml_tests.rs
        └── shared_examples.rs         # Runs every /examples/*.lino file
```

Both implementations are equivalent: they pass the same 122 tests and produce identical results for all inputs.

## Processing Pipeline

The evaluation pipeline has four stages:

```
LiNo text → Parse → AST → Evaluate → Results
```

### Stage 1: LiNo Parsing

**Input:** Raw text in LiNo (Links Notation) format.

**Output:** A list of link strings, where each link is a top-level parenthesized expression.

- **JavaScript:** Uses the official [`links-notation`](https://www.npmjs.com/package/links-notation) parser.
- **Rust:** Uses the official [`links-notation`](https://crates.io/crates/links-notation) crate.

Lines starting with `#` are treated as comments and skipped.

### Stage 2: Tokenization and AST Construction

Each link string goes through two sub-steps:

1. **Tokenize** (`tokenize_one` / `tokenizeOne`): Splits a link string into tokens (parentheses and words). Also strips inline comments (everything after `#`) and balances parentheses after stripping.

2. **Parse** (`parse_one` / `parseOne`): Converts the token list into an AST (Abstract Syntax Tree). The AST is a recursive structure:
   - **Leaf nodes:** Strings (symbols, numbers, operators).
   - **List nodes:** Ordered sequences of child nodes, corresponding to parenthesized groups.

There is no operator precedence; all grouping is explicit via parentheses. For example, `(0.1 + 0.2)` is parsed as a 3-element list `["0.1", "+", "0.2"]`, and `((0.1 + 0.2) = 0.3)` is parsed as `[["0.1", "+", "0.2"], "=", "0.3"]`.

### Stage 3: Evaluation

Each AST node is evaluated recursively by `eval_node` / `evalNode`. The evaluation depends on the node structure:

| Pattern | Meaning | Example |
|---------|---------|---------|
| `"0.5"` (numeric leaf) | Numeric literal, clamped to logic range | `0.5` |
| `"x"` (symbol leaf) | Symbol prior probability (default: midpoint) | `x` |
| `(head: rhs...)` | Definition form | `(a: a is a)` |
| `((expr) has probability p)` | Probability assignment | `((a = a) has probability 1)` |
| `(range: lo hi)` | Range configuration | `(range: -1 1)` |
| `(valence: N)` | Valence configuration | `(valence: 3)` |
| `(? expr)` | Query — returns evaluated truth value | `(? (a = a))` |
| `(A + B)`, `(A - B)`, `(A * B)`, `(A / B)` | Arithmetic (decimal-precision) | `(0.1 + 0.2)` |
| `(A and B)`, `(A or B)` | Logical conjunction/disjunction | `(a and b)` |
| `(A = B)`, `(A != B)` | Equality/inequality | `(a = b)` |
| `(not X)` | Prefix negation | `(not 0.5)` |
| `(op X Y ...)` | Prefix operator application | `(and X Y Z)` |
| `(Pi (A x) B)` | Dependent product formation | `(Pi (Natural n) Natural)` |
| `(lambda (A x) body)` | Lambda formation | `(lambda (Natural x) x)` |
| `(apply f x)` | Lambda application by beta-reduction | `(apply identity zero)` |
| `(subst term x replacement)` | Capture-avoiding substitution | `(subst (x + 0.1) x 0.2)` |
| `(fresh x in body)` | Temporarily introduce a fresh scoped variable | `(fresh x in (x of Natural))` |
| `(whnf expr)` | Weak-head normal form (spine reduction only) | `(whnf (apply identity zero))` |
| `(nf expr)`, `(normal-form expr)` | Full beta-normal form | `(normal-form (apply (compose succ succ) zero))` |
| `(expr of Type)` | Type membership check | `(zero of Natural)` |
| `(type of expr)` | Type query | `(type of zero)` |

The typed-kernel rules are specified in [docs/KERNEL.md](./docs/KERNEL.md).

### Stage 4: Output

Only query expressions `(? ...)` produce output. Their evaluated truth
values are collected and returned as an array of numbers; `(type of ...)`
queries return type strings in the typed runner APIs, and direct `(subst ...)`
queries return the substituted link string.

## Public Library API

Both implementations expose the reusable parser, AST, evaluator, quantization, decimal rounding, binding, substitution, tactic engine, and runner helpers as library APIs. The JavaScript module exports camelCase names, while the Rust crate exposes snake_case equivalents where applicable.

The tactic engine keeps proof steps as links:

| JavaScript | Rust | Purpose |
|------------|------|---------|
| `runTactics(state, tactics)` | `run_tactics(state, tactics)` | Apply link tactics to a proof state and return the updated state plus diagnostics. |
| Goal state | `ProofState` / `ProofGoal` | Open goals, local context, and successful tactic links. |

Built-in tactics are `reflexivity`, `symmetry`, `transitivity`, `induction`,
`suppose`, `introduce`, `by`, `rewrite`, and `exact`. A failed tactic emits
`E039` and includes the current goal in the diagnostic message.

For consumers that start from a selected natural-language interpretation rather than a complete `.lino` file, the library also exposes a meta-expression adapter:

| JavaScript | Rust | Purpose |
|------------|------|---------|
| `formalizeSelectedInterpretation(request)` | `formalize_selected_interpretation(request)` | Convert a selected interpretation plus explicit dependencies into either an executable RML formalization or a partial result with unknowns. |
| `evaluateFormalization(formalization)` | `evaluate_formalization(&formalization)` | Deterministically evaluate executable formalizations and preserve partial results for unsupported or underspecified claims. |

The adapter currently supports explicit arithmetic equality and arithmetic value questions, plus direct LiNo/RML expressions. Real-world claims such as `moon orbits the Sun` remain non-computable until a caller provides selected entities, relations, evidence sources, and a formal shape.

### Structured Diagnostics

The `evaluate()` entry point in both implementations returns a structured
result instead of throwing or panicking:

| JavaScript | Rust |
|------------|------|
| `evaluate(code, options?)` → `{ results, diagnostics }` | `evaluate(text, file, options)` → `EvaluateResult { results, diagnostics }` |

Each `Diagnostic` carries a stable error code (`E001`, `E002`, …), a
human-readable message, and a 1-based source span (`{ file, line, col, length }`).
Errors do not abort evaluation: independent forms continue to be processed
after a failing one, so a single bad line does not silence valid queries
elsewhere in the input.

The Rust implementation bridges internal `panic!`s into diagnostics via
`std::panic::catch_unwind`, with the default panic hook silenced for the
duration of the call so stack traces never leak to stderr.

The CLIs format diagnostics as `<file>:<line>:<col>: <CODE>: <message>`
with the source line and a caret beneath the offending column, and exit
non-zero whenever any diagnostic is emitted.

See [docs/DIAGNOSTICS.md](./docs/DIAGNOSTICS.md) for the complete code
table and instructions for adding new codes.

## Environment (`Env`)

The environment holds all mutable state during evaluation:

- **`terms`**: Set of declared term names (e.g., `a` from `(a: a is a)`).
- **`assign`**: Map from expression keys to assigned truth values.
- **`symbol_prob`**: Map from symbol names to prior probabilities.
- **`lo`, `hi`**: Truth value range bounds. Default: `[0, 1]`.
- **`valence`**: Number of discrete truth levels. Default: `0` (continuous).
- **`ops`**: Map from operator names to operator implementations.
- **`types`**: Map from expression keys to type-expression keys.
- **`lambdas`**: Map from lambda names to their parameter, parameter type, and body.

### Truth Constants

The environment pre-initializes four symbol probabilities based on the current range:

| Constant | Value | Description |
|----------|-------|-------------|
| `true` | `hi` (max of range) | Represents the maximum truth value |
| `false` | `lo` (min of range) | Represents the minimum truth value |
| `unknown` | `(hi + lo) / 2` (midpoint) | Represents epistemic uncertainty |
| `undefined` | `(hi + lo) / 2` (midpoint) | Represents lack of definition |

These constants are:
- **Automatically initialized** when the `Env` is created
- **Re-initialized** when the range changes (via `(range: ...)` or `_reinitOps`/`reinit_ops`)
- **Redefinable** by the user via `(true: <value>)`, `(false: <value>)`, etc. (using the existing symbol prior mechanism)

In `[0, 1]` range: `true=1`, `false=0`, `unknown=0.5`, `undefined=0.5`.
In `[-1, 1]` range: `true=1`, `false=-1`, `unknown=0`, `undefined=0`.

### Clamping and Quantization

All logical results are **clamped** to the range `[lo, hi]` and optionally **quantized** to the nearest discrete level (if `valence >= 2`).

**Quantization algorithm:**
```
step = (hi - lo) / (valence - 1)
level = round((x - lo) / step)
result = lo + clamp(level, 0, valence-1) * step
```

This maps continuous values to the nearest of N evenly-spaced levels in the range.

## Decimal-Precision Arithmetic

### The Problem

IEEE-754 floating-point arithmetic produces unexpected results for some decimal operations:
```
0.1 + 0.2 = 0.30000000000000004  (not 0.3)
0.3 - 0.1 = 0.19999999999999998  (not 0.2)
```

### The Solution

All arithmetic operations (`+`, `-`, `*`, `/`) use a **decimal-precision rounding** function that rounds results to 12 significant decimal places. This eliminates floating-point artefacts while preserving meaningful precision:

```
decRound(x) = round(x * 10^12) / 10^12
```

**JavaScript implementation:**
```javascript
const DECIMAL_PRECISION = 12;
function decRound(x) {
  if (!Number.isFinite(x)) return x;
  return +(Math.round(x + 'e' + DECIMAL_PRECISION) + 'e-' + DECIMAL_PRECISION);
}
```

**Rust implementation:**
```rust
const DECIMAL_PRECISION: i32 = 12;
pub fn dec_round(x: f64) -> f64 {
    if !x.is_finite() { return x; }
    let factor = 10f64.powi(DECIMAL_PRECISION);
    (x * factor).round() / factor
}
```

### Arithmetic Context

Arithmetic operators evaluate their operands in an **arithmetic context** where numeric literals are **not** clamped to the logic range. This allows expressions like `(2 + 3)` to correctly compute `5`, even though the logic range is `[0, 1]`. Clamping only occurs when the result is used in a logical context (queries, `and`, `or`, etc.).

### Numeric Equality

The `=` operator uses a three-tier comparison:

1. **Explicit assignment:** If a probability has been explicitly assigned to the expression (e.g., `((a = b) has probability 0.5)`), use that value.
2. **Structural equality:** If the left and right AST subtrees are structurally identical, return `hi` (true).
3. **Numeric comparison:** Evaluate both sides and compare with decimal-precision rounding: `decRound(left) == decRound(right)`.

This ensures that `((0.1 + 0.2) = 0.3)` evaluates to `1` (true).

## Operators

### Default Operators

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `not` | Unary | `hi - (x - lo)` | Negation: mirrors around midpoint |
| `and` | N-ary | `avg` | Conjunction (aggregator-based) |
| `or` | N-ary | `max` | Disjunction (aggregator-based) |
| `=` | Binary | Structural/numeric | Equality |
| `!=` | Binary | `not(=(...))` | Inequality |
| `+` | Binary | `decRound(a + b)` | Addition (decimal-precision) |
| `-` | Binary | `decRound(a - b)` | Subtraction (decimal-precision) |
| `*` | Binary | `decRound(a * b)` | Multiplication (decimal-precision) |
| `/` | Binary | `decRound(a / b)` | Division (decimal-precision, 0 on div-by-zero) |

### Aggregators

The `and` and `or` operators can be configured to use different aggregation functions:

| Name | Formula | Use Case |
|------|---------|----------|
| `avg` | `sum(xs) / len(xs)` | Default for `and`; average truth value |
| `min` | `min(xs)` | Kleene AND; pessimistic conjunction |
| `max` | `max(xs)` | Default for `or`; Kleene OR |
| `product` | `∏ xs` | Probabilistic AND (independent events). Short name: `prod` |
| `probabilistic_sum` | `1 - ∏(1 - xi)` | Probabilistic sum/OR (independent events). Short name: `ps` |

Operators are redefinable at runtime via LiNo syntax:
```lino
(and: min)       # Switch AND to use minimum
(!=: not =)      # Define != as composition of not and =
```

## Key Design Decisions

1. **No operator precedence:** All grouping is explicit via parentheses. This keeps the parser minimal and unambiguous.

2. **Decimal rounding over arbitrary precision:** Using 12-digit decimal rounding instead of arbitrary-precision decimal libraries. This is sufficient for logic/probability use cases and keeps both implementations dependency-free (Rust has zero external dependencies; JavaScript uses only the LiNo parser).

3. **Arithmetic is unclamped:** Arithmetic results are not restricted to the logic range `[lo, hi]`. Clamping only happens when results enter the logical domain (queries, logical operators). This allows natural arithmetic while preserving logic semantics.

4. **Equivalent dual implementations:** JavaScript and Rust implementations are kept in sync with identical test suites (122 tests each), ensuring behavioral equivalence.

5. **Redefinable operators:** All operators can be redefined at runtime, enabling exploration of different logical semantics within the same framework.

## Testing

Both implementations share 122 identical tests organized in these categories:

- **Tokenization** (4 tests): Simple/nested links, inline comments, paren balancing
- **Parsing** (3 tests): Simple/nested/deeply nested AST construction
- **Environment** (6 tests): Default ops, custom ops, expression probabilities, range/valence config
- **Evaluation** (10 tests): Literals, definitions, redefinitions, operators, queries
- **Quantization** (11 tests): Binary, ternary, 5-level, balanced ranges
- **Logic types** (35+ tests): Unary through continuous, both ranges
- **Liar paradox** (6 tests): Resolution across logic types and ranges
- **Decimal arithmetic** (15 tests): Precision, all four operators, equality comparison, nested expressions, edge cases
- **Truth constants** (29 tests): Default values in both ranges, redefinition, range change re-initialization, use in expressions, quantization with valence, Env API, liar paradox with truth constants

Run tests:
```bash
cd js && npm test       # JavaScript
cd rust && cargo test   # Rust
```
