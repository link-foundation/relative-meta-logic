// A trait-bounded type parameter needs trait dispatch, which RML does not lower.
fn larger<T: PartialOrd>(left: T, right: T) -> T {
    if left > right { left } else { right }
}

fn main() {
    println!("{}", larger::<i64>(3, 4));
}
