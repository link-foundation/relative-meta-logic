# Releasing

## npm: `relative-meta-logic`

The JavaScript library in [`js/`](../js/) is published to npm as
[`relative-meta-logic`](https://www.npmjs.com/package/relative-meta-logic) by
a single workflow, [`.github/workflows/release.yml`](../.github/workflows/release.yml),
using [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC). No long-lived npm token is stored in the repository.

To release a new version:

1. Bump `"version"` in [`js/package.json`](../js/package.json) (and the
   matching `version` entries in `js/package-lock.json`) in a pull request.
2. Merge it into `main`.

On every push to `main` that touches `js/`, the workflow runs the JS test
suite, checks the package contents with `npm publish --dry-run`, and asks the
registry whether `relative-meta-logic@<version>` already exists
(`node scripts/npm-release.mjs check`). If it does not, the workflow publishes
it with provenance (`npm publish --provenance --access public`), polls the
registry until `npm view relative-meta-logic@<version> version` succeeds, and
creates the GitHub release `js-v<version>`. Pull requests only run the tests
and the dry run.

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
be published to npm or collide with the library. It is distributed as a VSIX
(`npm run package` in `vscode/`).

## crates.io

Publishing the Rust crate in [`rust/`](../rust/) to crates.io is tracked in
[issue #188](https://github.com/link-foundation/relative-meta-logic/issues/188)
and is intentionally not part of the npm release workflow.
