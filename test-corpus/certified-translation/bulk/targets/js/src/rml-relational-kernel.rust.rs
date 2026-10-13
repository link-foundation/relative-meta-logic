// rml-certified-item js/src/rml-relational-kernel.mjs#cons@190 target-sha256=df065b0ba01137d85fb48693d3e8b60a125656671a2b7d3dcb7401dda89e4393
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn cons(head: String, tail: String) -> Vec<String> {
    vec![String::from("cons"), head.clone(), tail.clone()]
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
