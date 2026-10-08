# R147/R148: exact-source completion audit

The general proofs complete several negative sub-obligations, including a
full-reduct non-entailment result that needs no symmetry assumption. **They do
not yet complete either original requirement.** The remaining issue is the
applicability of the semantic contract, not a finite enumeration limit or a
demand to disprove every possible future Link ontology.

This audit starts from the proof sources and report at public PR head
`66c6a9431b86fbac0c8edb9f68a80d770352756d`, then adds nine independently checked
expansion theorems. Original source texts and their hashes are preserved in
[`requirements.sources.json`](requirements.sources.json). The ledger remains
unchanged by this additive investigation.

## Original wording and observed evidence

| Source | Required distinction or task | Evidence now delivered | Completion consequence |
|---|---|---|---|
| [5821335636](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5821335636), R147 | Separate formation, identification, consequence, and production; find the minimal independently justified structural fact that eliminates competing interpretations; use genericity, faithful representation, removal, and self-applicability tests. A strong negative is allowed: indistinguishable Link systems with different required consequences. | `positive_facts_only` proves the exact consequence boundary under all positive extensions on any carrier. `new_consequence_excludes_base` proves a necessary exclusion. The expansion theorems fix the entire reduct, preserve every observation of it, and exhibit opposite positive-preserving semantic interpretations. Encoding and recursive-carrier theorems retain their explicit hypotheses. | The negative results are complete for their stated contracts. The two new expansions contain different interpreted consequences; the proof does not independently establish that those consequences are required. No authoritative structural bridge or same-principle applicability witness has been derived. |
| [5823272578](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5823272578), R147/R148 | Investigate where orientation comes from without importing semantic direction; keep completion semantics investigative; distinguish structural asymmetry from a chosen interpretation; test automorphisms, same observations, renaming, faithful representations, and recursive carriers; prove the strongest justified no-go if intrinsic asymmetry is absent. | `reverse_pair_commutes`, `reverse_equivariant`, and `reversal_closed_criterion_has_alternative` give general duality and conditional non-uniqueness. `stabilizer_obstruction` and `exchanged_pair_obstruction` prove nonexistence when an input-fixing symmetry moves every permitted output. `rigid_candidates_separated` and `ordered_alignment_equivariant` refute an unconditional claim that structural selectors cannot exist. The new expansion argument proves non-entailment while keeping all reduct observations available. | No-go is permitted, so a positive intrinsic law is not the only possible completion. But the report must justify which semantic interpretations are admitted. The source does not declare the free-expansion class to be the complete Links ontology and explicitly warns against making a model class the new foundation. |
| [5836717056](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5836717056), R147/R148 and the closure gate | Retain execution, consequence, and orientation authority as open boundaries while pursuing Link-driven semantics and multiple minimal foundations. | Every added semantic predicate is explicitly a metatheoretic interpretation, not a new Link primitive, runtime callback, or delivered modus ponens. | Proof checking discharges mathematical proof obligations; it does not supply Link-level semantic authority or close the separate product/foundation gates. |
| [5856764556](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5856764556), R147/R148 | Continue the foundational investigation with derivations, countermodels, invariants, and precisely scoped no-go results. Do not inflate finite results or invent a positive law to make a status complete. Retain original wording, evidence, versions, status, and gaps. | The original 33 theorems already removed enumeration bounds from conditional results. The additional nine prove full-reduct expansion independence, its concrete ordered-chain instance, and conservative definitional expansion. All 42 are independently checked in both kernels, with five false-claim rejection tests per kernel. | The obsolete description “finite-only negative” should be replaced. The broader original requirements remain partial because the no-bridge premise is not yet justified as the complete relevant semantic contract. |
| [Archived PR body, SHA-256 884aba190dcb…](https://github.com/link-foundation/relative-meta-logic/pull/184), R148 source `pull-184@884aba190dcb` | Describes the finite named/anonymous/unordered audit and retains intrinsic orientation and R147 as open. | The later general proof distinguishes invariant duals from nonexistence of invariant selectors. The new expansion argument avoids inferring unrestricted reversal of semantic assignments from an automorphism calculation. | Preserve the archived wording as historical evidence. Its “never rank them” wording must not be used to claim that every invariant or definable structural criterion is reversal-closed. |

Source body SHA-256 values, in the table's order:

- `d2f4f8ffdf8e127954b0b25cb5e108cfd903c8f0ae837468f9e4462bd7730302`
- `a21c8675015bff6ffc6200c578e677d4a3e7c0890805487a18fddd43af44d48a`
- `1a1c3975ec4485901da57037e5f52b43bd1a66d83ecd695c98ae7e13cfd88ea2`
- `5361a046c55e0b0ef94eb026e7a6be53001f2c7aa4bc7dcad61bf3cb44cecad9`
- `884aba190dcb7a313db7937ddc94212128b99901373d3dcd76891e15653ce3bb`

## What the new full-reduct result establishes

Let `x` contain the entire structural state, `T(x)` contain every structural
constraint being investigated, and `P(x)` give its recorded positive facts.
Admit an interpretation `C` exactly when `T(x)` holds and `P(x) ⊆ C`. This is
the theorem's complete contract; the word “admit” imports no further authority.

For distinct facts `a,b` omitted by `P(x)`, the interpretations `P(x) ∪ {a}`
and `P(x) ∪ {b}` satisfy the same contract. Their reducts are equal, so every
function of the reduct has equal values. This includes every predicate
expressible in a structural language interpreted solely in that reduct. No
restriction to the earlier 16 readouts is needed.

The relation interpreting consequence can differ because the written theory
contains no constraint linking it to a selected structural readout except
recorded-fact preservation. That premise is visible in `ExpansionAdmitted`.
Output reversal is not assumed to preserve an arbitrary semantic theory.
Neither equivariance nor indistinguishability of the candidate pairs is used.

The ordered-chain instance uses the full addressed relation, including record
identities and ordered endpoints. The generic theorem also permits arbitrary
additional or self-referential records, and arbitrary additional structural
constraints, provided the reduct satisfies them and both candidate facts remain
unrecorded. Additional facts that explicitly record a candidate invalidate that
omission premise and are not ruled out.

An independently chosen structural definition can select an orientation.
`conservative_definition_expands_every_reduct` proves that a positive-preserving
definition can be installed without excluding any structural reduct. The added
equation specifying that this definition interprets consequence nevertheless
rules out other semantic interpretations. Conservativity over structural facts
therefore does not make that equation derivable or authoritative.

## The precise unresolved contract obstacle

The current finite experiments expose address equality, incidence, and
contract-dependent slot order. Their implementation also explicitly chooses
what “compatible correspondence” means: commutation with the declared
symmetries. The original reviews do not assert that these are all possible
intrinsic properties of Links, or that compatibility under those symmetries is
sufficient semantic authority. They ask the investigation to establish that
boundary and warn that field positions and the structure/transformation split
may themselves be representational choices.

The expansion theorem does prove that **a reduct-only theory plus positive-fact
preservation does not entail a further unrecorded semantic assertion**. It does
not prove that no independently justified Link principle supplies a bridge
between that theory and consequence. Interpreting a fresh predicate freely
cannot establish that absence; it exposes exactly where the premise is used.
Conversely, the existence of a definable selector does not establish its
consequence authority.

There is no remaining bounded proof hole that can honestly be filled by
dropping `ExpansionAdmitted`'s restriction or declaring every semantic bridge
inadmissible. Doing either would assume the conclusion under investigation.
The next closure witness must justify the completeness of the investigated
no-bridge contract, or independently derive the added semantic bridge and its
applicability. This need concerns the investigated Links contract, not every
future ontology.

Recommended ledger descriptions:

- R147: Partial — general positive-completion and full-reduct non-entailment
  proved; authoritative consequence contract remains unresolved.
- R148: Partial — general duality, symmetry obstruction, and full-reduct
  expansion independence proved; applicability to intrinsic consequence
  orientation remains unresolved.

## Verification and delivery boundary

The unchanged public base had 33 theorems and four rejected false claims per
kernel. The new sources have 42 theorems and five rejected false claims per
kernel. The additional negative test attempts to assert the forward fact in
the explicit reverse expansion of the ordered chain and must fail by a real
kernel type/unification error.

The new proof sources were checked with installed Lean 4.28.0 and Rocq 9.1.1;
both kernels reported every theorem closed without additional axioms. The
recorded result binds both source hashes. The local compatibility run used a
temporary copy of the runner with those historical version pins; the maintained
runner still strictly requires Lean 4.34.1 and stable Rocq 9.3.0. The temporary
copy was removed after verification. Eight Node contract tests also passed.

Hosted verification now passes at commit
`8cf2af665adaa94b8f25f5ca33b81cbe22f0a75b` under the maintained versions:
[Lean 4.34.1](https://github.com/link-foundation/relative-meta-logic/actions/runs/37831346895/job/113497183331)
and [Rocq 9.3.0 with stdlib 9.2.0](https://github.com/link-foundation/relative-meta-logic/actions/runs/37831346895/job/113497182980).
The PR head and CI merge revision contain identical proof source bytes. Their
SHA-256 values are `2728113d0332f4a7eb5ccc35d043044f0a5f8b940846be6d094d5145bc32126d`
for Lean and `9e4e5ddc7af370c35e729e52eff72a4440b4c6af76e4b8c1622810faf2fc80b8`
for Rocq.

Each successful checker invocation requires all 42 named theorems to compile
without added axioms and all five false claims to fail with the expected proof
diagnostics. This establishes the maintained-toolchain check of 84 theorem
instances and 10 negative controls. Those counts follow the exact source
inventory and successful checker contract; the archived JSON artifacts were
not separately inspected. The proof scope and unresolved applicability
contract above are unchanged, so R147 and R148 remain partial.
