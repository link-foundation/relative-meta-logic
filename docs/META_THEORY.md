# Executable Meta-Theory

RML evaluates object theories from links. JavaScript and Rust provide one
small, theory-independent machine for structural matching, substitution,
ordered rewriting, and bounded inference saturation. Lambda calculus, sets,
types, graphs, relations, and RML connectives are programs consumed by that
machine; none is selected by a host-language `switch`, callback, or adapter.

The bundled network has three independently inspectable inputs:

- [`universal.lino`](../lib/meta-theory/universal.lino) defines executable
  object theories as links;
- [`core.lino`](../lib/meta-theory/core.lino) declares theory addresses,
  shared concepts, implementations, witnesses, and proof objects; and
- [`foundation.lino`](../lib/meta-theory/foundation.lino) declares trusted
  contracts, conformance cases, proof rules, and capability assumptions.

Both runtimes round-trip candidate and foundation text through
`meta-language` before reading the reconstructed LiNo.

## One machine, user-defined logics

An executable program consists of four generic forms. Imports may rebind any
non-variable reference in the imported program, including its transitive
imports:

```lino
(linked-program program-name
  (uses optional-parent-program
    (rebind abstract-concept selected-concept)))

(linked-rewrite program-name rule-name
  (from pattern-with-?variables)
  (to replacement))

(linked-fact program-name fact-name
  (judgement arbitrary-link))

(linked-inference program-name rule-name
  (premise arbitrary-pattern)
  (conclusion arbitrary-pattern))
```

The machine knows only link structure and `?variable` placeholders. It checks
that replacements and conclusions cannot introduce unbound variables,
resolves program imports without cycles, detects rewrite cycles, and applies
explicit step/fact bounds. A new program can introduce new constructors and
rules without changing JavaScript or Rust.

## Explicit meta-foundation

The system distinguishes an initial bootstrap machine from the semantics it
executes:

```text
K0: two externally primitive transition laws (S/K) in JavaScript/Rust
  -> addressed-link source: match/substitute/traverse/import/infer/verify
    -> K1: links-meta-foundation in universal.lino
      -> F: selected user foundation
        -> T: unchanged user theory
```

`K0` is explicit and theory-independent. Both APIs expose the same
`bootstrapKernelReport` / `bootstrap_kernel_report`. The semantic evaluator
has only two reductions:

| Host semantic operation | Contraction |
|-------------------------|-------------|
| `contract-s-link` | `S x y z -> x z (y z)` |
| `contract-k-link` | `K x y -> x` |

Parsing textual LiNo and enforcing cycle/resource limits remain visible in the
boundary report, but are classified as representation ingress and external
execution control rather than semantic operations. The authoritative semantic
program is the 1,446-node addressed-link network in
[`fixed-point-source.lino`](../lib/meta-theory/fixed-point-source.lino). Its
applications are doublets and its tagged lambda/variable nodes are links. A
generation-only bracket-abstraction compiler lowers its 25 roots to the
35,674-node [`fixed-point.ski`](../lib/meta-theory/fixed-point.ski) runtime DAG
shared by both runtimes. The runtime contains no source builder. A
generator-consistency test prevents the link source, runtime artifact, and
browser-safe JavaScript data module from drifting; Rust includes the same DAG.

This distinction makes provenance explicit. The semantic program has
`link-native` provenance and is no longer compiled from a JavaScript semantic
description. The two transition laws have `externally-primitive` provenance:
the upstream Links Theory network model supplies the addressed doublet
structure, but it does not prescribe S or K reduction. The six higher
capabilities are `derived-inside-system`. These classifications describe where
independent semantic information enters; they do not make S/K native laws of
Links Theory.

Matching, substitution, ordered rule selection/traversal, transitive import
rebinding, inference saturation, and result verification are roots in that
artifact. None has a second host implementation. The machine-readable
`rml-bootstrap-trust-graph/v1` graph connects those links-defined services to
the load, reduce, prove, and K1 execution paths.

The fault-injection loop records an outcome for every boundary operation:

| Operation | Experimental result |
|-----------|---------------------|
| S contraction | Disabling S while retaining K breaks the complete probe; `INDEPENDENT` relative to this representation and probe. |
| K contraction | Disabling K while retaining S breaks the complete probe; `INDEPENDENT` relative to this representation and probe. |
| parsing | Pre-linked input bypasses it; retained as non-semantic representation ingress and classified `UNKNOWN`. |
| bounds/cycles | Stops computation without choosing a semantic result; retained as a non-semantic observer and classified `UNKNOWN`. |

The report's `derivedHostServices` and `objectSemantics` lists are empty. `K0`
has no built-in matcher, substitution algorithm, traversal, linker, proof
engine, `lambda`, set, graph, relation, type, truth, or confidence operation.
The report still exposes `claimsIrreducible: false`. Its executable iota
witness reconstructs identity, K, and S with one surface equation while
observing both residual S/K contractions. This establishes equivalent
re-encoding, not less external semantic information, and does not prove that
no different representation could use a smaller boundary.

The foundation search also executes a zero-transition candidate by disabling
S and K together. It fails the same complete acceptance probe. This shows that
the upstream addressed-network structure alone is not yet an executable
transition system. The narrower iota witness preserves its identity, discard,
and duplication cases but observes both S/K operations, so its one name is not
counted as evidence that external semantic information disappeared.

Every remaining boundary node has a structural `primitiveReason` /
`primitive_reason`. The mirrored `auditBootstrapKernel` /
`audit_bootstrap_kernel` API compares the graph with a separately maintained
implementation manifest, rejects an unreported operation, validates all graph
dependencies, and requires a minimization experiment for every host semantic
operation. CI injects a simulated `hidden-object-evaluator` and requires the
audit to fail.

`links-meta-foundation` remains the inspectable `K1` layer. It represents object
atoms, pairs, variables, bindings, and rewrite rules as links and defines
environment lookup, repeated-variable matching, substitution, rule
selection/application, and result verification with `linked-rewrite` forms.
Mirrored tests pass an object-encoded rule through this meta-interpreter and
assert its rule trace. K1 and every other linked program are driven by the
same addressed-link runtime terms; there is no privileged meta-interpreter
callback.

The stronger self-interpretation witness takes K1's own non-linear
`match-identical-atoms` pattern, encodes that rule as object data, and asks K1
to apply it to an encoded `meta-match` request. The result must equal an
encoding of direct execution, and the trace must contain K1's repeated
variable matching and substitution rules. This exercises a fragment of the
interpreter's own interpretation machinery rather than only an unrelated
identity rule.

## Foundation-polymorphic imports

`rebind` gives an imported theory a contextual vocabulary without modifying
or copying its source. For example, a portable theory can emit the abstract
term `foundation-decision`, while two instances bind that term to distinct
foundations:

```lino
(linked-program classifier-over-strict
  (uses portable-classifier
    (rebind foundation-decision strict-decision))
  (uses strict-foundation))

(linked-program classifier-over-permissive
  (uses portable-classifier
    (rebind foundation-decision permissive-decision))
  (uses permissive-foundation))
```

The mirrored acceptance test evaluates the unchanged `portable-classifier`
through both user-defined foundations. The same input derives `reject` under
the strict instance and `accept` under the permissive instance. Thus changing
the foundation changes semantics without changing object-theory source.

The bundled set rules are likewise written once and instantiated as
`set-theory-over-traditional-sequences` and
`set-theory-over-associative-links`. Rebinding `cons`/`empty` to
`sequence-cons`/`sequence-empty` or `link-cons`/`link-empty` changes their
representation while membership, insertion, union, subset, equality,
intersection, pairing, and replacement remain the same imported definitions.
The instances select `traditional-sequence-foundation` and
`associative-links-foundation`, respectively.

This is the minimal acceptance example from the review. Binding is encoded
with de Bruijn indices, and environments and closures are ordinary link
constructors:

```lino
(linked-rewrite lambda-calculus evaluate-bound-zero
  (from (evaluate (bound zero) (bind ?value ?environment)))
  (to ?value))

(linked-rewrite lambda-calculus evaluate-lambda
  (from (evaluate (lambda ?body) ?environment))
  (to (closure ?body ?environment)))

(linked-rewrite lambda-calculus invoke-closure
  (from (invoke (closure ?body ?environment) ?argument))
  (to (evaluate ?body (bind ?argument ?environment))))

(linked-rewrite lambda-calculus beta-reduction
  (from (beta (lambda ?body) ?argument))
  (to (substitute ?body ?argument)))
```

The shared program reduces
`(beta (lambda (bound zero)) (free a))` to `(free a)`. A nested-binder test
also proves the implementation is capture-safe. The linked-program engine and
`TheoryNetwork` verifier contain no lambda-specific substitution or
beta-reduction branch. The `S` and `K` program supplies a universal
combinatory basis as a second computational encoding.

## Contracts and witnesses

Theory-network forms bind a program to a checked definition:

```lino
(implementation implementation-name
  (contract contract-name)
  (program linked-program-name)
  (kind witness-kind)
  (subject theory-being-defined)
  (using defining-theory)
  (obligation operation-name))

(witness stable.definition.address
  (kind witness-kind)
  (implementation implementation-name)
  (proof proof-object-name))

(definition definition-name
  (subject theory-being-defined)
  (using defining-theory)
  (witness stable.definition.address))
```

The separately selected foundation fixes the corresponding contract and
executable cases:

```lino
(implementation-contract contract-name
  (kind witness-kind)
  (obligation operation-name))

# Reduction case
(conformance-case contract-name operation-name
  (program linked-program-name)
  (input arbitrary-term)
  (expected expected-normal-form))

# Or inference case
(conformance-case contract-name operation-name
  (program linked-program-name)
  (fact available-judgement)
  (goal required-judgement))
```

Construction admits a definition only when all of these checks agree:

1. candidate and foundation sources round-trip losslessly;
2. the implementation has the contract's exact kind and obligation set and is
   bound to the proposed subject/foundation pair;
3. every obligation executes successfully in the declared linked program;
4. any exact proof obligation replays through RML's proof checker; and
5. the witness proof names the exact definition, theories, implementation,
   and kind.

Candidates cannot declare their own contracts, conformance cases, proof
rules, axioms, assumptions, or exact proof obligations. Conversely, the
foundation cannot smuggle object-theory behavior into host code: conformance
uses the same linked machine for every program.

## Bundled theory programs

The source presents familiar mathematics and its link-level construction side
by side:

| Theory | Familiar presentation | Links-derived executable presentation |
|--------|-----------------------|---------------------------------------|
| Links meta-theory | addressed ordered pairs | `source`, `target`, and `address` rules over `(at A (link S T))` |
| Lambda calculus | binding, substitution, beta reduction | de Bruijn indices, link environments, closures, and beta rules |
| Set theory | membership, subset, equality, pairing, union, separation, replacement | `cons`/`empty` links plus recursive rules |
| Dependent types | universes, naturals, Pi formation, lambda, application, beta conversion | linked facts and inference rules |
| Graph theory | vertices, endpoint closure, reachability, edge typing | facts and least-closure inference over edge links |
| Relational algebra | closure, converse, union, intersection, composition, pair typing | inference over `relates` links |
| Relative Meta-Logic | Boolean negation/conjunction and confidence minimum | replaceable linked rewrite rules |

Graph theory is a derived subset of a links network, not the ambient model.
Relational algebra is another derived interpretation of typed ordered-pair
links. The public `LinkGraph` and `FiniteRelation` classes remain useful data
stores, but `TheoryNetwork` does not use them to authorize a definition.

The network of definitions is cyclic by design:

```text
Relative Meta-Logic -> Links Theory -> Set Theory
                                  \-> Type Theory
                                  \-> Links Theory

Graph Theory       -> Set Theory, Type Theory
Relational Algebra -> Set Theory, Type Theory
```

Path queries keep a visited set. Local terms share explicit concept addresses,
so `translateTerm` / `translate_term` translates through data rather than a
hard-coded vocabulary.

## Loading the bundled network

The executable program forms and network declarations are concatenated as one
candidate source. The trust profile remains separate:

```js
import { readFileSync } from 'node:fs';
import { TheoryNetwork } from './js/src/rml-theory-network.mjs';

const programs = readFileSync('lib/meta-theory/universal.lino', 'utf8');
const declarations = readFileSync('lib/meta-theory/core.lino', 'utf8');
const foundation = readFileSync('lib/meta-theory/foundation.lino', 'utf8');
const network = TheoryNetwork.fromRml(
  `${programs}\n${declarations}`,
  foundation,
);

network.definitionVerification('links-by-sets');
network.definitionChain('relative-meta-logic', 'type-theory');
```

Rust uses `TheoryNetwork::from_rml` with the same three source files. Use
`LinkedProgramRegistry.fromRml` / `LinkedProgramRegistry::from_rml` directly
when only reduction or inference is needed.

## Adding a logic without host changes

A user can define double-negation elimination entirely in candidate links:

```lino
(linked-program user-logic)

(linked-rewrite user-logic eliminate-double-negation
  (from (negate (negate ?proposition)))
  (to ?proposition))
```

After the selected foundation supplies a contract and reduction case, an
ordinary implementation/witness/definition triple verifies it. Mirrored tests
do this with previously unknown names and no callback. More complex programs
can mix rewrites, facts, inference rules, and rebound imports.

### Migrating from 0.20

Version 0.21 replaces host adapter callbacks with linked programs. In an
implementation form, replace `(adapter adapter-name)` with `(contract
contract-name)` and `(program program-name)`, then express the operation in
`linked-rewrite`, `linked-fact`, or `linked-inference` forms. The selected
foundation supplies matching `implementation-contract` and `conformance-case`
forms.

The JavaScript `adapterProbes` option and Rust
`from_rml_with_adapter_probes`/`AdapterProbeRegistry` API have been removed.
Callers that previously injected a callback should place the same semantics in
a linked program; no host registration step is needed.

## Sequences, sets, and self-reference

The host data-store APIs implement the upstream 0.0.3 representation contract:

- `encodeSequence` / `encode_sequence` writes balanced, left-staircase, or
  right-staircase nested doublet trees;
- `encodeSet` / `encode_set` writes sorted unique balanced trees;
- `MembershipSetStore` is the independent extensional membership-link view;
  and
- bounded `walk` observes direct or indirect right-spine cycles without
  claiming termination.

These convenience APIs are tested in both languages. Their corresponding
mathematical obligations are also represented in `universal.lino` and checked
through linked conformance cases.

## API correspondence

| Purpose | JavaScript | Rust |
|---------|------------|------|
| Parse linked programs | `LinkedProgramRegistry.fromRml` | `LinkedProgramRegistry::from_rml` |
| Inspect K0 boundary | `LinkedProgramRegistry.bootstrapKernelReport` | `LinkedProgramRegistry::bootstrap_kernel_report` |
| Audit K0 trust graph | `LinkedProgramRegistry.auditBootstrapKernel` | `LinkedProgramRegistry::audit_bootstrap_kernel` |
| Reduce with a program | `reduce` | `reduce` |
| Prove a linked judgement | `prove` | `prove` |
| Parse theory network | `TheoryNetwork.fromRml` | `TheoryNetwork::from_rml` |
| Parse pinned formal corpus | `FormalCorpus.fromRml` | `FormalCorpus::from_rml` |
| Resolve/translate local terms | `resolveTerm` / `translateTerm` | `resolve_term` / `translate_term` |
| Query definition evidence | `definitionVerification` | `definition_verification` |
| Find a definition chain | `definitionChain` | `definition_chain` |
| Store unrestricted/typed links | `LinkNetwork` / `TypedLinkNetwork` | `LinkNetwork` / `TypedLinkNetwork` |
| Execute finite graphs/relations | `LinkGraph` / `FiniteRelation` | `LinkGraph` / `FiniteRelation` |
| Store extensional sets | `MembershipSetStore` | `MembershipSetStore` |
| Encode/decode sequences | `encodeSequence` / `decodeSequence` | `encode_sequence` / `decode_sequence` |
| Observe a right-spine sequence | `walk` | `walk` |

## External formal corpus boundary

[`upstream-0.0.3.lino`](../lib/meta-theory/upstream-0.0.3.lino) is a pinned,
queryable record of the upstream Lean and Rocq sources: 18 modules, 229
declarations, 8,815 typed tokens, and 510 dependency links. Its independent
fingerprint contract and CI extraction catch source drift. Four Lean
declarations containing `sorry` remain explicitly marked admitted.

That corpus is comparison and provenance evidence only. RML does not delegate
its linked-program reduction, inference, contract conformance, or witness
checking to Lean or Rocq. Native proof-assistant builds may cross-check the
pinned external artifacts, but they are not an oracle in the RML reasoning
path and cannot make a linked definition pass.

## Verification and scope

Mirrored tests cover the lambda acceptance example, user-defined programs,
malformed rules, rewrite cycles, finite inference bounds, all bundled
conformance cases, exact witness proofs, trust-boundary rejection, shared
addresses, sequence/set encodings, graph/relation operations, and the pinned
external corpus. See the issue-specific
[`requirements.md`](./case-studies/issue-183/requirements.md) for the complete
requirement-to-evidence matrix.

The generic machine is intentionally small. An addressed-link semantic program
is lowered to S/K, whose two externally primitive transition laws supply the
current universal computation substrate. The explicit K0/K1 split lets users
encode and self-interpret proof systems. This does not make bounded saturation
a decision procedure for every logic, and it does not silently treat arbitrary
Lean or Rocq syntax as native RML semantics.
