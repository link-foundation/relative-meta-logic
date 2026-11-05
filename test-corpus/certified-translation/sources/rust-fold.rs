// Fixed-width integer arithmetic, recursion with a decreasing argument, and let bindings.
fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

fn triangle(n: i64) -> i64 {
    if n == 0 { 0 } else { n + triangle(n - 1) }
}

fn sign(value: i64) -> i64 {
    if value == 0 { 0 } else if value > 0 { 1 } else { -1 }
}

fn main() {
    let a = gcd(84, 36);
    println!("{}", a);
    println!("{}", triangle(10));
    println!("{} {}", sign(-7), sign(a));
    assert!(triangle(4) == 10);
}
