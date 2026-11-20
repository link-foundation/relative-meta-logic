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

## An unseen logic as data

`test-corpus/foundation-packages/unseen-modal-frames-{1,2,3}.lino` define a
modal accessibility logic in three package versions; the shared expectations
are in `unseen-modal-frames.json`. Version 1 reads accessibility as given and
is inductive. Version 2 adds a transitive frame condition in its own program.
Version 3 keeps version 1's rules but declares `path-step` as a guard of a
guarded-coinductive policy. Versions 2 and 3 import version 1's rule programs
and the unchanged `lab-frame` theory by explicit aliases, so the same theory
object runs under all three foundations.

Through the public package API the same theory yields `unknown`/`proved`/
`unknown` for a two-step diamond (only the transitive frame derives it) and
`unknown`/`unknown`/`proved` for an infinite dry path (only the declared guard
closes the cycle). Queries also reach `refuted`, `contradictory`,
`assumption-dependent`, `exhausted` and `unsupported`; executions reach
`computed`, `unsupported` (a rewrite cycle) and `exhausted`. `describe` returns
the roles, signature, cycle policy and every rule, and now also `ruleForms`
(Rust `rule_forms`): the declared linked form of each rule, so a caller can
inspect the logic's content, not only its rule names. `replay(answer)` replays
an answer's visible evidence; answers from another package workspace are
refused. Undeclared and unknown cycle policies, and guards outside an
inference/typing role, are rejected at load time rather than defaulting to
induction.

No constructor, rule, program, world or alias name of that logic occurs in
`js/src` or `rust/src`. The JavaScript and Rust guard tests scan every source
file for those names and check that each identifier-like string literal of the
four foundation modules is listed in the reviewed
`test-corpus/foundation-packages/host-vocabulary.json` (schema words, statuses,
reasons and roles). A new literal dispatch key therefore fails both suites
until it is reviewed, and the vocabulary must not contain a fixture name. The
JavaScript foundation modules must not contain `switch` or string `case` arms.
This guards against host branches for this logic; it does not prove that the
host schema itself (roles, two cycle-policy mechanisms, signature and
refutation conventions) is free of semantic choices.

## Verification

Both test suites load the same two independent source fixtures in
`test-corpus/foundation-packages/`:

```sh
node --test js/tests/foundation-packages.test.mjs js/tests/foundation-unseen-logic.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test foundation_packages_tests --test foundation_unseen_logic_tests   # hosted CI only
```

Positive tests cover concurrent same-name/version-separated behavior, explicitly
pinned dependencies, aliased cross-version comparison, selected-instance
assumption changes, rule mutation and closed-S/K execution. Negative tests cover
missing/ambiguous context, collision, malformed policy and foreign evidence.
