# Temporarily vendored meta-language PR #201 code

This directory is a **temporary, pinned copy** of part of the JavaScript package
from an unreleased meta-language pull request. RML needs its four-language
portable-core frontends, checker, emitters and source-free typed-program links
before the next meta-language release, so the code is copied here instead of
waiting. It is not RML-owned code and must not be edited in place.

| Field | Value |
| --- | --- |
| Upstream repository | <https://github.com/link-foundation/meta-language> |
| Pull request | [#201](https://github.com/link-foundation/meta-language/pull/201), branch `issue-199-58f3573d6122` |
| Exact upstream commit | `7c4bf8f1e3f88806b09d5210643cc6611d30d1f9` |
| License | Unlicense (public domain), copied unchanged as [`LICENSE`](LICENSE) |
| File lock | [`upstream-files.json`](upstream-files.json): every path, byte count and sha256 |
| Copied files | 50 JavaScript modules under `js/src` plus `js/src/data/typed-program-links-schema.lino` and `js/src/data/reference-operations.lino` |
| Local shims | `js/src/network.js` and `js/src/primitives.js` (see below) |

The pinned [`js/vendor/meta-language`](../meta-language) submodule (revision
`a79782093cae3b33606483ac9f3e1d05faf36de0`) is unchanged and remains RML's
`#meta-language` dependency. This copy is reached only through the separate
`#meta-language-pr201/*` package import and is registered as a declared
external boundary in `scripts/external-checkouts.json`, so it is not captured
as RML's owned linked implementation.

## How it was obtained

1. `gh api repos/link-foundation/meta-language/tarball/7c4bf8f1e3f88806b09d5210643cc6611d30d1f9`
   was downloaded into a scratch directory. No upstream install, build, test,
   `prepare` or postinstall script was run, and no upstream `package.json` or
   lockfile was copied.
2. The import closure of `typed-program-links.js` and the four
   `translation/{javascript,rust,lean,rocq}.js` frontends and
   `translation/emit-*.js` emitters was computed by reading `import`/`export`
   specifiers, stopping at `network.js`.
3. Those files and the two data files they read at load time were copied byte
   for byte, and their sizes and sha256 hashes were written to
   `upstream-files.json`. `verifyVendoredMetaLanguage()` in
   `js/src/rml-certified-translation.mjs` re-checks every hash; the test
   `js/tests/certified-translation.test.mjs` fails on any edit.

## Local shims (not upstream code)

- `js/src/network.js` re-exports the submodule's `network.js`. The PR #201
  version imports the complete grammar catalog (tens of megabytes of data); the
  copied typed-program code only needs `LinkNetwork` with field relations,
  `toLino` and `fromLino`, which the pinned submodule already provides.
- `js/src/primitives.js` re-exports the submodule's `primitives.js`. The PR #201
  file is byte-identical to the submodule file (the lock records its upstream
  hash and marks it `"shim": true`); re-exporting keeps one `LinkId` /
  `LinkMetadata` class identity shared with RML.

The copied modules use `links-notation` only to read the two `.lino` data files.
They resolve RML's installed `links-notation@0.25.1` instead of upstream's pinned
0.22.0; the vendored tests exercise this combination.

## Removal criteria

Delete this directory, the `#meta-language-pr201/*` import, the
`files` entry in `js/package.json` and the `scripts/external-checkouts.json`
boundary when **all** of the following hold:

1. A meta-language release (npm and crates.io, matching versions) contains the
   PR #201 typed-program links, the four frontends, `checkProgram` and the four
   emitters with the behavior pinned here.
2. RML's `#meta-language` submodule/dependency points at that release, and
   `js/src/rml-certified-translation.mjs` imports the same functions from it.
3. `node scripts/generate-certified-translations.mjs --check` passes after the
   switch, or the regenerated corpus differences are reviewed and committed with
   a new translator pin in every certificate.
4. The Rust mirror can consume the released crate's typed-program decoder, so
   the Rust certificate checker re-derives instead of only checking integrity.

The draft upstream feature requests that RML needs are listed in
[`docs/case-studies/issue-183/meta-language-upstream-requests.md`](../../../docs/case-studies/issue-183/meta-language-upstream-requests.md).
They have not been filed.
