# relative-meta-logic

A prototype for logic framework that can reason about anything relative to given probability of input statements.

> **Note on naming:** This project was previously called *Associative-Dependent Logic (ADL)*. The name *Associative Dependent Meta Logic* is also valid, as in [dependent types](https://en.wikipedia.org/wiki/Dependent_type), but *relative* is closer to the concept of a [link](https://github.com/link-foundation/meta-theory), and actually all statements are relative to other statements. The name *meta-logic* reflects that this system can reason about all possible logic systems, including itself.

## Implementations

This project provides two equivalent implementations:

- **[JavaScript](./js/)** — Node.js implementation using the official [links-notation](https://github.com/link-foundation/links-notation) parser
- **[Rust](./rust/)** — Rust implementation using the official [links-notation](https://github.com/link-foundation/links-notation) crate

Both implementations pass the same comprehensive test suites and produce identical results.

For implementation details, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Comparisons

- [Core concept comparison](./docs/CONCEPTS-COMPARISION.md) - RML vs Twelf, LF, HELF, Isabelle, Coq/Rocq, Lean, Foundation, AFP, Abella, lambda Prolog, and Pecan by logical/metatheoretic concepts.
- [Product feature comparison](./docs/FEATURE-COMPARISION.md) - RML vs the same systems by authoring workflow, automation, libraries, tooling, and distribution.
- [Configurability and operator redefinition](./docs/CONFIGURABILITY.md) - Why every operator, truth constant, range, and valence is redefinable at runtime, with the precedence rules and a comparison to Lean/Rocq fixed semantics.
- [Typed kernel rules](./docs/KERNEL.md) - The implemented D1 rules for `Pi`, `lambda`, `apply`, `(expr of Type)`, and `(type of expr)`.

## Overview

RML (Relative Meta-Logic, formerly Associative-Dependent Logic / ADL) is a minimal probabilistic logic system built on top of [LiNo (Links Notation)](https://github.com/link-foundation/links-notation). It supports [many-valued logics](https://en.wikipedia.org/wiki/Many-valued_logic) from unary (1-valued) through continuous probabilistic ([fuzzy](https://en.wikipedia.org/wiki/Fuzzy_logic)), allowing you to:

- Define terms
- Assign probabilities (truth values) to logical expressions
- Redefine logical operators with different semantics
- Configure truth value ranges: `[0, 1]` or `[-1, 1]` (balanced/symmetric)
- Configure logic valence: 2-valued ([Boolean](https://en.wikipedia.org/wiki/Boolean_algebra)), 3-valued ([ternary/Kleene](https://en.wikipedia.org/wiki/Three-valued_logic)), N-valued, or continuous
- Use and redefine truth constants: `true`, `false`, `unknown`, `undefined`
- Use and redefine Belnap operators: `both...and` (contradiction/avg) and `neither...nor` (gap/product)
- Resolve paradoxical statements (e.g. the [liar paradox](https://en.wikipedia.org/wiki/Liar_paradox))
- Perform decimal-precision arithmetic (`+`, `-`, `*`, `/`) — `0.1 + 0.2 = 0.3`, not `0.30000000000000004`
- Query the truth value of complex expressions
- Define dependent types as links — universe hierarchy, Pi-types, lambdas, type queries
- Combine types with probabilistic logic in a unified framework
- Reuse the evaluator as a library, including a meta-expression adapter that accepts selected interpretations and explicit dependencies while keeping underspecified claims partial

## Supported Logic Types

![F0C5A9A4-B56E-4B64-8B7E-CC3A650EDAF7_1_201_a](https://github.com/user-attachments/assets/b54e3aaa-8645-4067-8051-6299745a2a3b)

| Valence | Name | Truth Values (in `[0, 1]`) | Truth Values (in `[-1, 1]`) | Reference |
|---------|------|---------------------------|----------------------------|-----------|
| 1 | Unary (trivial) | `{any}` (no quantization) | `{any}` (no quantization) | [Many-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic) |
| 2 | Binary / [Boolean](https://en.wikipedia.org/wiki/Boolean_algebra) | `{0, 1}` (false, true) | `{-1, 1}` (false, true) | [Classical logic](https://en.wikipedia.org/wiki/Classical_logic) |
| 3 | Ternary / [Three-valued](https://en.wikipedia.org/wiki/Three-valued_logic) | `{0, 0.5, 1}` (false, unknown, true) | `{-1, 0, 1}` (false, unknown, true) | [Kleene logic](https://en.wikipedia.org/wiki/Three-valued_logic#Kleene_and_Priest_logics), [Łukasiewicz logic](https://en.wikipedia.org/wiki/%C5%81ukasiewicz_logic), [Balanced ternary](https://en.wikipedia.org/wiki/Balanced_ternary) |
| 4 | Quaternary | `{0, ⅓, ⅔, 1}` | `{-1, -⅓, ⅓, 1}` | [Belnap's four-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic) |
| 5 | Quinary | `{0, 0.25, 0.5, 0.75, 1}` | `{-1, -0.5, 0, 0.5, 1}` | [Many-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic) |
| N | N-valued | N evenly-spaced levels | N evenly-spaced levels | [Many-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic) |
| 0/∞ | Continuous / [Fuzzy](https://en.wikipedia.org/wiki/Fuzzy_logic) | Any value in `[0, 1]` | Any value in `[-1, 1]` | [Fuzzy logic](https://en.wikipedia.org/wiki/Fuzzy_logic), [Łukasiewicz ∞-valued](https://en.wikipedia.org/wiki/%C5%81ukasiewicz_logic) |

## Quick Start

### JavaScript

```bash
cd js
npm install
node src/rml-links.mjs ../examples/demo.lino
```

### Rust

```bash
cd rust
cargo run -- ../examples/demo.lino
```

Examples are language-agnostic and live in [`/examples/`](./examples/). Both
implementations execute the same files and are required to produce identical
output (enforced by `examples/expected.lino` and the shared-examples tests).

### Example

Create a file `example.lino`:

```lino
# Classical Boolean logic
(valence: 2)
(and: min)
(or: max)

# Define propositions
(p: p is p)
(q: q is q)

# Assign truth values
((p = true) has probability 1)
((q = true) has probability 0)

# Query
(? ((p = true) and (q = true)))          # -> 0 (true AND false = false)
(? ((p = true) or (q = true)))           # -> 1 (true OR false = true)
(? ((p = true) or (not (p = true))))     # -> 1 (law of excluded middle)
```

Output:
```
0
1
1
```

## Syntax

### Term Definitions

```lino
(term_name: term_name is term_name)
```

Example: `(a: a is a)` declares `a` as a term.

### Probability Assignments

```lino
((<expression>) has probability <value>)
```

Example: `((a = a) has probability 1)` assigns probability 1 to the expression `a = a`.

### Range Configuration

```lino
(range: <lo> <hi>)
```

Sets the truth value range. Default is `[0, 1]` (standard probabilistic). Use `(range: -1 1)` for balanced/symmetric range where the midpoint is 0.

See: [Balanced ternary](https://en.wikipedia.org/wiki/Balanced_ternary)

### Valence Configuration

```lino
(valence: <N>)
```

Sets the number of discrete truth values. Default is `0` (continuous, no quantization).

- `(valence: 2)` — [Boolean logic](https://en.wikipedia.org/wiki/Boolean_algebra): truth values are quantized to `{0, 1}`
- `(valence: 3)` — [Ternary logic](https://en.wikipedia.org/wiki/Three-valued_logic): truth values are quantized to `{0, 0.5, 1}`
- `(valence: N)` — [N-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic): truth values are quantized to N evenly-spaced levels

### Truth Constants

The symbols `true`, `false`, `unknown`, and `undefined` are predefined with values based on the current range:

| Constant | Default in `[0, 1]` | Default in `[-1, 1]` | Definition | Interpretation |
|----------|---------------------|----------------------|------------|----------------|
| `true`   | `1`                 | `1`                  | `max(range)` | Definitely true |
| `false`  | `0`                 | `-1`                 | `min(range)` | Definitely false |
| `unknown` | `0.5`              | `0`                  | `mid(range)` | Truth value not known |
| `undefined` | `0.5`            | `0`                  | `mid(range)` | Not yet defined |

These constants can be used directly in expressions:

```lino
(? true)              # -> 1 in [0,1], 1 in [-1,1]
(? false)             # -> 0 in [0,1], -1 in [-1,1]
(? unknown)           # -> 0.5 in [0,1], 0 in [-1,1]
(? (not true))        # -> 0 in [0,1], -1 in [-1,1]
(? (true and false))  # -> 0.5 (avg), 0 (avg in [-1,1])
```

All truth constants can be **redefined** to custom values:

```lino
(true: 0.8)           # Redefine true to 0.8
(false: 0.2)          # Redefine false to 0.2
(? true)              # -> 0.8
(? false)             # -> 0.2
```

### Belnap Operators: `both` and `neither`

The operators `both` and `neither` come from [Belnap's four-valued logic](https://en.wikipedia.org/wiki/Four-valued_logic#Belnap), where contradictions and gaps are first-class concepts. These are **composite natural language operators** that alter the AND operation:

| Operator | Default Aggregator | Example | Result | Interpretation |
|----------|-------------------|---------|--------|----------------|
| `both...and` | `avg` | `(both true and false)` | `0.5` | Both true and false (contradiction) |
| `neither...nor` | `product` | `(neither true nor false)` | `0` | Neither true nor false (gap) |

```lino
# Contradiction: both true and false
(? (both true and false))     # -> 0.5 (avg of 1 and 0)
(? (both true and true))      # -> 1   (both agree: true)

# Gap: neither true nor false
(? (neither true nor false))  # -> 0   (product of 1 and 0)
(? (neither true nor true))   # -> 1   (both agree: true)
```

Both operators are **redefinable** via aggregator selection, just like `and` and `or`:

```lino
(both: min)                   # Redefine both to use min
(? (both true and false))     # -> 0
(neither: max)                # Redefine neither to use max
(? (neither true nor false))  # -> 1
```

This allows paradoxes like the [liar paradox](https://en.wikipedia.org/wiki/Liar_paradox) to be expressed naturally:

```lino
(a: a is a)
((a = a) has probability 1)
((a != a) has probability 0)
(? (both (a = a) and (a != a)))     # -> 0.5 (contradiction resolves to midpoint)
(? (neither (a = a) nor (a != a)))  # -> 0   (gap: no info propagates)
```

When the range changes (via `(range: ...)`), all truth constants are automatically re-initialized to their defaults for the new range.

### Operator Redefinitions

#### Binary operator composition

```lino
(operator: unary_op binary_op)
```

Example: `(!=: not =)` defines `!=` as the negation of `=`.

#### Aggregator selection

For `and` and `or` operators, you can choose different aggregators:

```lino
(and: avg)               # Average (default)
(and: min)               # Minimum (Kleene/Łukasiewicz AND)
(and: max)               # Maximum
(and: product)           # Product (also: prod)
(and: probabilistic_sum) # Probabilistic sum: 1 - (1-p1)*(1-p2)*... (also: ps)

(or: max)                # Maximum (default, Kleene/Łukasiewicz OR)
(or: avg)                # Average
(or: min)                # Minimum
(or: product)            # Product (also: prod)
(or: probabilistic_sum)  # Probabilistic sum (also: ps)
```

### Arithmetic

```lino
(<A> + <B>)   # Addition
(<A> - <B>)   # Subtraction
(<A> * <B>)   # Multiplication
(<A> / <B>)   # Division
```

All arithmetic uses **decimal-precision rounding** (12 significant decimal places) to eliminate IEEE-754 floating-point artefacts:

```lino
(? (0.1 + 0.2))             # -> 0.3  (not 0.30000000000000004)
(? ((0.1 + 0.2) = 0.3))     # -> 1    (true)
(? ((0.3 - 0.1) = 0.2))     # -> 1    (true)
```

Arithmetic operands are not clamped to the logic range, allowing natural numeric computation. Clamping occurs only when results are used in a logical context (queries, `and`, `or`, etc.).

### Queries

```lino
(? <expression>)
```

Queries are evaluated and their truth value is printed to stdout.

### Comments

```lino
# Line comments start with #
(a: a is a)  # Inline comments are also supported
```

### Dependent Type System

Types are just links — "everything is a link". The type system coexists with probabilistic logic. ADL is a **dynamic axiomatic system**: every link is a recursive fractal, definitions can be changed at any time, and the system embraces self-reference and paradoxes rather than forbidding them.

#### Self-Referential Type: `(Type: Type Type)`

The primary way to define the root type in ADL is self-referential — Type is its own type:

```lino
(Type: Type Type)
```

This follows the pattern `(SubType: Type SubType)` applied to Type itself. Unlike classical type theory (Lean, Rocq) which forbids `Type : Type` to avoid Russell's paradox, ADL's many-valued logic **resolves paradoxes** to the midpoint of the truth value range (0.5 in `[0,1]`, 0 in `[-1,1]`). This makes self-referential types safe and useful.

```lino
(Type: Type Type)
(Natural: Type Natural)
(Boolean: Type Boolean)
(zero: Natural zero)
(true-val: Boolean true-val)
(? (Type of Type))               # -> 1
(? (Natural of Type))            # -> 1
(? (zero of Natural))            # -> 1
(? (type of Natural))            # -> Type
```

#### Universe Hierarchy (Lean/Rocq Compatibility)

For compatibility with Lean 4 and Rocq (Coq), ADL also supports a stratified **universe hierarchy** where each `(Type N)` is a member of `(Type N+1)`:

- `(Type 0)` — the universe of "small" types (Natural, Boolean, etc.)
- `(Type 1)` — the universe that contains `(Type 0)` and types formed from `(Type 0)` types
- `(Type 2)` — contains `(Type 1)`, and so on

This mirrors Lean 4 (`Type 0`, `Type 1`, ...) and Rocq (`Set`, `Type`, ...).

Both systems can coexist — use `(Type: Type Type)` for the self-referential approach, and `(Type N)` when you need stratified universes:

```lino
(Type: Type Type)
(Type 0)
(Type 1)
(Natural: (Type 0) Natural)      # Natural in universe 0
(Boolean: Type Boolean)           # Boolean under self-referential Type
(? (Natural of (Type 0)))        # -> 1
(? (Boolean of Type))            # -> 1
(? ((Type 0) of (Type 1)))       # -> 1
```

#### Type Declarations

```lino
# Type definition follows the pattern: (SubType: Type SubType)
(Type: Type Type)
(Natural: Type Natural)
(Boolean: Type Boolean)

# Typed term via prefix type notation: (name: TypeName name)
(zero: Natural zero)
(true-val: Boolean true-val)
```

#### Pi-types (Dependent Products)

```lino
# (Pi (TypeName varName) ReturnType)
(succ: (Pi (Natural n) Natural))
```

#### Lambda Abstraction

```lino
# (lambda (TypeName varName) body)
(identity: lambda (Natural x) x)

# Multi-parameter: (lambda (TypeName x, TypeName y) body)
(add: lambda (Natural x, Natural y) (x + y))
```

#### Application

```lino
# Explicit: (apply function argument)
(? (apply identity 0.7))         # -> 0.7

# Prefix: (functionName argument)
(? (identity 0.7))               # -> 0.7
```

#### Type Queries

```lino
# Type check: (expr of Type) — returns 1 (true) or 0 (false)
(? (zero of Natural))            # -> 1
(? (Natural of Type))            # -> 1

# Type inference: (type of expr) — returns the type name
(? (type of zero))               # -> Natural
```

#### Paradox Resolution in the Type System

In classical type theory, `Type : Type` leads to [Russell's paradox](https://en.wikipedia.org/wiki/Russell%27s_paradox). ADL handles this differently — paradoxes are resolved to the midpoint truth value (0.5), not rejected:

```lino
(Type: Type Type)
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))                  # -> 0.5 (paradox resolves to midpoint)
(? (not (s = false)))            # -> 0.5 (fixed point of negation)
(? (Type of Type))               # -> 1   (self-referential type works)
```

This means ADL can serve as a **meta-theory** for both classical and non-classical type systems, since it can express and reason about constructs that would be inconsistent in traditional frameworks.

## Built-in Operators

- `=`: Equality (checks assigned probability, then structural equality, then numeric comparison with decimal precision)
- `!=`: Inequality (defined as `not =` by default)
- `not`: Logical negation — mirrors around the midpoint of the range (`1 - x` in `[0,1]`; `-x` in `[-1,1]`)
- `and`: Conjunction (average by default, configurable)
- `or`: Disjunction (maximum by default, configurable)
- `+`: Addition (decimal-precision)
- `-`: Subtraction (decimal-precision)
- `*`: Multiplication (decimal-precision)
- `/`: Division (decimal-precision, returns 0 on division by zero)

## Examples

Example `.lino` files are available in the shared root [`examples/`](./examples/) directory. They are executed by both the JavaScript and the Rust implementations, and the canonical outputs every implementation must reproduce live in [`examples/expected.lino`](./examples/expected.lino) — itself written in Links Notation, so the contract between the two implementations is expressed in the same language as the examples. Examples progress from standard, familiar logic systems to more advanced and non-standard constructions.

### Classical Logic (Boolean, 2-valued)

See `examples/classical-logic.lino` — the most familiar logic system where every proposition is either true or false:

```lino
(valence: 2)
(and: min)
(or: max)

(p: p is p)
((p = true) has probability 1)

(? (p = true))                          # -> 1 (true)
(? (not (p = true)))                    # -> 0 (false)
(? ((p = true) or (not (p = true))))    # -> 1 (law of excluded middle)
(? ((p = true) and (not (p = true))))   # -> 0 (law of non-contradiction)
```

### Propositional Logic (Probabilistic)

See `examples/propositional-logic.lino` — multiple propositions with standard probabilistic connectives:

```lino
(and: product)              # P(A ∩ B) = P(A) * P(B)
(or: probabilistic_sum)     # P(A ∪ B) = 1 - (1-P(A))*(1-P(B))

((rain = true) has probability 0.3)
((umbrella = true) has probability 0.6)

(? ((rain = true) and (umbrella = true)))   # -> 0.18
(? ((rain = true) or (umbrella = true)))    # -> 0.72
(? (not (rain = true)))                     # -> 0.7
```

### Fuzzy Logic (Continuous)

See `examples/fuzzy-logic.lino` — standard [Zadeh fuzzy logic](https://en.wikipedia.org/wiki/Fuzzy_logic) where truth values represent degrees of membership:

```lino
(and: min)
(or: max)

((a = tall) has probability 0.8)
((b = tall) has probability 0.3)

(? ((a = tall) and (b = tall)))   # -> 0.3  (min)
(? ((a = tall) or (b = tall)))    # -> 0.8  (max)
(? (not (a = tall)))              # -> 0.2  (complement)
```

### Ternary Kleene Logic (3-valued)

See `examples/ternary-kleene.lino` — [Kleene's strong three-valued logic](https://en.wikipedia.org/wiki/Three-valued_logic#Kleene_and_Priest_logics):

```lino
(valence: 3)
(and: min)
(or: max)

(? (0.5 and 1))          # -> 0.5  (unknown AND true = unknown)
(? (0.5 and 0))          # -> 0    (unknown AND false = false)
(? (0.5 or 1))           # -> 1    (unknown OR true = true)
(? (0.5 or (not 0.5)))   # -> 0.5  (law of excluded middle FAILS!)
```

In [Kleene logic](https://en.wikipedia.org/wiki/Three-valued_logic#Kleene_and_Priest_logics), the law of excluded middle (`A ∨ ¬A`) is **not** a tautology — this is the key difference from [classical logic](https://en.wikipedia.org/wiki/Classical_logic).

### Belnap's Four-Valued Logic

See `examples/belnap-four-valued.lino` — extends classical logic with `both...and` (contradiction) and `neither...nor` (gap) **composite natural language operators** that alter the AND operation. This is the standard framework for reasoning about paradoxes:

```lino
(and: min)
(or: max)

(? (both true and false))     # -> 0.5  (contradiction: avg of 1 and 0)
(? (neither true nor false))  # -> 0    (gap: product of 1 and 0)
(? (both true and true))      # -> 1    (agree: avg of 1 and 1)

# The liar paradox resolves naturally via "both"
(s: s is s)
((s = false) has probability 0.5)
(? (s = false))               # -> 0.5
```

See: [Belnap's four-valued logic](https://en.wikipedia.org/wiki/Four-valued_logic#Belnap)

### Liar Paradox Resolution

The [liar paradox](https://en.wikipedia.org/wiki/Liar_paradox) ("this statement is false") is irresolvable in classical 2-valued logic. In many-valued logics (ternary and above), it resolves to the **midpoint** of the range — the fixed point of negation.

See `examples/liar-paradox.lino` — resolution in `[0, 1]` range:

```lino
(s: s is s)

((s = false) has probability 0.5)
(? (s = false))          # -> 0.5  (50% from 0% to 100%)
(? (not (s = false)))    # -> 0.5  (fixed point: not(0.5) = 0.5)
```

See `examples/liar-paradox-balanced.lino` — resolution in `[-1, 1]` range:

```lino
(range: -1 1)
(s: s is s)

((s = false) has probability 0)
(? (s = false))          # -> 0   (0% from -100% to 100%)
(? (not (s = false)))    # -> 0   (fixed point: not(0) = 0)
```

### Custom Operators (avg semantics)

See `examples/demo.lino` — demonstrates the configurable nature of operators with avg-based AND:

```lino
(a: a is a)
(!=: not =)
(and: avg)     # non-standard: average instead of min
(or: max)

((a = a) has probability 1)
((a != a) has probability 0)

(? ((a = a) and (a != a)))   # -> 0.5
(? ((a = a) or  (a != a)))   # -> 1
```

See `examples/flipped-axioms.lino` — demonstrates that the system handles arbitrary probability assignments:

```lino
(a: a is a)
(!=: not =)
(and: avg)
(or: max)

((a = a) has probability 0)
((a != a) has probability 1)

(? ((a = a) and (a != a)))   # -> 0.5 (same result — avg is symmetric)
```

### Bayesian Inference

RML natively supports [Bayesian inference](https://en.wikipedia.org/wiki/Bayesian_inference) and [Bayesian networks](https://en.wikipedia.org/wiki/Bayesian_network). Links notation naturally describes networks of any complexity — each node's probability is a link, and joint/marginal probabilities are computed using the `product` and `probabilistic_sum` aggregators.

See `examples/bayesian-inference.lino` — [Bayes' theorem](https://en.wikipedia.org/wiki/Bayes%27_theorem) applied to medical diagnosis (directed: Disease → Test Result):

```lino
# P(Disease) = 0.01, P(Positive|Disease) = 0.95, P(Positive|~Disease) = 0.05
# Bayes' theorem: P(Disease|Positive) = P(Pos|D)*P(D) / P(Pos)

(? (0.95 * 0.01))                                        # -> 0.0095
(? ((0.95 * 0.01) + (0.05 * 0.99)))                     # -> 0.059
(? ((0.95 * 0.01) / ((0.95 * 0.01) + (0.05 * 0.99))))  # -> 0.161017
```

See `examples/bayesian-network.lino` — a directed acyclic [Bayesian network](https://en.wikipedia.org/wiki/Bayesian_network) (DAG) with `product` and `probabilistic_sum` aggregators:

```lino
(and: product)              # P(A ∩ B) = P(A) * P(B)
(or: probabilistic_sum)     # P(A ∪ B) = 1 - (1-P(A))*(1-P(B))

(((cloudy) = true) has probability 0.5)
(((rain) = true) has probability 0.5)

(? (((cloudy) = true) and ((rain) = true)))   # -> 0.25 (joint)
(? (((cloudy) = true) or ((rain) = true)))    # -> 0.75 (union)
```

### Markov Chains with Dependent Probabilities

RML can model [Markov chains](https://en.wikipedia.org/wiki/Markov_chain) where transition probabilities depend on the current state. Using arithmetic and the [law of total probability](https://en.wikipedia.org/wiki/Law_of_total_probability), multi-step state evolution is computed naturally.

See `examples/markov-chain.lino` — a weather model with directed transitions (today → tomorrow):

```lino
# Transition matrix: P(Sunny→Sunny)=0.8, P(Rainy→Sunny)=0.4
# Initial: P(Sunny)=0.7, P(Rainy)=0.3

# One-step: P(Sunny at t+1) = P(S→S)*P(S) + P(R→S)*P(R)
(? ((0.8 * 0.7) + (0.4 * 0.3)))   # -> 0.68
(? ((0.2 * 0.7) + (0.6 * 0.3)))   # -> 0.32

# Joint probability using product aggregator
(and: product)
(? (0.8 and 0.7))                  # -> 0.56
```

### Markov Networks (Cyclic Graphs)

As the structural opposite of acyclic Bayesian networks, RML can also model [Markov networks](https://en.wikipedia.org/wiki/Markov_random_field) (Markov random fields) — undirected graphs where cycles are allowed. In links notation, undirected edges are represented as bidirectional link pairs, preserving the fundamental directionality of links.

See `examples/markov-network.lino` — a cyclic social influence model (Alice—Bob—Carol—Alice):

```lino
(and: product)
(or: probabilistic_sum)

(((alice) = agree) has probability 0.7)
(((bob) = agree) has probability 0.5)
(((carol) = agree) has probability 0.6)

# Pairwise joints (cycle: Alice—Bob—Carol—Alice)
(? (((alice) = agree) and ((bob) = agree)))          # -> 0.35
(? (((carol) = agree) and ((alice) = agree)))        # -> 0.42

# Three-way clique
(? (and ((alice) = agree) ((bob) = agree) ((carol) = agree)))  # -> 0.21
```

### Self-Reasoning (Meta-Logic)

As a meta-logic, RML can reason about its own logic system and compare it with other logics.

See `examples/self-reasoning.lino`:

```lino
(Type: Type Type)
(Logic: Type Logic)
(RML: Logic RML)

(((RML supports_many_valued) = true) has probability 1)
(? ((RML supports_many_valued) = true))   # -> 1
(? (RML of Logic))                        # -> 1
(? (type of RML))                         # -> Logic
```

## Testing

Both implementations have matching tests:

```bash
# JavaScript
cd js && npm test

# Rust
cd rust && cargo test
```

The test suites cover:
- Tokenization, parsing, and quantization
- Evaluation logic and operator aggregators
- Many-valued logics: unary, binary (Boolean), ternary (Kleene), quaternary, quinary, higher N-valued, and continuous (fuzzy)
- Both `[0, 1]` and `[-1, 1]` ranges
- Truth constants (`true`, `false`, `unknown`, `undefined`): defaults, redefinition, range changes, use in expressions, quantization
- Belnap operators (`both...and`, `neither...nor`): default aggregators, redefinition, composite/prefix/infix forms, fuzzy values, range changes
- Liar paradox resolution across logic types
- Decimal-precision arithmetic (`+`, `-`, `*`, `/`) and numeric equality
- Dependent type system: universes, Pi-types, lambdas, application, type queries, prefix type notation
- Self-referential types: `(Type: Type Type)`, paradox resolution alongside types, coexistence with universe hierarchy
- Bayesian inference: Bayes' theorem, law of total probability, conditional probability, complement rule
- Bayesian networks: joint probability (product), probabilistic sum (probabilistic_sum), multi-node networks, chain rule decomposition
- Self-reasoning: meta-logic properties, comparing logic systems, paradox resolution in meta context
- Markov chains: one-step and multi-step transitions, joint probability, stationary distribution, conditional transitions with links
- Markov networks: cyclic graphs, pairwise joints, three-way cliques, clique potentials, normalization
- Comprehensive valence coverage: 0 (continuous), 1 (unary), 2–10, 100, 1000, with both ranges
- English-readability lint: identifier shape, operator-only links, allow-list (see [English-readability lint](#english-readability-lint))

## API

See language-specific documentation:
- [JavaScript API](./js/README.md#api)
- [Rust API](./rust/README.md#api)

## Diagnostics

Both implementations expose an `evaluate()` entry point that returns a list
of results plus structured diagnostics — every parser, evaluator, and type
checker error carries a stable code (`E001`, …), a message, and a 1-based
source span. The CLIs print them as `file:line:col: Exxx: message` with a
caret under the offending token. See [docs/DIAGNOSTICS.md](./docs/DIAGNOSTICS.md)
for the full code list and usage examples.

## English-readability lint

Every link in `examples/` (and, when introduced, `lib/`) is expected to read
as an English sentence. A small lint script enforces the conventions:

```bash
node scripts/lint-english.mjs --allowlist scripts/lint-english.allowlist.json examples/*.lino
# or, from the JS package:
(cd js && npm run lint:english)
```

The lint reports two classes of violation in `file:line:col: code: message`
form (the same shape used by structured diagnostics):

- `identifiers-without-hyphens` — identifiers that combine multiple words
  with `_` or `camelCase` instead of `kebab-case`. The lint suggests the
  hyphenated form (e.g. `wet_grass` → `wet-grass`).
- `operator-only-link` — an operator definition such as `(@: + -)` whose
  body contains no English word. The lint suggests adding a word-form
  alternative (e.g. `(equals: =)`, `(plus: +)`).

Reserved RML/LiNo vocabulary (`and`, `or`, `not`, `is`, `has`, `probability`,
`true`, `false`, `unknown`, `Type`, `lambda`, …) is never flagged, and
single-word identifiers (`alice`, `cloudy`, `Natural`) are accepted as-is.

### Allow-list

For deliberate exceptions, `scripts/lint-english.allowlist.json` accepts
two arrays:

```json
{
  "identifiers": ["legacy_name"],
  "links": ["demo.lino:5"]
}
```

Identifiers in `identifiers` are silenced wherever they appear; entries in
`links` are keyed by `<basename>:<line>` and silence the
`operator-only-link` rule for that specific definition. CI runs the lint
with this file so any new violation fails the build.

## References

- [Many-valued logic](https://en.wikipedia.org/wiki/Many-valued_logic) — overview of logics with more than two truth values
- [Boolean algebra](https://en.wikipedia.org/wiki/Boolean_algebra) — classical 2-valued logic
- [Three-valued logic](https://en.wikipedia.org/wiki/Three-valued_logic) — ternary logics (Kleene, Łukasiewicz, Bochvar)
- [Łukasiewicz logic](https://en.wikipedia.org/wiki/%C5%81ukasiewicz_logic) — N-valued and infinite-valued extensions
- [Fuzzy logic](https://en.wikipedia.org/wiki/Fuzzy_logic) — continuous-valued logic with degrees of truth
- [Balanced ternary](https://en.wikipedia.org/wiki/Balanced_ternary) — ternary system using {-1, 0, 1}
- [Four-valued logic (Belnap)](https://en.wikipedia.org/wiki/Four-valued_logic#Belnap) — extends classical logic with "both" (contradiction) and "neither" (gap)
- [Liar paradox](https://en.wikipedia.org/wiki/Liar_paradox) — "this statement is false" and its resolution in many-valued logics
- [Bayesian statistics](https://en.wikipedia.org/wiki/Bayesian_statistics) — probability as a measure of belief
- [Bayesian inference](https://en.wikipedia.org/wiki/Bayesian_inference) — updating beliefs based on evidence
- [Bayesian network](https://en.wikipedia.org/wiki/Bayesian_network) — probabilistic graphical models
- [Bayes' theorem](https://en.wikipedia.org/wiki/Bayes%27_theorem) — relating conditional and marginal probabilities
- [Markov chain](https://en.wikipedia.org/wiki/Markov_chain) — stochastic model with state-dependent transitions
- [Law of total probability](https://en.wikipedia.org/wiki/Law_of_total_probability) — computing marginal probabilities from conditionals

## License

See [LICENSE](LICENSE) file.
