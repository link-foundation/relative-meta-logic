# Atomic Requirements Extracted from Issue #26

Each requirement below is parsed from a single sentence or phrase of the issue body. Every requirement has an ID (`R1`–`R12`) used by [`issue-plan.md`](./issue-plan.md) to trace which planned issue closes which requirement.

## R1. Anchor on the existing comparison docs

> "We need to use https://.../docs/CONCEPTS-COMPARISION.md and https://.../docs/FEATURE-COMPARISION.md ..."

The plan must consume both comparison documents as the authoritative list of features and concepts. Anything missing in those docs is out of scope until the comparison docs are extended (which is itself a planned issue).

## R2. Convert all missing features to GitHub issues

> "... to plan all missing features to be implemented as GitHub issues in this repository ..."

Every gap discovered in the comparison docs must produce a GitHub issue. The issue plan is exhaustive, not selective.

## R3. Capture the full plan inside the case study

> "... also in the case study we should have full plan ..."

The same plan must be readable as a case-study artifact (this folder), independent of GitHub. Reviewers should be able to read the plan without leaving the repository.

## R4. Wire dependencies between issues correctly

> "... each issue should correctly be blocked with issues, that it depends on. So we should use all relationships in GitHub issues to full potential ..."

Each issue declares prerequisites and post-conditions. The plan renders the dependency DAG so it can be inspected before the issues are filed.

## R5. Use tags/labels to full potential

> "... as well as tags and so on."

Every issue receives a consistent label set: an existing label (`enhancement`, `documentation`, `bug`, `good first issue`, `help wanted`, `question`) plus a small number of new labels for area, phase, and capstone status.

## R6. Maximum specificity per issue

> "... every issue is carefully planned and have maximum specific details on what and how to implement."

Each planned issue includes: motivation, links to the relevant comparison-doc cell(s), acceptance criteria, proposed LiNo syntax, suggested host-language API surface, candidate libraries, and effort estimate (S/M/L).

## R7. End goal: universal formal-system constructor

> "... implement the universal formal system constructor, that is as feature reach as any other traditional proving system ..."

The plan must reach feature parity with at least one major proof assistant (Lean/Rocq/Isabelle/Twelf) on the rows of the comparison docs that are *not* in deliberate divergence.

## R8. Surpass competitors on configurability and customizability

> "... yet in configurability and customizability surpasses them all ..."

Every new feature must preserve runtime configurability. New operators, type rules, semantics layers, and even the kernel (in phase J) must be redefinable from `.lino` files. No feature is allowed to lock RML into a single semantic choice.

## R9. Capstone: full self-reimplementation

> "... the final step of the plan should be full reimplementation of relative meta logic in itself, proving it is really meta logic system, capable of reasoning about itself, describing itself."

The plan ends with a phase whose deliverable is RML encoded in `.lino`. The encoded RML must:

- Parse, evaluate, and type-check `.lino` programs.
- Produce derivation traces (using the artifacts from phase C).
- Reproduce the host RML's outputs on the example corpus.
- Be auditable as `.lino` text (no escape hatches into the host language).

## R10. Style: links notation throughout

> "All in style of links notation with usage of references (words) an templates/patterns ..."

All encoded constructs use LiNo as the surface syntax. References are English words (not opaque identifiers). Templates/patterns mean reusable link-shapes, not host-language macros.

## R11. Style: as close to English as possible

> "... as close to english as possible, so even beginner without math knowledge has a high chance to understand and read each and every statement (link)."

Every encoded link reads as a natural sentence. Where a math term is unavoidable (e.g. `Pi`, `lambda`), the surface form keeps the head word and uses English connectors (`is`, `of`, `from`, `to`, `has`, `with`).

## R12. Compile data into `docs/case-studies/issue-{id}` with deep analysis

> "We need to collect data related about the issue to this repository, make sure we compile that data to ./docs/case-studies/issue-{id} folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), list of each and all requirements from the issue, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions)."

Atomic deliverables for this PR:

- [x] Folder `docs/case-studies/issue-26/`.
- [x] Atomic requirements list (this file).
- [x] Deep analysis ([`README.md`](./README.md)).
- [x] Gap-to-issue mapping ([`gap-matrix.md`](./gap-matrix.md)).
- [x] Full issue plan with bodies and dependencies ([`issue-plan.md`](./issue-plan.md)).
- [x] Online research and prior-art notes ([`research.md`](./research.md)).
- [x] For each requirement, at least one solution path is proposed and traced to a planned issue.
