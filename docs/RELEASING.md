# Releasing

## Release a version

Update the versions in `rust/Cargo.toml`, `rust/Cargo.lock`,
`js/package.json`, and `js/package-lock.json` in one pull request. Merge the
PR into `main`. A push to `main` that touches the packages or release
configuration checks and publishes any missing versions. A push of a
`v<version>` tag, such as `v0.20.0`, runs the same release workflow when the tag
points to a commit on `main` and matches both manifests. Run the workflow
manually on `main` to retry a failed release. Both registries skip versions
they already have. [Release workflow](../.github/workflows/crates-release.yml)

Pull requests validate the npm archive with `npm pack --dry-run` and the Rust
crate with `cargo publish --dry-run --locked`. Rust validation also builds a
fresh WebAssembly consumer of the packaged probability core. Publication
requires credentials only when a version is missing.

## npm

The [npm package](https://www.npmjs.com/package/relative-meta-logic) uses
`crates-release.yml` for [trusted publishing](https://docs.npmjs.com/trusted-publishers).
The workflow tries OIDC first and falls back to `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, or `NPM_AUTH_TOKEN` when configured. It polls until the new
version appears on npm and creates the GitHub release `js-v<version>`.
`release.yml` tests and checks the package archive.

Set `RML_RELEASE_DEBUG=1` when running the npm helper to log npm commands and
their output.

### One-time setup

npm can only attach a trusted publisher to a package that already exists, so
the very first version has to be bootstrapped once:

- Recommended: `package-registry-manager setup --repository . --registry npm --execute`
  publishes the first version with a short-lived token, registers the trusted
  publisher, and revokes the token.
- Alternative: add a short-lived granular npm token as the `NPM_TOKEN`
  repository secret, re-run the `crates-release` workflow on `main`, configure the
  trusted publisher (below), and delete the `NPM_TOKEN` secret again.

Then configure the trusted publisher, as an npm owner of the package:

```sh
npm trust github relative-meta-logic --file crates-release.yml \
  --repository link-foundation/relative-meta-logic --allow-publish --yes
```

or, on <https://www.npmjs.com/package/relative-meta-logic/access>, add a
GitHub Actions trusted publisher with organization `link-foundation`,
repository `relative-meta-logic`, workflow `crates-release.yml`, and no environment.

If a publish on `main` fails, the job log ends with the exact step that is
missing (bootstrap, trusted publisher, or a version bump).

## VS Code extension

The extension in [`vscode/`](../vscode/) has its own npm manifest named
`relative-meta-logic-vscode` and is marked `"private": true`, so it can never
be published to npm or collide with the library. It is distributed as a VSIX
(`npm run package` in `vscode/`).

## crates.io

The Rust library (`rml`) and the `rml`, `rml-check`, and `rml-meta` binaries
are published as [`relative-meta-logic`](https://crates.io/crates/relative-meta-logic).
The package includes the probability assessment example. Integration tests
that depend on parent directories run in `tests.yml`.

The helper checks the exact version on crates.io and skips versions
that already exist (including yanked versions). Any registry error other than
404 fails the check. For a new version, the publishing job:

1. Requests a short-lived OIDC token with the commit-pinned
   [`rust-lang/crates-io-auth-action`](https://github.com/rust-lang/crates-io-auth-action).
   The job has `id-token: write`; authentication has `continue-on-error: true`.
2. Supplies `CARGO_REGISTRY_TOKEN` to `cargo publish --locked` using exactly
   `${{ steps.crates_auth.outputs.token || secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`.
   OIDC takes precedence over both optional secrets. The action revokes its
   temporary token at job completion.
3. Polls crates.io for the exact published version with bounded retries.

Set `RML_RELEASE_DEBUG=1` to log registry lookup URLs. Credentials are never
printed by the helper. Publishing is guarded both by the workflow and helper
so that it runs for pushes to `main` or matching version tags, or a manual
run on `main`.

### First publication and trusted publisher setup

A new crate must be published once before its owner can attach a trusted
publisher. After merging the workflow, run from a checkout of `main` as the
intended crates.io owner:

```sh
package-registry-manager setup --repository . --registry crates-io --execute
```

This bootstraps with a short-lived crate-scoped token, registers the trusted
publisher, and revokes and verifies that temporary bootstrap token. This
command requires crates.io account credentials; GitHub access alone does not
grant registry access.

Alternatively, provide a short-lived crate-scoped `CARGO_REGISTRY_TOKEN`
(or `CARGO_TOKEN`) Actions secret and run `crates-release` on `main`. After the
first publication, open
[the crate settings](https://crates.io/crates/relative-meta-logic/settings) as a
crate owner and add the GitHub Actions trusted publisher with:

- Organization/owner: `link-foundation`
- Repository: `relative-meta-logic`
- Workflow filename: `crates-release.yml`
- Environment: leave empty (the workflow does not use a deployment environment)

Keep existing fallback secrets, per the
[issue #188 policy update](https://github.com/link-foundation/relative-meta-logic/issues/188#issuecomment-6150027498).
They remain optional once OIDC works. Do not confuse the temporary bootstrap
token, which is revoked, with separately managed fallback secrets.

If neither OIDC nor a fallback secret is usable, the publishing job on `main`
fails with these setup steps. PR validation needs no secrets and still passes.
Confirm the crate is visible on crates.io and an OIDC release succeeds after
owner setup. Then `cargo install relative-meta-logic --locked` installs the
CLIs, or `cargo add relative-meta-logic` adds the library (imported as `rml`).
