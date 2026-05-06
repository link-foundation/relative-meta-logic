# Issue-26 filing tool

Files the planned issues from `../../docs/case-studies/issue-26/issue-plan.md` on GitHub. Used once to file 67 issues + 1 tracking epic from PR #27 (issue #26). Kept here so the same workflow can be re-run for future plans (just edit `issues.json` and run `file-issues.mjs`).

## Files

- `issues.json` — Spec for every planned issue: title, labels, motivation, goal, LiNo surface, API surface, acceptance criteria, `depends`/`blocks` (by plan ID), out-of-scope.
- `validate.mjs` — Sanity checks (referenced IDs exist, no cycles).
- `file-issues.mjs` — Two-pass filer:
  1. **Create pass** (no flag): topologically orders by `depends` and creates each issue with `gh issue create`. Records the `planID → GitHub-number` map in `state.json` so re-runs are idempotent.
  2. **Update pass** (`--update`): re-renders each body with real `#N` cross-references and edits the issue with `gh issue edit`.
- `state.json` — Persisted `planID → GitHub-number` map. Human-readable, committed for provenance.

## Usage

```bash
node validate.mjs
node file-issues.mjs                  # create pass, fills state.json
node file-issues.mjs --update         # update pass, rewrites bodies with real #N
node file-issues.mjs --dry-run        # preview without calling gh
node file-issues.mjs --only=A1,A2     # restrict to specific plan IDs
```

The script is repository-pinned (`REPO = 'link-foundation/relative-meta-logic'`). It assumes that the labels referenced in `issues.json` (e.g. `phase:A`, `area:diagnostics`, `capstone`) already exist; create them once with `gh label create` if needed (see the label scheme in `issue-plan.md`).
