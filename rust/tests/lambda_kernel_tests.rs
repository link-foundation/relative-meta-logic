use rml::lambda_kernel::{self as lambda, Kernel, KernelOptions, MACHINE_OPERATIONS, SOURCE};
use rml::linked_program::{LinkedProgram, LinkedProgramRegistry, LinkedProof};
use rml::{parse_one, tokenize_one, Node};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const WORKLOAD: &str = include_str!("../../test-corpus/lambda-kernel/workload.lino");
const CASES: &str = include_str!("../../test-corpus/lambda-kernel/cases.json");
const REPLACEMENT: &str = include_str!("../../test-corpus/lambda-kernel/mirror-substitution.lino");

fn node(value: &Value) -> Node {
    match value {
        Value::String(value) => Node::Leaf(value.clone()),
        Value::Array(items) => Node::List(items.iter().map(node).collect()),
        _ => panic!("invalid shared fixture node"),
    }
}
fn term(source: &str) -> Node {
    parse_one(&tokenize_one(source)).unwrap()
}
fn proof(value: &Value) -> LinkedProof {
    LinkedProof {
        judgement: node(&value["judgement"]),
        program: value["program"].as_str().unwrap().to_string(),
        rule: value["rule"].as_str().unwrap().to_string(),
        premises: value["premises"]
            .as_array()
            .unwrap()
            .iter()
            .map(proof)
            .collect(),
    }
}
fn programs() -> BTreeMap<String, LinkedProgram> {
    let registry = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    registry
        .names()
        .iter()
        .map(|name| (name.to_string(), registry.program(name).unwrap().clone()))
        .collect()
}
fn options<'a>(kernel: &'a Kernel, disabled: &'a BTreeSet<String>) -> KernelOptions<'a> {
    KernelOptions {
        kernel: Some(kernel),
        disabled,
        max_transitions: 100_000_000,
    }
}

#[test]
fn lambda_source_preserves_shared_sk_reductions_and_matching_controls() {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let kernel = Kernel::from_source(SOURCE).unwrap();
    assert_eq!((kernel.node_count, kernel.root_count), (1446, 25));
    let disabled = BTreeSet::new();
    let options = options(&kernel, &disabled);
    let registry = LinkedProgramRegistry::from_rml(WORKLOAD).unwrap();
    let programs = programs();
    let mut observed = BTreeSet::new();
    let mut transitions = 0;
    for case in cases["reductions"].as_array().unwrap() {
        let name = case["program"].as_str().unwrap();
        let rules = lambda::resolve_rewrites(&programs, name, options).unwrap();
        observed.extend(rules.observed.iter().copied());
        transitions += rules.transitions;
        let mut current = node(&case["input"]);
        let mut trace = Vec::new();
        let mut finished = false;
        for _ in 0..16 {
            let result = lambda::rewrite_once(&current, &rules, options).unwrap();
            observed.extend(result.observed);
            transitions += result.transitions;
            match result.step {
                None => {
                    finished = true;
                    break;
                }
                Some((output, program, rule)) => {
                    current = output;
                    trace.push((program, rule));
                }
            }
        }
        assert!(finished);
        let baseline = registry.reduce(name, &node(&case["input"]), 16).unwrap();
        assert_eq!(current, baseline.term);
        assert_eq!(current, node(&case["output"]));
        assert_eq!(
            trace,
            baseline
                .trace
                .iter()
                .map(|step| (step.program.clone(), step.rule.clone()))
                .collect::<Vec<_>>()
        );
    }
    assert_eq!(observed, MACHINE_OPERATIONS.iter().copied().collect());
    assert!(transitions > 0);
}

#[test]
fn lambda_source_preserves_imported_judgements_saturation_and_full_proofs() {
    let cases: Value = serde_json::from_str(CASES).unwrap();
    let kernel = Kernel::from_source(SOURCE).unwrap();
    let disabled = BTreeSet::new();
    let options = options(&kernel, &disabled);
    let programs = programs();
    let mut state = lambda::create_proof_state(&programs, "proof", &[], options)
        .unwrap()
        .state;
    assert_eq!(state.size, 1);
    assert!(lambda::find_proof(&state, &node(&cases["goal"]), options)
        .unwrap()
        .proof
        .is_none());
    let first = lambda::infer_once(state, options).unwrap();
    assert_eq!(first.derivation.as_ref().unwrap().0, term("(arrived seed)"));
    let second = lambda::infer_once(first.state, options).unwrap();
    assert_eq!(
        second.derivation.as_ref().unwrap().0,
        term("(finished seed)")
    );
    let third = lambda::infer_once(second.state, options).unwrap();
    assert!(third.derivation.is_none());
    state = third.state;
    assert_eq!(state.size, 3);
    let found = lambda::find_proof(&state, &node(&cases["goal"]), options)
        .unwrap()
        .proof
        .unwrap();
    assert_eq!(found, proof(&cases["proof"]));
    let baseline = LinkedProgramRegistry::from_rml(WORKLOAD)
        .unwrap()
        .prove("proof", &node(&cases["goal"]), &[], 8, 16)
        .unwrap();
    assert_eq!(found, baseline);
    assert!(
        lambda::find_proof(&state, &node(&cases["absentGoal"]), options)
            .unwrap()
            .proof
            .is_none()
    );
}

#[test]
fn direct_source_replacement_changes_recursive_substitution_without_compilation_or_global_rebinding(
) {
    let original = Kernel::from_source(SOURCE).unwrap();
    let changed = Kernel::from_source(REPLACEMENT).unwrap();
    let disabled = BTreeSet::new();
    let programs = programs();
    let reduce = |kernel| {
        let options = options(kernel, &disabled);
        let rules = lambda::resolve_rewrites(&programs, "rules", options).unwrap();
        lambda::rewrite_once(&term("(input value)"), &rules, options).unwrap()
    };
    let before = reduce(&original);
    let after = reduce(&changed);
    assert_eq!(
        before.step.as_ref().unwrap().0,
        term("(pair (nested value) done)")
    );
    assert_eq!(
        after.step.as_ref().unwrap().0,
        term("(done (value nested) pair)")
    );
    assert_eq!(before.observed, after.observed);
    assert_eq!(reduce(&original).step, before.step);
    assert_eq!(changed.node_count, 1449);
}

#[test]
fn all_declared_lambda_machine_branches_have_removal_witnesses() {
    let kernel = Kernel::from_source(SOURCE).unwrap();
    let programs = programs();
    for operation in MACHINE_OPERATIONS {
        let disabled = BTreeSet::from([operation.to_string()]);
        let error = lambda::resolve_rewrites(&programs, "rules", options(&kernel, &disabled))
            .err()
            .unwrap();
        assert_eq!(
            error,
            format!("disabled host semantic operation {operation}")
        );
    }
    assert_eq!(lambda::EXTERNAL_SEMANTIC_SERVICES.len(), 5);
    assert_eq!(lambda::EXTERNAL_BOUNDARY_SERVICES.len(), 5);
    // These are necessary implementation branches, not independent primitive
    // or genuinely-different-foundation claims.
}

#[test]
fn source_validation_refuses_forged_roots_references_counts_cycles_and_open_terms() {
    let invalid = [
        (String::new(), "declaration"),
        (
            SOURCE.replace("rml-lambda-link-dag-v1", "forged-schema"),
            "metadata",
        ),
        (
            SOURCE.replace("(node-count 1446)", "(node-count 100001)"),
            "resource bounds",
        ),
        (
            SOURCE.replace("(node-count 1446)", "(node-count 1447)"),
            "counts",
        ),
        (
            SOURCE.replace(
                "(bootstrap-source-root TRUE n2)",
                "(bootstrap-source-root FALSE n2)",
            ),
            "duplicate lambda source root",
        ),
        (
            SOURCE.replace(
                "(bootstrap-source-root FIND_KNOWN_PROOF n1445)",
                "(bootstrap-source-root UNKNOWN n1445)",
            ),
            "missing lambda source root",
        ),
        (
            SOURCE.replace("(lambda yes n1)", "(lambda yes n999999)"),
            "unknown lambda source node",
        ),
        (
            SOURCE.replace("(lambda yes n1)", "(lambda yes n2)"),
            "cyclic",
        ),
        (
            SOURCE.replacen("(variable yes)", "(variable unbound)", 1),
            "unbound lambda source root",
        ),
        (
            SOURCE.replace("(lambda yes n1)", "(lambda yes rMISSING)"),
            "unknown earlier lambda root",
        ),
        (format!("{SOURCE}\n(unrecognized payload)\n"), "form"),
        (
            format!("{SOURCE}\n(bootstrap-source-node n0 (variable yes))\n"),
            "duplicate lambda source node",
        ),
    ];
    for (source, message) in invalid {
        let error = Kernel::from_source(&source).unwrap_err();
        assert!(error.contains(message), "{message}: {error}");
    }
}

#[test]
fn lambda_transition_budgets_fail_closed() {
    let kernel = Kernel::from_source(SOURCE).unwrap();
    let disabled = BTreeSet::new();
    let mut options = options(&kernel, &disabled);
    options.max_transitions = 0;
    assert!(lambda::resolve_rewrites(&programs(), "rules", options)
        .err()
        .unwrap()
        .contains("positive"));
    options.max_transitions = 1;
    assert!(lambda::resolve_rewrites(&programs(), "rules", options)
        .err()
        .unwrap()
        .contains("transition limit"));
}
