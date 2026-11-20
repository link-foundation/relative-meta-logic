// SPDX-License-Identifier: Apache-2.0 OR MIT
use super::*;
ast_struct! {
    /// An adapter for [`struct@syn::ItemStruct`].
    pub struct ItemStruct {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub(crate) attrs: Vec<Attribute>,
        #[serde(default, skip_serializing_if = "Visibility::is_inherited")]
        pub(crate) vis: Visibility,
        pub(crate) ident: Ident,
        #[serde(default, skip_serializing_if = "Generics::is_none")]
        pub(crate) generics: Generics,
        pub(crate) fields: Fields,
        // #[serde(default, skip_serializing_if = "not")]
        // pub(crate) semi_token: bool,
    }
}

impl StaticMutability {
    pub(crate) fn is_none(&self) -> bool { matches!(self, Self::None) }
}
impl Default for StaticMutability {
    fn default() -> Self { Self::None }
}
mod convert {
    use super::*;
    // ItemStruct
    syn_trait_impl!(syn::ItemStruct);
    impl From<&syn::ItemStruct> for ItemStruct {
        fn from(other: &syn::ItemStruct) -> Self {
            let fields: Fields = other.fields.ref_into();
            assert_struct_semi(&fields, other.semi_token.is_some());

            Self {
                attrs: other.attrs.map_into(),
                vis: other.vis.ref_into(),
                ident: other.ident.ref_into(),
                generics: other.generics.ref_into(),
                fields,
            }
        }
    }
    impl From<&ItemStruct> for syn::ItemStruct {
        fn from(other: &ItemStruct) -> Self {
            Self {
                attrs: other.attrs.map_into(),
                vis: other.vis.ref_into(),
                struct_token: default(),
                ident: other.ident.ref_into(),
                generics: other.generics.ref_into(),
                fields: other.fields.ref_into(),
                semi_token: default_or_none(!other.fields.is_named()),
            }
        }
    }

}
