-- Structures, structure instances, field reads and explicitly instantiated type parameters.
structure Point where
  x : Nat
  y : Nat

structure Segment where
  start : Point
  stop : Point

inductive Pairs (α : Type) where
  | done : Pairs α
  | more : α → α → Pairs α → Pairs α

def count (α : Type) : Pairs α → Nat
  | Pairs.done => 0
  | Pairs.more _ _ rest => 1 + count α rest

def norm (p : Point) : Nat := p.x + p.y

def span (s : Segment) : Nat := s.stop.x - s.start.x

def main : IO Unit := do
  IO.println (norm { x := 3, y := 4 })
  IO.println (span { start := { x := 1, y := 0 }, stop := { y := 9, x := 6 } })
  IO.println ({ x := 2, y := 5 : Point }).y
  IO.println (count Nat (@Pairs.more Nat 1 2 (@Pairs.done Nat)))
  IO.println (count String (@Pairs.done String))
