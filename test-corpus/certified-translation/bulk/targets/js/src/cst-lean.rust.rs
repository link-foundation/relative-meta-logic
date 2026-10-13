// rml-certified-item js/src/cst-lean.mjs#scanBlockComment@4465 target-sha256=85b6af8736f042278d6035f99e687f1bc5dda1b45a7034140c92e1ad5b24761c
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// Reads of JavaScript arrays, which the portable core never mutates.
pub mod ml_array {
    pub fn optional_at<T: Clone>(values: &[T], index: Option<usize>) -> Option<T> {
        index.and_then(|index| values.get(index)).cloned()
    }
    /// The element at an index; a read outside the array, undefined in
    /// JavaScript, aborts.
    pub fn at<T: Clone>(values: &[T], index: Option<usize>) -> T {
        match index.and_then(|index| values.get(index)) {
            Some(value) => value.clone(),
            None => panic!("array index out of range"),
        }
    }

    /// The index a Number names: a non-negative integer, -0 included.
    pub fn number_index(index: f64) -> Option<usize> {
        if index >= 0.0 && index.fract() == 0.0 && index < 9007199254740992.0 {
            Some(index as usize)
        } else {
            None
        }
    }

    pub fn append<T>(mut left: Vec<T>, right: Vec<T>) -> Vec<T> {
        left.extend(right);
        left
    }
    fn integer(value: f64) -> f64 { if value.is_nan() { 0.0 } else { value.trunc() } }
    fn relative(value: f64, length: usize) -> usize {
        let value = integer(value);
        if value < 0.0 { (length as f64 + value).max(0.0) as usize } else { value.min(length as f64) as usize }
    }
    pub fn slice<T: Clone>(values: &[T], start: f64, end: f64) -> Vec<T> {
        let start = relative(start, values.len()); let end = relative(end, values.len());
        values[start..end.max(start)].to_vec()
    }
    pub fn index_of<T, F: Fn(&T, &T) -> bool>(values: &[T], search: &T, from: f64, reverse: bool, equal: F) -> f64 {
        if values.is_empty() { return -1.0; }
        let from = integer(from);
        if reverse {
            if from < -(values.len() as f64) { return -1.0; }
            let start = if from < 0.0 { (values.len() as f64 + from) as usize } else { from.min((values.len() - 1) as f64) as usize };
            (0..=start).rev().find(|&index| equal(&values[index], search)).map_or(-1.0, |index| index as f64)
        } else {
            let start = if from < 0.0 { (values.len() as f64 + from).max(0.0) as usize } else { from.min(values.len() as f64) as usize };
            (start..values.len()).find(|&index| equal(&values[index], search)).map_or(-1.0, |index| index as f64)
        }
    }
    pub fn includes<T, F: Fn(&T, &T) -> bool>(values: &[T], search: &T, from: f64, reverse: bool, equal: F) -> bool {
        index_of(values, search, from, reverse, equal) >= 0.0
    }
    pub fn set<T, F: Fn(&T, &T) -> bool>(values: Vec<T>, equal: F) -> Vec<T> {
        let mut out = Vec::new();
        for value in values { if !out.iter().any(|previous| equal(previous, &value)) { out.push(value); } }
        out
    }
    pub fn map<K, V, F: Fn(&K, &K) -> bool>(values: Vec<(K, V)>, equal: F) -> Vec<(K, V)> {
        let mut out: Vec<(K, V)> = Vec::new();
        for (key, value) in values {
            if let Some(index) = out.iter().position(|(previous, _)| equal(previous, &key)) { out[index].1 = value; }
            else { out.push((key, value)); }
        }
        out
    }
}

pub fn scan_block_comment(src: Vec<String>, i: f64) -> f64 {
    {
        let j = (i + 2f64);
        {
            let depth = 1f64;
            {
                let j_2 = crate::ml_scan_block_comment_loop1(src.clone(), j, depth);
                j_2
            }
        }
    }
}

pub fn ml_scan_block_comment_loop1(mut src: Vec<String>, mut j: f64, mut depth: f64) -> f64 {
    loop {
        return if ((j < ((src.len() as f64))) && (depth > (0f64))) {
            if (match (crate::ml_array::optional_at(&src, crate::ml_array::number_index(j)), String::from("/")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && match (crate::ml_array::optional_at(&src, crate::ml_array::number_index((j + 1f64))), String::from("-")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                {
                    let depth_2 = (depth + 1f64);
                    {
                        let j_2 = (j + 2f64);
                        {
                            (j, depth) = (j_2, depth_2);
                            continue;
                        }
                    }
                }
            } else {
                if (match (crate::ml_array::optional_at(&src, crate::ml_array::number_index(j)), String::from("-")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && match (crate::ml_array::optional_at(&src, crate::ml_array::number_index((j + 1f64))), String::from("/")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                    {
                        let depth_3 = (depth - 1f64);
                        {
                            let j_3 = (j + 2f64);
                            {
                                (j, depth) = (j_3, depth_3);
                                continue;
                            }
                        }
                    }
                } else {
                    {
                        let j_4 = (j + 1f64);
                        {
                            j = j_4;
                            continue;
                        }
                    }
                }
            }
        } else {
            j
        };
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
// rml-certified-item js/src/cst-lean.mjs#scanString@4747 target-sha256=f26504332cefa6847544dae10bd4234ae0032cfb76938ea7765f330449a5c0e2
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// Reads of JavaScript arrays, which the portable core never mutates.
pub mod ml_array {
    pub fn optional_at<T: Clone>(values: &[T], index: Option<usize>) -> Option<T> {
        index.and_then(|index| values.get(index)).cloned()
    }
    /// The element at an index; a read outside the array, undefined in
    /// JavaScript, aborts.
    pub fn at<T: Clone>(values: &[T], index: Option<usize>) -> T {
        match index.and_then(|index| values.get(index)) {
            Some(value) => value.clone(),
            None => panic!("array index out of range"),
        }
    }

    /// The index a Number names: a non-negative integer, -0 included.
    pub fn number_index(index: f64) -> Option<usize> {
        if index >= 0.0 && index.fract() == 0.0 && index < 9007199254740992.0 {
            Some(index as usize)
        } else {
            None
        }
    }

    pub fn append<T>(mut left: Vec<T>, right: Vec<T>) -> Vec<T> {
        left.extend(right);
        left
    }
    fn integer(value: f64) -> f64 { if value.is_nan() { 0.0 } else { value.trunc() } }
    fn relative(value: f64, length: usize) -> usize {
        let value = integer(value);
        if value < 0.0 { (length as f64 + value).max(0.0) as usize } else { value.min(length as f64) as usize }
    }
    pub fn slice<T: Clone>(values: &[T], start: f64, end: f64) -> Vec<T> {
        let start = relative(start, values.len()); let end = relative(end, values.len());
        values[start..end.max(start)].to_vec()
    }
    pub fn index_of<T, F: Fn(&T, &T) -> bool>(values: &[T], search: &T, from: f64, reverse: bool, equal: F) -> f64 {
        if values.is_empty() { return -1.0; }
        let from = integer(from);
        if reverse {
            if from < -(values.len() as f64) { return -1.0; }
            let start = if from < 0.0 { (values.len() as f64 + from) as usize } else { from.min((values.len() - 1) as f64) as usize };
            (0..=start).rev().find(|&index| equal(&values[index], search)).map_or(-1.0, |index| index as f64)
        } else {
            let start = if from < 0.0 { (values.len() as f64 + from).max(0.0) as usize } else { from.min(values.len() as f64) as usize };
            (start..values.len()).find(|&index| equal(&values[index], search)).map_or(-1.0, |index| index as f64)
        }
    }
    pub fn includes<T, F: Fn(&T, &T) -> bool>(values: &[T], search: &T, from: f64, reverse: bool, equal: F) -> bool {
        index_of(values, search, from, reverse, equal) >= 0.0
    }
    pub fn set<T, F: Fn(&T, &T) -> bool>(values: Vec<T>, equal: F) -> Vec<T> {
        let mut out = Vec::new();
        for value in values { if !out.iter().any(|previous| equal(previous, &value)) { out.push(value); } }
        out
    }
    pub fn map<K, V, F: Fn(&K, &K) -> bool>(values: Vec<(K, V)>, equal: F) -> Vec<(K, V)> {
        let mut out: Vec<(K, V)> = Vec::new();
        for (key, value) in values {
            if let Some(index) = out.iter().position(|(previous, _)| equal(previous, &key)) { out[index].1 = value; }
            else { out.push((key, value)); }
        }
        out
    }
}

pub fn scan_string(src: Vec<String>, j: f64, quote: String) -> f64 {
    {
        let ml_s1 = crate::ml_scan_string_loop1(src.clone(), j, quote.clone());
        match ml_s1.clone() {
            crate::MlScanStringLoop1Result::MlScanStringLoop1Done(j_2) => {
                j_2
            }
            crate::MlScanStringLoop1Result::MlScanStringLoop1Return(ml_result1) => {
                ml_result1
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MlScanStringLoop1Result {
    MlScanStringLoop1Done(f64),
    MlScanStringLoop1Return(f64),
}

pub fn ml_scan_string_loop1(mut src: Vec<String>, mut j: f64, mut quote: String) -> crate::MlScanStringLoop1Result {
    loop {
        return if (j < ((src.len() as f64))) {
            {
                let c = crate::ml_array::optional_at(&src, crate::ml_array::number_index(j));
                if match (c.clone(), String::from("\\")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                    {
                        let j_2 = (j + 2f64);
                        {
                            j = j_2;
                            continue;
                        }
                    }
                } else {
                    if match (c.clone(), quote.clone()) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                        crate::MlScanStringLoop1Result::MlScanStringLoop1Return((j + 1f64))
                    } else {
                        {
                            let j_3 = (j + 1f64);
                            {
                                j = j_3;
                                continue;
                            }
                        }
                    }
                }
            }
        } else {
            crate::MlScanStringLoop1Result::MlScanStringLoop1Done(j)
        };
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
// rml-certified-item js/src/cst-lean.mjs#isLeanPunctChar@6340 target-sha256=50b1b61e14ed3035e2381c6fe8d2e6b7d4390343cbe4ab143d4c8bcab86651fe
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn is_lean_punct_char(c: String) -> bool {
    (String::from("→←↦⟨⟩⟦⟧«»‹›")).contains(c.as_str())
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
// rml-certified-item js/src/cst-lean.mjs#isLeanWhitespaceChar@6491 target-sha256=180412e2958c720938bc7f0c82e221db8a7b664210dba2347454aea6761d0e1f
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

pub fn is_lean_whitespace_char(c: String) -> bool {
    (((c == " ") || (c == " ")) || (c == " "))
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
