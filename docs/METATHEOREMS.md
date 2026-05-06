# Metatheorems

This document describes the **C3 metatheorem checker** introduced in
issue #47. The checker is the Twelf-style guarantee that lets RML reason
about user-defined formal systems: given a relation declared as a family
of links plus a totality declaration (D12) and modes (D15), the checker
verifies that the relation is a total function on its declared input
domain.

## Building blocks

The checker composes four existing kernel facilities:

| Phase | Form | API | Code |
|-------|------|-----|------|
| Mode declaration | `(mode plus +input +input -output)` | `env.modes` | E030/E031 |
| Coverage check (D14) | `(coverage plus)` | `isCovered` / `is_covered` | E037 |
| Totality check (D12) | `(total plus)` | `isTotal` / `is_total` | E032 |
| Termination check (D13) | `(terminating plus)` | `isTerminating` / `is_terminating` | E035 |

The metatheorem checker iterates every relation that has a `(mode ...)`
declaration plus matching `(relation ...)` clauses and runs **both**
totality and coverage on it. It also iterates every `(define ...)` in
the program and runs termination on it. A relation passes only when
every sub-check passes.

## Surface

A typical input file looks like the canonical Twelf `plus` example:

```lino
(inductive Natural
  (constructor zero)
  (constructor (succ (Pi (Natural n) Natural))))
(mode plus +input +input -output)
(relation plus
  (plus zero n n)
  (plus (succ m) n (succ (plus m n))))
```

Equivalent surfaces verified end-to-end by the test suite:

- `plus` on `Natural` (recursion on the first `+input`)
- `le` (less-than-or-equal) on `Natural` (recursion shrinks both inputs)
- `append` on `List` (recursion on the first list)

## CLI usage

The checker is shipped as a dedicated binary in both runtimes.

JavaScript:

```sh
cd js
node src/rml-meta.mjs ../experiments/metatheorem-plus.lino
# or, when installed via npm
rml-meta ../experiments/metatheorem-plus.lino
```

Rust:

```sh
cd rust
cargo run --bin rml-meta -- ../experiments/metatheorem-plus.lino
```

The two CLIs are byte-compatible: each prints the same per-relation
section and exits with status `0` only when every metatheorem holds.

### Successful run

```
Relations:
  OK: plus
  - totality: pass
  - coverage: pass
All metatheorems hold.
```

Exit code: `0`.

### Failure with counter-witness

A relation that omits the `succ` case for `Natural`:

```lino
(inductive Natural
  (constructor zero)
  (constructor (succ (Pi (Natural n) Natural))))
(mode f +input -output)
(relation f
  (f zero zero))
```

produces:

```
Relations:
  FAIL: f
  - totality: pass
  - coverage: fail
      E037 Coverage check for "f": +input slot 1 (type "Natural") missing case for constructor (succ _)
One or more metatheorems failed.
```

Exit code: `1`. The diagnostic carries the same stable error code as the
underlying coverage checker, so editor integrations and CI scripts can
match on it the same way they match on every other RML diagnostic
(`docs/DIAGNOSTICS.md`).

A relation that recurses without structural decrease produces:

```
Relations:
  FAIL: loop
  - totality: fail
      E032 Totality check for "loop": clause 2 `(loop (succ n) (loop (succ n)))` — recursive call `(loop (succ n))` does not structurally decrease any `+input` slot of `(loop (succ n))`
  - coverage: pass
One or more metatheorems failed.
```

A relation can fail multiple sub-checks in a single run; each is
reported independently so the user sees the full counter-witness set on
one pass, not just the first failure.

## Programmatic API

JavaScript:

```js
import { checkMetatheorems, formatReport } from 'relative-meta-logic/src/rml-meta.mjs';

const report = checkMetatheorems(text, { file: 'program.lino' });
if (!report.ok) {
  console.error(formatReport(report));
  process.exit(1);
}
```

Rust:

```rust
use rml::meta::{check_metatheorems, format_report};

let report = check_metatheorems(text, Some("program.lino"));
if !report.ok {
    eprintln!("{}", format_report(&report));
    std::process::exit(1);
}
```

Both APIs return a structured report with the same shape:

| Field | JS | Rust |
|-------|----|------|
| Overall outcome | `report.ok: bool` | `report.ok: bool` |
| Evaluation diagnostics | `report.evaluation.diagnostics` | `report.evaluation_diagnostics` |
| Per-relation results | `report.relations[i].checks[].kind/ok/diagnostics` | identical via `MetatheoremResult` |
| Per-definition results | `report.definitions[i].checks[].kind/ok/diagnostics` | identical |

## Out of scope

- Proof of totality for **non-structurally-decreasing** definitions —
  the `(define ...)` form already supports lexicographic measures via
  D13 (issue #49). The metatheorem checker reuses that infrastructure
  rather than introducing its own proof obligation.
- Multi-relation mutual recursion. The current iteration verifies one
  relation at a time; mutual termination is delegated to D13's
  measure-based checker, which already accepts mutually-recursive
  definitions when an explicit `(measure (lex ...))` is supplied.
