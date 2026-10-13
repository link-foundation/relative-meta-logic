# Compatibility and Release Policy

This document describes how Relative Meta-Logic (RML) evolves without
surprising downstream users. It applies to the two reference implementations:

- JavaScript package: [`js/package.json`](../js/package.json)
- Rust crate: [`rust/Cargo.toml`](../rust/Cargo.toml)

The JavaScript package and Rust crate are intended to move in lockstep. A
release should use the same `X.Y.Z` version in both manifests unless the
maintainer explicitly documents an exception in the release notes.

## Compatibility Surface

The public compatibility surface is the documented surface that users can rely
on between releases:

- `.lino` source syntax documented in the README, examples, and docs.
- Standard library import paths and documented exported names under `lib/`.
- CLI binary names and documented flags: `rml`, `rml-check`, `rml-meta`, and
  `rml-lsp`.
- JavaScript APIs documented in [`js/README.md`](../js/README.md) or the
  generated API reference.
- Rust APIs documented in [`rust/README.md`](../rust/README.md) or rustdoc.
- Structured diagnostic codes documented in
  [`docs/DIAGNOSTICS.md`](./DIAGNOSTICS.md).
- Documented exporter inputs and generated output contracts for Lean, Rocq,
  and Isabelle.

Internal helper functions, undocumented modules, files under `experiments/`,
and exact human-readable diagnostic wording are not compatibility guarantees.
Diagnostic codes are stable identifiers; messages may be clarified without a
breaking release.

The JavaScript and Rust implementations are also expected to stay behaviorally
aligned. For shared `.lino` programs, the same accepted input should produce
the same query results and the same compatibility-significant diagnostics in
both implementations. A drift between implementations is treated as a bug
unless a release note explicitly describes a temporary gap.

## Semantic Versioning

RML uses Semantic Versioning for both package artifacts.

### Patch releases

Patch releases (`X.Y.Z` to `X.Y.(Z+1)`) are for compatible changes:

- Bug fixes that preserve documented behavior.
- Documentation, examples, tests, and CI maintenance.
- Performance improvements that do not change public results or API shapes.
- More precise diagnostic messages under existing diagnostic codes.

Patch releases must not remove documented APIs, rename public symbols, remove
CLI flags, renumber diagnostic codes, or change successful results for valid
programs except to fix a clearly documented bug.

### Minor releases

Minor releases (`X.Y.Z` to `X.(Y+1).0`) are for compatible additions:

- New `.lino` syntax that does not invalidate existing valid programs.
- New standard library definitions.
- New CLI flags, exporter capabilities, diagnostics, or library APIs.
- New examples and documentation that describe existing or new behavior.

Minor releases may also carry deprecations, but deprecated behavior must keep
working until the removal window described below.

### Major releases

Major releases (`X.Y.Z` to `(X+1).0.0`) are for intentional breaks to the public
compatibility surface:

- Removing or renaming documented APIs, CLI flags, syntax, or library symbols.
- Changing documented evaluation semantics for valid programs.
- Removing diagnostic codes or changing their meaning.
- Requiring downstream users to edit source code, import paths, or build
  configuration for reasons other than documented bug fixes.

Major releases should include migration notes and should avoid combining
unrelated breaking changes when a smaller release can do the work.

### Pre-1.0 Compatibility

While the project version is below `1.0.0`, the API is not final. Even before
`1.0.0`, RML follows these rules:

- Patch releases are backward compatible.
- Breaking changes are never hidden in patch releases.
- A pre-1.0 breaking change must be released as a new minor version, marked as
  `BREAKING CHANGE` in release notes, and accompanied by a migration path when
  one exists.
- Deprecations are preferred over immediate removal whenever an alias or
  wrapper can preserve existing users.

After `1.0.0`, breaking changes require a major release.

## Deprecation Procedure

Deprecation is the normal path for changing a documented public surface.

1. Identify the deprecated surface and the replacement in an issue, pull
   request, or release note.
2. Update user-facing docs, JSDoc, and rustdoc where applicable.
3. Keep tests for both the old and replacement behavior while both are
   supported.
4. Keep the deprecated surface working for at least one minor release before
   `1.0.0`. After `1.0.0`, keep it working until the next major release unless
   a security, data-loss, or soundness issue requires faster action.
5. Emit a warning or non-fatal diagnostic when doing so will not break
   machine-readable output. If a warning would be disruptive, document the
   deprecation in release notes instead.
6. Remove the deprecated surface only in a release that is allowed to contain
   breaking changes, and list the removal in the release notes.

Compatibility aliases are preferred for renamed syntax and standard library
symbols. For example, a clearer name can be introduced first while the old name
continues to parse and evaluate.

## Release Cadence

RML does not use a fixed calendar train. Releases are cut when reviewed,
tested changes on `main` are ready for downstream users.

- Patch releases may be cut whenever a compatible fix or documentation update
  should be available without waiting for new features.
- Minor releases batch compatible feature work, new documented surfaces, and
  pre-1.0 breaking changes that have been clearly called out.
- Major releases are rare and should be planned through an issue or design
  note before release work starts.

Every release should complete this checklist:

1. Confirm JavaScript and Rust manifests use the intended same version.
2. Update the package lockfile when the JavaScript manifest changes.
3. Run the JavaScript test suite: `cd js && npm test`.
4. Confirm the Rust test suite passed on hosted CI (the `tests` workflow runs
   `cargo test --all-targets`). Rust is compiled only on hosted CI; locally,
   `node scripts/cargo.mjs test --all-targets --manifest-path rust/Cargo.toml`
   refuses unless `RML_ALLOW_LOCAL_RUST=1` is set.
5. Build or check generated API documentation when public APIs changed:
   `cd js && npm run docs`, and the `api-docs` workflow for
   `cargo doc --manifest-path rust/Cargo.toml`.
6. Update README or docs for any user-visible behavior, API, CLI, diagnostic,
   or release-process change.
7. Write release notes that call out additions, fixes, deprecations, and any
   `BREAKING CHANGE` entries.
8. Publish the package artifacts and then publish the GitHub release. The
   GitHub release event builds and deploys the generated API reference.

If only documentation changes, a package publish is optional. The release note
should still make clear whether npm, Cargo, both, or neither were published.
