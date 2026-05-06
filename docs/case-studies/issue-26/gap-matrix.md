# Gap Matrix: Comparison Tables → Filed Issues

This file walks every row of [CONCEPTS-COMPARISION.md](../../CONCEPTS-COMPARISION.md) and [FEATURE-COMPARISION.md](../../FEATURE-COMPARISION.md) where RML is `Part`, `No`, or weaker than at least one peer system, and assigns it to one or more issues by plan ID. Plan IDs (e.g. `J3`) are defined in [`issue-plan.md`](./issue-plan.md).

> **All plan IDs below are now filed GitHub issues.** Use the [filed-issue index](./issue-plan.md#filed-issue-index) to look up the corresponding GitHub number (e.g. `J3` → [#86](https://github.com/link-foundation/relative-meta-logic/issues/86)). The tracking epic is [#95](https://github.com/link-foundation/relative-meta-logic/issues/95).

The "Status" column shows RML's current state in the comparison docs. The "Action" column shows what the planned issues do about it. The "Issue IDs" column points to the planned issues in [`issue-plan.md`](./issue-plan.md).

## Concepts: Foundations and Representation

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| One syntactic category for terms/propositions/proofs | Part | Make proof terms first-class links | C1, C2 |
| Adequacy-oriented encodings | Part | Document adequacy notes per encoded logic; add adequacy regression tests | G1, G2 |
| Circular definitions as ordinary data | Part | Audit and document; no parity goal — RML keeps paradox tolerance | (deliberate divergence; see [`issue-plan.md`](./issue-plan.md#deliberate-divergences)) |

## Concepts: Type Theory and Binding

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Dependent types | Part | Promote prototype type layer to a documented kernel | D1 |
| Dependent products / Pi-types | Part | Add full Pi-type support including type-checked application | D1, D2 |
| Beta reduction | Part | Implement beta reduction for link lambdas in the evaluator | D2 |
| Definitional equality / conversion | Part | Add convertibility check up to beta and assignment lookup | D3 |
| Full normalization | No | Implement weak-head and full normalization for typed fragment | D4 |
| Universe hierarchy | Part | Promote `(Type N)` to a checked universe layer | D5 |
| Sorts / kinds | Part | Document and check kinds for type-level constants | D5 |
| Type inference | Part | Add bidirectional type checking and inference | D6 |
| Type checking | Part | Add a full type checker for the typed fragment | D6 |
| Higher-order abstract syntax | Part | Provide a first-class HOAS encoding pattern with helpers | D7 |
| Lambda-tree syntax | Part | Same as HOAS row above | D7 |
| Binding-aware substitution | Part | Implement capture-avoiding substitution as a kernel primitive | D8 |
| Variable freshness support | Part | Add freshness/nabla-style support for binders | D8 |
| Polymorphism | No | Add prenex polymorphism over link lambdas | D9 |
| Type classes | No | (deliberate divergence: RML keeps overloading dynamic via redefinable operators) | (see [`issue-plan.md`](./issue-plan.md#deliberate-divergences)) |
| Inductive families | Part | Add inductive families with constructor signatures and an eliminator | D10 |
| Coinductive types/predicates | Part | Add coinductive families and productivity check | D11 |

## Concepts: Logic and Semantics

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Intuitionistic logic | Part | Ship a standard intuitionistic library encoded in links | G1 |
| Constructive type theory | Part | Same library: include constructive ND rules | G1 |
| Higher-order logic | Part | Ship HOL library | G3 |
| First-order logic | Part | Ship FOL library | G2 |
| Modal logic | Part | Ship modal-logic library (K, T, S4, S5) | G4 |
| Provability logic | Part | Ship provability-logic library (GL) | G5 |
| Interpretability logic | Part | Ship interpretability-logic library | G5 |
| Set theory | Part | Ship a small ZFC fragment | G6 |
| Redefinable logical operators | Yes | Already supported; add docs of the design | A4 |
| Arithmetic reasoning | Part | Ship Peano arithmetic and decimal-precision lemmas | G7 |
| Automated sequence reasoning | No | Add Pecan-style automatic-sequence backend (optional/plugin) | F4 |
| Automata-theoretic semantics | No | Add automata-theoretic decision procedure backend | F4 |
| Decidable complete target fragment | No | Document scope limits; backed by F-phase bridges | F1, F2, F3, F4 |

## Concepts: Metatheory and Proof Objects

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Machine-checked proof terms | Part | Promote derivations to first-class link terms | C1 |
| Small trusted kernel/checker | Part | Extract a minimal kernel that checks derivation traces | C2 |
| Metatheorem checking about encoded systems | Part | Add a metatheorem checker over encoded systems | C3 |
| Totality checking | No | Add Twelf-style totality checks for link relations | D12 |
| Termination checking | No | Add termination check for recursive definitions | D13 |
| Coverage checking | No | Add coverage check for case-style relations | D14 |
| Mode checking | No | Add modes for relation arguments | D15 |
| World declarations / regular worlds | No | Add world declarations (mirroring Twelf `%worlds`) | D16 |
| Proof search | Part | Add depth-bounded proof search built on tactics | E3 |
| Tactic-level proof construction | No | Add a tactic language | E1 |
| Rewriting as proof principle | Part | Add rewrite tactic with congruence handling | E2 |
| Countermodel/counterexample support | No | Add a small Nitpick-style countermodel finder for finite valences | E4 |
| Executable specifications | Yes | Already supported; phase J makes the evaluator itself an executable spec | J1 |
| Proof-producing evaluator | No | Make the evaluator emit derivation traces | C1 |
| Independent proof replay | No | Provide a separate replay tool that consumes traces | C2 |
| Library-scale theorem reuse | No | Library structure (phase G) addresses this | G1–G7 |
| Soundness story documented | Part | Add `docs/SOUNDNESS.md` describing what the kernel guarantees | C5 |
| Proof irrelevance / propositions | No | (deliberate divergence: handled by the probabilistic equality model) | (see [`issue-plan.md`](./issue-plan.md#deliberate-divergences)) |
| Reflection/metatheory inside the system | Part | Phase J turns this into a `Yes` | J1, J2, J3 |
| External certification bridge | No | Phase F adds Lean/Rocq/Isabelle export | F1, F2, F3 |

## Features: Authoring and Checking Workflow

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Interactive REPL/top-level | Part | Add a REPL that maintains evaluation environment between commands | A2 |
| Incremental proof state | No | Phase E (tactics) creates proof states; REPL surfaces them | A2, E1 |
| Dedicated IDE/editor support | No | Phase H ships a VS Code extension | H2 |
| Language server protocol support | No | Phase H ships an LSP server | H1 |
| Structured diagnostics | Part | Convert parser/evaluator errors to structured diagnostics with source spans | A1 |
| Module/import system | Part | Implement file-level imports with cycle detection | B1 |
| Namespaces | No | Add namespace declarations and qualified references | B2 |
| Package/build ecosystem | Part | Ship npm/cargo packaging polish, version policy doc | H4 |
| Versioned package distribution | Yes | Already supported; document the release cadence | H4 |
| Documentation generation | Markdown | Add automated API docs from JSDoc/rustdoc | H3 |
| Literate proof documents | No | Add a literate `.lino` format that interleaves prose and queries | H5 |
| Online/browser use | No | Phase H provides an online playground compiled to wasm | H6 |
| Multi-implementation parity | Yes | Phase I keeps it that way | I1, I2 |

## Features: Proof Engineering and Automation

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Tactic language | No | Phase E core | E1 |
| Simplifier | Part | Add a normalizing simplifier built on the kernel | E2 |
| Rewriting automation | Part | Add congruence-based rewriting tactic | E2 |
| Built-in proof search | Part | Add bounded proof search | E3 |
| Search depth controls | No | Phase E exposes search budgets | E3 |
| External ATP integration | No | Add SMT-LIB and TPTP bridges | F5, F6 |
| SMT integration | No | Same | F5 |
| Model/counterexample finding | No | Phase E countermodel finder (small) and SMT bridge (large) | E4, F5 |
| Totality automation | No | Phase D12 | D12 |
| Termination automation | No | Phase D13 | D13 |
| Coverage/productivity checks | No | Phase D14 and D11 | D14, D11 |
| Program extraction | No | Add extraction of typed link programs to JS and Rust source | F7 |
| Reflection/metaprogramming | Part | Phase J makes RML a reflective system | J1 |
| Custom syntax/macros | Part | Add a macro/template mechanism for reusable link shapes | E5 |
| Proof repair/refactoring tools | No | (parked: depends on tactics + LSP; planned but not in initial cluster) | (deferred — listed in [`issue-plan.md`](./issue-plan.md#deferred)) |
| Generated proof/checking artifacts | No | Phase C | C1, C2 |
| Replayable derivation trace | No | Phase C | C1, C2 |

## Features: Library and Domain Coverage

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Stable large standard library | No | Phase G as a whole | G1–G10 |
| Mathematics library | No | Phase G arithmetic + (long-term) basic algebra | G7, G8 |
| Formalized logic library | Part | Phase G classical/intuitionistic/modal/provability/interpretability/set | G1–G6 |
| Programming language metatheory examples | Part | Add lambda-calculus and STLC examples with adequacy proofs | G9 |
| Probabilistic examples | Yes | Already strong; add a Bayesian-network mini-library | G10 |
| Fuzzy logic examples | Yes | Already strong; add a fuzzy-control library example | G10 |
| Graphical model examples | Yes | Already strong; expand to factor graphs | G10 |
| Paradox/self-reference examples | Yes | Already strong; collect under one library file | G10 |
| Automatic sequences/numeration systems | No | Phase F4 (Pecan-style backend, optional) | F4 |
| Automata libraries | No | Phase F4 | F4 |
| Scientific archive model | Part | Document the `docs/case-studies/` archive in `docs/CONTRIBUTING.md` | H7 |

## Features: Distribution, Maintenance, and Integration

| Row | Status | Action | Issue IDs |
|-----|--------|--------|-----------|
| Docker support | No | Add a `Dockerfile` for both implementations | H8 |
| Generated API/reference docs | Part | JSDoc/rustdoc + GitHub Pages publication | H3 |
| Tutorials/walkthroughs | README | Add `docs/tutorials/` with progressive walkthroughs | H7 |
| Backward compatibility story | Part | Add a compatibility policy doc and a deprecation process | H4 |
| Cross-language implementation parity | Yes | Phase I formalizes this | I1, I2 |

## Self-Reimplementation Capstone (issue body, not comparison docs)

| Aspect | Action | Issue IDs |
|--------|--------|-----------|
| Encode the parser in `.lino` | Define a LiNo grammar as links | J1 |
| Encode the evaluator in `.lino` | Define evaluation rules as links | J2 |
| Encode the type layer in `.lino` | Define typing rules as links | J3 |
| Encode operators and aggregators in `.lino` | Define each operator as a relation | J4 |
| Encode the metatheorem checker in `.lino` | Define checking rules as links | J5 |
| Bootstrap test: encoded RML evaluates the example corpus | Cross-check encoded vs host RML | J6 |
| Documentation: "RML in RML" tutorial | Walk through the bootstrap | J7 |
