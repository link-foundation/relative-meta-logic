Require Import PeanoNat.
Require Import Coq.Init.Nat.
Require Import Vector.
Require Import List.
Require Import Coq.Init.Datatypes.
Import ListNotations.
Import VectorNotations.
Require Import NetworkDefinitions.
Require Import NetworkConversions.
Require Import NetworkEquivalence.

(* Лемма о сохранении длины кортежей сети *)
Lemma TupleOfReferencesDimensionPreserved : forall {l: nat} (t: TupleOfReferences l), List.length (TupleOfReferencesToReferenceList t) = l.
Proof.
  intros l t.
  induction t.
  - simpl. reflexivity.
  - simpl. rewrite IHt. reflexivity.
Qed.


(* Лемма о взаимном обращении функций ReferenceListToTupleOfReferencesOption и TupleOfReferencesToReferenceList

   ReferenceListToTupleOfReferencesInverse доказывает, что каждый кортеж TupleOfReferences без потери данных может быть преобразован в ReferenceList
   с помощью TupleOfReferencesToReferenceList и обратно в TupleOfReferences с помощью ReferenceListToTupleOfReferencesOption.

   В формальном виде forall n: nat, forall t: TupleOfReferences n, ReferenceListToTupleOfReferencesOption n (TupleOfReferencesToReferenceList t) = Some t говорит о том,
   что для всякого натурального числа n и каждого кортежа TupleOfReferences длины n,
   мы можем преобразовать TupleOfReferences в ReferenceList с помощью TupleOfReferencesToReferenceList,
   затем обратно преобразовать результат в TupleOfReferences с помощью ReferenceListToTupleOfReferencesOption n,
   и в итоге получить тот же кортеж TupleOfReferences, что и в начале.

   Это свойство очень важно, потому что оно гарантирует,
   что эти две функции образуют обратную пару на множестве преобразуемых кортежей TupleOfReferences и ReferenceList.
   Когда вы применяете обе функции к значениям в этом множестве, вы в итоге получаете исходное значение.
   Это означает, что никакая информация не теряется при преобразованиях,
   так что можно свободно конвертировать между TupleOfReferences и ReferenceList,
   если это требуется в реализации или доказательствах.
*)
Lemma ReferenceListToTupleOfReferencesInverse: forall n: nat, forall t: TupleOfReferences n, ReferenceListToTupleOfReferencesOption n (TupleOfReferencesToReferenceList t) = Some t.
Proof.
  intros n.
  induction t as [| h n' t' IH].
  - simpl. reflexivity.
  - simpl. rewrite IH. reflexivity.
Qed.


(*
  Теорема обёртывания и восстановления сети кортежей:

  Пусть дана сеть кортежей длины n, обозначенная как Nⁿ : Reference → Tⁿ.
  Определим операцию отображения этой сети в сеть вложенных упорядоченных пар N^{list} : Reference → ReferenceList,
  где ReferenceList = {(∅,∅) | (l, np), l ∈ Reference, np ∈ ReferenceList}.
  Затем определим обратное отображение из сети вложенных упорядоченных пар обратно
  в сеть кортежей длины n.

  Теорема утверждает:

  Для любой сети кортежей длины n, Nⁿ, применение операции преобразования
  в сеть вложенных упорядоченных пар и обратное преобразование обратно
  в сеть кортежей длины n обеспечивает восстановление исходной сети Nⁿ.
  Иначе говоря:

  ∀ Nⁿ : Reference → Tⁿ, обратно(вперёд(Nⁿ)) = Nⁿ.
*)
Theorem TupleFunctionEquivalenceAfterTransforms : forall {n: nat} (anet: NetworkTupleFunction n),
  TupleFunctionEquivalence anet (fun id => match ReferenceListToTupleOfReferencesOption n ((TupleFunctionToReferenceListFunction anet) id) with
  | Some t => t
  | None => anet id
  end).
Proof.
  intros n net id.
  unfold TupleFunctionToReferenceListFunction.
  simpl.
  rewrite ReferenceListToTupleOfReferencesInverse.
  reflexivity.
Qed.


(* Лемма о сохранении длины списков ReferenceList в сети дуплетов *)
Lemma ReferenceListDimensionPreserved : forall (offset: nat) (np: ReferenceList),
  length np = length (ReferenceListToDupletList_ offset np).
Proof.
  intros offset np.
  generalize dependent offset.
  induction np as [| n np' IHnp']; intros offset.
  - simpl. reflexivity.
  - destruct np' as [| m np'']; simpl; simpl in IHnp'.
  + reflexivity.
  + rewrite IHnp' with (offset := S offset). reflexivity.
Qed.
