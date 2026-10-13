# General orientation and consequence independence results

**Status: R147 and R148 remain partial.** The finite foundation-search experiments
now have 42 corresponding or supporting theorems checked independently in Lean
4.28.0 and Rocq 9.1.1. The proofs quantify over arbitrary carriers and
transformation families; none is an inference from the size of an enumeration.
Every theorem is closed under its kernel's global context, with no additional
axioms, classical choice, proof holes, external libraries, or trusted native
computation. They establish conditional independence and obstruction results,
not a link-derived consequence law or a complete ontology of Links.

Sources:

- [R147's original continuation/consequence request](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5821335636)
- [R148's original orientation and strongest-no-go request](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5823272578)
- [The full-closure gate retaining both requirements](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5836717056)
- [The subsequent open-requirement reconciliation](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5856764556)

The exact original wording and hashes remain in
[`requirements.sources.json`](requirements.sources.json) and the frozen manifest.
This additive investigation does not rewrite their historical evidence or status.

## What the general no-go actually says

Let `X` be a type of observed structures, `Y` a type of candidate outputs, and
`G` a family of transformations, acting on both. A selector `f : X → Y` is
**equivariant** when `f(g·x) = g·f(x)`. For one fixed structure, this specializes
to selecting an output fixed by its automorphisms. We require no finite carrier,
finite list of transformations, group multiplication, or choice principle.

Let `J : Y → Y` reverse the output. If `J(g·y) = g·J(y)`, then `J ∘ f` is also
equivariant. If `J(f(x)) ≠ f(x)` somewhere, it is a distinct selector. The proof
of this statement does not even need involutivity. To show equal stabilizers
and the correspondence between the two output orbits, the additional hypothesis
`J(J(y)) = y` is used explicitly.

A further criterion `C` cannot uniquely determine a nondegenerate output **if
that criterion is also closed under reversal**: `C(f)` must imply `C(J ∘ f)`.
The theorem `reversal_closed_criterion_has_alternative` names this hypothesis;
it is not inferred from the word “structural.” This is the exact general
non-uniqueness result supported by the commuting-reversal argument.

For the current candidate outputs, `Y = A × A` and `J(a,b) = (b,a)`.
`reverse_pair_commutes` proves commutation with every pointwise address map,
with or without uniform slot reversal. It therefore covers arbitrary address
renamings and arbitrary substitutions; the map need not be injective. Distinct
endpoints are separately required to obtain a distinct reverse output. The
proof applies to any structure whose declared transformation action on outputs
has this form, irrespective of that structure's size, chirality, or rigidity.

### Alternatives are not indistinguishability

Equal stabilizers do **not** imply equal orbits, identical candidate predicates,
or absence of intrinsic asymmetry. The kernel-checked `rigidAction` example has
two distinct Boolean candidates and only the identity transformation. Its two
candidates have equal stabilizers and different orbits; the invariant predicate
“this candidate is false” distinguishes them. Output reversal still commutes
with the action. Thus the existence of a reversed equivariant selector does not
prove that every structural predicate is blind to orientation.

Likewise an ordered input pair already admits the equivariant identity readout.
The criterion “output agrees with the named input positions” uniquely fixes that
readout and excludes its reverse on unequal endpoints. This criterion is not
reversal-closed. The unresolved foundational question is whether such an
alignment is independently justified as *consequence*, not whether it can be
stated, is invariant under renaming, or identifies an output.

Accordingly the finite report's label
`EVERY_INTRINSIC_LINK_OBSERVATION_PRESERVED_ORIENTATION_STILL_REVERSIBLE` must be
read only as retaining the input observations while replacing the output
readout. It is **not** a theorem that an automorphism exchanges two separated
candidates, or that all candidate-sensitive observations are identical. This
investigation supplies the precise interpretation; the pinned historical report
is not silently amended.

### The stronger impossibility has stronger hypotheses

`stabilizer_obstruction` proves that no equivariant admissible selector exists
at `x` if some transformation fixes `x` but fixes no allowed output there.
`exchanged_pair_obstruction` specializes it to exactly two distinct candidates
exchanged by an input-fixing transformation. This is an actual nonexistence
result, stronger than non-uniqueness, but its exchanging symmetry must be shown.
It cannot be applied when the candidates have separated orbits or the input is
rigid. No theorem here claims a selector exists on all other structures.

## R147: possible versus following on any carrier

Take an arbitrary type of facts `A`, a predicate `P` recording positive facts,
and let admissible completions be **all** predicates `M` extending `P`.
`positive_facts_only` proves

```
(for every M extending P, M(a))  iff  P(a).
```

The proof uses `P` itself as a countermodel to any purported new consequence.
`every_fact_possible` uses the full predicate as a completion, so every fact is
possible under this contract. These proofs hold for finite or infinite `A` and
arbitrary `P`; the old count of 128 binary completions is one finite instance.

`new_consequence_excludes_base` gives a necessary condition for strengthening
this semantics: if a new fact follows over a chosen class, that class must
exclude the base predicate omitting it. It does not claim that every exclusion
suffices, is oriented, or is justified by Links. `union_consequence` shows that
admitting either of two model classes retains only their common consequences.
`empty_class_is_vacuous` exposes the special case that excluding every model
makes every fact follow, so consistency cannot be omitted from any positive
application of the model-theoretic reading.

These are metatheoretic tools. Quantification over completions is an explicit
investigative semantics, not a new primitive ontology. Formation of a candidate,
its structural identification, admission to a chosen model class, truth in all
such models, and physical or runtime production remain separate. No theorem
constructs, executes, or authorizes a Link-level modus ponens.

## Full-reduct expansion independence

The additional expansion argument removes a limitation of the symmetry argument:
it does not assume equivariance, an output-reversing automorphism, or reversal
closure of every structural selection criterion. Its contract is explicit.

An `Expansion X A` contains the complete structural reduct `x : X` and a
separately interpreted predicate `holds : A → Prop`. For a structural theory
`T : X → Prop` and recorded facts `P : X → A → Prop`, `ExpansionAdmitted T P`
requires exactly `T(x)` and preservation of the recorded positive facts. It
contains **no bridge law identifying `holds` with a particular readout of `x`**.
The semantic predicate is an investigative interpretation, not another proposed
primitive Link entity.

For any such `T`, any `x` satisfying it, and distinct unrecorded facts `a,b`,
`reduct_expansions_orientation_independent` constructs both

```
(x, P(x) ∪ {a})       and       (x, P(x) ∪ {b}).
```

Both expansions satisfy the entire structural theory and preserve every
recorded fact. The first asserts `a` and omits `b`; the second asserts `b` and
omits `a`. Their structural reduct is literally identical.
`same_reduct_all_observations` therefore preserves **every function of that
full reduct**, including candidate-sensitive tests with fixed candidate
parameters, faithful encodings, and recursively or self-referentially carried
record observations. It does not assert that the two candidates themselves
have the same properties. An observation that reads the newly interpreted
`holds` relation is not an observation of the reduct alone.

`no_reduct_readout_of_all_expansions` proves that no single reduct-only readout
can agree with that predicate across all these admitted expansions if even one
fact is unrecorded. This quantifies over every readout, rather than a finite
language of projections. The theorem does **not** say that no invariant or
structurally definable selector exists. Indeed,
`conservative_definition_expands_every_reduct` proves that any chosen definition
that preserves recorded facts can be added without excluding a structural
reduct. Its defining equation can nevertheless exclude other semantic
interpretations: choosing the bridge equation adds information even when the
definition is conservative over Link-only statements.

`RecordedPair` instantiates the facts with ordered endpoint pairs of the full
ternary addressed-record relation. It imposes no size bound and admits arbitrary
extra records, aliases, or self-reference. The concrete
`ordered_chain_expansions_independent` theorem applies it to records
`(3,0,1)` and `(4,1,2)`, with `a=(0,2)` and `b=(2,0)`. The two omission
hypotheses are independently proved. Extra records are covered by the general
theorem whenever both candidates remain unrecorded; if an extra record already
asserts a candidate, that omission premise correctly fails.

This is a complete non-entailment result for the **full-reduct, positive-fact,
no-bridge expansion contract**. It identifies the missing information in that
contract without inferring its absence from output reversal. It is not a proof
that this contract exhausts intrinsic Links semantics. The original reviews
explicitly leave that identification unresolved and prohibit treating the
chosen completion semantics as the foundation. See the
[source-by-source requirement audit](orientation-requirement-audit.md).

## Same observations, faithful encodings, and recursive carriers

`same_observation_nondefinability` states: if two systems have equal values under
`observe`, but `desired` differs, then no readout of that observation can recover
`desired` on every system. It quantifies over **all** readout functions, not a
finite language of position projections. Applying it to the finite audit's
same-observation pair requires keeping its precise observation map. Agreement
on 16 position-law readouts does not become agreement on all Link observations.
The theorem is an information-loss statement and provides no evidence that an
externally stipulated desired orientation is itself necessary.

A faithful encoding has an explicit left inverse, `decode(encode(x)) = x`.
`faithful_encoding_injective` and `faithful_encoding_preserves_distinction` show
that such an encoding cannot merge unequal candidates. Equivariance transports
through an equivariant decoder and encoder; reversal transports only if the
encoder also commutes with the specified reversals. With the two round-trip
laws, `faithful_transport_preserves_alternatives` preserves different readouts
at encoded inputs. These hypotheses can be checked for an actual representation;
“faithful” alone does not imply compatibility with a chosen transformation
family, output alignment, or treatment of malformed representations. The
representation type may be restricted to its valid encoded image.

For a carrier deterministically derived by an equivariant map `d`, decorating
`x` with `(x,d(x))` preserves its stabilizer exactly. Composition of equivariant
maps is equivariant. `recursive_carrier_equivariant` proves this for any finite
number of iterations of an equivariant carrier step, by induction on the
iteration count. Thus repeatedly deriving a carrier in this sense cannot break
a surviving symmetry. The result does not assert that every possible carrier
is so derived, that a self-referential fixed point is unique, or that an
infinite limiting construction exists. Adding independently chosen asymmetric
carrier information falls outside its hypotheses and must expose its provenance.

## Assumptions are tested, not hidden

Besides the general theorems, both source files prove small counterexamples:

| Removed or overstated premise | Kernel-checked counterexample |
|---|---|
| Commutation follows from involutivity | Reversing output slots fails equivariance when the action flips only the first output coordinate |
| Reversal always produces a distinct selector | A diagonal pair is fixed by reversal |
| Equal stabilizers imply no invariant distinction | Identity action on Boolean candidates has disjoint orbits and a distinguishing invariant predicate |
| Every structural selection criterion is reversal-closed | Named ordered alignment is equivariant and excludes reversed unequal endpoints |
| Positive facts force an unrecorded fact under all completions | The recorded predicate itself is an admissible countermodel |
| An empty model class establishes substantive consequence | Universal consequence is vacuous for that class |

The native runner also asks each kernel to prove five intentionally false
claims about those examples. It requires a real type/unification rejection;
missing compilers, signals, timeouts, and unrelated failures are not successful
negative checks. This guards against replacing kernel checking with source-text
or recorded-status inspection.

## Reproduce and inspect

Proof sources and their exact theorem inventory:

- [Lean](../../../test-corpus/orientation-independence/OrientationIndependence.lean)
- [Rocq](../../../test-corpus/orientation-independence/OrientationIndependence.v)
- [Recorded native result](../../../test-corpus/orientation-independence/verification.json)

From the repository root, with Lean 4.34.1 and Rocq 9.3.0 on `PATH`:

```bash
node scripts/run-with-cache.mjs -- node scripts/check-orientation-independence.mjs
node --test scripts/orientation-independence.test.mjs
```

`LEAN` and `ROCQ` can name compiler executables. An explicit
`--languages=Lean` or `--languages=Rocq` runs one kernel; the default requires
both and never silently skips an absent one. The recorded run used Lean 4.28.0
and Rocq 9.1.1, checked all 42 theorems without axioms in each, and rejected all
five false claims in each. The snapshot binds proof-source hashes; the normal
Node tests check its freshness but do not replace native re-execution.

The additive [orientation-proofs workflow](../../../.github/workflows/orientation-proofs.yml)
executes both kernels on relevant pull requests and main-branch updates. It uses
the official Lean 4.34.1/Elan source and an owned Rocq container lifecycle, uploads proof
and cache evidence, and always invokes repository cache teardown. The runner
uses fresh temporary directories and removes compiler outputs even after
failure. No compiled proof artifacts belong in the source tree. The expanded
local record above checks the new proof revision with the installed historical
kernels. This revision requires a fresh hosted run checking all 42 theorem
obligations and all five false claims in each maintained kernel; configuration
tests or the earlier 33-theorem CI result do not certify the additions.

The digest-pinned Docker image supplies the OCaml build environment, not the
accepted proof oracle: on 2026-10-08 its `9.3` and `9.3-rc1` tags had the same
digest. The [installer](../../../scripts/install-rocq-kernel.sh) therefore
installs exact stable `rocq-runtime`, `rocq-core`, and compatibility binaries at
9.3.0, with `rocq-stdlib` 9.2.0, from the official OPAM repository. It rejects a
stale or prerelease compiler. Installation and all Rocq checks run in one owned
container, so the compiler timeout excludes image download and installation.

## Remaining requirement scope

The original R147/R148 requests permit a strong negative result for the
investigated ontology. They do not require proving impossibility for every
future Links ontology, and completing a precisely scoped negative result does
not require fabricating a positive modus ponens.

The positive-completion, reversal-closed-criterion, input-symmetry, and full-
reduct expansion contracts now have general, independently checked negative
results. The expansion argument in particular proves exact non-entailment even
with every structural observation available. Its remaining premise is not a
finite bound: it is that the admitted semantic interpretations have only the
specified recorded-fact constraint and no additional bridge law.

For the full original requirements, a material application gap remains. Either
justify that this is the complete relevant contract for the investigated Links,
or derive the proposed additional bridge/principle from independently justified
Link structure and show why it is authoritative. Merely interpreting the fresh
predicate freely, or choosing a conservative definition of it, cannot settle
that question. The same-reduct pair exhibits different admitted interpretations;
it does not manufacture two independently required consequences. R147 and R148
therefore remain partial, with general negative evidence rather than only finite
audits. Full semantic closure, multiple minimal meta-foundations, and
implementation self-hosting remain separate acceptance gates.
