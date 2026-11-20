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
# The ordinary lifecycle verifies all owned sources, providers and configuration.
# Supply the complete declared inventory before npm invokes that guard.
COPY . .
WORKDIR /repo/js
RUN node ../scripts/run-with-cache.mjs -- npm ci --omit=dev \
    && node ../scripts/build-cache.mjs --full

ENTRYPOINT ["node", "src/rml-links.mjs"]
CMD ["../examples/demo.lino"]
