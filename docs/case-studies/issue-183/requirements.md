# Issue 183 requirement ledger

This ledger combines the issue body with the later review and maintainer
comments. A requirement is marked complete only when the repository contains
both implementation and automated evidence.

| ID | Requirement | Status | Implementation and evidence |
|----|-------------|--------|-----------------------------|
| R1 | Base RML on Links Theory/meta-theory. | Complete | `rml-by-links` in `core.lino`; mirrored definition-chain tests. |
| R2 | Define Links Theory through set theory and type theory. | Complete | `links-by-sets` and `links-by-types`, exact contracts, linked conformance cases, and witness proofs. |
| R3 | Give Links Theory the simplest direct definition in itself. | Complete | `links-by-links`, addressed doublet template, and source/target/address rules. |
| R4 | Introduce set theory in multiple ways. | Complete | Extensional membership program/store and canonical ordered-unique doublet trees. |
| R5 | Represent strict finite sets as ordered sequences without duplicates. | Complete | Canonical encoders plus linked insertion, equality, union, intersection, and image rules. |
| R6 | Implement finite sequences through doublet links. | Complete | Balanced, left, and right nested-tree encoders/decoders in JS and Rust. |
| R7 | Support direct and indirect self-referential sequences safely. | Complete | Explicitly bounded right-spine `walk`; mirrored direct/two-node cycle tests. |
| R8 | Unify concepts, local terms, and addresses. | Complete | Shared `(term theory local-name address)` links and address-mediated translation tests. |
| R9 | Make graphs a derived subset of links networks. | Complete | Linked vertex/endpoint/reachability/typing rules and separate `LinkGraph` convenience store. |
| R10 | Add relational algebra over links, sets, and types. | Complete | Linked closure, converse, union, intersection, composition, and pair-typing inference. |
| R11 | Use `meta-language` for representation. | Complete | Candidate and foundation round-trip before interpretation in both runtimes. |
| R12 | Keep JS and Rust behavior aligned. | Complete | Shared LiNo programs/foundation and mirrored linked-program/theory-network tests. |
| R13 | Track the latest upstream meta-theory corpus exactly. | Complete | Pinned 0.0.3 corpus, independent fingerprint, declaration/dependency checks, and parity workflow. |
| R14 | Do not delegate RML reasoning to Lean or Rocq. | Complete | `LinkedProgramRegistry` performs native linked reduction/inference; theory verification does not call the external corpus or a proof-assistant kernel. External builds are provenance/parity checks only. |
| R15 | Eliminate per-theory host adapters and branches. | Complete | `TheoryNetwork` executes every contract with one generic reduction/proof path. Source scans and tests cover previously unknown program names. |
| R16 | Define binding, substitution, and beta reduction through links. | Complete | De Bruijn lambda program in `universal.lino`; `((λx.x) a) -> a` and nested capture-safety tests in both runtimes. |
| R17 | Let users define a new logic without changing host source. | Complete | User double-negation and modus-ponens programs plus verifier-level custom-contract tests, with no callbacks. |
| R18 | Supply a universal constructor/experimenter for formal systems. | Complete for the stated executable scope | Program imports, rewrites, facts, inference rules, proof traces, cycle checks, and resource bounds; lambda calculus and the S/K basis demonstrate universal computation. This is not a Lean/Rocq source elaborator. |
| R19 | Present familiar theories and their links-derived constructions. | Complete | The theory table and source walkthrough in `docs/META_THEORY.md`; conformance fixtures cover both reduction and judgement views. |
| R20 | Minimize and identify axioms. | Complete for this network | Object behavior lives in executable linked rules. Foundation axioms are limited to named implementation capabilities and proof premises, remain separately selected, and cannot be candidate-authored. |
| R21 | Update documentation and preserve a complete review trail. | Complete | This ledger, the case-study README/audit, executable example, and main meta-theory guide. |
| R22 | Use current dependency releases and prepare the next release. | Complete | JS/Rust are aligned at 0.21.0; direct packages and GitHub Actions use the latest releases available on 2026-09-21, lockfiles are refreshed, both npm audits report zero vulnerabilities, and all language suites run afterward. |

## Reviewer acceptance test

The exact minimal behavior is represented without lambda-specific host code:

```text
(beta (lambda (bound zero)) (free a))
  -> (substitute (bound zero) (free a))
  -> (evaluate (bound zero) (bind (free a) empty-environment))
  -> (free a)
```

The trace is produced by rules named `beta-reduction`,
`substitute-bound-variable`, and `evaluate-bound-zero` from
`universal.lino`. JavaScript and Rust assert the same result.

## Trust and scope statement

The irreducible host mechanism is structural: parse links, match patterns,
substitute matched link values, traverse sublinks, detect cycles, and saturate
finite rule sets under explicit bounds. It assigns no built-in meaning to
`lambda`, `set`, `graph`, `relation`, `Pi`, or RML truth constructors.

The pinned Lean/Rocq corpus remains useful evidence that RML can preserve and
query the upstream development. It is deliberately outside the authorization
path for linked programs. Native kernel success cannot substitute for a failed
RML conformance case or witness proof.
