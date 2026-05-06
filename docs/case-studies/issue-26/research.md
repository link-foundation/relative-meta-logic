# Research and Prior Art

This file collects external references and existing components that inform the planned implementation. References are grouped by phase. Issue IDs (`A1`, `D10`, …) point into [`issue-plan.md`](./issue-plan.md).

## Phase A — Diagnostics and developer experience

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Rust [`miette`](https://crates.io/crates/miette) and [`ariadne`](https://crates.io/crates/ariadne) | Span-aware diagnostic crates. Either can give CLI users carets and labelled errors with low integration cost. | A1 |
| [Lean's diagnostic format](https://lean-lang.org/doc/reference/latest/) | Reference for what a "good" structured diagnostic exposes. | A1 |
| [`lsp-types`](https://crates.io/crates/lsp-types) and [`vscode-languageserver-node`](https://github.com/microsoft/vscode-languageserver-node) | Reference implementations for LSP servers; informs A1's `Diagnostic` shape so it round-trips into LSP without translation. | A1, H1 |
| [`replkit`](https://github.com/sphericalcontainer/replkit) and Lean's `lean --server` | REPL design references. | A2 |
| [`tracing`](https://crates.io/crates/tracing) crate | Inspiration for structured trace events. | A3 |

## Phase B — Modules and namespaces

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Twelf [module system](https://twelf.org/wiki/) | A precedent for namespaces in a logic-framework setting. | B2 |
| Lean 4 namespaces and `open` | Modern syntax for namespace import. | B2 |
| Rocq's `Module Type` / `Module` | Heavier but useful as a reference for hierarchical modules if RML grows them. | (deferred) |

## Phase C — Proof artefacts and trusted kernel

| Reference | Why useful | Used by |
|-----------|------------|---------|
| LF / Twelf's "judgments as types" via proof terms | The canonical model for first-class derivation objects in a logical framework. | C1, C2 |
| Abella's [reference guide](https://abella-prover.org/reference-guide.html) | Two-level logic discipline; useful for separating the spec layer from the reasoning layer in a future variant of RML. | C3 |
| Edinburgh LF papers (Harper/Honsell/Plotkin) | Adequacy theorems are the standard proof obligation for "encoded systems". | C3 |
| Rocq kernel architecture | Reference for "small trusted kernel + larger user surface" architecture. | C2 |
| Lean kernel (≈ 6 KLOC) | Demonstrates that a small kernel is feasible. | C2 |

## Phase D — Typed kernel maturation

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Pierce's *Types and Programming Languages* and *Advanced Topics in TaPL* | Reference for inductive families, dependent types, normalization, β/η. | D2, D3, D4, D10 |
| Norell's PhD thesis on Agda | Practical recipe for bidirectional type checking with dependent types. | D6 |
| Coquand's *An Algorithm for Type Checking Dependent Types* | Bidirectional checking algorithm. | D6 |
| McBride's *Outrageous but Meaningful Coincidences* | Inductive families and indexed types as constructors over a signature. | D10 |
| Pollack and Voevodsky's universe-polymorphism papers | Universe handling for D5; not needed initially but useful when polymorphism (D9) lands. | D5, D9 |
| Twelf's totality tutorial: <https://twelf.org/wiki/proving-metatheorems-proving-totality-assertions-about-the-natural-numbers/> | Concrete recipe for `%mode`, `%worlds`, `%total`, termination, coverage. | D12, D13, D14, D15, D16 |
| Pitts's *Nominal Sets* | Foundational reference for nabla / freshness. | D8 |

## Phase E — Tactic and automation language

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Isabelle/Isar | A tactic language designed for readability — good model for the English-readable tactic style RML wants. | E1 |
| Mtac / Lean's tactic monad | Demonstrates first-class tactics-as-terms; informs the "tactics are links" design choice. | E1 |
| Lean's `simp` and Rocq's `auto` / `eauto` | Reference for simplifier and search-budget tactics. | E2, E3 |
| Isabelle's Nitpick | Counter-model finding for finite domains. | E4 |
| Racket's `syntax-parse` | Hygienic macro reference for E5. | E5 |

## Phase F — Bridges to mature provers and ATP/SMT

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Lean 4 elab API | Reference for embedding terms received from external sources. | F1 |
| Rocq's `Coq.Init.Logic` and `Logic.PropExtensionality` | Target shape for first export attempts. | F2 |
| Isabelle's PIDE / Document model | Background on how Isabelle exposes proof state externally. | F3 |
| Pecan paper: <https://arxiv.org/abs/2102.01727> | The decision procedure for automatic sequences and Buchi automata. | F4 |
| SMT-LIB v2 standard | Standard interchange format for SMT solvers. | F5 |
| TPTP world: <https://www.tptp.org/> | Standard for first-order ATPs. | F6 |
| Sledgehammer (Isabelle) | Reference for orchestrating multiple back-end provers from a single front-end. | F5, F6 |

## Phase G — Standard libraries

| Reference | Why useful | Used by |
|-----------|------------|---------|
| `mathlib4` (Lean) | The gold standard for a maintained mathematics library; structure to imitate. | G7, G8 |
| Isabelle's HOL/Algebra | Algebraic-structure layering reference. | G8 |
| `FormalizedFormalLogic/Foundation` (Lean 4) | Reference for the modal/provability/interpretability logic libraries. | G3, G4, G5 |
| Twelf's case studies | Reference for adequacy-style PL-metatheory examples. | G9 |
| Belnap, *A useful four-valued logic* (1977) | Theoretical reference for the bilattice library inside G10. | G10 |
| Pearl's *Probabilistic Reasoning in Intelligent Systems* | Reference for Bayesian-network / Markov-network helpers. | G10 |

## Phase H — Tooling and ecosystem

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Microsoft's [LSP overview](https://microsoft.github.io/language-server-protocol/) | Specification used to drive H1. | H1 |
| `tower-lsp` (Rust) and `vscode-languageclient` (TypeScript) | Implementation libraries for H1, H2. | H1, H2 |
| `wasm-pack` (Rust) | wasm playground tooling. | H6 |
| jsCoq, leanmonaco | Reference UIs for online proof-assistant playgrounds. | H6 |
| `typedoc` and `cargo doc` | Generated reference docs. | H3 |

## Phase I — Multi-implementation parity

| Reference | Why useful | Used by |
|-----------|------------|---------|
| `wasi-testsuite`-style shared corpora | Reference for cross-implementation test sharing. | I1 |
| AFP's per-entry session structure | Reference for organising a corpus that a separate runner can iterate. | I1 |

## Phase J — Self-reimplementation

| Reference | Why useful | Used by |
|-----------|------------|---------|
| Reynolds, *Definitional Interpreters for Higher-Order Programming Languages* | Foundational reference for an interpreter expressing itself. | J2 |
| McCarthy, *Recursive Functions of Symbolic Expressions and Their Computation by Machine* (1960) | Lisp's `eval` in Lisp — the original self-bootstrap. | J2 |
| Mosses, *Modular Structural Operational Semantics* | Reference for splitting evaluation rules into composable modules. | J2 |
| Twelf's "LF in LF" formalisations | Reference for encoding a logical framework inside itself. | J3 |
| MetaCoq | Reference for reflection of a proof assistant inside itself. | J5 |
| Scott, *Domains for Denotation* | Background for the fixed-point treatment of self-reference, useful for documenting why RML's paradox tolerance is principled. | (philosophy doc) |

## Cross-cutting libraries we already depend on

| Library | Where used | Notes |
|---------|------------|-------|
| [`links-notation`](https://github.com/link-foundation/links-notation) (npm + crate) | Both implementations | Phase J's parser-in-RML must be consistent with this library's grammar. |

## Summary of "build vs reuse" decisions

| Capability | Build | Reuse |
|-----------|-------|-------|
| Diagnostics | ✓ (data shape) | `miette`/`ariadne` for CLI rendering only |
| LSP | ✓ (RML-specific logic) | `tower-lsp` / `vscode-languageserver-node` for transport |
| Tactics | ✓ | inspiration only |
| Inductive types | ✓ | inspiration only |
| Module system | ✓ (small) | inspiration only |
| ATP/SMT | reuse | call out via `process::Command`-style bridge |
| Lean/Rocq/Isabelle export | ✓ (translator) | use the host prover's source format |
| Pecan-style automatic sequences | reuse | Pecan via subprocess if available, else native port |
| wasm playground | ✓ (UI) | `wasm-pack`, monaco-editor for the editor |

The strong default is **build**: RML's value proposition is that everything is a link, and re-using a Rocq/Lean library would mean importing a different value system. Reuse happens at the **infrastructure** edges (diagnostics rendering, transport protocols, solver backends), not at the **logic** core.
