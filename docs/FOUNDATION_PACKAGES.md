# Independent linked foundation packages

`FoundationPackages` in `js/src/rml-foundation-packages.mjs` and
`rml::foundation_packages::FoundationPackages` loads independent source packages
without requiring their authors to choose globally unique program, rule or
instance names. Existing `FoundationWorkspace` constructors remain unchanged.

Each manifest supplies its actual `name`, `version`, `source` and explicit
`imports`. Its source must contain exactly one matching `linked-foundation`;
local linked programs and instances belong to that source package. Multiple
versions can therefore each define `rules`, rule `step`, `theory`, `proof` and
instance `study` without overwriting or capturing one another.

JavaScript:

```js
const loaded = FoundationPackages.fromPackages([
  { name: 'sample-logic', version: '1', source: firstSource },
  { name: 'sample-logic', version: '2', source: secondSource },
]);
const answer = loaded.ask(
  { name: 'sample-logic', version: '1', instance: 'study' },
  ['accepted', 'rules'],
  { assumptions: [] },
);
console.log(answer.result.status, answer.result.foundation);
```

`loadPackages` is a synonymous constructor. Rust provides `from_packages`,
`load_packages`, and `from_packages_with_basis`, using `LinkedFoundationPackage`,
`PackageImport` and `PackageSelection` structs. Both defaults use closed S/K;
the direct-structural basis remains explicitly selectable. Query/execution
bounds and assumptions are passed through to the underlying public workspace.

## Imports and scope

An import such as
`{name: 'sample-logic', version: '1', program: 'rules', alias: 'old'}` explicitly
makes that program available locally as `old`. A second version may be imported
under a different alias. The local source then writes `(uses old)`, or uses the
alias in a foundation role. A program can deliberately import both versions;
its combined consequences retain both origins.

A foundation-only import omits `program` and `alias`. A source-level
`(depends-on sample-logic (version 1))` must match a manifest import. External
foundation references must specify their version. Missing packages, missing
programs, duplicate package identities, alias/local collisions, repeated
aliases, undeclared program references and mismatched foundation declarations
are errors. There is no implicit search by local program name.

Only structural declaration/reference positions are qualified: program
identifiers, `uses`, role references, guard references and instance theories.
Object-language terms, rewrite patterns, rule premises/conclusions, rebinding
symbols, queries and assumptions are unchanged. The word `rules` in the example
query remains exactly that word even though the program also happens to be
named `rules`.

## Results, provenance and revision

The answer wrapper contains the selected `package`, the ordinary workspace
`result`, the original `theoryPackage` (Rust `theory_package`) and a `programs`
origin table. `result.instance` and `result.theory.name` use the source names;
`result.foundation`, assumptions, status and proof content keep their ordinary
meaning. Internal qualified program addresses in proofs, policy guards and
rewrite traces resolve through the origin table to the original package name,
version and program name. These addresses are transport identities; callers
select packages and instances by their own declared names.

`revise` receives the source package/instance selection as well as the change.
Rule mutations require a local program name in that source package and
invalidate results in any dependent closure. An assumption mutation affects
only answers from the selected instance, leaving another version's assumptions
untouched. JavaScript also accepts a package-only selection to replace the
assumption across that package's instances. Revisions require query answers
returned by the same package workspace, rather than accepting foreign or
untracked evidence. Result snapshots are independent of caller mutations.

These APIs load in-memory source manifests. They do not download packages,
create a signed distribution registry or claim universal soundness. Existing
foundation-dependency validation still rejects a single inheritance closure
that implicitly mixes two versions of the same named foundation. Explicit
program aliases support deliberate comparison of different versions without
that ambiguity.

## Verification

Both test suites load the same two independent source fixtures in
`test-corpus/foundation-packages/`:

```sh
node --test js/tests/foundation-packages.test.mjs
cargo test --manifest-path rust/Cargo.toml --test foundation_packages_tests
```

Positive tests cover concurrent same-name/version-separated behavior, explicitly
pinned dependencies, aliased cross-version comparison, selected-instance
assumption changes, rule mutation and closed-S/K execution. Negative tests cover
missing/ambiguous context, collision, malformed policy and foreign evidence.
