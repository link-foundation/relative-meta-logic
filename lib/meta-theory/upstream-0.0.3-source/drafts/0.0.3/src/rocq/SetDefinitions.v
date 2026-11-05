(**
  SetDefinitions.v - Определение множеств в терминах последовательностей связей.

  Множество определяется как последовательность связей-дуплетов,
  листья которой образуют строго возрастающий список без дубликатов.

  Как и последовательность, множество идентифицируется ссылкой (Reference)
  на корень дерева в сети.

  Это ключевой шаг: имея последовательности, определённые через связи-дуплеты,
  мы теперь определяем множества как особый вид последовательностей.
  Таким образом, множества также выражены исключительно через связи.
*)

Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Require Import NetworkDefinitions.
Require Import NetworkConversions.
Require Import SequenceDefinitions.
Require Import SetSequenceEquivalence.

(** * Множества как упорядоченные уникальные последовательности связей *)

(** Множество ссылок — это ссылка (Reference) на корень дерева связей
    в сети, листья которого образуют строго возрастающий
    список без дубликатов. Как и последовательность, множество — это Reference. *)
Definition LinkSet := Reference.

(** Предикат: является ли дерево связей корректным множеством
    (упорядоченная уникальная последовательность листьев) *)
Definition IsValidSetTree (s : LinkTree) : Prop :=
  IsOrderedUniqueSequence (TreeToList s).

(** Множество из одного элемента — ссылка на сам элемент *)
Definition SingletonSet (value : Reference) : LinkSet := value.

(** Преобразование списка ссылок в множество: сортировка, удаление дубликатов,
    построение сбалансированного дерева и запись в сеть.
    Возвращает ссылку на корень (= множество) и сеть дуплетов. *)
Definition ListToSet (l : list Reference) (offset : nat)
    : option (LinkSet * NetworkDupletList) :=
  let sorted := toOrderedUnique l in
  match ListToBalancedTree sorted with
  | None => None
  | Some t => Some (TreeToSequence t offset, TreeToDupletList t offset)
  end.

(** Принадлежность элемента множеству (проверка через дерево) *)
Definition InSetTree (x : Reference) (s : LinkTree) : Prop :=
  In x (TreeToList s).

(** Подмножество: s1 ⊆ s2 (через деревья) *)
Definition IsSubsetTree (s1 s2 : LinkTree) : Prop :=
  forall x, InSetTree x s1 -> InSetTree x s2.

(** * Теорема: ListToSet всегда содержит упорядоченные уникальные элементы *)

Theorem ListToSet_elements_valid : forall l : list Reference,
  IsOrderedUniqueSequence (toOrderedUnique l).
Proof.
  intro l.
  unfold IsOrderedUniqueSequence.
  apply toOrderedUnique_is_ascending.
Qed.

(** Элемент принадлежит множеству тогда и только тогда, когда он принадлежит исходному списку *)
Theorem ListToSet_membership : forall (x : Reference) (l : list Reference),
  In x (toOrderedUnique l) <-> In x l.
Proof.
  intros x l.
  apply mem_toOrderedUnique.
Qed.

(** * Примеры *)

(** Создание множества из списка с дубликатами *)
Compute ListToSet [3; 1; 4; 1; 5; 9; 2; 6; 5; 3] 10.
(* Множество {1, 2, 3, 4, 5, 6, 9} в сети *)

(** Множество из одного элемента *)
Compute SingletonSet 42.
