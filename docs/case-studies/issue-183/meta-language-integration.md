# Official meta-language release integration audit

Audit date: 2026-10-08. The official implementation is consumed from release 1.0.0. Full
language acceptance R101 and R103–R109 remains incomplete; see the structure,
rewriting and construct-inventory sections below for the delivered increments.

## Official source integration and registry status

The implementation merged for [upstream issue 195](https://github.com/link-foundation/meta-language/issues/195)
on 2026-10-06 is now consumed at release commit
`a79782093cae3b33606483ac9f3e1d05faf36de0`: the JavaScript runtime is an immutable
source submodule and Rust uses the exact official crates.io release `=1.0.0`.
The release is 17 commits after the previously consumed `679a3b3` source.
The crate's VCS metadata and 343 compared files match this release source.
The [2026-10-08 20:16 UTC registry audit](data/meta-language-release-audit-2026-10-08.json)
confirms npm still exposes only 0.46.0. A matching npm release remains absent;
RML ships the matching official JavaScript release source with provenance.

[Upstream language source](../../UPSTREAM_LANGUAGE_SOURCE.md) documents the
installation, file hashes, licenses, package-consumer behavior and exact API
boundary. The new `rml-upstream-language.mjs` / `upstream_language.rs` interfaces
expose upstream grammar CSTs, scoped bindings, project-context resolution,
structured edits, snapshots and translation contracts directly. The official
shared four-language fixture is exercised in both runtimes, including invalid
input and missing-context/capture refusal. Full semantic translation remains
open: upstream's unsupported-input envelopes do not satisfy that requirement.

RML now uses maintained links-notation 0.25.1 in both runtimes, with its existing
LiNo frontend and structured-links-network corpus checked for compatibility. Existing
RML-specific syntax and portable-natural behavior remain separate from the
newly consumed general-language APIs.

## RML structure schema 1

`js/src/rml-meta-structure.mjs` and `rust/src/meta_language_structure.rs` register
`rml:structure:1` using upstream `LanguageProfile.declareIn` / `declare_in`,
`LinkNetwork`, `LinkMetadata`, and ordered Link references. There is no private
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

Layout (link type `Trivia`):

- `layout`: ordered segment references; together they spell every source
  character, including a leading BOM, CRLF, comments and quoting
- `trivia`: exact whitespace, comment, punctuation or BOM text
- `token`: exact reference spelling, referencing its `token-value` and, when
  bound, the one syntax occurrence it spells
- `token-value`: the decoded value the token had when it was bound

Provenance, receipts and semantic identities (link type `Semantic`):

- `provenance`: `source-sha256:<hex> utf8-bytes:<n>`, plus
  `derived-from:<hex>` for an edited network
- `layout-refusal`: an explicit first-refusal receipt when the source tokens
  cannot be aligned with the parsed occurrences (no silent loss)
- `semantics`: the root of every semantic record, term `rml:structure:1`
- `declaration`: `<kind>:<name>` with the name-site and form occurrences
  (`definition`, `theory`, `rule`, `assumption`, `proof`)
- `binder`: `<kind>:<name>` with the binder-site and scope occurrences
  (`lambda`, `Pi`, `forall`, `exists`, `fresh`, rule `pattern` variables)
- `role`: premise, conclusion, proof-step, statement, substitution-entry,
  theory-member or component, with owner and member occurrences
- `resolution`: `bound`, `global`, `ambiguous` or `free`, with the occurrence
  and its binder or declaration records

Form roles distinguish declarations, theories, rules, assumptions, proofs,
substitutions, and otherwise unknown forms. These roles are syntactic labels,
not claims that a declaration has resolved, a rule is admitted, or a proof has
checked. Bodies, nested binders, references, proof steps, and unknown syntax stay
as ordered nested links-network data. Unknown source is never converted into a proof or
dropped because it does not match a known role. A LiNo-invalid document keeps
its complete source plane plus an E006 diagnostic; it has no parsed-document root.

Two deliberately distinct representations coexist:

1. Source-token links preserve original spelling, comments, whitespace, BOM,
   CRLF, and incomplete input. `reconstructRmlFromMetaLanguage` /
   `reconstruct_rml_from_meta_language` reproduce this plane exactly.
2. Syntax links retain the shared LiNo frontend structure. `rmlStructureOnly` /
   `rml_structure_only` produce a separate network with **zero source tokens**.
   `emitRmlFromStructure` / `emit_rml_from_structure` generate canonical LiNo
   solely from these links, without a source buffer or parser.
3. Layout links, carried into the structure-only network by occurrence address,
   let `emitRmlExactSource` / `emit_rml_exact_source` reproduce the **exact
   original source** without any source buffer, source token or parser. Every
   bound token must spell the bindable occurrences exactly once and in order;
   a token whose occurrence was edited is spelled from the occurrence's new term.
   The whole shared frontend corpus and both semantic corpora round-trip
   byte-for-byte from layout links in both runtimes.

`serializeRmlStructure` / `serialize_rml_structure` and matching deserializers
share JSON schema `rml:structure:1`: language plus Link records containing IDs,
ordered references, link type, language, definition, and optional term. This
explicit snapshot was originally introduced because published npm 0.46's
`toLino()` omitted metadata; it remains the versioned RML interchange contract
after source integration. Rust may reindex IDs during import; shared references retain identity.
The snapshot does not preserve the source-token plane. Import retains sharing
when multiple references in the snapshot name one node, but `rmlStructureOnly`
and serialization deliberately project syntax into occurrence trees; they are
not archives of arbitrary links-network identity or cycles. Cycles, dangling references,
duplicated IDs/document roots, unsupported schemas, and over-deep syntax are
rejected. Reconstructing a compact shared acyclic links network is additionally bounded: expanded
nodes may not exceed `max(1024, 4 × syntax-node count)`, and expanded reference
text plus one unit per node may not exceed `max(4096, 4 × stored syntax-term
UTF-16 units including one unit per syntax node)`. These budgets span all forms
in a document and return an explicit expansion-limit error rather than allowing
exponential materialization. They are independent of the preserved source-token
plane. Snapshot input is syntax data, not execution authority.

Resolution is a separate stage. `resolveRmlStructure` / `resolve_rml_structure`
write the semantic records; `parseRmlToMetaLanguage` runs it after a clean parse.
Identities are keyed by occurrence address (`<form>.<child>...`), so they
survive ID reindexing. They are never trusted: `rmlSemanticIdentities` /
`rml_semantic_identities` and every deserialization recompute resolution from
syntax and reject dangling or forged occurrences, targets that are not
declaration or binder records, statuses that contradict their targets, wrong
binders (for example a reference retargeted past a shadowing binder) and
semantic or layout links not reachable from their roots. A shared syntax DAG
has no unique addresses and therefore cannot carry identities. Free and
ambiguous references stay explicit records, never guessed targets.

Stage reports explicitly separate preservation (`source-token-plane`,
`exact-source-structure`, `canonical-structure`), exact source (`verified`
against provenance, `edited`, `unverified`, `provenance-mismatch`, `refused`,
`absent`, `rejected`), parsing, resolution (`resolved`,
`resolved-with-open-references`, `not-run`, `rejected`), elaboration, execution
and verification. `rmlStageReport` / `rml_stage_report` run execution only on
request, through the RML evaluator, on exact source when intact and otherwise on
canonical structure, and report result counts and diagnostic codes. Elaboration
and verification remain `not-run`: no RML elaborator or proof checker is
attached to this representation. Legacy evaluator parity reports still compare
executions of source by the host evaluator; this is not Link-driven elaboration
or execution and is not claimed as R149–R151 closure.

## Identifier rewriting contract

`renameRmlBinding` / `rename_rml_binding` rename one RML declaration or binder,
selected by occurrence address, together with every reference resolved to it.
The edit is accepted only when fresh resolution of the edited structure gives
every occurrence the same status and targets; otherwise it fails with
`RML_RENAME_CAPTURE` (capture by an inner binder, capture of a free reference,
or a new global ambiguity), `RML_RENAME_AMBIGUOUS`, `RML_RENAME_INVALID_NAME`
(keywords, literals, a pattern variable without `?`, or a plain binder with one)
or `RML_RENAME_NOT_BINDING`. Comments and other layout stay byte-identical;
quoted spellings are the same reference and are re-spelled canonically; a
comma-separated binder keeps its separator. Each edit reports its address and
original one-based line and code-point column (BOM skipped, CRLF counted once).
The result is a new checked network with exact source, canonical source and a
provenance receipt derived from the original digest. The shared
`rml-binding-rewrites.json` corpus runs unchanged in both runtimes.

For JavaScript, Rust, Lean and Rocq sources the upstream grammar-backed
`analyzeProgram(...).renameBinding` / `rename_binding` is used unchanged.
`four-language-binding-rewrites.json` pins, per language, the declaration and
reference locations as one-based line, code-point column and code-point length
(CRLF counted once), so the JavaScript UTF-16 and Rust UTF-8 ranges must agree
after conversion; the exact emitted edit (strings, comments, templates and
shadowed bindings untouched; astral and non-ASCII identifiers); a re-analysis of
the emitted text that finds the renamed declaration at the same location with
the same reference count; capture refusals; and refusal of invalid names and
forged binding ids. It covers only the cases listed, inside the upstream
native grammars, not the full languages.

The JavaScript identifier adapter below is separate and unchanged.

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
For arbitrary full-language inputs they return `status: unsupported`, unchanged `preservedSource`, a null
`targetSource`, and `RML_TRANSLATION_UNIMPLEMENTED` with the pending structure,
binding/type resolution, encoding, and preservation obligations. This is a
refusal interface, not twelve implemented translators.

The separate [portable natural-number translators](portable-natural-translation.md)
now implement all twelve paths for a bounded pure-function fragment through the
registered RML links network. All twelve directed native target paths pass eight
observations each in JavaScript/Rust/Lean/Rocq; three false Rocq observation proofs
are rejected. The full-language and arbitrary-proof gaps remain explicit. No full-language path currently
promises behavior/effect preservation, Rust ownership,
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
  links network consumed without source tokens by Rust
- `test-corpus/meta-language/expansion-cases.json`: shared positive/negative shared-network
  cases, including exponential node expansion, repeated long references, UTF-16
  text accounting, and empty references
- `test-corpus/meta-language/identifier-rewrites.json`: shared positive,
  capture/shadowing, Unicode/location, ambiguous, unsupported, and invalid cases
- `test-corpus/lino-frontend/cases.json`: entire frontend structure/diagnostic
  corpus also consumed through the new network extension, and round-tripped
  byte-exactly from layout links after discarding the buffer
- `test-corpus/meta-language/rml-semantics.json`: expected declarations,
  binders, roles and resolutions, stage outcomes, and nine snapshot mutations
  (retargeted binder, non-record target, forged occurrence, dangling target,
  contradicted status, unaccounted record, swapped layout binding, refusal
  receipt, tampered provenance)
- `test-corpus/meta-language/rml-binding-rewrites.json`: shadowing, capture,
  free-reference capture, comments, quoting, Unicode/astral names, BOM/CRLF,
  pattern variables, global declarations, ambiguity, invalid names and
  locations
- `test-corpus/meta-language/four-language-binding-rewrites.json`: upstream
  JavaScript, Rust, Lean and Rocq binding edits with runtime-independent
  locations, capture refusals and invalid replacement names
  (`four-language-binding-rewrites.test.mjs`,
  `four_language_binding_rewrites_tests.rs`)

Runtime tests are `meta-language-structure.test.mjs`,
`meta-language-semantics.test.mjs`,
`meta-language-rename.test.mjs`, `meta-language-support.test.mjs` and their Rust
`meta_language_*_tests.rs` mirrors. They test actual upstream links-network substitution
changing emitted syntax, source-free structured links-network serialization, mutation rejection, exact
source preservation, and all twelve unsupported outcomes. They do not establish
full-language grammar, elaboration, native validity, execution equivalence, or
proof equivalence. Final test outcomes belong in the integration run report,
not inferred from these test descriptions.

The release update also runs `upstream-language.test.mjs` and
`upstream_language_tests.rs` against the shared `release-regressions.json`:
default arguments, declaration-scope resolution, Unicode escape decoding and
source-preserving refusals. Registry delivery and those focused regressions do
not close the full-language semantic or proof obligations above.

## Four-language construct inventory

`docs/case-studies/issue-183/language-construct-classifier.json` assigns every
rule of the upstream native JavaScript (143), Rust (184), Lean (147) and Rocq
(265) grammars to one of ten axes: grammar, structure, scope, types, modules,
recursion, proof forms, runtime facilities, standards and extensions.
`js/src/rml-language-inventory.mjs` and `scripts/language-construct-inventory.mjs`
generate `language-constructs.json` from the upstream rule/concept API, the
vendored grammar texts (rule kinds and fingerprints) and native construct trees
for `test-corpus/meta-language/construct-corpus.json` (the vendored translation
corpus, the conformance fixtures and 168 construct programs, three of them recorded refusals). `--check` is a
freshness gate. A construct no pattern classifies, a pattern that classifies
nothing, a changed corpus acceptance or a stale inventory fails the JS test;
`language_construct_inventory_tests.rs` reproduces the fingerprints,
classification, refusals and exercised set with the Rust crate's grammar API and
native parser.

Corpus programs exercise 103/109 observable JavaScript, 146/158 Rust, 107/119
Lean and 191/219 Rocq constructs; the rest are listed as `unexercised`. The
native grammars refuse valid Lean structured `induction ... with` alternatives
and `where` declarations (and therefore the vendored `project.lean`) and Rocq
`CoFixpoint`; these are recorded refusals. Exercised means only that the native
grammar built the construct: it is not compiler, kernel or runtime acceptance,
nor resolution, elaboration, execution, verification or translation of it.

The two packages do not yet build identical construct trees: the Rust crate
keeps comment extras that the JavaScript package drops (`block_comment` and
`line_comment` for Rust, `comment` for Rocq). Exercise counts come from the JavaScript trees, and
the Rust mirror pins exactly that comment divergence, so any other difference,
or an upstream repair, fails the test until the inventory is regenerated
(upstream request 19 in `meta-language-upstream-requests.md`).
