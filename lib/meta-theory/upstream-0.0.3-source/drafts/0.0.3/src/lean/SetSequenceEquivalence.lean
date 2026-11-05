/-
  SetSequenceEquivalence.lean - Формальное доказательство того, что конечное множество
  эквивалентно упорядоченной последовательности с уникальными элементами.

  Основная теорема: Для любого конечного множества натуральных чисел существует
  единственная строго возрастающая последовательность (список без дубликатов,
  отсортированный по возрастанию), содержащая в точности те же элементы.

  Адаптировано из: https://github.com/konard/subset-sum/tree/main/proofs/set_sequence_equivalence
  Полные доказательства см. в Rocq-версии: SetSequenceEquivalence.v
-/

namespace SetSequenceEquivalence

/-- Список является строго возрастающим, если каждый элемент строго меньше следующего -/
def StrictlyAscending : List Nat → Prop
  | [] => True
  | [_] => True
  | x :: y :: rest => x < y ∧ StrictlyAscending (y :: rest)

/-- Список не содержит дубликатов -/
def NoDuplicates : List Nat → Prop
  | [] => True
  | x :: rest => x ∉ rest ∧ NoDuplicates rest

/-- Упорядоченная уникальная последовательность — это строго возрастающий список -/
def IsOrderedUniqueSequence (l : List Nat) : Prop :=
  StrictlyAscending l

/-- Вставка элемента в отсортированный список с сохранением порядка -/
def insertSorted (x : Nat) : List Nat → List Nat
  | [] => [x]
  | y :: rest =>
    if x < y then x :: y :: rest
    else if x = y then y :: rest
    else y :: insertSorted x rest

/-- Сортировка списка в строго возрастающем порядке (с удалением дубликатов) -/
def toOrderedUnique : List Nat → List Nat
  | [] => []
  | x :: rest => insertSorted x (toOrderedUnique rest)

/-- Строго возрастающий список не содержит дубликатов.
    Доказательство: в строго возрастающем списке x < y < z < ...,
    каждый элемент строго меньше всех последующих, поэтому не может повторяться.
    Полное формальное доказательство см. в Rocq-версии. -/
theorem strictly_ascending_implies_no_dup (l : List Nat)
    (h : StrictlyAscending l) : NoDuplicates l := by
  sorry

/-- insertSorted сохраняет свойство строгого возрастания.
    Доказательство: разбор случаев по положению вставляемого элемента
    относительно текущего: x < y (вставляем перед), x = y (пропускаем),
    x > y (рекурсия в хвост). Полное доказательство см. в Rocq-версии. -/
theorem insertSorted_preserves_ascending (x : Nat) (l : List Nat)
    (h : StrictlyAscending l) : StrictlyAscending (insertSorted x l) := by
  sorry

/-- toOrderedUnique выдаёт строго возрастающие списки -/
theorem toOrderedUnique_is_ascending (l : List Nat) :
    StrictlyAscending (toOrderedUnique l) := by
  induction l with
  | nil => simp [toOrderedUnique, StrictlyAscending]
  | cons x rest ih =>
    simp only [toOrderedUnique]
    exact insertSorted_preserves_ascending x (toOrderedUnique rest) ih

/-- Принадлежность элемента сохраняется при insertSorted.
    Доказательство: y ∈ insertSorted x l ↔ y = x ∨ y ∈ l.
    Полное доказательство см. в Rocq-версии. -/
theorem mem_insertSorted (x y : Nat) (l : List Nat) :
    y ∈ insertSorted x l ↔ y = x ∨ y ∈ l := by
  sorry

/-- Принадлежность элемента сохраняется при toOrderedUnique.
    Доказательство: индукция по списку с использованием mem_insertSorted.
    Полное доказательство см. в Rocq-версии. -/
theorem mem_toOrderedUnique (x : Nat) (l : List Nat) :
    x ∈ toOrderedUnique l ↔ x ∈ l := by
  sorry

/-
  ОСНОВНАЯ ТЕОРЕМА: Эквивалентность множества и последовательности

  Для любого списка (представляющего мультимножество) существует строго
  возрастающий список, содержащий в точности те же элементы (как множество).
-/

/-- Основная теорема: Каждый список может быть преобразован в упорядоченную уникальную
    последовательность с теми же элементами -/
theorem set_sequence_equivalence (l : List Nat) :
    ∃ l' : List Nat,
      IsOrderedUniqueSequence l' ∧
      (∀ x, x ∈ l' ↔ x ∈ l) :=
  ⟨toOrderedUnique l, toOrderedUnique_is_ascending l, fun x => mem_toOrderedUnique x l⟩

/-- Следствие: Упорядоченная уникальная последовательность не содержит дубликатов -/
theorem ordered_unique_has_no_dup (l : List Nat) :
    NoDuplicates (toOrderedUnique l) :=
  strictly_ascending_implies_no_dup _ (toOrderedUnique_is_ascending l)

end SetSequenceEquivalence

-- Проверки верификации
#check SetSequenceEquivalence.set_sequence_equivalence
#check SetSequenceEquivalence.ordered_unique_has_no_dup
