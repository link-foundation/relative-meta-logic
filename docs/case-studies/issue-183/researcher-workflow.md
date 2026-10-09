# Reproduce a research lifecycle (R125)

The shipped JavaScript and Rust recipes use the public package, foundation,
structured-language and linked-proof APIs. They read the same source files and
assert the same language-neutral report. They exercise actual execution and
independent replay, rather than treating a source digest as a proved theorem.

From the repository root, after the normal dependency setup:

```sh
node scripts/run-with-cache.mjs -- node examples/researcher-workflow.mjs
node scripts/cargo.mjs run --manifest-path rust/Cargo.toml --example researcher_workflow
node scripts/run-with-cache.mjs -- node --test js/tests/researcher-workflow.test.mjs scripts/formal-ai-adoption.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test researcher_workflow_tests
```

Both recipes default to the closed S/K basis. Append `--direct` to the JavaScript
command, or `-- --direct` to `cargo run`, to select the separately identified
host structural control. The tests execute the full lifecycle on both bases.
The reports differ only in their declared execution basis, and their stable
expected observations live in `test-corpus/researcher-workflow/expected.json`.
The cache wrappers print lifecycle messages around the JSON report.

## Follow the complete loop

1. **Define foundations.** Edit `foundation-one.lino` and `foundation-two.lino` in
   `test-corpus/researcher-workflow`. Each independently declares its local rules,
   inference, reduction and proof roles, version and inductive cycle policy.
   Version 1 admits an input and derives its publication; version 2 rejects it.
   Repeated local names are scoped by `FoundationPackages`, not renamed in the
   user's statements. The laws are a researcher's choices, not intrinsic truth.
2. **Construct sets, types and links.** `constructResearchObjects` /
   `construct_objects` selects the recursive ontology explicitly, defines
   `Submission`, `SubmissionPair`, `Set` and `OrderedSet` as links, and types
   the `specimen`, `archive` and `submitted-edge` links. The address-sequence
   API constructs a duplicate-free set containing a link-valued element, a
   nested singleton set, and an ordered set. All records and typing facts form
   one closed graph, restored from a strict semantic archive after discarding
   the type index. The restored nested set retains the inner set's identity.
   Duplicate ordered sets and removal of a referenced link are rejected.
3. **Develop one theory.** `theory.lino` supplies the unchanged `submissions`
   theory. Each package binds it to its own foundation. Change the fact
   `(input specimen)` or add linked facts/rules; the runtime has no callback
   naming this theory or its predicates.
4. **Inspect declarations and the theorem.** JavaScript's `workspace.describe`
   and Rust's `FoundationPackages::describe` return roles, versions, rules,
   dependencies and bootstrap provenance. `ask` returns a complete result with
   its assumptions, context, proof tree, rule dependencies, bounds and observed
   host operations. Inspect `first.result.proof` in the JavaScript recipe, or
   the analogous `PackageResult` in Rust. The theorem is `(publishable specimen)`.
5. **Verify the evidence.** The recipe's data-only certificate exporter derives the trusted context from
   the selected source declarations, independently of the proof's dependency
   claims, and reads the recorded proof, preserving each premise, binding,
   conclusion and transitive dependency. `verifyLinkedProof` /
   `verify_linked_proof` executes `proof-verifier.lino`; a fresh registry then
   independently replays every trace step. The expected proof has three nodes:
   publication, admission and the submitted fact. Missing premises, changed
   bindings/conclusions/dependencies, a circular node, forged traces, and a
   swapped version context are rejected in both runtimes. A stale proof also
   fails against a changed source fact; a forged dependency cannot import an
   unrelated source program into the trusted context.
6. **Execute a linked algorithm.** The constructed set's members become a
   linked list. `execute` evaluates its recursive `length` definition using
   the selected foundation's `length-empty` and `length-step` rewrite rules,
   returning `(s (s z))`. The empty list yields `z`. Changing the linked
   recursive rule to return `z` changes the nonempty result, on both execution
   bases; no host callback supplies the count. Computation does not itself
   prove the publication judgement.
7. **Change a dependency and recheck.** `revise` replaces the submitted fact
   in version 1 with `(input other)`. The transitive publication theorem changes
   from proved to unknown; version 2 is kept and remains refuted. The original
   workspace still proves its original theorem. Results from another workspace
   cannot be submitted as cached answers, and missing rule IDs fail explicitly.
8. **Compare foundations.** The same unchanged theory yields proved in version
   1 and refuted in version 2. Both answers retain their contexts. This is a
   comparison under declared laws, not a ranking of intrinsic/minimal foundations.
9. **Import and export languages.** The recipe first serializes each RML package
   as structured links, discards source tokens, restores the structure and
   executes the reconstructed RML. For JavaScript, Rust, Lean and Rocq it
   separately imports a `successor` definition through the official upstream
   representation and restores exact source from a snapshot. It also runs all
   12 directed bounded-natural translations through RML structure, reimports
   each target and executes `successor(7)` as `8`. Each result retains its numeric
   obligation and `not-proved` verification status. An async/effectful program
   is rejected by this fragment translator, with the source retained.

## Public entry points and trust boundaries

JavaScript callers can import `runResearcherWorkflow`, `researcherPackages` and
`certificateFromResult`, `constructResearchObjects` and `executeResearchAlgorithm` from `examples/researcher-workflow.mjs`; the recipe is
also a readable composition of existing public APIs. Rust callers can start
from `rust/examples/researcher_workflow.rs`. Neither path accesses a test-only
semantic callback or delegates proof authority to a native compiler.

The certificate exporter intentionally supports assumption-free, unimported,
finite inductive evidence whose premises do not need conversion. It refuses
unsupported contexts and lets the linked checker determine acceptance. This is
not a new certificate exporter for coinduction, imported/rebound theories,
conversion proofs, or the complete upstream formal corpus. The underlying
workspace's broader operations remain separately tested.

Full-language elaboration and arbitrary cross-language semantic preservation
are not established here: the four source representations report unavailable
type elaboration, and the executable translation is the documented bounded
natural fragment. The recipe makes the requested lifecycle reproducible now;
it does not complete R101–R123, R130 or whole-product self-hosting. Rust/JS data
handling, file I/O, parsing, the selected foundation schema, certificate
quotation, candidate binding extraction, and the selected reducer's bootstrap
laws remain explicit host
boundaries. Host matching only proposes certificate bindings; the linked
verifier checks every binding independently. Independent trace replay detects tampering; it does not establish
intrinsic authority for the selected verifier.

# Experience adopted from formal-ai (R126)

The source-backed decision register is [formal-ai-adoption.json](formal-ai-adoption.json).
It records the exact upstream revision, functions, adopted and rejected behavior,
rationale, local implementation and named executable tests for all four ideas.
The reviewed official sources are pinned to
[`efb6ddb603e870253d7cb36b4ce31b292b215255`](https://github.com/link-assistant/formal-ai/tree/efb6ddb603e870253d7cb36b4ce31b292b215255).

- **Whole-source projection:** adopt exhaustive inventory and reconstruct every
  module from its snapshot. Keep preservation separate from syntax, elaboration,
  execution and proof. A cheap manifest alone cannot certify any later stage.
- **Typed events:** adopt explicit represented roles, strict schemas and
  replayable linked execution records. Reject installing the application-specific
  MemoryEvent taxonomy and kind/role/intent fallback as universal RML semantics.
- **Context separation:** adopt isolated, explicitly selected contexts and
  immutable revisions. Reject ambient current/target/general authority and
  silent assumption merging.
- **Dependency recalculation:** adopt dependency-backed rechecking with observable
  before/after results. Reject importing application-specific probability priors,
  source-tier policy or oscillation averaging as proof laws.

Run the exhaustive source projection separately:

```sh
node scripts/run-with-cache.mjs -- node scripts/researcher-source-projection.mjs
```

The inventory is every `.mjs` under `js/src`, `.rs` under `rust/src`, and `.lino`
under `lib`, including nested modules and the linked semantic implementation.
It excludes dependencies, tests, scripts and generated build output; it does
not claim to enumerate every repository file. CLI progress identifies each
file on stderr; the final JSON report is written only after all files finish.

The source projection uses the official low-level parsers and public network
constructors. Its bounded JSON transport retains every link ID, reference,
metadata field, source span, recovery flag and named-point registration. It
checks exact graph equality after restoration before reconstructing source.
This does not call higher-level binding/type analysis just to preserve a file,
and it avoids the official LiNo reader's 10 MiB expanded-text ceiling without
changing that reader's limit. A regression restores an escaped-token network
larger than 10 MiB through the JSON path. The codec supports the monotone named
point allocation produced by source parsing; unsupported allocations fail.

Files with recovery or resource-limit diagnostics are preserved and remain
explicitly not cleanly parsed. This does not declare their source malformed.
Per-module hashes and byte equality come from the independently restored
networks. The helper bounds each input source at 8 MiB, each snapshot at 256 MiB,
and its graph at 500,000 links and 2,000,000 references. Oversized inputs,
empty/duplicate inventories, invalid UTF-8, symlinks, corrupt metadata and
dangling references fail explicitly; no file is skipped and no source is edited.
Source projection does not establish elaboration, execution, proof verification,
whole-product semantic closure or self-compilation.

The [2026-10-07 frozen projection report](data/researcher-source-projection-2026-10-07.json)
records 94 individually executed projections, matched by exact path and source
hash, all preserving source and public graph fields. This historical snapshot
does not certify later edits; rerun the command above for the current checkout. Its ordered path/source-hash manifest has SHA-256
`fea46fc4dfb4d0286722a7f3b4fb9347bae660b7e9b356cad6c036ba34b9b3d2`. Of these, 91 parsed cleanly. The remaining three valid runtime files
(`js/src/rml-links.mjs`, `rust/src/lib.rs`, `rust/src/linked_program.rs`)
exceeded the pinned upstream native grammar's default 2,000,000 memo-cell
budget. Direct grammar replays returned `memoryBudget` and the diagnostic
`the parse needed more than 2000000 memo cells`; the default language adapter
represents that rejection as an `ERROR` root. The bound was not raised and no
source was omitted. This is complete preservation evidence for that inventory,
not a claim of complete structured parsing or execution of those three files.
