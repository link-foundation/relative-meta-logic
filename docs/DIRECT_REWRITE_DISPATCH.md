# Direct rewrite dispatch and substitution ownership

The generic direct-structural evaluator builds a rule index once per reduction,
after it resolves imports and rebindings. Fixed string heads select compatible
rule buckets; every variable, leaf, empty, or nested-head pattern remains in an
ordered fallback list. Matching and fallback indices merge lazily in original
rule order. Each rule index is stored once, with constant additional merge state
per active traversal. An index is never cached on the mutable public registry.

Leaf terms, empty arrays, and terms with nested heads still try every rule.
Both ports distinguish leaves from lists, including singleton, nested, and
empty lists. JavaScript retains string coercion between two scalar leaves.
The conservative dispatch boundary stays the same in both ports.

A skipped rule has a different fixed string head. It can only fail while
observing `compare-link-structure`. Each omitted contiguous run is observed at
its original priority position, before later binding or a successful match.
This preserves the complete set-valued public semantic report and the first
failure caused by a disabled operation. The disabled-operation set is private
and copied on construction. Ordered public matcher callbacks remain unchanged.
An occurrence counter, mutable disabled-operation set, or new private callback
would require reviewing this compression before changing those contracts.

The private direct matcher borrows candidate subtrees during synchronous
execution. Full-trace reduction clones every replacement occurrence, so
complete before/after trace snapshots remain independently owned. The exported
JavaScript `directMatchTerm` still returns detached substitutions. The Rust
inference path retains its owned matcher.

JavaScript's bounded `reduceResult` direct backend instead keeps a private
immutable term graph during each call. Substitution may reuse a captured
subtree, and rebuilding a rewritten ancestor copies only that ancestor's array.
Each logical rewrite still happens in its original root-first order, including
separate rewrites of multiple occurrences that temporarily share a subtree.
The final term is recursively cloned, giving the caller independent owned
copies of all occurrences without aliases to inputs, rules, or earlier results.

A per-call `WeakSet` remembers array subtrees, and a `Set` remembers string
leaves, only after the ordered matcher and traversal find no rewrite anywhere
in them. This avoids scanning the same immutable normal subtree repeatedly.
Every first visit executes all guards and
records the existing operation/path sets before caching. Effective rules and
rebindings are detached snapshots for that call; neither the term graph nor
the normal-subtree cache survives a reduction or a changed program/import.

Equality may skip identical private immutable subtrees, while distinct arrays
retain structural comparison. Leaves remain distinct from lists, and two
scalar leaves retain string coercion. A stall is checked at the rewritten subtree: its
unchanged array ancestors preserve exactly the same equality result. This
avoids rescanning untouched siblings and still reports the selected rule's
immediate stall failure. The API continues requiring an explicit positive
safe-integer step bound and a normal-form probe before the bound. Cycles spend
that fuel rather than retaining a visited-term history. Full `reduce` traces
and cycle detection, S/K reduction, and Horn reduction remain unchanged.

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
node --test scripts/linked-result-sharing.test.mjs js/tests/linked-reduction-result.test.mjs
node scripts/run-with-cache.mjs -- cargo test --manifest-path rust/Cargo.toml --lib dispatch_contract_tests
```

The JavaScript oracle is a test-only snapshot of the runtime at commit
`53242b60d0ebddf653255ad99787fe586aa1a018`, before this optimization. Only its
relative dependency imports change. It lives under `js/tests/fixtures`, outside
the npm package's published source files. The Rust oracle is the original owned
matcher and ordered reducer in a private `#[cfg(test)]` module. Neither oracle
adds a production API.

The JavaScript snapshot imports the production structural comparator, so it
checks dispatch equivalence under the current comparator contract. It is not an
independent equality oracle. The structural-equality tests assert explicit
expected results from shared fixtures in JavaScript and Rust and compare the
direct and closed S/K paths.

Tests compare normal forms, every complete trace entry, and complete semantic
reports for the frozen 37-case typed-recursion workload in
`test-corpus/linked-dispatch`. Its provenance records the independent pure case
constructor and source-module hashes; it does not depend on a source-language
archive or add a production formal-language surface. Adversarial tests cover first-error
priority, invalid or exhausted fuel, repeated variables, wildcard priority,
rebinding, public registry mutation between reductions, callback order, and
independent ownership of input, result, and trace trees. JavaScript also covers
historical stringification counterexamples and shared input subtrees. The shared
`test-corpus/structural-equality` cases check shape distinctions, repeated
variables, raw foundation matching, and public proof-context identity in both
ports and execution bases.

Public `keyOf` / `key_of` formatting remains unchanged. The linked reducer's
cycle detector and direct/Horn fact indexes use private structural keys, so
parentheses, spaces, and empty atoms cannot conflate distinct terms or produce
false proofs. Rust keeps display-key order as the primary sort key, preserving
fact traversal order when there is no collision. Public quoted proof inputs
retain their existing injective codec.

Set `RML_DISPATCH_JS_REPORT` or `RML_DISPATCH_RUST_REPORT` to an existing-parent
output path to record per-case timings and equality outcomes during the focused
corpus tests. These are sequential original/optimized timing pairs, not repeated
controlled benchmarks; timings are evidence for that run only. Without these
variables, the tests create no timing report files.
