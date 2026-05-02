# Typed Kernel

This document specifies the typed-kernel surface implemented by the
JavaScript and Rust evaluators. It is the D1 contract from issue #37:
the rules for `Pi`, `lambda`, `apply`, type membership with `of`, and
type queries with `(type of ...)`.

RML remains a dynamic axiomatic system. These rules install and query type
facts in the evaluator environment; they are not yet a full bidirectional
checker with rejection diagnostics. That stricter layer is planned in the
later typed-kernel issues.

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
```

Universe rule:

```text
-------------------------------
Gamma |- (Type N) : (Type N+1)
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

The implemented reduction substitutes the argument into the lambda body and
evaluates the result. Named lambdas and inline lambdas both use the same
substitution helper. The helper does not substitute under a nested `lambda`
or `Pi` binder that shadows the same variable.

The intended typing rule is the standard dependent application rule:

```text
Gamma |- f : (Pi (A x) B)
Gamma |- a : A
-------------------------
Gamma |- (apply f a) : B[x := a]
```

The evaluator realizes the reduction path today. Full type checking of the
argument against the domain belongs to the later bidirectional checker.

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
| `(type of expr)` | `type-query` |
| `(expr of Type)` | `type-check` |

## Example Contract

The shared example
[`examples/dependent-types.lino`](../examples/dependent-types.lino) is the
public executable sample for this surface. Both implementations run every
file in `examples/` and compare the results with
[`examples/expected.lino`](../examples/expected.lino), so changes to these
rules must update the shared fixtures intentionally.

The dedicated kernel tests are:

- JavaScript: `js/tests/kernel.test.mjs`
- Rust: `rust/tests/kernel_tests.rs`
