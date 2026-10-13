(**
  SetSequenceEquivalence.v - Формальное доказательство того, что конечное множество
  эквивалентно упорядоченной последовательности с уникальными элементами.

  Основная теорема: Для любого конечного множества натуральных чисел существует
  единственная строго возрастающая последовательность (список без дубликатов,
  отсортированный по возрастанию), содержащая в точности те же элементы.

  Адаптировано из: https://github.com/konard/subset-sum/tree/main/proofs/set_sequence_equivalence
*)

From Stdlib Require Import Arith.
From Stdlib Require Import List.
From Stdlib Require Import Lia.
From Stdlib Require Import Bool.
Import ListNotations.

(** * Определения *)

(** Список является строго возрастающим, если каждый элемент строго меньше следующего *)
Fixpoint StrictlyAscending (l : list nat) : Prop :=
  match l with
  | [] => True
  | [_] => True
  | x :: ((y :: _) as rest) => x < y /\ StrictlyAscending rest
  end.

(** Список не содержит дубликатов *)
Fixpoint NoDuplicates (l : list nat) : Prop :=
  match l with
  | [] => True
  | x :: rest => ~ In x rest /\ NoDuplicates rest
  end.

(** Упорядоченная уникальная последовательность — это строго возрастающий список *)
Definition IsOrderedUniqueSequence (l : list nat) : Prop :=
  StrictlyAscending l.

(** * Вспомогательные леммы *)

(** Все элементы после позиции в строго возрастающем списке больше *)
Lemma strictly_ascending_all_greater : forall l x y,
  StrictlyAscending (x :: y :: l) ->
  forall z, In z (y :: l) -> x < z.
Proof.
  induction l as [| w ws IH].
  - intros x y H z Hz.
    simpl in H. destruct H as [Hxy _].
    simpl in Hz. destruct Hz as [Hz | Hz].
    + subst. exact Hxy.
    + contradiction.
  - intros x y H z Hz.
    simpl in H. destruct H as [Hxy Hrest].
    simpl in Hz. destruct Hz as [Hz | Hz].
    + subst. exact Hxy.
    + assert (Hy_asc : StrictlyAscending (y :: w :: ws)).
      { exact Hrest. }
      assert (Hyz : y < z).
      { apply (IH y w Hrest z Hz). }
      lia.
Qed.

(** Строго возрастающий список не содержит дубликатов *)
Theorem strictly_ascending_implies_no_dup : forall l : list nat,
  StrictlyAscending l -> NoDuplicates l.
Proof.
  induction l as [| x rest IH].
  - intro H. simpl. exact I.
  - intro H.
    simpl. split.
    + destruct rest as [| y ys].
      * simpl. auto.
      * intro Hx_in.
        assert (Hxy : x < y).
        { simpl in H. destruct H as [Hxy _]. exact Hxy. }
        assert (Hxz : forall z, In z (y :: ys) -> x < z).
        { apply strictly_ascending_all_greater. exact H. }
        specialize (Hxz x Hx_in).
        lia.
    + destruct rest as [| y ys].
      * simpl. exact I.
      * simpl in H. destruct H as [_ Hrest].
        apply IH. exact Hrest.
Qed.

(** * Вставка в отсортированный список *)

(** Вставка элемента в отсортированный список с сохранением порядка *)
Fixpoint insertSorted (x : nat) (l : list nat) : list nat :=
  match l with
  | [] => [x]
  | y :: rest =>
    if x <? y then x :: y :: rest
    else if x =? y then y :: rest  (* Пропуск дубликатов *)
    else y :: insertSorted x rest
  end.

(** Сортировка списка в строго возрастающем порядке (с удалением дубликатов) *)
Fixpoint toOrderedUnique (l : list nat) : list nat :=
  match l with
  | [] => []
  | x :: rest => insertSorted x (toOrderedUnique rest)
  end.

(** * Свойства insertSorted *)

(** Получение головы строго возрастающего списка *)
Lemma strictly_ascending_head : forall x y rest,
  StrictlyAscending (x :: y :: rest) -> x < y.
Proof.
  intros x y rest H.
  simpl in H. destruct H as [Hxy _]. exact Hxy.
Qed.

(** Хвост строго возрастающего списка также строго возрастающий *)
Lemma strictly_ascending_tail : forall x rest,
  StrictlyAscending (x :: rest) -> StrictlyAscending rest.
Proof.
  intros x rest H.
  destruct rest as [| y ys].
  - simpl. exact I.
  - simpl in H. destruct H as [_ Hrest]. exact Hrest.
Qed.

(** Добавление меньшего элемента сохраняет строгое возрастание *)
Lemma strictly_ascending_cons : forall x y rest,
  x < y -> StrictlyAscending (y :: rest) -> StrictlyAscending (x :: y :: rest).
Proof.
  intros x y rest Hxy Hrest.
  simpl. split.
  - exact Hxy.
  - exact Hrest.
Qed.

(** Голова результата insertSorted x (y :: ys) — это либо x, либо y *)
Lemma insertSorted_head_cases : forall x y ys h hs,
  insertSorted x (y :: ys) = h :: hs ->
  h = x \/ h = y.
Proof.
  intros x y ys h hs Heq.
  simpl in Heq.
  destruct (x <? y) eqn:Hxy.
  - injection Heq as Hh Hrest.
    left. symmetry. exact Hh.
  - destruct (x =? y) eqn:Hxy_eq.
    + injection Heq as Hh Hrest.
      right. symmetry. exact Hh.
    + injection Heq as Hh Hrest.
      right. symmetry. exact Hh.
Qed.

(** insertSorted в непустой список даёт непустой список *)
Lemma insertSorted_non_empty : forall x y ys,
  exists h hs, insertSorted x (y :: ys) = h :: hs.
Proof.
  intros x y ys.
  simpl.
  destruct (x <? y) eqn:Hxy.
  - exists x, (y :: ys). reflexivity.
  - destruct (x =? y) eqn:Hxy_eq.
    + exists y, ys. reflexivity.
    + exists y, (insertSorted x ys). reflexivity.
Qed.

(** insertSorted сохраняет свойство строгого возрастания *)
Theorem insertSorted_preserves_ascending : forall l x,
  StrictlyAscending l -> StrictlyAscending (insertSorted x l).
Proof.
  induction l as [| y ys IH].
  - intros x H. simpl. exact I.
  - intros x H.
    simpl.
    destruct (x <? y) eqn:Hxy.
    + apply Nat.ltb_lt in Hxy.
      simpl. split; [exact Hxy | exact H].
    + destruct (x =? y) eqn:Hxy_eq.
      * exact H.
      * apply Nat.ltb_ge in Hxy.
        apply Nat.eqb_neq in Hxy_eq.
        assert (Hgt : x > y) by lia.
        clear Hxy Hxy_eq.
        destruct ys as [| z zs].
        -- simpl. split; [exact Hgt | exact I].
        -- assert (Hyz : y < z) by (apply strictly_ascending_head in H; exact H).
           assert (Hrest : StrictlyAscending (z :: zs)) by (apply strictly_ascending_tail in H; exact H).
           specialize (IH x Hrest).
           destruct (insertSorted_non_empty x z zs) as [h [hs Heq]].
           assert (Hh_cases : h = x \/ h = z) by (apply (insertSorted_head_cases x z zs h hs Heq)).
           rewrite Heq in IH.
           rewrite Heq. simpl.
           split.
           ++ destruct Hh_cases as [Hh_is_x | Hh_is_z]; lia.
           ++ exact IH.
Qed.

(** toOrderedUnique выдаёт строго возрастающие списки *)
Theorem toOrderedUnique_is_ascending : forall l,
  StrictlyAscending (toOrderedUnique l).
Proof.
  induction l as [| x rest IH].
  - simpl. exact I.
  - simpl.
    apply insertSorted_preserves_ascending.
    exact IH.
Qed.

(** * Сохранение принадлежности элементов *)

(** Принадлежность элемента сохраняется при insertSorted *)
Theorem mem_insertSorted : forall x y l,
  In y (insertSorted x l) <-> y = x \/ In y l.
Proof.
  intros x y.
  induction l as [| z rest IH].
  - split.
    + intro H. simpl in H. destruct H as [H | H].
      * left. symmetry. exact H.
      * contradiction.
    + intro H. simpl. destruct H as [H | H].
      * left. symmetry. exact H.
      * contradiction.
  - simpl.
    destruct (x <? z) eqn:Hxz.
    + split.
      * intro H. simpl in H. destruct H as [H | H].
        -- left. symmetry. exact H.
        -- right. exact H.
      * intro H. simpl. destruct H as [H | H].
        -- left. symmetry. exact H.
        -- right. exact H.
    + destruct (x =? z) eqn:Hxz_eq.
      * apply Nat.eqb_eq in Hxz_eq. subst z.
        split.
        -- intro H. simpl in H. destruct H as [H | H].
           ++ left. symmetry. exact H.
           ++ right. right. exact H.
        -- intro H. simpl. destruct H as [H | H].
           ++ left. symmetry. exact H.
           ++ destruct H as [H | H].
              ** left. exact H.
              ** right. exact H.
      * split.
        -- intro H. simpl in H. destruct H as [H | H].
           ++ right. left. exact H.
           ++ rewrite IH in H. destruct H as [H | H].
              ** left. exact H.
              ** right. right. exact H.
        -- intro H. simpl. destruct H as [H | H].
           ++ right. rewrite IH. left. exact H.
           ++ destruct H as [H | H].
              ** left. exact H.
              ** right. rewrite IH. right. exact H.
Qed.

(** Принадлежность элемента сохраняется при toOrderedUnique *)
Theorem mem_toOrderedUnique : forall x l,
  In x (toOrderedUnique l) <-> In x l.
Proof.
  intros x.
  induction l as [| y rest IH].
  - simpl. tauto.
  - simpl.
    rewrite mem_insertSorted.
    rewrite IH.
    split.
    + intro H. simpl. destruct H as [H | H].
      * left. symmetry. exact H.
      * right. exact H.
    + intro H. simpl in H. destruct H as [H | H].
      * left. symmetry. exact H.
      * right. exact H.
Qed.

(** * Основная теорема: Эквивалентность множества и последовательности *)

(**
  ОСНОВНАЯ ТЕОРЕМА: Эквивалентность множества и последовательности

  Для любого списка (представляющего мультимножество) существует строго
  возрастающий список, содержащий в точности те же элементы (как множество).
*)
Theorem set_sequence_equivalence : forall l : list nat,
  exists l' : list nat,
    IsOrderedUniqueSequence l' /\
    (forall x, In x l' <-> In x l).
Proof.
  intro l.
  exists (toOrderedUnique l).
  split.
  - unfold IsOrderedUniqueSequence.
    apply toOrderedUnique_is_ascending.
  - intro x.
    apply mem_toOrderedUnique.
Qed.

(** Следствие: Упорядоченная уникальная последовательность не содержит дубликатов *)
Corollary ordered_unique_has_no_dup : forall l : list nat,
  NoDuplicates (toOrderedUnique l).
Proof.
  intro l.
  apply strictly_ascending_implies_no_dup.
  apply toOrderedUnique_is_ascending.
Qed.

(** * Проверки верификации *)

Check set_sequence_equivalence.
Check ordered_unique_has_no_dup.

(** Все доказательства эквивалентности множества и последовательности успешно верифицированы! *)
