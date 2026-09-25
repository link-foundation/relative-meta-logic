# Case Study: Defining Dependent Types in Links Notation

**Issue:** [#13 — Is it possible to have enough apparatus to define types and dependent types like Lean/Rocq have, but to define the very core of their systems using our system?](https://github.com/link-foundation/associative-dependent-logic/issues/13)

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Background: What Lean and Rocq Do](#background-what-lean-and-rocq-do)
3. [Background: What ADL Currently Does](#background-what-adl-currently-does)
4. [The Gap: What's Missing](#the-gap-whats-missing)
5. [Key Insight: Links as a Meta-Theory](#key-insight-links-as-a-meta-theory)
6. [Implementation Options](#implementation-options)
7. [Existing Tools and Libraries](#existing-tools-and-libraries)
8. [Recommended Approach](#recommended-approach)
9. [References](#references)

---

## Executive Summary

The question is whether the ADL (Associative-Dependent Logic) system, built on Links Notation (LiNo), can serve as a **meta-theory** capable of defining the very core of dependent type systems like Lean 4 and Rocq (formerly Coq). The answer is **yes, in principle**, but it requires extending ADL with several new capabilities. This document analyzes the gap, proposes concrete implementation options with LiNo syntax, and identifies existing libraries that can help.

The key insight from [Links Theory](https://github.com/link-foundation/meta-theory) is that a **link** is a universal unit of meaning — it can represent types, terms, proofs, and propositions uniformly. This is analogous to how the Calculus of Constructions (CoC) unifies terms and types into a single syntactic category. The "associative" in ADL and the "dependent" in dependent types can be bridged through this shared principle of **self-reference and unification**.

---

## Background: What Lean and Rocq Do

### The Calculus of Constructions (CoC)

Both [Lean 4](https://lean-lang.org/theorem_proving_in_lean4/dependent_type_theory.html) and [Rocq](https://rocq-prover.org/doc/V9.1.0/refman/language/core/index.html) are built on variants of the **Calculus of Inductive Constructions (CIC)**, which extends the [Calculus of Constructions](https://en.wikipedia.org/wiki/Calculus_of_constructions). At their core, they need only a handful of expression forms:

| Expression | Notation | Meaning |
|-----------|----------|---------|
| **Variable** | `x` | A reference to a bound name |
| **Sort/Universe** | `Type₀`, `Type₁`, `Prop` | The type of types at a given level |
| **Dependent Product (Π-type)** | `∀ (x : A), B` | Function type where `B` may depend on `x` |
| **Lambda Abstraction** | `λ (x : A), e` | A function taking `x` of type `A` and returning `e` |
| **Application** | `f a` | Applying function `f` to argument `a` |

That's it — just **5 expression forms**. Everything else (inductive types, pattern matching, records, tactics) is built on top of this minimal core through elaboration.

Source: [Andrej Bauer — How to implement dependent type theory](https://math.andrej.com/2012/11/08/how-to-implement-dependent-type-theory-i/) shows a complete implementation in ~92 lines.

### The Kernel

The kernel is the trusted core that checks well-typedness. Both Lean and Rocq follow the **de Bruijn criterion**: the kernel is kept small so it can be independently audited. The kernel only needs to implement:

1. **Type checking**: Given a term and a type, verify the term has that type
2. **Type inference**: Given a term, compute its type
3. **Definitional equality**: Check if two terms are equal after normalization (β-reduction, δ-unfolding)
4. **Substitution**: Replace a variable with a term, avoiding capture

### The Curry-Howard Correspondence

The [Curry-Howard correspondence](https://en.wikipedia.org/wiki/Curry%E2%80%93Howard_correspondence) is the key insight that makes proof assistants work:

| Logic | Type Theory |
|-------|-------------|
| Proposition | Type |
| Proof | Term (program) |
| Implication A → B | Function type A → B |
| ∀x. P(x) | Dependent product Π(x:A). B(x) |
| ∃x. P(x) | Dependent sum Σ(x:A). B(x) |
| True | Unit type |
| False | Empty type |

In classical ADL, we assign **probabilities** to propositions. In dependent type theory, a proposition is **proven or not** (it's a type that is either inhabited or empty). The bridge between these two worlds is explored in the section on [Probabilistic Type Theory](#option-c-probabilistic-dependent-type-theory).

### Universe Hierarchy

Types themselves have types, forming a hierarchy:

```
term : Type₀ : Type₁ : Type₂ : ...
```

This prevents Russell's paradox (the type-theoretic analog of "the set of all sets that don't contain themselves"). Lean uses a **non-cumulative** hierarchy; Rocq uses a **cumulative** one where `Type₀ ⊆ Type₁`.

---

## Background: What ADL Currently Does

ADL is a **probabilistic logic framework** built on [Links Notation (LiNo)](https://github.com/link-foundation/links-notation). Its current capabilities:

| Feature | ADL Has It? | Notes |
|---------|-------------|-------|
| Term definitions | Yes | `(a: a is a)` |
| Probability assignments | Yes | `((a = a) has probability 1)` |
| Many-valued logic | Yes | Unary through continuous (fuzzy) |
| Configurable range | Yes | `[0, 1]` or `[-1, 1]` |
| Configurable valence | Yes | 2-valued, 3-valued, N-valued, continuous |
| Redefinable operators | Yes | `(and: min)`, `(!=: not =)` |
| Decimal-precision arithmetic | Yes | `0.1 + 0.2 = 0.3` |
| Paradox resolution | Yes | Liar paradox → midpoint |
| **Type annotations** | **Yes** (v0.7.0) | `(x: Natural x)` — prefix type notation stored as links |
| **Dependent products** | **Yes** (v0.7.0) | `(Pi (Natural x) B)` — Π-types as links |
| **Lambda abstraction** | **Yes** (v0.7.0) | `(lambda (Natural x) e)` — lambdas as links |
| **Application** | **Yes** (v0.7.0) | `(apply f x)` with β-reduction |
| **Universe hierarchy** | **Yes** (v0.7.0) | `(Type 0)`, `(Type 1)`, ... |
| **Substitution** | **Yes** (v0.7.0) | Full β-reduction with variable shadowing |
| **Normalization** | **Partial** | Single-step β-reduction (no full normalization) |
| **Type checking** | **Partial** | `(expr of Type)` queries and `(type of expr)` inference |

### LiNo Syntax Recap

LiNo is parenthesized notation where everything is a **link** (an ordered tuple of references):

```lino
(a: a is a)                    # Definition: a 3-element link
((a = a) has probability 1)    # A nested link structure
(? (a = a))                    # Query
(and: avg)                     # Operator configuration
```

The key property of LiNo is that **there is no fixed grammar** — the semantics are determined by the evaluator, not the parser. This makes it ideal for defining new language constructs.

---

## The Gap: What's Missing

To define the core of Lean/Rocq within ADL, we need to add these capabilities:

### 1. Type Annotations

Currently, `(a: a is a)` defines a term. We need a way to **annotate terms with types**:

```lino
(a: Natural a)          # a has type Natural (prefix type notation)
(f: (Type 0) f)         # f is a type
```

### 2. Dependent Products (Π-types)

The ability to express types that depend on values:

```lino
(forall (Natural n) (Vec n Natural))   # For all n:Natural, the type Vec n Natural
```

### 3. Lambda Abstraction

The ability to create functions:

```lino
(lambda (Natural x) (x + 1))      # A function that adds 1
```

### 4. Application and β-Reduction

Applying a function to an argument and reducing:

```lino
((lambda (Natural x) (x + 1)) 3)  # Should reduce to 4
```

### 5. Universe Hierarchy

A hierarchy of types:

```lino
(Type 0)    # The type of "small" types (Natural, Boolean, etc.)
(Type 1)    # The type of Type 0
```

### 6. Inductive Types (Optional, for full CIC)

For the full Calculus of Inductive Constructions:

```lino
(inductive Natural
  (zero: Natural zero)
  (succ: (forall (Natural n) Natural)))
```

---

## Key Insight: Links as a Meta-Theory

The [Links Theory](https://github.com/link-foundation/meta-theory) (Deep Theory) establishes that:

1. A **link** is the universal unit of meaning — it can represent anything
2. **Doublets** (2-tuples) and **triplets** (3-tuples) can represent any data structure
3. The associative model is **self-referential**: links can reference other links, including themselves
4. Unlike set theory (which distinguishes sets from elements) or type theory (which distinguishes types from terms), Links Theory uses a **single concept**: the link

This maps naturally to dependent type theory, where **terms and types are the same syntactic category**. In the CoC:

- A type is just a term: `Natural` is a term of type `Type₀`
- A function type is just a term: `Natural → Boolean` is a term of type `Type₀`
- A proof is just a term: a proof of `P` is a term of type `P`

In Links Theory:

- A link is just a link: whether it represents a type, a term, or a proof
- The distinction comes from **context** (which other links reference it), not from any intrinsic property

This parallel suggests that LiNo is a natural notation for expressing dependent type theory.

### The Associative Network as a Type Context

In dependent type theory, a **context** Γ is a sequence of (name, type) pairs:

```
Γ = x₁ : A₁, x₂ : A₂, ..., xₙ : Aₙ
```

In the associative model, this is simply a network of links:

```
link₁ = (x₁, A₁)    # x₁ has type A₁
link₂ = (x₂, A₂)    # x₂ has type A₂
...
```

The **typing judgment** `Γ ⊢ e : T` ("in context Γ, expression e has type T") becomes:

```
(in context Γ, e has type T)
```

Which in LiNo could be:

```lino
((e has type T) in (A₁ x₁) (A₂ x₂))
```

---

## Implementation Options

### Option A: Pure LiNo Encoding (Shallow Embedding)

**Approach:** Define type-theoretic constructs as LiNo expressions interpreted by the existing ADL evaluator, extended with new evaluation rules.

**Syntax:**

```lino
# Universes
(Type 0)
(Type 1)

# Type annotations (prefix type notation)
(x: Natural x)
(f: (Pi (Natural x) Natural) f)

# Dependent product (Π-type / forall)
(Pi (Natural x) (Vec x Boolean))

# Non-dependent function type (sugar for Pi where x doesn't appear in body)
(Natural -> Boolean)

# Lambda abstraction
(lambda (Natural x) (x + 1))

# Application
(apply (lambda (Natural x) (x + 1)) 3)

# Let binding
(let (Natural x) 5 (x + 1))

# Inductive type definition
(inductive Natural
  (zero: Natural zero)
  (succ: (Pi (Natural n) Natural)))

# Pattern matching
(match n
  (zero => 0)
  ((succ m) => (+ 1 (f m))))

# Type inference query
(? (type of (lambda (Natural x) (x + 1))))   # -> (Pi (Natural x) Natural)

# Proof term
(theorem plus_comm
  (Pi (Natural a) (Pi (Natural b) (= (a + b) (b + a))))
  proof_term)
```

**Probability integration:**

```lino
# A proposition with probability
((P x) has probability 0.8)

# Type inference with probability
(? (type of ((P x) has probability 0.8)))   # -> Prop with confidence 0.8

# Dependent type with probabilistic witness
(Sigma (Natural x) ((P x) has probability (> 0.5)))
```

**Pros:**
- Uses existing LiNo parser unchanged
- Familiar parenthesized syntax
- Natural extension of current ADL
- All constructs are links (consistent with Links Theory)

**Cons:**
- Requires significant new evaluation rules in the ADL engine
- β-reduction and normalization are complex to implement
- Mixing probabilities and types needs careful design

**Implementation effort:** Medium-high. Requires adding type checking, substitution, normalization, and universe checking to the ADL evaluator (~500-1000 lines per implementation).

---

### Option B: Compiled Core (Deep Embedding)

**Approach:** Define a separate type-theoretic core language that compiles to/from LiNo. The ADL evaluator handles probabilistic logic; a separate type checker handles dependent types.

**Architecture:**

```
LiNo text → LiNo Parser → AST
                              ├─→ ADL Evaluator (probabilities, logic)
                              └─→ Type Checker (dependent types, proofs)
```

**Syntax (same LiNo surface syntax, different evaluation):**

```lino
# Mode switch
(mode: types)

# Now all expressions are type-checked
(def Natural: (Type 0)
  (inductive
    (zero: Natural zero)
    (succ: (Pi (Natural _) Natural))))

(def plus: (Pi (Natural a) (Pi (Natural b) Natural))
  (lambda (Natural a) (lambda (Natural b)
    (match a
      (zero => b)
      ((succ n) => (succ (plus n b)))))))

# Switch back to probabilistic mode
(mode: logic)

# Now we can assign probabilities to type-theoretic propositions
((plus (succ zero) (succ zero) = succ (succ zero)) has probability 1)
```

**Pros:**
- Clean separation of concerns
- Can leverage existing type checker implementations
- Easier to verify correctness of each component independently
- Follows the de Bruijn criterion naturally

**Cons:**
- Two separate evaluation engines
- Interop between probabilistic and type-theoretic modes needs design
- More complex overall architecture

**Implementation effort:** Medium. The type checker itself is well-understood (~300-500 lines using existing algorithms), but integration with ADL requires design work.

---

### Option C: Probabilistic Dependent Type Theory

**Approach:** Extend dependent type theory itself with probabilities, creating a novel system that unifies ADL's probabilistic logic with dependent types.

This is inspired by the research paper ["A Type Theory for Probabilistic and Bayesian Reasoning"](https://arxiv.org/abs/1511.09230) (Adams & Jacobs, 2015) and ["A Probabilistic Dependent Type System"](https://arxiv.org/abs/1602.06420) (2016).

**Core idea:** Instead of a type being either inhabited or empty (as in classical dependent type theory), a type can be **partially inhabited** with a probability:

```lino
# Classical: P is either true or false
(P: Prop)

# Probabilistic: P has a degree of truth
(P: Prop 0.8)     # P is true with probability 0.8

# Dependent product with probabilistic types
(Pi (Natural x) (Prop (prob x)))   # A family of propositions with varying probability
```

**Syntax in LiNo:**

```lino
# Probabilistic Prop
(PProp: (Type 0))

# A probabilistic proposition
(raining: (PProp 0.7))       # "It is raining" with probability 0.7

# Conditional probability as dependent type
(umbrella_given_rain:
  (Pi (PProp p) r) (PProp (cond_prob umbrella r))))

# Bayesian update as a type-theoretic operation
(bayes:
  (Pi (PProp p) prior)
  (Pi (Pi (A _) (PProp l)) likelihood)
  (Pi (PProp e) evidence)
  (PProp (bayesian_update p l e)))))

# ADL's existing probability operations become type-theoretic
(and: (Pi (PProp p) a) (Pi (PProp q) b) (PProp (agg_and p q)))))
(or:  (Pi (PProp p) a) (Pi (PProp q) b) (PProp (agg_or p q)))))
(not: (Pi (PProp p) a) (PProp (negate p))))
```

**Pros:**
- Truly novel: unifies two powerful formalisms
- ADL's existing probabilistic logic becomes a special case
- Lean/Rocq's classical logic becomes a special case (when all probabilities are 0 or 1)
- Directly addresses the issue's goal of being a meta-theory for all theories

**Cons:**
- Research-level difficulty; no off-the-shelf implementation exists
- Soundness and decidability need careful analysis
- May require new theoretical results

**Implementation effort:** High. This is a research project, not just an engineering task. However, a prototype could be built incrementally.

---

### Option D: Links-Represented Type Theory (Maximally Associative)

**Approach:** Represent types and terms as links in an associative network,
without special surface syntax. This describes an experimental representation;
it does not establish that the imported type-theoretic categories are intrinsic
to links.

In this approach, the entire type system is encoded as an associative network of doublets and triplets:

```lino
# Everything is a link. A link has an ID and references other links.

# Define the concept "of" as a link
(of: of is of)

# Define universe levels as links
(Type-0: Type-0 is Type-0)
(Type-1: Type-1 is Type-1)
((Type-0 of Type-1) has probability 1)   # Type₀ : Type₁

# Define Natural as a link of type Type-0
(Natural: Natural is Natural)
((Natural of Type-0) has probability 1)       # Natural : Type₀

# Define zero as a link of type Natural
(zero: zero is zero)
((zero of Natural) has probability 1)         # zero : Natural

# Define succ as a function link
(succ: succ is succ)
((succ of (Pi Natural Natural)) has probability 1)  # succ : Natural → Natural

# Dependent product as a link pattern
(Pi: Pi is Pi)
((Pi of (Pi Type-0 (Pi Type-0 Type-0))) has probability 1)

# Application: (succ zero) is a link
((succ zero): (succ zero) is (succ zero))
((succ zero) of Natural)

# Lambda: represented as a link with binding structure
(lambda: lambda is lambda)
((lambda x Natural (x + 1)) of (Pi Natural Natural))
```

**The key principle:** Every construct (type, term, function, proof) is just a link with other links indicating its relationships (of, reduces-to, equivalent-to).

**Pros:**
- Maximally faithful to Links Theory and the associative model
- No new syntax needed — uses existing LiNo features
- The type system itself is data, not baked into the evaluator
- Self-describing: the type system can describe itself

**Cons:**
- Very verbose
- Performance concerns (type checking via associative network traversal)
- Needs an external "type checker" that operates on the link network
- May be too abstract for practical use

**Implementation effort:** Low for syntax, high for the type-checking engine that traverses the link network.

---

## Existing Tools and Libraries

### JavaScript

| Library | Description | Relevance |
|---------|-------------|-----------|
| [calculus-of-constructions](https://www.npmjs.com/package/calculus-of-constructions) | Minimal CoC in JS (~400 lines) by Victor Taelin | **High** — Could be adapted to work with LiNo AST |
| [formcore-js](https://www.npmjs.com/package/formcore-js) | Minimal proof language with self-types (~700 lines) | **High** — Kernel of Kind language, very small |
| [links-notation](https://www.npmjs.com/package/links-notation) | Official LiNo parser (already used by ADL) | **Already integrated** |

### Rust

| Library | Description | Relevance |
|---------|-------------|-----------|
| [Typechecker Zoo — CoC](https://sdiehl.github.io/typechecker-zoo/coc/calculus-of-constructions.html) | CoC type checker in Rust | **High** — Reference implementation |
| [links-notation crate](https://crates.io/crates/links-notation) | Official LiNo parser (already used by ADL) | **Already integrated** |
| [Interaction-Type-Theory](https://github.com/VictorTaelin/Interaction-Type-Theory) | CoC via interaction combinators | **Medium** — Novel approach |

### Reference Implementations (Other Languages)

| Library | Language | Description |
|---------|----------|-------------|
| [elaboration-zoo](https://github.com/AndrasKovacs/elaboration-zoo) | Haskell | Progressive dependent type elaboration examples |
| [nano-Agda](https://github.com/jyp/nano-Agda) | Haskell | Tiny type-checker (~200 lines) |
| [LaTTe Kernel](https://github.com/latte-central/latte-kernel) | Clojure | Small trusted kernel for proof assistant |
| [tt (Andrej Bauer)](https://math.andrej.com/2012/11/08/how-to-implement-dependent-type-theory-i/) | OCaml | ~92 lines, complete CoC implementation |

### Academic References

| Paper | Year | Relevance |
|-------|------|-----------|
| [A Type Theory for Probabilistic and Bayesian Reasoning](https://arxiv.org/abs/1511.09230) | 2015 | **High** — Formal foundation for Option C |
| [A Probabilistic Dependent Type System](https://arxiv.org/abs/1602.06420) | 2016 | **High** — Non-deterministic β-reduction with probabilities |
| [Propositions as Types (Wadler)](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf) | 2015 | Background on Curry-Howard |

---

## Recommended Approach

### Phase 1: Option A (Shallow Embedding) — ✅ Implemented (v0.7.0)

The ADL evaluator has been extended with all 5 core expression forms of the CoC:

1. ✅ `(Type N)` — universe sorts with automatic hierarchy `(Type 0) : (Type 1) : ...`
2. ✅ `(Type: Type Type)` — self-referential type (ADL's primary approach, enabled by paradox resolution)
3. ✅ `(Pi (Natural x) B)` — dependent products (Π-types)
4. ✅ `(lambda (Natural x) e)` — lambda abstraction with typed parameters
5. ✅ `(apply f x)` — application with full β-reduction
6. ✅ Substitution with variable shadowing support
7. ✅ Type checking via `(expr of Type)` queries and `(? (type of expr))` inference

**Implementation:** ~500 lines of new code in each implementation (JS + Rust), plus 52 new tests each (all backward-compatible with existing 124 tests).

**Key design principles:**
- **"Everything is a link"** — types are stored as associations in the link network, type-checking is querying the network, and the type system coexists with the probabilistic logic engine.
- **Dynamic axiomatic system** — every link is a recursive fractal, definitions can be changed at any time, and the system embraces self-reference rather than forbidding it.
- **Self-referential Type** — `(Type: Type Type)` is the primary way to define the root type. Unlike classical type theory which forbids `Type : Type` to avoid Russell's paradox, ADL's many-valued logic resolves paradoxes to the midpoint truth value (0.5 in `[0,1]`). Both `(Type: Type Type)` and `(Type N)` can coexist.

### Phase 2: Option C (Probabilistic Extension) — The Novel Contribution

Once the basic type system works, extend it with ADL's probabilistic semantics:

1. Add `(PProp p)` as probabilistic propositions
2. Define how `and`, `or`, `not` interact with typed propositions
3. Implement Bayesian conditioning as a type-theoretic operation
4. Show that classical dependent types are the special case where all probabilities are 0 or 1

This would be a genuine research contribution.

### Phase 3: Option D (Links-Represented) — The Meta-Theory

Finally, show that the type system itself can be described as a network of links:

1. Encode the typing rules as links
2. Show that type checking is link network traversal
3. Demonstrate that the system can describe itself (self-referential meta-theory)

This achieves the original goal: the system becomes a meta-theory that can describe any theory, including its own foundations.

---

## References

### Dependent Type Theory
- [Lean 4 — Dependent Type Theory](https://lean-lang.org/theorem_proving_in_lean4/dependent_type_theory.html)
- [Rocq/Coq — Calculus of Inductive Constructions](https://rocq-prover.org/doc/v8.9/refman/language/cic.html)
- [Rocq — Core Language (v9.1.0)](https://rocq-prover.org/doc/V9.1.0/refman/language/core/index.html)
- [How to implement dependent type theory (Andrej Bauer)](https://math.andrej.com/2012/11/08/how-to-implement-dependent-type-theory-i/)
- [Calculus of Constructions — Wikipedia](https://en.wikipedia.org/wiki/Calculus_of_constructions)
- [Curry-Howard Correspondence — Wikipedia](https://en.wikipedia.org/wiki/Curry%E2%80%93Howard_correspondence)
- [Propositions as Types (Philip Wadler)](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf)
- [Dependent Type — Wikipedia](https://en.wikipedia.org/wiki/Dependent_type)
- [Lean (proof assistant) — Wikipedia](https://en.wikipedia.org/wiki/Lean_(proof_assistant))
- [Rocq — Wikipedia](https://en.wikipedia.org/wiki/Rocq)

### Probabilistic Type Theory
- [A Type Theory for Probabilistic and Bayesian Reasoning (arXiv)](https://arxiv.org/abs/1511.09230)
- [A Probabilistic Dependent Type System (arXiv)](https://arxiv.org/abs/1602.06420)

### Links Theory and Associative Models
- [Links Theory — GitHub](https://github.com/link-foundation/meta-theory)
- [Math introduction to Deep Theory (Habr)](https://habr.com/en/companies/deepfoundation/articles/658705/)
- [Associative Links (DEV Community)](https://dev.to/deepfoundation/associative-links-4cda)
- [Associative Links Explained (HackerNoon)](https://hackernoon.com/associative-links-explained)
- [Deep.Foundation](https://deep.foundation/)

### Implementations
- [VictorTaelin/calculus-of-constructions (JS, npm)](https://github.com/VictorTaelin/calculus-of-constructions)
- [FormCoreJS (JS, npm)](https://github.com/HigherOrderCO/FormCoreJS)
- [Typechecker Zoo — CoC (Rust)](https://sdiehl.github.io/typechecker-zoo/coc/calculus-of-constructions.html)
- [elaboration-zoo (Haskell)](https://github.com/AndrasKovacs/elaboration-zoo)
- [nano-Agda (Haskell)](https://github.com/jyp/nano-Agda)
- [LaTTe Kernel (Clojure)](https://github.com/latte-central/latte-kernel)
- [Interaction-Type-Theory](https://github.com/VictorTaelin/Interaction-Type-Theory)
- [links-notation (npm)](https://www.npmjs.com/package/links-notation)
- [links-notation (crate)](https://crates.io/crates/links-notation)
