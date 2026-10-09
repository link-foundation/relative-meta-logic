# RML relational foundation package

This companion crate exposes `horn_resolution` and `relational_kernel` while
reusing the existing RML crate's public Node, parser and linked-program types.
It requires no additional exports or semantic changes in that crate.

From the repository root:

```sh
node scripts/run-with-cache.mjs --cache rust/relational-kernel/target --class rust -- cargo test --manifest-path rust/relational-kernel/Cargo.toml --all-targets --locked -j 2 -- --test-threads=1
```

All native tests run, including the full quoted six-capability cohort,
productive-rule scheduling, source replacement, malformed-output rejection,
and independent cross-runtime certificate replay. The explicit cache option
registers this package's target directory with the repository-owned lifecycle.

See `docs/case-studies/issue-183/relational-source-kernel.md` for the complete
trust boundary and the remaining preservation, minimality and closure gaps.
