//! Public companion package for checked control-flow semantics. No change to
//! the main crate's frozen manifest or module exports is required.
pub use rml_base::{lino_frontend, meta_language_support};
pub mod control_flow;
pub use control_flow::{ControlFlowError, ControlFlowProgram, CONTROL_FLOW_SCHEMA};
