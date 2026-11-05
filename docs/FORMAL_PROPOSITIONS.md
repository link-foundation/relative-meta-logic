# Source-bound proposition formation

The additive proposition layer checks all eight retained Lean and Rocq
`NetworkEquivalence` definitions. Together with its independently rechecked
foundation dependencies, it covers **70 definitions and two conversion proofs**
out of the same 229-declaration corpus. Four upstream admissions and the two
pending generated record traits remain visible. Full-corpus completion is false.

`formal-propositions.lino` supplies ordinary linked rewrite rules for `Prop`,
same-typed equality, and universally quantified proposition formation. Equality
operands must infer the same normalized type, including vector indices. A false
equality is still a well-formed proposition; its formation never returns a proof.
For a universal, the linked checker checks the body as `Prop` under one fresh
arbitrary typed neutral and preserves its source body and lexical environment.
This is symbolic formation, not finite sampling or an extensional equality proof.

The additive JavaScript parser elaborates the actual retained source tokens.
Implicit `{n : Nat}` binders remain dependent parameters with explicit implicitness
metadata. Grouped Lean parameters shift their dependent annotations correctly.
For unannotated `∀ id` / `forall id`, an application occurrence supplies its actual
source function as a domain witness; the linked program derives its checked
function domain. There is no default `Nat` and no declaration-name dispatch.
All other occurrences must type-check under that domain. Missing or circular
domain evidence is rejected. General unification, arbitrary implicit-argument
insertion, extensionality and new proof tactics are outside this bounded layer.

`FormalPropositions.fromRml` accepts the canonical source and foundation plus
`core`, `indexed`, `records` and `propositions` kernel strings. It exposes
`coverage`, `verifyDefinition`, `verifyTheorem` and source/kernel-bound `replay`.
It uses the frozen foundation adapter only to produce syntax and rechecks every
dependency under the combined linked program. No inherited checked value enters
a later environment without being freshly checked. The standalone adapter leaves
earlier pinned code, reports, raw source bytes and historical checkpoints intact.

The shared corpus contains 88 requests: all 70 definition obligations, two
retained proofs, and 16 mutations of actual upstream source bytes. Mutation
controls re-extract fresh canonical source and dependency links from disposable
raw-source copies. Twelve invalid obligations are rejected: wrong implicit index
type, wrong declared result, mismatched equality types, non-proposition universal
body, wrong universal domain, and mismatched dependent indices, in both languages.
Four controls remain correctly well formed: unequal closed naturals and fresh
declaration names, in both languages. Source fingerprints and module digests
distinguish these reauthorized controls from the retained original corpus.

JavaScript and Rust independently execute all 88 requests through their linked
reducers and rebuild their environments only from earlier checked results. The
source elaborator is currently JavaScript; Rust replay is an independent semantic
check of the resulting shared obligations, not an independent Lean/Rocq parser.
Additional primitive tests check `Bool` quantifier-domain inference, dependent
index rejection, malformed universal bodies, false equality versus reflexivity,
and loss of acceptance when the proposition rule module is removed.

Regenerate or check the artifact with the cache lifecycle wrapper:

```sh
node scripts/run-with-cache.mjs -- node scripts/generate-formal-propositions.mjs --check
node scripts/run-with-cache.mjs -- node --test js/tests/formal-propositions*.test.mjs scripts/formal-propositions.test.mjs
node scripts/run-with-cache.mjs -- cargo test --manifest-path rust/Cargo.toml --test formal_propositions_tests
```

This is an additive bounded native RML capability. Native Lean/Rocq builds do not
authorize it, and these tests do not establish all-corpus proof-assistant parity,
universal proposition truth, or a complete self-hosting/minimality result.
