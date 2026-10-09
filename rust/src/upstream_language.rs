//! Official released four-language grammar, project and editing APIs.
//!
//! These are upstream implementations. A translation is semantic only when its
//! `semantics()` is present; retain all upstream assumptions, obligations and
//! diagnostics. Portable source envelopes do not establish behavior preservation.

pub use meta_language::{
    analyze_program, construct_program, construct_program_from_fragments,
    decode_program_translation, language_support, read_translation_provenance, translate_program,
    translation_contracts, ProgramBinding, ProgramConstruct, ProgramConstructStatus,
    ProgramProjectContext, ProgramProjectSource, ProgramRange, ProgramRepresentation,
    ProgramRepresentationError, ProgramTranslation, ProgramTranslationError, RepresentationLevel,
    TranslationSupport, FOUR_LANGUAGE_SUPPORT,
};

pub const META_LANGUAGE_SOURCE_REVISION: &str = "a79782093cae3b33606483ac9f3e1d05faf36de0";
