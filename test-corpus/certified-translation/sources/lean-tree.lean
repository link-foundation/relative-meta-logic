-- Inductive trees in a namespace, structural recursion, and a closed theorem.
namespace Shapes

inductive Tree where
  | leaf : Nat → Tree
  | node : Tree → Tree → Tree

def sum : Tree → Nat
  | Tree.leaf value => value
  | Tree.node left right => sum left + sum right

def size (tree : Tree) : Nat :=
  match tree with
  | Tree.leaf _ => 1
  | Tree.node left right => size left + size right

end Shapes

def double (n : Nat) : Nat := n + n

theorem double_two : double 2 = 4 := by decide

def main : IO Unit := do
  IO.println (Shapes.sum (Shapes.Tree.node (Shapes.Tree.leaf 2) (Shapes.Tree.node (Shapes.Tree.leaf 3) (Shapes.Tree.leaf 4))))
  IO.println (Shapes.size (Shapes.Tree.node (Shapes.Tree.leaf 2) (Shapes.Tree.leaf 5)))
  IO.println (double 21)
