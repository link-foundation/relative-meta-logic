# Typed Kernel

This document specifies the typed-kernel surface implemented by the
JavaScript and Rust evaluators. It covers the D1 contract from issue #37,
the D3 convertibility check from issue #40, and the D5 universe hierarchy
from issue #41: the rules for `Pi`, `lambda`, `apply`, capture-avoiding
substitution, freshness, checked universe levels, type membership with `of`,
type queries with `(type of ...)`, and equality conversion.

RML remains a dynamic axiomatic system. The query-style rules below install
and read type facts in the evaluator environment; the
[Bidirectional Checker](#bidirectional-type-checker) section documents the
stricter mode-switching layer (`synth` / `check`) added in issue #42, which
emits structured `E020`..`E024` diagnostics on rejection.

## Judgements

The rules below use standard notation, mapped to LiNo:

| Judgement | Meaning in RML |
|-----------|----------------|
| `Gamma |- e : A` | Environment `Gamma` records expression `e` as having type `A`. |
| `Gamma, x : A` | The environment extended with variable `x` of type `A`. |
| `Gamma |- e => v` | Evaluating `e` produces value `v`. |
| `hi` / `lo` | The current truth range maximum/minimum. Defaults are `1` and `0`. |

In the implementation, type facts are stored by canonical LiNo keys. For
example, `(Pi (Natural n) Natural)` is stored under that exact printed link.

## Type Declarations

Types and typed terms use the same prefix declaration pattern:

```lino
(Type: Type Type)
(Natural: Type Natural)
(zero: Natural zero)
```

Rule:

```text
Gamma |- A is a type-like link
------------------------------
Gamma |- (x: A x) installs x : A
```

The declaration is intentionally syntactic. `(Type: Type Type)` is allowed
because RML tolerates circular axioms and resolves paradoxical truth values
through the configured many-valued logic.

The stratified universe form is also supported:

```lino
(Type 0)
(Type 1)
(? ((Type 0) of (Type 1)))  # -> hi
(? ((Type 1) of (Type 0)))  # -> lo
```

Universe rule:

```text
-------------------------------
Gamma |- (Type N) : (Type N+1)
```

Universe membership and type queries infer this rule directly, so callers do
not need to evaluate `(Type N)` before asking about it:

| Query | Result |
|-------|--------|
| `(? ((Type 0) of (Type 1)))` | `hi` |
| `(? ((Type 1) of (Type 2)))` | `hi` |
| `(? ((Type 2) of (Type 3)))` | `hi` |
| `(? ((Type 1) of (Type 0)))` | `lo` |
| `(? ((Type 2) of (Type 1)))` | `lo` |
| `(? ((Type 0) of (Type 2)))` | `lo` |
| `(? (type of (Type 0)))` | `(Type 1)` |
| `(? (type of (Type 2)))` | `(Type 3)` |

This checked hierarchy is separate from the self-referential root declaration.
Both modes can coexist in one environment:

```lino
(Type: Type Type)
(Natural: (Type 0) Natural)
(Boolean: Type Boolean)

(? (Type of Type))           # -> hi
(? (Natural of (Type 0)))    # -> hi
(? (Boolean of Type))        # -> hi
(? ((Type 0) of (Type 1)))   # -> hi
(? ((Type 1) of (Type 0)))   # -> lo
```

## Pi Formation

`Pi` forms a dependent product. The binder is written in prefix type notation:

```lino
(Pi (Natural n) Natural)
```

Rule:

```text
Gamma, n : Natural |- B is a type-like link
-------------------------------------------
Gamma |- (Pi (Natural n) B) : (Type 0)
```

The current implementation records the bound parameter in the type
environment and records the `Pi` expression as a member of `(Type 0)`.
Full validation of the codomain is deferred to the bidirectional checker.

Non-dependent function types use `_` when the result does not mention the
argument:

```lino
(Pi (Natural _) Boolean)
```

## Lambda Formation

`lambda` forms an abstraction over one typed parameter:

```lino
(lambda (Natural x) x)
(identity: lambda (Natural x) x)
```

Rule:

```text
Gamma, x : A |- body : B
------------------------
Gamma |- (lambda (A x) body) : (Pi (A x) B)
```

For named lambdas, the evaluator stores both:

- the lambda body for later application;
- the inferred `Pi` type of the name.

Example:

```lino
(Natural: (Type 0) Natural)
(identity: lambda (Natural x) x)
(? (identity of (Pi (Natural x) Natural)))  # -> 1
(? (type of identity))                      # -> (Pi (Natural x) Natural)
```

## Application

`apply` explicitly applies a lambda to an argument:

```lino
(apply identity zero)
(apply (lambda (Natural x) (x + 1)) 0)
```

Evaluation rule:

```text
Gamma |- f => (lambda (A x) body)
Gamma |- a : A
---------------------------------
Gamma |- (apply f a) => body[x := a]
```

The implemented reduction substitutes the argument into the lambda body with
the same capture-avoiding helper used by `subst`. If the reduct is closed and
numeric, evaluation continues to a value:

```lino
(? (apply (lambda (Natural x) (x + 1)) 0))  # -> 1
```

If the reduct still contains names that are not available in the evaluator
context, the query reports the reduced open term instead of treating those
names as default-probability symbols:

```lino
(? (apply (lambda (Natural x) (x + y)) z))  # -> (z + y)
```

Nested binders are alpha-renamed when needed so beta-reduction does not
capture free variables from the argument:

```lino
(? (apply (lambda (Natural x) (lambda (Natural y) (x + y))) y))
# -> (lambda (Natural y_1) (y + y_1))
```

Named lambdas and inline lambdas both use this reduction path.

The intended typing rule is the standard dependent application rule:

```text
Gamma |- f : (Pi (A x) B)
Gamma |- a : A
-------------------------
Gamma |- (apply f a) : B[x := a]
```

The evaluator realizes the reduction path today. Full type checking of the
argument against the domain belongs to the later bidirectional checker.

## Definitional Equality

`isConvertible(t1, t2, ctx)` decides whether two terms are equal after
kernel reduction. The JavaScript API is exported as `isConvertible`; the
Rust API is `is_convertible`.

Default conversion:

1. Look up explicit equality assignments, in both prefix and infix forms.
2. Beta-normalize both terms, including redexes nested inside larger terms.
3. Compare the normalized terms structurally.

For evaluator equality queries, assignment lookup still takes precedence
over conversion:

```lino
(((apply identity zero) = zero) has probability 0.5)
(? ((apply identity zero) = zero))  # -> 0.5
```

If no assignment or conversion applies, equality falls back to numeric
comparison only when both sides are explicitly numeric or computable from
numeric operators. Unassigned symbolic terms do not collapse to the default
unknown probability:

```lino
(? ((pair (apply (lambda (Natural x) x) y)) = (pair y)))  # -> 1
(? ((pair x) = (pair y)))                                # -> 0
```

Eta-conversion is available only through the convertibility API option
(`{ eta: true }` in JavaScript, `ConvertOptions { eta: true }` in Rust).

## Substitution

`subst` is the kernel primitive for capture-avoiding substitution:

```lino
(subst (lambda (Natural y) (x + y)) x y)
```

Rule:

```text
Gamma |- term[x := replacement] = term'
----------------------------------------
Gamma |- (subst term x replacement) => term'
```

The helper substitutes only free occurrences of the target variable. It stops
at `lambda`, `Pi`, and `fresh` binders that shadow the target variable. When
the replacement contains a free variable that would be captured by a binder in
the term, the binder is alpha-renamed deterministically:

```lino
(? (subst (lambda (Natural y) (x + y)) x y))
# -> (lambda (Natural y_1) (y + y_1))
```

## Freshness

`fresh` introduces a scoped name that must not already appear in the current
environment:

```lino
(fresh y in ((lambda (Natural x) (x + y)) y))
```

Rule:

```text
x notin Gamma
Gamma, x fresh |- body => v
---------------------------
Gamma |- (fresh x in body) => v
```

If the name is already present in the context, evaluation rejects the form with
diagnostic `E010`:

```lino
(Natural: (Type 0) Natural)
(y: Natural y)
(? (fresh y in y))  # E010
```

## Type Membership And Query Links

Membership checks use `(expr of Type)`:

```lino
(? (zero of Natural))
(? ((Type 0) of (Type 1)))
```

Rule:

```text
Gamma records expr : A
----------------------  if A equals Expected
Gamma |- (expr of Expected) => hi

Gamma does not record expr : Expected
-------------------------------------
Gamma |- (expr of Expected) => lo
```

Type queries use `(type of expr)`:

```lino
(? (type of zero))  # -> Natural
```

Rule:

```text
Gamma records expr : A
----------------------
Gamma |- (type of expr) => A

Gamma has no type fact for expr
-------------------------------
Gamma |- (type of expr) => unknown
```

## Proof Witness Names

When proof production is enabled, typed-kernel forms produce derivation
links with these rule names:

| Form | Witness rule |
|------|--------------|
| `(Type N)` | `type-universe` |
| `(Prop)` | `prop` |
| `(Pi (A x) B)` | `pi-formation` |
| `(lambda (A x) body)` | `lambda-formation` |
| `(apply f a)` | `beta-reduction` |
| `(subst term x replacement)` | `substitution` |
| `(fresh x in body)` | `fresh` |
| `(type of expr)` | `type-query` |
| `(expr of Type)` | `type-check` |

## Bidirectional Type Checker

Issue #42 layers a mode-switching checker on top of the query rules above.
Two functions form the public API:

- `synth(term, env)` — infers the type of `term` and returns it as an AST
  node, or `null`/`None` when synthesis fails.
- `check(term, expected, env)` — verifies `term` against `expected` and
  returns `ok: true` on success.

Both helpers always return a `diagnostics` list. Successful runs return
`diagnostics: []`; failures populate it with stable `E020`..`E024` codes
(see [`DIAGNOSTICS.md`](./DIAGNOSTICS.md)). The checker never throws on
user-visible errors — it always reports them through diagnostics so an
editor or test runner can surface them with source spans.

```js
import { Env, evalNode, synth, check } from 'relative-meta-logic';

const env = new Env();
evalNode(['Natural:', ['Type', '0'], 'Natural'], env);
evalNode(['zero:', 'Natural', 'zero'], env);
evalNode(['identity:', 'lambda', ['Natural', 'x'], 'x'], env);

synth('zero', env);
// → { type: 'Natural', diagnostics: [] }

check(['lambda', ['Natural', 'x'], 'x'],
      ['Pi',     ['Natural', 'x'], 'Natural'], env);
// → { ok: true, diagnostics: [] }

check('zero', 'Boolean', env);
// → { ok: false, diagnostics: [{ code: 'E021', message: 'Type mismatch: ...', span }] }
```

```rust
use rml::{check, eval_node, synth, Env, Node};
let mut env = Env::new(None);
// ... eval_node declarations as above ...

let result = synth(&Node::Leaf("zero".into()), &mut env);
assert_eq!(rml::key_of(&result.typ.unwrap()), "Natural");
```

### Inference rules

The synthesise direction (`Gamma |- e => T`) implements:

```text
(Type N) : (Type N+1)             — universe successor
(Prop)   : (Type 1)               — propositional universe
Gamma, x : A |- B is well-formed
--------------------------------
Gamma |- (Pi (A x) B) : (Type 0)

Gamma, x : A |- body => B
-------------------------------------------------
Gamma |- (lambda (A x) body) : (Pi (A x) B)

Gamma |- f => (Pi (A x) B)    Gamma |- a <= A
-----------------------------------------------
Gamma |- (apply f a) : B[x := a]

Gamma |- (subst e x v) reduces to e'    Gamma |- e' => T
--------------------------------------------------------
Gamma |- (subst e x v) : T

Gamma |- e => T                Gamma |- e <= T
------------------------    -------------------
(type of e) : (Type 0)       (e of T) : (Type 0)
```

### Checking rules

The check direction (`Gamma |- e <= T`) prefers the direct lambda-vs-Pi
rule and otherwise switches to synthesise + definitional convertibility:

```text
A == A'    Gamma, x : A |- body <= B[y := x]
-------------------------------------------------------
Gamma |- (lambda (A x) body) <= (Pi (A' y) B)

Gamma |- e => T'    T' == T (definitionally)
--------------------------------------------
Gamma |- e <= T
```

Numeric literals accept any annotation in `check`; the kernel does not yet
record number sorts, and equality with the expected type collapses through
`isConvertible` downstream.

### Diagnostic codes

| Code | Trigger |
|------|---------|
| `E020` | Cannot synthesise a type — bare symbol with no recorded type, or malformed universe level. |
| `E021` | Definitional type mismatch — synthesised type differs from the expected type, or lambda parameter type does not match the Pi domain. |
| `E022` | Application head does not synthesise to a Pi-type. |
| `E023` | Lambda checked against a non-Pi expected type. |
| `E024` | Malformed binder in `Pi` or `lambda`. |

## Prenex Polymorphism

`(forall A T)` is surface sugar for the dependent product
`(Pi (Type A) T)` — a `Pi`-type whose domain is the universe `Type`. The
type variable `A` is bound at `Type` and is free in the body `T`.
Higher-rank quantification is out of scope: nested `forall`s desugar
lazily as the type checker recurses into the body, so a `forall` may sit
under another `forall` (giving an iterated prenex), but writing one
underneath an arbitrary `Pi` produces no special treatment beyond what
the underlying `Pi` rule already does.

The polymorphic identity, apply, and compose all type-check directly:

```lino
(identity: forall A (Pi (A x) A))
(identity: lambda (Type A) (lambda (A x) x))

(poly-apply: forall A (forall B (Pi ((Pi (A x) B) f) (Pi (A x) B))))
(poly-apply: lambda (Type A) (lambda (Type B)
                (lambda ((Pi (A x) B) f) (lambda (A x) (apply f x)))))
```

Type-application reuses the `Pi` rule for `apply` — instantiating
`identity` at `Natural` substitutes `A := Natural` in the body:

```lino
(? (apply identity Natural))         # -> (Pi (Natural x) Natural)
(? (apply (apply identity Natural) zero))  # -> Natural
```

The desugaring is implemented by `_isForallNode` / `_expandForall`
(JavaScript) and `is_forall_node` / `expand_forall` (Rust); both apply
the expansion only at the outermost layer of the form being inspected,
so the cost is `O(1)` per check.

## Example Contract

The shared example
[`examples/dependent-types.lino`](../examples/dependent-types.lino) is the
public executable sample for this surface. Both implementations run every
file in `examples/` and compare the results with
[`examples/expected.lino`](../examples/expected.lino), so changes to these
rules must update the shared fixtures intentionally.

The dedicated kernel tests are:

- JavaScript: `js/tests/kernel.test.mjs`, `js/tests/bidirectional.test.mjs`,
  `js/tests/prenex-polymorphism.test.mjs`
- Rust: `rust/tests/kernel_tests.rs`, `rust/tests/bidirectional_tests.rs`,
  `rust/tests/prenex_polymorphism_tests.rs`
