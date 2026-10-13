/-
  NetworkExamples.lean

  Практические примеры и тесты преобразований сетей.
  Lean 4 перевод NetworkExamples.v (Rocq).
-/
import NetworkDefinitions
import NetworkConversions

-- Трёхмерная сеть
def complexExampleNetwork : NetworkTupleFunction 3 :=
  fun id => match id with
  | 0 => #v[0, 0, 0]
  | 1 => #v[1, 1, 2]
  | 2 => #v[2, 4, 0]
  | 3 => #v[3, 0, 5]
  | 4 => #v[4, 1, 1]
  | _ => #v[0, 0, 0]

-- Кортежи ссылок
def exampleTuple0 : TupleOfReferences 0 := #v[]
def exampleTuple1 : TupleOfReferences 1 := #v[0]
def exampleTuple4 : TupleOfReferences 4 := #v[3, 2, 1, 0]

-- Преобразование кортежей ссылок во вложенные упорядоченные пары (списки)
def nestedPair0 := TupleOfReferencesToReferenceList exampleTuple0
def nestedPair1 := TupleOfReferencesToReferenceList exampleTuple1
def nestedPair4 := TupleOfReferencesToReferenceList exampleTuple4

#eval nestedPair0 -- Ожидается результат: []
#eval nestedPair1 -- Ожидается результат: [0]
#eval nestedPair4 -- Ожидается результат: [3, 2, 1, 0]

-- Вычисление значений преобразованной функции трёхмерной сети
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 0 -- Ожидается результат: [0, 0, 0]
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 1 -- Ожидается результат: [1, 1, 2]
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 2 -- Ожидается результат: [2, 4, 0]
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 3 -- Ожидается результат: [3, 0, 5]
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 4 -- Ожидается результат: [4, 1, 1]
#eval (TupleFunctionToReferenceListFunction complexExampleNetwork) 5 -- Ожидается результат: [0, 0, 0]

-- Сеть вложенных упорядоченных пар
def testPairsNetwork : NetworkReferenceListFunction :=
  fun id => match id with
  | 0 => [5, 0, 8]
  | 1 => [7, 1, 2]
  | 2 => [2, 4, 5]
  | 3 => [3, 1, 5]
  | 4 => [4, 2, 1]
  | _ => [0, 0, 0]

-- Преобразованная сеть вложенных УП в трёхмерную сеть (размерность должна совпадать)
def testTuplesNetwork : NetworkTupleFunction 3 :=
  ReferenceListFunctionToTupleFunction testPairsNetwork

-- Вычисление значений преобразованной функции сети вложенных УП
#eval (testTuplesNetwork 0).toList -- Ожидается результат: [5, 0, 8]
#eval (testTuplesNetwork 1).toList -- Ожидается результат: [7, 1, 2]
#eval (testTuplesNetwork 2).toList -- Ожидается результат: [2, 4, 5]
#eval (testTuplesNetwork 3).toList -- Ожидается результат: [3, 1, 5]
#eval (testTuplesNetwork 4).toList -- Ожидается результат: [4, 2, 1]
#eval (testTuplesNetwork 5).toList -- Ожидается результат: [0, 0, 0]

-- Преобразование вложенных УП в сеть дуплетов
#eval ReferenceListToDupletList [121, 21, 1343]
-- Должно вернуть: [(121, 1), (21, 2), (1343, 2)]

-- Добавление вложенных УП в сеть дуплетов
#eval AddReferenceListToDupletList [(121, 1), (21, 2), (1343, 2)] [12, 23, 34]
-- Ожидается результат: [(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)]

-- Преобразование сети дуплетов во вложенные УП
#eval DupletListToReferenceList [(121, 1), (21, 2), (1343, 2)]
-- Ожидается результат: [121, 21, 1343]

#eval DupletListToReferenceList [(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)]
-- Ожидается результат: [121, 21, 1343]

-- Чтение вложенных УП из сети дуплетов по индексу дуплета — начала вложенных УП
#eval DupletListReadReferenceList [(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)] 0
-- Ожидается результат: [121, 21, 1343]

#eval DupletListReadReferenceList [(121, 1), (21, 2), (1343, 2), (12, 4), (23, 5), (34, 5)] 3
-- Ожидается результат: [12, 23, 34]

-- Определяем сеть вложенных УП
def testReferenceListList : NetworkReferenceListList :=
  [[121, 21, 1343], [12, 23], [34], [121, 21, 1343], [12, 23], [34]]

-- Преобразованная сеть вложенных УП в сеть дуплетов
def testDupletList := ReferenceListListToDupletList testReferenceListList

-- Вычисление преобразованной сети вложенных УП в сеть дуплетов
#eval testDupletList

-- Вычисление преобразования сети вложенных УП в сеть дуплетов и обратно в testReferenceListList
#eval DupletListToReferenceListList testDupletList

-- Вычисление смещения вложенных УП в сети дуплетов по их порядковому номеру
#eval DupletListOffsetReferenceList testDupletList 0 -- Ожидается результат: 0
#eval DupletListOffsetReferenceList testDupletList 1 -- Ожидается результат: 3
#eval DupletListOffsetReferenceList testDupletList 2 -- Ожидается результат: 5
#eval DupletListOffsetReferenceList testDupletList 3 -- Ожидается результат: 6
#eval DupletListOffsetReferenceList testDupletList 4 -- Ожидается результат: 9
#eval DupletListOffsetReferenceList testDupletList 5 -- Ожидается результат: 11
#eval DupletListOffsetReferenceList testDupletList 6 -- Ожидается результат: 12
#eval DupletListOffsetReferenceList testDupletList 7 -- Ожидается результат: 12

-- Определяем трёхмерную сеть как последовательность кортежей длины 3
def testTupleList : NetworkTupleList 3 :=
  [#v[0, 0, 0], #v[1, 1, 2], #v[2, 4, 0], #v[3, 0, 5], #v[4, 1, 1], #v[0, 0, 0]]

-- Преобразованная трёхмерная сеть в сеть дуплетов через сеть вложенных УП
def testTuplesToDupletList : NetworkDupletList := TupleListToDupletList testTupleList

-- Вычисление трёхмерной сети преобразованной в сеть дуплетов
#eval testTuplesToDupletList

-- Преобразование и обратно в трёхмерную сеть
def resultTuplesNetwork : NetworkTupleList 3 :=
  ReferenceListListToTupleList (DupletListToReferenceListList testTuplesToDupletList)

-- Итоговая проверка эквивалентности сетей
#eval resultTuplesNetwork.map (·.toList)
-- Ожидается результат:
-- [[0, 0, 0], [1, 1, 2], [2, 4, 0], [3, 0, 5], [4, 1, 1], [0, 0, 0]]
