# Shared foundation workspace corpus

These are linked-workspace inputs, not legacy evaluator programs. Both public
runtime test suites load the same `.lino` source and `expected.json` values:

- `js/tests/foundation-context.test.mjs` and
  `rust/tests/foundation_context_tests.rs`
- `js/tests/confidence-context.test.mjs` and
  `rust/tests/confidence_context_tests.rs`

`foundation-context.lino` defines concurrent inductive and guarded versions of
a signed feedback logic, including both-sided cycles, finite evidence and an
unguarded negative case. `confidence-context.lino` supplies a theory for the
linked confidence packages in `lib/foundations/confidence.lino`; observations
and independence assumptions are supplied by the tests per query.

See `docs/FOUNDATION_WORKSPACE.md` for public API contracts and the bounded
execution/performance limitations.
