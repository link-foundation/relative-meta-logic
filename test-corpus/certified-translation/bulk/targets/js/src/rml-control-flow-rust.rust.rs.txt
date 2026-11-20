// rml-certified-item js/src/rml-control-flow-rust.mjs#id@1000 target-sha256=66e7899664733bcaa7dc39275bcac4249444bfd68f36564c374fdb74d45265d6
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn id(name: f64) -> (f64, String) {
    {
        let ml_field1 = String::from("Identifier");
        {
            let ml_field2 = name;
            (ml_field2, ml_field1.clone())
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
// rml-certified-item js/src/rml-control-flow-rust.mjs#literal@1043 target-sha256=3016d7dceab461dd918b626ca35f975de755ff9c0c4ce5a823ad031fb2744f2f
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn literal(value: f64) -> (String, f64) {
    {
        let ml_field1 = if ("number" == "boolean") {
            String::from("BooleanLiteral")
        } else {
            String::from("NumericLiteral")
        };
        {
            let ml_field2 = value;
            (ml_field1.clone(), ml_field2)
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
// rml-certified-item js/src/rml-control-flow-rust.mjs#block@1139 target-sha256=3c050c5dfef2fdaf17c507b6d4cdf66e9d29007a85f44daec501d36d4445f78d
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn block(body: f64) -> (f64, Vec<f64>, String) {
    {
        let ml_field1 = String::from("BlockStatement");
        {
            let ml_field2 = body;
            {
                let ml_field3 = Vec::<f64>::new();
                (ml_field2, ml_field3.clone(), ml_field1.clone())
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
// rml-certified-item js/src/rml-control-flow-rust.mjs#expressionStatement@1203 target-sha256=53cb2c3576e3f908c3677b603314e7ce401e687ead9265bb9e121480940d92db
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn expression_statement(expression: f64) -> (f64, String) {
    {
        let ml_field1 = String::from("ExpressionStatement");
        {
            let ml_field2 = expression;
            (ml_field2, ml_field1.clone())
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
// rml-certified-item js/src/rml-control-flow-rust.mjs#declaration@1284 target-sha256=b917ff16eb635120f1dbe38c903db652e1938a5f6a6e4746b4221e94f47a1037
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn id(name: f64) -> std::rc::Rc<std::cell::RefCell<(f64, String)>> {
    std::rc::Rc::new(std::cell::RefCell::new({
        let ml_field1 = String::from("Identifier");
        {
            let ml_field2 = name;
            (ml_field2, ml_field1.clone())
        }
    }))
}

pub fn declaration(name: f64, init: f64, mutable: bool) -> std::rc::Rc<std::cell::RefCell<(std::rc::Rc<std::cell::RefCell<Vec<std::rc::Rc<std::cell::RefCell<(std::rc::Rc<std::cell::RefCell<(f64, String)>>, f64, String)>>>>>, String, String)>> {
    std::rc::Rc::new(std::cell::RefCell::new({
        let ml_field3 = String::from("VariableDeclaration");
        {
            let ml_field4 = if mutable {
                String::from("let")
            } else {
                String::from("const")
            };
            {
                let ml_field8 = std::rc::Rc::new(std::cell::RefCell::new(vec![std::rc::Rc::new(std::cell::RefCell::new({
                    let ml_field5 = String::from("VariableDeclarator");
                    {
                        let ml_field6 = crate::id(name);
                        {
                            let ml_field7 = init;
                            (ml_field6.clone(), ml_field7, ml_field5.clone())
                        }
                    }
                }))]));
                (ml_field8.clone(), ml_field4.clone(), ml_field3.clone())
            }
        }
    }))
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
// rml-certified-item js/src/rml-control-flow-rust.mjs#binary@1448 target-sha256=85fda8e13af26f442da281f6ef1bfa456b1a88f49fcbcdd1a13ea8200af7f94c
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn binary(operator: f64, left: f64, right: f64) -> (f64, f64, f64, String) {
    {
        let ml_field1 = String::from("BinaryExpression");
        {
            let ml_field2 = operator;
            {
                let ml_field3 = left;
                {
                    let ml_field4 = right;
                    (ml_field3, ml_field2, ml_field4, ml_field1.clone())
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
