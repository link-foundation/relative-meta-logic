/-
  NetworkConversions.lean

  Функции преобразования между различными представлениями сетей.
  Lean 4 перевод NetworkConversions.v (Rocq).
-/
import NetworkDefinitions

-- Функция преобразования TupleOfReferences в ReferenceList
def TupleOfReferencesToReferenceList {n : Nat} (v : TupleOfReferences n) : ReferenceList :=
  v.toList

-- Функция преобразования NetworkTupleFunction в NetworkReferenceListFunction
def TupleFunctionToReferenceListFunction {n : Nat} (a : NetworkTupleFunction n) : NetworkReferenceListFunction :=
  fun id => TupleOfReferencesToReferenceList (a id)

-- Функция преобразования NetworkTupleList в NetworkReferenceListList
def TupleListToReferenceListList {n : Nat} (net : NetworkTupleList n) : NetworkReferenceListList :=
  net.map TupleOfReferencesToReferenceList

-- Функция преобразования ReferenceList в TupleOfReferences, возвращающая option
def ReferenceListToTupleOfReferencesOption (n : Nat) (p : ReferenceList) : Option (TupleOfReferences n) :=
  let arr := p.toArray
  if h : arr.size = n then
    some ⟨arr, h⟩
  else
    none

-- Функция преобразования ReferenceList в TupleOfReferences с использованием TupleOfReferencesDefault
def ReferenceListToTupleOfReferences (n : Nat) (p : ReferenceList) : TupleOfReferences n :=
  match ReferenceListToTupleOfReferencesOption n p with
  | none => TupleOfReferencesDefault n
  | some t => t

-- Функция преобразования NetworkReferenceListFunction в NetworkTupleFunction
def ReferenceListFunctionToTupleFunction {n : Nat} (net : NetworkReferenceListFunction) : NetworkTupleFunction n :=
  fun id => match ReferenceListToTupleOfReferencesOption n (net id) with
  | some t => t
  | none => TupleOfReferencesDefault n

-- Функция преобразования NetworkReferenceListList в NetworkTupleList
def ReferenceListListToTupleList {n : Nat} (net : NetworkReferenceListList) : NetworkTupleList n :=
  net.map (ReferenceListToTupleOfReferences n)

-- Функция преобразования ReferenceList в NetworkDupletList со смещением индексации
def ReferenceListToDupletList_ (offset : Nat) : ReferenceList → NetworkDupletList
  | [] => []
  | [h] => [(h, offset)]
  | h :: t => (h, offset + 1) :: ReferenceListToDupletList_ (offset + 1) t

-- Функция преобразования ReferenceList в NetworkDupletList
def ReferenceListToDupletList (np : ReferenceList) : NetworkDupletList :=
  ReferenceListToDupletList_ 0 np

-- Функция добавления ReferenceList в хвост NetworkDupletList
def AddReferenceListToDupletList (anet : NetworkDupletList) (np : ReferenceList) : NetworkDupletList :=
  anet ++ ReferenceListToDupletList_ anet.length np

-- Функция отрезает голову N² и возвращает хвост начиная с offset
def DupletListBehead (anet : NetworkDupletList) : Nat → NetworkDupletList
  | 0 => anet
  | Nat.succ n => match anet with
    | [] => []
    | _ :: t => DupletListBehead t n

-- Функция преобразования NetworkDupletList в ReferenceList с индексацией в начале NetworkDupletList начиная с offset
def DupletListToReferenceList_ (anet : NetworkDupletList) (offset : Nat) (index : Nat) : ReferenceList :=
  match anet with
  | [] => []
  | (x, next_index) :: tail_anet =>
    if offset == index then
      x :: DupletListToReferenceList_ tail_anet (offset + 1) next_index
    else
      DupletListToReferenceList_ tail_anet (offset + 1) index

-- Функция чтения ReferenceList из NetworkDupletList по индексу дуплета
def DupletListReadReferenceList (anet : NetworkDupletList) (index : Nat) : ReferenceList :=
  DupletListToReferenceList_ anet 0 index

-- Функция преобразования NetworkDupletList в ReferenceList начиная с головы списка сети
def DupletListToReferenceList (anet : NetworkDupletList) : ReferenceList :=
  DupletListReadReferenceList anet 0

/-
  Теперь всё готово для преобразования сети вложенных упорядоченных пар N^{list} : Reference → ReferenceList
  в сеть дуплетов N² : Reference → Reference².

  Данное преобразование можно делать по-разному: с сохранением исходных ссылок на кортежи
  либо с переиндексацией. Переиндексацию можно не делать, если написать дополнительную функцию для
  сети дуплетов, которая возвращает вложенную упорядоченную пару по её ссылке.
-/

-- Функция добавления NetworkReferenceListList в NetworkDupletList
def AddReferenceListListToDupletList : NetworkDupletList → NetworkReferenceListList → NetworkDupletList
  | anetd, [] => anetd
  | anetd, h :: t => AddReferenceListListToDupletList (AddReferenceListToDupletList anetd h) t

-- Функция преобразования NetworkReferenceListList в NetworkDupletList
def ReferenceListListToDupletList : NetworkReferenceListList → NetworkDupletList
  | [] => []
  | h :: t => AddReferenceListListToDupletList (ReferenceListToDupletList h) t

-- Функция поиска ReferenceList в хвосте NetworkDupletList начинающемуся с offset по её порядковому номеру.
-- Возвращает offset ReferenceList.
def DupletListOffsetReferenceList_ (anet : NetworkDupletList) (offset : Nat) (index : Nat) : Nat :=
  match anet with
  | [] => offset + anet.length
  | (_, next_index) :: tail_anet =>
    match index with
    | 0 => offset
    | Nat.succ index' =>
      if offset == next_index then
        DupletListOffsetReferenceList_ tail_anet (offset + 1) index'
      else
        DupletListOffsetReferenceList_ tail_anet (offset + 1) index

-- Функция поиска ReferenceList в NetworkDupletList по её порядковому номеру. Возвращает offset ReferenceList.
def DupletListOffsetReferenceList (anet : NetworkDupletList) (index : Nat) : Nat :=
  DupletListOffsetReferenceList_ anet 0 index

-- Функция преобразования NetworkTupleList в NetworkDupletList
def TupleListToDupletList {n : Nat} (anetv : NetworkTupleList n) : NetworkDupletList :=
  ReferenceListListToDupletList (TupleListToReferenceListList anetv)

/-
  Теперь всё готово для преобразования сети дуплетов N² : Reference → Reference²
  в сеть вложенных упорядоченных пар N^{list} : Reference → ReferenceList.

  Данное преобразование будем делать с сохранением исходных ссылок на кортежи.
  Переиндексацию можно не делать, потому что есть функция DupletListOffsetReferenceList для
  сети дуплетов, которая возвращает смещение вложенной УП по ссылке на неё.
-/

-- Функция отрезает первую ReferenceList из NetworkDupletList и возвращает хвост
def DupletListBeheadReferenceList (anet : NetworkDupletList) (offset : Nat) : NetworkDupletList :=
  match anet with
  | [] => []
  | (_, next_index) :: tail_anet =>
    if offset == next_index then
      tail_anet
    else
      DupletListBeheadReferenceList tail_anet (offset + 1)

-- Функция преобразования ReferenceList и NetworkDupletList со смещения offset в NetworkReferenceListList
def DupletListToReferenceListList_ (anetd : NetworkDupletList) (np : ReferenceList) (offset : Nat) : NetworkReferenceListList :=
  match anetd with
  | [] => []  -- отбрасываем ReferenceList даже если она недостроена
  | (x, next_index) :: tail_anet =>
    if offset == next_index then  -- конец ReferenceList, переходим к следующей ReferenceList
      (np ++ [x]) :: DupletListToReferenceListList_ tail_anet [] (offset + 1)
    else  -- ещё не конец ReferenceList, парсим сеть дуплетов дальше
      DupletListToReferenceListList_ tail_anet (np ++ [x]) (offset + 1)

-- Функция преобразования NetworkDupletList в NetworkReferenceListList
def DupletListToReferenceListList (anetd : NetworkDupletList) : NetworkReferenceListList :=
  DupletListToReferenceListList_ anetd [] ReferenceDefault
