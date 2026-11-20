# Lean 4 Export

RML can export a typed, non-probabilistic fragment to Lean 4 source:

```bash
rml export lean examples/lean-export-basic.lino -o out.lean
```

From the repository root:

```bash
node js/src/rml-links.mjs export lean examples/lean-export-basic.lino -o out.lean
cargo run --manifest-path rust/Cargo.toml -- export lean examples/lean-export-basic.lino -o out.lean
```

Both commands produce the same Lean artifact (the Rust one compiles Rust, which
repository policy reserves for hosted CI; see [BUILD_CACHE.md](./BUILD_CACHE.md)). The fixture
[`examples/lean-export-basic.lino`](../examples/lean-export-basic.lino) exports
to [`examples/lean-export-basic.lean`](../examples/lean-export-basic.lean).

## Supported Subset

The exporter supports declarations that have a direct Lean type-theoretic
shape:

| RML / LiNo form | Lean output |
|-----------------|-------------|
| `(A: (Type 0) A)` | `axiom A : Type 0` |
| `(zero: Natural zero)` | `axiom zero : Natural` |
| `(succ: (Pi (Natural n) Natural))` | `axiom succ : (n : Natural) -> Natural` |
| `(id: lambda (Natural x) x)` | `def id : (x : Natural) -> Natural := fun x => x` |
| `(apply f x)` in exported terms | `f x` |
| `(inductive T (constructor c) ...)` | `inductive T : Type 0 where ...` |

`Pi`, `lambda`, `apply`, `Type N`, `Prop`, equality terms, and ordinary prefix
applications are translated inside supported declarations. RML identifiers are
sanitized into Lean identifiers by replacing unsupported characters with `_`
and prefixing reserved Lean keywords.

Queries `(? ...)` are ignored because the Lean artifact contains declarations,
not evaluated query output. Untyped term declarations such as `(p: p is p)` are
accepted as context-only declarations and do not emit Lean code.

## Rejected Forms

Probabilistic and configurable logic forms are outside the export subset:

- `((expr) has probability p)`
- `(range: lo hi)` and `(valence: n)`
- operator redefinitions such as `(and: avg)`, `(or: max)`, `(not: ...)`
- probabilistic operators such as `and`, `or`, `not`, `both`, and `neither`

The exporter reports these as `E050` diagnostics. Imports, namespaces, and
templates are also rejected for now; use a flattened typed file as the export
input.

Lean import back into RML is out of scope for this feature.
