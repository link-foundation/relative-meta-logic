# Issue 188 work plan

Objective: implement and verify the crates.io publication path in PR 191 on
`issue-188-cc2107131740`; do not merge the PR or present external setup as done.

## Requirements and verification

- [x] Read issue 188, its sole policy comment, all three PR comment/review types,
  and the sub-issue list (empty). Related issues template#205 and
  package-registry-manager#62 are policy context, not required sub-issues.
- [x] Choose publishing: this is a documented public library plus three CLI
  binaries; compatibility policy requires aligned Rust/JS releases.
- [x] Prepare crate metadata/package contents and a patch release, keeping Rust,
  JavaScript, and lockfile versions aligned.
- [x] Add a separate crates.io workflow with PR packaging validation, main-only
  release, pinned OIDC action, id-token: write, continue-on-error authentication,
  and OIDC > CARGO_REGISTRY_TOKEN > CARGO_TOKEN precedence.
- [x] Check existing versions, fail closed on registry errors, verify registry
  visibility after publishing, and explain bootstrap/trust failures clearly.
- [x] Document exact trusted publisher identity and first-publish setup; retain
  fallback secrets in accordance with the issue's later policy update.
- [x] Add regression coverage to existing node --test scripts/ framework. Show
  the workflow regression fails before the fix; run focused tests locally and
  leave Rust compilation/full suites to existing CI.
- [x] Inspect the PR diff, ensure main is included, push only the prepared
  branch, and update PR title/body with Fixes #188. Final CI and readiness
  evidence is maintained in PR 191 and its check results.
- [ ] First publication and trusted publisher registration: verify feasibility;
  record any exact external blocker without claiming this criterion is done.

## Initial evidence

- crates.io API returned HTTP 404 on 2026-11-17: crate does not exist (saved in
  crates-status.json).
- No local CARGO_REGISTRY_TOKEN/CARGO_TOKEN/CRATES_IO_TOKEN environment variables
  or Cargo credentials; repository Actions secrets list is empty.
- Prepared branch already includes origin/main (1 branch-only commit, 0 missing).
- Initial PR CI succeeded for b359b76739e499412b498aad27cb917f8dff115f.
- Official rust-lang/crates-io-auth-action v1.0.6 resolves to commit
  3268eb413133e2960fa4ae0e963ca76380c54cd9; the current Rust template uses it
  with continue-on-error and the required fallback expression.

## Local verification

- Regression before the fix: `node --test scripts/crates-release.test.mjs`
  fails because the publishable crate has no crates.io workflow (1 failed).
- After implementation: `node --test scripts/crates-release.test.mjs
  scripts/npm-release.test.mjs scripts/docs.test.mjs` passes all 47 tests.
- actionlint 1.7.12 validates both release workflows with no diagnostics; its
  downloaded archive passed the upstream SHA-256 checksum.
- `cargo package --manifest-path rust/Cargo.toml --list --locked --allow-dirty`
  lists the library, all CLI sources, manifest, lockfile, and README (21 files).
  `--allow-dirty` is only needed before the development commit; CI omits it.
- `node scripts/crates-release.mjs check` successfully reads Cargo metadata and
  queries the actual registry: relative-meta-logic@0.19.1 is absent and
  should_publish=true. No Cargo build was run locally.
- Organization Actions secrets cannot be inspected: API returned HTTP 403
  (requires organization admin/admin:org). Their existence is unknown; no
  accessible credential can bootstrap the crate from this session.

## CI verification

For implementation commit d8c9fc05e8ccc4e896d08797ed69bd0b1799f82d:

- crates-release run 44039032946 succeeded: 21 files / 154.9 KiB compressed,
  packaged library/binaries compile, upload explicitly aborted for dry run,
  should_publish=true, publish job skipped on the PR.
- tests run 44039032898 succeeded: JavaScript 1316 passed, zero failed; every
  Rust target passed. npm release validation 44039032902 also succeeded.
- API docs 44039032470, parity 44039032485, bootstrap 44039032502, and English
  lint 44039032934 succeeded. Docker and final-head results are tracked in PR.
- A reusable registry-probe.mjs verifies the actual 200 response using known
  links-notation@0.13.0, and reports whether the current crate version exists.
- Final review removed redundant homepage metadata reported by Cargo and
  captures mocked verification messages in tests so CI logs cannot mistake a
  mocked success for a real RML publication.

PR: https://github.com/link-foundation/relative-meta-logic/pull/191

First publication/trusted publisher registration remain explicitly unfinished:
crates.io requires registry owner credentials, and the workflow must first be
merged into main by the repository's normal review process.
