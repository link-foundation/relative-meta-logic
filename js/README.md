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

The meta-theory graph is available as a separate module so it can consume the
main parser and the `meta-language` bridge without changing evaluator state:

```javascript
import { readFileSync } from 'node:fs';
import { TheoryGraph, DoubletSequenceStore } from './src/rml-theory-graph.mjs';

const source = readFileSync('../lib/meta-theory/core.lino', 'utf8');
const graph = TheoryGraph.fromRml(source);
const path = graph.definitionPath('relative-meta-logic', 'type-theory');

const sequences = new DoubletSequenceStore();
sequences.define('loop', 'value', 'loop');
const prefix = sequences.walk('loop', 3);
```

See [`docs/META_THEORY.md`](../docs/META_THEORY.md) for the shared source
format, unified addresses, set encodings, and cycle semantics.

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
- Cross-theory definition paths, unified concept addresses, and addressed doublet sequences
- Self-referential types: `(Type: Type Type)`, paradox resolution alongside types

## Dependencies

- [`links-notation`](https://github.com/link-foundation/links-notation) — official LiNo parser

## License

See [LICENSE](../LICENSE) file.
