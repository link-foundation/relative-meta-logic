# Releasing

## npm: `relative-meta-logic`

The JavaScript library in [`js/`](../js/) is published to npm as
[`relative-meta-logic`](https://www.npmjs.com/package/relative-meta-logic) by
a single workflow, [`.github/workflows/release.yml`](../.github/workflows/release.yml),
using [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC). No long-lived npm token is stored in the repository.

To release a new version:

1. Bump `"version"` in [`js/package.json`](../js/package.json) (and the
   matching `version` entries in `js/package-lock.json`) and the Rust manifest
   and lockfile in a pull request, keeping both implementations aligned.
2. Merge it into `main`.

On a push to `main` that touches `js/`, this workflow runs the focused release
tests on Node 24 and checks package contents with `npm publish --dry-run`.
The `tests` workflow runs the full JavaScript suite. The release workflow asks the
registry whether `relative-meta-logic@<version>` already exists
(`node scripts/npm-release.mjs check`). If it does not, the workflow publishes
it with provenance (`npm publish --provenance --access public`), polls the
registry until `npm view relative-meta-logic@<version> version` succeeds, and
creates the GitHub release `js-v<version>`. Pull requests run the release tests,
dry run and registry check.

Set `RML_RELEASE_DEBUG: '1'` in the workflow to log every npm command and its
raw output.

### One-time setup

npm can only attach a trusted publisher to a package that already exists, so
the very first version has to be bootstrapped once:

- Recommended: `package-registry-manager setup --repository . --registry npm --execute`
  publishes the first version with a short-lived token, registers the trusted
  publisher, and revokes the token.
- Alternative: add a short-lived granular npm token as the `NPM_TOKEN`
  repository secret, re-run the `release` workflow on `main`, configure the
  trusted publisher (below), and delete the `NPM_TOKEN` secret again.

Then configure the trusted publisher, as an npm owner of the package:

```sh
npm trust github relative-meta-logic --file release.yml \
  --repository link-foundation/relative-meta-logic --allow-publish --yes
```

or, on <https://www.npmjs.com/package/relative-meta-logic/access>, add a
GitHub Actions trusted publisher with organization `link-foundation`,
repository `relative-meta-logic`, workflow `release.yml`, and no environment.

If a publish on `main` fails, the job log ends with the exact step that is
missing (bootstrap, trusted publisher, or a version bump).

## VS Code extension

The extension in [`vscode/`](../vscode/) has its own npm manifest named
`relative-meta-logic-vscode` and is marked `"private": true`, so it can never
be published to npm or collide with the library. Run `npm run package` in
`vscode/` to build `relative-meta-logic-vscode.vsix`.

## crates.io

The Rust library (`rml`) and the `rml`, `rml-check`, and `rml-meta` binaries
are intended for crates.io as `relative-meta-logic`. The separate
[crates-release.yml](../.github/workflows/crates-release.yml) workflow handles
Rust releases; npm keeps its existing `release.yml` identity.

To release, bump `version` in `rust/Cargo.toml` and the crate's entry in
`rust/Cargo.lock`, together with the matching JavaScript manifest/lockfile
versions, and merge the PR into `main`. Changes to `rust/`, the release helper,
this guide, or the workflow trigger validation; a manual run on `main` can
retry a failed release without another version bump.

On pull requests, CI runs the release regression tests and
`cargo publish --dry-run --locked`. This builds the packaged library and
binaries without uploading anything or requesting credentials. The full
Rust suite remains in `tests.yml`. Repository integration tests and examples
that depend on parent directories are excluded from the crate archive.

The npm and Cargo packages carry the theory inputs needed at runtime. The
canonical inputs are in `lib/meta-theory/`. The hosted recapture workflow
updates package copies with `node scripts/sync-release-assets.mjs`, and the
release asset test checks byte equality and npm tarball membership.

On `main`, the helper checks the exact version on crates.io and skips versions
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
so that it only runs for `push` or `workflow_dispatch` on `main`.

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
Workflow readiness does not prove the first upload or trust registration:
confirm the crate is visible on crates.io and an OIDC release succeeds after
owner setup. Then `cargo install relative-meta-logic --locked` installs the
CLIs, or `cargo add relative-meta-logic` adds the library (imported as `rml`).
