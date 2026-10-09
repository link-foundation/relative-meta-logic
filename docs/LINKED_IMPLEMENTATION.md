# Executable implementation source as Links

The structured implementation archives extend R132/R151 beyond the six-operation
bootstrap. They hold the implementation's actual syntax trees, from which a
separate runnable implementation is generated. They are not source-token mirrors.
The JavaScript archive contains the owned runtime and build scripts. The Rust
archive contains every registered in-repository Rust crate's runtime sources,
including the Horn companion and the syntax adapter itself. The accompanying
manifests give the exact file inventory and source, AST, and generated-artifact
SHA-256 values. A capture certifies that inventory at those hashes; it does not
automatically cover later source additions.

This is implementation authority for the declared compilation route. It does not
certify the complete issue-183 foundational gate, a minimal bootstrap, intrinsic
Link semantics, or multiple independently minimal foundations. The executable
portable memory ABI and its generated JavaScript/Rust adapters are described in
`LINKED_TARGET_ABI.md`; their validation covers the declared parser, term and
proof-receipt operations. A universal source-to-physical-machine preservation
theorem is not supplied. Generic compiler trust is an explicit assumption. Normal
package entry points load their checked host files. The ordinary full JavaScript test suite includes a mandatory current-tree guard.
The always-selected linked-implementation workflow independently checks both
source inventories, configuration and source-free execution. The local build
wrapper and npm prepack hook enforce that same current-tree check.

## The authoritative representation

Each archive contains only a root address and a vector of Links. A Link is an
ordered vector of addresses of earlier Links. Strings, numbers, booleans, null,
lists, records, record keys, AST node kinds, and all syntax fields are encoded
through Links. Strings use UTF-16 code units, including unpaired surrogates;
neither a source buffer nor host objects are retained. Hash-consing preserves
sharing. The codec checks addresses, reference budgets, scalar canonicalization,
record-key uniqueness, depth, and expanded rather than merely stored size.

The codec's ordered addresses, distinguished anchor roles, scalar representation,
and traversal rules are explicit generic bootstrap conventions. Encoding them as
Links does not prove they are intrinsically necessary or minimal.

The JavaScript graph holds structured Babel AST nodes such as a binary operator
with two expression references, function declarations with argument and body
references, and verifier return records. A generic, repository-owned AST generator
emits ECMAScript from those structures. It does not emit stored source slices or
dispatch on any RML constructor. Capturing a source file requires its generated
form to parse back to exactly the normalized AST. Normalization removes locations,
comments, parser bookkeeping and redundant spelling; template raw/cooked values,
regular-expression patterns, binding structure and expression structure remain.

The Rust graph holds Syn ASTs: items, declarations, types, patterns, expressions,
statements and nested syntax. Syn and Quote emit syntax from the deserialized AST.
Every emitted module parses back to the exact canonical AST. `Verbatim` syntax
nodes are refused. Macro invocations retain structured Group/Ident/Punct/Literal
trees inside their AST nodes; macro expansion belongs to the declared generic
Rust compiler boundary. This is not a claim that a macro body has already been
expanded into ordinary Rust expressions.

## Capture, compile and check

`node scripts/linked-implementation-configuration.mjs --capture` deliberately
captures build manifests, dependency locks, workflows, directly linked library
inputs, vendored generic syntax code and owned OS metadata helpers. These are
separate data/provider inputs, not substitutes for the JavaScript/Rust ASTs.
Its manifest closes the declared npm/Cargo provider lists and hashes the generic
provider files. `--check` rejects a changed or omitted setting, library input or
provider. The source-free executions emit these configurations and libraries from
their Link graph before compiling; they do not copy host build settings.

`node scripts/check-linked-implementation.mjs` is the fast ordinary-build guard.
It checks archive integrity, exact current inventories and source/artifact pins
without requiring a source parser or installed dependencies. The existing
build/test lifecycle and npm packaging path invoke it, and CI also invokes it
directly, so omitting an archive cannot silently certify a current tree.

After an intentional source or dependency update, run
`node scripts/update-linked-implementation.mjs`. This explicit migration holds a
cache lease, builds the pinned syntax helper, regenerates the target adapters and
browser bundle, and captures both language graphs and the configuration graph.
An already verified helper can be selected with `--helper=PATH`. The wrapper's
`--source-migration` mode defers its consistency check until after the command;
it still fails unless the resulting implementation is consistent. Ordinary
builds and tests neither defer that check nor recapture edited host sources.

`node scripts/generate-linked-runtime.mjs --capture` explicitly imports the
current JavaScript runtime and non-test build scripts, checks structural
round-tripping and saves the graph and manifest. This is a migration or deliberate
refresh, never an action performed by a consistency test.

`node scripts/generate-linked-runtime.mjs --emit OUTPUT` reads the committed
archive and generates the complete JavaScript implementation into OUTPUT. It does
not read any original implementation source and does not use Babel to emit code.
Only the selected generic dependencies and input `.lino` programs are needed to
run that generated implementation.

`node scripts/generate-linked-runtime.mjs --check` rejects an omitted module,
host-only semantic edit, or generated syntax that differs from the Link AST. A
new semantic module must be deliberately included in the next capture. Comments
are not executable authority; the manifest additionally records the original
source-byte digest for snapshot provenance.

For Rust, build the pinned generic adapter with
`cargo build --locked --manifest-path scripts/linked-runtime-rust/Cargo.toml`.
Pass the resulting `rml-linked-rust-ast` executable to
`scripts/generate-linked-rust-runtime.mjs --capture HELPER`, `--check HELPER`, or
`--emit HELPER OUTPUT`. Emit uses only the supplied Link ASTs and the unchanged
generic syntax adapter. It never reads the original Rust implementation.

To edit authority, decode a graph with `decodeLinkedValues`, change the selected
AST expression or declaration, and re-encode it with `encodeLinkedValues`. The
compile/emit APIs accept that graph directly. Emit the changed graph into the
chosen host mirror before calling the save/check APIs. No host callback is added
to implement the changed definition. The original archive and its generated
runtime can remain concurrently available.

## Executed acceptance

`node --test scripts/linked-runtime.test.mjs` checks archive integrity, source-free
reconstruction, the real LiNo parser, formal term elaboration, every shared proof
verification case with independent replay, and exact regeneration of the complete
fixed-point K0 artifact. It replaces actual AST definitions for parser policy,
formal term construction, verifier acceptance and bracket compilation. Each
replacement changes observed behavior with the same generator and Node runtime.
The generated codec re-encodes the archive identically, and the generated
generator reproduces every artifact exactly. Replacing the generator's own
linked definition changes generated code and the real proof-replay result
executed from that code, with the input proof rules and proof-module AST unchanged.

`node scripts/verify-linked-rust-runtime.mjs HELPER TARGET_DIRECTORY` emits the
Rust runtime and companion crates, compiles them natively, runs the shared parser,
proof and kernel-replacement witnesses, and executes the companion's tests. It
then replaces the parser and verifier AST definitions, recompiles with the same
Rust toolchain and checks their changed results. Finally it compiles the AST
adapter from its own Link source and checks that this second-generation adapter
reproduces every Rust module exactly. Separate syntax regressions cover raw
identifiers, byte literals, singleton tuples and struct-update punctuation.

Run builds and native verification through `scripts/run-with-cache.mjs` with the
target directories registered. A caller-selected target is required so the
complete operation can own, account for and clean its outputs. Test fixtures and
generic dependency sources are external inputs; none of the original owned
runtime source files is copied into the generated execution tree.

These fixed points establish reproducible self-description and self-generation
under a declared generic substrate. They are not a proof that the seed codec,
generator, compiler or processor is trustworthy or minimal. The checked-in
manifests retain `fullImplementationClosure: false`.

## Remaining execution and target trust

The complete trusted chain for this route is:

1. The addressed-Link value codec, validation rules and artifact loader.
2. The generic JavaScript AST generator, or the pinned generic Syn/Syn-serde/Quote
   Rust syntax adapters. Their own owned implementations are also in the source
   archives; the initial bootstrap copies still supply execution authority until
   the demonstrated second generation runs.
3. Generic ECMAScript/Node or Rust semantics, standard libraries, macro expansion,
   dependency resolution, file loading, and the selected external dependencies.
   Babel is required only for JavaScript capture and consistency checking.
4. V8 or rustc/LLVM target lowering, machine-code generation, the operating system
   and the physical processor. These are large external assumptions, not new
   RML-specific callbacks and not a demonstrated minimal physical bootstrap.

Every RML-specific branch in the declared source inventory is compiled from its
Link AST. Changing those ASTs can change the generated runtime. Generic compiler
and target behavior must still be trusted for that compilation to preserve the
language semantics. The declared configuration/dependency closure is checked;
explicit user-selected programs and external tools remain caller input boundaries.
The executable target/ABI model described in `LINKED_TARGET_ABI.md` connects
RML term/value/proof representations to the declared parser and proof-receipt
observations, including byte-for-byte comparisons with generated native execution.
Those checks do not establish preservation for all possible workloads. Compiler correctness and minimality are separate,
stronger claims: no compiler correctness proof or Link-defined physical ISA model
is supplied, and the host toolchains are not relabelled minimal primitives.

Built-in `.lino` foundations already execute as selected Link definitions; they
remain input programs. Their selected rules and assumptions are distinct from
the implementation AST. Capturing the implementation does not grant a candidate
proof the ability to choose or replace its verifier or assumptions.

## Dependency repairs and licenses

The JavaScript capture parser is an explicit `@babel/parser` 8.0.7 development
dependency, pinned by `js/package-lock.json`; its MIT license ships in the
installed package. Capture requires Node.js ^22.18.0 or >=24.11.0. Babel 8
BigInt literal values are normalized to exact decimal strings before the
Links/JSON encoding, preserving values above the safe integer range.

The Rust adapter has its own exact direct versions and Cargo lock. The
vendored `syn-serde` 0.3.2 adaptation preserves its MIT and Apache-2.0 licenses.
Its complete Syn 3.0.6 schema migration, reproducible generator and preserved
serialization corrections are documented in
`scripts/linked-runtime-rust/PATCHES.md`. The generic punctuation reconstruction
is in the adapter's own source and therefore participates in self-generation.

## Current integrated validation

`case-studies/issue-183/data/source-authority-integrated-validation.json` records
the integrated 155-module JavaScript and 47-module Rust snapshot, with 139
configuration inputs and 912 provider records. The ordinary JavaScript suite
passed all 2,240 tests, and the separate cache-candidate validator passed all nine.
Older receipts remain historical snapshots at their recorded hashes.

The local Cargo run passed the parser, K0 replacement, shared proof corpus and
control-flow companion checks, then was interrupted during an unchanged long
Horn companion case as disk space became scarce. It is not recorded as a passing
aggregate. A separate bounded direct-`rustc` witness freshly compiled the emitted
owned parser/verifier mutations, self-generated syntax adapter and target ABI,
using read-only SHA-frozen generic dependency artifacts. It passed the Rust
generation fixed point, four syntax regressions, all 34 exact receipt-byte
comparisons and cross-port replays, and the layout/verdict/parser mutations.
The exact harness, generic inputs, compile commands and source/artifact hashes
are retained beside the report. This route does not claim a fresh Cargo provider
rebuild; the normal full Cargo workflow and all ordinary gates remain intact.
