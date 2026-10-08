# Direct rewrite dispatch and substitution ownership

The generic direct-structural evaluator builds a rule index once per reduction,
after it resolves imports and rebindings. Fixed string heads select compatible
rule buckets; every variable, leaf, empty, or nested-head pattern remains in an
ordered fallback list. Matching and fallback indices merge lazily in original
rule order. Each rule index is stored once, with constant additional merge state
per active traversal. An index is never cached on the mutable public registry.

Leaf terms, empty arrays, and terms with nested heads still try every rule. This
conservative domain preserves JavaScript's existing leaf/array stringification
equality, including singleton and comma-containing nested heads. Rust keeps the
same dispatch boundary even though its node equality is strictly structural.

A skipped rule has a different fixed string head. It can only fail while
observing `compare-link-structure`. Each omitted contiguous run is observed at
its original priority position, before later binding or a successful match.
This preserves the complete set-valued public semantic report and the first
failure caused by a disabled operation. The disabled-operation set is private
and copied on construction. Ordered public matcher callbacks remain unchanged.
An occurrence counter, mutable disabled-operation set, or new private callback
would require reviewing this compression before changing those contracts.

The private direct matcher borrows candidate subtrees only during the
synchronous rewrite. Instantiation still clones every replacement occurrence,
so returned normal forms and complete before/after trace snapshots remain
independently owned. The exported JavaScript `directMatchTerm` still returns
detached substitutions. The Rust inference path retains its owned matcher.

The change preserves root-first traversal, rule priority, source rebinding,
normal forms, logical step counts, complete traces, stall/cycle/step-limit
classification, and existing S/K and Horn execution paths. It adds no new
source-language forms or source-authority claim. The supported term domain is
the existing acyclic string/array domain; mutation through hostile getters or
monkey-patched builtins during a synchronous reduction is not newly supported.

## Regression evidence

The ordinary test commands discover the dispatch regressions automatically:

```sh
npm --prefix js test
node scripts/run-with-cache.mjs -- cargo test --manifest-path rust/Cargo.toml --all-targets
```

Focused checks:

```sh
node scripts/run-with-cache.mjs -- node --test --test-concurrency=1 scripts/linked-dispatch-*.test.mjs
node scripts/run-with-cache.mjs -- cargo test --manifest-path rust/Cargo.toml --lib dispatch_contract_tests
```

The JavaScript oracle is a test-only snapshot of the runtime at commit
`53242b60d0ebddf653255ad99787fe586aa1a018`, before this optimization. Only its
relative dependency imports change. It lives under `js/tests/fixtures`, outside
the npm package's published source files. The Rust oracle is the original owned
matcher and ordered reducer in a private `#[cfg(test)]` module. Neither oracle
adds a production API.

Tests compare normal forms, every complete trace entry, and complete semantic
reports for the frozen 37-case typed-recursion workload in
`test-corpus/linked-dispatch`. Its provenance records the independent pure case
constructor and source-module hashes; it does not depend on a source-language
archive or add a production formal-language surface. Adversarial tests cover first-error
priority, invalid or exhausted fuel, repeated variables, wildcard priority,
rebinding, public registry mutation between reductions, callback order, and
independent ownership of input, result, and trace trees. JavaScript also covers
its historical stringification cases and shared input subtrees.

Set `RML_DISPATCH_JS_REPORT` or `RML_DISPATCH_RUST_REPORT` to an existing-parent
output path to record per-case timings and equality outcomes during the focused
corpus tests. These are sequential original/optimized timing pairs, not repeated
controlled benchmarks; timings are evidence for that run only. Without these
variables, the tests create no timing report files.
