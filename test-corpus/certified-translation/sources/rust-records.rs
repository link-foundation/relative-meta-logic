// Named and tuple structs, struct variants, struct literals, struct patterns and field reads.
#[derive(Clone, Copy)]
struct Point {
    x: i64,
    y: i64,
}

struct Pair(i64, i64);

enum Shape {
    Circle { radius: i64 },
    Rect { corner: Point, width: i64, height: i64 },
}

fn manhattan(point: Point) -> i64 {
    point.x + point.y
}

fn swap(pair: Pair) -> Pair {
    match pair {
        Pair(first, second) => Pair(second, first),
    }
}

fn area(shape: Shape) -> i64 {
    match shape {
        Shape::Circle { radius } => 3 * radius * radius,
        Shape::Rect { width, height, .. } => width * height,
    }
}

fn corner_sum(shape: Shape) -> i64 {
    match shape {
        Shape::Rect { corner: Point { x, y }, .. } => x + y,
        _ => 0,
    }
}

fn main() {
    let corner = Point { x: 3, y: 4 };
    println!("{}", manhattan(corner));
    let x = corner.x;
    println!("{}", x);
    let pair: Pair = swap(Pair(1, 2));
    println!("{}", pair.0);
    println!("{}", area(Shape::Rect { corner: Point { x: 1, y: 2 }, width: 5, height: 6 }));
    println!("{}", area(Shape::Circle { radius: 2 }));
    println!("{}", corner_sum(Shape::Rect { corner, width: 1, height: 1 }));
    assert_eq!(manhattan(Point { x: -2, y: 2 }), 0);
}
