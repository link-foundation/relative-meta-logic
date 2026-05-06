# Case Study: Issue #26 — Plan Full Concepts and Features Set Development

**Issue:** [#26 — Plan full concepts and features set development](https://github.com/link-foundation/relative-meta-logic/issues/26)

**Source comparisons used as input:**

- [Core Concept Comparison](../../CONCEPTS-COMPARISION.md)
- [Product Feature Comparison](../../FEATURE-COMPARISION.md)

**Companion artifacts in this folder:**

- [`requirements.md`](./requirements.md) — Atomic requirement list extracted from the issue.
- [`gap-matrix.md`](./gap-matrix.md) — Per-row distillation of each gap from the comparison docs into a planned issue.
- [`issue-plan.md`](./issue-plan.md) — The full proposed GitHub issue plan with phases, labels, dependencies, and templates.
- [`research.md`](./research.md) — Notes on related libraries, prior art, and references that inform implementation.

## Executive Summary

Issue #26 asks for a complete development plan that turns Relative Meta-Logic (RML) into a **universal formal-system constructor** — feature-parity with traditional proof assistants on the standard checklist (kernel, types, tactics, libraries, tooling), while surpassing them on **configurability**: the user, not the implementer, picks the truth range, valence, operators, semantics, and even the meta-theory.

The plan must:

1. Use the existing [concept](../../CONCEPTS-COMPARISION.md) and [feature](../../FEATURE-COMPARISION.md) comparison tables as the source of truth for *every* gap.
2. Produce one GitHub issue per gap, each with concrete acceptance criteria.
3. Wire up issue dependencies (`blocks` / `blocked by`) so the dependency graph is traversable in GitHub.
4. Apply consistent labels (existing repo labels: `bug`, `documentation`, `enhancement`, `good first issue`, `help wanted`, `question`; plus a small set of new labels proposed in [`issue-plan.md`](./issue-plan.md)) and group issues into **phases** so the order of work is obvious.
5. End with a **capstone issue**: re-implementing RML in itself, demonstrating that RML really is a meta-logic capable of describing and reasoning about itself.
6. Express every encoded construct in **links notation with English-like words and templates**, so a beginner can read each link as a sentence (e.g. `(zero is a Natural)` rather than `Nat.zero : Nat`).

This case study captures the analysis **and the filed plan**. As of the latest update of PR #27, every planned issue (A1–J7 plus the J-EPIC tracking issue) has been filed on GitHub with full body, labels, and `Depends on` / `Blocks` cross-references — see the [filed-issue index in `issue-plan.md`](./issue-plan.md#filed-issue-index) and tracking epic [#95](https://github.com/link-foundation/relative-meta-logic/issues/95).

## Scope of the Plan

The plan covers everything visible in [CONCEPTS-COMPARISION.md](../../CONCEPTS-COMPARISION.md) and [FEATURE-COMPARISION.md](../../FEATURE-COMPARISION.md) where RML is currently `Part`, `No`, or weaker than at least one peer system. That includes:

| Area | Source columns | What's missing |
|------|----------------|----------------|
| Foundations and representation | Concepts §"Foundations and Representation" | First-class proof terms, full definitional equality, structural-equality decision procedure for binders. |
| Type theory and binding | Concepts §"Type Theory and Binding" | Full normalization, binding-aware substitution, freshness, inductive families, coinductive types, type-class-like overloading. |
| Logic and semantics | Concepts §"Logic and Semantics" | Standard libraries for FOL/HOL/modal/provability/interpretability/set theory, automata-theoretic decision procedures. |
| Metatheory and proof objects | Concepts §"Metatheory and Proof Objects" | Trusted kernel, proof-replay, totality/termination/coverage, mode and world checking, metatheorem checker. |
| Authoring and checking workflow | Features §"Authoring and Checking Workflow" | Interactive REPL, LSP, structured diagnostics, module/import system, namespaces, package distribution polish, literate proof docs, online playground. |
| Proof engineering and automation | Features §"Proof Engineering and Automation" | Tactic language, simplifier, rewriting automation, proof search, ATP/SMT bridges, counterexample finder, reflection/metaprogramming, custom syntax/macros, replayable derivation traces. |
| Library and domain coverage | Features §"Library and Domain Coverage" | Standard libraries: math, logic, modal/provability, set theory, arithmetic; programming-language metatheory; automata. |
| Distribution and integration | Features §"Distribution, Maintenance, and Integration" | Docker images, generated API/reference docs, tutorials/walkthroughs, backward-compatibility policy. |
| Self-reimplementation (issue #26 capstone) | None directly; derived from issue body | Bootstrap: encode the RML evaluator, type layer, and operator system in `.lino` and check that the encoded RML evaluates the same `.lino` programs as the host RML. |

## Method

The plan was built by walking each row of the two comparison tables and asking, for every cell where RML is not `Yes`:

1. **What does the cell mean concretely** in RML's link substrate? (E.g. "totality checking" maps to: a checker that, given a relation defined as a family of links, decides whether the relation covers every input on its declared mode.)
2. **What is the smallest issue that closes the gap** while staying compatible with RML's runtime configurability? Each issue is sized to be reviewable in a single PR (rough budget: 200–800 LOC, plus tests and docs).
3. **Which existing libraries or papers can be reused** so RML does not reinvent solved problems? See [`research.md`](./research.md).
4. **What does it depend on?** Every issue lists prerequisite issues so GitHub's `blocks` / `blocked by` relationships form an explicit DAG.
5. **What labels apply?** Existing repo labels are reused; new labels are proposed only where the existing set is insufficient.

This method is fractal: phase A (foundations) unlocks phase B (typed kernel), which unlocks phase C (proof artifacts), and so on, ending in phase J (self-bootstrap).

## Phase Map

The full plan splits into ten phases. Each phase has a single guiding deliverable, written below as a one-line "definition of done". Detail per issue lives in [`issue-plan.md`](./issue-plan.md).

| Phase | Theme | Definition of done |
|-------|-------|--------------------|
| A | Diagnostics and developer experience | Every parse/eval failure produces a structured, source-located diagnostic; opt-in trace mode logs every step. |
| B | Module system and namespaces | `.lino` files can `import` other files by relative path; cycles are detected; symbol scoping is explicit. |
| C | Proof artifacts | Every query optionally returns a derivation tree that an independent checker can replay. |
| D | Typed kernel maturation | Inductive/coinductive families, normalization, binding-aware substitution, freshness, totality/termination/coverage. |
| E | Tactic and automation language | Named proof steps (tactics) over the existing evaluator; small simplifier; rewriting automation; bounded proof search. |
| F | Bridges to mature provers and ATP/SMT | Optional export of RML fragments to Lean/Rocq/Isabelle and import of SMT-LIB problems via a configurable backend. |
| G | Standard libraries | Reusable libraries in `lib/` for classical, intuitionistic, fuzzy, probabilistic, modal, provability, interpretability, set theory, arithmetic, programming-language metatheory, and automata. |
| H | Tooling and ecosystem | Language server, VS Code extension, Docker image, online playground, generated API docs, tutorials. |
| I | Multi-implementation parity | JS and Rust expose the same API for every new feature; CI proves equivalence on a shared test corpus. |
| J | Self-reimplementation (capstone) | The RML evaluator, type layer, operator system, and metatheorem checker are themselves encoded as `.lino`, and the encoded RML reproduces the host RML's behaviour on the example corpus. |

Phases run in parallel where dependencies allow. The dependency graph in [`issue-plan.md`](./issue-plan.md) shows which phase B issues unlock which phase C issues, etc.

## How the Plan Honours the Issue's Requirements

The issue body raises eight distinct requirements. They are tracked atomically in [`requirements.md`](./requirements.md) and addressed as follows:

| # | Requirement | How the plan addresses it |
|---|-------------|---------------------------|
| 1 | Use both comparison docs as input | Every gap row in either doc maps to at least one issue in [`issue-plan.md`](./issue-plan.md). The mapping is visible in [`gap-matrix.md`](./gap-matrix.md). |
| 2 | Plan as GitHub issues, not just prose | [`issue-plan.md`](./issue-plan.md) gives each issue a title, body template, labels, and links — ready to paste into `gh issue create`. |
| 3 | Use issue relationships (blocks/blocked by) to full potential | Every issue lists prerequisite issues and post-conditions; the DAG section of [`issue-plan.md`](./issue-plan.md) renders the graph. |
| 4 | Use labels to full potential | Existing labels are reused; new labels (`area:kernel`, `area:tooling`, `area:libraries`, `phase:A`–`phase:J`, `capstone`) are proposed and justified. |
| 5 | Each issue must have maximum specific implementation detail | Each plan entry has acceptance criteria, suggested API surface, suggested LiNo syntax, and references to existing libraries/papers. |
| 6 | End goal: universal formal-system constructor surpassing competitors in configurability | Phases A–H bring RML to feature parity; phase I keeps the dual implementation honest; phase J proves universality by self-reimplementation. |
| 7 | Final step: full reimplementation of RML in itself | Phase J is the capstone; its issue cluster is described in detail in [`issue-plan.md`](./issue-plan.md#phase-j-self-reimplementation-capstone). |
| 8 | Style: links notation, references and templates, close to English | Every encoded construct uses words like `is`, `of`, `has`, `from`, `to`, `Pi`, `lambda` so a link reads as a sentence. The conventions are listed in [`issue-plan.md`](./issue-plan.md#naming-and-template-conventions). |

## Risks and Open Questions

| Risk / question | Mitigation |
|-----------------|------------|
| Filing 80+ issues at once will spam watchers and obscure priorities. | All 67 planned issues are filed in topological order so each `Depends on #N` reference resolves immediately. The tracking epic [#95](https://github.com/link-foundation/relative-meta-logic/issues/95) consolidates them so watchers can subscribe once. |
| Some "gaps" in the comparison docs reflect design choices, not omissions (e.g. RML accepts self-reference where Lean rejects it). | Each issue marks whether it is a *parity* goal or a *deliberate divergence* goal. Some Lean/Rocq features will not be ported because they conflict with RML's paradox-tolerant semantics. |
| Self-reimplementation may run into RML's current evaluator limits (no full normalization, prototype types). | Phase J explicitly depends on phases B, C, D, and E. If phase D cannot deliver full normalization for all link forms, phase J ships an *interpretive* (small-step) self-evaluator instead of a *compiled* one and documents the limitation. |
| Bridges to mature provers (Lean/Rocq/Isabelle) require domain expertise the project may not have in-house. | Phase F issues are explicitly marked `help wanted` and start with an export pilot to a single target (Lean) before generalizing. |
| Multi-implementation parity may slow down feature delivery. | Phase I provides a shared test corpus and a parity CI job; new feature issues require both implementations or a documented "JS-first / Rust-follow-up" split. |

## Acceptance Checklist

| Requirement | Status |
|-------------|--------|
| Folder `docs/case-studies/issue-26/` exists with case study contents | Done |
| Atomic requirement list extracted from the issue | Done — see [`requirements.md`](./requirements.md) |
| Each comparison-doc gap maps to a concrete issue | Done — see [`gap-matrix.md`](./gap-matrix.md) |
| Each issue has detailed body, dependencies, labels, and acceptance criteria | Done — see [`issue-plan.md`](./issue-plan.md) |
| Plan ends with self-reimplementation capstone | Done — see [`issue-plan.md`](./issue-plan.md#phase-j-self-reimplementation-capstone) |
| LiNo style guidance for English-readable links | Done — see [`issue-plan.md`](./issue-plan.md#naming-and-template-conventions) |
| External research and prior-art references collected | Done — see [`research.md`](./research.md) |
| Issues actually filed on GitHub with proper labels and dependencies | Done — see [filed-issue index](./issue-plan.md#filed-issue-index) and tracking epic [#95](https://github.com/link-foundation/relative-meta-logic/issues/95) |
