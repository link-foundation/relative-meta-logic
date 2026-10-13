# Direct lambda-link source execution control

`js/src/rml-lambda-kernel.mjs` and `rust/src/lambda_kernel.rs` execute the
addressed `lib/meta-theory/fixed-point-source.lino` source directly. Both use a
call-by-name lexical closure machine. Neither implementation performs bracket
abstraction, contracts S/K, loads a compiled kernel artifact, or dispatches on
an object theory. The stable public linked-program registries are unchanged;
this is a separate low-level control API, not a new production execution basis.

This experiment removes the bracket-abstraction compiler from the execution
path for this source. It does **not** establish a genuinely different minimal
foundation. Review
[5773411325](https://github.com/link-foundation/relative-meta-logic/pull/184#issuecomment-5773411325)
explicitly excludes another syntax for the same lambda semantics. The compiled
S/K source and this machine share those upper semantics. R130 and R149 remain
open, including the requirement for independently justified comparable peers.
R151 remains open: neither a Link-defined parser/compiler nor a path from
Links to machine code has been supplied.

## Same source and observations

`test-corpus/lambda-kernel/workload.lino` is passed unchanged to both machines.
The shared `cases.json` fixes the expected observations, independently of either
implementation:

- repeated-variable matching, including unequal repeated-variable rejection;
- Unicode atom preservation;
- ordered overlapping-rule selection and leftmost nested traversal;
- recursive substitution and import rebinding;
- imported facts, two successive inferences, and a saturated fixed point;
- exact full proof-tree equality and an absent-judgement negative control.

The JavaScript comparison runs the existing compiled S/K API and the direct
source API. Rust runs the same cases against the existing public S/K registry.
Program loading, bounded orchestration and output decoding remain host services
in both comparisons; they are not claimed to be Link-executed.

Run the JavaScript comparison with:

```sh
node scripts/run-with-cache.mjs -- node experiments/lambda-kernel/compare.mjs
```

The initial fixture run measured 788,435 direct lambda machine transitions and
1,657,075 S/K contractions, with identical reductions, judgements and proof
trees. These are different units. The numbers are not a semantic-minimality
ranking, and the five direct machine branches are not compared numerically
with two S/K equations as if their content were equal.

## Direct recursive substitution replacement

The fixture `mirror-substitution.lino` changes the same n880 recursive
list-substitution definition as the existing K0 replacement witness. The two
kernels load D and D' concurrently without global mutation:

```text
D:  (input value) -> (pair (nested value) done)
D': (input value) -> (done (value nested) pair)
```

The upper rewrite source and generic machine code are unchanged. The
replacement is executed directly from Links, without generating or loading a
replacement `.ski` artifact. A JavaScript child-process test refuses every
compiler/combinator module import and still executes D'. This strengthens the
bounded R150 source-replacement evidence; it is not closure of substitution in
every language, the machine's own lexical environment mechanism, or the whole
implementation.

## External authority and trust boundary

There is no claim that one unqualified "beta rule" accounts for this machine.
Five observable host transitions are separately disableable:

1. `lambda-push-argument`: choose the left application head and capture its
   argument with the current environment.
2. `lambda-bind-argument`: bind a lambda parameter by extending that environment
   with the next argument closure.
3. `lambda-resolve-variable`: compare names and find the nearest lexical
   binding by traversing the environment.
4. `lambda-enter-closure`: restore the captured environment and expression.
5. `lambda-reify-head`: stop at weak head and reconstruct remaining neutral
   applications, preserving unforced closures.

Removing any one branch prevents the declared workload from completing.
That proves necessity in this implementation. It does not prove independence
as a mathematical primitive, exclude a smaller machine, or establish
minimality. Lexical capture, shadowing, unused divergent arguments, and
bounded divergence have separate tests.

The remaining host services are also explicit:

- LiNo text parsing; addressed-node and earlier-root resolution; constructor,
  count, closed-root, cycle and depth validation; source-size limits.
- Input program validation and pattern elaboration, including the leading `?`
  convention. These can affect accepted RML inputs and are not treated as
  semantically irrelevant.
- Scott encoding of atoms, lists, patterns, programs, rules, imports, facts and
  inferences; UTF-8 byte conversion; checked decoding of outputs and proofs.
  The codecs reproduce the existing S/K boundary and remain trusted code.
- Public-call orchestration and stopping policy, transition/resource budgets,
  memory allocation and reference management. A transition budget is not a
  bound on every host instruction or allocated byte.
- JavaScript/Rust execution, their runtimes and compilation toolchains, the
  operating system, and the physical processor.

The linked source drives matching, term substitution, ordered rule selection,
import/rebinding, inference saturation, and exact known-proof lookup. The
source parser and closure machine do not become authoritative merely because
these six functions execute above them. This control does not establish
intrinsic Links orientation, independent proof replay, machine
self-interpretation/self-generation, or full product closure.

## Validation and controls

```sh
node scripts/run-with-cache.mjs -- node --test js/tests/lambda-kernel.test.mjs
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --test lambda_kernel_tests -j 2
node scripts/cargo.mjs test --manifest-path rust/Cargo.toml --lib lambda_kernel::tests -j 2
```

The source loaders reject unknown/forward root aliases, duplicate nodes or
roots, missing required roots, inconsistent counts, forged references, cycles,
open roots and malformed expressions. Runtime tests reject invalid/exhausted
budgets and every disabled transition. The source DAG itself has bounded depth;
this does not claim that arbitrary host input/output trees are unlimited.

The comparison report keeps `genuinelyDifferentFoundationEstablished`,
`minimalityEstablished` and `fullImplementationClosure` false. The concrete
remaining gap is a second genuinely different, comparably reduced foundation
with the same closure, replacement, preservation, removal and self-execution
contract, together with the wider R149/R151 implementation closure.
