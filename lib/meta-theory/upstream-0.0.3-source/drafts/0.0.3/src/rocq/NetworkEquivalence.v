Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import Vector.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Import VectorNotations.
Require Import NetworkDefinitions.
Require Import NetworkConversions.

(* Предикат эквивалентности двух сетей кортежей длины n,
   anet1 и anet2 типа NetworkTupleFunction.

   Данный предикат описывает свойство «эквивалентности» для таких сетей.
   Он утверждает, что anet1 и anet2 считаются «эквивалентными», если для каждой ссылки id кортеж,
   связанный с id в anet1, точно совпадает с кортежем, связанным с тем же id в anet2.
*)
Definition TupleFunctionEquivalence {n: nat} (anet1: NetworkTupleFunction n) (anet2: NetworkTupleFunction n) : Prop :=
  forall id, anet1 id = anet2 id.

(* Предикат эквивалентности двух сетей кортежей длины n,
   anet1 и anet2 типа NetworkTupleList.
*)
Definition TupleListEquivalence {n: nat} (anet1: NetworkTupleList n) (anet2: NetworkTupleList n) : Prop :=
  anet1 = anet2.

(* Предикат эквивалентности для сетей дуплетов NetworkDupletFunction *)
Definition DupletFunctionEquivalence (anet1: NetworkDupletFunction) (anet2: NetworkDupletFunction) : Prop := forall id, anet1 id = anet2 id.

(* Предикат эквивалентности для сетей дуплетов NetworkDupletList *)
Definition DupletListEquivalence (anet1: NetworkDupletList) (anet2: NetworkDupletList) : Prop := anet1 = anet2.
