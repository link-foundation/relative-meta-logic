# Executable source and entrypoint coverage

`scripts/linked-executable-inventory.mjs` discovers maintained executable source
across the repository. The JavaScript inventory includes `.mjs`, `.cjs` and `.js`
files wherever they occur, and the Rust inventory includes maintained `.rs`
files, including executable examples. It no longer assumes all application code
lives under `js/src`, `rust/src` and `scripts`.

This includes the VS Code extension, server resolver and packaging copier; the
browser application's modules and bundled runtime; runnable examples and
experiments; companion crates and their examples; and the authority machinery
itself. Each discovered implementation is captured as structured syntax and must
round-trip exactly through its unchanged generic generator. CommonJS mode is
derived from the filename and nearest package manifest and is checked against
the stored AST, so changing package loader mode cannot silently reinterpret an
existing captured module.

Public npm `main`, `module`, `bin`, `exports` and `browser` targets must resolve to
represented owned code. Cargo default and declared executable targets are checked
as well. Browser script elements must refer to represented modules; inline script
or event-handler code requires explicit structural support rather than an opaque
HTML exception. Relative static imports and CommonJS requires are checked against
the represented source/data set. Dynamic import sites are reported separately in
the implementation manifest; they are not counted as statically resolved edges.

## Explicit boundaries

- Installed `node_modules`, declared submodules and the vendored generic syntax
  provider belong to the recorded dependency/provider boundary. Package locks,
  syntax-provider sources, licenses and declared package/UI configuration are
  carried in the configuration graph.
- Ordinary test directories, test files and independent corpus/case-study inputs
  are evidence inputs. Pointing a public package entry or a static runtime import
  into excluded evidence fails. Runnable examples and experiments are included as
  implementation source even when their purpose is investigation.
- Cache-policy output roots are generated artifacts. Tests reconstruct the VS Code
  server from generated JavaScript and compare copied files. They rebuild the
  browser artifact from restored sources and require its normalized AST to equal
  the authoritative bundled-runtime AST. Discovery does not claim to certify an
  arbitrary pre-existing cache directory merely because it is present.
- Audited Docker, cache and hook shell/PowerShell helpers are explicit generic
  process/build providers, stored and hashed as configuration inputs. They are not
  claimed to be structured RML runtime implementations or a minimal physical basis.
  A newly introduced unsupported executable language fails discovery until its
  source or provider role is explicitly implemented.

The source guard scans this policy and checks both language archives, every public
entrypoint and configuration/provider pins. It rejects an added executable outside
the former source roots, an unrepresented package target, a relative import into
evidence and host-only semantic changes. Capture remains an explicit operation;
checks never silently refresh the authoritative graph.

## Executed evidence

`scripts/linked-executable-inventory.test.mjs` reconstructs the JavaScript tree and
configuration from the Link archives. Only generic installed dependencies and
independent tests are supplied externally. It runs the existing four VS Code
tests, two stdio LSP tests and four playground tests against those generated files.
The generated packaging copier supplies the actual server launched by the editor
tests. The browser builder uses a structural AST transformation, so import quoting
and whitespace changes introduced by generation do not break its Node-to-browser
adaptation.

Two replacement tests keep the generator and host capabilities unchanged. One
edits the editor's language selector in Links, then executes the generated extension
activation/deactivation using explicit VS Code capability stubs. The other edits
the server's diagnostic classification and observes a real stdio LSP response:
the same E001 diagnostic changes from severity 1 to severity 2. The latter runs a
real generated server process rather than replacing its evaluator with a mock.

Rust sources continue through the independent structured Syn pipeline. Maintained
Rust examples are generated from their ASTs; the native witness copies only test
inputs, never host example implementations over those generated files. Exact
validation commands, counts and snapshot hashes are recorded in the delivery
evidence. This is a declared executable/provider coverage policy and observation
contract, not a universal proof about arbitrary dynamically interpreted data or
generic compiler correctness.
