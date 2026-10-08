# Typed control-flow semantics

The control-flow APIs add a genuine semantic layer between owned language syntax
and native target generation. The same structured RML program resolves project
identities, checks scalar types and definite assignment, closes transitive output
effects, and executes in JavaScript and Rust. Its instructions, calls, mutable
registers, branches, loops and recursive functions remain available after the
original source is discarded. Changing an instruction in the Links network
changes the result on the unchanged runtime.

This is a reusable compiler/interpreter layer, not completion of the full-language
requirements R11/R66/R101–R109. In particular, the existing portable-natural
fragment remains a separate, bounded implementation with its original contract.
Neither implementation is relabelled full language support.

## Public APIs and distinct stages

- `js/src/rml-control-flow.mjs`: `validateControlFlow`, `executeControlFlow`,
  `controlFlowToRml`, `controlFlowToNetwork`, `controlFlowFromNetwork`.
- `rust/control-flow` public companion crate (`rml_control_flow`), implementing
  `rust/control-flow/src/control_flow.rs`: `ControlFlowProgram::new`, `execute`,
  `execute_entry`, `to_rml`, `to_network`, `from_network`, `value`, `effects`.
- `js/src/rml-control-flow-javascript.mjs`: `lowerJavaScriptControlFlow` consumes
  an owned Babel AST and explicit parameter/result/effect contracts.
- `js/src/rml-control-flow-rust.mjs`: `lowerRustControlFlow` consumes the shared
  Syn owned-AST shape, preserving Rust lexical shadowing, immutable bindings and
  the once-only evaluation of integer range bounds.
- `js/src/rml-control-flow-codegen.mjs`: `emitControlFlow` emits standalone
  JavaScript, Rust, Lean and Rocq encodings from the checked structured program.
- `scripts/control-flow/elaborate-source.mjs`: `elaborateControlFlowSource`
  is a repository-only source-ingress tool. It checks source with the official pinned meta-language grammar and preserves its
  upstream representation, then reuses the shared Babel/Syn owned-AST capture.
  Source preservation, parsing, resolution, elaboration, execution and proof
  verification are reported separately. Native syntax capture is not a proof.

The registered RML syntax extension supplies the Links network. Each function,
parameter, register, instruction, effect, module import, block and terminator is
its own structured form. No JSON/source string is the executable program. The
network is decoded and validated before execution or code generation; the
existing retained source plane is not read for that operation.

The public `rml_control_flow` companion crate builds independently. Its
`rml-control-flow` CLI accepts a JSON object with `program`, `arguments` and
`fuel` fields and writes the checked outcome. Its target directory is registered
by the cache wrapper. Source-free verification rebuilds and tests this crate
alongside the main runtime and other companions.

The JavaScript installed source modules consume owned AST data and do not import
Babel, Syn tools or repository scripts. Source parsing in the repository-only
ingress/generation scripts requires the separately installed shared syntax
capture providers; availability of a transitive development Babel parser does
not establish an installed-package source-parser API. The shared Syn helper
executable must be supplied explicitly. Packaging those source ingress providers
remains open.

The two host runtimes consume the same positive and negative semantic fixtures.
They reconstruct the same canonical RML forms and produce the same values,
ordered output events, consumed instruction count and failure classification.
Source AST lowering and target code generation currently have JavaScript public
implementations; native Rust ports of those two stages remain open. Rust already
has its own independent validator, linked-form reader and execution machine.

## Machine contract

Values are signed integers from -9,007,199,254,740,991 through
9,007,199,254,740,991, booleans, or unit. Arithmetic is checked after every operation.
Division truncates toward zero and remainder follows the dividend sign. Integer
overflow and division by zero produce `domain-error` with an explicit diagnostic.
The JavaScript source frontend deliberately refuses `/`, coercions, fractions,
negative zero, and `null`: these differ from the checked scalar machine or from
unit/undefined. The JavaScript source contract also excludes negative-zero
intermediates (for example, zero multiplied by a negative input); that precondition
is not proved by the compiler. The integer machine has no signed-zero value.
It accepts only operations whose scalar contracts have been
established. The Rust frontend currently accepts the listed scalar `i64` operations
subject to the stricter shared safe-integer precondition.

Each function owns typed registers and blocks. Register identities do not depend
on user identifier spelling. The validator rejects duplicate identities, wrong
argument/result types, unresolved/private imports, cross-module calls without an
explicit import, unknown instructions and unreachable blocks. A fixed-point
must-analysis intersects the initialized registers along every predecessor;
loops cannot manufacture an initialized value. A separate fixed point propagates
actual output effects along every call edge, including mutually recursive calls.
An undeclared direct or transitive effect is rejected.

Execution uses an explicit call stack rather than host recursion. One instruction
or terminator consumes one unit of fuel; a call is an instruction, and returning
is a terminator. All targets preserve that exact accounting. Fuel exhaustion
reports `fuel-exhausted`. It proves neither divergence nor logical falsity.
Evaluation observes the chosen entry's result and ordered scalar output events.
Timing, memory limits and OS failure are not source-language observations here.

All supported values are Copy. The Rust frontend preserves immutable parameter,
local and range-iteration bindings and rejects their assignment. JavaScript
lexical scopes, temporal dead zones, operand evaluation order, short-circuit
behavior and assignment-expression values are handled explicitly. Unsupported
syntax leaves the caller's owned AST intact and returns a precise error with no
translated program.

Module contexts are explicit closed projects containing function declarations and
named imports/exports. Top-level effects, arbitrary module loaders, package
resolution and runtime module initialization are unsupported. Functions may call
across declared project imports and recur. The linker does not infer dependency
identity from a same-spelled name.

## Native target encodings and proof boundary

Generated JavaScript and Rust have their own scalar machine and no RML runtime
dependency. Generated Lean and Rocq express the same transition machine as total,
fuel-recursive functions. Effects are represented as returned event lists, not
silently erased or performed as ambient IO. All four outputs execute the exact
linked program, including recursive calls and loops. They do not merely embed
the original source or change its language label.

The proof-language targets establish finite execution observations using native
validation oracles. They do not manufacture a termination proof, transport an
arbitrary source theorem, discharge universes, or turn an exhausted computation
into a proof. No `sorry`, axiom, unchecked admission or source theorem is added.
The complete theorem/assumption/proof requirements R47/R121–R123 remain separate.

Preservation is relative to the declared scalar contracts: argument/result types,
checked numeric domain, lexical/call identities, branch selection, chosen-entry
results, ordered output events and fuel-relative outcomes. Console formatting,
IO errors and filesystem/network behavior require additional contracts. The source
JavaScript/Rust oracles compare values and scalar output events only for examples
inside that contract; overflow and bounded nontermination fixtures check the
explicit machine outcomes, not equivalence to an arbitrary native run.

## Reproduction

Run ordinary shared semantic and source-lowering tests:

```sh
node scripts/run-with-cache.mjs -- node --test \
  js/tests/control-flow.test.mjs js/tests/control-flow-source.test.mjs
node scripts/run-with-cache.mjs --cache rust/control-flow/target --class rust -- \
  cargo test --manifest-path rust/control-flow/Cargo.toml
```

Generate fixtures with the existing syntax-capture infrastructure:

```sh
node scripts/control-flow/build-fixtures.mjs
RML_RUST_AST_HELPER=/path/to/rml-rust-syntax \
  node scripts/control-flow/build-rust-fixtures.mjs
```

With the official toolchains on PATH, verify every native target and original
in-domain source. `RUSTC`, `LEAN` and `ROCQ` can select installed binaries:

```sh
node scripts/run-with-cache.mjs --cache .rml-cache/control-flow-native \
  --class acceptance -- node scripts/control-flow/verify-native.mjs \
  test-corpus/control-flow/native-results.json
```

No missing oracle is silently skipped. The receipt records the actual matrix;
ordinary unit tests do not pretend to have run this native check. Deliberately
false Lean/Rocq observations must fail, independently of positive compilation.

## Exact remaining scope

The layer does not claim general JavaScript, Rust, Lean or Rocq semantics. Open
constructs include heap objects and aliasing, closures and higher-order calls,
exceptions, asynchronous/generator behavior, dynamic coercions, floating point,
full modules/package environments, non-Copy ownership and borrowing, destructors,
traits/generics/macros, type classes, universes, dependent values, proof terms,
tactics, source termination/elaboration, and standard-library/environment
contracts. Lean/Rocq source elaborators are not provided by this control-flow
layer. Full twelve-direction language translation and full semantic target
re-import remain open, even though all four generated execution encodings are
natively tested. The list identifies outstanding work; it does not narrow the
original obligations.

The validator, elaborators, interpreter, target-runtime semantics and code
emission are explicit host laws. Their implementation can be captured in the
separate owned Links implementation archive, but this layer alone does not prove
minimality, eliminate the compiler/toolchain boundary, or establish whole-product
self-hosting. Native toolchains validate target artifacts; they do not decide
RML theorem authority.

The Syn 3 ingress accepts only empty function/local modifier records and default
function safety. Explicit safety, nonempty modifiers, async, const, generics,
extern ABIs and crate frontmatter remain explicit unsupported obligations.
Negative source fixtures and structural mutations verify these fields are never
silently erased during scalar elaboration.
