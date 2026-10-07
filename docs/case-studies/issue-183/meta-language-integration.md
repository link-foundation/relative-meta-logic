# Published meta-language integration audit

Audit date: 2026-10-07. This is an intermediate implementation, not completion
of R101–R109 or of the four-language translation requirement.

## Published artifacts and upstream closure

[Upstream issue 195](https://github.com/link-foundation/meta-language/issues/195)
was closed as completed on 2026-10-06 at 21:17:21 UTC. Its closure must not be
reported as an open issue. However, the following public-package checks on
2026-10-07 still returned:

- `npm view meta-language dist-tags versions --json`:
  `latest: 0.46.0`, with `0.46.0` the only published version.
- `https://index.crates.io/me/ta/meta-language`: last version `0.58.2`, not yanked.
- Upstream main's `js/package.json` and `rust/Cargo.toml`: version `0.58.2`;
  the source has considerably newer infrastructure than the npm artifact.

RML therefore retains npm `^0.46.0` and crate `0.58.2`. Installing a nonexistent
npm version or relabelling the already-published Rust version would not consume
the implementation that closed issue 195. Upstream source is evidence for work
available to inspect, not evidence that it shipped in either consumed artifact.
A future integration must identify actual publication contents and test them.

The only new direct Rust dependency is `regex 1.13.1`, already present in the
lockfile transitively, for ECMAScript Unicode identifier validation. The existing
`serde_json 1.0.151` moves from test-only to runtime for interoperable snapshots.

## RML structure schema 1

`js/src/rml-meta-structure.mjs` and `rust/src/meta_language_structure.rs` register
`rml:structure:1` using upstream `LanguageProfile.declareIn` / `declare_in`,
`LinkNetwork`, `LinkMetadata`, and ordered graph references. There is no private
upstream API dependency.

The shared LiNo frontend now exposes the trees it already parsed through
`parseLinoLinkDocument` / `parse_lino_link_document`. Existing text/location
entry points retain their previous result shape. The adapter never reconstructs
source and reparses it to recover the structured forms.

The extension has these node definitions, each prefixed `rml:structure:1:`:

- `document`: ordered form references; term is the schema version
- `form`: syntax-root and source-location references, in that order
- `location`: normalized-source line, code-point column, and length
- `reference`: the exact decoded reference value, with no children
- `link`: optional link name and ordered nested values
- `compound`: the frontend's path-combination distinction and nested values
- `diagnostic`: original parse-error detail and a location reference

Form roles distinguish declarations, theories, rules, assumptions, proofs,
substitutions, and otherwise unknown forms. These roles are syntactic labels,
not claims that a declaration has resolved, a rule is admitted, or a proof has
checked. Bodies, nested binders, references, proof steps, and unknown syntax stay
as ordered nested graph data. Unknown source is never converted into a proof or
dropped because it does not match a known role. A LiNo-invalid document keeps
its complete source plane plus an E006 diagnostic; it has no parsed-document root.

Two deliberately distinct representations coexist:

1. Source-token links preserve original spelling, comments, whitespace, BOM,
   CRLF, and incomplete input. `reconstructRmlFromMetaLanguage` /
   `reconstruct_rml_from_meta_language` reproduce this plane exactly.
2. Syntax links retain the shared LiNo frontend structure. `rmlStructureOnly` /
   `rml_structure_only` produce a separate network with **zero source tokens**.
   `emitRmlFromStructure` / `emit_rml_from_structure` generate canonical LiNo
   solely from these links, without a source buffer or parser. Canonical output
   retains parsed structure, not original formatting or comments.

`serializeRmlStructure` / `serialize_rml_structure` and matching deserializers
share JSON schema `rml:structure:1`: language plus graph records containing IDs,
ordered references, link type, language, definition, and optional term. This
explicit snapshot is needed because published npm 0.46's `toLino()` omits
metadata. Rust may reindex IDs during snapshot import; explicit sharing retains identity there. The source-free syntax projection and serialization materialize occurrence trees, preserving syntax rather than arbitrary DAG identity. Expanded-node and UTF-16 text budgets proportional to the graph reject exponential acyclic expansion.
The snapshot does not preserve the source-token plane. Cycles, dangling
references, duplicated IDs/document roots, unsupported schemas, and over-deep
syntax are rejected. Snapshot input is syntax data, not execution authority.

Stage reports explicitly separate preservation, parsing, resolution,
elaboration, execution, and verification. Parsing syntax does not run any of the
last four stages. Legacy evaluator parity reports still compare executions of
source by the host evaluator; this is not Link-driven elaboration or execution
and is not claimed as R149–R151 closure.

## Identifier rewriting contract

`js/src/rml-js-rename.mjs` and `rust/src/js_rename.rs` implement the same
`lexical-blocks-v1` conservative rename over the lossless JavaScript token CST.

- Supports simple `let`/`const` bindings and standalone nested lexical blocks.
- Selects the top-level binding, or the sole nested binding when there is no
  top-level one; unresolved names are selectable when no binding exists.
- Preserves shadowed declarations/references and lexical temporal-dead-zone
  binding identity; member-access property spellings are not renamed.
- Preserves strings/comments; Unicode including astral identifiers works.
- Locations use UTF-16 offsets and one-based Unicode-code-point columns, with
  CRLF counted once even across comment/trivia token boundaries.
- Any existing target-name identifier in the lexical environment is a capture
  refusal. This is deliberately conservative, including disjoint scopes.
- Multiple nested bindings without a selected top-level binding are ambiguous.
- Function/arrow scopes, object literals/shorthand, destructuring, templates,
  escaped identifiers, regex literals, `var`, imports/exports, and dynamic
  `eval` are unsupported and rejected before edits. No partial rewrite is
  returned for them.

Errors carry `RML_RENAME_CAPTURE`, `RML_RENAME_AMBIGUOUS`,
`RML_RENAME_UNSUPPORTED`, or `RML_RENAME_INVALID`. This is not a complete
JavaScript parser; successful results explicitly report `syntaxValidated: false`
(`syntax_validated` in Rust). The transform assumes otherwise valid input and
must not be used to certify native syntax or full ECMAScript conformance.

## Translation obligations and preservation contracts

`languageTranslationObligation` / `language_translation_obligation` expose the
same versioned unsupported-obligation model for all twelve directed pairs.
They return `status: unsupported`, unchanged `preservedSource`, a null
`targetSource`, and `RML_TRANSLATION_UNIMPLEMENTED` with the pending structure,
binding/type resolution, encoding, and preservation obligations. This is a
refusal interface, not twelve implemented translators.

No path currently promises behavior/effect preservation, Rust ownership,
JavaScript host facilities, module linking, type correspondence, Lean/Rocq
universe correspondence, preservation of assumptions, or proof validity.
Native compiler/prover success would be one validation layer, not a proof of
cross-language equivalence. The complete machine-readable per-language and
per-path inventory is `language-coverage.json`; all missing obligations remain
acceptance work.

## Evidence

Shared fixtures:

- `test-corpus/meta-language/rml-structure.json`: roles, quotes, nested syntax,
  indentation, Unicode, normalization, unknown proofs, and invalid source
- `test-corpus/meta-language/structured-snapshot.json`: a JavaScript-produced
  graph consumed without source tokens by Rust
- `test-corpus/meta-language/identifier-rewrites.json`: shared positive,
  capture/shadowing, Unicode/location, ambiguous, unsupported, and invalid cases
- `test-corpus/lino-frontend/cases.json`: entire frontend structure/diagnostic
  corpus also consumed through the new network extension

Runtime tests are `meta-language-structure.test.mjs`,
`meta-language-rename.test.mjs`, `meta-language-support.test.mjs` and their Rust
`meta_language_*_tests.rs` mirrors. They test actual upstream graph substitution
changing emitted syntax, graph-only serialization, mutation rejection, exact
source preservation, and all twelve unsupported outcomes. They do not establish
full-language grammar, elaboration, native validity, execution equivalence, or
proof equivalence. Final test outcomes belong in the integration run report,
not inferred from these test descriptions.
