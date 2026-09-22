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
`rml-alternative-foundation-search/v4`. Run it with:

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

Version 4 does not convert a correctly documented boundary into a completed
foundational result. The report sets `foundationStatus: OPEN` and
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

## Host-representation boundary audit

The report executes an underdetermination witness over the host value
`(link left right)`. One host function returns the value unchanged; another
reverses its endpoint positions. Both outputs retain the tagged ternary shape
and both functions commute with an atom renaming, but their results differ.
The admissible result is deliberately narrow: this host representation
signature does not select between those two tested functions.

That experiment does **not** identify the ontology of a link. Version 4 makes
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

The v4 execution-comparison gate admits a candidate only if it passes the common
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
repeats every removal experiment, and checks the same host-representation
boundary witness.

What is established is the common finite workload, complete counter-machine
instruction simulation, language semantic cores, guarded referential witness,
measured trust boundaries, and the failure of the tested ordered-link host
signature to select between two witnessed functions. What is not established
is the ontology of links, whether structure and transformation are
intrinsically separate, whether execution can arise from links themselves, a
comparable alternative cohort, a winning foundation, global minimality,
pairwise candidate equivalence, enumeration of every formal system, or full
production implementations of Lean, Rocq, Rust, and JavaScript.

Accordingly, identifying and enforcing these boundaries completes an audit,
not the research questions themselves. The requirements ledger preserves that
distinction by marking the ontology, intrinsic-authority, and combined
foundational investigation rows `Open`.
