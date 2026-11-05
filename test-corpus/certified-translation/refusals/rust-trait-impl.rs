// Traits grant dispatch authority; the certified pipeline must refuse them, not guess an implementation.
trait Area {
    fn area(&self) -> u64;
}

enum Shape {
    Square(u64),
}

impl Area for Shape {
    fn area(&self) -> u64 {
        match self {
            Shape::Square(side) => side * side,
        }
    }
}

fn main() {
    println!("{}", Shape::Square(3).area());
}
