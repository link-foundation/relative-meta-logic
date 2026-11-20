Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import Vector.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Import VectorNotations.
Require Import NetworkDefinitions.
Require Import NetworkConversions.

(* Нотация записи списков *)
Notation "{ }" := (nil) (at level 0).
Notation "{ x , .. , y }" := (cons x .. (cons y nil) ..) (at level 0).

(* Трёхмерная сеть *)
Definition complexExampleNetwork : NetworkTupleFunction 3 :=
  fun id => match id with
  | 0 => [0; 0; 0]
  | 1 => [1; 1; 2]
  | 2 => [2; 4; 0]
  | 3 => [3; 0; 5]
  | 4 => [4; 1; 1]
  | S _ => [0; 0; 0]
  end.

(* Кортежи ссылок *)
Definition exampleTuple0 : TupleOfReferences 0 := [].
Definition exampleTuple1 : TupleOfReferences 1 := [0].
Definition exampleTuple4 : TupleOfReferences 4 := [3; 2; 1; 0].

(* Преобразование кортежей ссылок во вложенные упорядоченные пары (списки) *)
Definition nestedPair0 := TupleOfReferencesToReferenceList exampleTuple0.
Definition nestedPair1 := TupleOfReferencesToReferenceList exampleTuple1.
Definition nestedPair4 := TupleOfReferencesToReferenceList exampleTuple4.

Compute nestedPair0. (* Ожидается результат: { } *)
Compute nestedPair1. (* Ожидается результат: {0} *)
Compute nestedPair4. (* Ожидается результат: {3, 2, 1, 0} *)

(* Вычисление значений преобразованной функции трёхмерной сети *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 0. (* Ожидается результат: {0, 0, 0} *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 1. (* Ожидается результат: {1, 1, 2} *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 2. (* Ожидается результат: {2, 4, 0} *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 3. (* Ожидается результат: {3, 0, 5} *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 4. (* Ожидается результат: {4, 1, 1} *)
Compute (TupleFunctionToReferenceListFunction complexExampleNetwork) 5. (* Ожидается результат: {0, 0, 0} *)

(* Сеть вложенных упорядоченных пар *)
Definition testPairsNetwork : NetworkReferenceListFunction :=
  fun id => match id with
  | 0 => {5, 0, 8}
  | 1 => {7, 1, 2}
  | 2 => {2, 4, 5}
  | 3 => {3, 1, 5}
  | 4 => {4, 2, 1}
  | S _ => {0, 0, 0}
  end.

(* Преобразованная сеть вложенных УП в трёхмерную сеть (размерность должна совпадать) *)
Definition testTuplesNetwork : NetworkTupleFunction 3 :=
  ReferenceListFunctionToTupleFunction testPairsNetwork.

(* Вычисление значений преобразованной функции сети вложенных УП *)
Compute testTuplesNetwork 0. (* Ожидается результат: [5; 0; 8] *)
Compute testTuplesNetwork 1. (* Ожидается результат: [7; 1; 2] *)
Compute testTuplesNetwork 2. (* Ожидается результат: [2; 4; 5] *)
Compute testTuplesNetwork 3. (* Ожидается результат: [3; 1; 5] *)
Compute testTuplesNetwork 4. (* Ожидается результат: [4; 2; 1] *)
Compute testTuplesNetwork 5. (* Ожидается результат: [0; 0; 0] *)

(* Преобразование вложенных УП в сеть дуплетов *)
Compute ReferenceListToDupletList { 121, 21, 1343 }.
(* Должно вернуть: {(121, 1), (21, 2), (1343, 2)} *)

(* Добавление вложенных УП в сеть дуплетов *)
Compute AddReferenceListToDupletList {(121, 1), (21, 2), (1343, 2)} {12, 23, 34}.
(* Ожидается результат: {(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)} *)

(* Преобразование сети дуплетов во вложенные УП *)
Compute DupletListToReferenceList {(121, 1), (21, 2), (1343, 2)}.
(* Ожидается результат: {121, 21, 1343} *)

Compute DupletListToReferenceList {(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)}.
(* Ожидается результат: {121, 21, 1343} *)

(* Чтение вложенных УП из сети дуплетов по индексу дуплета — начала вложенных УП *)
Compute DupletListReadReferenceList {(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)} 0.
(* Ожидается результат: {121, 21, 1343} *)

Compute DupletListReadReferenceList {(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)} 3.
(* Ожидается результат: {12, 23, 34} *)

(* Определяем сеть вложенных УП *)
Definition testReferenceListList := { {121, 21, 1343}, {12, 23}, {34}, {121, 21, 1343}, {12, 23}, {34} }.

(* Преобразованная сеть вложенных УП в сеть дуплетов *)
Definition testDupletList := ReferenceListListToDupletList testReferenceListList.

(* Вычисление преобразованной сети вложенных УП в сеть дуплетов *)
Compute testDupletList.
(* Ожидается результат:
 {(121, 1), (21, 2), (1343, 2),
  (12, 4), (23, 4),
  (34, 5),
  (121, 7), (21, 8), (1343, 8),
  (12, 10), (23, 10),
  (34, 11)} *)

(* Вычисление преобразования сети вложенных УП в сеть дуплетов и обратно в testReferenceListList *)
Compute DupletListToReferenceListList testDupletList.
(* Ожидается результат:
  {{121, 21, 1343}, {12, 23}, {34}, {121, 21, 1343}, {12, 23}, {34}} *)

(* Вычисление смещения вложенных УП в сети дуплетов по их порядковому номеру *)
Compute DupletListOffsetReferenceList testDupletList 0. (* Ожидается результат: 0 *)
Compute DupletListOffsetReferenceList testDupletList 1. (* Ожидается результат: 3 *)
Compute DupletListOffsetReferenceList testDupletList 2. (* Ожидается результат: 5 *)
Compute DupletListOffsetReferenceList testDupletList 3. (* Ожидается результат: 6 *)
Compute DupletListOffsetReferenceList testDupletList 4. (* Ожидается результат: 9 *)
Compute DupletListOffsetReferenceList testDupletList 5. (* Ожидается результат: 11 *)
Compute DupletListOffsetReferenceList testDupletList 6. (* Ожидается результат: 12 *)
Compute DupletListOffsetReferenceList testDupletList 7. (* Ожидается результат: 12 *)

(* Определяем трёхмерную сеть как последовательность кортежей длины 3 *)
Definition testTupleList : NetworkTupleList 3 :=
  { [0; 0; 0], [1; 1; 2], [2; 4; 0], [3; 0; 5], [4; 1; 1], [0; 0; 0] }.

(* Преобразованная трёхмерная сеть в сеть дуплетов через сеть вложенных УП *)
Definition testTuplesToDupletList : NetworkDupletList := TupleListToDupletList testTupleList.

(* Вычисление трёхмерной сети преобразованной в сеть дуплетов через сеть вложенных УП *)
Compute testTuplesToDupletList.
(* Ожидается результат:
{ (0, 1), (0, 2), (0, 2),
  (1, 4), (1, 5), (2, 5),
  (2, 7), (4, 8), (0, 8),
  (3, 10), (0, 11), (5, 11),
  (4, 13), (1, 14), (1, 14),
  (0, 16), (0, 17), (0, 17)} *)

(* Преобразованная трёхмерная сеть в сеть дуплетов через сеть вложенных УП и обратно в трёхмерную сеть *)
Definition resultTuplesNetwork : NetworkTupleList 3 :=
  ReferenceListListToTupleList (DupletListToReferenceListList testTuplesToDupletList).

(* Итоговая проверка эквивалентности сетей *)
Compute resultTuplesNetwork.
(* Ожидается результат:
  { [0; 0; 0], [1; 1; 2], [2; 4; 0], [3; 0; 5], [4; 1; 1], [0; 0; 0] } *)
