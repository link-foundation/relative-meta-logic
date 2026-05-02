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
} from './src/rml-links.mjs';

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
- Dependent type system: universes, Pi-types, lambdas, application, capture-avoiding substitution, freshness, type queries
- Self-referential types: `(Type: Type Type)`, paradox resolution alongside types

## Dependencies

- [`links-notation`](https://github.com/link-foundation/links-notation) — official LiNo parser

## License

See [LICENSE](../LICENSE) file.
