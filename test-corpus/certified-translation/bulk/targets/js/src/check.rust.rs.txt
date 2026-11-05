// rml-certified-item js/src/check.mjs#prefixMarker@6432 target-sha256=4937703501ef36a379b973c5945e7b0292080830e565617d720a6c4f182d37de
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn prefix_marker(name: String) -> String {
    {
        let ml_switch1 = name.clone();
        if (ml_switch1 == "not") {
            String::from("not")
        } else {
            if (ml_switch1 == "and") {
                String::from("and")
            } else {
                if (ml_switch1 == "or") {
                    String::from("or")
                } else {
                    if (ml_switch1 == "+") {
                        String::from("sum")
                    } else {
                        if (ml_switch1 == "-") {
                            String::from("difference")
                        } else {
                            if (ml_switch1 == "*") {
                                String::from("product")
                            } else {
                                if (ml_switch1 == "/") {
                                    String::from("quotient")
                                } else {
                                    String::from("reduce")
                                }
                            }
                        }
                    }
                }
            }
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
// rml-certified-item js/src/check.mjs#isOk@18029 target-sha256=ad0dd15fb8ac83dc7a5d07f9e8e0eb6cae68ee6de656144412a6ab5a26b7432b
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn is_ok(result: (Vec<f64>,)) -> bool {
    (((((result.clone()).0).len() as f64)) == (0f64))
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
