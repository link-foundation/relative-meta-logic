# Draft meta-language feature requests from RML certified translation

**Status: drafts only. None of these issues has been filed.** Each entry names
a feature that RML's certified translation pipeline
([certified-translation.md](certified-translation.md)) needs and that
[link-foundation/meta-language](https://github.com/link-foundation/meta-language)
must fully support before the temporary copy in
[`js/vendor/meta-language-pr201`](../../../js/vendor/meta-language-pr201/VENDORED.md)
can be removed. All observations refer to PR #201 at commit
`7c4bf8f1e3f88806b09d5210643cc6611d30d1f9`. An entry is evidence of a gap seen
from RML; it is not a claim about upstream plans.

## Release and packaging

1. **Publish the typed-program links and four-language portable core.**
   Release `typed-program-links.js`, `translation/check.js`, the four frontends
   and the four emitters in matching npm and crates.io versions with the
   behavior pinned by RML's corpus (`test-corpus/certified-translation`).
   *Acceptance:* RML imports them from `#meta-language` and
   `node scripts/generate-certified-translations.mjs --check` passes unchanged.
2. **Consume typed-program links without the grammar catalog.** PR #201's
   `network.js` statically imports the complete grammar catalog and concept
   records (more than 10 MB of data). RML re-exports the pinned submodule's
   `network.js` through a shim instead. *Request:* split `LinkNetwork` (field
   relations, `toLino`, `fromLino`) from catalog-dependent parsing, or load the
   catalog lazily.
3. **Align the `links-notation` dependency.** The copied modules pin
   `links-notation@0.22.0`; RML runs them on 0.25.1. *Request:* declare the
   supported range and test the typed-program schema loader against it.
4. **Guarantee a stable `toLino` canonical form.** RML certificates hash the
   serialized typed-program network (`intermediate sha256`). *Request:* document
   and test that `toLino` output is deterministic for equal networks across
   patch releases, or version the canonical form explicitly.

## Four-language coverage of the source-free archive

5. **Lean and Rocq in `createTypedProgramLinks` / `emitTypedProgramLinks`.**
   Both functions currently accept only JavaScript and Rust; RML calls
   `parseLean`/`parseRocq`, `checkProgram` and `emitLean`/`emitRocq` directly
   around `encodeTypedProgramLinks`/`decodeTypedProgramLinks`. *Request:* all
   four languages through the public archive API, in both runtimes.
6. **Rust typed-program archive and frontends.** The Rust crate has no decoder
   for the typed-program schema or the portable-core frontends, so RML's Rust
   certificate checker can only verify integrity, not re-derive. *Request:*
   JavaScript/Rust parity for encode, decode, validation and recheck.
7. **Checker/archive consistency for fixed-width structural recursion.** A Rust
   function `fn triangle(n: u32) -> u32 { if n == 0 { 0 } else { n + triangle(n - 1) } }`
   passes `checkProgram`, but `encodeTypedProgramLinks` rejects the checked
   program with `natural-number pattern on u32` (corpus case
   `refusals/rust-u32-structural-recursion.rs`). *Request:* either keep the
   rewrite on naturals only or admit the pattern on unsigned fixed types; the
   checker and archive validator must agree.
8. **Spans on archive-validation errors.** That rejection carries no span, so
   RML's refusal receipt records `(span unlocated)`. *Request:* every
   validation error carries the source span of the offending construct.

## Constructs RML needs translated rather than refused

9. **Parametric polymorphism.** Lean implicit binders (`{α : Type}`), Rust type
   parameters, JavaScript functions used at two types and parameterised
   inductives (`Inductive t (A : Type)`) are refused. *Request:* explicit type
   parameters in the typed-program schema with monomorphic or dictionary-free
   erased emission and documented universe behavior.
10. **Records and structures.** Rocq `Record`, Lean `structure` and Rust
    `struct` are refused. *Request:* nominal record declarations with field
    order, projections and constructors as links, emitted faithfully in all four
    targets.
11. **Standard-library coverage map.** `Nat.max`, `Nat.even` and similar Stdlib
    functions are refused as outside the core. *Request:* a declared, linked
    standard-library profile per language whose functions carry their semantics
    (or explicit obligations) instead of a blanket refusal.
12. **Traits, type classes and macros as explicit data.** Trait/instance
    resolution and macro expansion are authority-bearing. RML requires that they
    never be granted implicitly. *Request:* represent declarations, instances
    and expansions as inspectable links with explicit resolution obligations,
    never as silent dispatch.

## Certificates and verification

13. **Target spans and stable construct identities in `mappings`.** Emitter
    mappings carry the source span but no target span or stable identity, so a
    certificate cannot point at the emitted construct. *Request:* target spans
    and link identities for every mapped declaration, constructor and theorem.
14. **Re-importable emitted targets.** Every emitter prepends a runtime prelude
    (`ml_` helpers, `use std::cmp::Ordering`, `set_option`, `N.size_nat`) that
    the frontends refuse, so target → links → target regeneration cannot be
    checked. *Request:* the frontends recognize the emitter's own prelude by
    identity (or the emitter separates it), so translated code round-trips
    through the archive.
15. **A shared preservation-contract vocabulary.** RML certificates declare
    behavior, effects, ownership, types, universes, assumptions and proof
    obligations. *Request:* these dimensions as global concepts with formal
    definitions in the concept space, so certificates reference upstream
    identities instead of RML-local strings.
16. **Proof-object correspondence.** Theorems are re-proved in the target by
    generic tactics (`try rfl; try decide`, `ml_decide`) or bounded executable
    checks; no proof term is translated. *Request:* linked proof objects with a
    per-step correspondence, so a translated proof can be checked against its
    source proof instead of re-searched.
17. **Machine-readable discharge kinds.** `translateProgram`'s
    `semantics.obligations[].discharge` distinguishes `target-kernel` from
    `runtime-assertion`, and the emitters' `theorems[]` records do not always
    carry a discharge kind, so bounded JavaScript/Rust theorem checks are not
    marked as non-proofs. *Request:* an explicit
    `bounded-check-not-proof` discharge kind so downstream consumers cannot
    mistake them for proofs.
18. **Rocq emitter: no self-qualification inside an open module.** The pinned
    `emit-rocq.js` writes `Shapes.Tree` and `geometry.Shape` for a module's own
    declarations while `Module Shapes.` / `Module geometry.` is still open. The
    pinned Rocq 9.3 kernel rejects both targets ("The reference Shapes.Tree was
    not found in the current environment"; first observed by `translation-native`
    on PR 184 head `0322bfb`). RML now emits those references unqualified
    through `localizeTargetNames` and records the rewrite as the
    `rml-rocq-open-module-local-names` encoding in each affected certificate.
    *Request:* emit local names inside the module, qualified names outside it,
    and add a native Rocq check for module-scoped inductives to the upstream
    emitter tests.
