// Enums with tuple variants, Box recursion, a module, match and assertions.
mod geometry {
    pub enum Shape {
        Square(u64),
        Rect(u64, u64),
        Group(Box<Shape>, Box<Shape>),
    }

    pub fn area(shape: Shape) -> u64 {
        match shape {
            Shape::Square(side) => side * side,
            Shape::Rect(width, height) => width * height,
            Shape::Group(first, second) => area(*first) + area(*second),
        }
    }

    pub fn count(shape: Shape) -> u64 {
        match shape {
            Shape::Group(first, second) => count(*first) + count(*second),
            _ => 1,
        }
    }
}

use crate::geometry::Shape;

fn describe(total: u64) -> String {
    if total > 100 { String::from("large") } else { String::from("small") }
}

fn main() {
    let first = Shape::Group(Box::new(Shape::Square(3)), Box::new(Shape::Rect(4, 5)));
    println!("{}", geometry::area(first));
    println!("{}", geometry::count(Shape::Group(Box::new(Shape::Square(1)), Box::new(Shape::Group(Box::new(Shape::Square(2)), Box::new(Shape::Rect(2, 3)))))));
    println!("{}", describe(geometry::area(Shape::Rect(20, 6))));
    assert_eq!(geometry::area(Shape::Square(4)), 16);
}
