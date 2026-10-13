# Certified four-language translation through RML links

This extends the [portable natural-number fragment](portable-natural-translation.md)
to a much wider checked core and makes every translation **provable in RML's own
terms**: each one emits a translation certificate written as Links that the RML
checker re-derives and checks without consulting a Lean or Rocq kernel. It
advances R66 and R106–R109 and implements the R165–R168 practices. It does
**not** complete full-language JavaScript, Rust, Lean or Rocq translation; the
gaps are listed at the end and in the
[draft upstream requests](meta-language-upstream-requests.md).

## Pipeline

```
original source (byte-exact, sha256, UTF-16 and UTF-8 spans)
  -> vendored meta-language PR #201 frontend   (parseJavaScript | parseRust | parseLean | parseRocq)
  -> vendored checker                           (checkProgram: types, bindings, match coverage)
  -> source-free typed program links            (encodeTypedProgramLinks; no source text, no envelope)
  -> registered RML structure network           (rml:structure:1; Links text identical to the archive)
  -> decode + validate + recheck from the RML network only
  -> vendored target emitter                    (emitJavaScript | emitRust | emitLean | emitRocq)
  -> target source + translation certificate (Links) | first-refusal receipt (Links)
```

Implementation: [`js/src/rml-certified-translation.mjs`](../../../js/src/rml-certified-translation.mjs).
The vendored code is reached through the `#meta-language-pr201/*` import; see
[VENDORED.md](../../../js/vendor/meta-language-pr201/VENDORED.md) for the exact
upstream commit, file lock, license, shims and removal criteria.

The RML structure network is the authoritative intermediate. `exportCertifiedIntermediate`
writes it as Links text, `importCertifiedIntermediate` rebuilds it, and
`decodeCertifiedIntermediate` decodes the typed program from the RML network
alone; the vendored validator then rechecks types, bindings, constructor
identities and match coverage before any emission. Tests regenerate every
committed target from the committed `intermediate.lino` without the source, and
apply a real `SubstitutionRule` to a literal link in the RML network: the RML
observation and the emitted JavaScript change from `42` to `100`, and the edited
network no longer matches the certified intermediate hash.

## Admitted constructs

Wider than the natural-number fragment, as exercised by the eight corpus programs:

| Area | Covered in the corpus |
| --- | --- |
| Records / inductives | Lean `inductive`, Rocq `Inductive`, Rust `enum` with tuple variants and `Box` recursion, JavaScript JSDoc tagged-union records |
| Pattern matching | Lean equation compiler and `match`, Rocq `match` including nested constructor patterns, Rust `match` with wildcards, JavaScript `switch` and tag tests |
| Recursion | structural recursion over lists, trees and expression trees; general recursion (`gcd`) with checked arithmetic |
| Modules | Lean `namespace`, Rocq `Module`, Rust `mod` with `use crate::…`, JavaScript object-literal namespaces |
| Numbers and text | unbounded `Nat`/`Int`/`N`/`Z`/BigInt, checked `i64`/`u64`, binary64 Numbers, strings |
| Effects | ordered printing, `assert!`/`assert_eq!`/`node:assert`, checked-overflow and assertion aborts |
| Proofs | closed theorems (`by decide`, `reflexivity`) and universal theorems (`by simp`, `intros; lia`) as obligations |

Simple parametric polymorphism is **not** genuinely achievable with the pinned
upstream core: Lean implicit binders, Rust generics, JavaScript functions used at
two types and parameterised inductives are refused by the vendored frontends, and
RML records precise refusal receipts instead of inventing a monomorphization
(draft upstream request 9).

## Translation certificate

`translateCertified(source, from, to)` returns the target and a certificate
`rml:translation-certificate:1` serialized canonically as Links:

- `translator`: upstream repository, PR, exact commit and the sha256 of the
  vendored file lock;
- `source`: language, sha256, UTF-8 bytes and UTF-16 length of the exact source;
- `intermediate`: schema, schema version, source language recorded *inside* the
  typed program, root link, link count and sha256 of the RML network's Links text;
- `target`: language, sha256 and bytes;
- `correspondence`: every mapped declaration, constructor and theorem with its
  kind, source and target names, checked signature, UTF-16 span, UTF-8 byte span
  and the sha256 of the exact source span;
- `preservation`: exactly seven dimensions — behavior, effects, ownership,
  types, universes, assumptions and proof obligations — each with a status from
  a fixed vocabulary and a statement;
- `assumptions` and `encodings` reported by the emitter;
- `observation`: the lines `main` prints as RML itself evaluates the certified
  intermediate (`CertifiedEvaluator`, with fuel and depth bounds), their sha256,
  and an abort reason when the program aborts;
- `obligations`: every theorem and assertion, every emitter assumption and the
  `emitter-faithfulness` trust obligation, each with `closed`, `status`
  (`discharged`, `open`, `assumed`, `refuted`) and `by`;
- `verdict`: counts per status; `losses`: dropped trivia and every renaming;
- `authority`: `macros none`, `traits none`, `runtime none`,
  `external-kernels oracle-only`, `proof-authority rml`;
- `digest`: sha256 of the canonical body.

### What RML discharges, and what it does not

- A **closed** theorem (no binders) is discharged only by RML evaluating its
  proposition over the certified intermediate (`by rml-evaluation`). A false one
  is `refuted`, never discharged.
- A main **assertion** is discharged by RML's own run of `main`.
- A **universal** theorem stays `open`. For Lean/Rocq targets its `by` is
  `target-kernel-oracle`; for JavaScript/Rust it is
  `bounded-runtime-check-not-proof`. Neither is ever counted as an RML proof.
- `emitter-faithfulness` is always `open` with `by native-oracle-ci`: the
  vendored frontends and emitters are trusted host code, and CI native runs are
  validation evidence, not proof.

## RML checker

`checkTranslationCertificate(certificate, { source, target })` parses the
certificate through the RML structure network and re-derives every section from
the preserved source. It rejects with stable codes:

| Code | Example rejected in tests |
| --- | --- |
| `RML_CERT_DIGEST` | a body edit that keeps the old digest |
| `RML_CERT_OBLIGATION_FORGED` | an open universal theorem relabelled `discharged` by `rml-evaluation`; the trust obligation marked discharged |
| `RML_CERT_OBLIGATION_DROPPED` | a removed theorem obligation |
| `RML_CERT_SOURCE_HASH`, `RML_CERT_OBSERVATION` | a stale certificate after a source edit (the re-derived observation changes from 42 to 43) |
| `RML_CERT_TARGET_HASH` | a certificate paired with another program's target |
| `RML_CERT_SOURCE_HASH`, `RML_CERT_CORRESPONDENCE` | a certificate checked against a different source program |
| `RML_CERT_SOURCE_LANGUAGE` | a Lean source relabelled as Rocq |
| `RML_CERT_TARGET_REGENERATION` | a target-language relabel |
| `RML_CERT_AUTHORITY`, `RML_CERT_TRANSLATOR` | a granted trait authority; a stale translator lock hash |
| `RML_CERT_PRESERVATION`, `RML_CERT_CORRESPONDENCE`, `RML_CERT_LOSSES` | a dropped dimension, a renamed correspondence target, a hidden loss |
| `RML_CERT_SCHEMA`, `RML_CERT_SYNTAX` | non-certificates and malformed Links |

The Rust mirror, [`rust/src/certified_translation.rs`](../../../rust/src/certified_translation.rs),
re-serializes the same Links byte for byte and checks the integrity layer that
does not need re-import: digest, authority, translator pin, source/target/
intermediate hashes, every correspondence span hash, the seven dimensions, the
observation digest, the discharge rules (oracle results must stay open; a
discharge must be a closed `rml-evaluation`) and verdict counts. It is written by
hand and compiled only in CI. Because the PR #201 frontends exist only in
JavaScript, the Rust mirror cannot re-derive the observation or detect a
relabel that also rewrites the digest; the JavaScript checker does.

## First-refusal receipts

Unsupported input returns `status: 'refused'`, `targetSource: null`, the exact
`preservedSource` and a `rml:translation-refusal:1` receipt: the source
fingerprint, the requested target (`not-emitted`), the stage
(`frontend`, `checker`, `archive-validation` or `emitter`), the first diagnostic
with its kind, message, UTF-16 and UTF-8 spans and the span's sha256, the
retained-source hash, the `whole-program` loss and the authority block.
`checkTranslationRefusal` re-derives the receipt and rejects a stale or tampered
one. Eleven refusal sources cover classes, polymorphic use, axioms, implicit
binders, type classes, `Admitted`, `Record`, generics, `macro_rules!`, traits,
and the upstream checker/archive disagreement on `u32` recursion.

## Bulk production, receipts and freshness

`node scripts/generate-certified-translations.mjs` translates the corpus in bulk:
8 programs × 3 targets = **24 certified translations covering all 12 directed
paths**, 8 intermediate archives, and 11 refusal sources × 3 targets = 33
receipts, plus a producer receipt (`generated/receipt.lino`) with the translator
pin, implementation hashes, input fingerprints, every output hash and the
reconstruction recipe. `--check` regenerates in memory and rejects stale,
missing or unexpected files; it requires no compiler, kernel, network or install.

Hand-written expectations in [`test-corpus/certified-translation/cases.json`](../../../test-corpus/certified-translation/cases.json)
are independent of the RML evaluator and emitters. The JavaScript sources are also
run natively by Node as an independent oracle in the JavaScript tests.

## Native validity (CI only)

[`scripts/check-certified-translation-native.mjs`](../../../scripts/check-certified-translation-native.mjs)
runs every committed target with Node, rustc (edition 2024), `lean --run`
(Lean 4.34.1) or `rocq compile` (stable Rocq 9.3.0 in the digest-pinned image)
and requires the printed lines to equal both the certificate observation and the
hand-written expectation. It also requires each toolchain to reject a false
statement appended to a real target. The
[`translation-native`](../../../.github/workflows/translation-native.yml)
workflow runs it together with the existing portable-natural oracles
(`scripts/check-portable-native.mjs`), which had previously only been run
manually. Locally only the JavaScript part may be run
(`--languages=JavaScript`), and it passed for all six JavaScript targets.

## Practices followed

- **link-assistant/router PR #761** (`tools/translation/README.md`, issue 759
  case study): pinned, hash-checked copied upstream code with extensions outside
  the vendor directory; original source preserved with exact spans and hashes;
  checked semantic intermediate serialized and reparsed before emission;
  first-refusal diagnostics that keep the exact source and supply no stub;
  producer receipts with fingerprints and a regeneration recipe; a `--check`
  freshness gate; JavaScript-first local gates with Rust compiled only in CI;
  no implicit macro, trait or runtime authority.
- **link-foundation/meta-language PR #201** (`docs/vision.md`): source-free
  typed program archives as Links, checked immutable products and algebraic
  data, binding and constructor identities that survive reload, Links
  Notation fixtures, the Rust ↔ links ↔ JavaScript path (here widened to Lean
  and Rocq), and "a finite property check is never counted as a general proof,
  and external kernel authority is never imported into RML".

## Verification commands

```sh
cd js && node --test tests/certified-translation.test.mjs     # 69 tests
node scripts/generate-certified-translations.mjs --check
node scripts/check-certified-translation-native.mjs --languages=JavaScript --require=JavaScript
# CI only:
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test certified_translation_tests
node scripts/check-certified-translation-native.mjs --require=JavaScript,Rust,Lean,Rocq
```

## Not delivered

- Full-language translation: polymorphism, records/structures, traits/type
  classes, macros, effects beyond printing and assertions, mutation, ownership
  beyond the immutable value model, imports of external libraries and proof
  terms all remain refusals or open obligations.
- Universal theorems are not proved by RML; behavioral equivalence is certified
  for the observed `main` of each program, not for all inputs.
- The vendored frontends and emitters remain trusted host code
  (`emitter-faithfulness` stays open); native runs validate but do not prove it.
- The Rust mirror checks integrity only until the meta-language crate ships the
  typed-program decoder and frontends (upstream requests 5–6).
- Emitted targets cannot yet be re-imported through the frontends because of the
  emitter runtime preludes (upstream request 14), so target → links regeneration
  is checked from the certified intermediate rather than from the target text.
