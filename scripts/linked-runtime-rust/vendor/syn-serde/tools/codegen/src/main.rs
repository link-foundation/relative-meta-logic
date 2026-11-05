// SPDX-License-Identifier: Apache-2.0 OR MIT

// Based on https://github.com/dtolnay/syn/tree/1.0.5/codegen.
//
// This crate generates the Syn trait in syn-serde programmatically from
// the syntax tree description.

#![allow(clippy::needless_pass_by_value)]

mod ast_enum;
mod ast_struct;
mod convert;
mod traverse;

use std::path::Path;

use std::fs;

fn workspace_root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().and_then(Path::parent).expect("vendored code generator path").to_path_buf()
}

fn main() {
    // TODO: auto-update syn.json on new release?
    let syn_json = Path::new(env!("CARGO_MANIFEST_DIR")).join("syn.json");
    let defs = fs::read_to_string(syn_json).unwrap();
    let defs = serde_json::from_str(&defs).unwrap();

    ast_struct::generate(&defs);
    ast_enum::generate(&defs);
    convert::generate(&defs);
}

fn write_generated(path: &Path, tokens: proc_macro2::TokenStream) {
    std::fs::write(path, format!("// SPDX-License-Identifier: Apache-2.0 OR MIT\n// Generated from Syn 3.0.6 official schema; see PATCHES.md.\n{}\n", tokens)).unwrap();
    let status = std::process::Command::new("rustfmt").args(["--edition", "2021"]).arg(path).status().expect("rustfmt required for deterministic generated adapters");
    assert!(status.success(), "rustfmt failed");
}
