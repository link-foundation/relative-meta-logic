# Docker

Reproducible container images for both implementations of Relative
Meta-Logic (RML).

## Files

- [`Dockerfile.js`](./Dockerfile.js) - Node.js 20 image that runs the
  JavaScript evaluator (`js/src/rml-links.mjs`).
- [`Dockerfile.rust`](./Dockerfile.rust) - Multi-stage Rust image that
  compiles the `rml`, `rml-check`, and `rml-meta` binaries and ships
  them on a minimal Debian runtime.
- [`docker-compose.yml`](./docker-compose.yml) - Compose file that
  builds and runs both services with the repository mounted read-only
  at `/repo`.

Build context for both Dockerfiles is the repository root, so commands
below are run from there.

## Quick start

### JavaScript implementation

Build and run the demo knowledge base:

```bash
docker build -f docker/Dockerfile.js -t rml-js .
docker run --rm rml-js
```

Run an arbitrary `.lino` file from the bundled examples:

```bash
docker run --rm rml-js node src/rml-links.mjs ../examples/classical-logic.lino
```

Evaluate a local file by mounting it:

```bash
docker run --rm -v "$PWD/my.lino:/work/my.lino" rml-js \
  node src/rml-links.mjs /work/my.lino
```

### Rust implementation

Build and run the demo knowledge base:

```bash
docker build -f docker/Dockerfile.rust -t rml-rust .
docker run --rm rml-rust
```

Run an arbitrary `.lino` file from the bundled examples:

```bash
docker run --rm rml-rust /repo/examples/classical-logic.lino
```

Evaluate a local file by mounting it:

```bash
docker run --rm -v "$PWD/my.lino:/work/my.lino" rml-rust /work/my.lino
```

The Rust image also exposes the `rml-check` and `rml-meta` binaries:

```bash
docker run --rm --entrypoint rml-check rml-rust /repo/examples/classical-logic.lino
docker run --rm --entrypoint rml-meta rml-rust /repo/examples/classical-logic.lino
```

## docker compose

The Compose file builds both images and mounts the repository
read-only so local edits to `examples/` and `lib/` are visible inside
the containers without rebuilding.

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm rml-js
docker compose -f docker/docker-compose.yml run --rm rml-rust
```

Override the command to run a different `.lino` file:

```bash
docker compose -f docker/docker-compose.yml run --rm rml-js \
  ../examples/classical-logic.lino
docker compose -f docker/docker-compose.yml run --rm rml-rust \
  /repo/examples/classical-logic.lino
```

## Continuous integration

Both images are built on every pull request that touches `docker/`,
the implementations, the shared examples, or the corpora. See
[`.github/workflows/docker.yml`](../.github/workflows/docker.yml).

## Build-cache ownership

CI uses a fresh project/run-scoped builder and removes its labelled images and
builder state after the smoke tests. To run that same disposable verification
locally, use:

```bash
node scripts/run-with-cache.mjs -- bash docker/ci-build.sh
```

The command removes its test images. The ordinary build and Compose examples
above retain the images you requested; their shared Docker daemon cache is not
managed by the repository cleaner. Neither route prunes other projects' images,
builders or volumes. See [Build cache lifecycle](../docs/BUILD_CACHE.md) for exact
ownership checks, budgets, artifact retention and source-safety boundaries.
