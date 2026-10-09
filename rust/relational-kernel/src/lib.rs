//! A separately packaged relational foundation using RML's public data types.
//! The existing RML crate and its default execution basis are unchanged.
pub use rml::linked_program;
pub use rml::{parse_lino, parse_one, tokenize_one, Node};
pub mod horn_resolution;
pub mod relational_kernel;
