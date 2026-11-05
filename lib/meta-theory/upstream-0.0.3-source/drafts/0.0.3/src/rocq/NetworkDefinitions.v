Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import Vector.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Import VectorNotations.

(* Ссылка (Reference) — уникальный идентификатор кортежа: R ⊆ ℕ₀ *)
(* Ссылка также является связью нулевой размерности: при n = 0 связь L = R × T₀ ≡ R,
   поэтому r ≡ (r, ()), и множество ссылок R является подмножеством множества связей L. *)
Definition Reference := nat.

(* Значение Reference по умолчанию: ноль *)
Definition ReferenceDefault : Reference := 0.

(* Множество кортежей ссылок длины n ∈ ℕ₀: TupleOfReferences ⊆ Rⁿ *)
Definition TupleOfReferences (n : nat) := t Reference n.

(* Значение TupleOfReferences по умолчанию *)
Definition TupleOfReferencesDefault (n : nat) : TupleOfReferences n := Vector.const ReferenceDefault n.

(* Множество всех связей: Link = Reference × TupleOfReferences
   Link (связь) — это пара из ссылки и кортежа ссылок *)
Definition Link (n : nat) := prod Reference (TupleOfReferences n).

(* Сеть кортежей длины n (или n-мерная сеть) из семейства функций {Nⁿ : Reference → TupleOfReferences} *)
Definition NetworkTupleFunction (n : nat) := Reference -> TupleOfReferences n.

(* Сеть кортежей длины n (или n-мерная сеть) в виде последовательности *)
Definition NetworkTupleList (n : nat) := list (TupleOfReferences n).

(* Список ссылок: ReferenceList ⊆ List(R) *)
Definition ReferenceList := list Reference.

(* Сеть списков ссылок: N^{list} : Reference → ReferenceList *)
Definition NetworkReferenceListFunction := Reference -> ReferenceList.

(* Сеть списков ссылок в виде последовательности списков ссылок *)
Definition NetworkReferenceListList := list ReferenceList.

(* Дуплет ссылок: упорядоченная пара (Reference, Reference).
   В нотации связей (https://github.com/link-foundation/links-notation):
   дуплет записывается как (id: from to), например (3: 1 2) *)
Definition Duplet := prod Reference Reference.

(* Значение Duplet по умолчанию: пара из двух ReferenceDefault, используется для обозначения пустого дуплета *)
Definition DupletDefault : Duplet := (ReferenceDefault, ReferenceDefault).

(* Сеть дуплетов (или двумерная сеть): N² : Reference → Reference² *)
Definition NetworkDupletFunction := Reference -> Duplet.

(* Сеть дуплетов (или двумерная сеть) в виде последовательности дуплетов *)
Definition NetworkDupletList := list Duplet.

(** * Сеть всех сетей *)

(**
  Сеть всех сетей (Ω) — пространство, в котором каждая возможная сеть
  произвольной размерности и размера получает уникальную ссылку.

  𝒩 = ⋃_{n ∈ ℕ₀} ⋃_{s ∈ ℕ₀} {Nⁿ размера s}
  Ω: R → 𝒩

  Поскольку в Rocq мы не можем напрямую определить тип, параметризованный
  произвольным n на уровне значений, мы представляем элемент 𝒩 как запись
  (размерность, список кортежей переменной длины), используя списки ссылок
  для представления кортежей произвольной размерности.
*)

(* Элемент сети произвольной размерности: пара (размерность, список кортежей).
   Кортеж переменной длины представлен как ReferenceList *)
Record AnyNetwork := mkAnyNetwork {
  dimension : nat;
  tuples : list ReferenceList
}.

(* Сеть всех сетей: отображение ссылок на сети произвольной размерности и размера *)
(* Ω: R → 𝒩 *)
Definition NetworkOfAllNetworks := Reference -> AnyNetwork.

(* Сеть всех сетей в виде последовательности (для конечного фрагмента) *)
Definition NetworkOfAllNetworksList := list AnyNetwork.

(* Пустая сеть нулевой размерности и размера — наименьший элемент 𝒩 *)
Definition emptyNetwork : AnyNetwork := mkAnyNetwork 0 nil.

(* Размер сети (количество кортежей) *)
Definition anyNetworkSize (net : AnyNetwork) : nat :=
  length (tuples net).

(* Проверка корректности: все кортежи имеют длину, равную размерности *)
Definition anyNetworkIsWellFormed (net : AnyNetwork) : bool :=
  forallb (fun t => Nat.eqb (length t) (dimension net)) (tuples net).

(* Пример: представление дуплетной сети N² размера 3 как элемента 𝒩 *)
Definition exampleAnyNetwork : AnyNetwork :=
  mkAnyNetwork 2 ((cons 1 (cons 1 nil)) :: (cons 2 (cons 2 nil)) :: (cons 1 (cons 2 nil)) :: nil).
