// A user macro would be an implicit expansion authority; it is refused with its exact span.
macro_rules! square {
    ($x:expr) => {
        $x * $x
    };
}

fn main() {
    println!("{}", square!(7));
}
