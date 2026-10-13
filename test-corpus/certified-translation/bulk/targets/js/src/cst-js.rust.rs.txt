// rml-certified-item js/src/cst-js.mjs#scanString@4808 target-sha256=1bb5316a1aa0c1b6c4e3e865816e6c0bc55df5512836b351f74f48a1a3f85489
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
                    if (match (c.clone(), String::from("\n")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && ((quote == "\"") || (quote == "'"))) {
                        crate::MlScanStringLoop1Result::MlScanStringLoop1Return(j)
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
// rml-certified-item js/src/cst-js.mjs#scanTemplate@5134 target-sha256=93f44977508b9f1f358f6744f18bbcb2788d7b7691b45b9614c83cd20d0707b7
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

pub fn scan_string(src: Vec<String>, j: f64, quote: Option<String>) -> f64 {
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

pub fn scan_template(src: Vec<String>, i: f64) -> f64 {
    {
        let j = (i + 1f64);
        {
            let ml_s2 = crate::ml_scan_template_loop2(src.clone(), j);
            match ml_s2.clone() {
                crate::MlScanTemplateLoop2Result::MlScanTemplateLoop2Done(j_2) => {
                    j_2
                }
                crate::MlScanTemplateLoop2Result::MlScanTemplateLoop2Return(ml_result2) => {
                    ml_result2
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MlScanStringLoop1Result {
    MlScanStringLoop1Done(f64),
    MlScanStringLoop1Return(f64),
}

pub fn ml_scan_string_loop1(mut src: Vec<String>, mut j: f64, mut quote: Option<String>) -> crate::MlScanStringLoop1Result {
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
                    if (match (c.clone(), String::from("\n")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && (match (quote.clone(), String::from("\"")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } || match (quote.clone(), String::from("'")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false })) {
                        crate::MlScanStringLoop1Result::MlScanStringLoop1Return(j)
                    } else {
                        if match (c.clone(), quote.clone()) { (Some(ml_left), Some(ml_right)) => ml_left == ml_right, (None, None) => true, _ => false } {
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
            }
        } else {
            crate::MlScanStringLoop1Result::MlScanStringLoop1Done(j)
        };
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MlScanTemplateLoop2Result {
    MlScanTemplateLoop2Done(f64),
    MlScanTemplateLoop2Return(f64),
}

#[derive(Clone, Debug, PartialEq)]
pub enum MlScanTemplateJoin4 {
    MlScanTemplateJoin4Next(f64, f64),
    MlScanTemplateJoin4Continue(f64, f64),
}

pub fn ml_scan_template_loop5(mut src: Vec<String>, mut j: f64) -> f64 {
    loop {
        return if ((j < ((src.len() as f64))) && !(match (crate::ml_array::optional_at(&src, crate::ml_array::number_index(j)), String::from("\n")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false })) {
            {
                let j_2 = (j + 1f64);
                {
                    j = j_2;
                    continue;
                }
            }
        } else {
            j
        };
    }
}

pub fn ml_scan_template_loop3(mut src: Vec<String>, mut j: f64, mut depth: f64) -> f64 {
    loop {
        return if ((j < ((src.len() as f64))) && (depth > (0f64))) {
            {
                let k = crate::ml_array::optional_at(&src, crate::ml_array::number_index(j));
                {
                    let ml_s3 = if match (k.clone(), String::from("{")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                        {
                            let depth_2 = (depth + 1f64);
                            crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j, depth_2)
                        }
                    } else {
                        if match (k.clone(), String::from("}")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                            {
                                let depth_3 = (depth - 1f64);
                                crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j, depth_3)
                            }
                        } else {
                            if (match (k.clone(), String::from("\"")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } || match (k.clone(), String::from("'")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                                {
                                    let j_2 = (crate::scan_string(src.clone(), (j + 1f64), k.clone()) - 1f64);
                                    crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j_2, depth)
                                }
                            } else {
                                if match (k.clone(), String::from("`")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                                    {
                                        let j_3 = (crate::scan_template(src.clone(), j) - 1f64);
                                        crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j_3, depth)
                                    }
                                } else {
                                    if (match (k.clone(), String::from("/")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && match (crate::ml_array::optional_at(&src, crate::ml_array::number_index((j + 1f64))), String::from("/")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                                        {
                                            let j_4 = crate::ml_scan_template_loop5(src.clone(), j);
                                            crate::MlScanTemplateJoin4::MlScanTemplateJoin4Continue(j_4, depth)
                                        }
                                    } else {
                                        if (match (k.clone(), String::from("/")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && match (crate::ml_array::optional_at(&src, crate::ml_array::number_index((j + 1f64))), String::from("*")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                                            {
                                                let e = crate::ml_array::index_of(&src, &String::from("*/"), (j + 2f64), false, |a, b| a == b);
                                                {
                                                    let j_5 = if (e == ((-1f64))) {
                                                        (src.len() as f64)
                                                    } else {
                                                        (e + 2f64)
                                                    };
                                                    crate::MlScanTemplateJoin4::MlScanTemplateJoin4Continue(j_5, depth)
                                                }
                                            }
                                        } else {
                                            crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j, depth)
                                        }
                                    }
                                }
                            }
                        }
                    };
                    match ml_s3.clone() {
                        crate::MlScanTemplateJoin4::MlScanTemplateJoin4Next(j_6, depth_4) => {
                            {
                                let j_7 = (j_6 + 1f64);
                                {
                                    (j, depth) = (j_7, depth_4);
                                    continue;
                                }
                            }
                        }
                        crate::MlScanTemplateJoin4::MlScanTemplateJoin4Continue(j_8, depth_5) => {
                            {
                                (j, depth) = (j_8, depth_5);
                                continue;
                            }
                        }
                    }
                }
            }
        } else {
            j
        };
    }
}

pub fn ml_scan_template_loop2(mut src: Vec<String>, mut j: f64) -> crate::MlScanTemplateLoop2Result {
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
                    if match (c.clone(), String::from("`")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } {
                        crate::MlScanTemplateLoop2Result::MlScanTemplateLoop2Return((j + 1f64))
                    } else {
                        if (match (c.clone(), String::from("$")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false } && match (crate::ml_array::optional_at(&src, crate::ml_array::number_index((j + 1f64))), String::from("{")) { (Some(ml_left), ml_right) => ml_left == ml_right, _ => false }) {
                            {
                                let j_3 = (j + 2f64);
                                {
                                    let depth = 1f64;
                                    {
                                        let j_4 = crate::ml_scan_template_loop3(src.clone(), j_3, depth);
                                        {
                                            j = j_4;
                                            continue;
                                        }
                                    }
                                }
                            }
                        } else {
                            {
                                let j_5 = (j + 1f64);
                                {
                                    j = j_5;
                                    continue;
                                }
                            }
                        }
                    }
                }
            }
        } else {
            crate::MlScanTemplateLoop2Result::MlScanTemplateLoop2Done(j)
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
// rml-certified-item js/src/cst-js.mjs#isUnicodeIdStart@7843 target-sha256=32fcab93970c7ae30bef223a854a04d8cc83646c23d717dd66f30346f293483b
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// JavaScript strings retain every UTF-16 code unit, including isolated surrogates.
pub mod ml_string {
    #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
    pub struct Text(pub Vec<u16>);

    impl std::fmt::Display for Text {
        fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            out.write_str(&String::from_utf16_lossy(&self.0))
        }
    }

    impl Text {
        pub fn from_text(text: &str) -> Self { Self(text.encode_utf16().collect()) }
        pub fn from_units(units: Vec<u16>) -> Self { Self(units) }
        pub fn length(&self) -> f64 { self.0.len() as f64 }
        pub fn concat(&self, other: &Self) -> Self {
            let mut units = self.0.clone(); units.extend_from_slice(&other.0); Self(units)
        }
        pub fn starts_with(&self, search: &Self) -> bool { self.0.starts_with(&search.0) }
        pub fn ends_with(&self, search: &Self) -> bool { self.0.ends_with(&search.0) }
        pub fn contains(&self, search: &Self) -> bool { self.index_of(search, 0.0) >= 0.0 }
        pub fn slice(&self, start: f64, end: f64) -> Self {
            let first = relative(start, self.0.len()); let last = relative(end, self.0.len());
            Self(self.0[first..last.max(first)].to_vec())
        }
        pub fn index_of(&self, search: &Self, position: f64) -> f64 {
            let start = absolute(position, self.0.len());
            if search.0.is_empty() { return start as f64; }
            if search.0.len() > self.0.len() { return -1.0; }
            (start..=self.0.len() - search.0.len()).find(|&index| self.0[index..].starts_with(&search.0)).map_or(-1.0, |index| index as f64)
        }
        pub fn last_index_of(&self, search: &Self, position: f64) -> f64 {
            let position = if position.is_nan() { f64::INFINITY } else { position };
            let start = absolute(position, self.0.len());
            if search.0.is_empty() { return start as f64; }
            if search.0.len() > self.0.len() { return -1.0; }
            (0..=start.min(self.0.len() - search.0.len())).rev().find(|&index| self.0[index..].starts_with(&search.0)).map_or(-1.0, |index| index as f64)
        }
        pub fn split(&self, separator: Option<&Self>, limit: f64) -> Vec<Self> {
            let maximum = uint32(limit) as usize;
            if maximum == 0 { return Vec::new(); }
            let separator = match separator { Some(value) => value, None => return vec![self.clone()] };
            if separator.0.is_empty() { return self.0.iter().take(maximum).map(|&unit| Self(vec![unit])).collect(); }
            let mut out = Vec::new(); let mut start = 0;
            loop {
                let index = self.index_of(separator, start as f64);
                if index < 0.0 { break; }
                out.push(Self(self.0[start..index as usize].to_vec()));
                if out.len() == maximum { return out; }
                start = index as usize + separator.0.len();
            }
            out.push(Self(self.0[start..].to_vec())); out
        }
        pub fn code_point_at(&self, position: f64) -> Option<f64> {
            let index = integer(position);
            if index < 0.0 || index >= self.0.len() as f64 { return None; }
            let index = index as usize; let first = self.0[index];
            if (0xd800..=0xdbff).contains(&first) {
                if let Some(&second) = self.0.get(index + 1) {
                    if (0xdc00..=0xdfff).contains(&second) { return Some(((first as u32 - 0xd800) * 1024 + second as u32 - 0xdc00 + 0x10000) as f64); }
                }
            }
            Some(first as f64)
        }
        pub fn code_points(&self) -> Vec<Self> {
            let mut out = Vec::new(); let mut index = 0;
            while index < self.0.len() {
                let first = self.0[index];
                let width = if (0xd800..=0xdbff).contains(&first) && self.0.get(index + 1).map_or(false, |second| (0xdc00..=0xdfff).contains(second)) { 2 } else { 1 };
                out.push(Self(self.0[index..index + width].to_vec())); index += width;
            }
            out
        }
        pub fn repeat(&self, count: f64) -> Self {
            let count = integer(count);
            if count < 0.0 || !count.is_finite() { panic!("Invalid count value: {}", count); }
            if self.0.is_empty() { return Self(Vec::new()); }
            let size = count * self.0.len() as f64;
            if size > 536870888.0 { panic!("Invalid string length"); }
            Self(self.0.repeat(count as usize))
        }
        pub fn pad(&self, length: f64, fill: &Self, start: bool) -> Self {
            let length = integer(length).max(0.0);
            if length <= self.0.len() as f64 || fill.0.is_empty() { return self.clone(); }
            if length > 536870888.0 { panic!("Invalid string length"); }
            let count = length as usize - self.0.len();
            let padding: Vec<u16> = fill.0.iter().copied().cycle().take(count).collect();
            let pad = Self(padding); if start { pad.concat(self) } else { self.concat(&pad) }
        }
        pub fn replace(&self, search: &Self, replacement: &Self, all: bool) -> Self {
            let mut out = Vec::new(); let mut start = 0; let mut from = 0;
            loop {
                let index = self.index_of(search, from as f64);
                if index < 0.0 { break; }
                let index = index as usize;
                out.extend_from_slice(&self.0[start..index]);
                substitute(&mut out, &self.0, &search.0, &replacement.0, index);
                start = index + search.0.len();
                if !all || (search.0.is_empty() && index == self.0.len()) { break; }
                from = start + usize::from(search.0.is_empty());
            }
            out.extend_from_slice(&self.0[start..]); Self(out)
        }
        pub fn trim(&self, start: bool, end: bool, rust: bool) -> Self {
            let whitespace = |unit: u16| char::from_u32(unit as u32).map_or(false, |c| if rust { c.is_whitespace() } else { (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}' });
            let mut first = 0; let mut last = self.0.len();
            if start { while first < last && whitespace(self.0[first]) { first += 1; } }
            if end { while last > first && whitespace(self.0[last - 1]) { last -= 1; } }
            Self(self.0[first..last].to_vec())
        }
        pub fn map_case(&self, upper: bool) -> Self {
            let mut out = Vec::new(); let mut run = String::new();
            let flush = |run: &mut String, out: &mut Vec<u16>| { let mapped = if upper { run.to_uppercase() } else { run.to_lowercase() }; out.extend(mapped.encode_utf16()); run.clear(); };
            for scalar in char::decode_utf16(self.0.iter().copied()) {
                match scalar { Ok(c) => run.push(c), Err(error) => { flush(&mut run, &mut out); out.push(error.unpaired_surrogate()); } }
            }
            flush(&mut run, &mut out); Self(out)
        }
    }
    pub fn join(values: &[Text], separator: &Text) -> Text {
        let mut units = Vec::new();
        for (index, value) in values.iter().enumerate() { if index != 0 { units.extend_from_slice(&separator.0); } units.extend_from_slice(&value.0); }
        Text(units)
    }
    pub fn integer(value: f64) -> f64 { if value.is_nan() { 0.0 } else { value.trunc() } }
    pub fn absolute(value: f64, length: usize) -> usize { integer(value).max(0.0).min(length as f64) as usize }
    pub fn relative(value: f64, length: usize) -> usize { let value = integer(value); if value < 0.0 { (length as f64 + value).max(0.0) as usize } else { value.min(length as f64) as usize } }
    fn uint32(value: f64) -> u32 { if !value.is_finite() || value == 0.0 { 0 } else { value.trunc().rem_euclid(4294967296.0) as u32 } }
    fn substitute(out: &mut Vec<u16>, text: &[u16], search: &[u16], replacement: &[u16], position: usize) {
        let mut index = 0;
        while index < replacement.len() {
            if replacement[index] == 36 && index + 1 < replacement.len() {
                match replacement[index + 1] {
                    36 => { out.push(36); index += 2; continue; }
                    38 => { out.extend_from_slice(search); index += 2; continue; }
                    96 => { out.extend_from_slice(&text[..position]); index += 2; continue; }
                    39 => { out.extend_from_slice(&text[position + search.len()..]); index += 2; continue; }
                    _ => {}
                }
            }
            out.push(replacement[index]); index += 1;
        }
    }
}

pub fn is_unicode_id_start(c: crate::ml_string::Text) -> bool {
    if !(!c.0.is_empty()) {
        false
    } else {
        ((match c.code_point_at(0f64) { Some(ml_present) => ml_present, None => f64::NAN }) > (127f64))
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
// rml-certified-item js/src/cst-js.mjs#isUnicodeIdContinue@7935 target-sha256=4b72116b6723266c23ca1bbcd5cb1520e3a62d1b2ebec3c33bfbc4876af332a2
// Translated from JavaScript by meta-language: portable core, Rust target.
#![allow(unused, unreachable_patterns, non_snake_case, non_camel_case_types, invalid_nan_comparisons)]

/// JavaScript strings retain every UTF-16 code unit, including isolated surrogates.
pub mod ml_string {
    #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
    pub struct Text(pub Vec<u16>);

    impl std::fmt::Display for Text {
        fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            out.write_str(&String::from_utf16_lossy(&self.0))
        }
    }

    impl Text {
        pub fn from_text(text: &str) -> Self { Self(text.encode_utf16().collect()) }
        pub fn from_units(units: Vec<u16>) -> Self { Self(units) }
        pub fn length(&self) -> f64 { self.0.len() as f64 }
        pub fn concat(&self, other: &Self) -> Self {
            let mut units = self.0.clone(); units.extend_from_slice(&other.0); Self(units)
        }
        pub fn starts_with(&self, search: &Self) -> bool { self.0.starts_with(&search.0) }
        pub fn ends_with(&self, search: &Self) -> bool { self.0.ends_with(&search.0) }
        pub fn contains(&self, search: &Self) -> bool { self.index_of(search, 0.0) >= 0.0 }
        pub fn slice(&self, start: f64, end: f64) -> Self {
            let first = relative(start, self.0.len()); let last = relative(end, self.0.len());
            Self(self.0[first..last.max(first)].to_vec())
        }
        pub fn index_of(&self, search: &Self, position: f64) -> f64 {
            let start = absolute(position, self.0.len());
            if search.0.is_empty() { return start as f64; }
            if search.0.len() > self.0.len() { return -1.0; }
            (start..=self.0.len() - search.0.len()).find(|&index| self.0[index..].starts_with(&search.0)).map_or(-1.0, |index| index as f64)
        }
        pub fn last_index_of(&self, search: &Self, position: f64) -> f64 {
            let position = if position.is_nan() { f64::INFINITY } else { position };
            let start = absolute(position, self.0.len());
            if search.0.is_empty() { return start as f64; }
            if search.0.len() > self.0.len() { return -1.0; }
            (0..=start.min(self.0.len() - search.0.len())).rev().find(|&index| self.0[index..].starts_with(&search.0)).map_or(-1.0, |index| index as f64)
        }
        pub fn split(&self, separator: Option<&Self>, limit: f64) -> Vec<Self> {
            let maximum = uint32(limit) as usize;
            if maximum == 0 { return Vec::new(); }
            let separator = match separator { Some(value) => value, None => return vec![self.clone()] };
            if separator.0.is_empty() { return self.0.iter().take(maximum).map(|&unit| Self(vec![unit])).collect(); }
            let mut out = Vec::new(); let mut start = 0;
            loop {
                let index = self.index_of(separator, start as f64);
                if index < 0.0 { break; }
                out.push(Self(self.0[start..index as usize].to_vec()));
                if out.len() == maximum { return out; }
                start = index as usize + separator.0.len();
            }
            out.push(Self(self.0[start..].to_vec())); out
        }
        pub fn code_point_at(&self, position: f64) -> Option<f64> {
            let index = integer(position);
            if index < 0.0 || index >= self.0.len() as f64 { return None; }
            let index = index as usize; let first = self.0[index];
            if (0xd800..=0xdbff).contains(&first) {
                if let Some(&second) = self.0.get(index + 1) {
                    if (0xdc00..=0xdfff).contains(&second) { return Some(((first as u32 - 0xd800) * 1024 + second as u32 - 0xdc00 + 0x10000) as f64); }
                }
            }
            Some(first as f64)
        }
        pub fn code_points(&self) -> Vec<Self> {
            let mut out = Vec::new(); let mut index = 0;
            while index < self.0.len() {
                let first = self.0[index];
                let width = if (0xd800..=0xdbff).contains(&first) && self.0.get(index + 1).map_or(false, |second| (0xdc00..=0xdfff).contains(second)) { 2 } else { 1 };
                out.push(Self(self.0[index..index + width].to_vec())); index += width;
            }
            out
        }
        pub fn repeat(&self, count: f64) -> Self {
            let count = integer(count);
            if count < 0.0 || !count.is_finite() { panic!("Invalid count value: {}", count); }
            if self.0.is_empty() { return Self(Vec::new()); }
            let size = count * self.0.len() as f64;
            if size > 536870888.0 { panic!("Invalid string length"); }
            Self(self.0.repeat(count as usize))
        }
        pub fn pad(&self, length: f64, fill: &Self, start: bool) -> Self {
            let length = integer(length).max(0.0);
            if length <= self.0.len() as f64 || fill.0.is_empty() { return self.clone(); }
            if length > 536870888.0 { panic!("Invalid string length"); }
            let count = length as usize - self.0.len();
            let padding: Vec<u16> = fill.0.iter().copied().cycle().take(count).collect();
            let pad = Self(padding); if start { pad.concat(self) } else { self.concat(&pad) }
        }
        pub fn replace(&self, search: &Self, replacement: &Self, all: bool) -> Self {
            let mut out = Vec::new(); let mut start = 0; let mut from = 0;
            loop {
                let index = self.index_of(search, from as f64);
                if index < 0.0 { break; }
                let index = index as usize;
                out.extend_from_slice(&self.0[start..index]);
                substitute(&mut out, &self.0, &search.0, &replacement.0, index);
                start = index + search.0.len();
                if !all || (search.0.is_empty() && index == self.0.len()) { break; }
                from = start + usize::from(search.0.is_empty());
            }
            out.extend_from_slice(&self.0[start..]); Self(out)
        }
        pub fn trim(&self, start: bool, end: bool, rust: bool) -> Self {
            let whitespace = |unit: u16| char::from_u32(unit as u32).map_or(false, |c| if rust { c.is_whitespace() } else { (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}' });
            let mut first = 0; let mut last = self.0.len();
            if start { while first < last && whitespace(self.0[first]) { first += 1; } }
            if end { while last > first && whitespace(self.0[last - 1]) { last -= 1; } }
            Self(self.0[first..last].to_vec())
        }
        pub fn map_case(&self, upper: bool) -> Self {
            let mut out = Vec::new(); let mut run = String::new();
            let flush = |run: &mut String, out: &mut Vec<u16>| { let mapped = if upper { run.to_uppercase() } else { run.to_lowercase() }; out.extend(mapped.encode_utf16()); run.clear(); };
            for scalar in char::decode_utf16(self.0.iter().copied()) {
                match scalar { Ok(c) => run.push(c), Err(error) => { flush(&mut run, &mut out); out.push(error.unpaired_surrogate()); } }
            }
            flush(&mut run, &mut out); Self(out)
        }
    }
    pub fn join(values: &[Text], separator: &Text) -> Text {
        let mut units = Vec::new();
        for (index, value) in values.iter().enumerate() { if index != 0 { units.extend_from_slice(&separator.0); } units.extend_from_slice(&value.0); }
        Text(units)
    }
    pub fn integer(value: f64) -> f64 { if value.is_nan() { 0.0 } else { value.trunc() } }
    pub fn absolute(value: f64, length: usize) -> usize { integer(value).max(0.0).min(length as f64) as usize }
    pub fn relative(value: f64, length: usize) -> usize { let value = integer(value); if value < 0.0 { (length as f64 + value).max(0.0) as usize } else { value.min(length as f64) as usize } }
    fn uint32(value: f64) -> u32 { if !value.is_finite() || value == 0.0 { 0 } else { value.trunc().rem_euclid(4294967296.0) as u32 } }
    fn substitute(out: &mut Vec<u16>, text: &[u16], search: &[u16], replacement: &[u16], position: usize) {
        let mut index = 0;
        while index < replacement.len() {
            if replacement[index] == 36 && index + 1 < replacement.len() {
                match replacement[index + 1] {
                    36 => { out.push(36); index += 2; continue; }
                    38 => { out.extend_from_slice(search); index += 2; continue; }
                    96 => { out.extend_from_slice(&text[..position]); index += 2; continue; }
                    39 => { out.extend_from_slice(&text[position + search.len()..]); index += 2; continue; }
                    _ => {}
                }
            }
            out.push(replacement[index]); index += 1;
        }
    }
}

pub fn is_unicode_id_start(c: crate::ml_string::Text) -> bool {
    if !(!c.0.is_empty()) {
        false
    } else {
        ((match c.code_point_at(0f64) { Some(ml_present) => ml_present, None => f64::NAN }) > (127f64))
    }
}

pub fn is_unicode_id_continue(c: crate::ml_string::Text) -> bool {
    crate::is_unicode_id_start(c.clone())
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
