// Functional record update copies fields the program never names; RML refuses it rather than guess them.
#[derive(Clone, Copy)]
struct Point {
    x: i64,
    y: i64,
}

fn main() {
    let origin = Point { x: 0, y: 0 };
    let moved = Point { x: 5, ..origin };
    println!("{}", moved.x + moved.y);
}
