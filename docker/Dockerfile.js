# Image for the JavaScript implementation of Relative Meta-Logic (RML).
#
# Build (from the repository root):
#   docker build -f docker/Dockerfile.js -t rml-js .
#
# Run the demo knowledge base:
#   docker run --rm rml-js
#
# Run an arbitrary .lino file from the bundled examples:
#   docker run --rm rml-js node src/rml-links.mjs ../examples/classical-logic.lino
#
# Mount a local file to evaluate it:
#   docker run --rm -v "$PWD/my.lino:/work/my.lino" rml-js \
#     node src/rml-links.mjs /work/my.lino

FROM node:22-alpine

# Required for the lifecycle guard to detect unleased build processes.
RUN apk add --no-cache procps

ENV RML_CACHE_SOURCE_ARCHIVE=1

WORKDIR /repo
COPY scripts ./scripts
WORKDIR /repo/js

# Install JS dependencies first so they are cached across source changes.
COPY js/package.json js/package-lock.json ./
RUN node ../scripts/run-with-cache.mjs -- npm ci --omit=dev \
    && node ../scripts/build-cache.mjs --full

# Copy the JS sources alongside the cached node_modules.
COPY js/src ./src
COPY js/vendor/meta-language/js/src ./vendor/meta-language/js/src
COPY js/vendor/meta-language/js/package.json ./vendor/meta-language/js/
COPY js/vendor/meta-language/LICENSE ./vendor/meta-language/
COPY js/vendor/LICENSE.meta-language js/vendor/meta-language-provenance.json ./vendor/
COPY js/tests ./tests

# Copy the language-agnostic resources the entry points read at runtime.
WORKDIR /repo
COPY examples ./examples
COPY lib ./lib
COPY test-corpus ./test-corpus

WORKDIR /repo/js

ENTRYPOINT ["node", "src/rml-links.mjs"]
CMD ["../examples/demo.lino"]
