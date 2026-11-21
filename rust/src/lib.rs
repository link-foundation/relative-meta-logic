#![cfg_attr(not(feature = "std"), no_std)]
//! Relative Meta-Logic (RML) over Links Notation.
//!
//! Enable `core` with default features disabled to use the [probability API](probability)
//! with `core` and `alloc` on targets such as `wasm32-unknown-unknown`.

#[cfg(feature = "core")]
extern crate alloc;

#[cfg(feature = "core")]
pub mod probability;

// Keep the evaluator and its exports at the crate root for existing users.
#[cfg(feature = "std")]
include!("full.rs");
