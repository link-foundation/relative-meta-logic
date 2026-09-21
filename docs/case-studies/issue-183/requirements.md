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
| R18 | Supply a universal constructor/experimenter for formal systems. | Complete for the stated executable scope | Rebound program imports, rewrites, facts, inference rules, proof traces, cycle checks, and resource bounds; lambda calculus and the S/K basis demonstrate universal computation. This is not a Lean/Rocq source elaborator. |
| R19 | Present familiar theories and their links-derived constructions. | Complete | The theory table and source walkthrough in `docs/META_THEORY.md`; conformance fixtures cover both reduction and judgement views. |
| R20 | Minimize and identify axioms. | Complete for this network | Object behavior lives in executable linked rules. Foundation axioms are limited to named implementation capabilities and proof premises, remain separately selected, and cannot be candidate-authored. |
| R21 | Update documentation and preserve a complete review trail. | Complete | This ledger, the case-study README/audit, executable example, and main meta-theory guide. |
| R22 | Use current dependency releases and prepare the next release. | Complete | JS/Rust are aligned at 0.21.0; direct packages and GitHub Actions use the latest releases available on 2026-09-21, lockfiles are refreshed, both npm audits report zero vulnerabilities, and all language suites run afterward. |
| R23 | Make the meta-foundation explicit and inspectable. | Complete | The documented `K0 -> K1 -> F -> T` model and mirrored kernel reports separate six current bootstrap operations from two derived host services and report zero object semantics. |
| R24 | Define meta-semantics as links above the bootstrap boundary. | Complete | `links-meta-foundation` defines object-encoded environment lookup, matching, substitution, rule selection/application, and result verification; mirrored tests execute an encoded copy of its own repeated-variable matching rule and compare it with direct execution. |
| R25 | Instantiate one unchanged theory over replaceable foundations. | Complete | Import-level `rebind` works across rewrites, facts, inferences, and transitive imports. One portable classifier returns `reject` or `accept` under strict/permissive user foundations without changing its source. |
| R26 | Reuse one set-theory definition in traditional and associative contexts. | Complete | `set-theory-over-traditional-sequences` and `set-theory-over-associative-links` rebind constructor concepts while importing the same complete set program; mirrored membership tests execute both. |
| R27 | Minimize K0 through an explicit experimental loop. | Complete for the current implementation | The report records one experiment and outcome for every original K0 operation. Import linking and inference saturation are moved above the six-operation bootstrap boundary. |
| R28 | Add a stronger self-interpretation witness. | Complete | K1 interprets an encoded copy of its own non-linear `match-identical-atoms` pattern, including repeated-variable equality and substitution; JS/Rust require agreement with direct K0 execution and inspect the K1 trace. |
| R29 | Publish a machine-readable K0 dependency/trust graph. | Complete | Both reports expose `rml-bootstrap-trust-graph/v1`, including all bootstrap operations, derived services, and public semantic paths with explicit dependencies. |
| R30 | Fail CI when host semantics are absent from the trust graph. | Complete | Mirrored `auditBootstrapKernel` / `audit_bootstrap_kernel` tests compare an independent implementation manifest with the report and reject a simulated `hidden-object-evaluator`. The audit also requires every dependency branch to terminate in K0. |
| R31 | Do not call the current K0 irreducible without proof. | Complete | Source and documentation consistently use “current bootstrap boundary,” expose `claimsIrreducible: false`, and state the criterion for any later removal. |
| R32 | Give a structural reason for each primitive that remains. | Complete | Every bootstrap node contains a non-empty `primitiveReason` / `primitive_reason`; mirrored tests make missing justifications fail. |

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

The bootstrap host mechanism is structural and exactly listed by the public
kernel report: parse links, compare structure, bind pattern variables,
substitute matched link values, traverse/select rewrites, and enforce
cycles/resource bounds. Finite inference saturation and rebound import
resolution are visible derived services above that bootstrap, and every
semantic path through them terminates in a declared K0 operation. It assigns
no built-in meaning to `lambda`, `set`, `graph`, `relation`, `Pi`, or RML truth
constructors. `links-meta-foundation` reconstructs the main interpreter
relations as link-level data and rules and self-interprets a non-linear rule.

This is a reproducible current fixed point, not a proof of irreducibility. An
operation may leave K0 only when all public semantic paths still execute and
the replacement does not presuppose the same operation under another name.
The report publishes the structural reason and experiment outcome so a future
implementation can repeat the loop rather than inherit the conclusion.

The pinned Lean/Rocq corpus remains useful evidence that RML can preserve and
query the upstream development. It is deliberately outside the authorization
path for linked programs. Native kernel success cannot substitute for a failed
RML conformance case or witness proof.
