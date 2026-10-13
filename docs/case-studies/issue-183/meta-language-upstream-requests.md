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
19. **Same native construct trees in both packages.** The Rust crate's
    `native_construct_tree` keeps comment extras (`block_comment` and
    `line_comment` for Rust, `comment` for Rocq) while the JavaScript
    `nativeConstructTree` drops them, so the two runtimes observe different exercised constructs over the
    same corpus (first observed by the Rust inventory mirror on PR 184 head
    `512ee1a`). RML pins exactly this divergence in
    `rust/tests/language_construct_inventory_tests.rs` and counts exercise from
    the JavaScript trees. *Request:* one documented policy for extras
    (comments, trivia) in construct trees, identical in both packages.

## Requests from repository-scale bulk translation

The bulk receipt
([`test-corpus/certified-translation/bulk/receipt.lino`](../../../test-corpus/certified-translation/bulk/receipt.lino),
generated by `node scripts/generate-certified-bulk.mjs`) runs every top-level
item of `js/src` and `rust/src`, and every Lean and Rocq module under `lib/`,
through the pinned core: 2583 items, 148 admitted, 101 lowered into `main`,
2334 refused. The counts below are first refusals per item from that receipt.
"In a dependency" means the first refusal sits in a same-file declaration the
item uses, not in the item itself.

20. **Rust frontend: `pub` before every item kind.** `pub fn`, `pub const`,
    `pub enum` and `pub mod` parse, but `pub struct` stops with the syntax error
    `expected a Rust item but found "struct"` (516 items: 198 at the item, 318 in
    a dependency), and `pub type` fails the same way in a one-line probe, while
    the same declarations without `pub` get the precise refusals `Rust struct
    item` (83) and `Rust type item` (32). *Request:* parse visibility before
    every item, so the refusal (or, with request 10, the admission) is the same
    with and without `pub`.
21. **Rust slice and array types.** `&[T]`, `[T; N]` and `&[&str]` stop with
    `expected identifier in type but found "["` (153 items, 89 at the item),
    mostly string tables such as `const RESERVED: &[&str] = &[…]`. *Request:*
    parse slice and array types and admit fixed arrays and slices of scalars and
    strings as the typed-program array type the JavaScript frontend already
    emits as `Vec<T>`.
22. **Rust lexer completeness.** The pinned lexer reads `'"'` as the start of a
    string (`unterminated string literal`, 16 items, e.g. `out.push('"')` in
    `rust/src/cst.rs`); rejects the valid escapes `\x08` and backslash-newline
    continuation (3 items); does not lex raw strings, so `r"\p{ID_Start}"`,
    `r"<=\?"` and `r#"…"#` fail as escapes or as `expected ; in const but found
    "#"` (7 items); and fails on byte literals `b'\n'` (2 items). *Request:* lex
    every Rust literal form, and refuse unsupported ones with a construct name
    (`raw string`, `byte literal`) instead of a syntax error.
23. **Characters as Unicode scalars.** Rust `char` (12 items) and character
    literals (9) are refused. The bulk mirror comparison shows the JavaScript
    side already represents one character as a one-scalar string, and the
    certified translations of `isLeanPunctChar`, `isRocqPunctChar` and three
    block-comment scanners agree with the hand-written `char`-based Rust mirrors
    on every documented input. *Request:* a scalar character type mapped to
    `char` in Rust and to one-scalar strings elsewhere.
24. **Standard generic containers.** `Vec<…>` (179 items), `Option<…>` (36),
    `Result<…>` (20), `Arc<…>` (13), `HashSet<…>` (4), `BTreeMap<…>` (3) and
    `HashMap<…>` (1) are refused as generic types, although the Rust emitter
    itself writes `Vec<T>` and `Option<T>` for JavaScript arrays and optional
    values. *Request:* admit at least the container instances the Rust emitter
    emits, with their clone/ownership semantics stated in the archive, so a Rust
    source and a JavaScript-derived Rust target share one fragment.
25. **Multi-file programs.** `mod x;` stops with `out-of-line module: the
    program must be a single file` (105 items, 77 in a dependency, because
    `rust/src/lib.rs` declares every module). Imported JavaScript names are
    `unknown name` (18 items) and Rust names from other modules are `unknown
    type` / `unknown name` (11). *Request:* a program input of several files (a
    module map), or typed external signatures for imports recorded as explicit
    assumptions in the archive.
26. **Regular expressions.** 133 JavaScript items are first refused at a
    regular-expression literal. *Request:* a declared portable dialect (no
    backreferences or lookbehind) with a stated matching semantics, emitted as a
    generated matcher where a target has no standard regular-expression library.
27. **Named function values and nested functions.** 118 JavaScript items use a
    named function as data (dispatch tables such as `const PARSERS = { rust:
    parseRust }`), 57 reach a nested `function` statement (56 of them in a
    dependency), and Rust closures are refused (2). *Request:* non-capturing
    function references as values (function pointers in Rust) and lambda
    lifting of nested functions whose captures are passed explicitly.
28. **An error model.** Computed error messages (54 items), `throw new RmlError`
    / `ControlFlowError` / `SyntaxError` (33), `new Error` used as a value (14),
    throwing a non-error (11) and `try` statements (23) are refused; only
    `throw new Error('literal')` aborts. *Request:* aborts with computed string
    messages, user error types as tagged data, and `try`/`catch` as a typed
    result match.
29. **Inferred signatures must be visible and not defaulted silently.**
    50 items need an explicit data type for a recursive inferred type and 26
    use one value at two inferred types. Conversely, two admitted functions are
    certified for a type they are never called at: without call sites or JSDoc,
    `tokenBaseName` is inferred as `Option<f64> -> Option<f64>` (so the
    `typeof token !== 'string'` test makes the Rust target return `None` for
    every input) and `ruleKey` takes three `f64`s, while their hand-written Rust
    mirrors take `&str`. *Request:* record every defaulted or inferred parameter
    type as an explicit assumption in the archive (RML would surface it in the
    certificate's `types` dimension), accept JSDoc or a sidecar signature, and
    refuse rather than default a parameter that is only constrained by `typeof`.
30. **JavaScript standard-library priorities** (refines request 11). First
    refusals by function: `JSON.stringify` 35, `new TextEncoder` 26, `Number` 19,
    `Object.prototype.hasOwnProperty.call` 10, `BigInt` 4,
    `Array.from` 4, `Object.is` 3, `new Uint8Array` 3, `new WeakSet` 3,
    `JSON.parse` 2, `new TextDecoder` 2, `Symbol` 2, `Array` 2,
    `Object.keys` 1, `Object.entries` 1. *Request:* cover them in this order in
    the linked standard-library profile, each with its semantics or an explicit
    obligation.
31. **Frozen literal tables.** `Object.freeze` over arrays and records of strings
    (23 items) and frozen arrays whose positions are not scalar `Copy` values
    (15) are refused, although they are immutable module constants. *Request:*
    admit frozen literal arrays and records of strings and of other frozen
    literals as immutable constants.
32. **Destructuring and variadic forms.** Destructured parameters (30 items),
    several declarators in one `const` (9), `let` destructuring, array rest
    bindings (1 each), rest parameters (4) and spread arguments (6) are refused.
    *Request:* desugar them in the frontend into named parameters, projections
    and fixed-arity calls.
33. **Counter mutation.** `++`/`--` (18 JavaScript items), Rust `let mut` (6),
    `&mut` (17) and `mut` parameters (1) are refused, yet JavaScript `let` with
    reassignment in a loop is admitted and the Rust emitter writes `mut` loop
    parameters itself. *Request:* desugar `x++`, `x--` and Rust local `mut`
    counters to the same loop-state form the admitted reassignment path uses.
34. **Rust macros and trait syntax that parse to precise refusals.**
    `matches!` reads pattern alternatives `A | B` as the bitwise operator
    (`operator |`, 8 items) and stops on guards (`expected ) in matches! but
    found "if"`, 4); `impl Into<…>` / `impl IntoIterator<…>` parameters (7) and
    `Box<dyn …>` (2) are syntax errors; `#[derive(Default)]` is refused (38);
    `include_str!` (6) and `json!` (1) are refused or misparsed. *Request:* parse
    `matches!` as a match with alternatives and guards, parse `impl Trait` and
    `dyn Trait` types into named refusals (request 12), and admit
    `#[derive(Default)]` on an enum with a `#[default]` variant as a constructor.
35. **UTF-16 string operations in the Lean and Rocq emitters.** Of the
    JavaScript items that translate to Rust, the Lean emitter refuses 17 and the
    Rocq emitter 18: 16 each because `.slice()` (5), `.codePointAt()` (4),
    `.split()` (3), `.repeat()` (2), `.indexOf()` (1) and `.replaceAll()` (1) on
    strings need a UTF-16 operational encoding, one each for a mutable
    structural value without a target state model, and one more in Rocq for a
    code-point string iterator. *Request:* the UTF-16 encoding and the iterator
    for both proof targets, so all three paths from JavaScript admit the same
    items.
36. **Lean and Rocq module headers.** At module granularity every `lib/` Lean
    and Rocq file is refused before its first declaration: Lean `import`
    (8 modules), `abbrev` (1) and `List` (1); Rocq `Require Import` (5),
    `Definition` without a result type (3) and `list` (1). *Request:* `Init` /
    `Stdlib` imports as declared assumptions, `abbrev` as a transparent
    definition, and inference of the result type of a definition whose body is
    a type.
37. **Item-level translation and stable refusal codes.** The bulk generator has
    to cut items out of each file, close them over same-file dependencies and
    derive aggregation keys from diagnostic text. *Request:* an upstream API
    that translates a module item by item (admission, dependency closure and
    first refusal per declaration), and a stable machine-readable code on every
    refusal so receipts can aggregate causes without parsing messages.
38. **Records, struct literals and field access in the frontends.** The PR
    #201 frontends refuse Rust named and tuple structs, struct variants,
    struct literals and field reads, Lean `structure` and Rocq `Record`.
    RML now lowers a bounded fragment itself (`js/src/rml-surface-lowering.mjs`,
    stage `rml-lowering`) into single-constructor inductives with generated
    accessors, and must refuse functional update (`..base`), out-of-order
    literals whose fields have effects, structure defaults, dependent record
    fields and field reads whose owner is ambiguous without type inference.
    *Request:* first-class product types in the typed program (declaration,
    literal, pattern, projection, update), with the field owner resolved by
    the checker so `x.f` needs no RML-side guess, and `let` struct
    destructuring.
39. **Generics with checked instantiation.** RML monomorphizes only explicit
    instantiations (Rust `f::<T>`, Lean and Rocq `(A : Type)` arguments), up
    to 64 copies, and refuses generic calls without explicit type arguments,
    trait bounds, lifetimes and universe-polymorphic binders. *Request:*
    parametric polymorphism in the typed program with checker-inferred
    instantiations (or an upstream monomorphization pass that records each
    instantiation), so certificates can name the instantiation the checker
    chose instead of one RML derived from the text.
40. **Termination evidence.** Certificates now carry a termination
    obligation per recursive function, discharged only by RML's own
    structural-decrease check agreeing with the archive; general and mutual
    recursion stay open. The checker and archive also disagree on Rust `u32`
    structural recursion (`rust-u32-structural-recursion`, refused at
    `archive-validation`). *Request:* the checker should emit its termination
    argument (decreasing parameter, or measure and well-founded relation) in
    the archive, and a `u32`/`Nat` archive encoding that agrees with the
    checker, so RML can check the argument instead of re-deriving it.
41. **Concept records for certificate vocabulary.** The certified concept
    space reuses 20 upstream concept records and mints 32 RML-local ones
    under `rml.` (obligation kinds, discharge rules, preservation dimensions,
    authority grants, lowering kinds) because no upstream record has the
    exact meaning; each carries `rml:*` source aliases. *Request:* upstream
    records (or an agreed namespace) for translation-certificate concepts,
    and source aliases for RML terms on the records RML already reuses, so
    the space can drop its local identities.
42. **Native construct trees that show aliased, extra and lookahead rules.**
    21 observable native-grammar rules can never appear in a construct tree
    (`language-constructs.json`, `refusalReceipts`): rules every reference
    renames (JavaScript `jsx_identifier`, `nested_identifier`,
    `decorator_member_expression`, `decorator_call_expression`; Rust
    `delimited_token_tree`, `scoped_type_identifier_in_expression_position`,
    `last_match_arm`), comment extras (see request 19), `word_characters`
    used only as a keyword-boundary lookahead, and rules no other rule
    references (Rust `comment`, Lean `do_try`/`do_catch`, Rocq `digit`,
    `hexadecimal_digit`). *Request:* record the source rule of an aliased
    node in the construct tree, mark lookahead-only and unreferenced rules as
    non-observable in `nativeGrammarRuleConcepts`, and either reach Lean
    `do_try`/`do_catch` from `do_element` or remove them, so `try … catch`
    inside `do` gets its dedicated construct.
