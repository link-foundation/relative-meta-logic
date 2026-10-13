# Native execution, stage map and proof certificates for the upstream corpus

This layer applies RML's own linked execution and linked proof verification to
the pinned upstream 0.0.3 meta-theory corpus
([`upstream-0.0.3.lino`](../lib/meta-theory/upstream-0.0.3.lino)). It complements
the typed layers ([FORMAL_SEMANTICS](FORMAL_SEMANTICS.md),
[FORMAL_FOUNDATION](FORMAL_FOUNDATION.md), [FORMAL_PROPOSITIONS](FORMAL_PROPOSITIONS.md)).
Those layers type-check definitions; this one runs them and checks proofs. It
does not ask Lean or Rocq for anything.

| Stage | Result | Evidence |
| --- | --- | --- |
| Native elaboration | 229 of 229 declarations; all 197 commands | `test-corpus/meta-theory-native/coverage.json` |
| Dependency check | 229 exact: elaborated references equal recorded links | same |
| Evaluation commands | 90 of 90 reach values; 52 of 52 source comments agree; 84 Lean/Rocq pairs agree | `test-corpus/meta-theory-native/cases.json` |
| Execution witnesses | 183 declarations: 150 needed by an upstream case, 33 by a probe on upstream data (ablation) | same |
| Proof certificates | 17 of 36 theorems certified; 5 with closed chains; 19 outside the fragment | `test-corpus/meta-theory-certificates/certificates.json` |
| Stage map | every declaration and command, all stages | `test-corpus/meta-theory-coverage/map.json` |

## Native linked definitions

`MetaTheoryNative` lives in `js/src/rml-meta-theory-native.mjs`. It reads each
declaration's preserved signature, body and proof tokens. Every global name
resolves against that declaration's recorded dependency links. The output is
ordinary `linked-rewrite` rules:

- pattern matches become constructor decision trees;
- lambdas become closures;
- implicit parameters that a body actually uses become explicit parameters,
  inferred at call sites by unification against the expected type;
- Prop-valued definitions over finite data become boolean decision procedures;
- an unbounded quantifier stays statement data, with no execution rule.

Source builtins map explicitly to the inspectable call-by-value prelude
[`meta-theory-native-prelude.lino`](../lib/meta-theory/meta-theory-native-prelude.lino).

Naturals are canonical little-endian binary links (`mt-zero`, `(mt-b0 n)`,
`(mt-b1 n)`). Source patterns `0` and `n+1` inspect a natural through the
prelude's `mt-nat-view`. Values are tagged `(mt-v RAW)`, and a builder fires
only on finished arguments, so a duplicated variable never duplicates work.
All 90 commands finish in milliseconds on the unchanged generic reducer. No
declaration name selects host behaviour.

`scripts/generate-meta-theory-native.mjs` writes three files:

- the program, [`upstream-0.0.3-native.lino`](../lib/meta-theory/upstream-0.0.3-native.lino);
- a conversion program,
  [`upstream-0.0.3-native-conversion.lino`](../lib/meta-theory/upstream-0.0.3-native-conversion.lino),
  which restates each non-recursive definition as a by-name unfolding rule;
- the shared cases and coverage.

Every `#eval`/`Compute` command runs natively. Its value is compared with
the number sequence stated in the upstream source comment ("Ожидается
результат") and with the counterpart command in the other language. Six
`SequenceDefinitions` pairs differ honestly: Lean returns `Option (List Nat)`
where Rocq returns `list nat`. `#check`/`Check` commands normalize their
target. Import, open, namespace and notation commands are resolved against the
corpus.

A declaration counts as *executed* only with an **ablation witness**:

- a case that reaches a value on the program sliced to its static closure
  (each declaration is one `# ADDRESS` section);
- the same case that no longer reaches that value once the declaration's own
  rules are removed from the slice.

A definition that sits in a closure but is never needed, such as a branch that
is not taken, gets no witness from upstream cases. 150 declarations have one.

For the definitions that no upstream case needs, the generator runs **probes**.
A probe applies the definition to data values that upstream cases of the same
language produced, or to their parts. It tries argument tuples in size order
and keeps the first that reaches a value. Decision trees get stuck on data of
the wrong shape, so a value means every match succeeded. Probes are untyped:
the smallest reaching tuple is often the empty list, so a probe usually
exercises only base-case rules. A type-level definition such as `Link` can
also accept an argument its source type would reject. A probe case is
validated like any other case, and its ablation witness is checked the same
way. The counterpart definition in the other language runs on the same data
with the addresses translated. 33 definitions gain a probe witness, and all 28
probes with a counterpart of the same arity agree with it.

That leaves 46 declarations without a witness. 36 are theorems, whose
statements are normalized and whose proofs are certified separately. The other
10 are `DupletFunctionEquivalence`, `TupleFunctionEquivalence`, `InSetTree`,
`IsSubsetTree` and `IsValidSetTree` in both languages. No argument tuple
within the probe bounds reaches a value for them. The two equivalences take
functions, which the probe pool does not contain. The researcher recipe below runs
`IsOrderedUniqueSequence` and its callee `StrictlyAscending` on new, non-empty
data.

`scripts/generate-meta-theory-native.mjs` exports `validateNativeEvidence`. It
re-executes every case on the whole program and on its slice, and every
witness by ablation. Corrupted bodies, a corrupted prelude, edited results or
step counts, forged, unreachable or relabelled witnesses, and a probe
rewritten to data of the wrong shape are rejected
(`scripts/meta-theory-native.test.mjs`). In Rust, `rml::meta_theory_native`
mirrors loading, binary naturals, compaction, slicing, execution and ablation.
`rust/tests/meta_theory_native_tests.rs` re-runs every case and witness, plus
the same mutations.

## Proof certificates

`js/src/rml-meta-theory-certificates.mjs` produces certificates for the
existing [linked proof verifier](LINKED_PROOF_VERIFICATION.md). The **producer**
elaborates the preserved source proof and is untrusted. It supports:

- Lean: term-mode lemma application with `_` holes, anonymous constructors and
  `fun`, and `by intro … / exact … / rfl`;
- Rocq: `intro(s)`, `unfold`, `simpl`, `apply`, `exact`, `exists`, `split`,
  `reflexivity`, and conjunction `destruct H as [A B]`;
- list induction: Lean `induction l with | nil => … | cons x rest ih => …`
  and Rocq `induction l as [ | h t IH ]`;
- Rocq case analysis on a list, `destruct l as [ | h t ]`. Each branch gets
  a local equation `l = nil` or `l = cons h t`, and every hypothesis that
  mentions `l` is rewritten through it with a checked `rewrite` rule. A
  user-written `rewrite` or `rw` tactic stays outside the fragment.

The **checker** (`checkMetaTheoryCertificate`; Rust
`rml::meta_theory_certificates::check_meta_theory_certificate`) trusts none
of the certificate's logical content. It:

1. recomputes the theorem statement with the native program, and generalizes
   it into fresh eigen-constants and hypothesis rules;
2. offers lemma rules only for theorems among the recorded dependency links.
   Each lemma rule is rebuilt from that lemma's own native statement, with
   inert `(instance LEMMA BINDER TERM)` premises binding its data binders;
3. validates every instance rule the certificate adds:
   - conversions: both sides must have the same normal form under the
     conversion program;
   - `forall-intro`: the eigen-constant must be fresh, absent from the goal
     and the hypotheses;
   - `exists-intro`: the premise must be the body with the witness substituted;
   - `local`: a hypothesis open only inside one branch. Each local must be
     discharged by exactly one `induction` or `cases` rule and must state
     what that rule assumes;
   - `induction`: the target must be a list-typed eigen-constant. The
     premises must be the base case and the step case of the motive, with the
     induction hypothesis discharged. The head and tail must be fresh,
     distinct names;
   - `cases`: the premises must be the two discharged equations
     `target = nil` and `target = cons y ys`;
   - `rewrite`: the side condition must restate the rewrite as a
     `congruent` claim;
4. runs `proof-verifier-natural.lino`. It extends `proof-verifier.lino`
   (rules, premises, bindings, conclusions, dependency order, reachability)
   with linked rules for discharge, local closure and the congruence side
   condition of a rewrite. So the verifier, not the host, checks that a
   rewrite replaces only equal subterms and that no local stays open at the
   root;
5. after acceptance, checks that no eigen-constant escapes through an
   undischarged local.

The certified theorems are:

- in both languages: `meta_network_is_duplet_network`,
  `meta_reference_space_elements_valid`, `ListToSet_elements_valid`,
  `ListToSet_membership`, `ordered_unique_has_no_dup`,
  `set_sequence_equivalence` and `toOrderedUnique_is_ascending` (list
  induction);
- in Rocq only: `strictly_ascending_cons`, `strictly_ascending_head` and
  `strictly_ascending_tail` (case analysis with rewrites).

A certificate is *relative* to every lemma it cites that is not itself
certified. The record lists those lemmas and their upstream status. For
example, Lean `set_sequence_equivalence` is relative to the admitted
(`sorry`) `mem_toOrderedUnique` and, through the now certified
`toOrderedUnique_is_ascending`, to the admitted
`insertSorted_preserves_ascending`. Five chains are closed: both
`meta_network_is_duplet_network` and Rocq `strictly_ascending_cons`,
`strictly_ascending_head` and `strictly_ascending_tail`.

The 19 uncertified theorems are reported with their exact reason. An
admitted proof is never certified.

| Theorem | Language | Reason recorded |
| --- | --- | --- |
| `ReferenceListDimensionPreserved` | Lean | induction other than list induction with `nil` and `cons` arms |
| `ReferenceListToTupleOfReferencesInverse` | Lean | tactic `congr` |
| `TupleFunctionEquivalenceAfterTransforms` | Lean | tactic `rw` |
| `TupleOfReferencesDimensionPreserved` | Lean | `simp` does not close the goal by conversion |
| `insertSorted_preserves_ascending`, `mem_insertSorted`, `mem_toOrderedUnique`, `strictly_ascending_implies_no_dup` | Lean | admitted `sorry` |
| `ReferenceListDimensionPreserved`, `insertSorted_preserves_ascending` | Rocq | tactic sequencing with `;` |
| `ReferenceListToTupleOfReferencesInverse`, `TupleOfReferencesDimensionPreserved` | Rocq | induction other than `induction l as [ \| h t IH ]` |
| `TupleFunctionEquivalenceAfterTransforms` | Rocq | tactic `rewrite` |
| `insertSorted_head_cases`, `insertSorted_non_empty` | Rocq | `destruct` other than a conjunction hypothesis |
| `mem_insertSorted` | Rocq | goal is not a conjunction (`mt-and`) |
| `mem_toOrderedUnique` | Rocq | tactic `tauto` |
| `strictly_ascending_all_greater` | Rocq | induction target is not a list-typed eigen-constant |
| `strictly_ascending_implies_no_dup` | Rocq | tactic `auto` |

Mutations are rejected in both runtimes:

- body: a changed definitional unfolding;
- binder: a changed eigen-constant or instance binder;
- premise: a removed premise;
- proof: a substituted lemma rule, or a source proof citing the wrong lemma;
- conclusion: an edited node conclusion or goal;
- statement: an edited statement;
- conversion: a forged conversion;
- dependency: an undeclared or self citation, or an edited dependency list;
- local: a missing, ownerless, misstated or doubly discharged local;
- induction: a wrong motive, a mistyped target, or stale or shared
  eigen-constants;
- rewrite: a forged rewrite (the linked congruence side condition fails) or a
  side condition that does not restate the rewrite;
- scope: an eigen-constant escaping through an undischarged local.

The tests are `scripts/meta-theory-certificates.test.mjs` and
`rust/tests/meta_theory_certificates_tests.rs`.

## Stage map

`scripts/generate-meta-theory-map.mjs` writes
[`map.json`](../test-corpus/meta-theory-coverage/map.json). It has one row per
declaration with these columns:

- preservation: syntax range and token fingerprint;
- typed elaboration: the formal-propositions status and its accepted case;
- native elaboration;
- dependency check;
- native execution: ablation witness, normalized statement, or not witnessed;
- proof certificate;
- admission: upstream, typed layer, and certificate chain.

It also has one row per command: preservation, elaboration, and the execution
or resolution witness.

`validateMetaTheoryMap` rejects:

- unmapped, unknown or duplicated items;
- token partition gaps or overlaps (declarations and commands must tile every
  module exactly);
- changed fingerprints and stale counts;
- any claimed stage whose evidence is missing or disagrees.

With `{ reexecute: true }` it also re-executes every native case and witness
and re-checks every certificate. `rust/tests/meta_theory_map_tests.rs` repeats
the completeness, partition, fingerprint, count and evidence checks against
the Rust-parsed corpus.

## Commands

```sh
node scripts/generate-meta-theory-native.mjs [--check]
node scripts/generate-meta-theory-certificates.mjs [--check]
node scripts/generate-meta-theory-map.mjs [--check]
node --test scripts/meta-theory-native.test.mjs scripts/meta-theory-certificates.test.mjs scripts/meta-theory-map.test.mjs
node --test js/tests/meta-theory-workflow.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test meta_theory_native_tests --test meta_theory_certificates_tests --test meta_theory_map_tests --test meta_theory_workflow_tests   # hosted CI only
```

## Boundaries

- The native semantics is untyped call-by-value execution. Typing remains the
  separate typed layers, and typed elaboration still covers 72 declarations.
- Execution witnesses show that a declaration's rules are necessary for an
  observed value. They are not a proof of the declaration's specification.
- The shared source parser and proof producer are JavaScript, as for the
  typed layers. Rust re-checks all generated evidence independently.
- Certificates cover a first-order fragment extended with list induction,
  list case analysis and the rewrites those case equations need. The 19
  theorems listed above remain outside it, so R63/R122/R123 completion is not
  claimed.
