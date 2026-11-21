use rml::probability::{RelativeEvidence, SourceTier, Stance, StatementAssessment};

fn main() {
    let evidence = [
        RelativeEvidence::new(
            "station operator log",
            SourceTier::OriginalFirstParty,
            Stance::Supports,
            0.8,
        ),
        RelativeEvidence::new(
            "independent witness report",
            SourceTier::IndependentCorroboration,
            Stance::Contradicts,
            0.5,
        ),
        RelativeEvidence::new("repost", SourceTier::Unoriginal, Stance::Supports, 1.0),
    ];
    let assessment =
        StatementAssessment::assess_assumed_true("The station opened today", &evidence);

    let summary = assessment.trace_payload();
    assert_eq!(
        summary,
        "prior=0.600000 support=0.800000 contradiction=0.250000 posterior=0.690000 ignored=1"
    );
    println!("{summary}");
}
