// Two structs declare `x` and the receiver has no annotation, so the field's owner needs type inference RML does not perform.
struct Point {
    x: i64,
    y: i64,
}

struct Interval {
    x: i64,
    width: i64,
}

fn make() -> Point {
    Point { x: 1, y: 2 }
}

fn main() {
    let point = make();
    println!("{}", point.x);
    println!("{}", Interval { x: 0, width: 3 }.width);
}
