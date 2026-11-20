# Generic Rust syntax dependencies

The adapter pins Syn 3.0.6, Quote 1.0.47, serde_json 1.0.151 and a local
Syn 3 adaptation of syn-serde 0.3.2. Cargo.lock pins every transitive registry
checksum. Published syn-serde 0.3.2 still supports Syn 2; this migration is
local, and is not represented as an upstream Syn 3 release.

The vendored source originated in the published 0.3.2 registry package:
https://crates.io/crates/syn-serde/0.3.2
Upstream source: https://github.com/taiki-e/syn-serde
Both upstream license files are retained in vendor/syn-serde.

## Syn 3 schema migration

The complete official Syn 3.0.6 schema is retained at
`vendor/syn-serde/tools/codegen/syn.json`, sourced from
https://github.com/dtolnay/syn/blob/3.0.6/syn.json.
The upstream generator is adapted to retain Syn 3 modifier structures,
receiver kinds, match-guard patterns, function-pointer types, type attributes,
generic defaults and pointer mutability. Non-exhaustive modifier values are
constructed with Default followed by assignments to all current schema fields.
Reserved frontmatter is uninhabited: a crafted serialized value is rejected,
and the adapter never silently discards a future payload. C-string literals
store canonical bytes and reconstruct the native C-string literal value.
Generated output is reviewed and pinned alongside the generator and schema.

From the repository root, regenerate the three generated adapters with:

```sh
node scripts/run-with-cache.mjs --cache .rml-cache/syn-codegen -- \
  cargo run --locked --manifest-path scripts/linked-runtime-rust/vendor/syn-serde/tools/codegen/Cargo.toml \
  --target-dir .rml-cache/syn-codegen
```

The generator requires rustfmt. Its Cargo lock and source provenance are retained;
a second generation must produce byte-identical output with the same toolchain.
The ordinary adapter does not need to run this generator.

## Preserved serialization corrections

* LitByte uses canonical byte-character literals, preserving the exact u8 value.
* Raw identifiers use Ident::new_raw after removing r#, while ordinary
  identifiers use Ident::new.
* Required trailing commas are restored for singleton tuples and struct-update
  or struct-rest grammar. The adapter contains no RML rule or constructor cases.

Every owned Rust module is checked by parse / serialize / deserialize / generate /
reparse equality. The native source-free witness rebuilds the adapter from its
own AST and checks a generation fixed point. Independent syntax witnesses retain
byte/raw-identifier and tuple/struct regressions and compile/run Syn 3 C strings,
function pointers, match guards, explicit receivers and generic defaults.
Macro expansion remains an explicit generic compiler dependency.
