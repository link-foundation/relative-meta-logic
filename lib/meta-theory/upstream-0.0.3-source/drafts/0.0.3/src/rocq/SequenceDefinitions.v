(**
  SequenceDefinitions.v - Определение последовательностей в терминах связей.

  Последовательность — это вложенная структура связей-дуплетов,
  хранимая в сети. Последовательность идентифицируется
  ссылкой (Reference) на корень дерева дуплетов.

  Каждый внутренний узел дерева — это связь-дуплет (ссылка_на_левое, ссылка_на_правое).
  Листья — это связи-ссылающиеся-на-себя (элемент, элемент).

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
*)

Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Require Import NetworkDefinitions.
Require Import NetworkConversions.

(** * Последовательность — это ссылка на корень дерева в сети *)

(** Последовательность идентифицируется ссылкой (Reference) на корень дерева дуплетов,
    хранимого в сети. Это не отдельный тип — это просто Reference. *)
Definition LinkSequence := Reference.

(** * Вспомогательное дерево для построения последовательностей

    LinkTree используется как промежуточная структура для алгоритмов
    построения деревьев (сбалансированный вариант, лестницы).
    Конечный результат всегда записывается в сеть дуплетов. *)

Inductive LinkTree : Type :=
  | Leaf : Reference -> LinkTree
  | Node : LinkTree -> LinkTree -> LinkTree.

(** * Запись дерева в сеть дуплетов *)

(** Запись дерева в сеть дуплетов.
    Каждый узел Node записывается как дуплет (ссылка_на_левое, ссылка_на_правое).
    Листья — это элементы последовательности (не записываются как отдельные дуплеты).
    Возвращает пару: (сеть дуплетов, следующее свободное смещение). *)
Fixpoint TreeToDupletList_ (t : LinkTree) (offset : nat)
    : NetworkDupletList * nat :=
  match t with
  | Leaf _ => ([], offset)
  | Node l r =>
    let cur := offset in
    let '(left_net, left_next) := TreeToDupletList_ l (S offset) in
    let left_root := match l with Leaf x => x | Node _ _ => S offset end in
    let '(right_net, right_next) := TreeToDupletList_ r left_next in
    let right_root := match r with Leaf x => x | Node _ _ => left_next end in
    ((left_root, right_root) :: left_net ++ right_net, right_next)
  end.

Definition TreeToDupletList (t : LinkTree) (offset : nat) : NetworkDupletList :=
  fst (TreeToDupletList_ t offset).

(** Получение ссылки на корень дерева (= последовательность) *)
Definition TreeToSequence (t : LinkTree) (offset : nat) : LinkSequence :=
  match t with
  | Leaf x => x
  | Node _ _ => offset
  end.

(** Получение листьев дерева (элементов последовательности) слева направо *)
Fixpoint TreeToList (t : LinkTree) : list Reference :=
  match t with
  | Leaf x => [x]
  | Node l r => TreeToList l ++ TreeToList r
  end.

(** * Алгоритмы создания последовательностей *)

(** Правая лестница: (1, (2, (3, 4)))
    Каждый следующий элемент вкладывается вправо. *)
Fixpoint ListToRightStaircase (l : list Reference) : option LinkTree :=
  match l with
  | [] => None
  | [x] => Some (Leaf x)
  | x :: rest =>
    match ListToRightStaircase rest with
    | None => None
    | Some t => Some (Node (Leaf x) t)
    end
  end.

(** Левая лестница: (((1, 2), 3), 4)
    Каждый следующий элемент вкладывается влево. *)
Fixpoint ListToLeftStaircase_ (acc : LinkTree) (l : list Reference) : LinkTree :=
  match l with
  | [] => acc
  | x :: rest => ListToLeftStaircase_ (Node acc (Leaf x)) rest
  end.

Definition ListToLeftStaircase (l : list Reference) : option LinkTree :=
  match l with
  | [] => None
  | [x] => Some (Leaf x)
  | x :: rest => Some (ListToLeftStaircase_ (Leaf x) rest)
  end.

(** Сбалансированный вариант: ((1, 2), (3, 4))
    Список делится пополам, каждая половина рекурсивно превращается в дерево.
    Адаптировано из BalancedVariantConverter.
    Использует fuel-параметр для гарантии завершения. *)
Fixpoint ListToBalancedTree_ (l : list Reference) (fuel : nat) : option LinkTree :=
  match fuel with
  | 0 => None
  | S fuel' =>
    match l with
    | [] => None
    | [x] => Some (Leaf x)
    | _ =>
      let mid := length l / 2 in
      let left_part := firstn mid l in
      let right_part := skipn mid l in
      match ListToBalancedTree_ left_part fuel', ListToBalancedTree_ right_part fuel' with
      | Some lt, Some rt => Some (Node lt rt)
      | _, _ => None
      end
    end
  end.

Definition ListToBalancedTree (l : list Reference) : option LinkTree :=
  ListToBalancedTree_ l (S (length l)).

(** * Полное преобразование: список → сеть дуплетов + ссылка на корень *)

(** Преобразование списка в последовательность (ссылку на корень) и сеть *)
Definition ListToSequence (l : list Reference) (offset : nat)
    : option (LinkSequence * NetworkDupletList) :=
  match ListToBalancedTree l with
  | None => None
  | Some t => Some (TreeToSequence t offset, TreeToDupletList t offset)
  end.

(** Чтение последовательности из сети дуплетов *)
Fixpoint ReadSequence_ (anet : NetworkDupletList) (root : Reference) (fuel : nat)
    : list Reference :=
  match fuel with
  | 0 => []
  | S fuel' =>
    if root <? length anet then
      let d := nth root anet (0, 0) in
      let l := fst d in
      let r := snd d in
      ReadSequence_ anet l fuel' ++ ReadSequence_ anet r fuel'
    else
      [root]
  end.

Definition ReadSequence (anet : NetworkDupletList) (root : LinkSequence) : list Reference :=
  ReadSequence_ anet root (S (length anet)).

(** * Примеры *)

(** Пример: [1, 2, 3, 4] — сбалансированное дерево, записанное в сеть *)
Compute ListToSequence [1; 2; 3; 4] 5.
(* Ожидается: Some (5, [(5_root: 6, 7), (6: 1, 2), (7: 3, 4)])
   Последовательность = ссылка 5
   (5: 6, 7) — корень, указывает на поддеревья 6 и 7
   (6: 1, 2) — левое поддерево
   (7: 3, 4) — правое поддерево *)

(** Пример: правая лестница *)
Compute match ListToRightStaircase [1; 2; 3; 4] with
        | Some t => Some (TreeToSequence t 5, TreeToDupletList t 5)
        | None => None
        end.
(* (1, (2, (3, 4))) хранится как дуплеты *)

(** Пример: левая лестница *)
Compute match ListToLeftStaircase [1; 2; 3; 4] with
        | Some t => Some (TreeToSequence t 5, TreeToDupletList t 5)
        | None => None
        end.
(* (((1, 2), 3), 4) хранится как дуплеты *)

(** Все три варианта содержат одни и те же элементы *)
Definition balanced_1234 := match ListToBalancedTree [1; 2; 3; 4] with Some t => TreeToList t | None => [] end.
Definition right_1234 := match ListToRightStaircase [1; 2; 3; 4] with Some t => TreeToList t | None => [] end.
Definition left_1234 := match ListToLeftStaircase [1; 2; 3; 4] with Some t => TreeToList t | None => [] end.

Compute balanced_1234. (* [1, 2, 3, 4] *)
Compute right_1234.    (* [1, 2, 3, 4] *)
Compute left_1234.     (* [1, 2, 3, 4] *)

(** Пустая последовательность *)
Compute ListToSequence [] 5.
(* Ожидается: None *)

(** Последовательность из одного элемента *)
Compute ListToSequence [42] 5.
(* Ожидается: Some (42, []) — лист не создаёт дуплетов, сама ссылка 42 и есть последовательность *)
