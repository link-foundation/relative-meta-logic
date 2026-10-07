# Runtime replacement of the linked K0 kernel

The public JavaScript registry accepts `kernelArtifact` in `fromRml`,
`fromForms`, or its constructor. Rust's registry exposes
`with_kernel_artifact(&str)`. Each registry owns its selected closed linked
artifact. Multiple differently defined kernels can run concurrently, without
editing runtime code, writing generated modules, rebuilding the Rust binary,
or changing a process-global definition.

The artifact is the same addressed S/K Links DAG format as
`lib/meta-theory/fixed-point.ski`. It must contain all 25 runtime entry roots.
Loading rejects missing or duplicate roots, forward or unknown references,
trailing data, and excessive source/node/root counts. The same disabled-operation
and contraction-budget controls apply to built-in and caller-selected kernels.
Static bootstrap metrics continue to describe the built-in kernel; the instance
`kernelSourceReport()` (JavaScript) and `loaded_kernel_artifact_counts()` (Rust)
identify caller-loaded data independently.

## Recursive substitution witness

Run `node experiments/definition-replacement/k0-replacement.mjs` from the
repository root. The same linked candidate and request execute on unchanged
JavaScript/Rust S/K runtimes under two different K0 definitions:

| Linked definition | Result of `(input value)` |
| --- | --- |
| Original recursive list substitution | `(pair (nested value) done)` |
| Replacement recursive list substitution | `(done (value nested) pair)` |

The replacement changes node `n880` in the authoritative
`fixed-point-source.lino` substitution definition from prepending each substituted
head to appending it after the substituted tail. Three ordinary source nodes
supply the append application. This changes substitution recursively, including
the nested list. Pattern matching and the candidate program are unchanged.
The experiment's `mirroredSubstitutionSource` performs this explicit source
mutation, and the ordinary generic bracket-abstraction compiler produces the
replacement artifact. `--write` regenerates its committed fixture.

The shared fixture is
`test-corpus/kernel-replacement/mirror-substitution.ski`. The JavaScript test
compiles the changed linked source and compares every byte against that fixture;
the Rust test loads exactly the same fixture. Independent assertions check both
outputs, isolation between live registries, a newly created default registry,
unchanged baseline proof search/imports/inference, malformed input rejection,
primitive removal and contraction exhaustion. A stale source node makes the
fixture generator fail instead of silently selecting a different definition.

## Exact trust boundary

This closes the former runtime artifact-selection limitation. It does not
establish full implementation closure or claim a second minimal foundation.

- Both definitions are compiled by the existing JavaScript bracket-abstraction
  compiler. That compiler is still host code; this witness does not remove it.
- The S/K contraction equations remain external primitives. Substitution above
  those equations is driven by the selected linked definition.
- Artifact parsing, I/O encoding/decoding, and resource limits remain host work.
- RML typing, elaboration, the full verifier, language translation, target-machine
  modelling and code generation are not made linked-authoritative by this API.
- Mirroring list substitution intentionally changes candidate semantics. It is a
  definition-replacement witness, not a semantic-preserving foundation reduction.

R149 and R151 therefore remain open. R150 receives direct K0 substitution
replacement evidence in addition to its existing K1 mechanism witnesses, while
its broader recursive mechanism scope remains tracked separately.
