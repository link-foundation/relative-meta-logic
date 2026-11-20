# Indexed and record foundation extension

This source-bound extension adds the remaining 24 NetworkDefinitions declaration
bodies to the [conversion fragment](FORMAL_SEMANTICS.md). All 42 declarations in
the Lean/Rocq NetworkDefinitions modules now have linked type/body checks.
Across the preserved corpus, the total is 62 definitions and two conversion
proofs. Four original Lean admissions remain explicit; 161 other declarations
still need implementation. Full-corpus verification remains false.

The generated Lean AnyNetwork Repr/BEq instances are separately recorded as
pending. Checking the underlying record and functions does not claim that those
generated instances or the 197 top-level commands have been executed. Remaining
declaration obligations and generated-trait statuses are listed in the standalone
[coverage artifact](../test-corpus/formal-foundation/coverage.json).

## Native linked mechanisms

formal-indexed.lino defines dependent Pi formation, lexical type closures,
dependent application and Nat-indexed vectors. Both an ordinary argument and
the instantiated result type must check. Vector repetition checks the actual
length against the expected index. A symbolic length remains symbolic, so
checking a function for arbitrary n does not substitute a convenient example.

formal-records.lino defines generic nominal records, exact field arity and type
checking, duplicate-field rejection, concrete and neutral projection, Bool,
Nat equality, list length and all. Unknown naturals are never considered unequal
merely because their neutral names differ. Inferred lambda domains come from an
independently obtained expected function type. Contextual list checking handles
empty nested lists and anonymous records.

The source parser reads the actual Vector.replicate/Vector.const bodies and
record fields, constructors and projections. Those names are source syntax;
they select generic AST constructors rather than host operation callbacks.
The combined linked program rechecks every earlier declaration before adding
the new ones to the environment. No cached success, native-prover status or
admission grants authority.

## Evidence and replay

- [Coverage](../test-corpus/formal-foundation/coverage.json) records all 229 declarations and outstanding generated traits.
- [90 shared requests](../test-corpus/formal-foundation/cases.json) include all 62 definition obligations in dependency order, retained proofs, concrete calls and rejected mutations.
- Rust checks each global environment entry against an earlier linked-checker result before it replays a dependent request.
- 65 generic assertions independently exercise Pi/vector and record/list primitives, including symbolic values and malformed terms.
- Source mutation tests authorize a fresh fingerprint first, then test changed vector lengths, binder types, result indices, dependencies and record fields. Valid changes to an example's data change its observed predicate result.

Receipts are detached, bounded and tied to the authoritative source plus complete
linked program. Replay re-elaborates/rechecks from those sources, ignores claimed
executable requests, and requires an exact receipt match. Rust currently shares
the JavaScript source producer and independently executes its complete linked
obligations; an independent Rust Lean/Rocq elaborator is still open.

## Reproduce

Use the repository's cache wrappers:

    node scripts/run-with-cache.mjs -- node scripts/generate-formal-foundation.mjs --check
    node scripts/run-with-cache.mjs -- node --test js/tests/formal-foundation*.test.mjs scripts/formal-foundation.test.mjs
    node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test formal_foundation_tests

Remaining foundational work includes structural recursors, case refinements,
implicit argument elaboration, generated traits, proposition/induction proof
rules, and a compact natural representation for the larger literals in upstream
commands. The current bounded unary literal/receipt codec must not be relabeled
as having executed those larger command inputs.
