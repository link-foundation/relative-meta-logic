# Meta-Theory Mapping

This document maps the RML constructs introduced for issue
[#97](https://github.com/link-foundation/relative-meta-logic/issues/97) —
the inductive Peano fragment, the proof-substrate, and the trust report —
to the universal vocabulary of
[Links Theory (meta-theory)](https://github.com/link-foundation/meta-theory):
**references**, **links**, **doublets**, and **triplets**.

It is the bridge from the meta-theory's two axioms ("a link is a
universal unit of meaning" and "any data structure can be expressed as
a network of doublets and triplets") to the concrete LiNo forms that
`examples/nat-links.lino` and `examples/typed-kernel-links.lino` parse
into.

If you have not read it yet, the companion piece is
[`case-studies/issue-13/README.md`](./case-studies/issue-13/README.md),
which establishes the same correspondence for the
**typed-kernel** side (Pi, lambda, apply, universes). This document
pushes the correspondence into the **inductive layer** (Peano naturals,
equality of naturals, induction) and the **proof-substrate**
(`(rule …)`, `(proof-object …)`, `(check-proof …)`) that consumes
the inductive layer.

## 1. The vocabulary

The meta-theory's primitives are:

| Meta-theory | Plain English | LiNo realization |
|-------------|---------------|------------------|
| **Reference** | A pointer to a link (its identity). | A bare identifier such as `zero`, `Nat`, `?n`, or `(succ zero)` — when consumed by `(? …)` it is taken by reference, not by value. |
| **Link** | An ordered tuple of references; a unit of meaning. | A parenthesized form `(a b c …)`. Order matters; nesting is allowed. |
| **Doublet** | A 2-tuple link. | `(a b)`. Example: `(zero has-type Nat)` taken purely as a doublet between `zero` and `Nat` would be `(zero Nat)` — the explicit `has-type` separator carries the relation name. |
| **Triplet** | A 3-tuple link, often `(subject relation object)`. | `(zero has-type Nat)`, `(?n nat-equals ?n)`, `((add ?m ?n) nat-equals ?k)` — relation in the middle, subjects on the sides. |

Higher-arity links (4-tuples, 5-tuples, …) are also legal LiNo but
the meta-theory holds that anything they encode is **reducible** to a
network of doublets and triplets, so the constructs introduced for
issue #97 always factor through doublets or triplets at the leaves.

## 2. The inductive Peano fragment

`examples/nat-links.lino` realises the natural numbers as a finite
collection of links, every one of which is either a doublet, a triplet,
or a triplet whose subject/object is itself a link.

### 2.1 Constructors

| Construct | Form | Meta-theory shape |
|-----------|------|-------------------|
| **`Nat`** (the type itself) | `Nat` | A bare **reference**. The link `(zero has-type Nat)` then closes a triplet around it. |
| **`zero`** (the base inhabitant) | `zero` | A bare **reference**; an *atomic link*. The judgement `(zero has-type Nat)` makes it inhabit `Nat`. |
| **`succ ?n`** (the successor) | `(succ ?n)` | A **doublet** between the constructor reference `succ` and the predecessor reference `?n`. Repeated nesting yields `(succ (succ zero))` — a doublet whose right component is itself a doublet. |
| **`add ?m ?n`** | `(add ?m ?n)` | A **triplet** with relation `add` in head position and operands as references. |
| **`mul ?m ?n`** | `(mul ?m ?n)` | Same shape as `add`; a triplet with a different relation. |

There is **no host integer** anywhere in the encoding: `2` is the
doublet `(succ (succ zero))`, not `2`. The `eval-nat` normalizer
(§9) dispatches through the active Peano computation rules and
produces a Peano normal form. The legacy result stream renders that
normal form as a host number for display, but that renderer is a
separate trust boundary and does not change the meta-theory shape of
the underlying link.

### 2.2 Typing and equality judgements (triplets)

The proof-substrate keeps the judgement shape `(subject relation
object)`:

| Judgement | LiNo | Meta-theory shape |
|-----------|------|-------------------|
| `t : T` (has-type) | `(t has-type T)` | Triplet `(t, has-type, T)` |
| `Γ ⊢ J` (turnstile) | `(Gamma turnstile J)` | Triplet `(Gamma, turnstile, J)` |
| `m =ₙ n` (nat-equals) | `(m nat-equals n)` | Triplet `(m, nat-equals, n)` |
| `m =ₕ n` (host equality) | `(m equals n)` | Triplet `(m, equals, n)` — distinct relation from `nat-equals`. |

Two equality relations are kept separate by design. `equals` /
`numeric-equality` is the host decimal-12 layer (still
`host-primitive` / `host-trusted`). `nat-equals` is the
`links-defined` layer added by PR 178 with reflexivity (`nat-refl`)
and successor congruence (`nat-cong-succ`); §10 of `FOUNDATIONS.md`
documents that the host equality is untouched.

### 2.3 Rules as networks of triplets

A proof rule is a meta-link whose immediate children are themselves
links: `(premise …)` clauses are sub-links, `(conclusion …)` is a
sub-link, and the rule head ties them together. For instance the
links for `nat-add-succ` are:

```
( rule
  nat-add-succ
  ( premise ((add ?m ?n) nat-equals ?k) )
  ( conclusion ((add (succ ?m) ?n) nat-equals (succ ?k)) ) )
```

Reading top-down:

1. The outer **link** is `(rule, nat-add-succ, premise-link,
   conclusion-link)` — a 4-tuple.
2. The **premise** is the triplet
   `((add ?m ?n), nat-equals, ?k)` whose subject is itself a triplet
   `(add, ?m, ?n)`.
3. The **conclusion** is the triplet
   `((add (succ ?m) ?n), nat-equals, (succ ?k))` whose subject
   contains the doublet `(succ ?m)` and whose object is the doublet
   `(succ ?k)`.

Every leaf is a reference; every branch is a link whose form is a
triplet or a doublet. The rule, viewed as a network, is therefore
*exactly* an associative network in the meta-theory's sense.

## 3. Proof objects and rule application

A `(proof-object name …)` form bundles three kinds of references:

| Clause | LiNo | Meta-theory |
|--------|------|-------------|
| `(applies rule-name)` | `(applies nat-add-succ)` | Doublet `(applies, nat-add-succ)` — names the rule by reference. |
| `(premise-by ref)` | `(premise-by zero-is-nat)` | Doublet that names an earlier link by reference, not by value. The substrate looks the reference up and checks that the referenced object's *conclusion* unifies with the rule's premise. |
| `(conclusion judgement)` | `(conclusion ((succ zero) has-type Nat))` | Doublet `(conclusion, J)` whose right component is a triplet — the derived judgement. |

The substrate's `(check-proof name)` step is a **link traversal**:
follow the `applies` reference to the rule, follow every
`premise-by` reference to the cited witness, unify the cited
witness's conclusion against the rule's premise, and compare the
resulting conclusion to the proof object's own. Nothing computes
arithmetic, normalises, or substitutes outside the bounded host
primitives the trust report enumerates.

This makes **rule application** a doublet between a proof-object
reference and a rule reference; **dependencies** are doublets between a
proof-object reference and one or more witness references; the
**proof-object itself** is a small associative network whose references are
connected by doublets/triplets. The
`(proof-report <name>)` view added in this PR (commit `c6f5a14`)
prints exactly that network.

## 4. Inductive closure

`nat-induction` packages the induction principle as a single rule. In
LiNo:

```
( rule nat-induction
  ( premise (?P at zero) )
  ( premise ( forall ?n
              ( implies (?P at ?n) (?P at (succ ?n)) ) ) )
  ( conclusion ( forall ?n (?P at ?n) ) ) )
```

As an associative network:

- `?P` is a **reference** to whichever predicate the proof-object
  instantiates it with at check time.
- `(?P at ?n)` is a **triplet** `(P, at, n)` — predicate application
  modelled as a relation.
- `(forall ?n (?P at ?n))` is a **triplet**
  `(forall, ?n, body)` whose body is itself a triplet.
- `(implies a b)` is a **triplet** `(implies, a, b)`.

The "closure" intuition — every natural number is reachable from
`zero` by successor — is therefore not encoded by a single link but by
the rule itself: the rule is a finite associative network of triplets
that, when instantiated at a predicate, lets `(check-proof …)` produce
the closure on demand. In the meta-theory, "closure under a rule" is
**not** a primitive; it is the result of replaying a rule application
zero or more times.

## 5. The trust report as a derived graph view of the links network

`(foundation-report)` exposes a labelled-graph projection of the registry.
This graph is a constrained view derived from the surrounding links network,
not the ambient representation of the meta-logic or meta-theory:

| Graph element | Report field | Meta-theory shape |
|---------------|--------------|-------------------|
| Node | `rootConstructs[i].name` | Reference. |
| Status label on a node | `status`, `semanticStatus` | A pair of doublets `(node, status, kind)`. |
| Edge | `dependsOn` entries | Doublet `(node, depends-on, other-node)`. |
| Foundation membership | `foundations[i].uses` | A small network of doublets `(foundation, uses, rule-name)`. |

Every entry in §9 of `FOUNDATIONS.md` therefore reads naturally as a
small network. The pre-seeded `nat-links` foundation, for instance,
becomes the network:

```
(nat-links, uses, nat-zero-formation)
(nat-links, uses, nat-succ-formation)
(nat-links, uses, nat-add-zero)
(nat-links, uses, nat-add-succ)
(nat-links, uses, nat-induction)
(nat-links, uses, nat-equality)
(nat-links, uses, nat-refl)
(nat-links, uses, nat-cong-succ)
(nat-links, uses, nat-recursion)
(nat-links, uses, nat-eliminator)
(nat-links, uses, nat-mul-zero)
(nat-links, uses, nat-mul-succ)
(nat-links, extends, default-rml)
```

The typed-kernel-links foundation reads similarly:

```
(typed-kernel-links, uses, pi-formation)
(typed-kernel-links, uses, lambda-introduction)
(typed-kernel-links, uses, application-elimination)
(typed-kernel-links, uses, beta-conversion)
(typed-kernel-links, extends, default-rml)
```

Each `uses` doublet's right component is itself a node with its own
`(depends-on)` doublets — the network is recursive and finite, which is
exactly the shape the meta-theory takes as its primitive.

## 6. What stays host-primitive — and why

Three operations cannot be reduced to a finite associative network of
the form above without losing decidability, so they remain
**host-trusted** in the registry. Each is documented as such, with an
explicit `depends-on` edge so the audit graph is visible:

| Operation | Why host-trusted | Registry entry |
|-----------|------------------|----------------|
| **Substitution** | Capture-avoidance is a metavariable-walk that, viewed as a network, is unbounded. | `(root-construct substitution (status host-primitive) (semantic-status host-trusted) …)` |
| **Freshness** | Generating a fresh name is a non-deterministic choice over an infinite universe. | `(root-construct freshness …)` |
| **Alpha-renaming** | Consumes `freshness` to choose a witness. | `(root-construct alpha-renaming …)` |
| **Beta-reduction / normalization / conversion / whnf** | Beta is decidable on closed terms but the reflexive-transitive closure is the **interpretation** of the substrate's terms, not a network of doublets. | `(root-construct beta-reduction …)` and friends, each with its own `depends-on`. |

Everything else used by the typed kernel — `pi-formation`,
`lambda-introduction`, `application-elimination`, `beta-conversion` —
is `links-defined` / `links-checked`. The trust audit therefore states
the entire kernel boundary in a single report rather than burying it in
source code; the pinning test
`js/tests/typed-kernel-links.test.mjs:184` ("reports the complete
typed-kernel boundary in foundation-report") enforces the boundary
mechanically.

## 7. Reading guide

- For the **typed-kernel mapping** (Pi, lambda, apply, universes,
  contexts), start with `docs/case-studies/issue-13/README.md` and
  follow with `examples/typed-kernel-links.lino`.
- For the **inductive layer** (Peano constructors, addition, induction,
  equality), read `examples/nat-links.lino` alongside §9.9 of
  `docs/case-studies/issue-97/README.md`.
- For the **proof-substrate consumed by both** (rules, proof objects,
  `check-proof`, dependency reporting), read `docs/FOUNDATIONS.md` §3
  and the proof-substrate tests
  (`js/tests/proof-substrate.test.mjs`,
  `rust/tests/proof_substrate_tests.rs`).

Together those four documents describe a complete instance of the
meta-theory at work: an associative network of references connected by
doublets and triplets, whose semantics is
a small bounded set of host primitives, and whose audit trail is the
foundation report.

## 8. Executable cross-theory network

Issue #183 turns this mapping into executable data in
[`lib/meta-theory/core.lino`](../lib/meta-theory/core.lino), checked against the
independently selected
[`lib/meta-theory/foundation.lino`](../lib/meta-theory/foundation.lino) trust
profile. The matching JavaScript and Rust `TheoryNetwork` APIs load both through
`meta-language`, resolve and translate theory-local terms through shared concept
addresses, and search the cyclic definition network safely. Every definition link names an
implementation manifest and a proof object. Network construction requires the
manifest's proposed subject/foundation pair and the adapter's exact kind and
obligation set; executes all finite conformance operations; replays the proof
through the existing proof substrate; and requires the checked conclusion to
match that exact link. Candidate theory documents cannot declare the rules,
axioms, adapter contracts, or expected judgements used to verify themselves.
Links Theory has explicit definitions through set theory, type theory, and
itself; set theory and type theory have reverse links definitions; and Relative
Meta-Logic has an explicit Links Theory foundation.

Addressed doublet stores implement meta-theory 0.0.3 balanced/left/right finite
sequence trees, canonical ordered-unique set trees, and an independent
membership-link interpretation with finite set algebra. A separate bounded
right-spine traversal observes direct or indirect self-reference without
assuming termination. The ambient API is deliberately a `LinkNetwork`;
`TypedLinkNetwork` enforces declared endpoint types, `LinkGraph` is introduced
only as a vertex-constrained subset with typed edges, and `FiniteRelation`
implements typed ordered-pair sets with converse, union, intersection, and
composition. Checked set/type definition witnesses connect both derived
theories back into the same links network. See
[`META_THEORY.md`](./META_THEORY.md) for the source forms, APIs, guarantees, and
verification boundary.
