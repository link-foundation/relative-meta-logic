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
`rml-alternative-foundation-search/v8`. Run it with:

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

Version 8 extends a falsifiable ontology experiment rather than converting a
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

The binary baseline of `rml-link-ontology-symmetry-experiment/v5` starts from a
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

The v5 follow-up first changes no primitive vocabulary at all. It retains only
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

That experiment does **not** identify the ontology of a link. Version 8 makes
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

The v8 execution-comparison gate admits a candidate only if it passes the common
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
whether execution can arise from links themselves, a comparable alternative
cohort, a winning foundation, global minimality, pairwise candidate
equivalence, enumeration of every formal system, or full production
implementations of Lean, Rocq, Rust, and JavaScript.

Accordingly, identifying and enforcing these boundaries completes an audit,
not the research questions themselves. The requirements ledger preserves that
distinction by marking the ontology, intrinsic-authority, and combined
foundational investigation rows `Open`.
