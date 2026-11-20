# Source-bound native RML semantic fragment

This implementation adds actual linked typing, execution and conversion-proof
checking to the preserved upstream formal corpus. It is deliberately incomplete:
38 of 229 declarations are checked definitions, two are replayed conversion
proofs, four retain upstream admissions, and 185 are unresolved or unsupported.
It does not complete issue 183 requirements R121, R122 or R123.

Generated [coverage](../test-corpus/formal-semantics/coverage.json) lists every
declaration, its status and the reason an unresolved declaration is not accepted.
The [shared cases](../test-corpus/formal-semantics/cases.json) are reproduced from
the current source and kernel by scripts/generate-formal-semantics.mjs.

## What runs

lib/meta-theory/formal-semantics.lino is an ordinary linked program. Its rules
define:

- Nat, lists, products and non-dependent function types
- Type formation and contextual checking, including the element type of an empty list
- De Bruijn variable lookup, lexical closures and typed application
- Source-defined aliases and definition lookup through checked global entries
- Fresh typed variables for universal introduction
- Equality proof checking by typed conversion of both sides

The JavaScript adapter parses the actual signature, body and proof token ranges
from FormalCorpus. It resolves every global reference against the declaration's
language-qualified dependency addresses. Missing, substituted and unused extra
dependency entries are rejected in this fragment. It constructs syntax data;
declaration names never select host-language implementations. The linked reducer
performs the type and equality checks before a definition enters the environment.

Both language versions of MetaDefinitions.meta_network_is_duplet_network are
checked for every value of the declared network type, by introducing a fresh
typed neutral variable and normalizing the actual MetaNetworkToDupletList body.
This is not a finite collection of example calls. The example network and
SingletonSet additionally execute using their source bodies.

The proof producer recognizes explicit introductions and reflexivity. Rocq
unfold directives resolve their referenced definitions and act as conversion
hints; the checker transparently unfolds checked definitions. It independently
checks the resulting conversion proof, not whether the original native tactic
engine would execute every tactic successfully. No Lean/Rocq process, native
proof-success bit, theorem-name whitelist or admission grants proof authority.

## Trust boundary

The caller supplies the authoritative corpus foundation and linked semantic
program. FormalCorpus checks the original 229-declaration token contract before
semantic work begins. These hashes bind a receipt to that source and kernel;
they do not themselves prove a theorem.

The source adapter is part of the current elaboration boundary. It supports
explicit non-shadowing binders and separate Lean/Rocq builtin syntax. It rejects
implicit binders, anonymous holes, unsupported expressions and unsupported proof
steps. It is not a scope-complete Lean/Rocq parser or elaborator. In particular,
indexed vectors, dependent products, generated constructors/recursors, structural
recursion, datatype induction, propositions beyond quantified conversion goals,
sorting proofs, arithmetic proof obligations, and top-level command execution
remain open. This adapter does not execute non-declaration commands.

The default evaluator is the explicit direct-structural linked-program backend.
This work does not claim a new minimal trusted kernel or complete S/K closure.
The reusable linked rules run unchanged in JavaScript and Rust. Rust independently
checks all 38 definition obligations before replaying dependent proofs and calls,
and checks each imported environment entry against an earlier linked-checker
result. The source-bound requests are emitted by the JavaScript elaborator;
Rust does not yet have its own Lean/Rocq source elaborator.

Upstream's source label verified only means that its proof text lacks an
admission marker. This adapter never promotes that label to semantic success.
It preserves the four admitted Lean proofs as upstream-admitted and does not
install their propositions as axioms. 

## Receipts and failures

Evaluation and proof receipts contain the source fingerprint, linked-kernel hash,
address, elaborated dependencies, input, complete request, result and rewrite
trace. Receipts are detached from all private cached data. Altering one cannot
modify a future definition lookup or theorem goal.

Fresh-runtime replay reconstructs the request from the authoritative source and
receipt input. It does not execute the supplied request or accept supplied
premises. Its accepted field is true only when independent execution succeeds
and every receipt field matches. executionAccepted separately records the new
execution verdict for diagnostics.

Unsupported or unresolved does not mean mathematically false. A stuck reduction,
an unsupported source form and a resource error do not produce a proof. The
adapter accepts only the kernel's exact success constructors. Evaluation inputs
are restricted to data constructors, at most 32 arguments, depth 128 and 20,000
aggregate unfolded nodes. Receipt production and replay both enforce depth 512,
2,000,000 unfolded nodes and 64 MiB of UTF-8 text. Cyclic data and executable
payloads are rejected. Reduction has a caller-selected positive step budget.

## Verification

Run repository cache wrappers for all checks:

    node scripts/run-with-cache.mjs -- node --test js/tests/formal-semantics.test.mjs scripts/formal-semantics.test.mjs
    node scripts/run-with-cache.mjs -- node scripts/generate-formal-semantics.mjs --check
    node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test formal_semantics_tests

The JavaScript tests regenerate an independently authorized mutated source
contract before testing changed bodies, binders, premises, conclusions and
dependencies. Therefore the rejection must come from the semantic path, not only
from detecting the old pinned hash. Other tests cover caller mutation of receipt
internals, wrong argument types, injected execution terms, missing/extra proof
introductions, cross-language syntax, cyclic data, and replacing a linked proof
rule. The 56 shared Rust requests cover all 38 definition checks, both source
proofs, concrete evaluations, wrong domains, and binder/premise/conclusion/
dependency mutations. Forged global authority is rejected before dependent use.
