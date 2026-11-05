// SPDX-License-Identifier: Apache-2.0 OR MIT
//! Adapters for Syn 3 syntax absent from the Syn 2 serialization release.
use super::*;
use alloc::vec::Vec;

/// Syn 3.0.6 reserves frontmatter but supplies no public constructor or parser.
/// Keep it uninhabited, so input cannot silently lose a future payload.
#[derive(Serialize, Deserialize)]
pub enum Frontmatter {}
syn_trait_impl!(syn::Frontmatter);
impl From<&syn::Frontmatter> for Frontmatter {
    fn from(_: &syn::Frontmatter) -> Self {
        panic!("reserved Syn frontmatter cannot be serialized")
    }
}
impl From<&Frontmatter> for syn::Frontmatter {
    fn from(value: &Frontmatter) -> Self { match *value {} }
}

/// Canonical C-string literal bytes, excluding the implicit terminal NUL.
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct LitCStr { value: Vec<u8> }
syn_trait_impl!(syn::LitCStr);
impl From<&syn::LitCStr> for LitCStr {
    fn from(value: &syn::LitCStr) -> Self { Self { value: value.value().into_bytes() } }
}
impl From<&LitCStr> for syn::LitCStr {
    fn from(value: &LitCStr) -> Self {
        let value = alloc::ffi::CString::new(value.value.clone()).expect("C string has an interior NUL");
        Self::new(&value, proc_macro2::Span::call_site())
    }
}
