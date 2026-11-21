use rml::probability::{
    Aggregator, RelativeEvidence, SourceTier, Stance, StatementAssessment, TruthValue,
};

#[test]
fn truth_values_are_bounded_and_round_to_six_places() {
    for (input, expected) in [
        (-0.1, "0.000000"),
        (-0.0, "0.000000"),
        (1.1, "1.000000"),
        (f64::NAN, "0.500000"),
        (f64::NEG_INFINITY, "0.500000"),
        (f64::INFINITY, "0.500000"),
        (0.123456499, "0.123456"),
        (0.1234565, "0.123457"),
        (0.9999995, "1.000000"),
        (0.1 + 0.2, "0.300000"),
    ] {
        assert_eq!(TruthValue::new(input).to_decimal_string(), expected);
    }
    assert_eq!(TruthValue::new(0.123457).negate(), 0.876543.into());
}

#[test]
fn aggregators_preserve_connectives_and_empty_identities() {
    let values = [0.2.into(), 0.6.into(), 0.7.into()];
    for (operator, expected, empty) in [
        (Aggregator::Min, 0.2, 1.0),
        (Aggregator::Max, 0.7, 0.0),
        (Aggregator::Average, 0.5, 0.5),
        (Aggregator::Product, 0.084, 1.0),
        (Aggregator::ProbabilisticSum, 0.904, 0.0),
    ] {
        assert_eq!(operator.combine(&values), expected.into(), "{operator:?}");
        assert_eq!(operator.combine(&[]), empty.into(), "{operator:?}");
    }
}

#[test]
fn assessment_combines_trusted_support_and_contradiction() {
    let prior = TruthValue::new(0.6);
    assert_eq!(
        StatementAssessment::assess("claim", prior, &[]).posterior,
        prior
    );

    let evidence = [
        RelativeEvidence::new(
            "first party",
            SourceTier::OriginalFirstParty,
            Stance::Supports,
            0.8,
        ),
        RelativeEvidence::new(
            "reporter",
            SourceTier::OriginalJournalism,
            Stance::Supports,
            0.4,
        ),
        RelativeEvidence::new(
            "witness",
            SourceTier::IndependentCorroboration,
            Stance::Contradicts,
            0.5,
        ),
        RelativeEvidence::new("repost", SourceTier::Unoriginal, Stance::Contradicts, 1.0),
        RelativeEvidence::new(
            "background",
            SourceTier::OriginalFirstParty,
            Stance::Neutral,
            1.0,
        ),
        RelativeEvidence::new(
            "zero strength",
            SourceTier::OriginalFirstParty,
            Stance::Supports,
            0.0,
        ),
    ];
    let result = StatementAssessment::assess("claim", prior, &evidence);
    assert_eq!(result.support, 0.868.into());
    assert_eq!(result.contradiction, 0.25.into());
    assert_eq!(result.posterior, 0.7104.into());
    assert_eq!(
        result.ignored_sources,
        ["repost", "background", "zero strength"]
    );
    assert!(result.is_probable());
}

#[test]
fn assessed_statements_propagate_along_directional_relations() {
    let premise = StatementAssessment::assess("The train is at platform 2", 0.8.into(), &[]);
    let implication = RelativeEvidence::from_statement(
        &premise,
        SourceTier::OriginalFirstParty,
        Stance::Implies,
        1.0,
    );
    assert_eq!(implication.source_label, premise.statement);
    let consequence =
        StatementAssessment::assess("The train is in the station", 0.3.into(), &[implication]);
    assert_eq!(consequence.support, 0.8.into());
    assert_eq!(consequence.posterior, 0.86.into());

    let contradiction = RelativeEvidence::from_statement(
        &consequence,
        SourceTier::IndependentCorroboration,
        Stance::Contradicts,
        0.5,
    );
    let alternative = StatementAssessment::assess(
        "The train is outside the station",
        0.6.into(),
        &[contradiction],
    );
    assert_eq!(alternative.contradiction, 0.215.into());
    assert_eq!(alternative.posterior, 0.471.into());
}
