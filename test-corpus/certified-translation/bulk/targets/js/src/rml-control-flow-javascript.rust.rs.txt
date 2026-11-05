// rml-certified-item js/src/rml-control-flow-javascript.mjs#typeOf@764 target-sha256=5362d1e1c8ef1ab5f67884f869327c19f15c44d6a30fde5fbe8e6863eac49be2
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn type_of(value: Option<f64>) -> String {
    if match (value.clone(), None::<()>) { (Some(ml_left), Some(ml_right)) => false, (None, None) => true, _ => false } {
        String::from("unit")
    } else {
        if ((match value.clone() { Some(ml_present) => { let _ = ml_present; String::from("number") }, None => String::from("object") }) == "boolean") {
            String::from("bool")
        } else {
            String::from("int")
        }
    }
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
