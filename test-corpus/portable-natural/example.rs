fn rml_square(x: u64) -> u64 { (x * x) }
fn rml_mix(x: u64, y: u64) -> u64 { (if (x <= y) { (rml_square(x) + y) } else { (rml_square(y) + x) }) }
fn rml_guard(x: u64, y: u64) -> u64 { (if (x == y) { 0 } else { (if (x < y) { (rml_mix(x, y) + 1) } else { (rml_mix(y, x) * 2) }) }) }
