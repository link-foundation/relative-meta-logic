# relative-meta-logic — JavaScript

JavaScript implementation of the Relative Meta-Logic (RML) framework.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.0.0

## Installation

```bash
cd js
npm install
```

## Usage

### Running a knowledge base

```bash
node src/rml-links.mjs <file.lino>
```

Literate `.lino.md` files are also accepted by evaluator entry points. Only
fenced `lino` code blocks are evaluated; prose and other fenced languages are
ignored. The same extraction applies to files loaded through `(import "...")`.

### Exporting Lean 4

```bash
node src/rml-links.mjs export lean ../examples/lean-export-basic.lino -o out.lean
```

The supported subset is documented in [`../docs/LEAN_EXPORT.md`](../docs/LEAN_EXPORT.md).

The shared examples live at the repo root in [`/examples/`](../examples/) and
both implementations are required to produce identical output for every file
there. To run one:

```bash
node src/rml-links.mjs ../examples/classical-logic.lino
```

Or use the npm script (runs `../examples/demo.lino`):

```bash
npm run demo
```

### Exporting Isabelle/HOL

```bash
node src/rml-links.mjs export isabelle ../examples/isabelle-typed-fragment.lino -o Isabelle_Typed_Fragment.thy
```

The supported subset is documented in
[`../docs/ISABELLE-EXPORT.md`](../docs/ISABELLE-EXPORT.md).

### Exporting Rocq source

```bash
node src/rml-links.mjs export rocq ../examples/dependent-types.lino -o dependent_types.v
```

See [`../docs/ROCQ-EXPORT.md`](../docs/ROCQ-EXPORT.md) for the supported
typed subset.

### Language Server Protocol

```bash
node src/rml-lsp.mjs
```

The LSP server is stdio-based and is normally launched by an editor. It
publishes evaluator diagnostics and supports hover, go-to-definition, and
completion for `.lino` files. Neovim and Helix setup examples are documented
in [`../docs/LANGUAGE_SERVER.md`](../docs/LANGUAGE_SERVER.md).

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

```javascript
import {
  run,
  evaluate,
  formatDiagnostic,
  Diagnostic,
  RmlError,
  parseLino,
  parseLinoDocument,
  parseLinoForms,
  LinoParseError,
  tokenizeOne,
  parseOne,
  Env,
  evalNode,
  runTactics,
  goalToTptp,
  parseAtpStatus,
  rewrite,
  simplify,
  automaticSequencesDomainPlugin,
  decideAutomaticSequenceTheorem,
  quantize,
  decRound,
  keyOf,
  isNum,
  parseBinding,
  parseBindings,
  subst,
  substitute,
  formalizeSelectedInterpretation,
  evaluateFormalization,
  exportIsabelle,
} from './src/rml-links.mjs';
import { exportLean } from './src/lean-export.mjs';

// Run a complete LiNo knowledge base
const results = run(linoText);

// Run with custom range and valence
const results2 = run(linoText, { lo: -1, hi: 1, valence: 3 });

// Structured evaluation: never throws, returns diagnostics for every error.
// See ../docs/DIAGNOSTICS.md for the error-code table.
const { results: out, diagnostics } = evaluate(linoText, { file: 'kb.lino' });
for (const d of diagnostics) {
  console.error(formatDiagnostic(d, linoText));
}

// Read LiNo text through the shared front end that evaluate() uses: the
// texts of its top-level forms, the forms with their positions, or the ASTs.
// Text that is not valid LiNo throws a LinoParseError (code E006) that names
// the 1-based line and code-point column of the failure.
parseLino('(a: a is a)\n(? (a = a))'); // -> ['(a: a is a)', '(? (a = a))']
parseLinoDocument('  (? (a = a))'); // -> [{ text: '(? (a = a))', line: 1, col: 3, length: 1 }]
parseLinoForms('(? (a = a))'); // -> [['?', ['a', '=', 'a']]]
try {
  parseLino('(a: a is a)\n(? (a = a)');
} catch (err) {
  if (!(err instanceof LinoParseError)) throw err;
  // err.message === 'LiNo parse failure: unexpected end of input'; err.line === 2, err.col === 11
}

// Parse and evaluate individual expressions
const env = new Env({ lo: 0, hi: 1, valence: 3 });
const ast = parseOne(tokenizeOne('(a = a)'));
const truthValue = evalNode(ast, env);

// Register a domain plugin, or use the built-in automatic-sequences plugin
// that is already registered on new Env instances.
env.registerDomainPlugin('automatic-sequences', automaticSequencesDomainPlugin);
const theorem = decideAutomaticSequenceTheorem('thue-morse-cube-free');

// Apply link tactics to a proof state
const tacticResult = runTactics(
  { goals: [parseOne(tokenizeOne('(a = a)'))] },
  [parseOne(tokenizeOne('(by reflexivity)'))],
);
// -> { state: { goals: [], proof: [['by', 'reflexivity']] }, diagnostics: [] }

const atpResult = runTactics(
  { goals: [parseOne(tokenizeOne('(P a)'))] },
  [parseOne(tokenizeOne('(by atp)'))],
  { atp: { path: 'eprover', args: ['-'], name: 'eprover', timeoutMs: 5000 } },
);

const rewritten = rewrite(
  parseOne(tokenizeOne('(b = b)')),
  parseOne(tokenizeOne('(a = b)')),
  { direction: 'backward' },
);
const simplified = simplify(
  parseOne(tokenizeOne('((f a) = (f a))')),
  [parseOne(tokenizeOne('(a = b)'))],
);
const tptp = goalToTptp({ goal: parseOne(tokenizeOne('(P a)')) });
const szs = parseAtpStatus('% SZS status Theorem for rml_goal');

// Quantize a value to N discrete levels
const q = quantize(0.4, 3, 0, 1); // -> 0.5 (nearest ternary level)

// Adapter for consumers that already selected an interpretation
const formalization = formalizeSelectedInterpretation({
  text: '0.1 + 0.2 = 0.3',
  interpretation: {
    kind: 'arithmetic-equality',
    expression: '0.1 + 0.2 = 0.3',
  },
  formalSystem: 'rml-arithmetic',
});
const evaluation = evaluateFormalization(formalization);
// -> { computable: true, result: { kind: 'truth-value', value: 1, deterministic: true }, ... }
```

The meta-expression adapter deliberately keeps unsupported real-world claims partial. A selected interpretation such as `moon orbits the Sun` is returned as non-computable with explicit unknowns until a consumer supplies a formal shape and reproducible dependencies.

The meta-theory network is available as a separate module so it can consume the
main parser and the `meta-language` bridge without changing evaluator state:

Linked-program imports support
`(rebind abstract-concept selected-concept)` for foundation polymorphism.
`LinkedProgramRegistry.bootstrapKernelReport()` exposes the complete
theory-independent boundary: `S` and `K` contraction, representation parsing,
and external resource control. Matching, substitution, rule traversal,
import/rebinding, inference saturation, and verification are closed combinator
terms, so the derived-host-service and object-semantics lists are empty.
`LinkedProgramRegistry.auditBootstrapKernel()` fails when the executable host
operation manifest and that graph differ or when any dependency branch does
not terminate in K0. The report calls K0 the current bootstrap boundary and
does not claim that it is irreducible.
`LinkedProgramRegistry.bootstrapMetricsReport(universalSource)` goes further:
it observes actual load/reduce/prove/K1 execution, fault-injects every host
operation, checks every observed path segment against trust-graph reachability,
and publishes layer, duplication, closure, compression, and previous/current
metrics under `rml-bootstrap-metrics/v4`. The current result reports two host
semantic operations, zero duplicated semantics, 6/6 linked closure, and 2/8
compression. Fault injection classifies S and K as experimentally necessary
for this representation and acceptance probe, without claiming global
irreducibility.

For falsification across architectures,
`LinkedProgramRegistry.fromRml(source, { executionBasis })` accepts `s-k`,
`direct-structural`, or `horn-relational`. The latter two do not invoke the
closed-term compiler. `foundationSearchReport` runs the common nine-operation
workload, 13 removal experiments, the linked two-counter machine, language
semantic cores, and a guarded referential proof knot. Run the versioned JSON
report with `npm run report:foundation-search`; its claim boundary is
documented in `docs/case-studies/issue-183/foundation-search.md`. The report's
eligibility gate excludes the direct and Horn controls from ranking while
they retain host/self duplication. Its executable two-model witness shows
only that one ordered-link host representation does not select between two
tested transition functions. `npm run report:link-ontology` separately
exhausts the binary contract and its observation boundary. Equality gives two
width-two classes; the same vocabulary gives 1, 2, 3, and 5 multiplicity
classes at widths one through four. A conditional second equivalence has 33
joint classes and 5–9 refinements per coarse fibre. Its singleton-orbit
histogram is 20/5/7/1 for 0/1/2/4 singleton orbits, and provenance separates
7 base-forced, 5 refinement-present, 1 interaction-only, and 20 symmetric
classes. All 73 candidate observations at widths one through four that preserve
their base symmetries leave the base occurrence orbits unchanged. The
interaction-only conditional breaks a relabelling that fixes its base, so it
requires information not derived from that base. The v11 starting-representation
audit additionally shows that direct-self `[0,0,1]` and fresh-external
`[0,1,2]` links share the `[1,1]` reference-only projection. Forgetting the
link address collapses `2/4/7/12` addressable classes to `1/2/3/5` at widths
one through four and is non-injective at every nonzero finite arity. Before
slot permutation, all `2/4/8/16` self-incidence masks occur at those widths;
address renaming preserves the mask, and slot permutation transports it
equivariantly. Combined with the reference-equality matrix, it classifies the
tested ordered address/equality patterns without assigning endpoint meaning.
Across two through four ordered one-reference links, those local descriptors
collapse `10/77/799` shared-address classes to `4/8/16`. The
external-reference pair `[[0,1],[2,3]]` and two-link incidence cycle
`[[0,2],[2,0]]` are a concrete countermodel. Cross-reference equality plus
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
Adding ordinary evidence link `[9,7,7]` to duplicate candidates `[7,0,2]` and
`[8,0,2]` breaks their swap symmetry but leaves both opposite singleton
readings equivariant. Removal, replacement, duplication, isomorphic forgery,
context relocation, and finite/self-referential authority variants do not
confer authenticity, activation, or execution. Link-carried incidence can
therefore permit selection without forcing authority, and the probe does not
prove that external authority is irreducible.
An exact-cover certificate follow-up conditionally rejects missing, duplicate,
foreign, and wrong linked evidence and enumerates `ZERO`/`ONE`/`MANY` passing
candidates. A locally isomorphic second candidate remains admissible; the
verifier, role assignment, cardinality classification, admission, activation,
and execution remain external or unresolved.
The v11 local-verifier probe replaces the bespoke record reconstruction check
with a reusable incidence join and emits four-link traces. Trace replay is
possible, but the join still depends on host iteration, position access,
equality, counting, and externally selected roles.
The v14 report treats these as finite, provenance-labelled constraints,
not a link ontology or execution law. Primitive
categories, the structure/transformation relation, intrinsic authority, and
comparative minimality remain unresolved. All three implementations are
executable controls and cannot constrain the independent search or select a
target architecture.

```javascript
import { readFileSync } from 'node:fs';
import {
  DoubletSequenceStore,
  FiniteRelation,
  LinkGraph,
  LinkNetwork,
  MembershipSetStore,
  TheoryNetwork,
  TypedLinkNetwork,
} from './src/rml-theory-network.mjs';

const source = readFileSync('../lib/meta-theory/core.lino', 'utf8');
const trustedFoundation = readFileSync('../lib/meta-theory/foundation.lino', 'utf8');
const network = TheoryNetwork.fromRml(source, trustedFoundation);
const path = network.definitionChain('relative-meta-logic', 'type-theory');
const translated = network.translateTerm('set-theory', 'reference', 'links-theory');
const verification = network.definitionVerification('links-by-sets');

const rawLinks = new LinkNetwork();
rawLinks.define('link-ab', 'a', 'b');
const typedLinks = new TypedLinkNetwork();
typedLinks.declare('a', 'Example');
typedLinks.declare('b', 'Example');
typedLinks.define('typed-link-ab', 'a', 'b', 'Example', 'Example');
const sequences = new DoubletSequenceStore();
const finite = sequences.encodeSequence(['a', 'b', 'c', 'd'], 'finite', 'balanced');
const values = sequences.decodeSequence(finite);
const set = sequences.encodeSet(['b', 'a', 'b'], 'canonical-set');
const membershipSets = new MembershipSetStore();
membershipSets.define('a-in-example', 'a', 'example-set');
const graph = new LinkGraph('example-graph');
graph.addVertex('a');
graph.addVertex('b');
graph.defineEdge('edge-ab', 'a', 'b');
const relation = new FiniteRelation('example-relation', ['a'], ['b']);
relation.define('pair-ab', 'a', 'b');
sequences.define('loop', 'value', 'loop');
const prefix = sequences.walk('loop', 3);
```

See [`docs/META_THEORY.md`](../docs/META_THEORY.md) for the shared linked
rewrite/inference format, exact implementation contracts, checked proof
witnesses, unified addresses, both finite-set interpretations, derived
graph/relation semantics, nested sequence/set encodings, and cycle semantics.

## Testing

```bash
npm test
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
- Checked cross-theory definitions, unified concept addresses, two finite-set interpretations, and addressed doublet sequences
- Self-referential types: `(Type: Type Type)`, paradox resolution alongside types

## Dependencies

- [`links-notation`](https://github.com/link-foundation/links-notation) — official LiNo parser

## License

See [LICENSE](../LICENSE) file.
