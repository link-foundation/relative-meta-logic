# Build cache lifecycle

RML build outputs are disposable; sources, proof corpora and useful diagnostic
records are not. The normal developer commands and every checkout-based CI job
use the same repository-scoped lifecycle. This policy does not take ownership of
another project, a home-directory package cache, or the machine's Docker daemon.

## Start here

Node.js 22.18+ or 24.11+ (Babel 8 capture support), Git, and process inspection (`ps` on Unix, also `lsof` on macOS; PowerShell on
Windows) are required. CI uses Node.js 22.

```sh
# Install the composed hooks and JavaScript dependencies from the repository root.
node scripts/bootstrap.mjs --install

# Normal JavaScript commands already enter the lifecycle.
npm --prefix js test
npm --prefix js run docs

# Wrap an entire Rust producer/consumer operation in one lease.
node scripts/run-with-cache.mjs --isolate-output rust/target -- cargo test --manifest-path rust/Cargo.toml --all-targets

# Inspect, perform normal bounded cleanup, or remove all provably owned outputs.
node scripts/build-cache.mjs --report --json
node scripts/build-cache.mjs
node scripts/build-cache.mjs --full
```

`npm ci` in `js/` invokes `prepare`, which installs the repository-local hook
composition. The runner also bootstraps before a top-level operation. Exported
source archives and downstream npm installations do not rewrite the consumer's
Git configuration. Docker source archives explicitly set
`RML_CACHE_SOURCE_ARCHIVE=1`; the default requires a real worktree.

The installed pre-commit hook runs normal bounded cleanup and delegates existing
hooks, retaining their arguments and exit status. It does not replace a user's
hook files or edit global Git configuration. Hook installation is idempotent. The installer enables Git's per-worktree
configuration and sets only this worktree's hook path, preserving peer worktrees.
Unusual bare/core.worktree configurations require manual hook setup.
Git's explicit hook bypasses still bypass hooks; the build runner is the primary
lifecycle boundary. A raw native `cargo build` does not install hooks; use
bootstrap, npm installation, or the wrapper first.

## Lifecycle and budgets

A top-level runner:

1. Obtains one worktree lease, deferring if another owned build holds it.
2. Performs safe bounded cleanup and checks free space before spawning the build.
3. Records a baseline of recognized generated paths, allocates a fresh private
   producer directory, and points `TMPDIR`/`TMP`/`TEMP` and
   `RML_CACHE_OUTPUT_DIR` there before executing the command.
4. Captures output and the command's exit status in `.rml-cache/evidence/`.
5. Registers only exact producer receipts or privately routed outputs and cleans
   up after success, failure or a
   handled signal without converting a failed build into success. An already
   nonzero command status is preserved. A successful command becomes exit 2 when
   cleanup or archiving fails or the aggregate remains over budget.

A blocked aggregate budget refuses the build before execution. Handled signals
allow child cleanup a bounded grace period: `RML_CACHE_SIGNAL_GRACE_MS` defaults
to 15000 milliseconds before escalation to a forced stop.

Nested npm tasks share the outer lease. Keep a build and its immediate consumers
inside one wrapper so cleanup cannot race the consumer. For example, the parity
workflow builds the Rust binary and compares corpus output inside one operation.
The docs workflow retains `_site` until the Pages artifact has been uploaded.

| Setting | Default | Meaning |
| --- | --- | --- |
| `RML_CACHE_BUDGET_BYTES` | 1 GiB | One aggregate limit across recognized local files and provably owned Docker resources |
| `RML_CACHE_MIN_FREE_BYTES` | 256 MiB | Minimum available bytes at the pre-build check |
| `RML_CACHE_STALE_HOURS` | 24 hours | Maximum warm-cache age since the last content or modification-time update |

Normal cleanup drops owned disposable scratch outputs and stale files, then
oldest owned warm files until the aggregate budget is satisfied. Rust incremental
sessions and example outputs are disposable; compiler artifacts can remain warm
within the budget. Development and test Cargo profiles disable debug information
and incremental compilation. `--full` also releases artifact-retention requests
and removes all currently provable generated files in registered roots.

This is one enforceable cleanup-time budget, not a hard filesystem quota or an
active-build quota. A producer may temporarily exceed it while its consumers run;
preflight and post-cleanup must satisfy the combined limit. The separate free-space
reserve is checked throughout the command and stops the owned process group if
the filesystem runs low. Active checks do not repeatedly hash build outputs or
query the Docker daemon.
Protected pre-existing or edited data can keep the reported total above budget.
The report marks this as blocked rather than deleting data to force compliance.
Byte accounting uses logical regular-file sizes, not physical filesystem blocks;
hard links, sparse files and directory/metadata allocation are not a hard quota.
Evidence and reports are intentionally outside the disposable byte budget and
survive full cleanup; manage their retention separately. Routine CI artifacts retain them
for seven days; the issue acceptance workflow uses thirty days.

The issue-183 CLI's `--report path` also writes `path.progress.json` before
execution and atomically updates it after each producer result. It preserves
actual assertion receipts, command output, input pins and the run's source
hashes if the aggregate is interrupted or times out. This journal always has
`provisional: true` and `passed: false`; it is never imported as proof. The
separate final report is published only after the full gate and live-source
checks finish. A finalized journal identifies that report by its SHA-256 and
matching run ID, so an earlier run's final file cannot certify a new run.
Keep these outputs in ignored `.rml-cache/evidence/` (as CI does), or outside
the source tree; writing them into source inputs must fail source freshness.

## Ownership and source safety

The registry lives in the worktree's own Git administrative directory. A file
appearing during a build is **not** proof that the build created it. Ownership
requires either an exact producer receipt or output routed into a private
producer directory freshly allocated by the lifecycle for that operation. Receipts bind the
producer's expected bytes to the file's hash, size, mtime, mode, device and inode.
Only unchanged previously proven outputs keep their ownership. Legacy entries
created by the earlier temporal-snapshot policy, including `producer-v1` receipts
from the superseded reused-directory implementation, are preserved as unproven
data. New ownership requires `producer-v2` evidence.
They still consume the aggregate budget: upgrading a checkout with a large legacy
cache may therefore block a build. Review those files and move or remove them
explicitly, or use a fresh checkout; there is no automatic blanket adoption or
legacy-cache purge. Fresh clones have no such unproven retained output.

JavaScript producers can use `writeProducedFile(relative, bytes)` from
`scripts/build-cache.mjs` while running under the wrapper. It exclusively creates
the named file and records the exact bytes; it refuses to adopt or overwrite an
existing unowned file, even when its contents happen to match. A user edit after
production invalidates the receipt. JSDoc writes to a private directory, safely
clears only its previously proven destination outputs, then publishes its exact
bytes through this API. VS Code server staging likewise clears only its proven outputs
and preserves unowned modules. Local publication is also available through
`scripts/publish-cache-output.mjs` and refuses name collisions with user data.

For native producers, use `--isolate-output <registered-root>`. The wrapper
always allocates a randomized private child of that root. Compatible prior cache
files are copied into it only after their directory identity and every retained
file match producer proof. The copy is revalidated through an open file descriptor
and uses independent inodes, never hard links. Timestamps and modes are retained
so native build tools can reuse compatible artifacts. The previous exposed target
is not used as the next producer's destination: concurrent edits or new files
there remain at their original paths and lose or never gain cleanup ownership.
Unknown/edited prior generations are preserved; a compatible older generation
may supply verified warm bytes. The wrapper exposes the new target's path as
`RML_CACHE_OUTPUT_DIR`, substitutes `{output}` in command arguments, and sets
`CARGO_TARGET_DIR` to it. Direct `--target-dir` arguments are redirected as well.
Keep consumers inside the same operation and use that path rather than assuming
outputs are at the shared root. The command's evidence receipt records the path. For a retained output consumed
by a later operation, `node scripts/build-cache.mjs --output-path <root>` resolves
only a still-proven private target; it refuses unknown or edited contents.
The ordinary Rust test, parity, syntax-provider, generated-native verification,
source-migration, API documentation, Docker compilation and formal
CI recipes route their producers this way; private `TMPDIR` output is also owned.

Tracked files, unknown/pre-existing files, symlinks and paths crossing a filesystem
or another worktree boundary are protected. Nested Git clones are independent
source boundaries: their metadata and both tracked and untracked source are
preserved. Only recognized generated roots inside those clones are considered,
and still require producer proof. A source tree cannot be registered as a cache.
Full cleanup is idempotent and preserves the tracked `vscode/server/.gitignore` and
original Lean/Rocq proofs.

Concurrent user writes to a shared output root stay unowned and survive cleanup,
including during a failed or interrupted producer. Editing an existing owned
file during the build also removes its cleanup eligibility. Private producer
directories are dedicated inputs/outputs of that specific command, not shared
editing locations. Arbitrary commands that ignore private output routing and do
not supply receipts leave ambiguous files protected; `--cache` alone is only a
path/class registration, not evidence of authorship. Those files still count
against the budget, and a protected excess blocks further builds rather than
weakening source safety. Remaining raw/custom producer integrations must adopt
this contract before their outputs can be automatically reclaimed.

Deletion uses a separate transaction. A candidate is atomically renamed into a
fresh same-parent quarantine before its detached inode/content are checked. Only
a matching detached artifact is deleted. An editor replacement is restored with
an exclusive link; if another replacement already occupies its name, both versions
are preserved and cleanup fails with the recovery path. Recovery files are never
adopted by capture or deleted by a later full cleanup. Ordinary empty parent
directories are left in place instead of recursively removing names that another
writer may have replaced. On Linux, open directory descriptors anchor both rename
paths against ancestor substitution; the portable fallback uses the same-parent
quarantine and validates ancestry. Native macOS/Windows transaction behavior still
requires platform CI, and stronger platform-specific path anchoring remains an
explicit portability limit.

The concurrency regressions cover writes to shared roots, edits/new files in a
known prior private target during the next build, atomic editor replacement at
deletion, ancestor symlink substitution, and blocked restoration. Fresh active
producer and transaction directories are dedicated work areas, not a security
boundary against a same-account writer deliberately discovering and modifying
them. Actual C/make testing confirms warm artifact reuse after copying; Cargo's
reuse across relocated targets has not yet been measured in this task, so this
is not a claim that every native tool avoids recompilation.

Nested wrappers retain the outer lease and record their cache roots, retention
requests, isolated output paths and archive failures through atomic per-operation
metadata. They resolve their own `{output}` arguments and defer capture/cleanup to
the outer operation, including when sibling wrappers run concurrently.

The lease records the process realm as well as the hostname and PID. Linux uses
its kernel boot ID and PID namespace. macOS uses XNU's `kern.bootsessionuuid`
and the single Darwin host PID realm. Windows queries CIM read-only for the machine UUID, OS boot time and the
observed process-tree root's PID/creation time. The process-root discriminator
keeps ordinary nested npm/cmd/Node wrappers together without equating unrelated
process trees solely because they share machine/boot metadata. PID liveness is
consulted only after a known, matching identity. Foreign, legacy or unknown
identities wait/defer; they are never called abandoned based on a local PID miss.
Inherited tokens also require a matching realm. An unavailable identity provider
therefore defers nested reuse instead of silently bypassing the lease. Windows
and macOS branches have mocked regression coverage; actual execution there still
requires platform CI. Windows field definitions are documented in
[Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process),
[Win32_OperatingSystem](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem), and
[Win32_ComputerSystemProduct](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystemproduct).

The process guard checks for unleased build tools visible in its own process
namespace. It cannot establish that a raw build in another namespace is absent;
shared-checkout builds must use the lifecycle wrapper so their filesystem lease
is visible across namespaces. Lease recovery after a hard-killed process requires
independently verifying that no descendants remain in its original namespace. SIGKILL, host loss and
forced runner termination cannot execute any program's cleanup handler; the
next safe invocation can clean registered leftovers, while ambiguous files stay
protected. Do not work around a safety refusal with a broad recursive deletion.

## Generated-path coverage

The checked-in `scripts/cache-policy.json` is the source of truth. It covers:

- Rust `rust/target` and root `target`, including docs, tests and examples
- JavaScript generated docs/site, coverage, distribution and package-local caches
- VS Code staged server and extension-package outputs
- Owned scratch, consumer, parser, compiler, Lean, Rocq, acceptance, benchmark and
  container-output directories under `.rml-cache/`
- Explicitly registered repository-relative custom output roots

A custom target must stay inside this repository and outside source/protected
paths. Direct Cargo target arguments and `CARGO_TARGET_DIR` are checked by the
runner; absolute targets outside the worktree are rejected. When the command is
a shell expression or third-party build tool, register its output explicitly:

```sh
node scripts/run-with-cache.mjs --cache build-output/cargo --class rust \
  --isolate-output build-output/cargo -- cargo build --manifest-path rust/Cargo.toml

node scripts/run-with-cache.mjs --cache .rml-cache/parser --class parser \
  --isolate-output .rml-cache/parser -- your-parser-build-command --output-dir "{output}"
```

`--retain <registered-root>` protects a consumer's required outputs across
intermediate bounded cleanups. It is not permission to delete a source directory.
Always finish the handoff with `--full`. A raw `cargo`, `lake`, `make`, direct Node
build script, or third-party tool launched outside the runner is not silently
intercepted. Existing outputs from those commands stay unowned until a safe
explicit migration; using the documented wrappers avoids that gap.

## CI integration and pinned formal sources

Every checkout-based job installs the lifecycle, uploads diagnostics using
`actions/upload-artifact`, and ends with `if: always()` full teardown. The Pages
job uploads the assembled site before teardown. The deploy-only Pages job has no
checkout or generated repository data to clean. Rust build caches are no longer
exported through a post-job `rust-cache` action after teardown.

The formal workflow checks out RML at the root and the exact pinned meta-theory
revision under `upstream-meta-theory`. Lean and Rocq build disposable copies in private per-operation directories below
`.rml-cache/lean` and `.rml-cache/rocq`. This contains `.lake`, generated
Makefiles, `.vo`, `.vos`, `.vok`, `.glob`, `.aux` and any future tool-generated files
without classifying proof/source files in the upstream checkout as garbage.
Rocq changes permissions only on its scratch copy and restores runner ownership
before the wrapper inventories or deletes it.

The same adaptation applies when running a pinned formal-ai source corpus:
keep its checkout immutable, copy the required build inputs to a dedicated owned
scratch root, run the complete formal build under the wrapper, and upload evidence
before full teardown. No external repository is rewritten by this policy, and
there is no claim that another repository's own CI has been changed.

## Docker boundary

For a self-contained build-and-smoke-test operation:

```sh
node scripts/run-with-cache.mjs -- bash docker/ci-build.sh
```

This command intentionally removes its resulting test images. For images you want
to keep, the ordinary build/Compose commands in `docker/README.md` still work;
their daemon cache and image retention are outside this lifecycle.

The CI helper creates a uniquely named project/run-scoped Buildx builder. Its
state volume and output images have project/run ownership labels. Cleanup checks
those labels, the builder container's exact ID and state-volume mount, and removes
only that builder and exact image IDs. The smoke/formal container helper also
verifies each immutable container ID and its labels, then stops, waits for, and
removes it before allowing scratch cleanup. An unresolved Docker resource leaves
a protected external-resource lease; filesystem cleanup refuses to run until
the resource has been independently stopped and that lease safely resolved. A changed identity fails closed. It never
uses global system/image/container/volume pruning, force-removes unrelated
images, or exports an unbounded remote GitHub Actions cache.

`RML_CACHE_BUDGET_BYTES` covers both local generated files and the dedicated
Docker resources. There is no additional independent 2 GB allowance. The helper
generates its private BuildKit GC configuration from the same remaining budget
and uses exact-byte Docker/Buildx accounting at lifecycle checkpoints. The outer
wrapper includes those measurements in its preflight and cleanup reports. Unsupported,
malformed or ambiguous accounting fails closed; it never authorizes deletion of
unknown resources. Cleanup evidence reports measured before, after and reclaimed
logical bytes and whether exact owned resources were removed.

These are conservative logical byte counts. BuildKit cache records and loaded
image sizes can include the same shared layers, so they are deliberately counted
more than once rather than claiming physical allocation or disk reclamation.
Owned containers contribute their writable-layer `SizeRw` (the shared image
rootfs is excluded). The formats are documented by Docker for
[Buildx disk usage](https://docs.docker.com/reference/cli/docker/buildx/du/) and
[container size inspection](https://docs.docker.com/reference/cli/docker/inspect/#inspect-the-size-of-a-container--s---size).
Unknown or legacy external leases without verifiable accounting fail closed.
Intermediate helper reports can truthfully show temporary excess and
`localCleanupRequired`; final aggregate enforcement belongs to the outer wrapper
after local output cleanup.
GC is periodic and the wrapper polls only the free-space reserve, so neither is
a hard in-flight quota.
Unrelated builders, volumes, images, package-manager caches and remote registries
remain outside scope. Ownership mismatches or unresolved external leases remain
protected and prevent a clean lifecycle success.

The Rust Dockerfile copies runnable binaries to `/out` before cleanup in the same
layer that compiles them. The final runtime image copies only those binaries and
runtime resources. Neither Dockerfile uses persistent Cargo target cache mounts.
Build stages provide Node and process-inspection tools, and explicitly enable the
source-archive ownership mode because `.git` is excluded from the build context.

The policy test exercises successful and failed Docker commands, termination and
ownership mismatches against a fake Docker CLI. That is safety/control-flow
coverage, not proof of a real image build or measured Docker disk reclamation;
the Docker CI job provides the real integration check.

## Formal-ai adaptation record

The implementation reviewed the pinned formal-ai revision
[`d209aac6461b355f1a527831202af3423135f7e6`](https://github.com/link-assistant/formal-ai/tree/d209aac6461b355f1a527831202af3423135f7e6), specifically its
[installed hook](https://github.com/link-assistant/formal-ai/blob/d209aac6461b355f1a527831202af3423135f7e6/.githooks/pre-commit),
[pre-commit integration](https://github.com/link-assistant/formal-ai/blob/d209aac6461b355f1a527831202af3423135f7e6/.pre-commit-config.yaml),
[pruner](https://github.com/link-assistant/formal-ai/blob/d209aac6461b355f1a527831202af3423135f7e6/scripts/prune-build-cache.sh),
[test wrapper](https://github.com/link-assistant/formal-ai/blob/d209aac6461b355f1a527831202af3423135f7e6/scripts/cargo-test.sh), and
[disk-policy checks](https://github.com/link-assistant/formal-ai/blob/d209aac6461b355f1a527831202af3423135f7e6/scripts/check-disk-usage-policy.rs).

Adopted: installation during ordinary bootstrap; an every-commit hook without
file filters; bounded concurrency and development profiles; a default budget;
cleanup after failed tests; and executable checks covering workflows rather than
only a hand-picked subset. Adapted: the installed hook composes the user's hooks
and uses per-worktree configuration, while a lease spans the complete producer /
consumer operation. Hook/cleanup failures are visible rather than always ignored.

Not copied: host-wide Docker deletion, deletion based only on modification time,
and allowing an optional missing sweeper to silently leave an unenforced budget.
The hash/size/mtime/mode registry prioritizes preserving unknown and edited files.
It does not claim Cargo dependency-graph-aware eviction: missing compiler
artifacts are rebuilt using Cargo's own fingerprint validation, and eviction may
cost recompilation. This remains a narrower optimization than `cargo-sweep`.
The complete language/semantic formal-ai adoption map is a separate requirement;
this cache adaptation does not satisfy it.

## Reproduce the measured development cycle

After installing JavaScript development dependencies, run:

```sh
node scripts/measure-build-cache.mjs docs/case-studies/issue-183/data/build-cache-measurement.json
```

The script copies the current source into an isolated Git checkout whose path
contains spaces, installs its hooks, builds real JSDoc output, records bytes,
fully cleans that output, rebuilds it, and runs the complete JavaScript suite.
It archives each command's output and status before removing its fixture, and
writes a failure report rather than reporting a failed verification as passing.
The report distinguishes this JavaScript/docs cycle from native Rust/formal and
Docker verification; it cannot close the complete issue-183 acceptance gate.

## Linked-kernel test profile

Only the RML package uses test optimization level 1. Dependencies keep their
existing test profile. The same complete linked proof and independent replay
witness took 336.82 seconds with this setting versus 518.21 seconds without it
in the task environment; its binary was also smaller (4,920,408 versus
5,591,608 bytes). The final run included all ten tests, including the new
bounded-input regressions. These are measured observations, not a portable
performance guarantee. See `case-studies/issue-183/data/native-proof-profile.json`.

## Disk reserve during an active build

The command wrapper checks the configured free-space reserve once per second while its owned child is running, as well as before starting it. If the reserve is exhausted, the wrapper stops that child process group, records a nonzero result and the `resourceLimit` reason, then captures and cleans only its own generated outputs through the normal lease lifecycle. A child that handles the stop signal by exiting zero still counts as interrupted.

`RML_CACHE_RESOURCE_INTERVAL_MS` selects the polling interval in whole milliseconds, from `1` to `2147483647` (default `1000`); `RML_CACHE_SIGNAL_GRACE_MS` retains the existing grace period before forceful termination and permits `0` through `2147483647`. Both settings are validated before any child starts, including rejection of values Node would silently clamp to one millisecond. The reserve is an early-stop check, not a filesystem quota: another writer or a burst of output can consume space between polls. Unknown leases and pre-existing files remain protected.

The cross-platform cache job executes the actual wrapper with a simulated change in filesystem availability, checks its failure receipt and lease release, and verifies that full cleanup removes the generated file while preserving pre-existing source.

Failures while recording child ownership, reporting a resource limit, or writing command output also stop and drain the owned child before releasing the lease. Evidence failures retain captured outputs instead of deleting them without a complete archive. Monitoring ends when the child exits; on POSIX systems, any remaining descendants in its owned process group are stopped before the output pipes are drained.
