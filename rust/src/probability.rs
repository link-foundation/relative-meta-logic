//! Bounded truth values, aggregators, and relative statement assessment.
//!
//! The caller supplies priors, source trust, and relations between statements.
//! See the packaged `assess_statement` example for a complete assessment.

use alloc::{format, string::String, vec::Vec};
use core::fmt::{self, Display, Formatter};

const DECIMAL_SCALE: f64 = 1_000_000.0;

/// Default prior for an assumed-true statement.
pub const ASSUMED_TRUE_PRIOR: f64 = 0.6;

/// A probability in `[0, 1]` rounded to six fractional decimal places.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TruthValue(f64);

impl TruthValue {
    /// The certain-false bound.
    pub const FALSE: Self = Self(0.0);
    /// The certain-true bound.
    pub const TRUE: Self = Self(1.0);
    /// The uncertainty midpoint.
    pub const UNKNOWN: Self = Self(0.5);

    /// Clamp finite inputs to `[0, 1]` and round halfway cases upward.
    /// Non-finite inputs map to [unknown](Self::UNKNOWN).
    #[must_use]
    pub fn new(value: f64) -> Self {
        if !value.is_finite() {
            return Self::UNKNOWN;
        }
        let scaled = value.clamp(0.0, 1.0) * DECIMAL_SCALE;
        let whole = scaled as u32;
        let rounded = whole + u32::from(scaled - f64::from(whole) >= 0.5);
        Self(f64::from(rounded) / DECIMAL_SCALE)
    }

    /// The probability as an `f64`.
    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }

    /// The complement `1 - v`.
    #[must_use]
    pub fn negate(self) -> Self {
        Self::new(1.0 - self.0)
    }

    /// Render with six fractional digits.
    #[must_use]
    pub fn to_decimal_string(self) -> String {
        format!("{self}")
    }
}

impl Display for TruthValue {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:.6}", self.0)
    }
}

impl From<f64> for TruthValue {
    fn from(value: f64) -> Self {
        Self::new(value)
    }
}

/// Connectives over a slice of truth values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aggregator {
    /// Minimum. An empty slice yields `1`.
    Min,
    /// Maximum. An empty slice yields `0`.
    Max,
    /// Arithmetic mean. An empty slice yields `0.5`.
    Average,
    /// Product, or conjunction under independence. An empty slice yields `1`.
    Product,
    /// `1 - ∏(1 - vᵢ)`, or disjunction under independence. An empty slice yields `0`.
    ProbabilisticSum,
}

impl Aggregator {
    /// Stable name for use in a trace.
    #[must_use]
    pub const fn slug(self) -> &'static str {
        match self {
            Self::Min => "min",
            Self::Max => "max",
            Self::Average => "average",
            Self::Product => "product",
            Self::ProbabilisticSum => "probabilistic_sum",
        }
    }

    /// Apply the connective and round the result to the truth value grid.
    #[must_use]
    pub fn combine(self, values: &[TruthValue]) -> TruthValue {
        if values.is_empty() {
            return match self {
                Self::Min | Self::Product => TruthValue::TRUE,
                Self::Max | Self::ProbabilisticSum => TruthValue::FALSE,
                Self::Average => TruthValue::UNKNOWN,
            };
        }
        self.combine_raw(values.iter().map(|value| value.get()))
            .into()
    }

    // The full evaluator calls this with its configured truth range and
    // applies its own rounding and empty-input behavior.
    pub(crate) fn combine_raw(self, values: impl ExactSizeIterator<Item = f64>) -> f64 {
        match self {
            Self::Min => values.fold(f64::INFINITY, f64::min),
            Self::Max => values.fold(f64::NEG_INFINITY, f64::max),
            Self::Average => {
                let count = values.len();
                values.sum::<f64>() / count as f64
            }
            Self::Product => values.product(),
            Self::ProbabilisticSum => probabilistic_sum(values),
        }
    }
}

fn probabilistic_sum(values: impl IntoIterator<Item = f64>) -> f64 {
    1.0 - values
        .into_iter()
        .fold(1.0, |acc, value| acc * (1.0 - value))
}

/// Trust tier for caller-classified evidence sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceTier {
    /// The subject speaking about itself or its own records.
    OriginalFirstParty,
    /// First-hand reporting or a primary recording.
    OriginalJournalism,
    /// Independent secondary corroboration.
    IndependentCorroboration,
    /// A repost, mirror, or aggregator.
    Unoriginal,
}

impl SourceTier {
    /// Stable name for use in a trace.
    #[must_use]
    pub const fn slug(self) -> &'static str {
        match self {
            Self::OriginalFirstParty => "original_first_party",
            Self::OriginalJournalism => "original_journalism",
            Self::IndependentCorroboration => "independent_corroboration",
            Self::Unoriginal => "unoriginal",
        }
    }

    /// Trust weight as an integer percentage.
    #[must_use]
    pub const fn weight_percent(self) -> u8 {
        match self {
            Self::OriginalFirstParty => 100,
            Self::OriginalJournalism => 85,
            Self::IndependentCorroboration => 50,
            Self::Unoriginal => 0,
        }
    }

    /// Trust weight on the probability scale.
    #[must_use]
    pub const fn weight(self) -> f64 {
        self.weight_percent() as f64 / 100.0
    }

    /// Whether evidence from this tier can contribute to an assessment.
    #[must_use]
    pub const fn is_original(self) -> bool {
        !matches!(self, Self::Unoriginal)
    }
}

/// Direction of an evidence item relative to the statement being assessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stance {
    /// The source affirms the statement.
    Supports,
    /// The source contradicts the statement.
    Contradicts,
    /// The source takes no side.
    Neutral,
    /// The source asserts a premise that entails the statement.
    Implies,
}

impl Stance {
    /// Stable name for use in a trace.
    #[must_use]
    pub const fn slug(self) -> &'static str {
        match self {
            Self::Supports => "supports",
            Self::Contradicts => "contradicts",
            Self::Neutral => "neutral",
            Self::Implies => "implies",
        }
    }
}

/// One piece of evidence about a statement.
#[derive(Debug, Clone, PartialEq)]
pub struct RelativeEvidence {
    /// A short label for the source or the related statement.
    pub source_label: String,
    /// The trust tier of the source.
    pub tier: SourceTier,
    /// How the evidence relates to the statement being assessed.
    pub stance: Stance,
    /// The evidence strength before applying the trust weight.
    pub strength: TruthValue,
}

impl RelativeEvidence {
    /// Construct evidence with a caller-supplied strength.
    #[must_use]
    pub fn new(
        source_label: impl Into<String>,
        tier: SourceTier,
        stance: Stance,
        strength: impl Into<TruthValue>,
    ) -> Self {
        Self {
            source_label: source_label.into(),
            tier,
            stance,
            strength: strength.into(),
        }
    }

    /// Use an assessed statement as evidence for another statement.
    ///
    /// Evidence strength is the premise's posterior times the supplied
    /// relation strength. Use [`Stance::Implies`] with strength `1` for a
    /// definite implication. Pass each assessment forward once through a
    /// chain and choose a tier for how much to trust each relation.
    #[must_use]
    pub fn from_statement(
        premise: &StatementAssessment,
        tier: SourceTier,
        stance: Stance,
        relation_strength: impl Into<TruthValue>,
    ) -> Self {
        let strength = premise.posterior.get() * relation_strength.into().get();
        Self::new(premise.statement.as_str(), tier, stance, strength)
    }

    /// Evidence mass after applying source trust. Neutral evidence has zero mass.
    #[must_use]
    pub fn effective_mass(&self) -> f64 {
        if self.stance == Stance::Neutral {
            return 0.0;
        }
        self.tier.weight() * self.strength.get()
    }

    /// Whether the evidence contributes zero mass.
    #[must_use]
    pub fn is_ignored(&self) -> bool {
        self.effective_mass() == 0.0
    }

    /// A one-line trace of the inputs and effective mass.
    #[must_use]
    pub fn trace_payload(&self) -> String {
        format!(
            "source={} tier={} stance={} strength={} mass={:.6} ignored={}",
            self.source_label,
            self.tier.slug(),
            self.stance.slug(),
            self.strength,
            self.effective_mass(),
            self.is_ignored(),
        )
    }
}

/// A statement's probability relative to supplied evidence.
#[derive(Debug, Clone, PartialEq)]
pub struct StatementAssessment {
    /// The statement being assessed.
    pub statement: String,
    /// The probability before applying evidence.
    pub prior: TruthValue,
    /// Combined supporting mass, including implications.
    pub support: TruthValue,
    /// Combined contradicting mass.
    pub contradiction: TruthValue,
    /// The resulting probability.
    pub posterior: TruthValue,
    /// Labels of evidence items with zero effective mass, in input order.
    pub ignored_sources: Vec<String>,
}

impl StatementAssessment {
    /// Combine evidence on each side by probabilistic sum, assuming independent
    /// contributions within each side. Provide one item per independent source
    /// or relation. The posterior is
    /// `(1 - (1 - prior) * (1 - support)) * (1 - contradiction)`.
    /// The result and combined masses are rounded after calculation.
    #[must_use]
    pub fn assess(
        statement: impl Into<String>,
        prior: TruthValue,
        evidence: &[RelativeEvidence],
    ) -> Self {
        let mass = |matches_stance: fn(Stance) -> bool| {
            probabilistic_sum(
                evidence
                    .iter()
                    .filter(|item| matches_stance(item.stance))
                    .map(RelativeEvidence::effective_mass),
            )
        };
        let support = mass(|stance| matches!(stance, Stance::Supports | Stance::Implies));
        let contradiction = mass(|stance| stance == Stance::Contradicts);

        let raised = probabilistic_sum([prior.get(), support]);
        Self {
            statement: statement.into(),
            prior,
            support: support.into(),
            contradiction: contradiction.into(),
            posterior: TruthValue::new(raised * (1.0 - contradiction)),
            ignored_sources: evidence
                .iter()
                .filter(|item| item.is_ignored())
                .map(|item| item.source_label.clone())
                .collect(),
        }
    }

    /// Start with [`ASSUMED_TRUE_PRIOR`] and assess the supplied evidence.
    #[must_use]
    pub fn assess_assumed_true(
        statement: impl Into<String>,
        evidence: &[RelativeEvidence],
    ) -> Self {
        Self::assess(statement, ASSUMED_TRUE_PRIOR.into(), evidence)
    }

    /// Whether the posterior is strictly above the uncertainty midpoint.
    #[must_use]
    pub fn is_probable(&self) -> bool {
        self.posterior.get() > 0.5
    }

    /// A one-line trace of the prior, evidence masses, and posterior.
    #[must_use]
    pub fn trace_payload(&self) -> String {
        format!(
            "prior={} support={} contradiction={} posterior={} ignored={}",
            self.prior,
            self.support,
            self.contradiction,
            self.posterior,
            self.ignored_sources.len(),
        )
    }
}
