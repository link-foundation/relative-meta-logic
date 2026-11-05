# Source specifications of types, graphs and relational algebra (R123)

Three source specifications are ordinary linked programs. Both runtimes run
them natively with the generic direct-structural reducer, and the linked
proof verifier checks a certificate for every theorem they state:

- [`type-specification.lino`](../../../lib/meta-theory/type-specification.lino);
- [`graph-specification.lino`](../../../lib/meta-theory/graph-specification.lino);
- [`relational-algebra-specification.lino`](../../../lib/meta-theory/relational-algebra-specification.lino).

Sets and Links already have native specifications. These are
[`universal.lino`](../../../lib/meta-theory/universal.lino) (addressed links,
finite sets and relations as data) and the certified upstream set, sequence,
network and Links corpus ([META_THEORY_NATIVE.md](../../META_THEORY_NATIVE.md)).

```sh
node scripts/generate-meta-theory-specifications.mjs --check
node --test js/tests/meta-theory-specifications.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test meta_theory_specifications_tests
```

## What each specification states

"Complete" here means the operator and law sets below. Nothing is claimed
outside them.

### Types

The type specification is a simply typed calculus with base, function and
product types.

| Part | Contents |
| --- | --- |
| Types | `ty-nat`, `ty-bool`, `ty-unit`, `(ty-arrow A B)`, `(ty-product A B)` |
| Terms | variables, `tm-lam`, `tm-app`, `tm-pair`, `tm-fst`, `tm-snd`, `tm-zero`, `tm-succ`, `tm-iszero`, `tm-true`, `tm-false`, `tm-if`, `tm-unit` |
| Operations | `ty-is-type`, `ty-context-ok`, `ty-lookup`, `ty-infer`, `ty-check`, `ty-value-p`, `ty-subst`, `ty-step`, `ty-eval` |

`ty-infer` is algorithmic typing. It returns `(ty-ok A)` or one of nine
errors: `invalid-type`, `argument-mismatch`, `not-a-function`, `not-a-pair`,
`expected-nat`, `branch-mismatch`, `expected-bool`, `unknown-term` and
`unbound-variable`. `ty-step` is call-by-value small-step reduction.

The declarative judgement `has-type` has 13 typing rules, one per term
former. Four more rules state preservation, evaluation preservation and
progress, which together cover the step and value cases.

There are five theorems:

- `typing-twice`;
- `preservation-swap`;
- `preservation-conditional`;
- `evaluation-twice-successor`;
- `progress-swap`.

### Graphs

A graph is a finite set of vertices and a finite set of directed edges.

The operations cover:

- well-formedness;
- vertex and edge membership;
- edge and vertex lists;
- successors and the adjacency list;
- the monotone step `F(R) = E ∪ (R ; E)`;
- the transitive closure as the least fixed point of `F`, by Kleene iteration from the empty relation;
- reachability;
- path checking and path ends;
- acyclicity;
- fixed-point and prefixed-point tests;
- relation inclusion.

Reachability is also stated inductively by the proof rules `reach-edge` and
`reach-step`. The other six rules are `transitive-at`, `closure-fixed`,
`closure-below`, `path-reaches`, `reach-computed` and `dag`.

There are seven theorems:

- reachability is transitive at a chosen triple, on the DAG and on the cyclic graph;
- the closure is a fixed point;
- the closure lies below a given prefixed point, which is the least-fixed-point property;
- a path implies reachability;
- inductive reachability agrees with the computed closure;
- the DAG is acyclic.

### Relational algebra

Relations have attribute-set schemas and tuple sets. The six operators are:

- selection σ, with predicates `true`, `false`, `A = v`, `A = B`, `not`, `and` and `or`;
- projection π, with duplicate elimination;
- natural join ⋈;
- union ∪;
- difference −;
- rename ρ.

A natural join with no shared attributes is the Cartesian product. The six
operators therefore form Codd's relationally complete basis.

Evaluation reports six errors:

- `malformed-relation`;
- `unknown-relation`;
- `unknown-attribute`;
- `attribute-clash`;
- `schema-mismatch`;
- `unknown-expression`.

`ra-same-relation` decides set equality.

The 16 laws are data over parameters:

| Laws | Names |
| --- | --- |
| Union | commutative, associative, idempotent |
| Join | commutative, associative, idempotent |
| Selection | distributes over union, distributes over difference, cascade, commutes, pushes down into a join |
| Projection | distributes over union, cascade |
| Other | difference with itself is empty; rename is inverted by the reverse rename; join distributes over union |

There is one proof rule, `extensional`. Its premises are that both sides
evaluate and that the results are the same relation.

## Certificates

A certificate (`rml-spec-certificate/v1`) records five things:

- the program;
- the theorem;
- the goal;
- the facts used;
- a natural-deduction derivation.

The trusted checker builds its context from the specification itself:

1. It recomputes the statement with `(spec-theorem NAME)`.
2. It takes the rules from `(spec-proof-rules)`.
3. It re-executes every fact `(F ARGUMENTS...)` and offers each one only as the rule `(evaluates (spec-call F ARGUMENTS...) VALUE)`.
4. It runs `lib/meta-theory/proof-verifier-natural.lino` over that context.

Statements are computed from the definitions, so a changed definition
changes a statement or a fact value. The old certificate is then rejected.

JavaScript ([`rml-spec-certificates.mjs`](../../../js/src/rml-spec-certificates.mjs))
has both the untrusted producer and the checker. Rust
([`spec_certificates.rs`](../../../rust/src/spec_certificates.rs)) has the
checker only.

## Shared fixtures and negative cases

[`scripts/generate-meta-theory-specifications.mjs`](../../../scripts/generate-meta-theory-specifications.mjs)
writes two fixtures to `test-corpus/meta-theory-specifications/`.

`cases.json` holds 73 native cases, with values and step counts. Every
operator has at least one case, and every program has negative cases:

- 8 ill-typed terms, one for each typing error except `unknown-term`;
- a cyclic graph rejected by `gr-acyclic`;
- unions and differences of mismatched schemas;
- unknown attributes, attribute clashes and malformed relations.

`certificates.json` holds the 28 theorem certificates and five forged
derivations. The checker rejects each one for its recorded reason:

- an ill-typed successor;
- a cyclic graph claimed acyclic, both with a forged fact and with the honest fact;
- an unreachable pair;
- a schema-mismatched union.

The JavaScript tests and the hand-written Rust mirror
(`rust/tests/meta_theory_specifications_tests.rs`) check both fixtures. They
also reject the following mutated certificates:

- a changed fact value;
- a dropped fact;
- a changed fact expression;
- an edited goal;
- a different theorem;
- an unknown theorem;
- a wrong schema;
- a changed root conclusion;
- a substituted rule.

## Beyond the certified instances

The JavaScript tests also run:

- a preservation certificate for every reduction step of every named term;
- reachability derivations for exactly the pairs in the computed closure of both graphs;
- an exhaustive check over all 512 relations on three vertices that the closure lies below every prefixed point, against an independent oracle;
- more than 300 further law instances across all 16 laws, including empty relations;
- refutations of a false law (difference is not commutative) and of violated side conditions.

## In the researcher recipe

Step 6 of the [meta-theory recipe](researcher-workflow.md) runs every case and
re-checks every certificate in both runtimes. It reports one sample statement
per specification.

As an example, change the natural join so that it drops right-only fields.
The relational-algebra row of the report then changes: fewer cases reproduce,
and the four join theorems are no longer certified. The other rows stay the
same.

## Scope limits

- **Certificates cover concrete instances.** Laws and meta-theorems are
  certified on named relations, graphs and terms. They are not proved for all
  relations or all well-typed terms; the bounded checks above test them on
  more instances.
- **The type system is simple.** It has no polymorphism, recursion, sums or
  dependent types. Dependent typing exists separately in `universal.lino`.
- **Sets and Links get no new specification here.** They rely on
  `universal.lino` and the certified upstream corpus.
