Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import Vector.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Import VectorNotations.
Require Import NetworkDefinitions.

(* Функция преобразования TupleOfReferences в ReferenceList *)
Fixpoint TupleOfReferencesToReferenceList {n : nat} (v : TupleOfReferences n) : ReferenceList :=
  match v with
  | Vector.nil _ => List.nil
  | Vector.cons _ h _ t => List.cons h (TupleOfReferencesToReferenceList t)
  end.

(* Функция преобразования NetworkTupleFunction в NetworkReferenceListFunction *)
Definition TupleFunctionToReferenceListFunction {n : nat} (a: NetworkTupleFunction n) : NetworkReferenceListFunction :=
  fun id => TupleOfReferencesToReferenceList (a id).

(* Функция преобразования NetworkTupleList в NetworkReferenceListList *)
Definition TupleListToReferenceListList {n: nat} (net: NetworkTupleList n) : NetworkReferenceListList :=
  map TupleOfReferencesToReferenceList net.

(* Функция преобразования ReferenceList в TupleOfReferences, возвращающая option *)
Fixpoint ReferenceListToTupleOfReferencesOption (n: nat) (p: ReferenceList) : option (TupleOfReferences n) :=
  match n, p with
  | 0, List.nil => Some (Vector.nil nat)
  | S n', List.cons f p' =>
  match ReferenceListToTupleOfReferencesOption n' p' with
  | None => None
  | Some t => Some (Vector.cons nat f n' t)
  end
  | _, _ => None
  end.

(* Функция преобразования ReferenceList в TupleOfReferences с использованием TupleOfReferencesDefault *)
Definition ReferenceListToTupleOfReferences (n: nat) (p: ReferenceList) : TupleOfReferences n :=
  match ReferenceListToTupleOfReferencesOption n p with
  | None => TupleOfReferencesDefault n
  | Some t => t
  end.

(* Функция преобразования NetworkReferenceListFunction в NetworkTupleFunction *)
Definition ReferenceListFunctionToTupleFunction { n: nat } (net: NetworkReferenceListFunction) : NetworkTupleFunction n :=
  fun id => match ReferenceListToTupleOfReferencesOption n (net id) with
  | Some t => t
  | None => TupleOfReferencesDefault n
  end.

(* Функция преобразования NetworkReferenceListList в NetworkTupleList *)
Definition ReferenceListListToTupleList {n: nat} (net : NetworkReferenceListList) : NetworkTupleList n :=
  map (ReferenceListToTupleOfReferences n) net.

(* Функция преобразования ReferenceList в NetworkDupletList со смещением индексации *)
Fixpoint ReferenceListToDupletList_ (offset: nat) (np: ReferenceList) : NetworkDupletList :=
  match np with
  | nil => nil
  | cons h nil => cons (h, offset) nil
  | cons h t => cons (h, S offset) (ReferenceListToDupletList_ (S offset) t)
  end.

(* Функция преобразования ReferenceList в NetworkDupletList *)
Definition ReferenceListToDupletList (np: ReferenceList) : NetworkDupletList := ReferenceListToDupletList_ 0 np.

(* Функция добавления ReferenceList в хвост NetworkDupletList *)
Definition AddReferenceListToDupletList (anet: NetworkDupletList) (np: ReferenceList) : NetworkDupletList :=
  app anet (ReferenceListToDupletList_ (length anet) np).

(* Функция отрезает голову N² и возвращает хвост начиная с offset *)
Fixpoint DupletListBehead (anet: NetworkDupletList) (offset : nat) : NetworkDupletList :=
  match offset with
  | 0 => anet
  | S n' =>
  match anet with
  | nil => nil
  | cons h t => DupletListBehead t n'
  end
  end.

(* Функция преобразования NetworkDupletList в ReferenceList с индексацией в начале NetworkDupletList начиная с offset *)
Fixpoint DupletListToReferenceList_ (anet: NetworkDupletList) (offset: nat) (index: nat): ReferenceList :=
  match anet with
  | nil => nil
  | cons (x, next_index) tail_anet =>
  if offset =? index then
  cons x (DupletListToReferenceList_ tail_anet (S offset) next_index)
  else
  DupletListToReferenceList_ tail_anet (S offset) index
  end.

(* Функция чтения ReferenceList из NetworkDupletList по индексу дуплета *)
Definition DupletListReadReferenceList (anet: NetworkDupletList) (index: nat) : ReferenceList :=
  DupletListToReferenceList_ anet 0 index.

(* Функция преобразования NetworkDupletList в ReferenceList начиная с головы списка сети *)
Definition DupletListToReferenceList (anet: NetworkDupletList) : ReferenceList := DupletListReadReferenceList anet 0.

(*
  Теперь всё готово для преобразования сети вложенных упорядоченных пар N^{list} : Reference → ReferenceList
  в сеть дуплетов N² : Reference → Reference².

  Данное преобразование можно делать по-разному: с сохранением исходных ссылок на кортежи
  либо с переиндексацией. Переиндексацию можно не делать, если написать дополнительную функцию для
  сети дуплетов, которая возвращает вложенную упорядоченную пару по её ссылке.
*)

(* Функция добавления NetworkReferenceListList в NetworkDupletList *)
Fixpoint AddReferenceListListToDupletList (anetd: NetworkDupletList) (anetl: NetworkReferenceListList) : NetworkDupletList :=
  match anetl with
  | nil => anetd
  | cons h t => AddReferenceListListToDupletList (AddReferenceListToDupletList anetd h) t
  end.

(* Функция преобразования NetworkReferenceListList в NetworkDupletList *)
Definition ReferenceListListToDupletList (anetl: NetworkReferenceListList) : NetworkDupletList :=
  match anetl with
  | nil => nil
  | cons h t => AddReferenceListListToDupletList (ReferenceListToDupletList h) t
  end.

(* Функция поиска ReferenceList в хвосте NetworkDupletList начинающемуся с offset по её порядковому номеру.
   Возвращает offset ReferenceList. *)
Fixpoint DupletListOffsetReferenceList_ (anet: NetworkDupletList) (offset: nat) (index: nat) : nat :=
  match anet with
  | nil => offset + (length anet)
  | cons (_, next_index) tail_anet =>
  match index with
  | O => offset
  | S index' =>
  if offset =? next_index then
  DupletListOffsetReferenceList_ tail_anet (S offset) index'
  else
  DupletListOffsetReferenceList_ tail_anet (S offset) index
  end
  end.

(* Функция поиска ReferenceList в NetworkDupletList по её порядковому номеру. Возвращает offset ReferenceList. *)
Definition DupletListOffsetReferenceList (anet: NetworkDupletList) (index: nat) : nat :=
  DupletListOffsetReferenceList_ anet 0 index.

(* Функция преобразования NetworkTupleList в NetworkDupletList *)
Definition TupleListToDupletList {n : nat} (anetv: NetworkTupleList n) : NetworkDupletList :=
  ReferenceListListToDupletList (TupleListToReferenceListList anetv).

(*
  Теперь всё готово для преобразования сети дуплетов N² : Reference → Reference²
  в сеть вложенных упорядоченных пар N^{list} : Reference → ReferenceList.

  Данное преобразование будем делать с сохранением исходных ссылок на кортежи.
  Переиндексацию можно не делать, потому что есть функция DupletListOffsetReferenceList для
  сети дуплетов, которая возвращает смещение вложенной УП по ссылке на неё.
*)

(* Функция отрезает первую ReferenceList из NetworkDupletList и возвращает хвост *)
Fixpoint DupletListBeheadReferenceList (anet: NetworkDupletList) (offset: nat) : NetworkDupletList :=
  match anet with
  | nil => nil
  | cons (_, next_index) tail_anet =>
  if offset =? next_index then (* конец ReferenceList *)
  tail_anet
  else (* ещё не конец ReferenceList *)
  DupletListBeheadReferenceList tail_anet (S offset)
  end.

(* Функция преобразования ReferenceList и NetworkDupletList со смещения offset в NetworkReferenceListList *)
Fixpoint DupletListToReferenceListList_ (anetd: NetworkDupletList) (np: ReferenceList) (offset: nat) : NetworkReferenceListList :=
  match anetd with
  | nil => nil (* отбрасываем ReferenceList даже если она недостроена *)
  | cons (x, next_index) tail_anet =>
  if offset =? next_index then (* конец ReferenceList, переходим к следующей ReferenceList *)
  cons (app np (cons x nil)) (DupletListToReferenceListList_ tail_anet nil (S offset))
  else (* ещё не конец ReferenceList, парсим сеть дуплетов дальше *)
  DupletListToReferenceListList_ tail_anet (app np (cons x nil)) (S offset)
  end.

(* Функция преобразования NetworkDupletList в NetworkReferenceListList *)
Definition DupletListToReferenceListList (anetd: NetworkDupletList) : NetworkReferenceListList :=
  DupletListToReferenceListList_ anetd nil ReferenceDefault.
