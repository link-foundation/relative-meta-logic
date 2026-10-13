# Executable linked target and native observations

`lib/target-abi/model.links.json` is a pure Link graph for an executable portable
RML interface. It specifies a concrete byte-addressed memory layout and adapter
programs. Both generated runtime entry points consume that layout and execute
the model's quotation, request construction, receipt construction and verdict
projection. The resulting request goes to the actual linked-program reducer.
The target does not introduce a proof oracle or substitute a demonstration
calculus for RML.

The graph contains no source buffer. Its adapter expressions have arguments,
text, lists, branches, list operations, equality, conjunction and recursive
calls. A generic interpreter evaluates those expressions. Separate generators
compile them into JavaScript and Rust functions; model names and proof markers
appear as model data, never as cases in the generic expression evaluators.
The generators, bridge modules and generated adapters are themselves included
in the whole-implementation structured AST capture.

## Actual target contract

The default target is an aligned arena with 32-bit unsigned offsets and
little-endian words. A three-word frame stores a magic value, root address and
total byte length. A three-word cell stores a tag, payload address and length.
A text payload contains strict UTF-8. A list payload contains ordered child
addresses. Allocation order, padding, offsets and complete input consumption
are canonical; decoding re-encodes and compares the complete frame. Malformed
UTF-8, aliases, cycles, hidden bytes, unknown tags and arithmetic/budget failures
are refused. Endianness, alignment, field order, tags and resource limits are
explicit model fields.

This is a stable process/interface memory ABI implemented by JavaScript byte
arrays and native Rust byte vectors. It does not claim that V8 objects and
Rust's unspecified enum layout have an identical physical representation.
Rustc/LLVM, Node/V8, generic dependencies, the operating system and CPU remain
explicit generic execution assumptions. Their correctness or minimality is
not proved by the capture or by the conformance witness.

The common text domain consists of Unicode scalar values, with no normalization.
The model refuses lone JavaScript UTF-16 surrogates, which Rust `String` cannot
represent. The proof ABI defaults to nonempty text and finite ordered trees.
Its arena/resource domain is explicit and narrower than arbitrary JavaScript
objects or arbitrary host integer values. Receipt step counts use canonical
decimal text, checked against a 32-bit unsigned range at the receipt boundary.
Term resource limits and adapter call depth/fuel remain errors; they are not
logical rejection verdicts. This ABI does not assert equivalence for inputs
outside its declared portable domain or every possible existing options object.

## Source-to-artifact witness

`scripts/verify-linked-target.mjs` reconstructs the JavaScript and Rust runtime
sources, configuration and linked libraries solely from the pinned archives.
It then imports the reconstructed generators, generates adapters from the Link
target model and compiles the real Rust companion executable. Original runtime
source files are not copied into that build. The shared proof fixtures are
independent test inputs, while generic external language packages remain declared
providers.

The witness compares the independent model interpreter, generated JavaScript
entry points and compiled Rust executable across every shared proof case. It
compares complete receipt bytes, including the request, result, trace, program,
schema, verdict and step count; it also compares each receipt with the existing
actual proof API. It exchanges receipts between ports, independently replays
them under the caller's context and goal, checks a forged verdict and distinguishes
resource exhaustion from proof rejection. Parser observations cross the same
byte-frame boundary.

Two model replacements use unchanged generators and toolchains. A big-endian,
differently aligned layout with reordered fields and a different text tag changes
the actual wire bytes while preserving the decoded receipt. Replacing the
executable verdict projection changes an accepted proof's exposed verdict in both
compiled ports. Separately, replacing the real parser's nesting-limit source AST
changes the parse observation through the unchanged ABI. The witness records
distinct native artifact hashes and checks that generic generator sources did
not change.

This supplies a concrete RML target/ABI model and an observation preservation
witness. It is not a universal compiler-correctness proof, a model of physical
instruction execution, or coverage of every possible RML API and workload.
Whole-repository status must separately account for current source inventories,
the ordinary build/package integration and the remaining original requirements.

## Reproduce

Generate the two adapters explicitly before capturing an edited model:

```sh
node scripts/generate-linked-target.mjs --generate
node scripts/generate-linked-runtime.mjs --capture
node scripts/generate-linked-rust-runtime.mjs --capture GENERIC_RUST_SYNTAX_HELPER
node scripts/linked-implementation-configuration.mjs --capture
node scripts/generate-linked-target.mjs --check GENERIC_RUST_SYNTAX_HELPER
node scripts/check-linked-implementation.mjs
node scripts/run-with-cache.mjs -- node --test scripts/linked-target-abi.test.mjs
node scripts/run-with-cache.mjs --cache .rml-cache/target-abi -- node scripts/verify-linked-target.mjs GENERIC_RUST_SYNTAX_HELPER .rml-cache/target-abi
```

Capture and adapter generation are never performed implicitly by a check. A stale
generated adapter or archive must fail rather than silently changing the declared
authority. Final native validation and exact scope are recorded separately in the
delivery evidence; these commands are not, by themselves, a claim that a run passed.
