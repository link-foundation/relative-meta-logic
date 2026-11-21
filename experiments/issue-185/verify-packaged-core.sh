#!/usr/bin/env bash
# Build a fresh consumer from the .crate artifact produced by Cargo packaging.
set -euo pipefail

archive=${1:?Usage: verify-packaged-core.sh path/to/relative-meta-logic-VERSION.crate}
package=${archive##*/}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
tar -xf "$archive" -C "$scratch"
crate_dir="$scratch/${package%.crate}"

cargo init --quiet --vcs none --bin --name rml_core_consumer "$scratch/consumer"
cp "$crate_dir/examples/assess_statement.rs" "$scratch/consumer/src/main.rs"
cd "$scratch/consumer"
cargo add --offline --path "$crate_dir" --no-default-features --features core

graph=$(cargo tree --offline --locked --target wasm32-unknown-unknown --edges normal --prefix none)
printf '%s\n' "$graph"
if [[ $(wc -l <<< "$graph") -ne 2 ]]; then
  echo "Expected only the consumer and the dependency-free RML core" >&2
  exit 1
fi
cargo run --offline --locked
cargo build --offline --locked --target wasm32-unknown-unknown
