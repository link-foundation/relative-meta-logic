# relative-meta-logic — Rust

Rust implementation of the Relative Meta-Logic (RML) framework.

## Prerequisites

- [Rust](https://rustup.rs/) (edition 2021)

## Building

```bash
cd rust
cargo build
```

## Usage

### Running a knowledge base

```bash
cargo run -- <file.lino>
```

Literate `.lino.md` files are also accepted by evaluator entry points. Only
fenced `lino` code blocks are evaluated; prose and other fenced languages are
ignored. The same extraction applies to files loaded through `(import "...")`.

### Exporting Lean 4

```bash
cargo run -- export lean ../examples/lean-export-basic.lino -o out.lean
```

The supported subset is documented in [`../docs/LEAN_EXPORT.md`](../docs/LEAN_EXPORT.md).

The shared examples live at the repo root in [`/examples/`](../examples/) and
both implementations are required to produce identical output for every file
there. To run one:

```bash
cargo run -- ../examples/classical-logic.lino
```

Or after building:

```bash
./target/release/rml ../examples/classical-logic.lino
```

### Exporting Rocq source

```bash
cargo run -- export rocq ../examples/dependent-types.lino -o dependent_types.v
```

See [`../docs/ROCQ-EXPORT.md`](../docs/ROCQ-EXPORT.md) for the supported
typed subset.

### Example

```lino
(a: a is a)
(!=: not =)
(and: avg)
(or: max)

((a = a) has probability 1)
((a != a) has probability 0)

(? ((a = a) and (a != a)))   # -> 0.5
(? ((a = a) or  (a != a)))   # -> 1
```

## API

```rust
use rml::{
    run, evaluate, format_diagnostic, Diagnostic, EvaluateResult, RunResult, Span,
    tokenize_one, parse_one, Env, EnvOptions, eval_node, quantize, dec_round, subst,
    run_tactics, rewrite, simplify, goal_to_tptp, parse_atp_status, ProofState,
    automatic_sequences_domain_plugin, decide_automatic_sequence_theorem,
    export_lean,
    formalize_selected_interpretation, evaluate_formalization,
    FormalizationRequest, Interpretation,
};

// Run a complete LiNo knowledge base
let results = run(lino_text, None);

// Run with custom range and valence
let results2 = run(lino_text, Some(EnvOptions { lo: -1.0, hi: 1.0, valence: 3 }));

// Structured evaluation: never panics, returns diagnostics for every error.
// See ../docs/DIAGNOSTICS.md for the error-code table.
let evaluation = evaluate(lino_text, Some("kb.lino"), None);
for diag in &evaluation.diagnostics {
    eprintln!("{}", format_diagnostic(diag, Some(lino_text)));
}

// Parse and evaluate individual expressions
let mut env = Env::new(Some(EnvOptions { lo: 0.0, hi: 1.0, valence: 3 }));
let tokens = tokenize_one("(a = a)");
let ast = parse_one(&tokens).unwrap();
let truth_value = eval_node(&ast, &mut env);

// Register a domain plugin, or use the built-in automatic-sequences plugin
// that is already registered on new Env instances.
env.register_domain_plugin("automatic-sequences", automatic_sequences_domain_plugin);
let theorem = decide_automatic_sequence_theorem("thue-morse-cube-free");

// Apply link tactics to a proof state
let tactic = parse_one(&tokenize_one("(by reflexivity)")).unwrap();
let goal = parse_one(&tokenize_one("(a = a)")).unwrap();
let tactic_result = run_tactics(ProofState::from_goals(vec![goal]), &[tactic]);
// -> tactic_result.state.goals is empty, diagnostics is empty

let eq = parse_one(&tokenize_one("(a = b)")).unwrap();
let rewritten = rewrite(&parse_one(&tokenize_one("(a = a)")).unwrap(), &eq).unwrap();
let simplified = simplify(&parse_one(&tokenize_one("((f a) = (f a))")).unwrap(), &[eq]).unwrap();

// Quantize a value to N discrete levels
let q = quantize(0.4, 3, 0.0, 1.0); // -> 0.5 (nearest ternary level)

// Adapter for consumers that already selected an interpretation
let formalization = formalize_selected_interpretation(FormalizationRequest {
    text: "0.1 + 0.2 = 0.3".to_string(),
    interpretation: Interpretation::arithmetic_equality("0.1 + 0.2 = 0.3"),
    formal_system: "rml-arithmetic".to_string(),
    dependencies: vec![],
});
let evaluation = evaluate_formalization(&formalization);
// -> computable truth-value result 1.0
```

The meta-expression adapter deliberately keeps unsupported real-world claims partial. A selected interpretation such as `moon orbits the Sun` is returned as non-computable with explicit unknowns until a consumer supplies a formal shape and reproducible dependencies.

The `rml::theory_network` module loads the shared linked programs from
`lib/meta-theory/universal.lino`, declarations from
`lib/meta-theory/core.lino`, and the independently selected
`lib/meta-theory/foundation.lino` trust profile through `meta-language`.
`TheoryNetwork` provides proof-checked executable definition links,
unified-address lookup and translation, inspectable implementation contracts,
and cycle-safe definition chains. All contract operations run through the
same structural rewrite/inference machine; object theories are not Rust
callbacks. Imports support `(rebind abstract-concept selected-concept)` for
foundation polymorphism, and
`LinkedProgramRegistry::bootstrap_kernel_report()` exposes the complete
theory-independent boundary: `S` and `K` contraction, representation parsing,
and external resource control. Matching, substitution, rule traversal,
import/rebinding, inference saturation, and verification execute as closed
combinator terms, leaving no derived host semantic services or object
semantics.
`LinkedProgramRegistry::audit_bootstrap_kernel()` rejects an unreported host
operation or a graph path that does not terminate in K0. The report identifies
the current bootstrap boundary reached by the experiments; it does not call
that boundary irreducible.
`LinkedProgramRegistry::bootstrap_metrics_report(universal_source)` executes
the mirrored runtime and removal probes. It reports two semantic contractions,
zero duplication, 6/6 linked closure, and 2/8 foundation compression, while
checking observed paths against graph reachability. S/K necessity is scoped to
the current representation and probe rather than presented as global
irreducibility.
`LinkedProgramRegistry::from_rml_with_basis` additionally exposes
`ExecutionBasis::{ClosedSk, DirectStructural, HornRelational}` for the
architecture-neutral comparison. The mirrored foundation-search suite runs
the same workload, counter-machine and language cores, guarded referential
witness, and all 13 primitive-removal experiments without allowing the two
non-combinator mechanisms to observe S/K. The same suite checks the
host-representation boundary witness; the machine-readable report excludes
the less-reduced controls from ranking and names no foundation winner.
`link_ontology_symmetry_report` independently exhausts the binary contract and
its observation boundary. Equality gives two width-two classes; the same
vocabulary gives 1, 2, 3, and 5 multiplicity classes at widths one through
four. A conditional second equivalence has 33 joint classes and 5–9
refinements per coarse fibre. Its singleton-orbit histogram is 20/5/7/1 for
0/1/2/4 singleton orbits, and provenance separates 7 base-forced, 5
refinement-present, 1 interaction-only, and 20 symmetric classes. All 73
candidate observations at widths one through four that preserve their base
symmetries leave the base occurrence orbits unchanged. The interaction-only
conditional breaks a relabelling that fixes its base, so it requires
information not derived from that base. The v8 starting-representation audit
also shows that direct-self `[0,0,1]` and fresh-external `[0,1,2]` links share
the `[1,1]` reference-only projection. Forgetting the link address collapses
`2/4/7/12` addressable classes to `1/2/3/5` at widths one through four and is
non-injective at every nonzero finite arity. Before occurrence permutation,
all `2/4/8/16` slotwise self-incidence masks occur at widths one through four;
they are invariant under address renaming and equivariant under slot
permutation. Together with the reference-equality matrix they classify the
tested ordered patterns without assigning intrinsic endpoint meaning.
Across two through four ordered one-reference links, those local descriptors
collapse `10/77/799` shared-address classes to `4/8/16`. The
external-reference pair `[[0,1],[2,3]]` and two-link incidence cycle
`[[0,2],[2,0]]` form a concrete countermodel. Cross-reference equality plus
reference-to-link-address incidence classifies the tested shared contract
without assigning incidence an endpoint, dependency, transition, or execution
role. The structural application/composition probe keeps `→`, `⟼`,
composition, and execution distinct. Its connected
`[[3,0,1],[4,1,2],[5,2,0],[6,6,3]]` countermodel keeps `P`/`Q` distinct from
`K`/`A`/`B` and has `K ⟼ A`, `A ⟼ B`, direct self-incidence, a shared address,
and recursion without `K ⟼ B`; adding `K ⟼ B` preserves those premises.
Binary formation permits all `49` ordered pairs on the seven addresses but
selects none, and the recursive candidates
recover no unique function/argument/result roles. A positive application or
composition semantics therefore requires an additional selection/closure law.
The v11 report treats these as finite, provenance-labelled constraints,
not a link ontology or execution law. Primitive categories, the
structure/transformation relation, intrinsic
authority, and comparative minimality remain unresolved; A/B/C cannot
constrain the independent search or select its target architecture.
`MembershipSetStore` provides addressed
membership links and finite set algebra;
`DoubletSequenceStore` provides finite balanced/left/right sequence trees,
canonical and order-preserving sets, and bounded observation of
self-referential right spines. `LinkNetwork` is the unconstrained substrate;
`TypedLinkNetwork` enforces endpoint types, `LinkGraph` is its
vertex-constrained graph subset with typed edges, and `FiniteRelation` executes
typed converse, union, intersection, and composition. See
[`docs/META_THEORY.md`](../docs/META_THEORY.md) for the complete contract.

## Testing

```bash
cargo test
```

The test suite covers:
- Tokenization, parsing, and quantization
- Evaluation logic and operator aggregators
- Many-valued logics: unary, binary (Boolean), ternary (Kleene), quaternary, quinary, higher N-valued, and continuous (fuzzy)
- Both `[0, 1]` and `[-1, 1]` ranges
- Liar paradox resolution across logic types
- Decimal-precision arithmetic and numeric equality
- Dependent type system: universes, Pi-types, lambdas, application, definitional equality, capture-avoiding substitution, freshness, type queries
- Link-based tactic engine: reflexivity, symmetry, transitivity, induction, suppose, introduce, by, rewrite, simplify, exact
- Domain plugins: Pecan-style automatic-sequence theorem decisions
- Checked cross-theory definitions, unified concept translation, two finite-set interpretations, nested doublet trees, and bounded cyclic sequences
- Self-referential types: `(Type: Type Type)`, paradox resolution alongside types

## Implementation Notes

The Rust implementation uses the official [`links-notation`](https://crates.io/crates/links-notation) crate for LiNo parsing. The implementation is a direct port of the JavaScript version and produces identical results for all test cases.

## License

See [LICENSE](../LICENSE) file.
