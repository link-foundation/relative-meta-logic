use rml::formal_corpus::FormalCorpus;

const SOURCE: &str = include_str!("../../lib/meta-theory/upstream-0.0.3.lino");
const FOUNDATION: &str = include_str!("../../lib/meta-theory/upstream-0.0.3-foundation.lino");

#[test]
fn keeps_the_four_source_sorry_declarations_explicitly_admitted() {
    let corpus = FormalCorpus::from_rml(SOURCE, FOUNDATION).unwrap();
    let admissions: Vec<_> = corpus
        .declarations()
        .iter()
        .filter(|item| item.proof_status == "admitted")
        .collect();
    let mut names: Vec<_> = admissions
        .iter()
        .map(|item| format!("{}.{}", item.language, item.symbol))
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec![
            "lean.insertSorted_preserves_ascending",
            "lean.mem_insertSorted",
            "lean.mem_toOrderedUnique",
            "lean.strictly_ascending_implies_no_dup",
        ]
    );
    for item in admissions {
        assert!(item.proof.iter().any(|token| token.text == "sorry"));
    }
}

fn rejects_changed_source(from: &str, to: &str) {
    let altered = SOURCE.replace(from, to);
    assert_ne!(altered, SOURCE);
    let error = FormalCorpus::from_rml(&altered, FOUNDATION).unwrap_err();
    assert!(
        error.contains("proof status disagrees with its proof object"),
        "{error}"
    );
}

#[test]
fn rejects_relabelling_an_admitted_source_proof_as_verified() {
    rejects_changed_source("(proof-status admitted)", "(proof-status verified)");
}
#[test]
fn rejects_changed_admission_proof_tokens_without_corresponding_checked_source() {
    rejects_changed_source("(token identifier 736f727279)", "(token identifier 72666c)");
}
#[test]
fn rejects_inventing_admissions_for_non_admitted_source_proof_objects() {
    rejects_changed_source("(proof-status verified)", "(proof-status admitted)");
}
