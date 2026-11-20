// rml-certified-item js/src/rml-combinator-kernel.mjs#app@472 target-sha256=e7375751468203cb73c66cd7cc1f62e93614f1d39303045a8e646b83a31542a8
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn app(left: f64, right: f64) -> Vec<f64> {
    vec![left, right]
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
