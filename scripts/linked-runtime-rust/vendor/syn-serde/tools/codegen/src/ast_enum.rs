// SPDX-License-Identifier: Apache-2.0 OR MIT

use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn_codegen::{Data, Definitions, Node, Type};


use crate::{
    convert::IGNORED_TYPES,
    traverse, workspace_root,
};

const AST_ENUM_SRC: &str = "src/gen/ast_enum.rs";

const SKIPPED: &[&str] = &[
    // stmt.rs
    "Stmt", // TODO
];

fn rename(ident: &str, variant: &str) -> Option<&'static str> {
    match (ident, variant) {
        ("Pat", "Wild") | ("Type", "Infer") => Some("_"),
        ("Type", "Never") => Some("!"),
        ("Stmt", "Local") => Some("let"),
        ("UseTree", "Glob") => Some("*"),
        ("UseTree", "Name") | ("Member", "Named") => Some("ident"),
        ("Member", "Unnamed") => Some("index"),
        ("RangeLimits", "HalfOpen") => Some(".."),
        ("RangeLimits", "Closed") => Some("..="),
        ("Visibility", "Public") => Some("pub"),
        ("StaticMutability", "Mut") => Some("mut"),
        _ => None,
    }
}

fn node(impls: &mut TokenStream, node: &Node, defs: &Definitions) {
    if SKIPPED.contains(&&*node.ident) || IGNORED_TYPES.contains(&&*node.ident) {
        return;
    }

    if let Data::Enum(variants) = &node.data {
        let mut body = TokenStream::new();

        for (variant, fields) in variants {
            body.extend(rename(&node.ident, variant).map(|s| quote!(#[serde(rename = #s)])));

            let variant = format_ident!("{variant}");

            if fields.is_empty() {
                body.extend(quote!(#variant,));
            } else {
                if fields.len() == 1 && matches!(&fields[0], Type::Token(_) | Type::Group(_)) {
                    if matches!(&*node.ident, "BinOp" | "UnOp") {
                        let t = match &fields[0] { Type::Token(t) | Type::Group(t) => t, _ => unreachable!() };
                        let s = &defs.tokens[t];
                        body.extend(quote!(#[serde(rename = #s)]));
                    }
                    body.extend(quote!(#variant,));
                } else {
                    let mapped: Vec<_> = fields.iter().filter_map(crate::ast_struct::format_ty).collect();
                    if mapped.is_empty() { body.extend(quote!(#variant,)); }
                    else { body.extend(quote!(#variant(#(#mapped),*),)); }
                }
            }
        }

        let non_exhaustive = if node.exhaustive {
            quote! {}
        } else {
            quote! { #[non_exhaustive] }
        };

        let ident = format_ident!("{}", node.ident);
        let doc = format!(" An adapter for [`enum@syn::{}`].", node.ident);
        impls.extend(quote! {
            #[doc = #doc]
            #[derive(Serialize, Deserialize)]
            #[serde(rename_all = "snake_case")]
            #non_exhaustive
            pub enum #ident {
                #body
            }
        });
    }
}

pub(crate) fn generate(defs: &Definitions) {
    let workspace_root = workspace_root();
    let impls = traverse::traverse(defs, node);
    let path = &workspace_root.join(AST_ENUM_SRC);
    crate::write_generated(path, quote! {
        use crate::*;

        #impls
    });
}
