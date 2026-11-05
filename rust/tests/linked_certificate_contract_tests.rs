use rml::linked_program::linked_certificate_candidates;
use serde_json::Value;
fn cases() -> Vec<Value> {
    serde_json::from_str::<Value>(include_str!(
        "../../test-corpus/linked-certificate/cases.json"
    ))
    .unwrap()["cases"]
        .as_array()
        .unwrap()
        .clone()
}
fn evaluate(case: &Value) -> Vec<usize> {
    let description: Vec<Vec<usize>> = serde_json::from_value(case["description"].clone()).unwrap();
    let records: Vec<Vec<usize>> = serde_json::from_value(case["records"].clone()).unwrap();
    let candidates: Vec<usize> =
        serde_json::from_value(case["candidateAddresses"].clone()).unwrap();
    linked_certificate_candidates(
        &description,
        &records,
        &candidates,
        case["contextAddress"].as_u64().unwrap() as usize,
    )
}
#[test]
fn preserves_complete_relocated_and_ambiguous_certificate_results() {
    for case in cases()
        .into_iter()
        .filter(|c| !c["expected"].as_array().unwrap().is_empty())
    {
        let expected: Vec<usize> = serde_json::from_value(case["expected"].clone()).unwrap();
        assert_eq!(evaluate(&case), expected, "{}", case["name"]);
    }
}
#[test]
fn rejects_missing_foreign_dangling_ambiguous_and_malformed_certificate_evidence() {
    for case in cases()
        .into_iter()
        .filter(|c| c["expected"].as_array().unwrap().is_empty())
    {
        assert!(evaluate(&case).is_empty(), "{}", case["name"]);
    }
}
