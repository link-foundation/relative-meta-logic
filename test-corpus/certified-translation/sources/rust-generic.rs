// Explicitly instantiated generic enums, structs and functions; RML monomorphizes each instantiation.
enum List<T> {
    Nil,
    Cons(T, Box<List<T>>),
}

struct Tagged<T> {
    tag: i64,
    value: T,
}

fn length<T>(list: List<T>) -> i64 {
    match list {
        List::Nil => 0,
        List::Cons(_, rest) => 1 + length::<T>(*rest),
    }
}

fn sum(list: List<i64>) -> i64 {
    match list {
        List::Nil => 0,
        List::Cons(head, rest) => head + sum(*rest),
    }
}

fn identity<T>(value: T) -> T {
    value
}

fn main() {
    let numbers = List::<i64>::Cons(1, Box::new(List::<i64>::Cons(2, Box::new(List::<i64>::Cons(3, Box::new(List::<i64>::Nil))))));
    println!("{}", sum(numbers));
    let flags = List::<bool>::Cons(true, Box::new(List::<bool>::Nil));
    println!("{}", length::<bool>(flags));
    let tagged = Tagged::<i64> { tag: 7, value: identity::<i64>(35) };
    println!("{}", tagged.tag + tagged.value);
    println!("{}", identity::<String>(String::from("generic")));
}
