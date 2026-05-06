# Diagnostics

RML reports every parser, evaluator, and type-checker error as a structured
**Diagnostic** value rather than throwing or panicking. This makes failures
easy to consume programmatically (an editor, a test runner, a tool that
reports errors in a UI) and gives the CLI everything it needs to print a
familiar `file:line:col` message with a caret under the offending token.

The two reference implementations (`js/src/rml-links.mjs` and
`rust/src/lib.rs`) share the same diagnostic shape, error-code table, and
formatting rules so output stays consistent across runtimes.

## Diagnostic shape

```
Diagnostic {
  code:    "Exxx",            // see the table below
  message: "human-readable summary",
  span: {
    file:   "kb.lino" | null, // input file, when known
    line:   1,                // 1-based line of the offending form
    col:    1,                // 1-based column
    length: 1,                // length used to render carets ("^^^")
  }
}
```

### JavaScript

```js
import { evaluate, formatDiagnostic } from 'relative-meta-logic';

const { results, diagnostics } = evaluate(source, { file: 'kb.lino' });

for (const d of diagnostics) {
  console.error(formatDiagnostic(d, source));
}
```

`evaluate(code, options?)` never throws. Successful queries appear in
`results`; everything else is a `Diagnostic` in `diagnostics`.

### Rust

```rust
use rml::{evaluate, format_diagnostic};

let evaluation = evaluate(&source, Some("kb.lino"), None);
for diag in &evaluation.diagnostics {
    eprintln!("{}", format_diagnostic(diag, Some(&source)));
}
```

`evaluate` returns an `EvaluateResult { results, diagnostics }`. Internal
panics raised by the evaluator are caught and converted into diagnostics —
the panic hook is silenced for the duration of the call so a stack trace
never leaks to stderr.

## CLI output

Both CLIs (`node js/src/rml-links.mjs <file>` and `rml <file>`) print
diagnostics in this format:

```
kb.lino:3:1: E001: Unknown op: foo
(=: foo bar)
^
```

The exit code is `1` whenever any diagnostic is emitted, `0` otherwise.

## Error codes

| Code | When it fires |
|------|----------------------------------------------------------------|
| `E000` | Generic / unclassified error fallback. |
| `E001` | Reference to an undefined operator (`Unknown op: <name>`). Triggered, for example, by composing one operator from an unknown one: `(=: foo bar)`. |
| `E002` | Token-level parse error inside a single link (missing `)`, extra tokens, etc.). |
| `E003` | An operator definition has the right head but the wrong shape, e.g. `(=: a b c)` — the operator is real but the body is unsupported. |
| `E004` | Unknown aggregator selector, e.g. `(and: bogus_agg)`. Valid selectors are `avg`, `min`, `max`, `product`/`prod`, `probabilistic_sum`/`ps`. |
| `E005` | Empty meta-expression passed to a formalization helper. |
| `E006` | LiNo top-level parse failure, e.g. unclosed paren in the whole file. |
| `E007` | Import error: cycle in the file dependency graph, missing import target, or non-string import target. Triggered by `(import "<path>")` directives. |
| `E008` | Shadowing warning: a top-level definition rebinds a name introduced by an earlier `(import …)`. Triggered, for example, by `(import "lib.lino") (myop: max)` when `lib.lino` already defines `myop`. The redefinition still takes effect — `E008` is informational, not fatal. |
| `E009` | Namespace or alias error: invalid namespace name (empty or dotted, e.g. `(namespace foo.bar)`), or an alias collision between two `(import "..." as <alias>)` directives in the same file. |
| `E010` | Freshness error: `(fresh x in body)` tried to introduce a name that already appears in the current evaluator context. |
| `E020` | Bidirectional checker: `synth(term)` could not infer a type — e.g. a bare symbol with no recorded type, or a malformed universe level. |
| `E021` | Bidirectional checker: definitional type mismatch. Either `check(term, T)` synthesised a different type, or a lambda parameter type does not agree with the Pi domain it is checked against. |
| `E022` | Bidirectional checker: application head does not synthesise to a Pi-type. Triggered by `(apply f a)` where `f` lacks a Pi annotation. |
| `E023` | Bidirectional checker: lambda checked against a non-Pi expected type. Triggered by `check((lambda (A x) body), T)` where `T` is not of the form `(Pi (...) ...)`. |
| `E024` | Bidirectional checker: malformed binder in a `Pi` or `lambda` form. Triggered when the second child is not a recognisable `(Type x)` or `(x: Type)` pair. |
| `E030` | Malformed `(mode …)` declaration. Triggered when the relation name is missing or non-symbolic, no mode flags follow it, or a flag other than `+input`, `-output`, or `*either` is supplied. |
| `E031` | Mode mismatch at a call site. Triggered when a relation with a recorded `(mode …)` declaration is called with the wrong number of arguments, or when an `+input` slot receives a non-ground argument (e.g. an unbound or fresh variable). |
| `E032` | Totality / relation-declaration error. Triggered by a malformed `(relation …)` declaration (no clauses, or a clause whose head differs from the relation name); a malformed `(total …)` driver form; or a `(total <name>)` whose recursive calls fail to structurally decrease at least one `+input` argument. The message names the failing clause and quotes the offending recursive call. |
| `E033` | Inductive-declaration error. Triggered by a malformed `(inductive Name …)` form: a type name that is missing or does not start with an uppercase letter; an empty constructor list; a constructor clause that is not `(constructor <name>)` or `(constructor (<name> (Pi …)))`; the same constructor declared more than once; or a constructor whose `Pi` type does not return the inductive type. |
| `E034` | Worlds error. Triggered by a malformed `(world <name> (<const>...))` declaration (non-symbolic relation name, missing allow-list, or non-symbolic constant entries); or by a call site `(<rel> arg ...)` whose arguments mention a free constant outside the relation's declared world. Numeric literals, the relation's own name, locally-bound names (introduced by `lambda`/`Pi`/`fresh`), and reserved keywords are excluded. Relation clauses are intentionally not checked — see `KERNEL.md` for the rationale. |
| `E035` | Termination / definition-declaration error. Triggered by a malformed `(define <name> [(measure ...)] (case ...) ...)` form (missing or non-symbolic name, no clauses, malformed `(case ...)` or `(measure ...)`); a malformed `(terminating ...)` driver form; or a `(terminating <name>)` whose recursive calls fail to structurally decrease the matching clause's first argument (default) or the declared lexicographic measure. The message names the failing clause and quotes the offending recursive call. |
| `E036` | Coinductive-declaration error. Triggered by a malformed `(coinductive Name …)` form (missing or lowercase type name, empty constructor list, malformed constructor clause, duplicate constructor name, or a constructor whose `Pi` type does not return the coinductive type); or by a non-productive declaration whose constructors all lack a recursive `Name` argument so no infinite value could ever be generated. |
| `E037` | Coverage error. Triggered by a malformed `(coverage <relation-name>)` driver form; a `(coverage <name>)` for a relation that lacks a `(mode ...)` declaration or has no `(relation ...)` clauses; or a `(coverage <name>)` whose `+input` slots do not exhaust every constructor of the slot's inductive type. The message names the relation, the offending slot, the inferred inductive type, and an example of every missing constructor pattern (e.g. `(succ _)`). Slots whose patterns include a wildcard variable, or whose inductive type cannot be inferred from any clause, are skipped — coverage is opt-in per slot. |
| `E038` | Normalization driver error. Triggered by a malformed `(whnf …)`, `(nf …)`, or `(normal-form …)` form — typically a missing argument or extra arguments. The driver expects exactly one expression to normalize. |

Codes are stable identifiers — they do not change between releases unless we
explicitly note a breaking change in the changelog. The accompanying
`message` field is free-form and may be improved at any time.

## Adding a new code

1. Add a new row to the table above with a brief trigger description.
2. In both implementations, throw/panic with the new code so the existing
   diagnostic dispatch picks it up:
   - JavaScript: `throw new RmlError('Eyyy', 'message');`
   - Rust: `panic!("recognisable prefix: …")` and extend
     `decode_panic_payload` in `rust/src/lib.rs` to map the prefix to
     `Eyyy`.
3. Add a test in `js/tests/diagnostics.test.mjs` and a mirrored test in
   `rust/tests/diagnostics_tests.rs` so drift between the two
   implementations fails CI.

## Trace mode

Both runners support an opt-in **trace mode** that records a deterministic
sequence of evaluator events: operator resolutions, assignment lookups,
probability assignments, and one reduction summary per top-level form.
Trace events share the same `file:line:col` span machinery as diagnostics,
so they pinpoint exactly which line of the source produced each step.

### Enabling tracing

```sh
node js/src/rml-links.mjs --trace examples/demo.lino
rml --trace examples/demo.lino
```

The `--trace` flag writes one event per line to **stderr**, in source order.
Query results still go to stdout, so piping a script through trace mode
won't disturb downstream tools.

### Library API

JavaScript:

```js
import { evaluate, formatTraceEvent } from 'relative-meta-logic';

const { results, diagnostics, trace } =
  evaluate(source, { file: 'demo.lino', trace: true });

for (const event of trace) {
  console.error(formatTraceEvent(event));
}
```

Rust:

```rust
use rml::{evaluate_with_options, format_trace_event, EvaluateOptions};

let evaluation = evaluate_with_options(
    &source,
    Some("demo.lino"),
    EvaluateOptions { env: None, trace: true },
);
for event in &evaluation.trace {
    eprintln!("{}", format_trace_event(event));
}
```

### Output format

Each trace event prints as:

```
[span <file>:<line>:<col>] <kind> <details>
```

Example, derived from `examples/demo.lino`:

```
[span examples/demo.lino:5:1] resolve (!=: not =)
[span examples/demo.lino:6:1] resolve (and: avg)
[span examples/demo.lino:7:1] resolve (or: max)
[span examples/demo.lino:10:1] assign (a = a) ← 1
[span examples/demo.lino:14:1] lookup (a = a) → 1
[span examples/demo.lino:14:1] eval (? ((a = a) and (a != a))) → query 0.5
```

### Event kinds

| Kind      | Emitted when |
|-----------|--------------|
| `resolve` | An operator definition or aggregator selection runs, e.g. `(and: avg)` or `(!=: not =)`. The detail is the form being installed. |
| `assign`  | A probability assignment runs: `((expr) has probability v)`. Detail is `<expr-key> ← <clamped value>`. |
| `lookup`  | An equality `(L = R)` (or its inequality) finds a previously assigned probability. Detail is `<key> → <value>`. |
| `eval`    | A top-level form finishes evaluating. Detail is `<form-key> → <summary>`, where the summary is `query <v>`, `type <t>`, or just the value. |

### Determinism

Trace output is reproducible: top-level forms are processed in source order,
operator hooks fire in a fixed evaluation order, and numbers are normalized
through the same `formatTraceValue` helper in both runtimes. Two consecutive
runs on the same input produce identical traces, and the JavaScript and
Rust implementations produce the same trace lines for the same input — both
properties are exercised by the trace test suites.
