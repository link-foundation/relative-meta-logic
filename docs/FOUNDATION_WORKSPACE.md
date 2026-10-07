# Relative foundation workspace

The JavaScript `FoundationWorkspace` in `js/src/rml-foundation-workspace.mjs`
and Rust `rml::foundation_workspace::FoundationWorkspace` load linked programs,
versioned foundation packages and theory instances through public APIs. The
fixture `test-corpus/foundations/foundation-context.lino` supplies a previously unseen signed
feedback logic entirely in Links; neither runtime has a case for that logic.

## Packages and query context

A `(linked-foundation NAME (version VERSION) ...)` selects ordinary linked
programs by role, can depend on other named/versioned packages, and declares a
signature and a cycle policy. Multiple versions can be loaded together. An
unversioned reference is rejected when it is ambiguous. The name/version pair is
an identity, so delimiter characters in names or versions cannot alias another
package. The lower-level workspace uses globally unique program names. Independent
source-package namespaces and explicit versioned imports are provided by
[`FoundationPackages`](FOUNDATION_PACKAGES.md). Dynamic package fetching is
not provided.

Every `ask` result includes the selected instance, theory and rebindings,
foundation name/version, the complete assumptions for that query, cycle policy,
bounds, dependency evidence and observed host operations. Assumptions are copied
and local to the query: asking another instance or another version does not
inherit them. A result's `dependencies.assumptions` may be narrower than its
complete `assumptions` list when its established evidence is independent of the
other assumptions.

Every `execute` result, including an exhausted or unsupported reduction, now
also includes `theory`, `assumptions`, `cyclePolicy` and `bounds.maxSteps` (Rust
`theory`, `assumptions`, `cycle_policy`, `bounds.max_steps`). Rewriting introduces
no logical assumptions, so its `assumptions` list is explicitly empty. This is
additive to the existing execution fields and does not change method arguments.

## Guarded evidence on both sides

The inductive policy admits finite derivations. A guarded-coinductive policy
names inference/typing rules that may close a cycle. For an underived ground
judgement, the workspace temporarily assumes that judgement and searches for a
proof ending in a declared guard. Every use of the hypothesis in that proof is
therefore below the final guard. A rule that merely loops without a declared
guard cannot close the proof.

This search applies independently to a query and its foundation-defined
refutation. The query's hypothetical evidence is never supplied to the
refutation search, or vice versa. An already established proof on one side does
not prevent the other side's guarded search. This matters for all three cases:
both sides coinductive, an inductive refutation with a coinductive query, and an
inductive query with a coinductive refutation.

The top-level `coinduction` field describes the query's guarded attempt.
`refutation.coinduction` separately describes the refutation's attempt. Each
carries its actual hypothesis, guards, search termination and evidence status.
Proofs retain labelled hypothesis leaves and the original guard program/rule;
dependency invalidation includes rules used by either proof.

This is a bounded, single-hypothesis, final-guard proof search. It does not claim
completeness for arbitrary coinduction, mutual invariant synthesis or all
formal systems. A foundation's declaration grants the guard policy; the runtime
does not derive its intrinsic authority from bare links. Signatures, package
loading, search orchestration and result classification remain host mechanisms.

## Outcomes and bounds

- `proved`: a query proof was found.
- `refuted`: the foundation-defined refutation was proved and this search did
  not find a query proof. This is not a certificate of consistency.
- `contradictory`: both proofs were found and retained.
- `unknown`: no proof was found after the applicable searches saturated.
- `exhausted`: a search/normalization bound stopped work without proving either
  side. It is distinct from unknown and falsity.
- `unsupported`: the signature or supported normalization/search mechanism
  cannot handle the query; this also is not falsity.

Established evidence is retained even if the search for the opposite side
exhausts. For example a result can be `proved` while its refutation reports
`not-derived-within-bounds`; that result must not be read as proving absence of
contradiction. Coinductive refutation can report
`guarded-coinductive-refutation`, and bounded guarded searches report their own
`guarded-fact-limit` or `guarded-inference-limit` reason. An unsupported guarded
refutation is explicitly labelled `unsupported`.

## Reproduce

JavaScript:

```sh
node --test js/tests/foundation-context.test.mjs js/tests/foundation-workspace.test.mjs
```

Rust:

```sh
cargo test --manifest-path rust/Cargo.toml --test foundation_context_tests --test foundation_workspace_tests
```

Both context test files load exactly the same Links fixture and exercise the
public direct-structural and default closed S/K runtimes. The existing package
suite additionally covers inherited foundation roles, ambiguity rejection,
rebinding, contradiction isolation and resource/probability examples. These
focused tests are not a substitute for the repository's full acceptance gate or
the broader unresolved requirements in issue 183.

## Linked probability and confidence policies

`lib/foundations/confidence.lino`, loaded after `lib/foundations/packages.lino`,
adds two versions of `confidence-estimation`. The shared example is
`test-corpus/foundations/confidence-context.lino`. Both versions use ordinary
linked programs and the existing workspace API; no host callback or named
logic branch implements their arithmetic or inference.

An observation is
`(observation SOURCE STATEMENT (ratio P Q) (ratio C D))`. Its derived record is
`(estimate STATEMENT (probability ...) (confidence ...) (depends (source SOURCE)))`.
A joint estimate retains the source dependency tree as links. The proof also
retains the original observations, the joint dependency declaration and the
independence assumptions, so it can be invalidated rather than merely keeping
a decorative source label.

Both versions multiply event probabilities only when an explicit
`(independent-events LEFT RIGHT)` assumption is available. Version 1 combines
confidence scores by minimum. Version 2 multiplies confidence scores and needs
a separate `(independent-confidence LEFT RIGHT)` assumption. Event independence
alone does not authorize multiplying confidence scores. Minimum is a selected
scoring policy, not a claimed probability lower bound. Neither version verifies
empirical independence or calibrates the supplied observations.

Probability and confidence are separately validated rationals between zero and
one with positive denominators, calculated by linked unary arithmetic. Invalid
observations remain available for inspection as `checked-observation` links with
`no` validation fields, but do not produce estimates. A proved estimate means
the record follows under the selected policy. Even probability one does not
produce a proof of `(holds STATEMENT)`, and confidence zero does not refute it.
Rationals retain their computed numerators and denominators; canonical fraction
reduction is not claimed.

`revise` supports rechecking a changed observation probability, observation
confidence, independence assumption, theory dependency or linked combination
rule. Unrelated ground evidence can remain valid, and a policy change in one
package version does not affect a different version's isolated program closure.
The join is factored into linked intermediate judgements with at most two
premises per rule rather than implemented as a host aggregation operation.

Run the mirrored confidence tests:

```sh
node --test js/tests/confidence-context.test.mjs
cargo test --manifest-path rust/Cargo.toml --test confidence_context_tests
```

The full joint-estimation and mutation witnesses use the public direct-structural
basis. The default closed S/K basis is separately checked for source-estimate
proofs, linked policy execution and explicit bounded exhaustion. Joint estimation
is expensive on the closed basis: the sample exceeded its default 100-million
contraction budget during verification. This is a reported execution bound,
not a false/unknown result or a claim of whole-product closure.

`test-corpus/foundations/expected.json` is shared by both native test suites for
signed-foundation outcomes and confidence-combination values. These dedicated
workspace fixtures are separate from the legacy evaluator's root corpus.
