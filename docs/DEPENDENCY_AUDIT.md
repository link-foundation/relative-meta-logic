# Maintained dependency audit — 2026-10-08

This refresh installs the current maintained direct runtime/tooling releases and
updates compatible lockfile resolutions. It does **not** claim that every
transitive dependency is the newest upstream major. The complete dated
[registry audit](case-studies/issue-183/data/dependency-audit-2026-10-08.json)
records official URLs, response hashes, exact locks and upstream version bounds.

## Maintained direct dependencies

| Scope | Current selected version | Official source |
| --- | --- | --- |
| JavaScript AST capture | @babel/parser 8.0.7 | [npm](https://registry.npmjs.org/@babel%2fparser/latest) |
| JavaScript runtime | events 3.3.0; links-notation 0.23.0; web-tree-sitter 0.27.0 | [events](https://registry.npmjs.org/events/latest), [links-notation](https://registry.npmjs.org/links-notation/latest), [web-tree-sitter](https://registry.npmjs.org/web-tree-sitter/latest) |
| JavaScript build/docs | esbuild 0.28.2; jsdoc 4.0.5 | [esbuild](https://registry.npmjs.org/esbuild/latest), [JSDoc](https://registry.npmjs.org/jsdoc/latest) |
| Editor | vscode-languageclient 10.1.2; @vscode/vsce 4.0.0 | [client](https://registry.npmjs.org/vscode-languageclient/latest), [VSCE](https://registry.npmjs.org/@vscode%2fvsce/latest) |
| Rust runtime | links-notation 0.23.0; sha2 0.11.0; serde_json 1.0.151; regex 1.13.1 | [crates.io registry](https://index.crates.io/config.json) |
| Rust AST capture | Syn 3.0.6; Quote 1.0.47; serde_json 1.0.151 | [Syn](https://crates.io/crates/syn/3.0.6), [Quote](https://crates.io/crates/quote/1.0.47), [serde_json](https://crates.io/crates/serde_json/1.0.151) |
| Generic AST serializer | syn-serde 0.3.2+rml.syn3, based on published 0.3.2 | [published source](https://crates.io/crates/syn-serde/0.3.2) |
| Schema generator | syn-codegen 0.4.2 | [official registry](https://index.crates.io/sy/n-/syn-codegen) |
| Artifact upload action | actions/upload-artifact@v7, current release v7.0.2 | [release](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) |

Babel 8 is now explicit rather than an incidental JSDoc dependency. Its supported
Node range, `^22.18.0 || >=24.11.0`, is declared by the JavaScript package. Its
BigInt literal values normalize to exact decimal strings before Links/JSON
encoding; values above the safe-integer limit are never converted to Number.
The editor minimum is now VS Code 1.91, matching languageclient 10.1.2.

The serializer's `+rml.syn3` build metadata identifies a local migration, not an
upstream release. The complete Syn 3 schema, adapted upstream generator, Cargo
lock, licenses and immutable source provenance are checked in. New modifier,
safety, receiver, function-pointer, type-attribute and guard fields are retained.
Reserved frontmatter is rejected. The generic byte/raw-identifier/punctuation
repairs remain. See [PATCHES.md](../scripts/linked-runtime-rust/PATCHES.md).

Rust scalar source ingress accepts only default function safety and empty
function/local modifiers. Unsafe, async, const, generic, extern and nonempty or
unknown modifier forms remain explicit unsupported obligations. Regenerated
positive and negative fixtures verify that the version migration cannot silently
broaden that scalar language subset.

## Exact remaining constraints

* JSDoc 4.0.5 still requests Babel 7, markdown-it 14, older markdown helpers and
  other earlier major versions. RML's own capture parser uses Babel 8 directly.
  Overriding JSDoc's private major-version requirements would be a separate
  compatibility migration.
* VSCE 4.0.0 constrains its keyring, secretlint, Azure and packaging dependency
  families to earlier majors. The lockfile has been updated within its supported
  ranges; the audit records every remaining package and parent requirement.
* The pinned official meta-language Rust implementation still depends on
  links-notation 0.22.0 and earlier itertools, strum and some grammar versions.
  RML directly uses links-notation 0.23.0. The official source pin is preserved.
* tree-sitter-sequel 0.3.11 requires `cc ~1.2.1`, so Cargo resolves cc 1.2.67
  despite the current cc 1.6.0 release. Other older Cargo majors are similarly
  constrained by their parent crates; all are enumerated in the audit.
* npm's meta-language release remains 0.46.0 and crates.io's remains 0.58.2.
  Neither contains all capabilities in official commit
  `679a3b3c3c56177b8df1ad82672690c6e9889aeb`, which also labels itself 0.58.2.
  Rust registry publication must wait for an upstream release containing that
  implementation or a separately reviewed publication strategy. No release was
  published or upstream communication sent by this refresh.
* The initial three sparse-index failures are preserved in the audit. A later
  read of the official `rust-lang/crates.io-index` repository verifies
  tree-sitter-toml-ng 0.7.0, tree-sitter-vb-dotnet 0.1.0 and tree-sitter-yaml
  0.7.2. All 349 package records now have dated successful official reads.
  The added ABI companion lock is included and its nine older compatible
  resolutions were updated. Seventy-five records still contain at least one
  older constrained transitive version; no incompatible override was forced.

GitHub checkout/setup-node/configure-pages/upload-pages-artifact/deploy-pages
already use their current major releases. Artifact upload v7 keeps the current
workflow inputs and uses the Node 24 action runtime. Native Lean 4.34.1 and Rocq
9.3 verification is a separate proof-toolchain checkpoint; this dependency audit
alone does not claim those proof checks passed.

## Deliberate migration and verification

Dependency updates remain explicit. Use `node scripts/update-linked-implementation.mjs`
after changing the source or locks. Its declared migration holds the cache lease,
builds the pinned helper, regenerates adapters and browser output, and captures
both language graphs and configuration before enforcing consistency. Then run
the ordinary source-free witnesses. Ordinary verification never recaptures host
edits automatically.

Checked-in JSON provider files are canonicalized recursively by key so the
configuration generator emits their exact pinned bytes. The schema provenance
retains the original official download checksum; this formatting normalization
preserves its JSON value, and the Rust manifest pins the actual local file hash.

The schema generator was run twice and produced byte-identical adapters. Local
checks cover exact AST round trips for 37 owned Rust modules plus the three new
ABI modules, 107 scalar source/control-flow JavaScript tests, eight native Rust
control-flow tests, editor LSP smoke tests, JSDoc and VSIX packaging. The validation
receipt records final source-free and aggregate-suite results separately, along
with any interrupted attempt; partial runs are not reported as complete passes.
