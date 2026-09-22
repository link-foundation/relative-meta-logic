# Case study: make Relative Meta-Logic genuinely meta

Issue [#183](https://github.com/link-foundation/relative-meta-logic/issues/183)
asks RML to connect Links Theory, set/type theory, self-reference, graphs, and
relations into one functional meta-theory. Review added the decisive
constraint: RML itself must perform the reasoning. Storing Lean/Rocq source or
calling a host callback is not an implementation of linked semantics.

The complete issue/comment checklist and evidence links live in
[`requirements.md`](./requirements.md).

## Research baseline

The upstream baseline was re-audited on 2026-09-20. The current reviewed
`link-foundation/meta-theory` revision is
[`087f451`](https://github.com/link-foundation/meta-theory/commit/087f4515d0652925eecc54bcade724445c3978f1),
containing version 0.0.3. Its sequence/set model uses references to recursively
nested doublet trees; finite sets are canonical sorted-unique balanced trees;
and references, links, sequences, and sets share one address space. See
[`baseline-audit.md`](./baseline-audit.md) for the source-by-source audit.

RML preserves the complete normalized Lean/Rocq snapshot as queryable link
data and checks its fingerprint in CI. That snapshot is now explicitly a
provenance and parity artifact. It is not the reasoning engine.

## Root cause found during review

The previous implementation described contracts with links, then selected
JavaScript/Rust functions with adapter-name branches. Even caller-defined
extensions required host callbacks. Likewise, the formal corpus preserved
language-specific proof source but left its meaning to external kernels. The
reviewer's lambda-calculus test therefore could not pass: RML had no generic
way to give user-defined link constructors executable semantics.

## Implemented architecture

`LinkedProgramRegistry` is the common execution substrate in both runtimes. It
loads four link forms—program, rewrite, fact, and inference—and supplies:

- structural pattern matching with repeated-variable equality;
- structural substitution with unbound-variable rejection;
- deterministic nested rewriting with cycle and step bounds;
- finite forward inference with fact/round bounds and proof trees; and
- acyclic, contextually rebound imports between linked programs.

It contains no branches for bundled object theories. The shared
[`universal.lino`](../../../lib/meta-theory/universal.lino) file defines lambda
calculus, S/K combinators, addressed links, finite sets, dependent typing,
graphs, relations, and default RML operations as data.

`TheoryNetwork` now binds each implementation to a linked program. The
independent foundation supplies reduction or inference conformance cases for
every obligation. One generic verification path executes all 46 bundled
cases, replays exact proof obligations, and checks the definition witness.
Users can add an unknown logic without modifying either host runtime.

The later foundation review is covered by an explicit
`external S/K laws -> addressed-link semantic program -> K1 -> F -> T` split.
The authoritative 1,446-node program is now checked in as
[`fixed-point-source.lino`](../../../lib/meta-theory/fixed-point-source.lino),
not described by a large JavaScript `buildSourceKernel` function. A
generation-only compiler lowers its 25 roots to the shared 35,674-node runtime
network. Matching, substitution, traversal, import/rebinding, inference, and
verification are derived inside that network. Parsing and resource bounds
remain explicit non-semantic layers.

The provenance report does not relabel S/K as laws of Links Theory. Upstream
defines an addressed doublet network but no execution transition; the current
S and K reductions are therefore recorded as two `externally-primitive` laws.
The link source is `represented-as-addressed-links`, while its six capabilities are
`derived-inside-system`. The executable zero-law candidate fails the complete
probe. A separate iota witness preserves identity, discard, and duplication,
but observes both S/K contractions; its single rule name is therefore an
equivalent re-encoding rather than a semantic reduction. The report continues
to reject any claim of global irreducibility.

The follow-up quantitative review is captured in
[`bootstrap-metrics.md`](./bootstrap-metrics.md). Mirrored executable probes
now report two representation-scoped external laws, zero external semantic
source descriptions, zero derived host semantics, zero host/linked
duplication, 6/6 self-hosting closure, 2/8 foundation compression, and zero
undocumented observations across 4/4 runtime paths and 10/10 path segments. CI
publishes the machine-readable
previous/current comparison instead of inferring progress from labels or host
line counts.

The subsequent path-dependence review is addressed by the
[architecture-neutral foundation search](./foundation-search.md). It executes
the same nine-operation workload under closed S/K, independent direct
structural rewriting, and monotone Horn saturation. The versioned comparison
records every transition authority and boundary, fault-injects all 13
candidate primitives, executes all six cases of a universal two-counter
instruction basis, and checks guarded referential and language-core witnesses
with JavaScript/Rust parity. S/K has the smallest raw operation count, but
only it currently passes the full-self-hosting comparison gate. The report
therefore excludes the direct and Horn controls from ranking, names no
smallest candidate, and keeps the comparative search open. Its executable
two-model witness establishes only that the tested ordered-link host value
does not select between two transition functions. Version 4 marks passivity,
external transition, and structure/transformation separation as experimental
assumptions, and leaves link ontology and intrinsic authority unresolved.
The v4 audit does not count that boundary as completion: it also keeps
primitive categories, the structure/transformation relation, and comparative
minimality open, marks A/B/C as `EXECUTABLE_CONTROLS_ONLY`, and prevents them
from constraining an independent ontology search. Source provenance now says
`represented-as-addressed-links`, which describes representation without
claiming that the source's semantic categories are intrinsic to links.

`links-meta-foundation` is an executable, links-defined `K1` meta-interpreter
for object-encoded binding, matching, substitution, rule
selection/application, and result verification. Its stronger witness executes
an encoded copy of its own repeated-variable matching rule and agrees with
direct bootstrap execution in both runtimes.

Program imports accept `(rebind abstract-concept selected-concept)` clauses.
One unchanged classifier is tested over strict and permissive user
foundations, producing different results. The bundled set theory is also
instantiated unchanged over traditional sequence constructors and associative
link constructors.

## Acceptance evidence

The reviewer requested binding, substitution, beta reduction, and
`((λx.x) a) -> a` without a lambda-specific adapter. The lambda program uses
de Bruijn indices, link environments, and closures; mirrored tests cover the
identity reduction and nested capture safety. Additional tests define a new
double-negation logic and a modus-ponens proof system entirely in test-source
links.

The bundled conformance suite also executes:

- link address/source/target projection and recursive references;
- membership, subset, extensional equality, pairing, union, intersection, and
  replacement;
- Pi formation, lambda typing, application, beta typing, and negative type
  compatibility;
- graph endpoint closure, transitive reachability, and edge typing; and
- relation closure, converse, union, intersection, composition, and pair
  typing.

Separate mirrored store tests retain the exact upstream finite-tree layouts,
canonical set behavior, typed link/graph/relation APIs, and bounded cyclic
sequence observation.

## Verification boundary

The host trusts only the externally primitive S/K contractions and
non-semantic boundary operations
enumerated by `bootstrapKernelReport` / `bootstrap_kernel_report`. The mirrored
audit checks an independent implementation manifest, rejects unreported
semantics, and requires every trust-graph branch to terminate in the declared
boundary. The runtime metrics audit also checks observed paths and
path/operation segments against graph reachability. Object-theory semantics
are linked rules. Candidate sources cannot add
their own contracts, conformance cases, proof rules, axioms, assumptions, or
expected proof obligations.

Capability axioms remain a small, named trust boundary connecting an
implementation witness to a definition proof. They do not replace executable
conformance and do not assert unrestricted equivalence between mathematical
foundations.

Native Lean/Rocq builds cross-check the pinned external artifact. They cannot
authorize or execute an RML linked program, and four upstream Lean `sorry`
declarations remain reported as admitted.
