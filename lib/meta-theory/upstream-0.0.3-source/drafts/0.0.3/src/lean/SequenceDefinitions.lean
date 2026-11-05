/-
  SequenceDefinitions.lean - Определение последовательностей в терминах связей.

  Последовательность — это вложенная структура связей-дуплетов,
  хранимая в сети. Последовательность идентифицируется
  ссылкой (Reference) на корень дерева дуплетов.

  Каждый внутренний узел дерева — это связь-дуплет (ссылка_на_левое, ссылка_на_правое).
  Листья — это элементы последовательности (ссылки).

  Пример: [1, 2, 3, 4] = ((1, 2), (3, 4))
  Хранится в сети как:
    (5: 1, 2)   — дуплет для пары (1, 2)
    (6: 3, 4)   — дуплет для пары (3, 4)
    (7: 5, 6)   — дуплет-корень, ссылающийся на поддеревья
  Последовательность = ссылка 7

  В нотации связей (https://github.com/link-foundation/links-notation):
    (5: 1 2) (6: 3 4) (7: 5 6)

  Другие варианты:
    [1, 2, 3, 4] = (((1, 2), 3), 4)   — левая лестница
    [1, 2, 3, 4] = (1, (2, (3, 4)))   — правая лестница

  Адаптировано из: https://github.com/linksplatform/Documentation/tree/main/doc/LinksTheoryManuscriptDraft/05%20Sequences
  См. также: https://github.com/linksplatform/Data.Doublets.Sequences/blob/main/csharp/Platform.Data.Doublets.Sequences/Converters/BalancedVariantConverter.cs
-/
import NetworkDefinitions
import NetworkConversions

-- * Последовательность — это ссылка на корень дерева в сети

/-- Последовательность идентифицируется ссылкой (Reference) на корень дерева дуплетов,
    хранимого в сети. Это не отдельный тип — это просто Reference. -/
abbrev LinkSequence := Reference

-- * Вспомогательное дерево для построения последовательностей

/-- LinkTree — промежуточная структура для алгоритмов построения деревьев.
    Конечный результат всегда записывается в сеть дуплетов. -/
inductive LinkTree where
  | Leaf : Reference → LinkTree
  | Node : LinkTree → LinkTree → LinkTree
  deriving Repr

-- * Запись дерева в сеть дуплетов

/-- Запись дерева в сеть дуплетов.
    Каждый узел Node записывается как дуплет (ссылка_на_левое, ссылка_на_правое).
    Листья — это элементы последовательности (не записываются как отдельные дуплеты).
    Возвращает пару: (сеть дуплетов, следующее свободное смещение). -/
def TreeToDupletList_ : LinkTree → Nat → NetworkDupletList × Nat
  | .Leaf _, offset => ([], offset)
  | .Node l r, offset =>
    let left_root := match l with | .Leaf x => x | .Node _ _ => offset + 1
    let (left_net, left_next) := TreeToDupletList_ l (offset + 1)
    let right_root := match r with | .Leaf x => x | .Node _ _ => left_next
    let (right_net, right_next) := TreeToDupletList_ r left_next
    ((left_root, right_root) :: left_net ++ right_net, right_next)

def TreeToDupletList (t : LinkTree) (offset : Nat) : NetworkDupletList :=
  (TreeToDupletList_ t offset).1

/-- Получение ссылки на корень дерева (= последовательность) -/
def TreeToSequence (t : LinkTree) (offset : Nat) : LinkSequence :=
  match t with
  | .Leaf x => x
  | .Node _ _ => offset

-- Получение листьев дерева (элементов последовательности) слева направо
def TreeToList : LinkTree → List Reference
  | .Leaf x => [x]
  | .Node l r => TreeToList l ++ TreeToList r

-- * Алгоритмы создания последовательностей

/-- Правая лестница: (1, (2, (3, 4)))
    Каждый следующий элемент вкладывается вправо. -/
def ListToRightStaircase : List Reference → Option LinkTree
  | [] => none
  | [x] => some (.Leaf x)
  | x :: rest =>
    match ListToRightStaircase rest with
    | none => none
    | some t => some (.Node (.Leaf x) t)

/-- Левая лестница: (((1, 2), 3), 4)
    Каждый следующий элемент вкладывается влево. -/
def ListToLeftStaircase_ : LinkTree → List Reference → LinkTree
  | acc, [] => acc
  | acc, x :: rest => ListToLeftStaircase_ (.Node acc (.Leaf x)) rest

def ListToLeftStaircase : List Reference → Option LinkTree
  | [] => none
  | [x] => some (.Leaf x)
  | x :: rest => some (ListToLeftStaircase_ (.Leaf x) rest)

/-- Сбалансированный вариант: ((1, 2), (3, 4))
    Список делится пополам, каждая половина рекурсивно превращается в дерево.
    Адаптировано из BalancedVariantConverter.
    Использует fuel-параметр для гарантии завершения. -/
def ListToBalancedTree (l : List Reference) (fuel : Nat := l.length + 1) : Option LinkTree :=
  match fuel with
  | 0 => none
  | fuel' + 1 =>
    match l with
    | [] => none
    | [x] => some (.Leaf x)
    | _ =>
      let mid := l.length / 2
      let left_part := l.take mid
      let right_part := l.drop mid
      match ListToBalancedTree left_part fuel', ListToBalancedTree right_part fuel' with
      | some lt, some rt => some (.Node lt rt)
      | _, _ => none

-- * Полное преобразование: список → сеть дуплетов + ссылка на корень

/-- Преобразование списка в последовательность (ссылку на корень) и сеть -/
def ListToSequence (l : List Reference) (offset : Nat)
    : Option (LinkSequence × NetworkDupletList) :=
  match ListToBalancedTree l with
  | none => none
  | some t => some (TreeToSequence t offset, TreeToDupletList t offset)

/-- Получение элемента списка по индексу с значением по умолчанию -/
def listGetD (l : List α) (n : Nat) (default : α) : α :=
  match l, n with
  | [], _ => default
  | x :: _, 0 => x
  | _ :: rest, n + 1 => listGetD rest n default

/-- Чтение последовательности из сети дуплетов -/
def ReadSequence_ (anet : NetworkDupletList) (root : Reference) (fuel : Nat)
    : List Reference :=
  match fuel with
  | 0 => []
  | fuel' + 1 =>
    if root < anet.length then
      let d := listGetD anet root (0, 0)
      ReadSequence_ anet d.1 fuel' ++ ReadSequence_ anet d.2 fuel'
    else
      [root]

def ReadSequence (anet : NetworkDupletList) (root : LinkSequence) : List Reference :=
  ReadSequence_ anet root (anet.length + 1)

-- * Примеры

-- Пример: [1, 2, 3, 4] — сбалансированное дерево, записанное в сеть
#eval ListToSequence [1, 2, 3, 4] 5
-- Ожидается: some (5, [(6, 7), (1, 2), (3, 4)])
-- Последовательность = ссылка 5
-- (5: 6, 7) — корень, указывает на поддеревья 6 и 7
-- (6: 1, 2) — левое поддерево
-- (7: 3, 4) — правое поддерево

-- Пример: правая лестница
#eval do let t ← ListToRightStaircase [1, 2, 3, 4]
         return (TreeToSequence t 5, TreeToDupletList t 5)

-- Пример: левая лестница
#eval do let t ← ListToLeftStaircase [1, 2, 3, 4]
         return (TreeToSequence t 5, TreeToDupletList t 5)

-- Все три варианта содержат одни и те же элементы
#eval do let t ← ListToBalancedTree [1, 2, 3, 4]; return TreeToList t    -- [1, 2, 3, 4]
#eval do let t ← ListToRightStaircase [1, 2, 3, 4]; return TreeToList t  -- [1, 2, 3, 4]
#eval do let t ← ListToLeftStaircase [1, 2, 3, 4]; return TreeToList t   -- [1, 2, 3, 4]

-- Пустая последовательность
#eval ListToSequence ([] : List Reference) 5
-- Ожидается: none

-- Последовательность из одного элемента
#eval ListToSequence [42] 5
-- Ожидается: some (42, []) — лист не создаёт дуплетов, сама ссылка 42 и есть последовательность
