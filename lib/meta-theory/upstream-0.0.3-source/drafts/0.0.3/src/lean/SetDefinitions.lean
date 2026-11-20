/-
  SetDefinitions.lean - Определение множеств в терминах последовательностей связей.

  Множество определяется как последовательность связей-дуплетов,
  листья которой образуют строго возрастающий список без дубликатов.

  Как и последовательность, множество идентифицируется ссылкой (Reference)
  на корень дерева в сети.

  Это ключевой шаг: имея последовательности, определённые через связи-дуплеты,
  мы теперь определяем множества как особый вид последовательностей.
  Таким образом, множества также выражены исключительно через связи.
-/
import NetworkDefinitions
import NetworkConversions
import SequenceDefinitions
import SetSequenceEquivalence

open SetSequenceEquivalence

-- * Множества как упорядоченные уникальные последовательности связей

/-- Множество ссылок — это ссылка (Reference) на корень дерева связей
    в сети, листья которого образуют строго возрастающий
    список без дубликатов. Как и последовательность, множество — это Reference. -/
abbrev LinkSet := Reference

-- Предикат: является ли дерево связей корректным множеством
def IsValidSetTree (s : LinkTree) : Prop :=
  IsOrderedUniqueSequence (TreeToList s)

-- Множество из одного элемента — ссылка на сам элемент
def SingletonSet (value : Reference) : LinkSet := value

/-- Преобразование списка ссылок в множество: сортировка, удаление дубликатов,
    построение сбалансированного дерева и запись в сеть.
    Возвращает ссылку на корень (= множество) и сеть дуплетов. -/
def ListToSet (l : List Reference) (offset : Nat)
    : Option (LinkSet × NetworkDupletList) :=
  let sorted := toOrderedUnique l
  match ListToBalancedTree sorted with
  | none => none
  | some t => some (TreeToSequence t offset, TreeToDupletList t offset)

-- Принадлежность элемента множеству (проверка через дерево)
def InSetTree (x : Reference) (s : LinkTree) : Prop :=
  x ∈ TreeToList s

-- Подмножество: s1 ⊆ s2 (через деревья)
def IsSubsetTree (s1 s2 : LinkTree) : Prop :=
  ∀ x, InSetTree x s1 → InSetTree x s2

-- * Теорема: toOrderedUnique всегда содержит упорядоченные уникальные элементы

theorem ListToSet_elements_valid (l : List Reference) :
    IsOrderedUniqueSequence (toOrderedUnique l) := by
  exact toOrderedUnique_is_ascending l

-- Элемент принадлежит множеству тогда и только тогда, когда он принадлежит исходному списку
theorem ListToSet_membership (x : Reference) (l : List Reference) :
    x ∈ toOrderedUnique l ↔ x ∈ l := by
  exact mem_toOrderedUnique x l

-- * Примеры

-- Создание множества из списка с дубликатами
#eval ListToSet [3, 1, 4, 1, 5, 9, 2, 6, 5, 3] 10
-- Множество {1, 2, 3, 4, 5, 6, 9} в сети

-- Множество из одного элемента
#eval SingletonSet 42
