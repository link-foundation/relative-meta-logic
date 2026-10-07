/-
R147/R148: unbounded conditional independence results.
Only core Lean is used. No assumption here identifies links with this contract,
authorizes a completion class, or gives an output orientation semantic authority.
-/
namespace OrientationIndependence

universe u v w z

def Equivariant {G : Type u} {X : Type v} {Y : Type w}
    (actX : G → X → X) (actY : G → Y → Y) (f : X → Y) : Prop :=
  ∀ g x, f (actX g x) = actY g (f x)

def Commutes {G : Type u} {Y : Type v}
    (act : G → Y → Y) (rev : Y → Y) : Prop :=
  ∀ g y, rev (act g y) = act g (rev y)

def Involutive {Y : Type u} (rev : Y → Y) : Prop := ∀ y, rev (rev y) = y

def OrbitRelated {G : Type u} {Y : Type v}
    (act : G → Y → Y) (y z : Y) : Prop := ∃ g, act g y = z

-- These results need a family of transformations, not finiteness or group laws.
theorem reverse_equivariant {G : Type u} {X : Type v} {Y : Type w}
    {actX : G → X → X} {actY : G → Y → Y} {rev : Y → Y} {f : X → Y}
    (hc : Commutes actY rev) (hf : Equivariant actX actY f) :
    Equivariant actX actY (fun x => rev (f x)) := by
  intro g x
  exact (congrArg rev (hf g x)).trans (hc g (f x))

theorem reverse_selector_distinct {X : Type u} {Y : Type v}
    (rev : Y → Y) (f : X → Y) (x : X) (hn : rev (f x) ≠ f x) :
    (fun z => rev (f z)) ≠ f := by
  intro h
  exact hn (congrArg (fun k => k x) h)

theorem equal_stabilizers {G : Type u} {Y : Type v}
    {act : G → Y → Y} {rev : Y → Y}
    (hc : Commutes act rev) (hi : Involutive rev) (g : G) (y : Y) :
    act g (rev y) = rev y ↔ act g y = y := by
  constructor
  · intro h
    have hh := congrArg rev h
    rw [hc g (rev y), hi y] at hh
    exact hh
  · intro h
    exact (hc g y).symm.trans (congrArg rev h)

theorem reverse_orbit {G : Type u} {Y : Type v}
    {act : G → Y → Y} {rev : Y → Y}
    (hc : Commutes act rev) (hi : Involutive rev) (y z : Y) :
    OrbitRelated act (rev y) (rev z) ↔ OrbitRelated act y z := by
  constructor
  · rintro ⟨g, h⟩
    refine ⟨g, ?_⟩
    have hh := congrArg rev h
    rw [hc g (rev y), hi y, hi z] at hh
    exact hh
  · rintro ⟨g, h⟩
    exact ⟨g, (hc g y).symm.trans (congrArg rev h)⟩

-- A selection criterion must ALSO be reversal-closed for non-uniqueness.
theorem reversal_closed_criterion_has_alternative
    {G : Type u} {X : Type v} {Y : Type w}
    {actX : G → X → X} {actY : G → Y → Y} {rev : Y → Y}
    (C : (X → Y) → Prop) (hc : Commutes actY rev)
    (hC : ∀ f, C f → C (fun x => rev (f x)))
    (f : X → Y) (hf : Equivariant actX actY f) (hCf : C f)
    (x : X) (hn : rev (f x) ≠ f x) :
    ∃ other, Equivariant actX actY other ∧ C other ∧ other x ≠ f x := by
  exact ⟨(fun z => rev (f z)), reverse_equivariant hc hf, hC f hCf, hn⟩

-- Stronger impossibility needs a symmetry fixing the input but no allowed output.
theorem stabilizer_obstruction {G : Type u} {X : Type v} {Y : Type w}
    {actX : G → X → X} {actY : G → Y → Y}
    (allowed : X → Y → Prop) (x : X) (g : G) (hx : actX g x = x)
    (hm : ∀ y, allowed x y → actY g y ≠ y) :
    ¬ ∃ f, Equivariant actX actY f ∧ allowed x (f x) := by
  rintro ⟨f, hf, ha⟩
  have h := hf g x
  rw [hx] at h
  exact hm (f x) ha h.symm

theorem exchanged_pair_obstruction {G : Type u} {X : Type v} {Y : Type w}
    {actX : G → X → X} {actY : G → Y → Y}
    (x : X) (g : G) (a b : Y) (hx : actX g x = x)
    (hab : a ≠ b) (ha : actY g a = b) (hb : actY g b = a) :
    ¬ ∃ f, Equivariant actX actY f ∧ (f x = a ∨ f x = b) := by
  apply stabilizer_obstruction (fun _ y => y = a ∨ y = b) x g hx
  intro y hy hfix
  rcases hy with h | h
  · subst y
    exact hab (ha.symm.trans hfix).symm
  · subst y
    exact hab (hb.symm.trans hfix)

-- Candidate output reversal commutes with every address map (even non-injective).
def reversePair {A : Type u} (p : A × A) : A × A := (p.2, p.1)
def mapPair {A : Type u} {B : Type v} (f : A → B) (p : A × A) : B × B :=
  (f p.1, f p.2)
def actPair {A : Type u} (g : (A → A) × Bool) (p : A × A) : A × A :=
  if g.2 then reversePair (mapPair g.1 p) else mapPair g.1 p

theorem reverse_pair_involutive {A : Type u} : Involutive (@reversePair A) := by
  intro p
  rfl

theorem reverse_pair_commutes {A : Type u} : Commutes (@actPair A) reversePair := by
  intro g p
  rcases g with ⟨f, b⟩
  cases b <;> rfl

theorem reverse_pair_nonfixed {A : Type u} (a b : A) (h : a ≠ b) :
    reversePair (a, b) ≠ (a, b) := by
  intro hp
  exact h (congrArg Prod.snd hp)

-- Equal stabilizers do NOT imply equal orbits or indistinguishability.
def rigidAction (_ : Unit) (b : Bool) : Bool := b

theorem rigid_candidates_separated : ¬ OrbitRelated rigidAction false true := by
  rintro ⟨_, h⟩
  cases h

theorem rigid_candidate_distinction_is_invariant (g : Unit) (b : Bool) :
    (rigidAction g b = false) ↔ b = false := Iff.rfl

theorem rigid_reverse_commutes : Commutes rigidAction Bool.not := by
  intro _ _
  rfl

-- Named ordered input positions already support an equivariant alignment rule.
theorem ordered_alignment_equivariant {A : Type u} :
    Equivariant (@mapPair A A) (@mapPair A A) (fun p => p) := by
  intro _ _
  rfl

theorem ordered_alignment_excludes_reverse {A : Type u} (a b : A) (h : a ≠ b) :
    ¬ (∀ p : A × A, reversePair p = p) := by
  intro hall
  exact reverse_pair_nonfixed a b h (hall (a, b))

-- A selector fixed by reversal has no distinct twin: non-degeneracy is necessary.
theorem diagonal_reversal_fixed {A : Type u} (a : A) : reversePair (a, a) = (a, a) := rfl

-- Involution alone is insufficient if transformations treat output slots differently.
def flipInput (_ : Unit) (b : Bool) : Bool := !b
def flipFirst (_ : Unit) (p : Bool × Bool) : Bool × Bool := (!p.1, p.2)
def asymmetricSelector (b : Bool) : Bool × Bool := (b, false)

theorem asymmetric_selector_equivariant :
    Equivariant flipInput flipFirst asymmetricSelector := by
  intro _ _
  rfl

theorem noncommuting_reversal_breaks_equivariance :
    ¬ Equivariant flipInput flipFirst (fun b => reversePair (asymmetricSelector b)) := by
  intro h
  have hh := congrArg Prod.fst (h () false)
  cases hh

-- No arbitrary readout can recover an omitted distinction from equal observations.
theorem same_observation_nondefinability {X : Type u} {O : Type v} {Y : Type w}
    (observe : X → O) (desired : X → Y) (x z : X)
    (ho : observe x = observe z) (hd : desired x ≠ desired z) :
    ¬ ∃ readout : O → Y, ∀ s, readout (observe s) = desired s := by
  rintro ⟨readout, hr⟩
  exact hd ((hr x).symm.trans ((congrArg readout ho).trans (hr z)))

-- R147's completion semantics is explicit, not an intrinsic definition of links.
def Extends {A : Type u} (positive model : A → Prop) : Prop :=
  ∀ a, positive a → model a

def Consequence {A : Type u} (models : (A → Prop) → Prop) (a : A) : Prop :=
  ∀ model, models model → model a

def Possible {A : Type u} (models : (A → Prop) → Prop) (a : A) : Prop :=
  ∃ model, models model ∧ model a

theorem positive_facts_only {A : Type u} (positive : A → Prop) (a : A) :
    Consequence (Extends positive) a ↔ positive a := by
  constructor
  · intro h
    exact h positive (fun _ hp => hp)
  · intro h model hm
    exact hm a h

theorem every_fact_possible {A : Type u} (positive : A → Prop) (a : A) :
    Possible (Extends positive) a := by
  exact ⟨(fun _ => True), (fun _ _ => True.intro), True.intro⟩

theorem unrecorded_fact_has_countermodel {A : Type u}
    (positive : A → Prop) (a : A) (h : ¬ positive a) :
    ∃ model, Extends positive model ∧ ¬ model a := by
  exact ⟨positive, (fun _ hp => hp), h⟩

theorem new_consequence_excludes_base {A : Type u}
    (models : (A → Prop) → Prop) (positive : A → Prop) (a : A)
    (hc : Consequence models a) (hn : ¬ positive a) : ¬ models positive := by
  intro hp
  exact hn (hc positive hp)

theorem union_consequence {A : Type u}
    (left right : (A → Prop) → Prop) (a : A) :
    Consequence (fun model => left model ∨ right model) a ↔
    Consequence left a ∧ Consequence right a := by
  constructor
  · intro h
    exact ⟨(fun m hm => h m (Or.inl hm)), (fun m hm => h m (Or.inr hm))⟩
  · rintro ⟨hl, hr⟩ m (hm | hm)
    · exact hl m hm
    · exact hr m hm

theorem empty_class_is_vacuous {A : Type u}
    (models : (A → Prop) → Prop) (h : ¬ ∃ model, models model) (a : A) :
    Consequence models a := by
  intro model hm
  exact False.elim (h ⟨model, hm⟩)

-- A lossless representation transports distinctions; it does not authorize a rule.
theorem faithful_encoding_injective {X : Type u} {R : Type v}
    (encode : X → R) (decode : R → X) (h : ∀ x, decode (encode x) = x)
    {x z : X} (he : encode x = encode z) : x = z := by
  exact (h x).symm.trans ((congrArg decode he).trans (h z))

theorem faithful_encoding_preserves_distinction {X : Type u} {R : Type v}
    (encode : X → R) (decode : R → X) (h : ∀ x, decode (encode x) = x)
    {x z : X} (hn : x ≠ z) : encode x ≠ encode z := by
  intro he
  exact hn (faithful_encoding_injective encode decode h he)

theorem transport_equivariant {G : Type u} {X : Type v} {Y : Type w}
    {R : Type z} {S : Type z}
    {ax : G → X → X} {ay : G → Y → Y}
    {ar : G → R → R} {as : G → S → S}
    (decode : R → X) (encode : Y → S) (f : X → Y)
    (hd : Equivariant ar ax decode) (he : Equivariant ay as encode)
    (hf : Equivariant ax ay f) :
    Equivariant ar as (fun r => encode (f (decode r))) := by
  intro g r
  change encode (f (decode (ar g r))) = as g (encode (f (decode r)))
  rw [hd g r, hf g (decode r), he g (f (decode r))]

theorem transport_reversal {X : Type u} {Y : Type v} {R : Type w} {S : Type z}
    (decode : R → X) (encode : Y → S) (f : X → Y)
    (revY : Y → Y) (revS : S → S) (hr : ∀ y, encode (revY y) = revS (encode y))
    (r : R) : encode (revY (f (decode r))) = revS (encode (f (decode r))) :=
  hr (f (decode r))

theorem faithful_transport_preserves_alternatives
    {X : Type u} {Y : Type v} {R : Type w} {S : Type z}
    (encodeX : X → R) (decodeX : R → X) (encodeY : Y → S) (decodeY : S → Y)
    (hx : ∀ x, decodeX (encodeX x) = x) (hy : ∀ y, decodeY (encodeY y) = y)
    (f other : X → Y) (x : X) (hn : other x ≠ f x) :
    encodeY (other (decodeX (encodeX x))) ≠ encodeY (f (decodeX (encodeX x))) := by
  rw [hx x]
  exact faithful_encoding_preserves_distinction encodeY decodeY hy hn

-- Equivariantly derived carriers do not break a surviving input symmetry.
def decoratedAction {G : Type u} {X : Type v} {C : Type w}
    (actX : G → X → X) (actC : G → C → C) (g : G) (p : X × C) : X × C :=
  (actX g p.1, actC g p.2)

theorem derived_carrier_preserves_stabilizer {G : Type u} {X : Type v} {C : Type w}
    {actX : G → X → X} {actC : G → C → C} (carrier : X → C)
    (hc : Equivariant actX actC carrier) (g : G) (x : X) :
    decoratedAction actX actC g (x, carrier x) = (x, carrier x) ↔ actX g x = x := by
  constructor
  · intro h
    exact congrArg Prod.fst h
  · intro h
    have hh : actC g (carrier x) = carrier x := (hc g x).symm.trans (congrArg carrier h)
    change (actX g x, actC g (carrier x)) = (x, carrier x)
    rw [h, hh]

theorem equivariant_composition {G : Type u} {X : Type v} {Y : Type w} {Z : Type z}
    {ax : G → X → X} {ay : G → Y → Y} {az : G → Z → Z}
    (f : X → Y) (k : Y → Z) (hf : Equivariant ax ay f) (hk : Equivariant ay az k) :
    Equivariant ax az (fun x => k (f x)) := by
  intro g x
  exact (congrArg k (hf g x)).trans (hk g (f x))

-- Recursing a derived carrier any finite number of times remains equivariant.
def iterate {X : Type u} (step : X → X) : Nat → X → X
  | 0, x => x
  | n + 1, x => step (iterate step n x)

theorem recursive_carrier_equivariant {G : Type u} {X : Type v}
    {act : G → X → X} (step : X → X) (hs : Equivariant act act step) (n : Nat) :
    Equivariant act act (iterate step n) := by
  induction n with
  | zero => intro _ _; rfl
  | succ n ih =>
    exact equivariant_composition (iterate step n) step ih hs

end OrientationIndependence

#print axioms OrientationIndependence.reverse_equivariant
#print axioms OrientationIndependence.reverse_selector_distinct
#print axioms OrientationIndependence.equal_stabilizers
#print axioms OrientationIndependence.reverse_orbit
#print axioms OrientationIndependence.reversal_closed_criterion_has_alternative
#print axioms OrientationIndependence.stabilizer_obstruction
#print axioms OrientationIndependence.exchanged_pair_obstruction
#print axioms OrientationIndependence.reverse_pair_involutive
#print axioms OrientationIndependence.reverse_pair_commutes
#print axioms OrientationIndependence.reverse_pair_nonfixed
#print axioms OrientationIndependence.rigid_candidates_separated
#print axioms OrientationIndependence.rigid_candidate_distinction_is_invariant
#print axioms OrientationIndependence.rigid_reverse_commutes
#print axioms OrientationIndependence.ordered_alignment_equivariant
#print axioms OrientationIndependence.ordered_alignment_excludes_reverse
#print axioms OrientationIndependence.diagonal_reversal_fixed
#print axioms OrientationIndependence.asymmetric_selector_equivariant
#print axioms OrientationIndependence.noncommuting_reversal_breaks_equivariance
#print axioms OrientationIndependence.same_observation_nondefinability
#print axioms OrientationIndependence.positive_facts_only
#print axioms OrientationIndependence.every_fact_possible
#print axioms OrientationIndependence.unrecorded_fact_has_countermodel
#print axioms OrientationIndependence.new_consequence_excludes_base
#print axioms OrientationIndependence.union_consequence
#print axioms OrientationIndependence.empty_class_is_vacuous
#print axioms OrientationIndependence.faithful_encoding_injective
#print axioms OrientationIndependence.faithful_encoding_preserves_distinction
#print axioms OrientationIndependence.transport_equivariant
#print axioms OrientationIndependence.transport_reversal
#print axioms OrientationIndependence.faithful_transport_preserves_alternatives
#print axioms OrientationIndependence.derived_carrier_preserves_stabilizer
#print axioms OrientationIndependence.equivariant_composition
#print axioms OrientationIndependence.recursive_carrier_equivariant
