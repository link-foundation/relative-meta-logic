# Architecture-neutral foundation search

This experiment asks a falsifiable question without assuming that its current
semantic categories are ontologically primitive:

> Which representation and semantic assumptions does each executable links
> model introduce, and which comparisons remain justified?

The earlier zero-transition result answers only that the current passive host
model cannot execute this workload after its transition operations are
disabled. It does not show that links are passive, that transformation must be
external, select S/K, prove S/K minimal, or exclude a different conception of
links. The search runs the same workload through three mechanisms, including
two that define neither an S/K transition nor bracket abstraction and do not
use the closed-term compiler. Language constructors used by the workload
remain opaque link data.

The executable report is
`rml-alternative-foundation-search/v18`. Run it with:

```bash
cd js
npm run report:foundation-search
```

The compact checked-in comparison is
[`foundation-candidates.json`](../../../lib/meta-theory/foundation-candidates.json),
and the shared linked programs are in
[`alternative-foundations.lino`](../../../lib/meta-theory/alternative-foundations.lino).

## Candidate designs

| Property | A: closed S/K | B: direct structural | C: Horn relational |
|---|---|---|---|
| Representation | Addressed-doublet closed-term DAG | LiNo patterns, replacements, imports, facts, and rules | Linked facts and Horn clauses |
| Transition | Leftmost S/K contraction | Leftmost structural match and replacement | Monotone premise unification and conclusion insertion |
| Transition authority | Two external equations | Ordered linked rewrite/inference declarations | Clause set plus saturation schedule |
| External semantic operations | 2 | 6 | 5 |
| External semantic source descriptions | 0 | 1 | 1 |
| Host/object-specific knowledge | none | none | none |
| Self-hosting closure for the nine operations | 9/9 | 9/15 | 9/14 |
| Symmetric-comparison eligible | yes | no | no |
| Formation boundary | Closed generated terms and source/artifact parity | Bound variables and acyclic imports | Range-restricted conclusions and finite bounds |
| Control boundary | Contraction order and resource bound | Traversal order, cycle detection, and resource bounds | Fair saturation rounds and fact bound |
| Ontology role | Executable control | Executable control | Executable control |
| Constrains ontology search | no | no | no |

Candidate A is the current bootstrap. Candidate B deliberately retains the
pre-S/K reference interpreter as an independent control. Candidate C uses a
monotone relational mechanism: it never replaces a subterm, and its
transition authority is materially different from both rewrite candidates.
Their implementation paths are selected explicitly by `ExecutionBasis` /
`executionBasis`; runtime traces verify that B and C never observe an S or K
contraction. B and C are executable controls, not peer foundational
candidates: their host still duplicates six and five capabilities,
respectively, and each consumes an external semantic source description.

All three record the following separately:

- representation and primitive semantic laws;
- transition mechanism, authority, and source provenance;
- host runtime, formation/admissibility, and execution-control boundaries;
- self-description, self-interpretation, and self-generation mechanisms;
- external and derived semantic information;
- object-specific host knowledge and undocumented authority; and
- rejection, removal, and equivalence status.

No candidate is declared equivalent to another. Equivalence remains
`NOT_CLAIMED_WITHOUT_EXECUTABLE_BISIMULATION`.

## Independent ontology investigation

Version 13 extends a falsifiable ontology experiment rather than converting a
correctly documented boundary into a completed foundational result. The report
sets `foundationStatus: OPEN` and
`ontologySearch.status: OPEN_INDEPENDENT_INVESTIGATION`. It keeps five
questions machine-readably unresolved:

- link ontology;
- primitive categories;
- the structure/transformation relation;
- intrinsic semantic authority; and
- comparative minimality.

Candidates A, B, and C have role `EXECUTABLE_CONTROL`. Their implementations
are evidence about what can execute over the tested representations, but
`existingCandidatesConstrainSearch` is `false`. No target architecture is
selected, so a future investigation cannot use the presence of S/K,
rewriting, or Horn clauses here as a reason to assume that any of their
categories belongs at the foundation.

The report also audits the words `data`, `operation`, `state`, `transition`,
`interpreter`, `evaluator`, `rewrite`, `rule`, `function`, and `relation` as
`IMPORTED_EXPERIMENTAL_VOCABULARY`. Their foundational status is
`UNESTABLISHED`. For any proposed primitive, the acceptance protocol asks
whether it was forced by the investigated phenomenon, derived from already
established properties, or imported from a host representation or existing
formalism. Successful execution, universality, self-hosting, elegance, and
small size do not by themselves answer that provenance question.

For the same reason, the authoritative semantic source is described as
`represented-as-addressed-links`, not “link-native.” This establishes how it
is represented. It does not claim that its categories or authority were
derived from the intrinsic nature of links.

## Exhaustive symmetry and observation-loss result

The binary baseline of `rml-link-ontology-symmetry-experiment/v15` starts from a
strictly weaker contract than the upstream model or candidates A/B/C: there
are exactly two **unlabelled reference occurrences**, and reference equality
can be observed. It deliberately assumes no link identity, endpoint order,
source/target role, passivity, time, or execution law. Those omissions are part
of the executable input contract, not conclusions about links.

The carrier is restricted to the references actually observed, so unused
references cannot inflate the search: two occurrences have support size one
or two. There are exactly three surjective assignments: `[0, 0]`, `[0, 1]`,
and `[1, 0]`. The experiment enumerates six group elements across those two
support sizes, applies them ten times across the three assignments, and
computes the quotient rather than stipulating its answer. Exactly two classes
remain:

| Canonical class | Representative | Orbit |
|---|---|---|
| Same reference | `[0, 0]` | `[0, 0]` |
| Distinct references | `[0, 1]` | `[0, 1]`, `[1, 0]` |

The equality partition of the two occurrences is therefore a complete
invariant **for this contract**. Three separately implemented encodings—first
occurrence normal form, the occurrence-equality matrix, and the reference
multiplicity spectrum—produce the same partition and remain invariant under
every enumerated action. JavaScript and Rust independently repeat the
enumeration.

The distinct-reference class has two automorphisms: identity and the
simultaneous occurrence/reference swap. Its two occurrences form one orbit.
Exhausting all four unary occurrence selectors leaves only the empty selector
and the selector containing both occurrences; no invariant singleton exists.
Thus a source/target choice is `NOT_DERIVABLE` from the starting contract.
Exhausting all four self-maps leaves identity and swap as the two equivariant
maps, so the contract also selects no unique dynamics.

Two explicit countermodels test reification. An unreified occurrence pair and
a reified incidence star project to the same distinct-reference observation,
but only the latter has a separate link identity. Reified link identity is
therefore `REPRESENTATION_DEPENDENT` at this observation boundary. Conversely,
identity and swap are derived from the structure as automorphisms, so an
absolute structure/transformation separation fails for structural symmetries.
That is not an execution result: an automorphism describes indistinguishable
structure and supplies no time, application, or authority to enact itself.

These computations yield a narrow form of representation-independent
authority: a valid assertion must be constant on each computed orbit. This is
`NEGATIVE_CONSTRAINT_ONLY`; it rejects an intrinsic endpoint direction for the
contract but creates no positive evaluator or transition law. The result is
independent of S/K, direct rewriting, Horn inference, and their host
boundaries. It eliminates proposed properties from one observation contract;
it does not claim that the contract is the ontology of a link or that the
search is finished.

### Fixed-arity information loss

The v12 follow-up first changes no primitive vocabulary at all. It retains only
unlabelled reference occurrences and observable reference equality, but
exhausts widths one through four instead of fixing the width at two.

| Width | Surjective assignments | Reference-renaming classes | Full permutation quotient | Complete invariant |
|---:|---:|---:|---:|---|
| 1 | 1 | 1 | 1 | `[1]` |
| 2 | 3 | 2 | 2 | `[1,1]`, `[2]` |
| 3 | 13 | 5 | 3 | `[1,1,1]`, `[2,1]`, `[3]` |
| 4 | 75 | 15 | 5 | `[1,1,1,1]`, `[2,1,1]`, `[2,2]`, `[3,1]`, `[4]` |

For each exhaustively tested width from one through four, the reference
multiplicity spectrum is a complete invariant of the unlabelled equality
partition. This is finite evidence, not an unbounded theorem. Within that
tested range, the same-reference/distinct-reference quotient is the width-two
member of the family. Consequently, the binary observation is
`INSUFFICIENT_OUTSIDE_FIXED_ARITY`; its fixed width demonstrably erases
higher multiplicity and overlap distinctions.

### Starting-representation faithfulness

The next audit tests the weak starting projection itself rather than adding a
desired observable. Issue 183 independently requires one address space in
which a link can refer to itself directly. That makes one comparison
unavoidable for this scope: whether a reference occurrence has the same
address as the link containing it. This introduces no endpoint order,
membership relation, type judgement, evaluator, transition, or calculus.

An addressable pattern records the link address first and then its reference
occurrences. The provisional quotient applies global address renaming and
reference-occurrence permutation while keeping the link position
distinguished; the next audit tests those two transformations separately.
Forgetting the first position recovers the existing reference-only
multiplicity observation.

| Reference occurrences | Reference-only classes | Addressable classes | No direct self-reference | With direct self-reference | Projection-fibre histogram |
|---:|---:|---:|---:|---:|---|
| 1 | 1 | 2 | 1 | 1 | 1 fibre of size 2 |
| 2 | 2 | 4 | 2 | 2 | 2 fibres of size 2 |
| 3 | 3 | 7 | 3 | 4 | 2 fibres of size 2; 1 of size 3 |
| 4 | 5 | 12 | 5 | 7 | 3 fibres of size 2; 2 of size 3 |

Within the original two-occurrence starting contract, an explicit countermodel
compares a direct-self link with normalized address pattern `[0,0,1]` against a
link with a fresh external address, `[0,1,2]`. Both forget to the
distinct-reference multiplicity spectrum `[1,1]`, but no allowed renaming or
occurrence permutation changes whether a reference equals the link address.
They are therefore inequivalent addressable links with the same starting
projection. The width-one row is already non-injective; the binary witness is
used because it audits the original starting contract directly.

The finite counts instantiate a general argument. Every nonempty reference
multiplicity spectrum has one lift where the link address is fresh, plus one
self-identifying lift for each distinct part size. Those lifts all have the
same reference-only projection and remain inequivalent because direct
self-reference is invariant under the allowed representation changes. Hence
`REFERENCE_ONLY_PROJECTION_IS_NON_INJECTIVE_AT_EVERY_NONZERO_FINITE_ARITY`.

This establishes
`REFERENCE_ONLY_PROJECTION_NOT_FAITHFUL_FOR_SELF_REFERENCE`: the original weak
projection already forgot information justified by the issue's link object.
It does not prove that a distinguished address is the whole ontology of a
link, assign source/target roles, or supply dynamics or execution semantics.

### Quotient-assumption audit

Retaining the link address repairs one demonstrated loss, but does not by
itself justify the equivalences used to compare addressable patterns. The
audit therefore enumerates ordered address/equality patterns before occurrence
permutation and compares them with the unlabelled addressable quotient:

| Reference occurrences | Ordered equality classes after address renaming | Unlabelled addressable classes | Classes collapsed by occurrence permutation |
|---:|---:|---:|---:|
| 1 | 2 | 2 | 0 |
| 2 | 5 | 4 | 1 |
| 3 | 15 | 7 | 8 |
| 4 | 52 | 12 | 40 |

Global bijective address renaming is derived within the declared
address/equality contract. The full equality matrix is unchanged by every
renaming, and two ordered patterns have the same matrix exactly when the
correspondence between their used addresses defines a bijection. The finite
enumeration verifies this complete invariant at widths `1..4`; the argument
itself is not width-specific. Thus reference names are
`DERIVED_EQUIVALENCE_WITHIN_ADDRESS_EQUALITY_CONTRACT`, not a merely chosen
quotient and not an absolute ontological result.

Occurrence permutation has no such derivation from the current contract. The
ordered patterns `[0,0,1]` and `[0,1,0]` are distinct under address renaming
alone but become equal after swapping their two reference occurrences. They
are distinguishable precisely if reference slots carry identity. Because no
link-derived premise yet decides that question, occurrence permutation is
`UNESTABLISHED_EQUIVALENCE`; the `0/1/8/40` collapsed-class counts quantify
what that observer choice removes.

After the unlabelled-occurrence premise is explicitly declared, the pair
`(referenceMultiplicitySpectrum, directSelfReferenceMultiplicity)` agrees
exactly with all `2/4/7/12` addressable quotient classes at widths `1..4`.
It is therefore
`COMPLETE_INVARIANT_FOR_DECLARED_UNLABELLED_ADDRESS_EQUALITY_CONTRACT`, a
smaller faithful descriptor for that contract. It does not establish that
reference slots intrinsically lack identity, that this quotient exhausts
links, or that an evaluator, type, set, category, or calculus is forced.

### Slotwise self-incidence

Before imposing the unlabelled-occurrence quotient, self-incidence has a
strictly more precise classification. For an addressed pattern
`[address, reference₀, …]`, the Boolean mask records whether each ordered
reference equals the link address.

| Reference width | Masks realized | Ordered classes for each exact mask |
|---:|---:|---|
| 1 | 2 | `0 → 1`, `1 → 1` |
| 2 | 4 | `00 → 2`; every other mask `→ 1` |
| 3 | 8 | `000 → 5`; each one-hot mask `→ 2`; every other mask `→ 1` |
| 4 | 16 | `0000 → 15`; each one-hot mask `→ 5`; each two-hot mask `→ 2`; every other mask `→ 1` |

All `2/4/8/16` possible masks occur at widths `1..4`. More generally, an
exact width-`n` mask with `k` true entries admits `B(n)` reference-equality
classes when `k = 0` and `B(n-k)` when `k > 0`, where `B` is the Bell number:
all self-incident slots must share the link-address class, while the remaining
references partition freely.

The mask is invariant under global address renaming. Under reference-slot
permutation it is equivariant, not invariant: the same permutation transports
its entries. For example, `[0,0,1]` has mask `[true,false]`, while `[0,1,0]`
has `[false,true]`. Both have direct-self multiplicity one and become equal
only after the occurrence-permutation quotient.

Together, the ordered reference-equality matrix and slotwise self-incidence
mask completely classify the tested ordered address/equality patterns. After
the unlabelled quotient only the number of true entries remains. This
classification does not prove that slot identity is intrinsic to links or
assign a source, target, endpoint, or execution role to a self-incident slot.

### Shared-address composition

The next experiment removes only the assumption that a link can be classified
in isolation. It retains finite ordered link records, exactly one ordered
reference slot per link, distinct link addresses in a shared address space,
and address equality as the only observable. The exact enumeration is:

| Links | Shared-address classes | Products of local descriptors | Local-fibre histogram | Shared descriptor faithful |
|---:|---:|---:|---|---|
| 1 | 2 | 2 | `1 → 2` | yes |
| 2 | 10 | 4 | `1 → 1; 2 → 2; 5 → 1` | yes |
| 3 | 77 | 8 | `1 → 1; 3 → 3; 10 → 3; 37 → 1` | yes |
| 4 | 799 | 16 | `1 → 1; 4 → 4; 17 → 6; 77 → 4; 372 → 1` | yes |

Here each histogram entry is `shared classes in a local fibre → number of
local descriptor values`. The local product is faithful for one isolated link
and non-faithful at every tested multi-link width. The smallest explicit
countermodel compares the external-reference pair `[[0,1],[2,3]]` with the
two-link incidence cycle `[[0,2],[2,0]]`. Each link has the same local
descriptor in both configurations, but the first has no incidence cycle and
the second has a cycle of length two; no global address renaming relates them.

The ordered cross-reference equality matrix together with the
reference-to-link-address incidence matrix gives one class per shared-address
class at all four tested widths. More generally, incidence identifies every
reference equal to a distinct link address, while reference equality
partitions the remaining external addresses; equal descriptors therefore
induce a global address bijection. This is a complete invariant for the
declared ordered one-reference shared-address equality contract, not for link
ontology.

The report records the assumption provenance explicitly. Indirect
self-reference forces comparison in a shared address space. The countermodel
survives global address renaming. Ordered record identity, a fixed finite link
count, and one reference slot remain observer choices. Incidence is not named
a source, target, dependency, transition, or execution edge, and no dynamics
are inferred from the two-cycle.

### Structural application and composition probe

The next probe adds no type theory, lambda calculus, evaluator, rewrite
calculus, or graph semantics. It keeps mathematical implication `→` separate
from the notation `⟼` for a raw binary link. In the executable representation,
each record is only `[link address, first reference, second reference]`.

The two suggested recursive shapes are represented without semantic labels:

```text
(f ⟼ x) ⟼ y   [[3,0,1],[4,3,2]]
f ⟼ (x ⟼ y)   [[3,1,2],[4,0,3]]
```

They are inequivalent under address renaming while ordered reference slots are
retained: the nested link address occurs in a different outer slot. Reversing
both reference slots uniformly and then renaming addresses maps the first
shape to the second. This is a conditional equivalence, not an ontological
claim, because the preceding audit still classifies reference-slot permutation
as `UNESTABLISHED_EQUIVALENCE`.

Even the ordered structure supplies only three distinguishable positions; it
does not name those positions `function`, `argument`, or `result`, nor does it
identify either link record as `application`. After forgetting slot order, the
recursive shape has two structure-preserving leaf automorphisms and leaf-orbit
sizes `1` and `2`: the two references of the nested link cannot be
distinguished at all. Thus raw structure does not recover all four proposed
semantic roles under either contract.

Composition has a connected countermodel. Read the letters below only as an
external description of the proposed interpretation, not as data in the
records:

```text
P = [3,0,1]   proposed K=0, shared A=1
Q = [4,1,2]   shared A=1, proposed B=2
T = [5,2,0]   references [B,K]
U = [6,6,3]   directly self-incident; recursively references P
```

The records have four distinct link identities, all separate from the
pairwise-distinct proposed `K`, `A`, and `B` addresses. `P` and `Q` share only
address `1`; `U` is directly self-incident and recursively refers to `P`. The
structure therefore contains link identity, self-incidence, shared-address
incidence, and recursive link structure. It already contains the reverse
reference pair `[2,0]`, but no link has the proposed result pair `[0,2]`.

Adding `[7,0,2]` creates a second structure in which the proposed result is
present without changing any premise. Conversely, binary formation over the
seven existing addresses admits all `7² = 49` ordered reference pairs, so
formation alone does not select `[0,2]`. The result is therefore
`RAW_LINK_STRUCTURE_DOES_NOT_ENTAIL_APPLICATION_OR_COMPOSITION`: the proposed
link is formable but neither unavoidable nor composition-specifically
admissible. A positive result would require an additional selection/closure
law and a separate justification of its authority. The probe assigns no
logical implication, function role, composition, transformation, or execution
meaning to the links themselves.

### Link-carried selection-authority probe

The next probe asks whether the missing selection authority can itself be
ordinary linked structure. It begins with the same premise links and two
duplicate candidates:

```text
premises   = [[3,0,1],[4,1,2]]
candidates = [[7,0,2],[8,0,2]]
S          = [9,7,7]
```

Without `S`, swapping addresses `7` and `8` is an automorphism. The candidates
form one orbit, so the only invariant subsets are the empty set and both
candidates: no invariant singleton selection exists. Adding `S` destroys that
swap. Both candidates then form singleton orbits, making both `{7}` and `{8}`
invariant. This removes a symmetry obstruction to selection, but it does not
force which singleton is authoritative. “Select the referenced candidate” and
“select the unreferenced candidate” are opposite, renaming-equivariant
readings of exactly the same structure.

Perturbations make the boundary falsifiable:

- removing `S` marks no candidate;
- replacing its reference `7` with `8` flips the mark;
- duplicating evidence for both candidates marks two rather than one;
- an isomorphic replacement cannot be rejected as a forgery by the declared
  equality/incidence contract;
- relocating the same evidence through isomorphic context links changes no
  structural fact; and
- finite meta-authority and self-referential authority links close address
  chains but do not choose a reading polarity or supply execution.

The result is
`LINK_CARRIED_INCIDENCE_BREAKS_SYMMETRY_WITHOUT_CONFERRING_AUTHORITY`.
Formation permits the records, structural selection becomes possible once
the orbit splits, justification/authenticity remains absent, and execution is
still a separate question. This is not a proof that authority must be
external or is irreducible; it identifies the exact gap that remains after
authority-shaped information is encoded as ordinary links.

### Linked structural-admissibility probe

The next probe moves from a single mark to a finite certificate. Its external
vocabulary calls four groups of ordinary addressed records a description,
candidate, evidence, and context, but those names are not intrinsic roles. A
declared verifier treats the description as a three-record pattern, requires
an injective linked mapping that covers every description address exactly
once, reconstructs every concrete record from that mapping, and requires one
explicit context-to-certificate incidence link. The verifier enumerates every
certificate bundle and does not choose among passing candidates.

The adversarial cases produce these conditional results:

| Case | Cardinality | Candidates |
|---|---|---|
| valid candidate + complete evidence | `ONE` | `[7]` |
| missing, duplicate, foreign, or wrong-decomposition evidence | `ZERO` | `[]` |
| two locally isomorphic candidates with complete evidence | `MANY` | `[7,8]` |
| zero supplied admissible candidates | `ZERO` | `[]` |
| same evidence in an unlinked context | `ZERO` | `[]` |
| relocated context incidence | `ONE` | `[7]` |
| replacement description | `ONE` | `[8]` |

This rejects structurally incomplete certificates relative to the declared
check and exposes `ZERO`/`ONE`/`MANY` without selecting inside the `MANY` case.
It does not reject the second locally isomorphic candidate as a forgery. The
cardinality classification is observer-computed rather than derived or
executed inside the link substrate, and the exact-cover operation is recorded
as `EXTERNAL_FINITE_RELATIONAL_CHECK_NOT_LINK_DERIVED_AUTHORITY`.

The result is
`LINKED_EXACT_COVER_CERTIFICATES_FILTER_CANDIDATES_WITHOUT_SELF_AUTHORIZING`.
Formation, matching, conditional admissibility, observed uniqueness,
justification, applicability, admission, activation, and execution remain
separate fields. In particular, the records do not authenticate the
description, authorize the experimental role assignment or verifier, publish
or admit a candidate, activate it, or execute a transition. Adding further
authority-shaped links therefore has not closed the regress: the finite
certificate is checkable relative to a stated observer contract, not
self-authorizing.

### Linked local verifier step

The v12 probe factors **one** operation out of the preceding verifier:
matching a described record to a concrete record. It uses the description
`[40,30,31]`, concrete record `[3,0,1]`, and three ordinary correspondence
records `[50,40,3]`, `[51,30,0]`, and `[52,31,1]`. A reusable incidence join
checks the same relation at all three positions. The exact-cover verifier now
uses this join in place of its record-reconstruction comparison. Each local
match emits an ordinary four-record trace:

```text
[200,40,3] [201,200,50] [202,200,51] [203,200,52]
```

The first trace record associates the described and concrete record addresses;
the other three cite the correspondence witnesses. The same join can inspect
that trace root through identity correspondences. This is conditional trace
replay, not validation of the mechanism that chose to replay it.

The probe compares several decompositions: direct reconstruction in the older
verifier, the local incidence join used now, trace replay through that join,
and self-application of an ordinary described record. Its adversarial cases
yield `ONE` for a complete match, `ZERO` for a missing description, missing
correspondence, or a reversed concrete record, `MANY` for duplicate correspondence or two concrete
records, and `ONE` for self-application. Removing `Set` and `Map` construction
from this one local step leaves its trace available. Removing the host's
cardinality classification leaves a trace but no `ZERO`/`ONE`/`MANY` label.
Reading the very same correspondence links in the opposite direction instead
produces `ZERO`, and selecting another description on the same records changes
the result from `ONE` to `ZERO`.

| Boundary | What the experiment establishes |
|---|---|
| Representation | Description, correspondence witnesses, and trace are ordinary addressed triples. |
| Execution | The host still iterates records, projects three positions, compares addresses, branches, and counts witnesses. Removing any of iteration, projection, or equality makes this join unevaluable under the tested contract. |
| Semantic authority | The link records do not say which description is active, which orientation means “correspondence,” or why this join should execute. Self-application and trace replay preserve that ambiguity. |

The result is
`LOCAL_MATCH_HAS_LINKED_TRACE_BUT_RETAINS_HOST_EXECUTION_BOUNDARY`. It is a
smaller reusable matching operation and a fully linked *record of* its local
steps. It is not a link-executed exact-cover verifier, a derivation of the join
from link ontology, or proof that a richer mechanism cannot close the boundary.

### Conditional continuation with one ordinary witness

The next minimal experiment keeps logical implication, a structural Link, a
reported continuation, and execution distinct. The two premise records are
`P=[3,0,1]` and `Q=[4,1,2]`; by themselves they contain no `[0,2]`
record. A third ordinary record `W=[5,3,4]` cites the addresses of `P`
then `Q`. Under an **observer-declared** incidence join, distinct records
`P,Q` may report `[P.first,Q.second]` when `P.second=Q.first` and one
record cites `[P.address,Q.address]`. This reports the pair `[0,2]`. It
does not add a Link or establish implication.
The ordered premises already expose the shared address and possible
`[0,2]` pair to this observer. The new witness contributes a condition for
reporting that pair; it does not supply a missing endpoint or a composition
law.

The same two premises with `[5,4,3]` instead report no continuation under
that join. Removing either premise or the witness also reports none. An
unrelated `[0,9]` record does not change the reported pair. Reordering
records or bijectively renaming all addresses preserves the result in the
corresponding coordinates; uniformly reversing reference slots instead
reports `[2,0]`. The distinction is therefore stable under the tested
representation changes but depends on the ordered-slot and witness-reading
choices.

Most decisively, `{P,Q,W}` and `{P,Q,W,[7,0,2]}` satisfy the **same**
witness condition. The first lacks any `[0,2]` Link; the second contains
one. This is a smaller countermodel to any claim that the witness alone
forces creation of the composed Link. The extra ordinary Link makes a
specific continuation *conditionally identifiable* under the chosen join,
but it does not authorize that join, select the witness orientation, or
execute the continuation. Minimality here is only relative to this
three-record criterion; the experiment does not rule out another
links-derived invariant or closure principle.

The local verifier's trace has the same provenance problem: the records
can carry the trace after host execution, while selection of the active
description, correspondence direction, equality tests, and iteration
still determine whether that trace follows. Trace replay and
self-application do not change this countermodel.

### Conditional refinement probe

The second follow-up asks what a reference-only projection would lose if an
independently observable co-membership relation existed. It does **not** call
that relation link identity, endpoint grouping, order, time, or semantics.
Its provenance is
`CONDITIONAL_REFINEMENT_PROBE_NOT_DERIVED`, and its foundational status is
`UNESTABLISHED`.

At width four there are 15 reference-equality partitions and 15 partitions
of the conditional relation, giving 225 labelled joint structures. Exhaustive
quotienting by all 24 occurrence permutations yields 33 joint classes. Three
independent constructions classify exactly the same 33 classes:

- canonical pairs of restricted-growth partitions;
- paired occurrence-equality matrices; and
- row/column-quotiented intersection-multiplicity tables.

Forgetting the conditional relation produces these exact projection fibres:

| Reference multiplicity | Joint refinements | With singleton orbit | Without | Classification |
|---|---:|---:|---:|---|
| `[1,1,1,1]` | 5 | 1 | 4 | refinement-dependent |
| `[2,1,1]` | 9 | 3 | 6 | refinement-dependent |
| `[2,2]` | 7 | 1 | 6 | refinement-dependent |
| `[3,1]` | 7 | 7 | 0 | base-forced |
| `[4]` | 5 | 1 | 4 | refinement-dependent |

Every coarse class therefore has multiple incompatible refinements. The
second relation is `NOT_RECOVERABLE_FROM_BASE_PROJECTION`; this establishes
what the current observation forgets, not whether the forgotten relation is
fundamental to links.

Automorphism enumeration supplies a more precise conditional result:

| Singleton occurrence orbits | Joint classes |
|---:|---:|
| 0 | 20 |
| 1 | 5 |
| 2 | 7 |
| 4 | 1 |

Thus “contains a singleton orbit” does not usually mean “selects one unique
occurrence.” Only five classes have exactly one singleton orbit; eight have
multiple singleton orbits. No orbit is assigned endpoint semantics.

The provenance experiment then recomputes occurrence orbits under the base
relation alone, the conditional relation alone, and their conjunction. It
partitions all 33 classes without overlap:

| Provenance | Classes | Established fact |
|---|---:|---|
| `BASE_FORCED` | 7 | The base `[3,1]` multiplicity already has one singleton orbit; every refinement preserves at least that asymmetry. |
| `REFINEMENT_PRESENT_NOT_BASE_FORCED` | 5 | The base has no singleton, but the conditional relation already has one. |
| `RELATIONAL_INTERACTION_ONLY` | 1 | Neither relation alone has a singleton orbit, but their conjunction has four. |
| `NO_SINGLETON_ORBIT` | 20 | The conjunction retains no singleton orbit. |

Four of the five base fibres contain both outcomes, which supplies
projection-preserving countermodels to any claim that those base objects force
the refined asymmetry. Only the `[3,1]` fibre forces a singleton across all
seven refinements. The interaction-only witness makes the separation
explicit: the normalized base `[0,0,1,2]` has orbit sizes `[2,2]`. With the
all-equal conditional partition `[0,0,0,0]`, the joint orbit sizes remain
`[2,2]`; with the crossing partition `[0,1,0,2]`, whose own orbit sizes are
also `[2,2]`, the conjunction has `[1,1,1,1]`. The last asymmetry is therefore
not present in either relation separately; it is forced by their interaction
once both observations are supplied. Because the second relation remains
unestablished, this is conditional relational evidence rather than a
link-ontology result.

### Is the interaction itself forced by the base?

The next experiment does not add another relation. It asks whether the
interaction-only conditional could have been derived from the tested base.
The derivation criterion is link-first: a deterministic observation derived
from the base occurrences and their reference coincidences must commute with
every relabelling of those occurrences. It imports no membership axiom,
category object or morphism, type judgement, evaluator, transition law, or
semantic endpoint role.

Every base partition and candidate observation partition at widths one through
four is checked directly:

| Width | Base patterns | Base/candidate pairs | Preserve every base symmetry | Break a base symmetry | Preserving candidates changing base orbits |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 1 | 0 | 0 |
| 2 | 2 | 4 | 4 | 0 | 0 |
| 3 | 5 | 25 | 13 | 12 | 0 |
| 4 | 15 | 225 | 55 | 170 | 0 |
| **Total** | **23** | **255** | **73** | **182** | **0** |

The last zero is not only a finite pattern. For any base observation `B`, let
`d(B)` be a deterministic derived observation that commutes with occurrence
relabeling. Take a relabelling `p` that preserves `B`. Commutation gives
`d(p(B)) = p(d(B))`; because `p(B) = B`, it follows that `p(d(B)) = d(B)`.
Thus every base-preserving relabelling also preserves the derived observation,
and adjoining that observation cannot split a base occurrence orbit. This
argument covers every finite observation satisfying the stated derivation
criterion, beyond the enumerated widths.

The interaction-only witness fails the criterion explicitly. Relabelling
occurrences by `[1,0,2,3]` leaves its base `[0,0,1,2]` unchanged but changes
the conditional pattern from `[0,1,0,2]` to `[0,1,1,2]`. The new occurrence
distinctions are therefore supplied by information not derived from the tested
base. This eliminates that conditional pattern as a base-forced explanation;
it does not establish that the base exhausts the intrinsic structure of links.

The machine-readable loss audit distinguishes:

- contract-derived equivalence of raw reference names;
- unestablished quotienting of reference-occurrence order;
- demonstrated information loss from fixed binary width;
- demonstrated non-recoverability of the conditional relation;
- demonstrated direct-self-reference loss when an addressable link is
  projected to reference occurrences alone;
- endpoint direction that was not observed and therefore not disproved; and
- dynamics and time that were not observed and therefore not disproved.

This answers which facts survive the tested representation changes while
preserving the unresolved question: none of these finite observations has
been established as a sufficient characterization of a link.

Run the standalone result with:

```bash
cd js
npm run report:link-ontology
```

## Host-representation boundary audit

The report executes an underdetermination witness over the host value
`(link left right)`. One host function returns the value unchanged; another
reverses its endpoint positions. Both outputs retain the tagged ternary shape
and both functions commute with an atom renaming, but their results differ.
The admissible result is deliberately narrow: this host representation
signature does not select between those two tested functions.

That experiment does **not** identify the ontology of a link. Version 13 makes
its starting assumptions machine-readable:

| Model choice | Status |
|---|---|
| A link is represented by a tagged ternary host value | `ASSUMED_NOT_DERIVED` |
| Source and target occupy distinct ordered positions | `ASSUMED_NOT_DERIVED` |
| The represented value is passive until acted upon | `ASSUMED_NOT_DERIVED` |
| Transformation is supplied by an external host function | `ASSUMED_NOT_DERIVED` |

Consequently, `linkOntologyCovered` and
`representationExhaustivenessEstablished` are both `false`,
`structureTransformationSeparation` and `transitionExternality` are both
`ASSUMED_BY_EXPERIMENT`, and `intrinsicTransitionAuthority` is `UNRESOLVED`.
The classifier
`ORDERED_LINK_REPRESENTATION_UNDERDETERMINES_TESTED_TRANSITIONS` replaces the
overbroad `NO_INTRINSIC_TRANSITION_AUTHORITY` result.

In particular, the witness does not prove that its signature exhausts links,
that structure and transformation are intrinsically independent, that
transformation must be external, or that no execution principle can arise
from links themselves. The zero-transition run likewise says only that the
finite acceptance workload does not execute in the current passive host
model when its transition operations are disabled. Before an ontological or
foundational conclusion is possible, the model of a link itself must be
re-audited without treating another familiar calculus as evidence about that
ontology.

## Common executable workload

Every candidate must perform `load`, `import`, `rebind`, `match`,
`substitute`, `rewrite`, `infer`, `verify`, and `self-interpret`. The rewrite
candidates execute the same linked source. The Horn candidate represents the
same observable stages as facts and clauses so its relational mechanism is
not disguised term rewriting.

Self-description exposes an active rule/clause as links. Self-interpretation
executes an encoded rule. Self-generation derives a rule description and then
uses it. The host contains no branches for `lambda`, `set`, `graph`,
`relation`, the language-core constructors, or any test-specific predicate.

The workload also checks definitions, rule-like axioms, dependent statements,
theorem conclusions, and proof trees. Substitution is represented as linked
patterns and bindings above each candidate's explicit matching/instantiation
boundary; it is not assigned hidden object-language behavior.

## Removal and comparison protocol

Every declared primitive is disabled at its execution point and the complete
workload is rerun. All 13 current removals fail closed: two for A, six for B,
and five for C. This establishes
`INDEPENDENT_FOR_CANDIDATE_WORKLOAD`, not mathematical independence in every
possible representation or evidence that semantic operations are the correct
primitive category.

The comparison reports, for each candidate:

- independent external semantic information;
- host semantic operations and external semantic source descriptions;
- host/self-semantic duplication;
- self-hosting closure and foundation compression;
- runtime trust-graph coverage;
- object-specific host semantics; and
- undocumented authority paths.

The v15 execution-comparison gate admits a candidate only if it passes the common
workload, derives the whole acceptance interpreter in links, has no host/self
semantic duplication, consumes no external semantic source description, and
has complete runtime trust coverage. Candidate A passes. B and C do not.
Since a comparative cohort requires at least two eligible candidates, the
report sets `OPEN_NO_COMPARABLE_ALTERNATIVE`, returns no smallest candidate,
and selects no foundation. The raw counts 2, 6, and 5 remain useful boundary
measurements, but the implementation now makes it impossible to rank them as
if they came from equally reduced architectures.

A smaller vocabulary is not treated as an improvement unless an executable
equivalence or reduction removes semantic information rather than renaming
it. The report therefore makes neither a global-minimality claim nor the
weaker claim that S/K wins this currently asymmetric experiment.

## Computability argument

The shared link-register program represents a configuration as program links,
a control label, two unary counters, and a linked trace. Its rules cover six
transition cases: increment either counter, decrement either nonzero counter,
and take the zero branch for either counter. The Horn candidate defines the
same cases as inference clauses.

For an instruction at label `q`, structural matching or premise unification
selects exactly that instruction and produces the corresponding successor
configuration. Induction on the number of machine steps therefore gives:

1. the encoded initial configuration represents the source machine state;
2. each source increment or conditional-decrement step has a matching linked
   transition with the same next label and counter values; and
3. a finite source run ending at `halt` produces the linked halt certificate.

The regression program takes both zero branches and both nonzero decrement
branches, executes both increment instructions, and halts at `(zero, zero)`.
Fault injection and JavaScript/Rust parity test the interpreter rather than a
single hand-written reduction.

The final universality step uses Minsky's two-register result in chapter 14.1
of *Computation: Finite and Infinite Machines* (Prentice-Hall, 1967), which
shows how the increment and conditional-decrement basis simulates arbitrary
Turing-machine computation. An [archived catalog and scan reference is
available through Open Library](https://openlibrary.org/books/OL5535641M/Computation_finite_and_infinite_machines).
Thus the idealized unbounded linked transition relation is Turing complete.
The executable runtimes retain configurable finite resource bounds: every
finite machine prefix runs with a sufficiently large bound, while a concrete
process cannot certify that a nonterminating run will finish.

## Language semantic cores and exact boundary

All candidates execute linked JavaScript and Rust counter-machine operational
cores and check linked Lean and Rocq dependent-identity cores. These are real
executable semantic cores with distinct linked vocabularies, not stored source
strings and not calls to external compilers or proof kernels.

They are not complete production implementations of the four ecosystems.
RML does not claim their parsers, optimizers, unsafe/runtime facilities,
standard libraries, module systems, tactics, or foreign-function interfaces.
The full pinned Lean/Rocq corpus remains a provenance and parity artifact, not
execution authority. Expanding these cores to production-language coverage is
separate, open work and cannot honestly be inferred from Turing completeness.

## Guarded proof knots

`guarded-referential-links` demonstrates a concrete benefit of referential
links. A repeated address in `(guarded-link address value address)` is checked
structurally and yields one finite observation plus an opaque continuation at
the same address. Unequal endpoints do not match. The Horn candidate derives
the same guarded observation through repeated-variable unification.

This “proof knot” gives a finite certificate for one observation of cyclic
data without eagerly unfolding an infinite object. It composes naturally with
the existing bounded cyclic-sequence observer and suggests a research path for
memoized coinductive certificates: each address can name both the observed
fact and the continuation that reuses it. Crucially, the proof substrate still
rejects circular justification; referential data is useful structure, not
permission for a theorem to prove itself.

## Transition-law provenance after a linked continuation witness

The local probe starts with ordinary addressed binary records
`P=[3,0,1]`, `Q=[4,1,2]`, and `W=[5,3,4]`. A host-supplied incidence join
reports `[0,2]` as a possible continuation. The record set alone neither
contains that result nor requires its creation: adding `[7,0,2]` preserves the
same witness condition. This is an identification result conditional on the
join, not a logical implication or an executed transition.

The v13 transition-law audit keeps these facts fixed while varying the
observer's choices:

| Variation | Observed result | Scope |
|---|---|---|
| Lossless nested incidence encoding, decoded before the same join | `[0,2]` | The chosen readout survives this faithful representation change; the decoding and join are still host operations. |
| Ignore witness reference order | Both `W=[5,3,4]` and `W=[5,4,3]` identify `[0,2]` | Witness orientation is unnecessary for this one chain, despite being part of the original criterion. |
| Reverse the output projection with all input records unchanged | `[2,0]` instead of `[0,2]` | Both generic readouts survive address renaming and record reordering, yet disagree over identical structural facts. |
| Add ordinary `[6,5,5]` as a rule-like record | Both projections still disagree | An untyped rule record does not select its own reader. |
| Erase premise-reference equality while retaining record addresses and witness references | `[3,0,1],[4,1,2],W` reports `[0,2]`; `[3,0,1],[4,9,2],W` reports none | The retained observations agree, so they cannot determine whether the premise join applies. |
| Remove record enumeration | Candidate discovery becomes undetermined | No pair is selected for the join. |
| Remove record construction | No result record appears | Reporting a candidate is separate from producing it. |

The report separates five stages: `[0,2]` is structurally formable and
conditionally identifiable; intrinsic admissibility, consequence, and
production are not established. The two projections are deliberately simple
competing models, not a proof that no future Links-derived law is possible.
They show precisely what the current records fail to determine: which
projection, if any, has authority, and how the law governing that choice
would apply to itself.

## What makes a possible continuation follow

The transition-law audit shows that `[0,2]` can be formed and, under a declared
join, identified. The v14 consequence audit asks the next question without
adding verifier machinery, a rule-like record, or a selector: which structural
fact turns a possible continuation into one that **follows**? It is a finite
model check over the same premises `P=[3,0,1]` (`K ⟼ A`) and `Q=[4,1,2]`
(`A ⟼ B`). A pair is **possible** when some admissible completion of the
recorded pairs contains it. It **follows** when every admissible completion
contains it. Formation, identification, admissibility, consequence, and
production stay separate: computing a model does not produce the continuation.

Over `K`, `A`, and `B` there are nine ordered pairs, so the two premises have
`128` completions. Every pair is possible in every admissible class below.
With no exclusion, nothing beyond the recorded pairs follows. That part is
trivial, because the unconstrained family is upward closed. It still fixes the
baseline: positive link facts alone never make a continuation follow.

| Exclusion over completions | Admissible | Follows | `[0,2]` follows | `[2,0]` follows | Some orientation always present |
|---|---|---|---|---|---|
| none | `128` | `[0,1]`, `[1,2]` | no | no | no |
| transitive (`x⟼y`, `y⟼z` require `x⟼z`) | `13` | `[0,1]`, `[0,2]`, `[1,2]` | yes | no | yes |
| circular (`x⟼y`, `y⟼z` require `z⟼x`) | `2` | `[0,1]`, `[1,2]`, `[2,0]` | no | yes | yes |
| transitive or circular | `14` | `[0,1]`, `[1,2]` | no | no | yes |

Some exclusion is therefore necessary before anything new follows. Among the
tested exclusions, only an oriented one makes an oriented continuation follow:
admitting either orientation makes only the unoriented connection between `K`
and `B` follow. Each oriented exclusion's meet is also exactly the least model
of one surviving projection below, so the fact that selects the continuation
restates a transition law. That answers the follow-up question "why does this
fact select it?" with another external interpretation: the problem moves one
level.

The competing projections are then used as a search instrument rather than
repaired. A position law copies two of the four premise reference slots
`[P.first, P.second, Q.first, Q.second]` into an output pair. The `16` laws give
`9` distinct readouts. Address renaming, arbitrary substitution, record
reordering, and nested encoding pass all `16`, so they constrain nothing here.
Global slot reversal passes `6`, non-degeneracy `10`, and unordered novelty `8`.
Non-degeneracy plus either of the other two already leaves the same two laws:
`[P.first, Q.second]` reading `[0,2]` and `[Q.second, P.first]` reading `[2,0]`.
Every criterion commutes with the output swap, and the swap fixes no
non-degenerate law. No combination of these criteria can therefore select one
orientation.

| Tie-breaker | Selects | Equally generic mirror | Mirror selects | Provenance |
|---|---|---|---|---|
| slot-position preservation | `[0,2]` | slot exchange | `[2,0]` | `ALIGNS_UNRECORDED_OUTPUT_SLOTS_WITH_PREMISE_SLOTS` |
| unit neutrality | `[0,2]` | converse unit neutrality | `[2,0]` | `IMPORTS_IDENTITY_LAW_AND_ORIENTED_EQUALITY` |
| declared closed model | `[0,2]` | declared closed cycle | `[2,0]` | `CONCLUSION_ALREADY_RECORDED` |
| premise recoverability | `[0,2]` | premise interchangeability | `[2,0]` | `IMPORTS_IRREVERSIBLE_CONSEQUENCE` |

The minimal model pair makes the disagreement structural rather than
notational. Both least models contain the recorded premises. The forward model
`[0,1]`, `[0,2]`, `[1,2]` has `1` automorphism, and under its law only the
derived link follows from the other two; neither premise does. The circular
model `[0,1]`, `[1,2]`, `[2,0]` has `3` automorphisms, and every link follows
from the other two. Assumptions were then removed one at a time:

| Assumption kept or removed | Result |
|---|---|
| Oriented exclusion kept | `ORIENTED_CONTINUATION_FOLLOWS_RELATIVE_TO_THAT_EXCLUSION` |
| Exclusion orientation removed | `ONLY_UNORIENTED_CONNECTION_FOLLOWS` |
| Exclusion removed | `NOTHING_BEYOND_RECORDED_FACTS_FOLLOWS` |
| Reference-slot order removed | `PREMISE_AUTOMORPHISM_EXCHANGES_CANDIDATES` |

The ordered premises have only the identity automorphism. Unordered premises
also admit the exchange of `K` with `B` and `P` with `Q`, which swaps the two
candidates. Adding the witness `[5,3,4]` changes neither count.
Self-application does not settle the choice either. Each surviving law is closed
on its own least model and fails on the other's, and all four exclusion classes
are consistent with the recorded links. The status is
`CONSEQUENCE_REQUIRES_UNRECORDED_ORIENTED_EXCLUSION`. The same recorded links
are compatible with opposite required consequences, and the missing information
is an exclusion plus one orientation bit that the records do not state. This is
a finite negative for ordered binary records, three addresses, and slot-copying
laws. It does not show that no richer Links-derived principle can exist, and a
host-free generic principle deriving `K ⟼ B` from `K ⟼ A` and `A ⟼ B` remains
open.

## Where consequence orientation can come from

The consequence audit ends with two mirror-image exclusions. The next step is
therefore not another tie-breaker between them. The v15 orientation audit asks
where the orientation of `K ⟼ B` over `B ⟼ K` could come from, and whether a
more primitive property of Links derives it. It takes none of source/target,
premise/conclusion, time, rewrite direction, function/argument, cause/effect,
truth, or proof as a primitive. Its only primitives are address equality and,
depending on the contract, the order of each record's two reference slots.
Completions, exclusions, and position laws are not used, so the
model-theoretic reading of R147 stays a search instrument rather than a new
foundation.

Two candidate readings are **separated** when no symmetry of the records maps
one to the other, **exchanged** when some symmetry does, and **coincide** when
the contract cannot tell them apart. Separation lets an invariant selector
choose an orientation. The orientation is **structurally forced** only if the
records also rule out the opposite choice. The audit keeps these apart:
an orientation that can be chosen is not thereby forced.

| Contract on `P=[3,0,1]`, `Q=[4,1,2]` | Symmetries | Address orbits | K and B exchanged | `[0,2]` versus `[2,0]` |
|---|---|---|---|---|
| named ordered slots | `1` | `{K}`, `{A}`, `{B}`, `{P}`, `{Q}` | no | separated |
| anonymous ordered slots (a symmetry may reverse every record's slots together) | `2` | `{K,B}`, `{A}`, `{P,Q}` | yes | separated |
| unordered slots | `2` | `{K,B}`, `{A}`, `{P,Q}` | yes | coincide |

Under anonymous slots the second symmetry exchanges `K` with `B` and `P` with
`Q`, but it also reverses both records, so it maps `[0,2]` to itself.
Exchanging the ends therefore does not exchange the candidates. Only slot
order separates them, and dropping it makes them one unordered pair.

The audit then extends the premises by up to two ordinary records at
addresses `5` and `6`. Their references range over every existing address and
fresh addresses, which gives `4567` structures (`1`, `50`, and `4516` with zero,
one, and two extra records). Under both ordered contracts, `4563` keep the
candidates separated and `4` exchange them. The four exchanging extensions are
`[5,1,0]`, `[6,2,1]`; `[5,2,1]`, `[6,1,0]`; `[5,2,10]`, `[6,10,0]`; and
`[5,10,0]`, `[6,2,10]`. Two add the converse of both premises and two close a
four-cycle through a fresh address. Each makes the candidates
indistinguishable rather than ranking one. `4332` structures are chiral under
anonymous slots, meaning no symmetry reverses their slots. In no structure,
under either ordered contract, does a symmetry fix exactly one candidate. Both
premise-to-conclusion slot correspondences, identity and exchange, commute
with every symmetry of every structure.

Two same-observation pairs locate what each asymmetry contributes:

| Pair | Shared observation | Structural difference | Candidates |
|---|---|---|---|
| achiral `P`, `Q`, `[5,3,4]` versus chiral, which adds `[8,8,9]` | all `16` position-law readouts | `1` versus `0` slot-reversing symmetries, so the ends are exchangeable only in the achiral structure | separated in both, and no symmetry fixes exactly one |
| cycle `P`, `Q`, `[5,2,10]`, `[6,10,0]` versus detour `P`, `Q`, `[5,2,10]`, `[6,0,10]` | the same records with unordered slots | a named symmetry exchanges the candidates in the cycle only | the aligned `[P.first,Q.second]` and reversed `[Q.second,P.first]` laws both read `[0,2]`, `[1,10]`, `[2,0]`, `[10,1]` in the cycle, but `[0,2]`, `[1,10]` versus `[2,0]`, `[10,1]` in the detour |

A chiral context can make the ends distinguishable without making either
candidate the consequence. The two structures in the second pair differ only
in the slot order of record `6`, and that difference alone decides whether the
two laws agree.

Representation changes give the same answer. All `120` renamings of the five
premise addresses keep the candidates separated, with no symmetry fixing
exactly one. A tagged encoding replaces `[a,x,y]` with the triples
`(a,20,x)` and `(a,21,y)`, so tag addresses carry slot identity. With the tags
held fixed there is `1` symmetry. With anonymous tags there are `2`, and the
second exchanges both the tags and the ends. Both encodings keep the candidates
separated, and neither has a symmetry fixing exactly one. Swapping the tags
yields a structure isomorphic to the original with the tags held fixed, so the
aligned candidate decodes to `[0,2]` under one reading of the tags and to
`[2,0]` under the other.

Recursion on the carrier asks whether more links, rather than an observer's
naming, can make the tags distinguishable. Both carriers below use records
whose two slots are equal, so neither adds an order through its own slots.

| Carrier | Carrier symmetries | Encoded premise symmetries | Tags and ends exchanged | Candidates |
|---|---|---|---|---|
| symmetric `[20,20,20]`, `[21,21,21]` | `2` | `2` | yes | separated, unranked |
| rigid `[20,20,20]`, `[21,20,20]` | `1` | `1` | no | separated, unranked |

In the rigid carrier, tag `21`'s record refers to tag `20` but not conversely.
That fixes which slot is first, yet no symmetry fixes exactly one candidate.
The result is `SLOT_IDENTITY_FORCED_BY_SELF_INCIDENCE_CANDIDATES_STILL_UNRANKED`.
A self-referential carrier can say which slot is first. It cannot say that the
conclusion must copy that order.

| Asymmetry | Provenance |
|---|---|
| the join address `A`, the only address in both premises | `FORCED_BY_INCIDENCE` |
| `[0,2]` and `[2,0]` as distinct candidates | `FORCED_BY_SLOT_ORDER` |
| `K` and `B` as distinct ends | `FORCED_BY_SLOT_NAMES_OR_CHIRAL_CONTEXT` |
| which slot is first | `FORCED_ONLY_BY_A_RIGID_SELF_REFERENTIAL_CARRIER` |
| which premise slot order the conclusion copies | `CHOSEN_NOT_FORCED` |

The enumeration checks a general argument for these contracts. Every
contract symmetry renames addresses and may reverse every record's slots, so it
acts on an unrecorded pair as it acts on a record. The output swap commutes
with every renaming and acts on pairs as that reversal does, so it commutes
with every contract symmetry of every structure. Hence `[0,2]` and `[2,0]`
have equal stabilizers, and the orbit of `[2,0]` is the swapped orbit of
`[0,2]`. Composing any invariant selector with the swap gives an invariant
selector that chooses the opposite orientation. The strong negative is
`EVERY_INTRINSIC_LINK_OBSERVATION_PRESERVED_ORIENTATION_STILL_REVERSIBLE`:
every observation built from address equality and slot order is preserved,
yet the orientation of the consequence can still be reversed.

The one-step result has a precise boundary. Once a conclusion is recorded and
composed again, its slot order is a record fact. On the chain `[3,0,1]`,
`[4,1,2]`, `[5,2,9]`, the two correspondences build different closures:

| Correspondence | Closure | Derived pairs | Every path has joined ends |
|---|---|---|---|
| identity | `[0,1]`, `[0,2]`, `[0,9]`, `[1,2]`, `[1,9]`, `[2,9]` | `3` | yes |
| exchange | `[0,1]`, `[1,2]`, `[2,0]`, `[2,9]`, `[9,1]` | `2` | no |

Requiring every path to have joined ends selects identity, and requiring the
fewest derived pairs selects exchange. Either is a
`REQUIREMENT_ON_HOW_CONSEQUENCE_COMPOSES`, not a fact recorded by the links.

The status is `CONSEQUENCE_ORIENTATION_DISTINGUISHED_BUT_NOT_FORCED`. Slot
order separates `[K,B]` from `[B,K]` but never ranks them. The missing
information is the correspondence between the premise slot order and the
unrecorded conclusion slot order. Identity is the neutral correspondence, which
makes `[K,B]` the default reading, but requiring consequence to use it is
R147's slot-position preservation, which no record states. The records force
separation, not orientation. This is a finite no-go for address equality and
slot order under the named, anonymous, and unordered contracts. It adds no
direction bit and does not exclude a more primitive Link property outside
those observations, so the question of what breaks the `K ⟼ B` / `B ⟼ K`
symmetry without encoding the desired direction remains open.

## Reproducibility and claim boundary

The JavaScript suite executes the versioned report and synchronizes it with
the checked-in JSON table. The Rust suite independently runs all three
mechanisms, confirms that the non-combinator candidates do not observe S/K,
repeats every removal experiment, checks the same host-representation boundary
witness, and independently enumerates the symmetry quotient, selectors,
self-maps, and reification countermodels.

What is established is the common finite workload, complete counter-machine
instruction simulation, language semantic cores, guarded referential witness,
measured trust boundaries, the failure of the tested ordered-link host
signature to select between two witnessed functions, and the complete
two-class quotient of the stated two-occurrence observation contract. That
quotient falsifies endpoint direction and unique dynamics under its symmetries
and makes reification representation-dependent at its projection boundary.
What is not established is that this contract exhausts the ontology of links,
whether execution can arise from links themselves, an intrinsic orientation
of consequence, a comparable alternative cohort, a winning foundation, global
minimality, pairwise candidate equivalence, enumeration of every formal
system, or full production implementations of Lean, Rocq, Rust, and
JavaScript.

Accordingly, identifying and enforcing these boundaries completes an audit,
not the research questions themselves. The requirements ledger preserves that
distinction by marking the ontology, intrinsic-authority, and combined
foundational investigation rows `Open`.
