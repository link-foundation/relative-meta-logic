(* R147/R148: independent Rocq proofs of the conditional, unbounded results.
   No model class, transformation family, or orientation is made authoritative. *)
Set Implicit Arguments.
Set Universe Polymorphism.

Definition Equivariant {G X Y : Type}
    (actX : G -> X -> X) (actY : G -> Y -> Y) (f : X -> Y) : Prop :=
  forall g x, f (actX g x) = actY g (f x).
Definition Commutes {G Y : Type}
    (act : G -> Y -> Y) (rev : Y -> Y) : Prop :=
  forall g y, rev (act g y) = act g (rev y).
Definition Involutive {Y : Type} (rev : Y -> Y) : Prop :=
  forall y, rev (rev y) = y.
Definition OrbitRelated {G Y : Type} (act : G -> Y -> Y) (y z : Y) : Prop :=
  exists g, act g y = z.

Theorem reverse_equivariant {G X Y : Type}
    (actX : G -> X -> X) (actY : G -> Y -> Y) (rev : Y -> Y) (f : X -> Y) :
    Commutes actY rev -> Equivariant actX actY f ->
    Equivariant actX actY (fun x => rev (f x)).
Proof. intros hc hf g x. rewrite hf. apply hc. Qed.

Theorem reverse_selector_distinct {X Y : Type}
    (rev : Y -> Y) (f : X -> Y) (x : X) :
    rev (f x) <> f x -> (fun z => rev (f z)) <> f.
Proof. intros hn h. apply hn. exact (f_equal (fun k => k x) h). Qed.

Theorem equal_stabilizers {G Y : Type}
    (act : G -> Y -> Y) (rev : Y -> Y) :
    Commutes act rev -> Involutive rev -> forall g y,
    act g (rev y) = rev y <-> act g y = y.
Proof.
  intros hc hi g y. split; intro h.
  - pose proof (f_equal rev h) as hh. rewrite hc, !hi in hh. exact hh.
  - rewrite <- hc, h. reflexivity.
Qed.

Theorem reverse_orbit {G Y : Type}
    (act : G -> Y -> Y) (rev : Y -> Y) :
    Commutes act rev -> Involutive rev -> forall y z,
    OrbitRelated act (rev y) (rev z) <-> OrbitRelated act y z.
Proof.
  intros hc hi y z. split; intros [g h]; exists g.
  - pose proof (f_equal rev h) as hh. rewrite hc, !hi in hh. exact hh.
  - rewrite <- hc, h. reflexivity.
Qed.

Theorem reversal_closed_criterion_has_alternative {G X Y : Type}
    (actX : G -> X -> X) (actY : G -> Y -> Y) (rev : Y -> Y)
    (C : (X -> Y) -> Prop) :
    Commutes actY rev ->
    (forall f, C f -> C (fun x => rev (f x))) ->
    forall f, Equivariant actX actY f -> C f -> forall x,
    rev (f x) <> f x ->
    exists other, Equivariant actX actY other /\ C other /\ other x <> f x.
Proof.
  intros hc hC f hf hCf x hn. exists (fun z => rev (f z)).
  split; [apply reverse_equivariant; assumption | split; [apply hC |]; assumption].
Qed.

Theorem stabilizer_obstruction {G X Y : Type}
    (actX : G -> X -> X) (actY : G -> Y -> Y)
    (allowed : X -> Y -> Prop) (x : X) (g : G) :
    actX g x = x -> (forall y, allowed x y -> actY g y <> y) ->
    ~ exists f, Equivariant actX actY f /\ allowed x (f x).
Proof.
  intros hx hm [f [hf ha]]. apply (hm (f x) ha).
  specialize (hf g x). rewrite hx in hf. symmetry. exact hf.
Qed.

Theorem exchanged_pair_obstruction {G X Y : Type}
    (actX : G -> X -> X) (actY : G -> Y -> Y)
    (x : X) (g : G) (a b : Y) :
    actX g x = x -> a <> b -> actY g a = b -> actY g b = a ->
    ~ exists f, Equivariant actX actY f /\ (f x = a \/ f x = b).
Proof.
  intros hx hab ha hb [f [hf [h | h]]]; specialize (hf g x); rewrite hx, h in hf.
  - rewrite ha in hf. contradiction.
  - rewrite hb in hf. apply hab. symmetry. exact hf.
Qed.

Definition reversePair {A : Type} (p : A * A) : A * A := (snd p, fst p).
Definition mapPair {A B : Type} (f : A -> B) (p : A * A) : B * B :=
  (f (fst p), f (snd p)).
Definition actPair {A : Type} (g : (A -> A) * bool) (p : A * A) : A * A :=
  if snd g then reversePair (mapPair (fst g) p) else mapPair (fst g) p.

Theorem reverse_pair_involutive {A : Type} : Involutive (@reversePair A).
Proof. intros [a b]. reflexivity. Qed.
Theorem reverse_pair_commutes {A : Type} : Commutes (@actPair A) reversePair.
Proof. intros [f b] p. destruct b; reflexivity. Qed.
Theorem reverse_pair_nonfixed {A : Type} (a b : A) :
    a <> b -> reversePair (a, b) <> (a, b).
Proof. intros h hp. apply h. exact (f_equal (@snd A A) hp). Qed.

Definition rigidAction (_ : unit) (b : bool) : bool := b.
Definition reverseBool (b : bool) : bool := if b then false else true.
Theorem rigid_candidates_separated : ~ OrbitRelated rigidAction false true.
Proof. intros [g h]. discriminate h. Qed.
Theorem rigid_candidate_distinction_is_invariant (g : unit) (b : bool) :
    rigidAction g b = false <-> b = false.
Proof. split; intro h; exact h. Qed.
Theorem rigid_reverse_commutes : Commutes rigidAction reverseBool.
Proof. intros g b. reflexivity. Qed.

Theorem ordered_alignment_equivariant {A : Type} :
    Equivariant (@mapPair A A) (@mapPair A A) (fun p => p).
Proof. intros g p. reflexivity. Qed.
Theorem ordered_alignment_excludes_reverse {A : Type} (a b : A) :
    a <> b -> ~ (forall p : A * A, reversePair p = p).
Proof. intros h hall. exact (@reverse_pair_nonfixed A a b h (hall (a, b))). Qed.

Theorem diagonal_reversal_fixed {A : Type} (a : A) :
    reversePair (a, a) = (a, a).
Proof. reflexivity. Qed.
Definition flipInput (_ : unit) (b : bool) : bool := reverseBool b.
Definition flipFirst (_ : unit) (p : bool * bool) : bool * bool :=
  (reverseBool (fst p), snd p).
Definition asymmetricSelector (b : bool) : bool * bool := (b, false).
Theorem asymmetric_selector_equivariant :
    Equivariant flipInput flipFirst asymmetricSelector.
Proof. intros g b. reflexivity. Qed.
Theorem noncommuting_reversal_breaks_equivariance :
    ~ Equivariant flipInput flipFirst (fun b => reversePair (asymmetricSelector b)).
Proof. intro h. specialize (h tt false). discriminate h. Qed.

Theorem same_observation_nondefinability {X O Y : Type}
    (observe : X -> O) (desired : X -> Y) (x z : X) :
    observe x = observe z -> desired x <> desired z ->
    ~ exists readout : O -> Y, forall s, readout (observe s) = desired s.
Proof.
  intros ho hd [readout hr]. apply hd. rewrite <- (hr x), <- (hr z), ho. reflexivity.
Qed.

Definition Extends {A : Type} (positive model : A -> Prop) : Prop :=
  forall a, positive a -> model a.
Definition Consequence {A : Type} (models : (A -> Prop) -> Prop) (a : A) : Prop :=
  forall model, models model -> model a.
Definition Possible {A : Type} (models : (A -> Prop) -> Prop) (a : A) : Prop :=
  exists model, models model /\ model a.

Theorem positive_facts_only {A : Type} (positive : A -> Prop) (a : A) :
    Consequence (Extends positive) a <-> positive a.
Proof.
  split.
  - intro h. apply (h positive). intros z hz. exact hz.
  - intros h model hm. exact (hm a h).
Qed.
Theorem every_fact_possible {A : Type} (positive : A -> Prop) (a : A) :
    Possible (Extends positive) a.
Proof. exists (fun _ => True). split; [intros z hz |]; exact I. Qed.
Theorem unrecorded_fact_has_countermodel {A : Type}
    (positive : A -> Prop) (a : A) :
    ~ positive a -> exists model, Extends positive model /\ ~ model a.
Proof. intro h. exists positive. split; [intros z hz; exact hz | exact h]. Qed.
Theorem new_consequence_excludes_base {A : Type}
    (models : (A -> Prop) -> Prop) (positive : A -> Prop) (a : A) :
    Consequence models a -> ~ positive a -> ~ models positive.
Proof. intros hc hn hp. exact (hn (hc positive hp)). Qed.
Theorem union_consequence {A : Type}
    (left right : (A -> Prop) -> Prop) (a : A) :
    Consequence (fun model => left model \/ right model) a <->
    Consequence left a /\ Consequence right a.
Proof.
  split.
  - intro h. split; intros m hm; apply h; [left | right]; exact hm.
  - intros [hl hr] m [hm | hm]; [apply hl | apply hr]; exact hm.
Qed.
Theorem empty_class_is_vacuous {A : Type}
    (models : (A -> Prop) -> Prop) :
    ~ (exists model, models model) -> forall a, Consequence models a.
Proof. intros h a model hm. exfalso. apply h. exists model. exact hm. Qed.

Theorem faithful_encoding_injective {X R : Type}
    (encode : X -> R) (decode : R -> X) :
    (forall x, decode (encode x) = x) -> forall x z, encode x = encode z -> x = z.
Proof. intros h x z he. rewrite <- (h x), <- (h z), he. reflexivity. Qed.
Theorem faithful_encoding_preserves_distinction {X R : Type}
    (encode : X -> R) (decode : R -> X) :
    (forall x, decode (encode x) = x) -> forall x z, x <> z -> encode x <> encode z.
Proof.
  intros h x z hn he. apply hn. exact (@faithful_encoding_injective X R encode decode h x z he).
Qed.
Theorem transport_equivariant {G X Y R S : Type}
    (ax : G -> X -> X) (ay : G -> Y -> Y)
    (ar : G -> R -> R) (az : G -> S -> S)
    (decode : R -> X) (encode : Y -> S) (f : X -> Y) :
    Equivariant ar ax decode -> Equivariant ay az encode -> Equivariant ax ay f ->
    Equivariant ar az (fun r => encode (f (decode r))).
Proof. intros hd he hf g r. rewrite hd, hf, he. reflexivity. Qed.
Theorem transport_reversal {X Y R S : Type}
    (decode : R -> X) (encode : Y -> S) (f : X -> Y)
    (revY : Y -> Y) (revS : S -> S) :
    (forall y, encode (revY y) = revS (encode y)) -> forall r,
    encode (revY (f (decode r))) = revS (encode (f (decode r))).
Proof. intros hr r. apply hr. Qed.

Theorem faithful_transport_preserves_alternatives {X Y R S : Type}
    (encodeX : X -> R) (decodeX : R -> X) (encodeY : Y -> S) (decodeY : S -> Y) :
    (forall x, decodeX (encodeX x) = x) -> (forall y, decodeY (encodeY y) = y) ->
    forall (f other : X -> Y) x, other x <> f x ->
    encodeY (other (decodeX (encodeX x))) <> encodeY (f (decodeX (encodeX x))).
Proof.
  intros hx hy f other x hn. rewrite hx.
  exact (@faithful_encoding_preserves_distinction Y S encodeY decodeY hy (other x) (f x) hn).
Qed.

Definition decoratedAction {G X C : Type}
    (actX : G -> X -> X) (actC : G -> C -> C) (g : G) (p : X * C) : X * C :=
  (actX g (fst p), actC g (snd p)).
Theorem derived_carrier_preserves_stabilizer {G X C : Type}
    (actX : G -> X -> X) (actC : G -> C -> C) (carrier : X -> C) :
    Equivariant actX actC carrier -> forall g x,
    decoratedAction actX actC g (x, carrier x) = (x, carrier x) <-> actX g x = x.
Proof.
  intros hc g x. split.
  - intro h. exact (f_equal (@fst X C) h).
  - intro h. unfold decoratedAction; simpl. rewrite <- hc, h. reflexivity.
Qed.
Theorem equivariant_composition {G X Y Z : Type}
    (ax : G -> X -> X) (ay : G -> Y -> Y) (az : G -> Z -> Z)
    (f : X -> Y) (k : Y -> Z) :
    Equivariant ax ay f -> Equivariant ay az k ->
    Equivariant ax az (fun x => k (f x)).
Proof. intros hf hk g x. rewrite hf, hk. reflexivity. Qed.
Fixpoint iterate {X : Type} (step : X -> X) (n : nat) (x : X) : X :=
  match n with O => x | S k => step (iterate step k x) end.
Theorem recursive_carrier_equivariant {G X : Type}
    (act : G -> X -> X) (step : X -> X) :
    Equivariant act act step -> forall n, Equivariant act act (iterate step n).
Proof.
  intros hs n. induction n as [|n ih].
  - intros g x. reflexivity.
  - intros g x. simpl. rewrite ih, hs. reflexivity.
Qed.

(* Free semantic expansions of the full reduct. No premise identifies this
   investigative contract with every intrinsic property of Links. *)
Record Expansion (X A : Type) : Type := {
  reduct : X;
  holds : A -> Prop
}.
Definition ExpansionAdmitted {X A : Type}
    (theory : X -> Prop) (recorded : X -> A -> Prop) (e : Expansion X A) : Prop :=
  theory (reduct e) /\ Extends (recorded (reduct e)) (holds e).
Definition augment {A : Type} (positive : A -> Prop) (chosen : A) : A -> Prop :=
  fun a => positive a \/ a = chosen.

Theorem same_reduct_all_observations {X A O : Type}
    (left right : Expansion X A) :
    reduct left = reduct right -> forall observe : X -> O,
    observe (reduct left) = observe (reduct right).
Proof. intros h observe. exact (f_equal observe h). Qed.

Theorem augmented_expansion_admissible {X A : Type}
    (theory : X -> Prop) (recorded : X -> A -> Prop) (x : X) :
    theory x -> forall chosen : A,
    ExpansionAdmitted theory recorded
      {| reduct := x; holds := augment (recorded x) chosen |}.
Proof. intros hx chosen. split; [exact hx | intros z hz; left; exact hz]. Qed.

Theorem augmented_expansion_omits_other {A : Type}
    (positive : A -> Prop) (chosen other : A) :
    ~ positive other -> other <> chosen -> ~ augment positive chosen other.
Proof. intros hn hd [h | h]; [apply hn | apply hd]; exact h. Qed.

Theorem reduct_expansions_orientation_independent {X A : Type}
    (theory : X -> Prop) (recorded : X -> A -> Prop) (x : X) :
    theory x -> forall a b : A,
    ~ recorded x a -> ~ recorded x b -> a <> b ->
    exists left right : Expansion X A,
      reduct left = x /\ reduct right = x /\
      ExpansionAdmitted theory recorded left /\ ExpansionAdmitted theory recorded right /\
      holds left a /\ ~ holds left b /\ ~ holds right a /\ holds right b.
Proof.
  intros hx a b ha hb hab.
  exists {| reduct := x; holds := augment (recorded x) a |},
    {| reduct := x; holds := augment (recorded x) b |}.
  split; [reflexivity |]. split; [reflexivity |].
  split; [apply augmented_expansion_admissible; exact hx |].
  split; [apply augmented_expansion_admissible; exact hx |].
  split; [right; reflexivity |].
  split.
  - apply augmented_expansion_omits_other; [exact hb | intro h; apply hab; symmetry; exact h].
  - split.
    + apply augmented_expansion_omits_other; assumption.
    + right; reflexivity.
Qed.

Theorem no_reduct_readout_of_all_expansions {X A : Type}
    (theory : X -> Prop) (recorded : X -> A -> Prop) (x : X) :
    theory x -> forall a, ~ recorded x a ->
    ~ exists readout : X -> A -> Prop, forall e : Expansion X A,
      ExpansionAdmitted theory recorded e -> forall b,
      readout (reduct e) b <-> holds e b.
Proof.
  intros hx a ha [readout h].
  assert (hb : ExpansionAdmitted theory recorded {| reduct := x; holds := recorded x |}).
  { split; [exact hx | intros z hz; exact hz]. }
  pose proof (h {| reduct := x; holds := recorded x |} hb a) as hbase.
  pose proof (h {| reduct := x; holds := augment (recorded x) a |}
    (@augmented_expansion_admissible X A theory recorded x hx a) a) as hmore.
  apply ha. apply (proj1 hbase). apply (proj2 hmore). right; reflexivity.
Qed.

Theorem conservative_definition_expands_every_reduct {X A : Type}
    (theory : X -> Prop) (recorded definition : X -> A -> Prop) :
    (forall x, theory x -> Extends (recorded x) (definition x)) ->
    forall x, theory x -> exists e : Expansion X A,
      reduct e = x /\ ExpansionAdmitted theory recorded e /\
      forall a, holds e a <-> definition x a.
Proof.
  intros hd x hx. exists {| reduct := x; holds := definition x |}.
  split; [reflexivity |]. split.
  - split; [exact hx | exact (hd x hx)].
  - intros a. split; intro h; exact h.
Qed.

Definition RecordedPair {A : Type} (links : A -> A -> A -> Prop) (pair : A * A) : Prop :=
  exists address, links address (fst pair) (snd pair).
Definition orderedChain (address first second : nat) : Prop :=
  (address = 3 /\ first = 0 /\ second = 1) \/
  (address = 4 /\ first = 1 /\ second = 2).

Theorem ordered_chain_forward_unrecorded : ~ RecordedPair orderedChain (0, 2).
Proof. intros [address [[_ [_ h]] | [_ [h _]]]]; discriminate h. Qed.
Theorem ordered_chain_reverse_unrecorded : ~ RecordedPair orderedChain (2, 0).
Proof. intros [address [[_ [h _]] | [_ [h _]]]]; discriminate h. Qed.

Theorem ordered_chain_expansions_independent
    (theory : (nat -> nat -> nat -> Prop) -> Prop) :
    theory orderedChain ->
    exists left right : Expansion (nat -> nat -> nat -> Prop) (nat * nat),
      reduct left = orderedChain /\ reduct right = orderedChain /\
      ExpansionAdmitted theory RecordedPair left /\ ExpansionAdmitted theory RecordedPair right /\
      holds left (0, 2) /\ ~ holds left (2, 0) /\
      ~ holds right (0, 2) /\ holds right (2, 0).
Proof.
  intro ht. apply reduct_expansions_orientation_independent.
  - exact ht.
  - exact ordered_chain_forward_unrecorded.
  - exact ordered_chain_reverse_unrecorded.
  - intro h. discriminate h.
Qed.

Print Assumptions reverse_equivariant.
Print Assumptions reverse_selector_distinct.
Print Assumptions equal_stabilizers.
Print Assumptions reverse_orbit.
Print Assumptions reversal_closed_criterion_has_alternative.
Print Assumptions stabilizer_obstruction.
Print Assumptions exchanged_pair_obstruction.
Print Assumptions reverse_pair_involutive.
Print Assumptions reverse_pair_commutes.
Print Assumptions reverse_pair_nonfixed.
Print Assumptions rigid_candidates_separated.
Print Assumptions rigid_candidate_distinction_is_invariant.
Print Assumptions rigid_reverse_commutes.
Print Assumptions ordered_alignment_equivariant.
Print Assumptions ordered_alignment_excludes_reverse.
Print Assumptions diagonal_reversal_fixed.
Print Assumptions asymmetric_selector_equivariant.
Print Assumptions noncommuting_reversal_breaks_equivariance.
Print Assumptions same_observation_nondefinability.
Print Assumptions positive_facts_only.
Print Assumptions every_fact_possible.
Print Assumptions unrecorded_fact_has_countermodel.
Print Assumptions new_consequence_excludes_base.
Print Assumptions union_consequence.
Print Assumptions empty_class_is_vacuous.
Print Assumptions faithful_encoding_injective.
Print Assumptions faithful_encoding_preserves_distinction.
Print Assumptions transport_equivariant.
Print Assumptions transport_reversal.
Print Assumptions faithful_transport_preserves_alternatives.
Print Assumptions derived_carrier_preserves_stabilizer.
Print Assumptions equivariant_composition.
Print Assumptions recursive_carrier_equivariant.
Print Assumptions same_reduct_all_observations.
Print Assumptions augmented_expansion_admissible.
Print Assumptions augmented_expansion_omits_other.
Print Assumptions reduct_expansions_orientation_independent.
Print Assumptions no_reduct_readout_of_all_expansions.
Print Assumptions conservative_definition_expands_every_reduct.
Print Assumptions ordered_chain_forward_unrecorded.
Print Assumptions ordered_chain_reverse_unrecorded.
Print Assumptions ordered_chain_expansions_independent.
