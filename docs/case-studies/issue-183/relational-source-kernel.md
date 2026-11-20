# Source-defined Horn candidate

This candidate executes the unchanged linked-program workload through a
first-order relational foundation. It does not compile to lambda terms or
S/K and does not invoke those evaluators. Its transition is first-order Horn
resolution over named clauses; substitution and proof search are relational.

Unlike the earlier `horn-relational` control, the candidate does not implement
RML matching, substitution, rule selection/traversal, import/rebinding, fact
normalization, inference generation, duplicate checking or proof lookup in
its host resolver. Those mechanisms are authored in
`lib/meta-theory/relational-kernel.lino`. The JavaScript and Rust generic
resolvers never recognize their predicate names.

## Authoritative paths

- `js/src/rml-horn-resolution.mjs` and `rust/relational-kernel/src/horn_resolution.rs`: generic
  finite-tree unification, fresh clause scopes, depth-first SLD search and
  independent derivation checking.
- `js/src/rml-relational-kernel.mjs` and `rust/relational-kernel/src/relational_kernel.rs`:
  declared input/output codecs and public call orchestration.
- `relational-kernel.lino`: upper semantics; a quoted Horn interpreter with
  its own unifier, occurs check, variable lookup, fresh scopes, clause
  selection and proof replay; source description/generation relations.
- `test-corpus/relational-kernel`: one shared upper workload and expected
  reductions, judgements and complete proof trees.

Direct execution runs the authored clauses on the generic resolver. Selecting
`selfInterpret` / `self_interpret` instead runs those requests through the
quoted interpreter and the complete actual clause image. This is an execution
mode of the separate candidate API. The stable linked-program registry and
its default execution basis are unchanged.

The public codecs retain the host parsing/validation and question-mark
pattern convention. These are explicit trusted services, not evidence that
all RML syntax or compilation is Link-defined.

## Mechanism replacement

Replacing `substitute-head` in the source reverses recursive list substitution:
`(input value)` changes from `(pair (nested value) done)` to
`(done (value nested) pair)`. The upper rewrite, generic host, other live kernel
instances and input stay unchanged. Both runtimes check this and reject an
old-context derivation checked against the changed clauses.

The quoted interpreter's occurs-check decision is also replaceable through
`meta-bind-cycle`. A finite encoded cyclic-binding request changes its answer
when that clause is changed, while the host unifier remains unchanged. This
distinguishes the source-defined meta-unifier from the retained external
unification boundary; it does not remove that boundary.

## Self-description, generation and replay

The source describes its actual clause image, regenerates it through linked
relations, checks exact image equality, and executes the generated image.
The quoted interpreter is generic over that image, including clauses defining
its own matching, unification, freshening and control relations.

Generic resolution certificates include the selected clause, instantiated
goal and every premise. An independent checker replays those choices without
search and rejects changed roots, names, goals, premise counts and contexts.
The quoted interpreter additionally has source-defined proof projection and
replay. Interned proof codes are accompanied by the exact source digest and
atom dictionary; the checker uses an independently supplied source and goal.
A certificate cannot choose a different dictionary or source.

Value-only self-interpretation avoids unfolding repeated large input contexts
into engine certificates. Full source certificates are explicitly selectable;
the common observations still include the complete RML proof trees. No absent
certificate is reported as independently replayed.

## Individual external laws and trust boundary

The implementation has four separately removable operation groups. They must
not be described as four independently minimal primitives. In particular,
`horn-unify` contains the following distinct rules and services:

1. Follow the current binding of a variable; leave an unbound variable free.
2. Equal atom/variable identities impose no new constraint.
3. Unify corresponding children of equal-arity list constructors; reject
   unequal atoms, constructor kinds or arities.
4. Orient an equation with a free variable and bind it to the other term.
5. Reject a binding when that variable occurs in the dereferenced term.
6. Extend the environment consistently and undo branch-local extensions on
   backtracking.

Separate resolution authority standardizes every selected clause apart,
unifies its head with the leftmost goal, replaces that goal with its ordered
premises, and explores remaining source clauses after failure. It projects
answers using the resulting substitution. Source order and depth-first search
are external operational choices; this is not a fairness proof for an
infinite search.

Reflexivity, symmetric orientation and constructor decomposition are familiar
parts of an MGU algorithm, not independently established primitive axioms.
Projection and predicate/arity indexing also include representational or
administrative work. The removal tests establish implementation dependency;
they do not eliminate these distinctions or prove an independent minimal
basis. A fair comparison may not compare one grouped MGU service with one
S/K contraction as equal units of semantic information.

The remaining boundary includes finite-tree and string/list representation,
LiNo parsing and schema checks, question-mark elaboration, UTF-8/bit codecs,
atom interning, bounds, allocation, runtimes/toolchains, the operating system
and physical processor. Atom interning is an injective, per-call renaming;
its dictionary is part of certificate context. The generic ground-term
shortcut normalizes already-bound children before storing immutable values.
It does not cache mutable user input or assume that an unbound variable is
ground. Alias, cycle, backtracking, input-mutation and replay regressions cover
that optimization.

The source-defined unifier uses binary scope counters and persistent binary
tries. Their traversal and update laws are in the linked source; there is no
host environment-trie callback.

## Claim limits

This is materially different from re-expressing the existing lambda program.
Nevertheless, neither ontology nor full R149 completion follows from its
execution. Individually minimized residual laws, sufficient evidence of a
comparably reduced minimal peer, intrinsic Link authority, and the complete
parser/compiler-to-processor closure remain separate obligations. R130,
R149 and R151 must not be marked complete from grouped-operation removal or
a small self-interpretation witness alone.

## Executed comparison and practical limits

The full common cohort is exercised by
`js/tests/relational-self-cohort.test.mjs` and
`actual_quoted_horn_image_preserves_the_entire_six_capability_workload` in the
Rust integration suite. Each checks six reductions, imported facts, two
inferences, exhaustion, a missing judgement and the complete resulting proof
tree. `relational-replacement-self` tests additionally replace recursive
substitution and the linked occurs-check decision during quoted execution.
`relational-receipts` tests replay both JavaScript-produced and Rust-produced
certificates in each runtime.

The initial naive quoted interpreter hit the ordinary JavaScript heap limit
on larger queries. That failure is not a passing closure result. The repaired
engine conservatively discriminates clause heads, gives clause variables
owned cells, trails only bindings that survive the next alternative, and
retains no generic derivation events when certificates were not requested.
The linked interpreter uses binary scope keys/tries and an injective atom
renaming for its source image. Alias/cycle, caller mutation, complete branch
answer enumeration, and independent replay regressions cover those changes.
Neither step budgets nor depth limits are advertised as byte-level heap limits.

Focused validation:

```sh
node scripts/run-with-cache.mjs -- node --test --test-concurrency=1 js/tests/relational-*.test.mjs
node scripts/run-with-cache.mjs --cache rust/relational-kernel/target --class rust -- cargo test --manifest-path rust/relational-kernel/Cargo.toml --all-targets --locked -j 2 -- --test-threads=1
```

The quoted cohort is intentionally a longer test. It is not ignored, skipped,
or replaced by a claimed capability count. `experiments/relational-kernel`
contains the executable comparison, quoted cohort, and certificate producer.
`test-corpus/relational-kernel/host-laws.json` records every declared law group,
including derivable/administrative components and the remaining minimality gap.

All boundary decoders check constructor tags and arities. The interned-atom
decoder also rejects empty and leading-zero codes outside its canonical image;
malformed replacement-source outputs have mirrored negative tests.


Inference scheduling rotates a successful rule behind the remaining and
previously skipped rules, matching the existing S/K source. A productive
infinite first rule cannot starve the next rule in the tested four-transition
prefix; that comparison runs both directly and through the quoted image.
This is distinct from a general fairness claim for infinite SLD search.

Conclusion normalization uses explicit source fuel, supplied as
`normalizationFuel` / `normalization_fuel` (default 32, range 0–256). A spent
budget yields a linked blocked outcome and an error at the public boundary,
never a false claim of saturation. These units are not S/K contractions.
A separate replacement test disables the linked interpreter's atom-unification
success clause: direct Horn execution still succeeds, while quoted execution
loses its answer. This guards against bypassing the linked interpreter.

## Independent native packaging

`rust/relational-kernel` is a companion Cargo package. It reuses the existing
RML crate's public data types and parser without editing that crate's exports
or default semantics. Its own lockfile pins the native dependency graph. The
explicitly registered target directory remains subject to the normal cache
lifecycle. `.github/workflows/relational-kernel.yml` invokes all JavaScript
relational tests and all targets of the companion package without test-name
filtering. A local passing probe does not establish a passing remote workflow.
