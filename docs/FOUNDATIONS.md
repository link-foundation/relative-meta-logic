# Foundations

This document describes RML's **root-construct registry** and **foundation
scope** (issue [#97](https://github.com/link-foundation/relative-meta-logic/issues/97)).
The two together let users replace the meaning of operators such as `and`,
`or`, `both`, `neither` without touching the evaluator, and inspect what the
prover is actually trusting at any point in time.

This is the compatibility surface for the original general-purpose evaluator.
It is distinct from the executable linked-program meta-theory in
[`META_THEORY.md`](./META_THEORY.md). That newer path publishes its exact K0
host report, executes a links-defined K1 meta-interpreter, and supports
foundation-polymorphic imports. Legacy host primitives and external tactics
listed here cannot authorize a linked-program theory definition.
The linked-program engine also has an
[architecture-neutral foundation search](./case-studies/issue-183/foundation-search.md)
that compares closed S/K, direct structural, and Horn-relational execution.
The latter two remain controls rather than ranking peers until they eliminate
host/self duplication. The report names no winner. Its two-model witness shows
only that the tested ordered-link host signature does not select between two
functions; it does not make a claim about link ontology. These measured
execution bases are distinct from the legacy configurable operator registry
documented on this page.
The v4 report additionally marks all three bases as executable controls that
cannot constrain the independent ontology investigation; primitive categories,
the structure/transformation relation, intrinsic authority, and comparative
minimality remain explicitly unresolved.

The headline guarantee is backward compatibility:

> Every `.lino` source file that ran before this surface existed runs
> identically afterwards. The default foundation `default-rml` is
> pre-registered automatically, mirrors the current host-implemented
> semantics, and is the only foundation active until a `(with-foundation
> ...)` form says otherwise.

If you are looking for **what** is reconfigurable inside the default
foundation (range, valence, aggregator selection, operator composition),
see [`CONFIGURABILITY.md`](./CONFIGURABILITY.md). This page is the broader
story: how every primitive the kernel uses is catalogued, given a trust
status, and how an alternative foundation can re-bind those primitives
inside a scoped region.

## 1. Why foundations

RML is a meta-logic; its job is to host *other* logic systems. The
configurability story in `CONFIGURABILITY.md` already lets a user pick a
range, valence, aggregator, or operator composition by writing ordinary
top-level forms. That is enough to swap, say, fuzzy `and = avg` for
classical `and = min`, but it leaves the bookkeeping implicit:

- Which root constructs are *host primitives* — implemented directly in
  JS/Rust and trusted unconditionally?
- Which are *links-encoded* (described as data in `lib/self/*.lino`) vs.
  *links-defined* (their selected rules or rows are consumable by the
  host checker)?
- Which are *user-configurable* runtime knobs?
- Which are *external trusted* oracles (SMT, ATP)?
- Which are *planned* but not yet implemented?

A registry that records this status for every primitive — plus a scope
construct that swaps a coherent bundle of those primitives in one move —
is the difference between a configurable prover and a foundationally
honest one.

## 2. The root-construct registry

Every primitive the evaluator, type checker, proof-replay checker,
tactic engine, or metatheorem checker depends on has a descriptor in the
registry. Descriptors are *data only* — they never change evaluator
behaviour. They feed the `(foundation-report)` form and the trust audit
the CLI emits.

A descriptor field is one of:

| Field | Meaning |
|-------|---------|
| `kind` | What category the construct belongs to (e.g. `truth-operator`, `aggregator`, `binder`, `equality-layer`). |
| `status` | One of the backward-compatible trust statuses below. |
| `semantic-status` | One of the execution-boundary statuses below. Omit it to derive the conservative default from `status`. |
| `depends-on` | Names of constructs this one builds on. Forms a dependency graph the report can traverse. |
| `encoded-as` | The host symbol that currently implements the construct (for documentation only). |
| `pure-links-ready` | `yes` if the construct's meaning is derivable from links alone, `no` otherwise. |
| `planned-as` | The status the construct should reach in a future milestone. |

Trust statuses, mirroring the categories proposed in the issue thread:

| Status | When to use it |
|--------|----------------|
| `host-primitive`     | Implemented directly in JS/Rust and trusted unconditionally. |
| `host-derived`       | Defined in host code from other host primitives. |
| `external-trusted`   | Relies on an external binary (SMT, ATP) or system service. |
| `user-configurable`  | A runtime knob the user can tune (range, valence, operator aggregator). |
| `links-encoded`      | Description lives in `lib/self/*.lino` as data; the host still interprets it. |
| `links-defined`      | Behaviour is selected from links-level rules or rows that the prover/checker can consume. See `semantic-status` for the execution boundary. |
| `user-overridden`    | Replaced by an active user foundation inside the current scope. |
| `planned`            | Not yet implemented. |

Semantic statuses make the "built from links/references" claim more precise:

| Semantic status | When to use it |
|-----------------|----------------|
| `host-trusted` | Behaviour is executed by JS/Rust or by an external trusted boundary. |
| `links-described` | The construct is represented as links/LiNo data, but host code still interprets that description. |
| `links-checked` | Links-level rows, rules, or proof objects are checked by the host replay/matching machinery. |
| `links-evaluated` | Behaviour is obtained by evaluator rules expressed at links level. This is reserved for future milestones unless a construct explicitly opts in. |
| `self-hosted` | The checker/evaluator for the construct is itself represented and justified in the links substrate. No bundled default construct in this legacy registry claims this status; `links-meta-foundation` provides the corresponding K1 experiment in the linked-program engine. |

The default derivation is deliberately conservative: host and configurable
trust statuses become `host-trusted`, `links-encoded` becomes
`links-described`, and the legacy `links-defined` bucket becomes
`links-checked` unless a descriptor says otherwise.

The canonical inventory lives in [`lib/self/foundations.lino`](../lib/self/foundations.lino).
That file is the single source of truth — both the JS and Rust hosts pre-seed
the same descriptors on construction so that a freshly constructed `Env`
already reports the default trust base. Top-level `(root-construct ...)`
forms in user files extend or refine that base.

### Declaring a root construct

```lino
(root-construct my-and
  (kind truth-operator)
  (status links-defined)
  (semantic-status links-checked)
  (depends-on truth-range))
```

Repeated declarations merge non-destructively: an explicit field
overrides the prior value, and an omitted field preserves the prior one,
so partial descriptors can be accumulated.

### Diagnostics

| Code | Cause |
|------|-------|
| `E060` | Malformed `(root-construct ...)` declaration (missing name, unknown child clause shape, non-symbolic field value). |
| `E061` | Malformed `(foundation ...)` declaration (missing name, unknown child clause shape, malformed `(defines ...)` clause, malformed `(root ...)` / `(abit ...)` clause). |
| `E062` | `(with-foundation <name> ...)` references a foundation that has not been registered. The diagnostic does not abort evaluation — forms after the bad scope still run. |
| `E063` | Carrier violation under `(strict-carrier)` — a query result or probability assignment falls outside the active foundation's declared carrier. |
| `E064` | Malformed proof rule / assumption / proof object / `(check-proof ...)` form, premise/conclusion mismatch, unjustified raw premise, or cyclic proof dependency. |
| `E065` | Pure-links strict mode rejected a query whose transitive dependency path reaches an unallowed `host-primitive` / `host-derived` construct; also raised for malformed `(strict-foundation ...)` / `(allow-host-primitive ...)` forms. |
| `E066` | MTC/anum encode/decode error (input outside the four-abit alphabet, unbalanced frame, leaf payload not byte-aligned, or non-Node value passed to `encodeAnum`). |

## 3. Foundations

A foundation bundles a coherent set of root-construct interpretations.
Declarations look like:

```lino
(foundation classical-min
  (description two-valued-classical-boolean-logic)
  (defines and min)
  (defines or max))
```

Field reference:

| Clause | Meaning |
|--------|---------|
| `(description <text>)` | Free-form summary; shown by `(foundation-report)`. |
| `(numeric-domain <name>)` | Name of the numeric domain this foundation expects. |
| `(truth-domain <name>)` | Name of the truth domain. |
| `(extends <name>)` | Inherits fields from a previously registered foundation. |
| `(defines <op> <aggregator>)` | Re-binds operator `<op>` to aggregator `<aggregator>` while the foundation is active. Repeats are allowed; each new `(defines ...)` replaces the binding for that operator. |
| `(carrier <v1> <v2> ...)` | Declares the set of values the foundation considers legal. Symbolic constants (`true`, `false`, `unknown`) resolve through `env.symbol_prob` on activation; numeric literals stay literal. Informational unless `(strict-carrier)` is also present (see §6). |
| `(strict-carrier)` | Opts the foundation into runtime carrier enforcement. Out-of-carrier query results and probability assignments raise `E063` instead of being silently clamped. |
| `(truth-table <op> (in1 in2 -> out) ...)` | Rebinds `<op>` to a finite truth table for the duration of `(with-foundation ...)`. The host still executes the table lookup; the selected behaviour comes from the rows. Partial tables are allowed — rows that don't match fall through to the previously installed op. In `(strict-foundation pure-links)`, only tables that are total over the active strict carrier are treated as fallback-free links-defined implementations. Symbolic truth constants resolve through `env.symbol_prob` on activation. |
| `(experimental)` | Flags the foundation as experimental so the trust audit prints an `[experimental]` tag next to its name. Carries no behavioural guarantees. |
| `(root <symbol>)` | Records the foundation's root concept (e.g. `∞` for `mtc-anum`). Informational; surfaced on the report. |
| `(abit <symbol> <meaning>)` | Records one atomic bit of the foundation's alphabet. Used by experimental profiles like `mtc-anum` to publish their four-abit (`[`, `]`, `0`, `1`) serialization alphabet. Informational; surfaced on the report. |

### The `default-rml` foundation

`default-rml` is pre-registered on every fresh `Env`. It records the
current host-implemented operator semantics (`and=avg`, `or=max`,
`both=avg`, `neither=product`) so that any program written before
foundations existed keeps the same observable behaviour. There is no
`(use-default-rml ...)` form to call — the default is simply always
active until a `(with-foundation ...)` enters another foundation.

`active foundation: default-rml` is therefore the canonical state for
any program that has not declared its own foundation.

### Entering a foundation: `(with-foundation ...)`

```lino
(foundation classical-min
  (defines and min)
  (defines or max))

(a: a is a)
(b: b is b)
((a = true) has probability 0.6)
((b = true) has probability 0.4)

; avg → 0.5
(? ((a = true) and (b = true)))

(with-foundation classical-min
  ; min → 0.4
  (? ((a = true) and (b = true)))
  ; max → 0.6
  (? ((a = true) or (b = true))))

; back to avg → 0.5
(? ((a = true) and (b = true)))
```

Semantics:

1. On entry, the host snapshots the current operator table for every
   construct the foundation `(defines ...)`. The snapshot includes the
   previously-bound aggregator (or its absence).
2. The foundation's `(defines ...)` bindings are then applied: each named
   operator gets the named aggregator. Unknown aggregators trigger
   `E061`; unknown operators are tolerated for forward-compatibility.
3. The body forms evaluate normally. Inside the body, `(foundation ...)`
   declarations are still allowed and are recorded just like at the top
   level. Nested `(with-foundation ...)` forms recurse with their own
   snapshot/restore frame.
4. On exit, the snapshot is restored verbatim — the previously-bound
   operators come back, and the previously-active foundation tag is
   restored.

Scoping is purely lexical: only forms that appear inside the body of a
`(with-foundation ...)` see the swapped operators. Forms after the scope
see the previous bindings restored.

### Errors that do not abort

If `(with-foundation <name> ...)` names a foundation that has not been
registered, the host emits an `E062` diagnostic for the form and skips
the body, then continues evaluating the rest of the file. The
surrounding queries still run with the previously-active foundation.

This matches the project-wide diagnostics philosophy described in
[`docs/DIAGNOSTICS.md`](./DIAGNOSTICS.md): bad forms produce structured
errors, not panics, and never break unrelated downstream queries.

## 4. `(foundation-report)`

`(foundation-report)` is a top-level form that emits a structured
snapshot of the active foundation. The snapshot has the shape:

```text
{
  activeFoundation: "<name>",
  description:      "<text> | null",
  numericDomain:    "<name> | null",
  truthDomain:      "<name> | null",
  rootConstructs:   [ { name, kind, status, semanticStatus, dependsOn, encodedAs, ... } ],
  byStatus:         { "<status>": ["<name>", ...] },
  bySemanticStatus: { "<semantic-status>": ["<name>", ...] },
  foundations:      [ { name, description, defines, ... } ],
  activeImplementations: [
    { construct, foundation, implementation, status, semanticStatus, dependsOn }
  ],
  proofRules:       [ { name, premises, conclusion } ],
  proofAssumptions: [ { name, kind, judgement } ],
  proofObjects:     [ { name, rule, premises, premiseRefs, conclusion } ],
}
```

The CLI prints the report using `formatFoundationReport`. The printed
layout is byte-identical between the JavaScript and Rust hosts so that
parity tests can compare them line-for-line. A typical output:

```text
Foundation report:
  active foundation: default-rml
  description: Default RML foundation: host-implemented configurable kernel
  numeric domain: decimal-12
  truth domain: default-truth

host-primitive:
  - +
  - -
  - *
  - /
  - <
  - <=
  - =
  - !=
  - Pi
  - Prop
  - Type
  - apply
  - avg
  - beta-reduction
  - canonical-printer
  - lambda
  - max
  - min
  - product
  - probabilistic_sum
  - ...

user-configurable:
  - and
  - both
  - false
  - neither
  - not
  - or
  - true
  - truth-range
  - undefined
  - unknown
  - valence

external-trusted:
  - atp-trusted
  - lino-parser
  - smt-trusted

semantic statuses:
  host-trusted: +, -, *, /, <, <=, =, !=, Pi, Prop, Type, ...
  links-described: proof-object, proof-rule-declaration, self.evaluator, ...
  links-checked: proof-checking-relation, rule-application-check, ...

foundations:
  - boolean-links — links-defined two-valued Boolean logic via finite truth tables
      numeric domain: boolean-zero-one
      truth domain: boolean-two-valued
      truth tables: and(4 rows), not(2 rows), or(4 rows)
  - boolean-classical — two-valued-classical-boolean-logic
      numeric domain: boolean-zero-one
      truth domain: two-valued
      defines: and=min, or=max, both=min, neither=product
  - default-rml — Default RML foundation: host-implemented configurable kernel
      numeric domain: decimal-12
      truth domain: default-truth
  - kleene-three-valued — strong-kleene-three-valued-logic
      numeric domain: real-unit-interval
      truth domain: three-valued
      defines: and=min, or=max, both=min, neither=product
```

The structured form is also useful in programs:

```js
import { Env } from 'relative-meta-logic';

const env = new Env();
env.enterFoundation('boolean-classical');
try {
  const report = env.foundationReport();
  console.log(report.activeFoundation); // 'boolean-classical'
} finally {
  env.exitFoundation();
}
```

```rust
use rml::{Env, format_foundation_report};

let mut env = Env::new(None);
env.enter_foundation("boolean-classical").unwrap();
let report = env.foundation_report();
assert_eq!(report.active_foundation, "boolean-classical");
println!("{}", format_foundation_report(&report));
env.exit_foundation();
```

## 5. Bundled foundations

Five alternative foundations ship in [`lib/self/foundations.lino`](../lib/self/foundations.lino)
and are pre-seeded by the JS and Rust hosts:

- **`boolean-links`** — two-valued Boolean logic over the strict carrier
  `{0,1}`. `and`, `or`, and `not` are selected from finite truth-table
  rows, so the active implementation descriptors for those operators
  are `links-defined` with `semanticStatus: "links-checked"` while the
  foundation is active.
- **`boolean-classical`** — two-valued classical Boolean logic. `and`
  becomes `min`, `or` becomes `max`, `both` collapses to `min`, and
  `neither` to `product`. The numeric domain field is set to
  `boolean-zero-one` so the trust report records the intended carrier.
  These bindings still use host aggregator implementations.
- **`kleene-three-valued`** — Strong Kleene three-valued logic.
  Same `min`/`max` operator shape as classical, but the truth domain is
  `three-valued` and the numeric domain is the real unit interval; the
  midpoint `0.5` represents `unknown`. These bindings also use host
  aggregators.
- **`typed-kernel-links`** — links-defined typed-kernel fragment. The
  four rules `pi-formation`, `lambda-introduction`,
  `application-elimination`, and `beta-conversion` are recorded as
  `(root-construct … links-defined …)` and replayed through
  `(check-proof …)` from
  [`examples/typed-kernel-links.lino`](../examples/typed-kernel-links.lino).
- **`nat-links`** — links-defined Peano naturals. PR #178 extended
  the original five Peano rules into a twelve-rule fragment that
  exercises the full inductive layer the issue's Software Foundations
  reference uses. The `(foundation nat-links …)` registration's `uses`
  list now contains, alphabetically: `nat-add-succ`, `nat-add-zero`,
  `nat-cong-succ`, `nat-eliminator`, `nat-equality`, `nat-induction`,
  `nat-mul-succ`, `nat-mul-zero`, `nat-recursion`, `nat-refl`,
  `nat-succ-formation`, `nat-zero-formation`. Highlights:
  - `Nat`, `zero`, `succ` are inhabited / introduced by
    `nat-zero-formation` and `nat-succ-formation`.
  - Addition and multiplication are reduced by `nat-add-zero` /
    `nat-add-succ` / `nat-mul-zero` / `nat-mul-succ` — recursive
    definitions, no `succ → +1` shortcut.
  - Induction is performed by `nat-induction` (with explicit
    `?P at ?n` / `forall` / `implies` triplets); `nat-recursion` and
    `nat-eliminator` are the matching recursor and dependent
    eliminator.
  - Equality is the `nat-equality` layer with `nat-refl` and
    `nat-cong-succ`. The literal `nat-equals` keeps the trust audit
    able to tell the links-defined layer apart from `=` /
    `numeric-equality`; programs that do not opt into `nat-links`
    keep the host's decimal-12 equality unchanged.
  - A links-evaluated normalizer `(eval-nat <term>)` is available
    (§9b) for closed Peano terms over
    `zero | (succ T) | (add T T) | (mul T T)`. It dispatches through
    the active links-level Peano computation rules, so removing or
    replacing `nat-add-zero`, `nat-add-succ`, `nat-mul-zero`, or
    `nat-mul-succ` changes evaluation. Rendering the resulting normal
    form as a host number is reported separately.
  - Replayed end-to-end by
    [`examples/nat-links.lino`](../examples/nat-links.lino) and
    pinned in `examples/expected.lino`. The strict-mode audit
    `(strict-foundation pure-links)` reports zero E065 diagnostics
    against the full file — see §8.

The example [`examples/foundation-boolean-kleene.lino`](../examples/foundation-boolean-kleene.lino)
exercises the Boolean/Kleene foundations in one file and shows the
default semantics being restored after each scope. A minimal
single-operator showcase lives in
[`examples/foundation-with-min.lino`](../examples/foundation-with-min.lino).

## 6. Carrier enforcement: `(carrier ...)` and `(strict-carrier)`

A foundation can declare which values it considers legal with
`(carrier ...)`. By itself this is informational — the trust audit
surfaces the carrier, but evaluation is not changed. Adding
`(strict-carrier)` opts the foundation into runtime enforcement: a
query result or probability assignment that falls outside the carrier
emits an `E063` diagnostic rather than being silently clamped or
returned.

```lino
(foundation bool-strict
  (description "two-valued classical, enforced")
  (carrier true false)
  (strict-carrier)
  (defines and min)
  (defines or max))

(a: a is a)
((a = true) has probability 0.5)

(with-foundation bool-strict
  ; E063: 0.5 is not in {true=1.0, false=0.0}
  (? (a = true)))
```

Symbolic carrier members (`true`, `false`, `unknown`) resolve through
`env.symbol_prob` at activation time, so the same foundation works
whether `true`/`false` are bound to `{0,1}` or `{0.0, 1.0}` or `{0, 0.5,
1}`. Numeric literals stay literal.

## 7. Truth tables: `(truth-table ...)`

Operators can also be rebound to a finite truth table written in
`.lino`. This is the smallest implemented path to a legacy
`links-defined` operator: the rows are links data, and matching rows do
not consult a host aggregator while the foundation is active. The active
implementation also reports `semanticStatus: "links-checked"` because
the host still performs table lookup against those rows. It is not a
self-hosted evaluator.

```lino
(foundation xor-boolean
  (description two-valued-exclusive-or)
  (carrier 0 1)
  (strict-carrier)
  (truth-table xor
    (1 1 -> 0)
    (1 0 -> 1)
    (0 1 -> 1)
    (0 0 -> 0)))

(with-foundation xor-boolean
  (? (1 xor 0)))
```

Partial tables are allowed: rows that don't match fall through to the
previously installed operator, which may be host-backed. The symbolic
constants are resolved through `env.symbol_prob` on activation, just
like `(carrier ...)`. Under `(strict-foundation pure-links)`, that
fallback remains visible as a `truth-table-fallback` dependency unless
the table is total over the foundation's `(strict-carrier)` set. This is
why the bundled `boolean-links` foundation can pass strict mode, while a
partial table still reports the host-backed fallback path.

## 8. Pure-links strict mode

The `(strict-foundation pure-links)` form (paired with optional
`(allow-host-primitive ...)` whitelists) is the strict checking mode
described in the original roadmap. While active, any query that
transitively depends on a `host-primitive` or `host-derived` construct
not on the whitelist raises `E065`. The dependency graph in the trust
audit drives the check. The scanner reports concrete paths through the
active implementation map and the root-construct `depends-on` graph,
for example `and -> avg -> host-primitive`.

```lino
(strict-foundation pure-links)

(a: a is a)
(b: b is b)
((a = true) has probability 1)
((b = true) has probability 0)

; E065: default `and` depends on the host `avg` aggregator:
;       and -> avg -> host-primitive
(? ((a = true) and (b = true)))

; OK: the active implementation of `and` is a truth-table row set
; recorded as links-defined / links-checked.
(with-foundation boolean-links
  (? ((a = true) and (b = true))))
```

`(allow-host-primitive <name>...)` whitelists exact construct or
dependency names. For example, allowing `avg` permits the default
`and -> avg -> host-primitive` path, while allowing an unrelated
ancestor does not.

The strict mode is *opt-in*; nothing about its presence in the host
changes the behaviour of a file that does not use it. The dependency
graph is also rendered in `formatFoundationReport` so the user can see,
before flipping the strict switch, exactly which constructs would need
to be whitelisted.

## 9. Experimental profiles: `mtc-anum`

A pre-seeded experimental foundation `mtc-anum` ships with both hosts.
It is **never** activated implicitly — `default-rml` stays the active
foundation on every fresh `Env`. The profile carries an `[experimental]`
tag, a root symbol `∞`, and four "abits" (atomic bits): `[`, `]`, `0`,
`1`. Together those four characters form a self-contained serialization
alphabet for arbitrary `Node` values. It is descriptive metadata plus
encode/decode helpers, not a replacement evaluator, proof checker, or
minimal trusted kernel.

```text
mtc-anum [experimental] — minimal-trust-core experimental anum profile
    root: ∞
    abits: [=start-of-meaning, ]=end-of-meaning, 0=leaf-tag, 1=list-tag
```

The companion helpers `encodeAnum` / `decodeAnum` (JS) and
`encode_anum` / `decode_anum` (Rust) round-trip `Node` values through
that four-character alphabet:

```js
import { encodeAnum, decodeAnum, parseLino } from 'relative-meta-logic';

const node = parseLino('(? (1 + 2))')[0];
const wire = encodeAnum(node);
// wire is a string drawn only from [ ] 0 1
const back = decodeAnum(wire);
// back deepStrictEqual node
```

Encoding rules:

- Leaf: `[0` + UTF-8 bytes as MSB-first 8-bit groups + `]`
- List: `[1` + concatenation of child encodings + `]`

Decoding rejects characters outside the four-abit alphabet, unbalanced
frames, and leaf payloads that are not byte-aligned, all with `E066`.

## 9b. `(eval-nat <term>)` — links-evaluated Peano fragment

`(eval-nat <term>)` normalizes a closed Peano term to its canonical
Peano normal form by dispatching through the active links-level
computation rules. The recognised vocabulary is exactly
`zero | (succ T) | (add T T) | (mul T T)`. The normalizer consumes
`nat-add-zero`, `nat-add-succ`, `nat-mul-zero`, and `nat-mul-succ`;
removing one from the active foundation makes the corresponding
evaluation fail, and replacing one changes the result.

```lino
(eval-nat zero)                                # → 0
(eval-nat (succ (succ zero)))                  # → 2
(eval-nat (add (succ zero) (succ zero)))       # → 2 via nat-add-succ; nat-add-zero
(eval-nat (mul (succ (succ zero)) (succ zero)))# → 2 via nat-mul-succ; nat-mul-zero
```

Anything outside the recognised grammar raises `E067`. The semantic
result is the Peano normal form; the numeric value returned in the
legacy result stream is the separate host-derived renderer
`nat-normal-form-to-host-number`. `(eval-nat …)` and
`eval-nat-normalize` therefore carry `semantic-status:
links-evaluated`, while the renderer and the structural matcher remain
visible host boundaries in reports and traces. Under
`(strict-foundation pure-links)`, programs that need the legacy numeric
result stream should explicitly allowlist
`nat-normal-form-to-host-number`; the normalizer itself still dispatches
through links-level Peano rules rather than host arithmetic.

## 9c. `(proof-report <name>)` — per-proof dependency / trust report

`(proof-report <name>)` returns a structured snapshot of an
already-registered `(proof-object …)`, listing every assumption,
axiom, or earlier proof object the named proof transitively depends
on, together with the proof rule it applies and the active
foundation. It is the per-proof analogue of `(foundation-report)`.

```lino
(rule nat-succ-formation
  (premise (?n has-type Nat))
  (conclusion ((succ ?n) has-type Nat)))

(axiom zero-is-nat (judgement (zero has-type Nat)))

(proof-object one-is-nat
  (applies nat-succ-formation)
  (premise-by zero-is-nat)
  (conclusion ((succ zero) has-type Nat)))

(proof-report one-is-nat)
```

The report is a small associative network: the proof object as the
root, the applied rule, and a flat list of dependency edges by name.
See `docs/META-THEORY-MAPPING.md` §3 for how the structure maps onto
the meta-theory's doublets and triplets.

## 10. Status of the broader programme

The issue #97 roadmap is implemented where the work could stay
backward-compatible and inspectable. The remaining self-hosting boundary
is still explicit: truth-table lookup, substitution, alpha-renaming,
normalization, conversion, and proof-rule matching are performed by the
host, while the selected tables, proof rules, proof-checking relations,
and derivations are links data.

- **Phase 1 — inventory + reporting + scoped overrides.** Implemented.
  See §2 (registry), §4 (`foundation-report`), §3 (`(with-foundation ...)`).
- **Phase 2 — equality and numeric-domain separation.** Implemented:
  `structural-equality`, `numeric-equality`, `assigned-equality`, and
  `definitional-equality` are distinct entries with their own
  `depends-on`, and query proof/provenance output reports the equality
  layer used.
- **Phase 3 — proof-object substrate.** Implemented via proof rules,
  `(assumption ...)` / `(axiom ...)`, `(proof-object ...)`, and
  `(check-proof ...)`. Premises must cite an assumption, axiom, or
  earlier proof object using `(premise-by ...)` / `(uses ...)`;
  unjustified raw premises raise `E064`. PR #176 adds
  `examples/proof-checking-relation.lino`, which represents a
  nontrivial proof-checking judgement as links-level rule data and marks
  it `links-checked`.
- **Phase 4 — links-defined finite logics.** Implemented. See the
  bundled `boolean-links` truth-table foundation (§5), the
  `(truth-table ...)` clause (§7), and `(carrier ...)` +
  `(strict-carrier)` (§6). The older `boolean-classical` /
  `kleene-three-valued` foundations remain host-aggregator examples.
- **Phase 5 — links-defined type/proof kernel fragment.** Implemented
  as a small object-level fragment. `examples/typed-kernel-links.lino`
  declares `pi-formation`, `lambda-introduction`,
  `application-elimination`, and `beta-conversion` as proof-substrate
  rules and replays a typed identity derivation through
  `(check-proof ...)`. The default host typed kernel remains available
  for legacy programs. Substitution, alpha-renaming, freshness,
  definitional equality, normalization, and conversion remain explicit
  `host-trusted` boundaries in the report.
- **Phase 6 — pure-links checking mode.** Implemented. See §8.
- **Phase 7 — dependency-graph traversal.** Implemented for trust
  reporting and strict-mode enforcement paths.
- **Phase 8 — bundled `(carrier ...)` / `(strict-carrier)` /
  `(truth-table ...)`.** Implemented (§6, §7).
- **Phase 9 — experimental profiles (`mtc-anum`).** Implemented as an
  opt-in serialization profile (§9) plus a links-defined MTC theory
  fragment in `examples/mtc-anum-theory.lino`. The profile publishes the
  four-abit alphabet and `encodeAnum` / `decodeAnum`; the companion
  theory declares MTC rules and replays a composite proof. It does not
  replace the default RML foundation.
- **Phase 12 — links-defined Peano naturals.** Implemented as a
  fifth bundled foundation (§5). `examples/nat-links.lino` declares
  twelve rules — `nat-zero-formation`, `nat-succ-formation`,
  `nat-add-zero`, `nat-add-succ`, `nat-mul-zero`, `nat-mul-succ`,
  `nat-induction`, `nat-recursion`, `nat-eliminator`, `nat-refl`,
  `nat-cong-succ`, and the dedicated equality layer `nat-equality` —
  as proof-substrate data and replays inhabitants
  `zero`, `(succ zero)`, `(succ (succ zero))`, the additions /
  multiplications, equality reflexivity / successor congruence, an
  induction conclusion, and several Software-Foundations-style
  theorems through `(check-proof …)`. Successor is a literal
  constructor; there is no `succ → +1` host shortcut. Closed Peano
  terms can additionally be normalized by `(eval-nat <term>)` (§9b);
  the normalizer dispatches through `nat-add-zero` / `nat-add-succ` /
  `nat-mul-zero` / `nat-mul-succ` without delegating to host
  arithmetic and is reported as `semantic-status:
  links-evaluated`. Strict mode (`(strict-foundation pure-links)`)
  runs cleanly over the full file: zero E065 diagnostics are emitted
  for the Nat fragment. The default host numeric and equality
  layers are unaffected — this phase adds the inductive substrate
  the issue's Software Foundations reference uses, not a replacement
  numeric domain.

Everything in this document is the *backward-compatible* surface. The
strict modes (`(strict-carrier)`, `(strict-foundation pure-links)`) are
opt-in; nothing about their existence changes the behaviour of files
that do not use them.

## 11. Relationship to other documents

- [`CONFIGURABILITY.md`](./CONFIGURABILITY.md) — what is reconfigurable
  *inside* a single foundation (range, valence, aggregator selection,
  operator composition).
- [`SOUNDNESS.md`](./SOUNDNESS.md) — the trusted kernel guarantee. The
  status fields on the registry are the granular version of the
  "trusted base" listed there.
- [`KERNEL.md`](./KERNEL.md) — typed kernel rules. The registry's
  `Type`, `Prop`, `Pi`, `lambda`, `apply`, `beta-reduction`,
  `substitution`, and `freshness` entries correspond one-to-one to the
  rules in that file.
- [`DIAGNOSTICS.md`](./DIAGNOSTICS.md) — full error-code table,
  including `E060`–`E066` for foundation forms, carrier enforcement,
  proof-object replay, pure-links strict mode, and MTC/anum
  encode/decode.
- [`tutorials/self-bootstrap.md`](./tutorials/self-bootstrap.md) — the
  capstone walkthrough; foundations slot in beside the encoded grammar,
  evaluator, types, operators, and metatheorem checker.
- [`case-studies/issue-97/`](./case-studies/issue-97/) — the deep
  case-study analysis behind this surface, including the requirements
  extracted from issue #97, the root-cause analysis, the test plan, and
  links to the captured GitHub data.
- [`META-THEORY-MAPPING.md`](./META-THEORY-MAPPING.md) — maps the
  issue-#97 constructs (Peano naturals, proof objects,
  rule-application, inductive closure, trust-report graph) to the
  references / links / doublets / triplets vocabulary of
  [Links Theory (meta-theory)](https://github.com/link-foundation/meta-theory).
