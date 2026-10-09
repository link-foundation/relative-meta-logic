# Typed structural recursion through linked rules

`formal-recursion.lino` defines typed natural-number and list eliminators as ordinary linked rewrites. Motives, base cases, step binders, induction hypotheses, captured variables, and dependent result indices are checked by the same generic formal-semantics interpreter. No host function or source declaration name selects a recursion result.

`formal-collections.lino` adds typed list ascription, pair projection, addition, append, conditionals, and natural/list cases. Both branches are checked even when the concrete input selects only one branch. `formal-definition-context.lino` forms closed definitions against temporary neutral values, then returns the actual original body with its real context; hypothetical values cannot escape as executable globals.

The source-independent corpus has 37 recursion obligations with independently constructed expected values. Negative cases change motive domains, binder order, base/step types, dependent vector indices, induction hypotheses, and missing or mistyped dependencies. Separate collection and definition-context tests exercise malformed branches and context escape. These generic contracts do not establish complete elaboration or execution of every upstream declaration.

Run the JavaScript contracts from the repository root:

```sh
node scripts/run-with-cache.mjs -- node --test --test-concurrency=1 js/tests/formal-collections.test.mjs js/tests/formal-definition-context.test.mjs js/tests/formal-recursion.test.mjs
```

Run the same 37 recursion obligations in Rust:

```sh
node scripts/run-with-cache.mjs -- cargo test --manifest-path rust/Cargo.toml --locked --test formal_recursion_tests -- --test-threads=1
```

The fixture generator only constructs generic terms and expected normal forms. It does not invoke a native prover or obtain expected values from the reducer under test:

```sh
node scripts/generate-formal-recursion.mjs
```
