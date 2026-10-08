# Pinned upstream language implementation

RML consumes the official implementation merged for
[meta-language issue 195](https://github.com/link-foundation/meta-language/issues/195)
at commit
[`679a3b3c3c56177b8df1ad82672690c6e9889aeb`](https://github.com/link-foundation/meta-language/commit/679a3b3c3c56177b8df1ad82672690c6e9889aeb).
This is an immutable source dependency, not a claim that the implementation has
been published to npm or crates.io. As checked on 2026-10-08, npm's latest
meta-language release remains 0.46.0 and crates.io's remains 0.58.2. The source
also labels itself 0.58.2, but contains newer code; its commit identifies the
implementation unambiguously.

## Installation and provenance

Use Node.js 22.18+ or 24.11+ (Babel 8 capture support), Rust 1.90 or later, Git and a C compiler.

```sh
git clone --recurse-submodules https://github.com/link-foundation/relative-meta-logic.git
cd relative-meta-logic
node scripts/bootstrap.mjs --install
node scripts/verify-meta-language-source.mjs
```

A non-recursive developer clone also works: bootstrap initializes only the
registered `js/vendor/meta-language` submodule at the exact pinned Git pointer.
It rejects changed URLs, unexpected pointers, symlinks, a different populated
revision and local source changes instead of replacing the developer's work.
Initialization changes only this checkout's submodule state. CI explicitly
checks out submodules. A plain `git archive` does not include submodules; source
archives must include the materialized runtime files before installation.

The JavaScript `#meta-language` package import resolves directly to the
unmodified upstream runtime in the submodule. Its public functions are exposed
by `js/src/rml-upstream-language.mjs` and re-exported by `rml-meta-language.mjs`.
The Rust dependency pins the same Git revision, and `rml::upstream_language`
exposes the corresponding upstream APIs. Optional upstream dictionary support
is disabled; no parser, grammar or four-language representation is removed.

`js/vendor/meta-language-provenance.json` records the revision, 235 runtime-file
SHA-256 hashes, license and shared-corpus hashes, and effective JavaScript
dependency versions. The upstream Unlicense and all vendored grammar notices
and licenses are preserved. The verifier checks every shipped runtime file,
RML's manifests and locks; `--source /path/to/official/checkout` additionally
checks an independently materialized checkout at the exact commit.

RML uses links-notation 0.23.0 in JavaScript and Rust. The vendored JavaScript
runtime resolves RML's 0.23.0 as well; its unmodified upstream package metadata
names 0.22.0, so this is an explicitly tested dependency upgrade. The Rust
upstream crate retains its own 0.22.0 dependency. Both JavaScript dependencies
and the Rust Git dependency are locked. Generated upstream parser binaries and
compressed C parsers are already in the pinned source. Rust's official
`build.rs` expands and compiles the latter in Cargo's build-output directory;
installation does not regenerate grammars, invoke Docker, or alter global tools.

The npm package allowlist includes the upstream runtime, data and licenses,
without the upstream repository's development corpora or Git metadata. A packed
RML package is self-contained and requires no Git operation or upstream source
checkout in the consumer. Normal registry dependencies are installed by npm.
Source installation and packaged consumption are verified separately; this is
not evidence of a new upstream registry release. Rust registry publication must
wait for an upstream release containing the source-pinned implementation or a
separately reviewed publication strategy; publishing against the old 0.58.2
registry contents would silently regress capabilities.

## Real upstream structure and edits

The following functions come directly from upstream, with no RML replacement
parser or token-envelope surrogate:

- `analyzeProgram` / `analyze_program`: grammar CST, scopes, bindings, exact source
  mappings, project modules and symbol references, language-specific constructs,
  extension/proof syntax and diagnostics
- `constructProgram` / `construct_program`: reject syntactically invalid input
- `ProgramRepresentation`: query, binding-aware rename with capture checks,
  range replacement, insertion, deletion, cloning, movement and source emission
- `serializeSnapshot` / `serialize_snapshot` and `fromSnapshot` / `from_snapshot`:
  retain source fragments for reload without a separate original source field
- `translateProgram` / `translate_program`: upstream translation contracts,
  encodings, assumptions, diagnostics and generated target source

Official snapshot reload reconstructs retained fragments and reparses them; it
is not a claim of source-free semantic links-network execution. RML's separate syntax
extension and source-free structured links-network canonical emitter retain their existing contracts.

Shared downstream tests consume the upstream four-language conformance fixture
unchanged. They check JavaScript, Rust, Lean, Rocq and the Coq alias; malformed
input; lexical shadowing, Unicode, templates, literals and property identity;
capture refusal; structured edits; and multi-file modules, manifest resolution,
project symbol identities and missing-context diagnostics. They also keep
source-level type facts and unavailable elaboration distinct.

## Translation boundary

The official implementation performs semantic translations for its portable
core. Tests exercise all twelve directed APIs on a shared output program and
verify that semantic results contain their actual preservation contracts.
Arbitrary unsupported source still produces a reversible source envelope with
a diagnostic and no semantic result. That envelope is preservation of source,
not translation of its behavior or proof. Consumers must inspect `semantics`
(JavaScript) or `semantics()` (Rust), retain every assumption and obligation,
and never count an envelope as an implemented semantic path.

The full-language requirement remains open: these tests do not establish full
standard conformance, general type/proof elaboration, or arbitrary program and
proof equivalence. Upstream's capability inventory targets Rust 1.99,
ECMAScript 2026, Lean 4.34.1 and Rocq 9.3. Successful local parser tests and
older installed proof tools do not establish those native toolchain contracts.
RML's own bounded portable-natural translator and proof verifier remain
separately tested implementations.

## Verification commands

```sh
node scripts/verify-meta-language-source.mjs
node scripts/run-with-cache.mjs -- node --test \
  scripts/initialize-meta-language.test.mjs js/tests/upstream-language.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test upstream_language_tests
npm --prefix js test
npm --prefix js run build:playground
```

The existing browser playground continues to bundle its browser-compatible RML
entry point. Node-only upstream parsing APIs are available through the Node
package; they are not silently substituted or exposed as browser-ready APIs.
