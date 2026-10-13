// rml-certified-item js/src/rml-meta-structure.mjs#isProfileLink@6882 target-sha256=7846aec6dbf535b65e5ea6d197682ff36f24b46fff86d70c9c1e629425d962f9
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// A nullable value retains the distinct JavaScript null and undefined cases.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MlOptional<T> { Value(T), Null, Undefined }

pub fn is_profile_link(metadata: (crate::MlOptional<String>,)) -> bool {
    (match (metadata.clone()).0 { crate::MlOptional::Value(ml_value) => ml_value, _ => String::from("") }).starts_with("language-profile")
}

fn ml_main() {

}

// Deep recursion in the source is not bounded by a small native stack.
fn main() {
    let check = std::env::args().any(|argument| argument == "--ml-check-theorems");
    let worker = std::thread::Builder::new()
        .stack_size(1 << 28)
        .spawn(move || { ml_main() })
        .expect("spawn the program thread");
    if worker.join().is_err() {
        std::process::exit(101);
    }
}
