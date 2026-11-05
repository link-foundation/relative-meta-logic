/-
  NetworkEquivalence.lean

  Предикаты эквивалентности для различных представлений сетей.
  Lean 4 перевод NetworkEquivalence.v (Rocq).
-/
import NetworkDefinitions
import NetworkConversions

-- Предикат эквивалентности двух сетей кортежей длины n,
-- anet1 и anet2 типа NetworkTupleFunction.
--
-- Данный предикат описывает свойство «эквивалентности» для таких сетей.
-- Он утверждает, что anet1 и anet2 считаются «эквивалентными», если для каждой ссылки id кортеж,
-- связанный с id в anet1, точно совпадает с кортежем, связанным с тем же id в anet2.
def TupleFunctionEquivalence {n : Nat} (anet1 anet2 : NetworkTupleFunction n) : Prop :=
  ∀ id, anet1 id = anet2 id

-- Предикат эквивалентности двух сетей кортежей длины n,
-- anet1 и anet2 типа NetworkTupleList.
def TupleListEquivalence {n : Nat} (anet1 anet2 : NetworkTupleList n) : Prop :=
  anet1 = anet2

-- Предикат эквивалентности для сетей дуплетов NetworkDupletFunction
def DupletFunctionEquivalence (anet1 anet2 : NetworkDupletFunction) : Prop :=
  ∀ id, anet1 id = anet2 id

-- Предикат эквивалентности для сетей дуплетов NetworkDupletList
def DupletListEquivalence (anet1 anet2 : NetworkDupletList) : Prop :=
  anet1 = anet2
