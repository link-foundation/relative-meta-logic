# General orientation and consequence independence results

**Status: R147 and R148 remain partial.** The finite foundation-search experiments
now have 33 corresponding or supporting theorems checked independently in Lean
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

The native runner also asks each kernel to prove four intentionally false
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
and Rocq 9.1.1, checked all 33 theorems without axioms in each, and rejected all
four false claims in each. The snapshot binds proof-source hashes; the normal
Node tests check its freshness but do not replace native re-execution.

The additive [orientation-proofs workflow](../../../.github/workflows/orientation-proofs.yml)
executes both kernels on relevant pull requests and main-branch updates. It uses
the official Lean 4.34.1/Elan source and owned Rocq 9.3 Docker lifecycle (pinned image digest, with an exact 9.3.0 compiler-version check), uploads proof
and cache evidence, and always invokes repository cache teardown. The runner
uses fresh temporary directories and removes compiler outputs even after
failure. No compiled proof artifacts belong in the source tree. The historical local record above remains unchanged. The updated toolchain
configuration requires a fresh hosted run checking all 33 theorem obligations
and all four false claims in each kernel; configuration tests alone do not
certify compatibility with the newer compilers.

## Remaining requirement scope

R147 still requires an independently justified structural fact that makes a
continuation follow, with its applicability and authority accounted for.
R148 still requires either an intrinsic, independently justified source of
orientation or a stronger impossibility theorem for an independently justified
complete observation contract. The present results generalize the tested
negative boundaries but cannot establish that the adopted observation contract
is complete, that all legitimate criteria are reversal-closed, or that all
possible link ontologies lack an intrinsic distinction. Full semantic closure,
multiple minimal meta-foundations, and implementation self-hosting are separate
open acceptance gates.
