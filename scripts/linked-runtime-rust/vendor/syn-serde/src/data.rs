// SPDX-License-Identifier: Apache-2.0 OR MIT

use super::*;

impl Fields {
    pub(crate) fn is_named(&self) -> bool {
        match self {
            Fields::Named(_) => true,
            Fields::Unnamed(_) | Fields::Unit => false,
        }
    }
}

// assertions
// `syn::perse*` functions will detect these, but there is a possibility to
// generate incorrect code by subsequent operations.
pub(crate) fn assert_struct_semi(fields: &Fields, semi_token: bool) {
    match fields {
        // struct foo {};
        Fields::Named(_) => assert!(!semi_token, "unexpected token: `;`"),
        // struct foo ()
        Fields::Unnamed(_) => {
            assert!(semi_token, "unexpected end of input, expected `where` or `;`");
        }
        // struct foo
        Fields::Unit => assert!(
            semi_token,
            "unexpected end of input, expected one of: `where`, parentheses, curly braces, `;`"
        ),
    }
}
