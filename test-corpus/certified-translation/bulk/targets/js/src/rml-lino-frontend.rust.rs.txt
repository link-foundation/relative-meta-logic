// rml-certified-item js/src/rml-lino-frontend.mjs#isIndentedIdItem@18157 target-sha256=7f941136b30cf85a8721606edb1a7210b7a09168c5632c01033cfb6cc55e1234
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// A nullable value retains the distinct JavaScript null and undefined cases.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MlOptional<T> { Value(T), Null, Undefined }

pub fn is_indented_id_item(item: (crate::MlOptional<f64>, Vec<f64>)) -> bool {
    ((!(match ((item.clone()).0, None::<()>) { (crate::MlOptional::Value(ml_left), Some(ml_right)) => false, (crate::MlOptional::Null, None) => false, (crate::MlOptional::Undefined, None) => true, _ => false }) && !(match ((item.clone()).0, None::<()>) { (crate::MlOptional::Value(ml_left), Some(ml_right)) => false, (crate::MlOptional::Null, None) => true, (crate::MlOptional::Undefined, None) => false, _ => false })) && (!({ let _ = (item.clone()).1; true }) || (((((item.clone()).1).len() as f64)) == (0f64))))
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
