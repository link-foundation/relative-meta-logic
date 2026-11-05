# Structural evidence scope review: R128 and R138–R142

This review binds existing computations and new adversarial tests. It does not
replace any of the 164 original obligations or change their source mappings.
The source of every row was read in full from the pinned `sourceSnapshot`, not
inferred from the historical “Complete for…” label. Completion is proposed only
for the R128 preservation guard and the atomic R138 classification request.
R139–R142 remain partial, with no completion bindings.

The new `structural-foundation-evidence` suites name positive and negative tests
separately in JavaScript and Rust. They call the live ontology computation once
per process and test the actual certificate verifier against a shared,
independently specified 15-case corpus. The corpus uses addresses different from
the report's built-in examples. No table of report status strings substitutes
for the numeric invariants, exact countermodels, or input mutations.

## R128: preserve the boundary and the information

Original source: [audit 5791257637](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5791257637), G7's second bullet. Other G1–G8 clauses retain their separate requirement IDs.

The requirement is a preservation guard, not a demand that occurrence
permutation or intrinsic slot identity be proved. The bound tests check:

- Ordered address-equality classes `2/5/15/52`, unlabelled classes `2/4/7/12`,
  and the extra `0/1/8/40` collapses introduced by occurrence permutation.
- The exact `[0,0,1]` direct-self versus `[0,1,2]` fresh-address countermodel,
  whose reference-only projection agrees but whose addressable classes differ.
- `[0,0,1]` versus `[0,1,0]`, which cannot be identified by address renaming
  alone, and whose ordered self-incidence masks differ.
- Preserved arities, the complete finite ordered descriptor, and the indirect
  cycle witness supplied by the R139 positive test.
- Explicit contract-relative renaming, unestablished occurrence permutation,
  and the absence of claims deriving endpoint roles, dynamics or execution.

These satisfy the normalized guard. They do not complete R71/R73/R74/R127 or
prove that an unobserved intrinsic feature is impossible.

## R138: classify each reference slot

Original source: [comment 5796435750](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5796435750): “Classify self-incidence per reference slot.”

The public generic helpers compare every reference with its link address. Seven
mirrored tests cover all Boolean masks through eight slots, arity 4096,
injective renaming to numbers and strings, positional information lost by
counting, noninjective mutation, missing addresses, and the finite descriptor's
contract boundary. The missing-address Rust test catches and inspects the
panic so the strict producer sees its canonical test name.

The later [review 5799100000](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5799100000) says not to assign meanings to the masks and starts a broader investigation. The helper assigns no meanings; that broader investigation remains R139/R127 rather than silently becoming completed by R138.

## R139: shared-address progress, remaining assumption audit

Original source: [review 5799100000](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5799100000).

The exact external configuration `[[0,1],[2,3]]` and cycle
`[[0,2],[2,0]]` have equal local descriptors but cycle lengths zero and two.
Shared classes `2/10/77/799` exceed local products `2/4/8/16`; each shared
class has a faithful cross-link descriptor. Fibre totals are checked against
the live enumeration. The countermodel removes single-link isolation and the
report distinguishes contract forcing, representation stability, observer
choices and unassigned semantics.

The request also says to audit and vary remaining assumptions individually.
Finite size, ordered records, fixed one-reference arity, distinct identities and
equality-only observation are still retained restrictions. A single removal
experiment does not satisfy that full clause. Status: partial; completion
bindings empty.

## R140: raw-link countermodel, not intrinsic consequence

All original sources were reviewed:
[5800815386](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5800815386),
[5819808597](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5819808597), and
[5821335636](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5821335636).

The exact premise-only records `[[3,0,1],[4,1,2],[5,2,0],[6,6,3]]` and
extension `[7,0,2]` preserve distinct link identities, direct self-incidence,
shared address incidence and recursive references. All 49 ordered pairs on
existing addresses are formable; formation selects none. The role probe has
leaf orbit sizes `[1,2]` and six possible semantic assignments. The association
encodings become equal only after the unestablished uniform slot reversal.

This is a useful negative result under the declared contract. Later original
sources explicitly ask what turns a possible continuation into a consequence,
ask for faithful-representation and generic replacement tests and removal of
assumptions, and reject simply moving authority into a richer host projection.
The broader intrinsic consequence/selection and self-applicability question is
not solved. Status: partial; completion bindings empty.

## R141: linked asymmetry does not authorize a selection

Original source: [review 5802303479](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5802303479).

Live automorphism calculations show the additional record splits one candidate
orbit of size two into two singleton orbits. It changes the number of invariant
singleton selections from zero to two, not one. Removal, replacement and
duplication yield marks `[]`, `[8]` and `[7,8]`; forgery remains isomorphic,
context relocation is a renaming, and finite/self-referential chains retain
opposite selection readings.

These probes test the requested perturbations and keep formation, selection,
justification, applicability, activation and execution separate. They do not
supply self-justifying admission or execution, establish the origin of
selection authority, or prove every richer linked mechanism insufficient.
External authority has not been proved irreducible. Status: partial;
completion bindings empty.

## R142: exact-cover verifier with its authority still external

Original source: [review 5803686269](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5803686269).

The public verifier is exercised on complete evidence, missing/duplicate/
foreign/wrong-decomposition evidence, empty candidate domains, malformed
records, duplicate record addresses, unresolved members, missing description
records and noninjective mappings. It survives injective renaming and record
reordering. Context relocation and replacement of the description change the
admissible set exactly as declared. Two locally isomorphic certificates return
both candidates, exposing ambiguity rather than secretly selecting one.

The report retains the explicit external finite relational-check provenance.
The host still assigns correspondence roles, enumerates and classifies the
candidates. Neither the current description nor its verifier authenticates or
authorizes itself; locally isomorphic forgery is not rejected. Thus the original
request to locate structural admissibility authority and attack the regress
remains open. Status: partial; completion bindings empty.

## Reproduction and integration

`node scripts/bind-structural-foundation-evidence.mjs OUTPUT_DIRECTORY` emits
a candidate manifest, ledger and six-row binding bundle. It preserves the
original wording/digests, obligation text and all 164 IDs, and pins implementation,
tests, fixtures, dependency locks, vendored JavaScript source and linked
artifacts. Run it after final-source artifact regeneration so pins describe the
actual integrated source. If the starting inventory already has an unrelated
ledger/manifest mismatch, the bundle reports that same error and does not
repair other rows. A newly introduced inventory error is fatal.

The existing strict `executeIssue183Check` producer must execute the candidate
Node and Cargo checks. A binding is not an execution receipt. The overall final
completion gate must continue failing while any original obligation is unmet.
